// Push-Mitteilungen bei geschlossener App: Server-Logik (functions/push.js) gegen den Firestore-Emulator
// und die Sicherheitsregeln für pushDevices. Ausführen (einmalig `npm install` hier und in ../../functions): npm test
// FCM selbst gibt es im Emulator nicht: Der Versand wird durch ein Platzhalter-Objekt ersetzt, das die Aufrufe mitschreibt.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { createSocial } from '../../social.js';
import { createPush } from '../../push-client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = path.resolve(HERE, '../../functions');
const PROJECT = 'demo-gym';
const require = createRequire(path.join(FUNCTIONS, 'index.js'));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const { initializeApp: adminInit, getApp: adminApp, deleteApp: adminDelete } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { deliver, describe, chooseDevices, whenLabel, isDeadToken } = require('./push.js');

adminInit({ projectId: PROJECT });
const adb = getFirestore();

async function resetEmulators() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Platzhalter für admin.messaging(): schreibt die Aufrufe mit; Tokens, die mit „dead“ beginnen, gelten als abgemeldet. */
function fakeMessaging() {
  const calls = [];
  return {
    calls,
    async sendEachForMulticast(m) {
      calls.push(m);
      const responses = m.tokens.map((t) => (t.startsWith('dead')
        ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
        : { success: true }));
      return { successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length, responses };
    },
  };
}

const device = (uid, token, extra = {}) => ({ uid, token, chat: true, blocked: [], platform: 'ios', ...extra });
const put = (id, d) => adb.collection('pushDevices').doc(id).set(d);
const text = (uid, name, t) => ({ uid, name, kind: 'text', text: t });
const NOW = Date.parse('2026-11-12T10:00:00Z');

test('Texte: Heute/Morgen/Wochentag in Wiener Zeit, Nachricht gekürzt, nichts für leere Nachrichten', () => {
  assert.equal(whenLabel(Date.parse('2026-11-12T17:00:00Z'), NOW), 'Heute, 18:00 Uhr');       // Winterzeit: UTC+1
  assert.equal(whenLabel(Date.parse('2026-11-13T16:30:00Z'), NOW), 'Morgen, 17:30 Uhr');
  assert.equal(whenLabel(Date.parse('2026-11-14T08:00:00Z'), NOW), 'Sa., 14.11., 09:00 Uhr');
  assert.equal(whenLabel(Date.parse('2026-11-12T22:30:00Z'), NOW), 'Heute, 23:30 Uhr');       // Tageswechsel nach Wiener Zeit, nicht nach UTC
  assert.equal(whenLabel(Date.parse('2026-11-12T23:30:00Z'), NOW), 'Morgen, 00:30 Uhr');
  const long = describe({ room: 'gym', msg: text('u1', 'anna', 'x'.repeat(300)), group: null, now: NOW });
  assert.equal(long.body, '@anna: ' + 'x'.repeat(119) + '…');
  assert.equal(describe({ room: 'gym', msg: text('u1', 'anna', '   '), group: null, now: NOW }), null);
  assert.equal(describe({ room: 'gym', msg: { uid: 'u1', name: 'anna', kind: 'x' }, group: null, now: NOW }), null);
  assert.equal(isDeadToken({ code: 'messaging/registration-token-not-registered' }), true);
  assert.equal(isDeadToken({ code: 'messaging/internal-error' }), false);
  assert.equal(isDeadToken({ code: 'messaging/invalid-argument', message: 'The registration token is not a valid FCM registration token' }), true);
  assert.equal(isDeadToken({ code: 'messaging/invalid-argument', message: 'Invalid JSON payload' }), false);
});

test('Empfänger: nicht der Absender, nur mit Schalter an, keine Blockierer, keine doppelten Tokens', () => {
  const devices = [
    device('a', 'tok-a'), device('b', 'tok-b'), device('c', 'tok-c', { chat: false }), device('d', 'tok-d', { blocked: ['a'] }),
    device('e', 'tok-b'), device('f', 'tok-f', { blocked: ['x'] }), { uid: 'g', token: '', chat: true },
  ];
  assert.deepEqual(chooseDevices(devices, { senderUid: 'a', members: null }).map((d) => d.token), ['tok-b', 'tok-f']);
  assert.deepEqual(chooseDevices(devices, { senderUid: 'a', members: ['a', 'b', 'c'] }).map((d) => d.token), ['tok-b']);
});

