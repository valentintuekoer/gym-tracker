// Integrationstests für Freunde + Sicherheitsregeln gegen den Firebase-Emulator (Auth, Firestore, Storage).
// Ausführen (einmalig `npm install` in diesem Ordner):  npm test
// Nutzt dieselbe social.js wie die App und die echten firestore.rules / storage.rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import * as S from 'firebase/storage';
import { createSocial } from '../../social.js';

const PROJECT = 'demo-gym';
const FS = 'http://127.0.0.1:8080';
const apps = [];

async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Neuer Nutzer mit eigener Firebase-Instanz (wie ein eigenes Gerät). */
async function user(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: PROJECT + '.firebaseapp.com', storageBucket: PROJECT + '.appspot.com' }, name + Math.random());
  apps.push(app);
  const auth = A.getAuth(app);
  A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fs = F.getFirestore(app);
  F.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  const st = S.getStorage(app);
  S.connectStorageEmulator(st, '127.0.0.1', 9199);
  const cred = await A.createUserWithEmailAndPassword(auth, name + '@test.de', 'geheim123');
  const social = createSocial({ F, fs, auth, storage: async () => ({ S, st }) });
  return { uid: cred.user.uid, auth, fs, st, social };
}

const STATS = { v: 1, goal: 3, total: 4, last: Date.now(), days: { '2026-09-20': [1, 5000] }, records: { 'bankdruecken-lh': { w: 100, e: 116.7, r: 8 } }, fav: 'bankdruecken-lh', favCount: 4 };

/** Erwartet, dass Firestore/Storage die Aktion verweigert. */
async function denied(p) {
  await assert.rejects(p, (e) => /permission|unauthorized/i.test(e.code || '') || /PERMISSION_DENIED/.test(e.message));
}

/** Wartet, bis der Live-Handler einen passenden Stand meldet. */
function waitFor(social, key, pred) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { stop(); reject(new Error('Zeitüberschreitung: ' + key)); }, 8000);
    const h = { friends() {}, incoming() {}, outgoing() {} };
    h[key] = (list) => { if (pred(list)) { clearTimeout(t); setTimeout(stop); resolve(list); } };
    const stop = social.watch(h, reject);
  });
}

