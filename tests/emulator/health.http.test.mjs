// Die Funktion healthIngest über HTTP im Functions-Emulator: Kopf, Inhalt, Statuscodes, Eintrag in Firestore.
// Ausführen (einmalig `npm install` hier und in ../../functions):  npm run test:functions
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const FUNCTIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../functions');
const require = createRequire(path.join(FUNCTIONS, 'index.js'));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const { initializeApp, getApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { hashToken, viennaDay } = require('./health.js');

initializeApp({ projectId: 'demo-gym' });
const db = getFirestore();
test.after(async () => { await deleteApp(getApp()); });

const URL_ = 'http://127.0.0.1:5001/demo-gym/europe-west3/healthIngest';
const KEY = 'ah_' + 'h'.repeat(43);
const post = (body, headers = {}) => fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { await fetch(URL_, { method: 'GET' }); return; } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error('Functions-Emulator antwortet nicht');
}

test('healthIngest über HTTP: Schlüssel im Kopf, JSON und Text, Fehlercodes, Werte landen unter users/{uid}/health', async () => {
  await waitUp();
  await db.collection('healthTokens').doc(hashToken(KEY)).set({ uid: 'httpuser', createdAt: new Date() });

  let res = await post({ steps: 4321, restingHr: 52, sleepHours: 6.5, weightKg: '81,9', workouts: [{ type: 'Laufen', minutes: 35, km: 5.2 }] });
  assert.equal(res.status, 200);
  const today = viennaDay(Date.now());
  assert.deepEqual(await res.json(), { ok: true, days: [today] });
  const d = (await db.collection('users').doc('httpuser').collection('health').doc(today).get()).data();
  assert.deepEqual([d.steps, d.restingHr, d.sleepMin, d.weightKg, d.source, d.workouts.length], [4321, 52, 390, 81.9, 'shortcut', 1]);

  // Kurzbefehle senden manchmal Text statt JSON-Typ
  res = await post('{"date":"2026-01-05","steps":77}', { 'Content-Type': 'text/plain' });
  assert.equal(res.status, 200);
  assert.equal((await db.collection('users').doc('httpuser').collection('health').doc('2026-01-05').get()).data().steps, 77);

  // Fehler
  assert.equal((await post({ steps: 1 }, { Authorization: 'Bearer ' + 'z'.repeat(46) })).status, 401);
  assert.equal((await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"steps":1}' })).status, 401);
  res = await post({ steps: 'viele' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Keine gültigen Werte/);
  res = await fetch(URL_, { method: 'GET' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
