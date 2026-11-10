/* Anchor – Push-Mitteilungen bei geschlossener App (Seite der App)
 *
 * Meldet dieses Gerät beim Push-Dienst (Firebase Cloud Messaging) an und trägt den Geräte-Token in
 * pushDevices/{id} ein. Die Cloud Function in functions/ schickt dorthin eine Mitteilung, sobald im Chat
 * eine neue Nachricht ankommt; der Service Worker (service-worker.js, Ereignis „push“) zeigt sie an.
 *
 *   pushDevices/{id}  → { uid, token, chat, blocked [Nutzer-IDs], platform, updatedAt }   (id = SHA-256 des Tokens)
 *
 * Voraussetzungen: Web-Push-Schlüssel (vapidKey) in firebase-config.js, Browser mit Push (iPhone: App zum
 * Home-Bildschirm hinzugefügt, iOS 16.4+) und erlaubte Mitteilungen.
 * Wird von cloud.js mit dem Firebase-SDK aufgerufen (im Test mit dem Emulator – dort gibt es kein FCM, der Token ist ein Platzhalter).
 */

const KEY = 'gymtracker.pushdevice.v1'; // { uid, id } – zuletzt eingetragenes Gerät dieses Browsers
const WAIT = 4000;                      // Abmelden wartet höchstens so lange auf den Server (offline hängt Firestore sonst)

export function createPush({ SDK, app, auth, F, fs, cfg }) {
  const devices = () => F.collection(fs, 'pushDevices');
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && v.id ? v : null; } catch (e) { return null; } };
  const write = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* privat */ } };
  const fail = (code) => Object.assign(new Error(code), { code });

  /** SHA-256 als Hex – die Dokument-ID soll den Token nicht preisgeben und nur Buchstaben/Ziffern enthalten. */
  async function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return text.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const platform = () => {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /Mac|Win|Linux/.test(ua) ? 'desktop' : 'web';
  };

  async function token() {
    if (cfg.useEmulator) return 'emulator-token-' + auth.currentUser.uid; // FCM gibt es im Emulator nicht
    const M = await import(SDK + 'firebase-messaging.js');
    if (!(await M.isSupported())) throw fail('push/unsupported');
    // Unser eigener Service Worker nimmt die Nachrichten entgegen (Ereignis „push“)
    const reg = await navigator.serviceWorker.ready;
    return M.getToken(M.getMessaging(app), { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
  }

  return {
    /** Geht Push hier überhaupt (Schlüssel eingetragen, Browser kann es)? */
    available() {
      return !!(cfg.vapidKey || cfg.useEmulator) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },

    /** Gerät eintragen bzw. aktualisieren: chat = Mitteilungen gewünscht, blocked = Nutzer-IDs, die man blockiert hat. */
    async register({ chat, blocked }) {
      const u = auth.currentUser;
      if (!u) throw fail('auth/requires-recent-login');
      if (!this.available()) throw fail('push/unavailable');
      if (Notification.permission !== 'granted') throw fail('push/permission');
      const tk = await token();
      const id = await sha256(tk);
      const prev = read();
      await F.setDoc(F.doc(devices(), id), {
        uid: u.uid, token: tk, chat: !!chat, blocked: (blocked || []).slice(0, 500), platform: platform(), updatedAt: F.serverTimestamp(),
      });
      // Token hat sich geändert (Browser hat ihn erneuert): alten Eintrag entfernen
      if (prev && prev.id !== id && prev.uid === u.uid) F.deleteDoc(F.doc(devices(), prev.id)).catch(() => {});
      write({ uid: u.uid, id });
      return { id };
    },

    /** Gerät austragen (beim Abmelden – danach kommen keine Mitteilungen dieses Kontos mehr an). */
    async unregister() {
      const k = read();
      if (!k) return;
      write(null);
      await Promise.race([F.deleteDoc(F.doc(devices(), k.id)).catch(() => {}), new Promise((r) => setTimeout(r, WAIT))]);
    },

    /** Alle Geräte eines Kontos löschen (Konto löschen, Konto entfernen). */
    async deleteAll(uid) {
      const snap = await F.getDocs(F.query(devices(), F.where('uid', '==', uid)));
      await Promise.all(snap.docs.map((d) => F.deleteDoc(d.ref).catch(() => {})));
      write(null);
    },
  };
}
