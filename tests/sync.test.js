// Tests für den Cloud-Abgleich mit einem simulierten Server und mehreren "Geräten".
// Ausführen mit: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, Sync, createSyncEngine } = require('../app.js');

const T0 = new Date('2026-09-01T10:00:00').getTime();
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/** Kopie mit umgekehrter Schlüsselreihenfolge – wie ein Server, der die Reihenfolge nicht erhält. */
function reorder(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reorder);
  const out = {};
  for (const k of Object.keys(v).reverse()) if (v[k] !== undefined) out[k] = reorder(v[k]);
  return out;
}

/**
 * Simulierter Firestore: Hauptdokument (Felder days/settings/activeSession) + Sammlungen
 * "sessions" und "body". Offline gesammelte Schreibvorgänge werden – wie bei Firestore –
 * beim Wiederverbinden "blind" angewendet.
 */
const MAIN = { 'main.days': 'days', 'main.settings': 'settings', 'main.active': 'activeSession', 'main.customex': 'customExercises', 'main.libmeta': 'libMeta' };

class FakeServer {
  constructor() { this.main = null; this.sessions = new Map(); this.body = new Map(); this.nutrition = new Map(); this.foods = new Map(); this.clients = new Set(); this.writes = 0; }
  broadcast() { for (const c of this.clients) c.deliver(); }
}

class FakeClient {
  constructor(server) {
    this.server = server;
    this.online = true;
    this.queue = [];
    this.subs = null;
    this.failNext = 0;
    server.clients.add(this);
    this.adapter = {
      subscribe: (handlers) => {
        this.subs = handlers;
        setImmediate(() => this.deliver());
        return () => { this.subs = null; };
      },
      confirmMissing: () => Promise.resolve(this.server.main === null),
      commit: (ops) => new Promise((resolve, reject) => {
        if (this.failNext > 0) { this.failNext--; setImmediate(() => reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }))); return; }
        this.queue.push({ ops: JSON.parse(JSON.stringify(ops)), resolve });
        this.flush();
      }),
    };
  }
  flush() {
    if (!this.online || !this.queue.length) return;
    const srv = this.server;
    while (this.queue.length) {
      const { ops, resolve } = this.queue.shift();
      for (const op of ops) {
        srv.writes++;
        if (op.key in MAIN) srv.main = { ...(srv.main || {}), [MAIN[op.key]]: op.data === null ? null : reorder(op.data) };
        else if (op.key === 'main') srv.main = null;
        else {
          const [col, id] = op.key.startsWith('body:') ? [srv.body, op.key.slice(5)]
            : op.key.startsWith('nutrition:') ? [srv.nutrition, op.key.slice(10)]
            : op.key.startsWith('food:') ? [srv.foods, op.key.slice(5)]
            : [srv.sessions, op.key.slice(8)];
          if (op.data) col.set(id, reorder(op.data)); else col.delete(id);
        }
      }
      setImmediate(resolve);
    }
    setImmediate(() => srv.broadcast());
  }
  /** Wie Firestore mit includeMetadataChanges: nur "saubere" Server-Stände ohne eigene offene Schreibvorgänge. */
  deliver() {
    if (!this.online || !this.subs || this.queue.length) return;
    const clone = (x) => (x ? reorder(JSON.parse(JSON.stringify(x))) : null);
    const list = (m) => [...m].map(([id, data]) => ({ id, data: clone(data) }));
    const subs = this.subs;
    subs.main(clone(this.server.main));
    if (this.subs) subs.sessions(list(this.server.sessions));
    if (this.subs) subs.body(list(this.server.body));
    if (this.subs) subs.nutrition(list(this.server.nutrition));
    if (this.subs) subs.foods(list(this.server.foods));
  }
  setOnline(v) {
    this.online = v;
    if (v) { this.flush(); setImmediate(() => this.deliver()); }
  }
}

function device(server, db, initialBase) {
  const client = new FakeClient(server);
  let base = initialBase || null;
  const d = { db, client, remoteChanges: 0, statuses: [], gone: 0 };
  d.engine = createSyncEngine({
    adapter: client.adapter,
    getDb: () => d.db,
    loadBase: () => base,
    saveBase: (b) => { base = JSON.parse(JSON.stringify(b)); },
    onRemoteChange: () => { d.remoteChanges++; },
    onStatus: (s) => d.statuses.push(s.status),
    onGone: () => { d.gone++; },
    pushDelay: 0,
    retryDelay: 30,
  });
  d.change = () => d.engine.schedule(0);
  return d;
}

/** Erstes Gerät eines neuen Kontos: startet leer, legt dann selbst Trainingstage an. */
async function firstDevice(server) {
  const A = device(server, Core.emptyData());
  A.engine.start();
  await settle();
  A.db.days = Core.sampleDays();
  A.change();
  await settle();
  return A;
}

