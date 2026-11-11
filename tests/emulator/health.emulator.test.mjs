// Gesundheitsdaten (Apple Health per Kurzbefehl): Auswertung der Anfrage (functions/health.js) gegen den Firestore-Emulator,
// Sicherheitsregeln für healthTokens/Tageswerte und der Client (health-client.js). Ausführen: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { createHealth } from '../../health-client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = path.resolve(HERE, '../../functions');
const PROJECT = 'demo-gym';
const require = createRequire(path.join(FUNCTIONS, 'index.js'));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const { initializeApp: adminInit, getApp: adminApp, deleteApp: adminDelete } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { handleHealth, parseHealth, num, hashToken, tokenOf } = require('./health.js');

adminInit({ projectId: PROJECT });
const adb = getFirestore();
const apps = [];
test.after(async () => { await Promise.all(apps.map((a) => deleteApp(a).catch(() => {}))); await adminDelete(adminApp()); });

async function resetEmulators() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

const NOW = Date.parse('2026-11-11T10:00:00Z'); // Wien: 11. November, 11:00

test('Zahlen aus Kurzbefehlen: Komma und Tausenderpunkte, Grenzen, Rundung', () => {
  assert.equal(num('8.123', { integer: true }), 8123);
  assert.equal(num('1,234', { integer: true }), 1234);
  assert.equal(num(8123.6, { integer: true }), 8124);
  assert.equal(num('82,4', { min: 20, max: 500 }), 82.4);
  assert.equal(num('82.4', { min: 20, max: 500 }), 82.4);
  assert.equal(num('1.234,5'), 1234.5);
  assert.equal(num(' 7,25 ', { digits: 2 }), 7.25);
  assert.equal(num('82,4 kg', { min: 20, max: 500 }), 82.4);                                   // angehängte Einheit
  assert.equal(num('54 bpm', { integer: true }), 54);
  assert.equal(num('', {}), null);
  assert.equal(num('abc', {}), null);
  assert.equal(num(undefined, {}), null);
  assert.equal(num(NaN, {}), null);
  assert.equal(num(600, { min: 20, max: 500 }), null);
  assert.equal(num(-1, { min: 0 }), null);
});

test('Anfrage prüfen: Werte, Aliase, Datum, Tage, Training', () => {
  let r = parseHealth({ steps: '8.123', activeKcal: 512.4, restingHr: '54', sleepHours: '7,4', weightKg: '82,4',
    workouts: [{ type: 'Laufen', minutes: '42', km: '6,3', kcal: 410, avgHr: 152 }, { type: '', minutes: 5 }, { type: 'Yoga' }, null] }, NOW);
  assert.deepEqual(r.days, [{ day: '2026-11-11', fields: { steps: 8123, activeKcal: 512, restingHr: 54, sleepMin: 444, weightKg: 82.4,
    workouts: [{ type: 'Laufen', minutes: 42, km: 6.3, kcal: 410, avgHr: 152 }] } }]);
  assert.deepEqual(parseHealth({ date: '2026-11-09', sleepMin: 400, weight: 80 }, NOW).days, [{ day: '2026-11-09', fields: { sleepMin: 400, weightKg: 80 } }]);
  // Standard-Datum = heute in Wiener Zeit (23:30 UTC ist in Wien schon der nächste Tag)
  assert.equal(parseHealth({ steps: 1 }, Date.parse('2026-11-11T23:30:00Z')).days[0].day, '2026-11-12');
  assert.match(parseHealth({ date: '2026-11-13', steps: 1 }, NOW).error, /Zukunft/);
  assert.equal(parseHealth({ date: '2026-11-12', steps: 1 }, NOW).days[0].day, '2026-11-12');   // morgen ist erlaubt (Zeitzonen)
  assert.match(parseHealth({ date: '2024-01-01', steps: 1 }, NOW).error, /alt/);
  assert.match(parseHealth({ date: '11.11.2026', steps: 1 }, NOW).error, /JJJJ-MM-TT/);
  assert.match(parseHealth({ date: '2026-02-31', steps: 1 }, NOW).error, /JJJJ-MM-TT/);
  assert.match(parseHealth({ steps: -5 }, NOW).error, /Keine gültigen Werte/);
  assert.match(parseHealth({ steps: 'viele' }, NOW).error, /Keine gültigen Werte/);
  assert.match(parseHealth([1, 2], NOW).error, /JSON-Objekt/);
  assert.match(parseHealth('kein json', NOW).error, /JSON/);
  assert.equal(parseHealth('{"steps": 5}', NOW).days[0].fields.steps, 5);                      // Text mit JSON
  assert.match(parseHealth({ days: [] }, NOW).error, /leer/);
  assert.match(parseHealth({ days: Array.from({ length: 32 }, (_, i) => ({ date: '2026-10-' + String(i % 28 + 1).padStart(2, '0'), steps: 1 })) }, NOW).error, /31/);
  // derselbe Tag zweimal: spätere Werte gewinnen, andere bleiben
  r = parseHealth({ days: [{ date: '2026-11-10', steps: 100, restingHr: 50 }, { date: '2026-11-10', steps: 200 }, { date: '2026-11-11', steps: 5 }] }, NOW);
  assert.deepEqual(r.days, [{ day: '2026-11-10', fields: { steps: 200, restingHr: 50 } }, { day: '2026-11-11', fields: { steps: 5 } }]);
  // höchstens 10 Trainings
  assert.equal(parseHealth({ workouts: Array.from({ length: 15 }, () => ({ type: 'Gehen', minutes: 10 })) }, NOW).days[0].fields.workouts.length, 10);
});