test('Gym-Chat: alle Geräte mit Schalter an; Gruppe: nur Mitglieder; Direktchat; Gym-Karte; abgemeldete Geräte werden entfernt', async () => {
  await resetEmulators();
  await Promise.all([
    put('dev-a', device('ua', 'tok-a')), put('dev-b', device('ub', 'tok-b')), put('dev-b2', device('ub', 'tok-b2')),
    put('dev-c', device('uc', 'tok-c', { chat: false })), put('dev-d', device('ud', 'tok-d', { blocked: ['ua'] })),
    put('dev-e', device('ue', 'tok-e')), put('dev-dead', device('uf', 'dead-f')),
  ]);
  await adb.collection('groups').doc('g1').set({ kind: 'group', name: 'Push-Team', owner: 'ua', memberIds: ['ua', 'ub', 'uc', 'ud'], memberNames: {} });
  await adb.collection('groups').doc('dm_ua_ub').set({ kind: 'dm', name: '', owner: 'ua', memberIds: ['ua', 'ub'], memberNames: {} });

  // Gym-Chat
  let m = fakeMessaging();
  let r = await deliver({ db: adb, messaging: m, room: 'gym', msg: text('ua', 'anna', 'Wer ist heute dabei?'), now: NOW });
  assert.equal(m.calls.length, 1);
  assert.deepEqual(m.calls[0].tokens.slice().sort(), ['dead-f', 'tok-b', 'tok-b2', 'tok-e']);   // nicht ua (Absender), uc (Schalter aus), ud (blockiert)
  assert.deepEqual(m.calls[0].data, { title: 'Gym-Chat', body: '@anna: Wer ist heute dabei?', tag: 'chat-gym', url: '#/chat/gym' });
  assert.deepEqual(m.calls[0].webpush.headers, { TTL: '86400', Urgency: 'high' });
  assert.deepEqual({ sent: r.sent, failed: r.failed, removed: r.removed }, { sent: 3, failed: 1, removed: 1 });
  assert.equal((await adb.collection('pushDevices').doc('dev-dead').get()).exists, false);       // abgemeldetes Gerät aufgeräumt
  assert.equal((await adb.collection('pushDevices').doc('dev-b').get()).exists, true);

  // Gruppe: nur Mitglieder (ub, uc mit Schalter aus, ud blockiert den Absender) – ue ist kein Mitglied
  m = fakeMessaging();
  await deliver({ db: adb, messaging: m, room: '@g1', msg: text('ua', 'anna', 'Heute Beine'), now: NOW });
  assert.deepEqual(m.calls[0].tokens.slice().sort(), ['tok-b', 'tok-b2']);
  assert.deepEqual(m.calls[0].data, { title: 'Push-Team', body: '@anna: Heute Beine', tag: 'chat-@g1', url: '#/chat/g/g1' });

  // Direktchat: der Tipp öffnet den Chat mit dem Absender
  m = fakeMessaging();
  await deliver({ db: adb, messaging: m, room: '@dm_ua_ub', msg: text('ua', 'anna', 'Hi Ben'), now: NOW });
  assert.deepEqual(m.calls[0].tokens.slice().sort(), ['tok-b', 'tok-b2']);
  assert.deepEqual(m.calls[0].data, { title: 'Neue Nachricht', body: '@anna: Hi Ben', tag: 'chat-@dm_ua_ub', url: '#/chat/dm/ua' });

  // Gym-Karte
  m = fakeMessaging();
  await deliver({ db: adb, messaging: m, room: 'gym', msg: { uid: 'ub', name: 'ben', kind: 'gym', when: Date.parse('2026-11-12T17:00:00Z'), workout: 'push', note: '' }, now: NOW });
  assert.equal(m.calls[0].data.title, 'Neuer Gym-Besuch');
  assert.equal(m.calls[0].data.body, '@ben: Heute, 18:00 Uhr · Push');
  assert.ok(!m.calls[0].tokens.includes('tok-b'));

  // Absender kein Mitglied / Gruppe gibt es nicht → nichts
  m = fakeMessaging();
  assert.equal((await deliver({ db: adb, messaging: m, room: '@g1', msg: text('ue', 'eva', 'rein'), now: NOW })).sent, 0);
  assert.equal((await deliver({ db: adb, messaging: m, room: '@gibtesnicht', msg: text('ua', 'anna', 'x'), now: NOW })).sent, 0);
  assert.equal(m.calls.length, 0);
});