/** Vergleichbarer Stand eines Geräts. */
const snapshot = (db) => Sync.stableStringify({ main: Sync.mainOf(db), sessions: db.sessions });

function finishSession(db, dayId, t, kg) {
  const s = Core.startSession(db, dayId, t);
  const se = s.exercises[0];
  Core.updateSet(db, se.id, se.sets[0].id, 'weight', kg);
  Core.updateSet(db, se.id, se.sets[0].id, 'reps', 8);
  return Core.finishSession(db, t + 3600000);
}

/* ---------- Grundfunktionen ---------- */

test('stableStringify und Hash sind unabhängig von der Schlüsselreihenfolge', () => {
  const a = { b: 1, a: [{ y: 2, x: null }], c: undefined };
  const b = { a: [{ x: null, y: 2 }], b: 1 };
  assert.equal(Sync.stableStringify(a), Sync.stableStringify(b));
  assert.equal(Sync.hashOf(a), Sync.hashOf(b));
  assert.notEqual(Sync.hashOf(a), Sync.hashOf({ ...b, b: 2 }));
  assert.equal(Sync.hashOf(null), null);
});

test('hasUserContent erkennt unveränderte Beispieldaten', () => {
  const db = Core.sampleData();
  assert.equal(Sync.hasUserContent(db), false);
  Core.addExercise(db, db.days[0].id, 'Dips', 90);
  assert.equal(Sync.hasUserContent(db), true);
  assert.equal(Sync.hasUserContent(Core.emptyData()), false);
});

/* ---------- Abgleich zwischen Geräten ---------- */

test('Neues Konto startet ohne Trainingstage, zweites Gerät übernimmt alles', async () => {
  const server = new FakeServer();
  const A = device(server, Core.emptyData());
  A.engine.start();
  await settle();
  assert.equal(A.db.days.length, 0, 'keine vorgegebenen Trainingstage');
  assert.deepEqual(server.main.days, []);
  assert.equal(A.engine.state.status, 'synced');

  const day = Core.addDay(A.db, 'Oberkörper');
  Core.addExercise(A.db, day.id, 'Bankdrücken', 120, 4);
  A.change();
  await settle();
  assert.equal(server.main.days[0].exercises[0].sets, 4, 'Satzanzahl liegt in der Cloud');

  finishSession(A.db, day.id, T0, 80);
  A.change();
  await settle();
  assert.equal(server.sessions.size, 1);

  const writesBefore = server.writes;
  const B = device(server, Core.emptyData());
  B.engine.start();
  await settle();
  assert.equal(snapshot(B.db), snapshot(A.db));
  assert.ok(B.remoteChanges > 0);
  assert.equal(server.writes, writesBefore, 'neues Gerät schreibt nichts zurück');
  assert.equal(B.engine.pending(), false);
});

test('Änderungen und Löschungen kommen auf dem anderen Gerät an', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  const B = device(server, Core.emptyData());
  B.engine.start(); await settle();

  Core.renameDay(A.db, A.db.days[0].id, 'Push A');
  const s1 = finishSession(A.db, A.db.days[0].id, T0, 80);
  finishSession(A.db, A.db.days[0].id, T0 + 86400000, 82.5);
  A.change(); await settle();
  assert.equal(B.db.days[0].name, 'Push A');
  assert.equal(B.db.sessions.length, 2);

  Core.deleteSession(B.db, s1.id);
  B.change(); await settle();
  assert.equal(server.sessions.size, 1);
  assert.equal(A.db.sessions.length, 1);
  assert.equal(snapshot(A.db), snapshot(B.db));
});

test('Offline-Änderungen werden nachgeholt, beide Geräte gleichen sich an', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  const B = device(server, Core.emptyData());
  B.engine.start(); await settle();

  B.client.setOnline(false);
  Core.renameDay(B.db, B.db.days[1].id, 'Rücken');
  B.change();
  finishSession(A.db, A.db.days[0].id, T0, 90);
  A.change();
  await settle();
  assert.equal(server.main.days[1].name, 'Pull', 'offline noch nicht angekommen');
  assert.equal(B.engine.pending(), true);
  assert.equal(B.db.sessions.length, 0);

  B.client.setOnline(true);
  await settle(150);
  assert.equal(server.main.days[1].name, 'Rücken');
  assert.equal(B.db.sessions.length, 1);
  assert.equal(A.db.days[1].name, 'Rücken');
  assert.equal(snapshot(A.db), snapshot(B.db));
  assert.equal(B.engine.pending(), false);
});

