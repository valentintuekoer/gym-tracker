/* Gym Tracker – Cloud-Anbindung (Firebase Authentication + Cloud Firestore)
 *
 * Wird nur aktiv, wenn in firebase-config.js ein Firebase-Projekt eingetragen ist.
 * Stellt window.GymCloud bereit (Anmelden, Registrieren, …) und meldet den
 * Anmeldestatus an die App (window.GymApp.onAuthState).
 *
 * Datenablage in Firestore (nur der jeweilige Nutzer darf lesen/schreiben, siehe firestore.rules):
 *   users/{uid}                  → { days, settings, activeSession }
 *   users/{uid}/sessions/{id}    → eine abgeschlossene Trainingseinheit
 * Freunde (Profil, Benutzername, Anfragen, geteilte Kennzahlen): siehe social.js
 */
import { createSocial } from './social.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.3.0/';
const REDIRECT_KEY = 'gymtracker.appleRedirect'; // „Mit Apple anmelden“ per Weiterleitung gestartet
const cfg = window.GYM_FIREBASE_CONFIG;

let ready = false;

function start() {
  if (ready) return;
  init().then(() => { ready = true; }).catch((err) => {
    // Meist: offline beim allerersten Start (SDK noch nicht im Cache) → sobald online, erneut versuchen
    console.error('Firebase konnte nicht geladen werden:', err);
    window.addEventListener('online', start, { once: true });
  });
}

if (cfg && cfg.apiKey) start();