test('Viele Geräte: Versand in Paketen zu höchstens 500', async () => {
  await resetEmulators();
  for (let i = 0; i < 1001; i += 500) {
    const batch = adb.batch();
    for (let k = i; k < Math.min(i + 500, 1001); k++) batch.set(adb.collection('pushDevices').doc('d' + k), device('u' + k, 'tok-' + k));
    await batch.commit();
  }
  const m = fakeMessaging();
  const r = await deliver({ db: adb, messaging: m, room: 'gym', msg: text('u0', 'anna', 'hallo'), now: NOW });
  assert.deepEqual(m.calls.map((c) => c.tokens.length), [500, 500]);   // 1001 Geräte, davon eines des Absenders
  assert.equal(r.sent, 1000);
});

// ---------- Sicherheitsregeln ----------

const apps = [];
test.after(async () => { await Promise.all(apps.map((a) => deleteApp(a).catch(() => {}))); await adminDelete(adminApp()); });
async function user(name, profile = true) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: PROJECT + '.firebaseapp.com' }, name + Math.random());
  apps.push(app);
  const auth = A.getAuth(app);
  A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fs = F.getFirestore(app);
  F.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  const cred = await A.createUserWithEmailAndPassword(auth, name + '@test.de', 'geheim123');
  if (profile) await createSocial({ F, fs, auth, storage: null }).saveProfile({ username: name, photo: null });
  return { uid: cred.user.uid, auth, fs, name };
}
async function denied(p) {
  await assert.rejects(p, (e) => /permission|unauthorized/i.test(e.code || '') || /PERMISSION_DENIED/.test(e.message));
}
const mine = (u, over = {}) => ({ uid: u.uid, token: 'x'.repeat(60) + u.name, chat: true, blocked: [], platform: 'ios', updatedAt: F.serverTimestamp(), ...over });

test('Regeln: nur eigene Geräte, nur mit Profil, nur gültige Felder; ein neues Konto auf demselben Gerät übernimmt den Eintrag', async () => {
  await resetEmulators();
  const ann = await user('ann');
  const ben = await user('ben');
  const noProfile = await user('ohne', false);
  const ref = (u, id) => F.doc(u.fs, 'pushDevices', id);

  await F.setDoc(ref(ann, 'dev1'), mine(ann));                                                   // eigenes Gerät eintragen
  assert.equal((await F.getDoc(ref(ann, 'dev1'))).data().chat, true);
  await F.setDoc(ref(ann, 'dev1'), mine(ann, { chat: false, blocked: [ben.uid] }));              // aktualisieren
  await denied(F.setDoc(ref(ann, 'dev2'), mine(ann, { uid: ben.uid })));                          // nicht für ein fremdes Konto
  await denied(F.setDoc(ref(noProfile, 'dev3'), mine(noProfile)));                                // ohne Profil kein Chat → keine Mitteilungen
  await denied(F.setDoc(ref(ann, 'dev4'), { ...mine(ann), extra: 1 }));                           // nur bekannte Felder
  await denied(F.setDoc(ref(ann, 'dev5'), mine(ann, { token: 'kurz' })));                         // Token zu kurz
  await denied(F.setDoc(ref(ann, 'dev6'), mine(ann, { chat: 'ja' })));                            // Schalter ist ein Wahrheitswert
  await denied(F.setDoc(ref(ann, 'dev7'), mine(ann, { updatedAt: 123 })));                        // Serverzeit
  await denied(F.getDoc(ref(ben, 'dev1')));                                                       // fremdes Gerät nicht lesbar
  await denied(F.deleteDoc(ref(ben, 'dev1')));                                                    // … und nicht löschbar

  // Konto wechselt auf demselben Gerät: ben trägt denselben Token ein → Eintrag gehört jetzt ben
  await F.setDoc(ref(ben, 'dev1'), mine(ben));
  await denied(F.getDoc(ref(ann, 'dev1')));
  assert.equal((await F.getDoc(ref(ben, 'dev1'))).data().uid, ben.uid);

  // push-client: eigene Geräte abfragen und alle löschen (Konto löschen)
  await F.setDoc(ref(ben, 'dev8'), mine(ben));
  const cfg = { useEmulator: true };
  const push = createPush({ SDK: '', app: apps[1], auth: ben.auth, F, fs: ben.fs, cfg });
  await push.deleteAll(ben.uid);
  const left = await adb.collection('pushDevices').get();
  assert.equal(left.size, 0);
});