test('Laufendes Training: eigene Echos überschreiben keine neueren Eingaben', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  const s = Core.startSession(A.db, A.db.days[0].id, T0);
  const se = s.exercises[0];
  A.change();
  const before = A.remoteChanges;
  for (let i = 1; i <= 10; i++) {
    Core.updateSet(A.db, se.id, se.sets[0].id, 'weight', String(60 + i));
    A.change();
    await settle(3);
  }
  await settle();
  assert.equal(A.db.activeSession.exercises[0].sets[0].weight, 70);
  assert.equal(server.main.activeSession.exercises[0].sets[0].weight, 70);
  assert.equal(A.remoteChanges, before, 'keine Server-Stände übernommen');
});

test('Neues Gerät überschreibt ein bestehendes Konto nicht, sondern führt zusammen', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  finishSession(A.db, A.db.days[0].id, T0, 80);
  A.change(); await settle();

  // Gerät C hatte ohne Konto eigene Daten: Beispieltage (andere IDs!) + eigener Tag + Einheit
  const guest = Core.sampleData();
  const arme = Core.addDay(guest, 'Arme');
  Core.addExercise(guest, arme.id, 'Bizepscurls', 60);
  Core.addExercise(guest, guest.days[0].id, 'Dips', 90); // "Push" bekommt eine neue Übung
  const gs = finishSession(guest, guest.days[0].id, T0 - 86400000, 70);
  const C = device(server, Sync.mergeGuest(Core.emptyData(), guest));
  C.client.setOnline(false);
  C.engine.start();
  await settle();
  assert.equal(server.main.days.length, 3, 'offline & vor dem ersten Lesen: Server unverändert');

  C.client.setOnline(true);
  await settle(150);
  const names = server.main.days.map((d) => d.name);
  assert.deepEqual(names, ['Push', 'Pull', 'Beine', 'Arme'], 'keine doppelten Tage');
  const push = server.main.days[0];
  assert.ok(push.exercises.some((e) => e.name === 'Dips'), 'neue Übung ergänzt');
  assert.equal(server.sessions.size, 2);
  assert.equal(server.sessions.get(gs.id).dayId, push.id, 'Einheit zeigt auf den zusammengeführten Tag');
  assert.equal(snapshot(A.db), snapshot(C.db));
  assert.equal(Core.lastTrained(C.db, push.id), T0 + 3600000);
});

test('Gleichzeitige Änderung desselben Dokuments: lokale Änderung gewinnt, beide gleich', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  const B = device(server, Core.emptyData());
  B.engine.start(); await settle();
  A.client.setOnline(false);
  Core.renameDay(A.db, A.db.days[0].id, 'Von A');
  A.change();
  Core.renameDay(B.db, B.db.days[0].id, 'Von B');
  B.change();
  await settle();
  A.client.setOnline(true);
  await settle(150);
  assert.equal(snapshot(A.db), snapshot(B.db));
  assert.equal(A.db.days[0].name, 'Von A', 'zuletzt geschrieben gewinnt');
});

test('Fehler beim Schreiben werden automatisch wiederholt', async () => {
  const server = new FakeServer();
  const A = device(server, Core.emptyData());
  A.client.failNext = 2;
  A.engine.start();
  await settle(200);
  assert.ok(A.statuses.includes('error'));
  assert.ok(server.main, 'nach Fehlern doch geschrieben');
  assert.equal(server.main.days.length, 0);
  assert.equal(A.engine.state.status, 'synced');
});

test('Konto auf anderem Gerät gelöscht: nichts neu anlegen, App wird informiert', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  assert.equal(A.gone, 0);
  // Konto wird woanders gelöscht: alle Dokumente verschwinden
  server.main = null;
  server.sessions.clear();
  server.broadcast();
  await settle();
  assert.equal(A.gone, 1);
  assert.equal(server.main, null, 'nicht wieder angelegt');
});

test('Import/Zurücksetzen ersetzt auch die Cloud-Daten', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  finishSession(A.db, A.db.days[0].id, T0, 80);
  A.change(); await settle();
  A.db = Core.emptyData(); // "Alle Daten löschen"
  A.change(); await settle();
  assert.equal(server.sessions.size, 0);
  assert.equal(server.main.days.length, 0);
  A.engine.stop();
});

test('Körpermessungen, RIR und eigene Reihenfolge werden zwischen Geräten abgeglichen', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  const B = device(server, Core.emptyData());
  B.engine.start(); await settle();

  Core.saveBodyEntry(A.db, { date: T0, weight: 82.4, waist: 85 });
  const s = Core.startSession(A.db, A.db.days[0].id, T0);
  Core.moveSessionExercise(A.db, s.exercises[2].id, 'up');
  Core.updateSet(A.db, s.exercises[0].id, s.exercises[0].sets[0].id, 'rir', '2');
  A.change(); await settle();
  assert.equal(B.db.body.length, 1);
  assert.equal(B.db.body[0].weight, 82.4);
  assert.equal(B.db.activeSession.customOrder, true);
  assert.equal(B.db.activeSession.exercises[0].sets[0].rir, 2);
  assert.equal(snapshot(A.db), snapshot(B.db));

  Core.deleteBodyEntry(B.db, B.db.body[0].id);
  B.change(); await settle();
  assert.equal(A.db.body.length, 0);
});

