// Integrationstests für den Chat + Sicherheitsregeln gegen den Firebase-Emulator (Auth, Firestore).
// Ausführen (einmalig `npm install` in diesem Ordner):  npm test
// Nutzt dieselben chat.js/social.js wie die App und die echten firestore.rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { createSocial } from '../../social.js';
import { createChat } from '../../chat.js';

const PROJECT = 'demo-gym';
const FS = 'http://127.0.0.1:8080';
const ROOM = 'gym';
const apps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Neuer Nutzer mit eigener Firebase-Instanz (wie ein eigenes Gerät); mit profile=false ohne Benutzernamen. */
async function user(name, profile = true) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: PROJECT + '.firebaseapp.com' }, name + Math.random());
  apps.push(app);
  const auth = A.getAuth(app);
  A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fs = F.getFirestore(app);
  F.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  const cred = await A.createUserWithEmailAndPassword(auth, name + '@test.de', 'geheim123');
  const social = createSocial({ F, fs, auth, storage: null });
  const chat = createChat({ F, fs, auth });
  if (profile) await social.saveProfile({ username: name, photo: null });
  return { uid: cred.user.uid, name, auth, fs, social, chat };
}

async function denied(p) {
  await assert.rejects(p, (e) => /permission|unauthorized/i.test(e.code || '') || /PERMISSION_DENIED/.test(e.message));
}

const say = (u, text, room = ROOM) => u.chat.send(room, { id: u.chat.newId(room), name: u.name, text });
const card = (u, extra = {}) => u.chat.sendCard(ROOM, { id: u.chat.newId(ROOM), name: u.name, when: Date.now() + 3600000, workout: 'push', note: 'Brust & Schulter', ...extra });

/** Wartet, bis die Live-Liste einen passenden Stand meldet. */
function waitList(u, pred, limit = 30) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { stop(); reject(new Error('Zeitüberschreitung')); }, 8000);
    const stop = u.chat.watch(ROOM, limit, (list) => { if (pred(list)) { clearTimeout(t); setTimeout(stop); resolve(list); } }, reject);
  });
}

/**
 * Live-Liste, die erst zurückkommt, wenn der Server den ersten Stand geliefert hat. (Wer im Node-Client gleichzeitig
 * einen Listener aufbaut und schreibt, bringt den Emulator-Stream durcheinander – echte Nutzer hören erst zu.)
 */
async function listen(u, limit = 30) {
  let last = null;
  let ready;
  const first = new Promise((r) => { ready = r; });
  const stop = u.chat.watch(ROOM, limit, (list, meta) => { last = list; if (!meta.fromCache) ready(); }, () => {});
  await first;
  return {
    stop,
    async until(pred) {
      for (let i = 0; i < 160; i++) { if (last && pred(last)) return last; await sleep(50); }
      throw new Error('Zeitüberschreitung');
    },
  };
}