test('Schlüssel aus Kopf oder Inhalt', () => {
  assert.equal(tokenOf({ authorization: 'Bearer abc123' }, {}), 'abc123');
  assert.equal(tokenOf({ authorization: 'bearer   xyz' }, {}), 'xyz');
  assert.equal(tokenOf({ 'x-api-key': 'key1' }, {}), 'key1');
  assert.equal(tokenOf({}, { token: 'im-inhalt' }), 'im-inhalt');
  assert.equal(tokenOf({}, {}), '');
  assert.equal(tokenOf({ authorization: 'Basic abc' }, null), '');
});

const KEY = 'ah_' + 'k'.repeat(43);
const serverTime = () => FieldValue.serverTimestamp();
const health = (uid, day) => adb.collection('users').doc(uid).collection('health').doc(day);

test('Empfang: gültiger Schlüssel schreibt die Tageswerte, spätere Anfragen ergänzen, falsche Schlüssel und Fehler schreiben nichts', async () => {
  await resetEmulators();
  await adb.collection('healthTokens').doc(hashToken(KEY)).set({ uid: 'u1', createdAt: new Date() });
  const send = (body, headers = { authorization: 'Bearer ' + KEY }) => handleHealth({ db: adb, headers, body, now: NOW, serverTime: serverTime() });

  let r = await send({ steps: 8123, activeKcal: 512, restingHr: 54, sleepHours: 7.4, workouts: [{ type: 'Laufen', minutes: 42, km: 6.3 }, { type: 'Yoga', minutes: 30 }] });
  assert.deepEqual([r.status, r.json], [200, { ok: true, days: ['2026-11-11'] }]);
  let d = (await health('u1', '2026-11-11').get()).data();
  assert.deepEqual({ ...d, updatedAt: undefined }, { day: '2026-11-11', steps: 8123, activeKcal: 512, restingHr: 54, sleepMin: 444, source: 'shortcut', updatedAt: undefined,
    workouts: [{ type: 'Laufen', minutes: 42, km: 6.3 }, { type: 'Yoga', minutes: 30 }] });
  assert.ok(d.updatedAt.toMillis() > 0);

  // zweite Anfrage am selben Tag: nur Gewicht → Schritte bleiben; Trainings werden ersetzt, wenn mitgeschickt
  r = await send({ weightKg: '82,4' });
  assert.equal(r.status, 200);
  d = (await health('u1', '2026-11-11').get()).data();
  assert.equal(d.steps, 8123);
  assert.equal(d.weightKg, 82.4);
  assert.equal(d.workouts.length, 2);
  await send({ workouts: [{ type: 'Radfahren', minutes: 60 }] });
  assert.deepEqual((await health('u1', '2026-11-11').get()).data().workouts, [{ type: 'Radfahren', minutes: 60 }]);

  // mehrere Tage auf einmal, Schlüssel auch per x-api-key bzw. im Inhalt
  r = await send({ days: [{ date: '2026-11-09', steps: 1000 }, { date: '2026-11-10', steps: 2000 }] }, { 'x-api-key': KEY });
  assert.deepEqual(r.json.days, ['2026-11-09', '2026-11-10']);
  r = await send({ token: KEY, date: '2026-11-08', steps: 3 }, {});
  assert.equal(r.status, 200);
  assert.equal((await health('u1', '2026-11-08').get()).data().steps, 3);

  // falscher/fehlender Schlüssel: 401 und nichts geschrieben
  for (const headers of [{}, { authorization: 'Bearer ' + 'x'.repeat(46) }, { authorization: 'Bearer zu-kurz' }]) {
    r = await send({ date: '2026-11-07', steps: 9 }, headers);
    assert.equal(r.status, 401);
  }
  assert.equal((await health('u1', '2026-11-07').get()).exists, false);
  // ungültige Werte: 400, nichts geschrieben (auch nicht die gültigen Tage der Anfrage)
  r = await send({ days: [{ date: '2026-11-06', steps: 5 }, { date: '2026-12-31', steps: 5 }] });
  assert.equal(r.status, 400);
  assert.equal((await health('u1', '2026-11-06').get()).exists, false);
});

// ---------- Sicherheitsregeln und Client ----------

async function user(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: PROJECT + '.firebaseapp.com' }, name + Math.random());
  apps.push(app);
  const auth = A.getAuth(app);
  A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fs = F.getFirestore(app);
  F.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  const cred = await A.createUserWithEmailAndPassword(auth, name + '@test.de', 'geheim123');
  return { uid: cred.user.uid, auth, fs, health: createHealth({ F, fs, auth, cfg: { projectId: PROJECT, useEmulator: true } }) };
}
async function denied(p) {
  await assert.rejects(p, (e) => /permission|unauthorized/i.test(e.code || '') || /PERMISSION_DENIED/.test(e.message));
}
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