test('Offline-Änderung auf einem Gerät löscht nicht das laufende Training auf dem anderen', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);             // Handy
  const B = device(server, Core.emptyData());      // iPad
  B.engine.start(); await settle();
  B.client.setOnline(false);
  Core.saveBodyEntry(B.db, { date: T0, weight: 80 });  // iPad offline: Körpergewicht
  Core.setRepTarget(B.db, B.db.days[1].id, B.db.days[1].exercises[0].id, 6, 8); // … und Plan geändert
  B.change(); await settle();
  Core.startSession(A.db, A.db.days[0].id, T0);         // Handy: Training läuft
  A.change(); await settle();
  B.client.setOnline(true); await settle(200);
  assert.ok(A.db.activeSession, 'Training auf dem Handy läuft weiter');
  assert.ok(server.main.activeSession, 'Training ist in der Cloud');
  const se = A.db.activeSession.exercises[0];
  Core.updateSet(A.db, se.id, se.sets[0].id, 'weight', '80');
  A.change(); await settle(200);
  assert.equal(B.db.activeSession.exercises[0].sets[0].weight, 80, 'iPad sieht das laufende Training');
  assert.equal(A.db.body.length, 1, 'Körpermessung vom iPad ist angekommen');
  assert.equal(A.db.days[1].exercises[0].repMin, 6, 'Planänderung vom iPad ist angekommen');
  assert.equal(snapshot(A.db), snapshot(B.db));
});

test('Körpermessungen von zwei Geräten gleichzeitig gehen nicht verloren', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  const B = device(server, Core.emptyData());
  B.engine.start(); await settle();
  A.client.setOnline(false);
  B.client.setOnline(false);
  Core.saveBodyEntry(A.db, { date: T0, weight: 80 });
  Core.saveBodyEntry(B.db, { date: T0 + 86400000, waist: 85 });
  A.change(); B.change(); await settle();
  A.client.setOnline(true); B.client.setOnline(true); await settle(200);
  assert.equal(server.body.size, 2);
  assert.equal(A.db.body.length, 2);
  assert.equal(snapshot(A.db), snapshot(B.db));
});

test('Umstieg von der älteren App-Version (alles in einem Dokument)', async () => {
  const server = new FakeServer();
  const old = Core.emptyData();
  const day = Core.addDay(old, 'Push');
  Core.addExercise(old, day.id, 'Bankdrücken', 120);
  Core.saveBodyEntry(old, { date: T0, weight: 82 });
  // So lag es bisher in der Cloud: body im Hauptdokument, Base mit einem Schlüssel "main"
  server.main = JSON.parse(JSON.stringify(Sync.mainOf(old)));
  const local = JSON.parse(JSON.stringify(old));
  const A = device(server, Core.normalize(local), { main: 'alter-hash' });
  A.engine.start(); await settle(150);
  assert.ok(server.main, 'Hauptdokument wird nicht gelöscht');
  assert.equal(server.main.days.length, 1);
  assert.equal(server.body.size, 1, 'Körpermessung jetzt als eigenes Dokument');
  // Neues Gerät bekommt alles
  const B = device(server, Core.emptyData());
  B.engine.start(); await settle(150);
  assert.equal(B.db.days[0].name, 'Push');
  assert.equal(B.db.body.length, 1);
  // Löschen auf einem Gerät holt die alte Kopie im Hauptdokument nicht zurück
  Core.deleteBodyEntry(B.db, B.db.body[0].id);
  B.change(); await settle(150);
  server.broadcast(); await settle(100);
  assert.equal(A.db.body.length, 0);
  assert.equal(B.db.body.length, 0);
});

test('Veralteter Zwischenstand "Hauptdokument fehlt" löscht nichts und meldet nicht ab', async () => {
  const server = new FakeServer();
  const A = await firstDevice(server);
  finishSession(A.db, A.db.days[0].id, T0, 80);
  A.change(); await settle();
  const writes = server.writes;
  // Firestore meldet einmal fälschlich "Dokument existiert nicht", obwohl es auf dem Server da ist
  A.client.subs.main(null);
  await settle();
  assert.equal(A.gone, 0, 'nicht abgemeldet');
  assert.equal(A.db.days.length, 3, 'Tage lokal unverändert');
  assert.equal(server.main.days.length, 3, 'Tage in der Cloud unverändert');
  assert.equal(server.writes, writes, 'nichts zurückgeschrieben');
  assert.equal(A.engine.pending(), false);
});