test.before(resetEmulators);
test.after(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

test('Nur Mitglieder mit Profil dürfen lesen und schreiben', async () => {
  const anna = await user('anna');
  const ohne = await user('ohne', false); // angemeldet, aber ohne Benutzernamen
  await say(anna, 'Hallo zusammen');
  await denied(say(ohne, 'Darf ich?'));
  await denied(F.getDocs(F.query(F.collection(ohne.fs, 'rooms', ROOM, 'messages'), F.limit(10))));
  // Abgemeldet: nichts
  const fremd = await user('fremd');
  await A.signOut(fremd.auth);
  await denied(F.getDocs(F.query(F.collection(fremd.fs, 'rooms', ROOM, 'messages'), F.limit(10))));
  await assert.rejects(say(fremd, 'ohne Konto'), { code: 'auth/requires-recent-login' }); // schon die App-Schicht lässt nichts durch
  await denied(F.setDoc(F.doc(F.collection(fremd.fs, 'rooms', ROOM, 'messages')), { uid: fremd.uid, name: 'fremd', kind: 'text', text: 'roh', createdAt: F.serverTimestamp() }));
  // Unbekannte Räume gibt es nicht – und Leser dürfen keine Räume anlegen
  await denied(say(anna, 'falscher Raum', 'geheim'));
  await denied(F.setDoc(F.doc(anna.fs, 'rooms', 'geheim'), { name: 'x' }));
});

test('Nachrichten: Echtzeit zwischen zwei Nutzern, Name und Zeit kommen vom Server', async () => {
  const anna = await user('anna2');
  const ben = await user('ben2');
  const live = await listen(ben);
  await say(anna, 'Wer ist heute da?');
  const list = await live.until((l) => l.some((m) => m.text === 'Wer ist heute da?'));
  live.stop();
  const m = list.find((x) => x.text === 'Wer ist heute da?');
  assert.equal(m.uid, anna.uid);
  assert.equal(m.name, 'anna2');
  assert.equal(m.kind, 'text');
  assert.ok(Math.abs(m.createdAt - Date.now()) < 60000);
  // Neueste zuerst
  await sleep(2100);
  await say(ben, 'Ich bin um 18 Uhr da');
  const both = await waitList(anna, (l) => l.length >= 2 && l[0].text === 'Ich bin um 18 Uhr da');
  assert.equal(both[0].name, 'ben2');
});

test('Nachrichten werden geprüft: Absender, Länge, leere Texte, fremde Felder', async () => {
  const anna = await user('anna3');
  const ben = await user('ben3');
  const col = F.collection(ben.fs, 'rooms', ROOM, 'messages');
  const raw = async (u, data, state = { lastPostAt: F.serverTimestamp() }) => {
    const b = F.writeBatch(u.fs);
    b.set(F.doc(F.collection(u.fs, 'rooms', ROOM, 'messages')), { createdAt: F.serverTimestamp(), ...data });
    b.set(F.doc(u.fs, 'chatState', u.uid), state, { merge: true });
    await b.commit();
  };
  const good = { uid: ben.uid, name: 'ben3', kind: 'text', text: 'ok' };
  await raw(ben, good); // so geht es
  await sleep(2100);
  await denied(raw(ben, { ...good, uid: anna.uid }));                // als jemand anderes schreiben
  await denied(raw(ben, { ...good, name: 'anna3' }));                // fremden Namen vortäuschen
  await denied(raw(ben, { ...good, text: 'x'.repeat(501) }));        // zu lang
  await denied(raw(ben, { ...good, text: '   \n ' }));               // nur Leerraum
  await denied(raw(ben, { ...good, text: '' }));
  await denied(raw(ben, { ...good, kind: 'system' }));
  await denied(raw(ben, { ...good, admin: true }));                  // unbekanntes Feld
  await denied(raw(ben, { ...good, createdAt: F.Timestamp.fromMillis(Date.now() - 86400000) })); // falsche Zeit
  // Ohne Rate-Limit-Dokument im Batch → abgelehnt
  await denied(F.setDoc(F.doc(col), { ...good, createdAt: F.serverTimestamp() }));
  // 500 Zeichen sind erlaubt
  await raw(ben, { ...good, text: 'ä'.repeat(500) });
});

test('Rate Limit: Nachrichten alle 2 Sekunden, Gym-Karten einmal pro Minute', async () => {
  const anna = await user('anna4');
  await say(anna, 'eins');
  await denied(say(anna, 'zwei sofort'));      // zu schnell
  await sleep(2100);
  await say(anna, 'zwei');
  await sleep(2100);
  await card(anna);
  await sleep(2100);
  await denied(card(anna));                    // zweite Karte in der ersten Minute
  await say(anna, 'Text geht trotzdem');       // nur Karten sind begrenzt
  // chatState lässt sich nicht fälschen oder zurücksetzen
  await denied(F.setDoc(F.doc(anna.fs, 'chatState', anna.uid), { lastPostAt: Date.now() - 100000, lastCardAt: Date.now() - 100000 }));
  await denied(F.deleteDoc(F.doc(anna.fs, 'chatState', anna.uid)));
});

test('Gym-Karten: Pflichtfelder, Zeitfenster, Mitkommen nur für sich selbst', async () => {
  const anna = await user('anna5');
  const ben = await user('ben5');
  const carl = await user('carl5');
  const id = anna.chat.newId(ROOM);
  const when = Date.now() + 2 * 3600000;
  await anna.chat.sendCard(ROOM, { id, name: 'anna5', when, workout: 'legs', note: 'Beintag' });

  // Ungültige Karten
  const bad = async (u, extra) => { await sleep(0); await denied(u.chat.sendCard(ROOM, { id: u.chat.newId(ROOM), name: u.name, when, workout: 'push', note: '', ...extra })); };
  await bad(ben, { workout: 'yoga' });
  await bad(ben, { when: Date.now() + 90 * 86400000 });   // mehr als 60 Tage voraus
  await bad(ben, { when: Date.now() - 24 * 3600000 });    // gestern
  await bad(ben, { note: 'n'.repeat(121) });
  await bad(ben, { when: 'heute' });

  // Mitkommen / austragen
  await ben.chat.join(ROOM, id, 'ben5');
  await carl.chat.join(ROOM, id, 'carl5');
  let list = await waitList(anna, (l) => l.some((m) => m.id === id && Object.keys(m.joined).length === 2));
  assert.deepEqual(list.find((m) => m.id === id).joined, { [ben.uid]: 'ben5', [carl.uid]: 'carl5' });
  await ben.chat.leave(ROOM, id);
  list = await waitList(anna, (l) => l.some((m) => m.id === id && Object.keys(m.joined).length === 1));
  assert.deepEqual(Object.keys(list.find((m) => m.id === id).joined), [carl.uid]);

  const ref = F.doc(ben.fs, 'rooms', ROOM, 'messages', id);
  await denied(F.updateDoc(ref, 'joined.' + carl.uid, 'ben5'));            // jemand anderen eintragen
  await denied(F.updateDoc(ref, 'joined.' + ben.uid, 'carl5'));            // falscher Name
  await denied(F.updateDoc(ref, 'joined.' + carl.uid, F.deleteField()));    // jemand anderen austragen
  await denied(F.updateDoc(ref, { note: 'gehackt' }));                     // fremde Karte ändern
  await denied(F.updateDoc(ref, { when: when + 1000, editedAt: F.serverTimestamp() }));
  await denied(F.updateDoc(ref, { joined: {} }));                          // ganze Liste leeren
  await denied(F.deleteDoc(ref));                                          // fremde Karte löschen
});

test('Bearbeiten und Löschen: nur die eigenen Nachrichten und Karten', async () => {
  const anna = await user('anna6');
  const ben = await user('ben6');
  const tid = anna.chat.newId(ROOM);
  await anna.chat.send(ROOM, { id: tid, name: 'anna6', text: 'Tippfehler' });
  const cid = anna.chat.newId(ROOM);
  await sleep(2100);
  await anna.chat.sendCard(ROOM, { id: cid, name: 'anna6', when: Date.now() + 3600000, workout: 'pull', note: '' });

  await anna.chat.editText(ROOM, tid, 'Korrigiert');
  await anna.chat.editCard(ROOM, cid, { when: Date.now() + 7200000, workout: 'push', note: 'Zeit geändert' });
  const list = await waitList(ben, (l) => l.some((m) => m.id === tid && m.text === 'Korrigiert' && m.editedAt));
  assert.equal(list.find((m) => m.id === cid).note, 'Zeit geändert');

  await denied(ben.chat.editText(ROOM, tid, 'Von Ben'));
  await denied(ben.chat.editCard(ROOM, cid, { when: Date.now() + 3600000, workout: 'push', note: '' }));
  await denied(ben.chat.remove(ROOM, tid));
  // Der Autor darf den Absender oder die Serverzeit nicht umschreiben
  const ref = F.doc(anna.fs, 'rooms', ROOM, 'messages', tid);
  await denied(F.updateDoc(ref, { name: 'ben6', editedAt: F.serverTimestamp() }));
  await denied(F.updateDoc(ref, { uid: ben.uid, editedAt: F.serverTimestamp() }));
  await denied(F.updateDoc(ref, { createdAt: F.Timestamp.fromMillis(0), editedAt: F.serverTimestamp() }));
  await denied(F.updateDoc(ref, { text: 'x'.repeat(501), editedAt: F.serverTimestamp() }));

  await anna.chat.remove(ROOM, tid);
  await anna.chat.remove(ROOM, cid);
  const after = await waitList(ben, (l) => !l.some((m) => m.id === tid || m.id === cid));
  assert.ok(Array.isArray(after));
});

test('Älteres nachladen (Pagination) und „Heute im Gym“', async () => {
  await resetEmulators(); // saubere Liste: nur die Nachrichten dieses Tests
  const anna = await user('anna7');
  const ben = await user('ben7');
  for (let i = 1; i <= 7; i++) { await say(anna, 'Nachricht ' + i); await sleep(2050); }
  let live;
  const stop = ben.chat.watch(ROOM, 3, (l) => { live = l; }, () => {});
  await new Promise((r) => { const t = setInterval(() => { if (live && live.length === 3) { clearInterval(t); r(); } }, 50); });
  assert.deepEqual(live.map((m) => m.text), ['Nachricht 7', 'Nachricht 6', 'Nachricht 5']);
  let page = await ben.chat.older(ROOM, live[live.length - 1], 3);
  assert.deepEqual(page.messages.map((m) => m.text), ['Nachricht 4', 'Nachricht 3', 'Nachricht 2']);
  assert.equal(page.done, false);
  page = await ben.chat.older(ROOM, page.messages[page.messages.length - 1], 3);
  assert.deepEqual(page.messages.map((m) => m.text), ['Nachricht 1']);
  assert.equal(page.done, true);
  stop();

  // Karten von heute: nur Karten im Zeitfenster
  const from = Date.now() - 3600000, to = Date.now() + 5 * 3600000;
  await card(anna, { when: Date.now() + 3600000, note: 'heute' });
  const plans = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Zeitüberschreitung')), 8000);
    const off = ben.chat.watchPlans(ROOM, from, to, (l) => { if (l.length) { clearTimeout(t); off(); resolve(l); } }, reject);
  });
  assert.deepEqual(plans.map((m) => m.note), ['heute']);
});

