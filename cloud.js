/* Gym Tracker – Cloud-Anbindung (Firebase Authentication + Cloud Firestore)
 *
 * Wird nur aktiv, wenn in firebase-config.js ein Firebase-Projekt eingetragen ist.
 * Stellt window.GymCloud bereit (Anmelden, Registrieren, …) und meldet den
 * Anmeldestatus an die App (window.GymApp.onAuthState).
 *
 * Datenablage in Firestore (nur der jeweilige Nutzer darf lesen/schreiben, siehe firestore.rules):
 *   users/{uid}                  → { days, settings, activeSession }
 *   users/{uid}/sessions/{id}    → eine abgeschlossene Trainingseinheit
 */

const SDK = 'https://www.gstatic.com/firebasejs/12.3.0/';
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

  // Teile des Hauptdokuments (siehe Sync.MAIN_FIELDS in app.js)
  const MAIN_FIELDS = { 'main.days': 'days', 'main.settings': 'settings', 'main.active': 'activeSession' };

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
          const ref = op.key.startsWith('body:') ? F.doc(bodyCol(uid), op.key.slice(5)) : F.doc(sessionsCol(uid), op.key.slice(8));
          if (op.data) batch.set(ref, op.data);
          else batch.delete(ref);
        }
      }
      await batch.commit();
    }
  }

  window.GymCloud = {
    signIn: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
    signUp: (email, password) => A.createUserWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth),
    currentUser: () => auth.currentUser,

    /** Löscht alle Cloud-Daten und das Konto (Passwort zur Bestätigung nötig). */
    async deleteAccount(password) {
      const user = auth.currentUser;
      if (!user) throw Object.assign(new Error('not signed in'), { code: 'auth/requires-recent-login' });
      await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, password));
      const [sessions, body] = await Promise.all([F.getDocs(sessionsCol(user.uid)), F.getDocs(bodyCol(user.uid))]);
      const ops = sessions.docs.map((d) => ({ key: 'session:' + d.id, data: null }))
        .concat(body.docs.map((d) => ({ key: 'body:' + d.id, data: null })));
      ops.push({ key: 'main', data: null });
      await commitOps(user.uid, ops);
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
          return () => { u1(); u2(); u3(); };
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
    const [sessions, body] = await Promise.all([F.getDocs(sessionsCol(uid)), F.getDocs(bodyCol(uid))]);
    const ops = sessions.docs.map((d) => ({ key: 'session:' + d.id, data: null }))
      .concat(body.docs.map((d) => ({ key: 'body:' + d.id, data: null })));
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
      await deleteUserData(uid);
      await F.deleteDoc(profileDoc(uid));
    },
  };

  if (window.GymApp) {
    window.GymApp.onCloudReady();
    let unwatchBlocked = null;
    A.onAuthStateChanged(auth, (u) => {
      if (unwatchBlocked) { unwatchBlocked(); unwatchBlocked = null; }
      window.GymApp.onAuthState(u ? { uid: u.uid, email: u.email } : null);
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