test('Schlüssel: neu erzeugen macht den alten ungültig, nur das eigene Konto sieht und löscht ihn, Klartext steht nirgends', async () => {
  await resetEmulators();
  const ann = await user('ann');
  const ben = await user('ben');
  assert.equal(await ann.health.hasKey(), false);

  const k1 = await ann.health.createKey();
  assert.match(k1, /^ah_[A-Za-z0-9_-]{43}$/);
  assert.equal(await ann.health.hasKey(), true);
  const doc1 = await adb.collection('healthTokens').doc(await sha(k1)).get();
  assert.equal(doc1.data().uid, ann.uid);
  assert.deepEqual(Object.keys(doc1.data()).sort(), ['createdAt', 'uid']);                                  // kein Klartext, nur uid und Zeit

  const k2 = await ann.health.createKey();                                                                   // neuer Schlüssel ersetzt den alten
  assert.notEqual(k1, k2);
  assert.equal((await adb.collection('healthTokens').doc(await sha(k1)).get()).exists, false);
  assert.equal((await adb.collection('healthTokens').doc(await sha(k2)).get()).exists, true);
  assert.equal((await adb.collection('healthTokens').get()).size, 1);

  // ben: kein Zugriff auf fremde Schlüssel, nichts im Namen anderer anlegen, nur gültige ID und Felder
  const ref = (id) => F.doc(ben.fs, 'healthTokens', id);
  await denied(F.getDoc(ref(await sha(k2))));
  await denied(F.deleteDoc(ref(await sha(k2))));
  await denied(F.setDoc(ref(await sha('x1')), { uid: ann.uid, createdAt: F.serverTimestamp() }));            // fremdes Konto
  await denied(F.setDoc(ref('kurz'), { uid: ben.uid, createdAt: F.serverTimestamp() }));                     // ID kein SHA-256
  await denied(F.setDoc(ref(await sha('x2')), { uid: ben.uid, createdAt: F.serverTimestamp(), extra: 1 })); // fremdes Feld
  await denied(F.setDoc(ref(await sha('x3')), { uid: ben.uid, createdAt: 5 }));                             // keine Serverzeit
  await F.setDoc(ref(await sha('x4')), { uid: ben.uid, createdAt: F.serverTimestamp() });                  // eigener Schlüssel geht
  assert.equal(await ben.health.hasKey(), true);
  await denied(F.setDoc(ref(await sha('x4')), { uid: ben.uid, createdAt: F.serverTimestamp() }));          // vorhandenen nicht überschreiben

  await ann.health.removeKeys();
  assert.equal(await ann.health.hasKey(), false);
  assert.equal(await ben.health.hasKey(), true);                                                            // ben bleibt unberührt
});

test('Tageswerte: nur das eigene Konto liest sie (live, neueste zuerst); Konto löschen entfernt Schlüssel und Werte; Adresse der Funktion', async () => {
  await resetEmulators();
  const ann = await user('ann2');
  const ben = await user('ben2');
  for (const [day, steps] of [['2026-11-09', 100], ['2026-11-10', 200], ['2026-11-11', 300]]) {
    await adb.collection('users').doc(ann.uid).collection('health').doc(day).set({ day, steps, restingHr: 55, workouts: [{ type: 'Laufen', minutes: 30 }, { nope: 1 }], updatedAt: new Date() });
  }
  const list = await new Promise((resolve, reject) => {
    const stop = ann.health.watch(2, (l, meta) => { if (!meta.fromCache) { stop(); resolve(l); } }, reject);
  });
  assert.deepEqual(list.map((d) => [d.day, d.steps]), [['2026-11-11', 300], ['2026-11-10', 200]]);          // zwei neueste, neueste zuerst
  assert.deepEqual(list[0].workouts, [{ type: 'Laufen', minutes: 30 }]);                                    // ungültige Trainings fallen weg
  assert.ok(list[0].updatedAt > 0);
  await denied(F.getDocs(F.collection(ben.fs, 'users', ann.uid, 'health')));
  await denied(F.setDoc(F.doc(ben.fs, 'users', ann.uid, 'health', '2026-11-12'), { day: '2026-11-12', steps: 1 }));

  await ann.health.createKey();
  await ann.health.deleteAll(ann.uid);
  assert.equal((await adb.collection('healthTokens').get()).size, 0);
  assert.equal((await adb.collection('users').doc(ann.uid).collection('health').get()).size, 0);

  assert.equal(ann.health.endpoint(), `http://127.0.0.1:5001/${PROJECT}/europe-west3/healthIngest`);
  const prod = createHealth({ F, fs: ann.fs, auth: ann.auth, cfg: { projectId: 'mein-projekt', functionsRegion: 'us-central1' } });
  assert.equal(prod.endpoint(), 'https://us-central1-mein-projekt.cloudfunctions.net/healthIngest');
});