test.before(resetEmulators);
test.after(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

test('Benutzername ist eindeutig, Suche und Umbenennen', async () => {
  const a = await user('anna');
  const b = await user('ben');
  await a.social.saveProfile({ username: 'anna', photo: null, stats: STATS });
  assert.equal(await b.social.isUsernameFree('anna'), false);
  assert.equal(await a.social.isUsernameFree('anna'), true); // eigener Name
  await assert.rejects(b.social.saveProfile({ username: 'anna', photo: null }), { code: 'username-taken' });
  await b.social.saveProfile({ username: 'ben', photo: null });

  const hits = await b.social.search('an');
  assert.deepEqual(hits.map((h) => h.username), ['anna']);
  assert.equal(hits[0].uid, a.uid);
  assert.equal((await b.social.lookup('ben')).uid, b.uid);
  assert.equal(await b.social.lookup('niemand'), null);

  // Ungültige Namen und fremde Namen lehnen die Regeln ab
  await denied(F.setDoc(F.doc(b.fs, 'usernames', 'Ungültig!'), { uid: b.uid, username: 'Ungültig!', photo: null }));
  await denied(F.setDoc(F.doc(b.fs, 'usernames', 'anna'), { uid: b.uid, username: 'anna', photo: null }));
  await denied(F.setDoc(F.doc(b.fs, 'publicProfiles', b.uid), { username: 'anna', photo: null }, { merge: true }));
  // Zu große Abfragen (ganze Liste auslesen) sind gesperrt
  await denied(F.getDocs(F.query(F.collection(b.fs, 'usernames'), F.limit(100))));

  // Umbenennen gibt den alten Namen frei
  await a.social.saveProfile({ username: 'anna.k', photo: null });
  assert.equal(await b.social.isUsernameFree('anna'), true);
  assert.equal((await b.social.lookup('anna.k')).uid, a.uid);
});

test('Anfrage senden, annehmen, Profile lesen, Freund entfernen', async () => {
  const a = await user('alex');
  const b = await user('bea');
  const c = await user('cem');
  await a.social.saveProfile({ username: 'alex', photo: null, stats: STATS });
  await b.social.saveProfile({ username: 'bea', photo: null, stats: { ...STATS, total: 9 } });
  await c.social.saveProfile({ username: 'cem', photo: null });

  // Ohne Freundschaft: kein Zugriff auf das Profil (Kennzahlen)
  assert.deepEqual(await b.social.getProfiles([a.uid]), { [a.uid]: null });
  await denied(F.getDoc(F.doc(b.fs, 'publicProfiles', a.uid)));

  // Mit falschem Absendernamen oder an sich selbst: abgelehnt
  await denied(F.setDoc(F.doc(b.fs, 'requests', b.uid + '_' + a.uid), { from: b.uid, to: a.uid, fromName: 'alex', fromPhoto: null, toName: 'alex', toPhoto: null, at: 1 }));
  await assert.rejects(b.social.sendRequest(b.uid, { username: 'bea' }, { username: 'bea' }), { code: 'self' });

  await b.social.sendRequest(a.uid, { username: 'bea', photo: null }, { username: 'alex', photo: null });
  const incoming = await waitFor(a.social, 'incoming', (l) => l.length === 1);
  assert.equal(incoming[0].from, b.uid);
  assert.equal(incoming[0].fromName, 'bea');
  await waitFor(b.social, 'outgoing', (l) => l.length === 1 && l[0].to === a.uid);

  // Unbeteiligte sehen die Anfrage nicht; niemand kann sich selbst als Freund eintragen
  await denied(F.getDoc(F.doc(c.fs, 'requests', b.uid + '_' + a.uid)));
  await denied(F.setDoc(F.doc(c.fs, 'users', a.uid, 'friends', c.uid), { since: 1 }));

  await a.social.acceptRequest(b.uid, false);
  await waitFor(a.social, 'friends', (l) => l.some((f) => f.uid === b.uid));
  await waitFor(b.social, 'friends', (l) => l.some((f) => f.uid === a.uid));
  await waitFor(a.social, 'incoming', (l) => l.length === 0);

  const pa = await b.social.getProfiles([a.uid]);
  assert.equal(pa[a.uid].username, 'alex');
  assert.equal(pa[a.uid].stats.records['bankdruecken-lh'].w, 100);
  assert.equal((await a.social.getProfiles([b.uid]))[b.uid].stats.total, 9);
  // Private Trainingsdaten bleiben privat – auch für Freunde
  await denied(F.getDoc(F.doc(b.fs, 'users', a.uid)));
  await denied(F.getDocs(F.collection(b.fs, 'users', a.uid, 'sessions')));
  // Kennzahlen darf nur der Besitzer schreiben
  await denied(F.setDoc(F.doc(b.fs, 'publicProfiles', a.uid), { stats: {} }, { merge: true }));
  await a.social.publishStats({ ...STATS, total: 5 });
  assert.equal((await b.social.getProfiles([a.uid]))[a.uid].stats.total, 5);
  // Schon befreundet → keine neue Anfrage
  await denied(b.social.sendRequest(a.uid, { username: 'bea', photo: null }, { username: 'alex', photo: null }));

  // Entfernen beendet die Freundschaft auf beiden Seiten
  await b.social.removeFriend(a.uid);
  await waitFor(a.social, 'friends', (l) => l.length === 0);
  assert.deepEqual(await b.social.getProfiles([a.uid]), { [a.uid]: null });
  assert.deepEqual(await a.social.getProfiles([b.uid]), { [b.uid]: null });
});

test('Anfrage ablehnen und zurückziehen', async () => {
  const a = await user('dora');
  const b = await user('emil');
  await a.social.saveProfile({ username: 'dora', photo: null });
  await b.social.saveProfile({ username: 'emil', photo: null });

  await b.social.sendRequest(a.uid, { username: 'emil', photo: null }, { username: 'dora', photo: null });
  await waitFor(a.social, 'incoming', (l) => l.length === 1);
  await a.social.declineRequest(b.uid);
  await waitFor(a.social, 'incoming', (l) => l.length === 0);
  await waitFor(b.social, 'outgoing', (l) => l.length === 0);
  // Abgelehnt → keine Freundschaft möglich ohne neue Anfrage
  await denied(F.setDoc(F.doc(a.fs, 'users', b.uid, 'friends', a.uid), { since: 1 }));

  await a.social.sendRequest(b.uid, { username: 'dora', photo: null }, { username: 'emil', photo: null });
  await waitFor(b.social, 'incoming', (l) => l.length === 1);
  await a.social.cancelRequest(b.uid);
  await waitFor(b.social, 'incoming', (l) => l.length === 0);
});

test('Gegenseitige Anfragen: Annehmen räumt beide auf', async () => {
  const a = await user('fina');
  const b = await user('gero');
  await a.social.saveProfile({ username: 'fina', photo: null });
  await b.social.saveProfile({ username: 'gero', photo: null });
  await a.social.sendRequest(b.uid, { username: 'fina', photo: null }, { username: 'gero', photo: null });
  await b.social.sendRequest(a.uid, { username: 'gero', photo: null }, { username: 'fina', photo: null });
  await a.social.acceptRequest(b.uid, true);
  await waitFor(a.social, 'outgoing', (l) => l.length === 0);
  await waitFor(b.social, 'outgoing', (l) => l.length === 0);
  await waitFor(b.social, 'friends', (l) => l.length === 1);
});

test('Profilfoto: Upload in Storage, nur der Besitzer darf schreiben', async () => {
  const a = await user('hana');
  const b = await user('ines');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
  const url = await a.social.uploadPhoto(new Blob([jpeg], { type: 'image/jpeg' }));
  assert.match(url, /avatars%2F.+\.jpg\?.*alt=media/);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, jpeg.length);
  await a.social.saveProfile({ username: 'hana', photo: url });
  assert.equal((await b.social.lookup('hana')).photo, url); // Foto ist bei der Suche sichtbar
  // Fremdes Foto überschreiben, falscher Typ, zu groß → verboten
  await denied(S.uploadBytes(S.ref(b.st, 'avatars/' + a.uid + '.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await denied(S.uploadBytes(S.ref(b.st, 'avatars/' + b.uid + '.jpg'), jpeg, { contentType: 'text/html' }));
  await denied(S.uploadBytes(S.ref(b.st, 'avatars/' + b.uid + '.jpg'), new Uint8Array(2.1 * 1024 * 1024), { contentType: 'image/jpeg' }));
  // Riesige Foto-Texte im Profil werden abgelehnt
  await denied(b.social.saveProfile({ username: 'ines', photo: 'data:image/jpeg;base64,' + 'A'.repeat(310000) }));
});

test('Kontolöschung entfernt alles Soziale – auch beim Freund', async () => {
  const a = await user('jana');
  const b = await user('kai');
  const c = await user('lea');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const url = await a.social.uploadPhoto(new Blob([jpeg], { type: 'image/jpeg' }));
  await a.social.saveProfile({ username: 'jana', photo: url, stats: STATS });
  await b.social.saveProfile({ username: 'kai', photo: null });
  await c.social.saveProfile({ username: 'lea', photo: null });
  await b.social.sendRequest(a.uid, { username: 'kai', photo: null }, { username: 'jana', photo: url });
  await a.social.acceptRequest(b.uid, false);
  await c.social.sendRequest(a.uid, { username: 'lea', photo: null }, { username: 'jana', photo: url });
  await a.social.sendRequest(c.uid, { username: 'jana', photo: url }, { username: 'lea', photo: null }).catch(() => {});
  await waitFor(b.social, 'friends', (l) => l.length === 1);

  await a.social.deleteAll();

  assert.equal(await b.social.lookup('jana'), null);
  assert.equal(await b.social.isUsernameFree('jana'), true);
  await waitFor(b.social, 'friends', (l) => l.length === 0);
  await waitFor(c.social, 'outgoing', (l) => l.length === 0);
  await waitFor(c.social, 'incoming', (l) => l.length === 0);
  assert.notEqual((await fetch(url)).status, 200);
  await assert.rejects(S.getMetadata(S.ref(a.st, 'avatars/' + a.uid + '.jpg')), { code: 'storage/object-not-found' });
  assert.equal(await a.social.getMyProfile(), null);
});

test('Gesperrte Konten können keine Anfragen senden und keinen Namen belegen', async () => {
  const a = await user('mia');
  const b = await user('nils');
  await a.social.saveProfile({ username: 'mia', photo: null });
  // Sperre wie ein Administrator setzen (Emulator-Zugang am Regelwerk vorbei)
  await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/blocked/${b.uid}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { reason: { stringValue: 'Test' } } }),
  });
  await denied(b.social.saveProfile({ username: 'nils', photo: null }));
  await denied(F.setDoc(F.doc(b.fs, 'requests', b.uid + '_' + a.uid), { from: b.uid, to: a.uid, fromName: 'nils', fromPhoto: null, toName: 'mia', toPhoto: null, at: 1 }));
});