test('Melden: eine Meldung je Nachricht, nur Administratoren können sie lesen', async () => {
  const anna = await user('anna8');
  const ben = await user('ben8');
  const id = anna.chat.newId(ROOM);
  await anna.chat.send(ROOM, { id, name: 'anna8', text: 'Spam-Link' });
  const msg = { id, uid: anna.uid, name: 'anna8', kind: 'text', text: 'Spam-Link' };
  await ben.chat.report(ROOM, msg, 'spam');
  await denied(ben.chat.report(ROOM, msg, 'spam'));                         // zweite Meldung derselben Nachricht (kein Update)
  await denied(F.setDoc(F.doc(ben.fs, 'reports', anna.uid + '_' + id), { room: ROOM, msgId: id, targetUid: anna.uid, targetName: 'anna8', text: 'x', reason: 'spam', reporter: anna.uid, at: F.serverTimestamp() })); // im Namen eines anderen
  await denied(ben.chat.report(ROOM, msg, 'beleidigung'));                  // unbekannter Grund
  await denied(F.getDoc(F.doc(ben.fs, 'reports', ben.uid + '_' + id)));     // selbst melden ja, lesen nein
  await denied(F.getDocs(F.collection(ben.fs, 'reports')));
});

test('Konto löschen: Nachrichten, Karten, Teilnahmen und Rate-Limit-Dokument verschwinden', async () => {
  const anna = await user('anna9');
  const ben = await user('ben9');
  await say(anna, 'bis bald');
  await sleep(2100);
  const cid = anna.chat.newId(ROOM);
  await anna.chat.sendCard(ROOM, { id: cid, name: 'anna9', when: Date.now() + 3600000, workout: '', note: '' });
  const bid = ben.chat.newId(ROOM);
  await ben.chat.sendCard(ROOM, { id: bid, name: 'ben9', when: Date.now() + 3600000, workout: 'cardio', note: '' });
  await anna.chat.join(ROOM, bid, 'anna9');
  assert.deepEqual(Object.values((await waitList(ben, (l) => l.some((m) => m.id === bid && m.joined[anna.uid]))).find((m) => m.id === bid).joined), ['anna9']);

  await anna.chat.deleteMine(anna.uid, [ROOM]);
  await denied(anna.chat.deleteState(anna.uid));          // solange das Profil besteht: nicht erlaubt
  await anna.social.deleteAll(anna.uid);                  // Profil weg
  await anna.chat.deleteState(anna.uid);
  const list = await waitList(ben, (l) => !l.some((m) => m.uid === anna.uid));
  assert.equal(list.find((m) => m.id === bid).uid, ben.uid);
  assert.deepEqual(list.find((m) => m.id === bid).joined, {});
  assert.equal((await F.getDoc(F.doc(ben.fs, 'chatState', anna.uid)).catch(() => null)), null); // nur der Besitzer darf sein Dokument lesen
});

test('Gesperrte Konten dürfen nicht mehr schreiben', async () => {
  const anna = await user('anna10');
  await say(anna, 'noch erlaubt');
  // Sperre wie die Nutzerverwaltung: blocked/{uid} (hier direkt über die Admin-Schnittstelle des Emulators)
  await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/blocked/${anna.uid}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { reason: { stringValue: 'test' } } }),
  });
  await sleep(2100);
  await denied(say(anna, 'jetzt nicht mehr'));
  await denied(F.getDocs(F.query(F.collection(anna.fs, 'rooms', ROOM, 'messages'), F.limit(5))));
});