async function init() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);

  const app = initializeApp(cfg);
  // Anmeldung bleibt im Browser gespeichert (IndexedDB, Fallback localStorage)
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  auth.languageCode = 'de'; // E-Mails (z. B. Passwort zurücksetzen) auf Deutsch
  const fs = F.initializeFirestore(app, { ignoreUndefinedProperties: true });

  // Nur für lokale Tests mit dem Firebase-Emulator
  if (cfg.useEmulator) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    F.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  }

  const userDoc = (uid) => F.doc(fs, 'users', uid);
  const sessionsCol = (uid) => F.collection(fs, 'users', uid, 'sessions');
  const bodyCol = (uid) => F.collection(fs, 'users', uid, 'body');
  const nutritionCol = (uid) => F.collection(fs, 'users', uid, 'nutrition');
  const foodCol = (uid) => F.collection(fs, 'users', uid, 'food');

  // Teile des Hauptdokuments (siehe Sync.MAIN_FIELDS in app.js)
  const MAIN_FIELDS = {
    'main.days': 'days', 'main.settings': 'settings', 'main.active': 'activeSession',
    'main.customex': 'customExercises', 'main.libmeta': 'libMeta',
  };

  // Schlüssel-Präfix (Sammlung) → passende Firestore-Sammlung
  const collFor = (uid, key) => key.startsWith('body:') ? [bodyCol(uid), key.slice(5)]
    : key.startsWith('nutrition:') ? [nutritionCol(uid), key.slice(10)]
    : key.startsWith('food:') ? [foodCol(uid), key.slice(5)]
    : [sessionsCol(uid), key.slice(8)];

  /**
   * Schreibt Operationen in Paketen (Firestore erlaubt max. 500 pro Batch).
   * Teile des Hauptdokuments werden einzeln ersetzt (mergeFields) – so überschreibt ein Gerät
   * nie Bereiche, die es gar nicht geändert hat. Körpermessungen kommen zuletzt.
   */
  async function commitOps(uid, ops) {
    const order = (op) => (op.key.startsWith('body:') ? 1 : 0);
    const sorted = ops.slice().sort((a, b) => order(a) - order(b));
    for (let i = 0; i < sorted.length; i += 400) {
      const batch = F.writeBatch(fs);
      for (const op of sorted.slice(i, i + 400)) {
        if (op.key in MAIN_FIELDS) {
          const field = MAIN_FIELDS[op.key];
          batch.set(userDoc(uid), { [field]: op.data === undefined ? null : op.data }, { mergeFields: [field] });
        } else if (op.key === 'main') {
          batch.delete(userDoc(uid)); // nur beim Löschen des Kontos
        } else {
          const [col, id] = collFor(uid, op.key);
          const ref = F.doc(col, id);
          if (op.data) batch.set(ref, op.data);
          else batch.delete(ref);
        }
      }
      await batch.commit();
    }
  }

  // Cloud Storage (Profilfotos) erst laden, wenn wirklich ein Foto hochgeladen/gelöscht wird
  let storageP = null;
  const storage = () => storageP || (storageP = import(SDK + 'firebase-storage.js').then((S) => {
    const st = S.getStorage(app);
    if (cfg.useEmulator) S.connectStorageEmulator(st, '127.0.0.1', 9199);
    return { S, st };
  }).catch((e) => { storageP = null; throw e; }));
  const social = createSocial({ F, fs, auth, storage: cfg.storageBucket ? storage : null });

  const appleProvider = () => {
    const p = new A.OAuthProvider('apple.com');
    p.addScope('email');
    p.setCustomParameters({ locale: 'de_DE' });
    return p;
  };

  window.GymCloud = {
    signIn: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
    signUp: (email, password) => A.createUserWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth),
    currentUser: () => auth.currentUser,
    social,

    /**
     * „Mit Apple anmelden“. Zuerst als Pop-up (klappt in Safari und in der Home-Bildschirm-App);
     * wo Pop-ups nicht gehen, per Weiterleitung – das Ergebnis kommt dann beim nächsten Start (getRedirectResult).
     */
    async signInWithApple() {
      try {
        await A.signInWithPopup(auth, appleProvider());
        return { redirect: false };
      } catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
          try { sessionStorage.setItem(REDIRECT_KEY, '1'); } catch (x) { /* privat */ }
          await A.signInWithRedirect(auth, appleProvider());
          return { redirect: true };
        }
        throw e;
      }
    },

    /** Anmeldewege des aktuellen Kontos, z. B. ['password'] oder ['apple.com'] */
    providers: () => (auth.currentUser ? auth.currentUser.providerData.map((p) => p.providerId) : []),

    /**
     * Löscht das Konto und alle Cloud-Daten: Trainingsdaten, Profil, Benutzername, Foto,
     * Freundschaften und Anfragen. Bestätigung per Passwort bzw. erneut „Mit Apple anmelden“.
     */
    async deleteAccount(password) {
      const user = auth.currentUser;
      if (!user) throw Object.assign(new Error('not signed in'), { code: 'auth/requires-recent-login' });
      if (password) await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, password));
      else await A.reauthenticateWithPopup(user, appleProvider());
      await social.deleteAll(user.uid);
      await deleteUserData(user.uid);
      await F.deleteDoc(profileDoc(user.uid)).catch(() => {});
      await A.deleteUser(user);
    },

    /**
     * Verbindung für den Abgleich-Motor in app.js (createSyncEngine).
     * Es werden nur bestätigte Server-Stände gemeldet: keine Zwischenstände aus dem
     * lokalen Cache und keine, in denen eigene Schreibvorgänge noch offen sind.
     */
    createAdapter(uid) {
      return {
        subscribe(handlers, onError) {
          const opts = { includeMetadataChanges: true };
          const clean = (snap) => !snap.metadata.hasPendingWrites && !snap.metadata.fromCache;
          const list = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() }));
          const u1 = F.onSnapshot(userDoc(uid), opts, (snap) => {
            if (clean(snap)) handlers.main(snap.exists() ? snap.data() : null);
          }, onError);
          const u2 = F.onSnapshot(sessionsCol(uid), opts, (snap) => {
            if (clean(snap)) handlers.sessions(list(snap));
          }, onError);
          const u3 = F.onSnapshot(bodyCol(uid), opts, (snap) => {
            if (clean(snap)) handlers.body(list(snap));
          }, onError);
          const u4 = F.onSnapshot(nutritionCol(uid), opts, (snap) => {
            if (clean(snap)) handlers.nutrition(list(snap));
          }, onError);
          const u5 = F.onSnapshot(foodCol(uid), opts, (snap) => {
            if (clean(snap)) handlers.foods(list(snap));
          }, onError);
          return () => { u1(); u2(); u3(); u4(); u5(); };
        },
        commit: (ops) => commitOps(uid, ops),
        /** Gibt es das Hauptdokument wirklich nicht mehr? (direkt beim Server nachgefragt) */
        confirmMissing: async () => !(await F.getDocFromServer(userDoc(uid))).exists(),
      };
    },
  };

  /* ---------- Nutzerverwaltung (nur für Administratoren – die Firestore-Regeln prüfen das) ----------
   *   profiles/{uid}  → E-Mail, registriert, zuletzt aktiv (schreibt jeder Nutzer selbst)
   *   blocked/{uid}   → Sperre inkl. Grund (schreibt nur der Admin)
   */
  const profileDoc = (uid) => F.doc(fs, 'profiles', uid);
  const blockedDoc = (uid) => F.doc(fs, 'blocked', uid);

  async function deleteUserData(uid) {
    const [sessions, body, nutrition, food] = await Promise.all([
      F.getDocs(sessionsCol(uid)), F.getDocs(bodyCol(uid)), F.getDocs(nutritionCol(uid)), F.getDocs(foodCol(uid)),
    ]);
    const ops = sessions.docs.map((d) => ({ key: 'session:' + d.id, data: null }))
      .concat(body.docs.map((d) => ({ key: 'body:' + d.id, data: null })))
      .concat(nutrition.docs.map((d) => ({ key: 'nutrition:' + d.id, data: null })))
      .concat(food.docs.map((d) => ({ key: 'food:' + d.id, data: null })));
    ops.push({ key: 'main', data: null });
    await commitOps(uid, ops);
  }

  window.GymCloud.admin = {
    /** Alle bekannten Nutzer (Profile + gesperrte/entfernte Konten) */
    async listUsers() {
      const [profiles, blocked] = await Promise.all([F.getDocs(F.collection(fs, 'profiles')), F.getDocs(F.collection(fs, 'blocked'))]);
      const map = new Map();
      profiles.docs.forEach((d) => map.set(d.id, { uid: d.id, ...d.data(), blocked: null }));
      blocked.docs.forEach((d) => {
        const b = d.data();
        const u = map.get(d.id) || { uid: d.id, email: b.email || '', removed: true };
        u.blocked = b;
        map.set(d.id, u);
      });
      return [...map.values()];
    },
    /** Anzahl Tage/Einheiten/Messungen eines Nutzers */
    async stats(uid) {
      const [main, s, b] = await Promise.all([
        F.getDoc(userDoc(uid)), F.getCountFromServer(sessionsCol(uid)), F.getCountFromServer(bodyCol(uid)),
      ]);
      const d = main.exists() ? main.data() : null;
      return {
        days: d && Array.isArray(d.days) ? d.days.length : 0,
        active: !!(d && d.activeSession),
        sessions: s.data().count,
        body: b.data().count,
      };
    },
    block: (uid, email, reason) => F.setDoc(blockedDoc(uid), { email: email || '', reason: reason || '', at: Date.now(), by: auth.currentUser.uid }),
    unblock: (uid) => F.deleteDoc(blockedDoc(uid)),
    wipe: (uid) => deleteUserData(uid),
    /** Konto entfernen = sperren (zuerst, damit währenddessen nichts neu geschrieben wird) + alle Daten löschen */
    async remove(uid, email) {
      await window.GymCloud.admin.block(uid, email, 'Konto entfernt');
      await social.deleteAll(uid).catch(() => {});
      await deleteUserData(uid);
      await F.deleteDoc(profileDoc(uid));
    },
  };

  if (window.GymApp) {
    // Rückkehr von „Mit Apple anmelden“ per Weiterleitung: Erfolg meldet onAuthStateChanged, hier nur Fehler
    let redirected = false;
    try { redirected = sessionStorage.getItem(REDIRECT_KEY) === '1'; sessionStorage.removeItem(REDIRECT_KEY); } catch (x) { /* privat */ }
    if (redirected) A.getRedirectResult(auth).catch((e) => { if (window.GymApp.onAuthError) window.GymApp.onAuthError(e); });
    window.GymApp.onCloudReady();
    let unwatchBlocked = null;
    A.onAuthStateChanged(auth, (u) => {
      if (unwatchBlocked) { unwatchBlocked(); unwatchBlocked = null; }
      // Neues Konto: erste Anmeldung = Erstellung (auch bei „Mit Apple anmelden“)
      const isNew = !!(u && u.metadata.creationTime && u.metadata.creationTime === u.metadata.lastSignInTime);
      window.GymApp.onAuthState(u ? { uid: u.uid, email: u.email || '', isNew } : null);
      if (!u) { window.GymApp.setAdmin(false); return; }
      // Profil für die Nutzerverwaltung aktuell halten (schlägt still fehl, wenn gesperrt)
      F.setDoc(profileDoc(u.uid), {
        email: u.email || '', createdAt: Date.parse(u.metadata.creationTime) || null, lastSeen: Date.now(),
      }, { merge: true }).catch(() => {});
      // Gesperrt? – live, damit eine Sperre sofort wirkt
      unwatchBlocked = F.onSnapshot(blockedDoc(u.uid), (snap) => {
        if (snap.exists()) window.GymApp.onBlocked(snap.data());
      }, () => {});
      // Administrator? Nur Admins dürfen admin/* lesen (siehe firestore.rules)
      F.getDoc(F.doc(fs, 'admin', 'probe')).then(() => window.GymApp.setAdmin(true), () => window.GymApp.setAdmin(false));
    });
  }
}
