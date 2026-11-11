/* Anchor – Gesundheitsdaten (Seite der App)
 *
 * Verbindet die App mit dem iPhone-Kurzbefehl, der Apple Health liest (und damit auch, was Garmin Connect dort ablegt):
 *   - persönlicher Schlüssel: wird hier erzeugt, in Firestore steht nur sein Hash (healthTokens/{sha256});
 *     den Klartext zeigt die App einmal an und merkt ihn sich auf diesem Gerät, damit man ihn in den Kurzbefehl einfügen kann
 *   - Tageswerte: users/{uid}/health/{YYYY-MM-DD}  { day, steps?, activeKcal?, restingHr?, sleepMin?, weightKg?, workouts?, updatedAt }
 *     (die Cloud Function healthIngest in functions/ schreibt sie, die App liest sie live)
 * Wird von cloud.js mit dem Firebase-SDK aufgerufen (im Test mit dem Emulator).
 */

const KEY_PREFIX = 'gymtracker.healthkey.v1.'; // + uid → Klartext-Schlüssel dieses Geräts

export function createHealth({ F, fs, auth, cfg }) {
  const tokens = () => F.collection(fs, 'healthTokens');
  const days = (uid) => F.collection(fs, 'users', uid, 'health');
  const me = () => {
    const u = auth.currentUser;
    if (!u) throw Object.assign(new Error('not signed in'), { code: 'auth/requires-recent-login' });
    return u.uid;
  };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* privat */ } };

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const newKey = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return 'ah_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const plain = (d) => {
    const x = d.data();
    const out = { day: d.id };
    for (const k of ['steps', 'activeKcal', 'restingHr', 'sleepMin', 'weightKg']) if (typeof x[k] === 'number') out[k] = x[k];
    if (Array.isArray(x.workouts)) out.workouts = x.workouts.filter((w) => w && typeof w.type === 'string' && typeof w.minutes === 'number');
    out.updatedAt = x.updatedAt && x.updatedAt.toMillis ? x.updatedAt.toMillis() : 0;
    return out;
  };

  const api = {
    /** Adresse der Cloud Function, an die der Kurzbefehl sendet. functionsRegion = Standort der Funktionen (Standard europe-west3). */
    endpoint() {
      const region = cfg.functionsRegion || 'europe-west3';
      return cfg.useEmulator ? `http://127.0.0.1:5001/${cfg.projectId}/${region}/healthIngest` : `https://${region}-${cfg.projectId}.cloudfunctions.net/healthIngest`;
    },

    /** Gespeicherter Klartext-Schlüssel dieses Geräts (oder null, z. B. auf einem anderen Gerät eingerichtet) */
    savedKey: () => lsGet(KEY_PREFIX + me()),

    /** Gibt es einen gültigen Schlüssel für dieses Konto? */
    async hasKey() {
      const snap = await F.getDocs(F.query(tokens(), F.where('uid', '==', me()), F.limit(1)));
      return !snap.empty;
    },

    /** Neuen Schlüssel erzeugen; ein früherer wird ungültig. Gibt den Klartext zurück (steht nur hier und auf diesem Gerät). */
    async createKey() {
      const uid = me();
      await api.removeKeys();
      const key = newKey();
      await F.setDoc(F.doc(tokens(), await sha256(key)), { uid, createdAt: F.serverTimestamp() });
      lsSet(KEY_PREFIX + uid, key);
      return key;
    },

    /** Verbindung trennen: alle Schlüssel des Kontos löschen (die gespeicherten Tageswerte bleiben). */
    async removeKeys() {
      const uid = me();
      const snap = await F.getDocs(F.query(tokens(), F.where('uid', '==', uid)));
      await Promise.all(snap.docs.map((d) => F.deleteDoc(d.ref)));
      lsSet(KEY_PREFIX + uid, null);
    },

    /** Live: die letzten `limit` Tage (neueste zuerst). onData(liste, { fromCache }) */
    watch(limit, onData, onError) {
      const q = F.query(days(me()), F.orderBy('day', 'desc'), F.limit(limit));
      return F.onSnapshot(q, (snap) => onData(snap.docs.map(plain), { fromCache: snap.metadata.fromCache }), onError);
    },

    /** Konto löschen: Schlüssel und alle Tageswerte entfernen. */
    async deleteAll(uid) {
      const [t, d] = await Promise.all([
        F.getDocs(F.query(tokens(), F.where('uid', '==', uid))),
        F.getDocs(days(uid)),
      ]);
      await Promise.all(t.docs.concat(d.docs).map((x) => F.deleteDoc(x.ref).catch(() => {})));
      lsSet(KEY_PREFIX + uid, null);
    },
  };
  return api;
}
