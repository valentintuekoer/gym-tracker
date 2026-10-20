// Tests für die reine App-Logik (ohne Browser). Ausführen mit: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, TimerCore, util } = require('../app.js');

const T0 = new Date('2026-09-01T10:00:00').getTime();
const MIN = 60000;

function freshDb() {
  const db = Core.emptyData();
  const push = Core.addDay(db, 'Push');
  Core.addExercise(db, push.id, 'Bankdrücken', 120);
  Core.addExercise(db, push.id, 'Schulterdrücken', 90);
  return { db, push };
}

/** Spielt eine komplette Einheit durch: sets = { Übungsname: [[kg, wdh, notiz], ...] } */
function doSession(db, dayId, start, sets) {
  const s = Core.startSession(db, dayId, start);
  for (const se of s.exercises) {
    const rows = sets[se.name] || [];
    while (se.sets.length < rows.length) Core.addSet(db, se.id);
    while (se.sets.length > rows.length) Core.removeSet(db, se.id, se.sets[se.sets.length - 1].id);
    rows.forEach(([w, r, note], i) => {
      const st = se.sets[i];
      Core.updateSet(db, se.id, st.id, 'weight', w);
      Core.updateSet(db, se.id, st.id, 'reps', r);
      if (note) Core.updateSet(db, se.id, st.id, 'note', note);
      Core.toggleSet(db, se.id, st.id, start + MIN);
    });
  }
  return Core.finishSession(db, start + 45 * MIN);
}

/* ---------- Hilfsfunktionen ---------- */

test('parseNum akzeptiert Komma und Punkt, leer/ungültig → null', () => {
  assert.equal(util.parseNum('82,5'), 82.5);
  assert.equal(util.parseNum('82.5'), 82.5);
  assert.equal(util.parseNum(' 80 '), 80);
  assert.equal(util.parseNum('80,'), 80);
  assert.equal(util.parseNum(''), null);
  assert.equal(util.parseNum('abc'), null);
  assert.equal(util.parseNum('-5'), null);
  assert.equal(util.parseNum(null), null);
  assert.equal(util.parseNum('80', 80), 80, 'Obergrenze gilt einschließlich');
  assert.equal(util.parseNum('80,5', 80), null, 'darüber → null');
  assert.equal(util.parseNum('1e30', 2000), null);
});

test('Unmögliche Werte (Tippfehler) zählen als leer – in Sätzen, ±-Tasten, Import und Körpermaßen', () => {
  const { db, push } = freshDb();
  const s = Core.startSession(db, push.id, T0);
  const se = s.exercises[0];
  const [a, b] = se.sets;
  Core.updateSet(db, se.id, a.id, 'weight', '99999999');
  Core.updateSet(db, se.id, a.id, 'reps', '99999');
  assert.deepEqual([a.weight, a.reps], [null, null]);
  Core.updateSet(db, se.id, b.id, 'weight', '1e30');
  assert.equal(b.weight, null);
  Core.updateSet(db, se.id, b.id, 'weight', '2000');
  Core.updateSet(db, se.id, b.id, 'reps', '999');
  assert.deepEqual([b.weight, b.reps], [2000, 999], 'die Grenzen selbst sind erlaubt');
  // ±-Tasten laufen nicht über die Grenze hinaus
  assert.equal(Core.stepSet(db, se.id, b.id, 'weight', 2.5), 2000);
  assert.equal(Core.stepSet(db, se.id, b.id, 'reps', 1), 999);
  // Import: auch Altdaten und Backups werden bereinigt, nichts davon landet im Verlauf oder in den Rekorden
  const done = doSession(db, push.id, T0, { 'Bankdrücken': [[80, 10]] });
  const raw = JSON.parse(JSON.stringify(db));
  raw.sessions[0].exercises[0].sets[0].weight = 1e30;
  raw.sessions[0].exercises[0].sets[0].reps = 123456;
  const n = Core.normalize(raw);
  assert.deepEqual([n.sessions[0].exercises[0].sets[0].weight, n.sessions[0].exercises[0].sets[0].reps], [null, null]);
  assert.ok(done);
  // Körpermaße: Körperfett höchstens 100 %, Umfänge höchstens 300 cm, Gewicht höchstens 500 kg
  const body = Core.emptyData();
  const e = Core.saveBodyEntry(body, { date: T0, weight: '82', bodyfat: '1e3', chest: '99999', waist: '85', hips: '300', arm: '301' });
  assert.deepEqual([e.weight, e.bodyfat, e.chest, e.waist, e.hips, e.arm], [82, null, null, 85, 300, null]);
  assert.equal(Core.saveBodyEntry(body, { date: T0 + 1, bodyfat: '150' }), null, 'nur ungültige Werte → nichts speichern');
  assert.equal(Core.saveBodyEntry(body, { date: T0 + 2, weight: '501' }), null);
});

test('Formatierung', () => {
  assert.equal(util.fmtNum(82.5), '82,5');
  assert.equal(util.fmtClock(90), '1:30');
  assert.equal(util.fmtClock(59.2), '1:00'); // aufrunden, damit 0:00 erst am Ende erscheint
  assert.equal(util.fmtClock(0), '0:00');
  assert.equal(util.fmtSet({ weight: 80, reps: 8 }), '80 kg × 8');
  assert.equal(util.fmtSet({ weight: null, reps: 12 }), '12 Wdh.');
  assert.equal(util.fmtRest(90), '90 s');
  assert.equal(util.fmtRest(120), '2 min');
  assert.equal(util.fmtRelative(T0, T0 + 3 * 3600000), 'heute');
  assert.equal(util.fmtRelative(T0, T0 + 86400000), 'gestern');
  assert.equal(util.fmtRelative(T0, T0 + 3 * 86400000), 'vor 3 Tagen');
  assert.equal(util.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('e1RM nach Epley', () => {
  assert.equal(util.e1rm(100, 1), 100);
  assert.ok(Math.abs(util.e1rm(100, 10) - 133.33) < 0.01);
  assert.equal(util.e1rm(null, 5), null);
  assert.equal(util.e1rm(100, 0), null);
});

/* ---------- Trainingstage ---------- */

test('Beispieldaten: Push mit Bankdrücken, Schulterdrücken, Trizeps-Pushdowns', () => {
  const db = Core.sampleData();
  const push = db.days.find((d) => d.name === 'Push');
  assert.deepEqual(push.exercises.map((e) => e.name), ['Bankdrücken', 'Schulterdrücken', 'Trizeps-Pushdowns']);
  assert.equal(db.sessions.length, 0);
  assert.equal(db.activeSession, null);
});

test('Tage anlegen, umbenennen, duplizieren, löschen', () => {
  const { db, push } = freshDb();
  assert.ok(Core.renameDay(db, push.id, '  Push A  '));
  assert.equal(push.name, 'Push A');
  assert.equal(Core.renameDay(db, push.id, '   '), false, 'leerer Name wird abgelehnt');

  const copy = Core.duplicateDay(db, push.id);
  assert.equal(copy.name, 'Push A (Kopie)');
  assert.equal(db.days[1], copy, 'Kopie steht direkt hinter dem Original');
  assert.deepEqual(copy.exercises.map((e) => e.name), push.exercises.map((e) => e.name));
  assert.notEqual(copy.exercises[0].id, push.exercises[0].id, 'neue IDs');
  copy.exercises[0].name = 'geändert';
  assert.equal(push.exercises[0].name, 'Bankdrücken', 'tiefe Kopie');

  assert.ok(Core.deleteDay(db, copy.id));
  assert.equal(db.days.length, 1);
  assert.equal(Core.deleteDay(db, 'gibtsnicht'), false);
});

test('Tag löschen verwirft laufendes Training, Verlauf bleibt', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]] });
  Core.startSession(db, push.id, T0 + 86400000);
  Core.deleteDay(db, push.id);
  assert.equal(db.activeSession, null);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].dayName, 'Push');
});

/* ---------- Übungen ---------- */

test('Übungen hinzufügen, umbenennen, entfernen, umsortieren, Pause', () => {
  const { db, push } = freshDb();
  const tri = Core.addExercise(db, push.id, 'Trizeps', 60);
  assert.equal(push.exercises.length, 3);
  assert.equal(Core.addExercise(db, push.id, '   '), null);

  assert.ok(Core.moveExercise(db, push.id, 2, 0));
  assert.deepEqual(push.exercises.map((e) => e.name), ['Trizeps', 'Bankdrücken', 'Schulterdrücken']);
  assert.equal(Core.moveExercise(db, push.id, 0, 5), false, 'außerhalb');
  assert.equal(Core.moveExercise(db, push.id, 0, -1), false);

  assert.ok(Core.setRest(db, push.id, tri.id, 75));
  assert.equal(tri.rest, 75);
  Core.setRest(db, push.id, tri.id, 99999);
  assert.equal(tri.rest, 1800, 'auf Maximum begrenzt');

  assert.ok(Core.renameExercise(db, push.id, tri.id, 'Trizeps-Pushdowns'));
  assert.equal(tri.name, 'Trizeps-Pushdowns');

  assert.ok(Core.removeExercise(db, push.id, tri.id));
  assert.equal(push.exercises.length, 2);
  assert.equal(Core.addExercise(db, push.id, 'X', 'abc').rest, db.settings.defaultRest, 'ungültige Pause → Standard');
});

test('Umbenennen mit Verlauf übernimmt alte Einträge', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]] });
  const bench = push.exercises[0];
  assert.ok(Core.historyHasName(db, 'bankdrücken'));
  Core.renameExercise(db, push.id, bench.id, 'Bankdrücken LH', true);
  assert.equal(db.sessions[0].exercises[0].name, 'Bankdrücken LH');
  assert.ok(Core.lastPerformance(db, 'Bankdrücken LH'));
  assert.equal(Core.lastPerformance(db, 'Bankdrücken'), null);
});

test('Umbenennen ohne Verlauf lässt alte Einträge unverändert', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]] });
  Core.renameExercise(db, push.id, push.exercises[0].id, 'Schrägbank', false);
  assert.equal(db.sessions[0].exercises[0].name, 'Bankdrücken');
});

test('Satzanzahl pro Übung: Standard, ändern, duplizieren, Grenzen', () => {
  const { db, push } = freshDb();
  const bench = push.exercises[0];
  assert.equal(bench.sets, 3, 'Standard');
  assert.equal(Core.addExercise(db, push.id, 'Dips', 90, 5).sets, 5);
  assert.ok(Core.setSetCount(db, push.id, bench.id, 4));
  assert.equal(bench.sets, 4);
  Core.setSetCount(db, push.id, bench.id, 0);
  assert.equal(bench.sets, 4, '0 wird abgelehnt');
  Core.setSetCount(db, push.id, bench.id, 99);
  assert.equal(bench.sets, 20, 'Maximum');
  Core.setSetCount(db, push.id, bench.id, 4);
  assert.equal(Core.duplicateDay(db, push.id).exercises[0].sets, 4);
  assert.equal(Core.setSetCount(db, push.id, 'nix', 3), false);
});

test('Training startet mit der geplanten Satzanzahl je Übung', () => {
  const { db, push } = freshDb();
  Core.setSetCount(db, push.id, push.exercises[0].id, 5);
  Core.setSetCount(db, push.id, push.exercises[1].id, 2);
  const s = Core.startSession(db, push.id, T0);
  assert.deepEqual(s.exercises.map((e) => e.sets.length), [5, 2]);
});

test('Satzanzahl während des Trainings ändern: eingetragene Sätze bleiben', () => {
  const { db, push } = freshDb();
  const bench = push.exercises[0];
  const se = Core.startSession(db, push.id, T0).exercises[0];
  Core.setSetCount(db, push.id, bench.id, 5);
  assert.equal(se.sets.length, 5, 'fehlende Sätze ergänzt');
  Core.updateSet(db, se.id, se.sets[3].id, 'reps', '8');
  Core.setSetCount(db, push.id, bench.id, 2);
  assert.equal(bench.sets, 2);
  assert.equal(se.sets.length, 4, 'nur leere Sätze am Ende entfernt');
  assert.equal(se.sets[3].reps, 8);
  // andere Übung unberührt
  assert.equal(db.activeSession.exercises[1].sets.length, 3);
});

/* ---------- Tracking ---------- */

test('Einheit starten: 3 leere Sätze pro Übung ohne Verlauf', () => {
  const { db, push } = freshDb();
  const s = Core.startSession(db, push.id, T0);
  assert.equal(s.exercises.length, 2);
  assert.equal(s.exercises[0].sets.length, 3);
  assert.equal(s.exercises[0].rest, 120);
  assert.ok(s.exercises[0].sets.every((st) => st.weight === null && !st.done));
});

test('Sätze hinzufügen/entfernen/bearbeiten', () => {
  const { db, push } = freshDb();
  const se = Core.startSession(db, push.id, T0).exercises[0];
  const st = Core.addSet(db, se.id);
  assert.equal(se.sets.length, 4);
  assert.ok(Core.updateSet(db, se.id, st.id, 'weight', '82,5'));
  assert.ok(Core.updateSet(db, se.id, st.id, 'reps', '8'));
  assert.ok(Core.updateSet(db, se.id, st.id, 'note', 'letzte Wdh. schwer'));
  assert.equal(st.weight, 82.5);
  assert.equal(st.reps, 8);
  assert.equal(st.note, 'letzte Wdh. schwer');
  assert.equal(Core.updateSet(db, se.id, st.id, 'foo', 1), false);
  Core.updateSet(db, se.id, st.id, 'weight', '');
  assert.equal(st.weight, null);
  assert.ok(Core.removeSet(db, se.id, st.id));
  assert.equal(se.sets.length, 3);
  assert.equal(Core.removeSet(db, se.id, 'nix'), false);
});

test('Abhaken liefert Pause & Name für den Timer, Rückgängig möglich', () => {
  const { db, push } = freshDb();
  const se = Core.startSession(db, push.id, T0).exercises[0];
  const res = Core.toggleSet(db, se.id, se.sets[0].id, T0);
  assert.deepEqual(res, { done: true, rest: 120, name: 'Bankdrücken' });
  assert.equal(Core.toggleSet(db, se.id, se.sets[0].id, T0).done, false);
  assert.equal(Core.toggleSet(db, se.id, 'nix', T0), null);
});

test('Werte vom letzten Training als Vorlage + Übernahme beim Abhaken', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8, 'leicht'], [80, 7], [77.5, 8]] });

  const s = Core.startSession(db, push.id, T0 + 3 * 86400000);
  const se = s.exercises[0];
  assert.equal(se.sets.length, 3, 'Satzanzahl wie beim letzten Mal');

  const prev = Core.lastPerformance(db, 'Bankdrücken');
  assert.equal(prev.date, T0 + 45 * MIN);
  assert.deepEqual(Core.placeholderFor(prev, se, 0), { weight: 80, reps: 8, note: 'leicht' });
  assert.deepEqual(Core.placeholderFor(prev, se, 2), { weight: 77.5, reps: 8, note: '' });

  // Zusätzlicher 4. Satz: Vorlage = vorheriger Satz von heute (falls ausgefüllt), sonst letzter vom letzten Mal
  Core.addSet(db, se.id);
  assert.deepEqual(Core.placeholderFor(prev, se, 3), { weight: 77.5, reps: 8, note: '' });
  Core.updateSet(db, se.id, se.sets[2].id, 'weight', '85');
  Core.updateSet(db, se.id, se.sets[2].id, 'reps', '5');
  assert.deepEqual(Core.placeholderFor(prev, se, 3), { weight: 85, reps: 5, note: '' });

  // Abhaken mit leeren Feldern übernimmt die Vorlage, eigene Werte bleiben
  Core.updateSet(db, se.id, se.sets[0].id, 'reps', '9');
  Core.toggleSet(db, se.id, se.sets[0].id, T0);
  assert.equal(se.sets[0].weight, 80);
  assert.equal(se.sets[0].reps, 9);
});

test('Vorlage ohne jeglichen Verlauf ist leer', () => {
  const { db, push } = freshDb();
  const se = Core.startSession(db, push.id, T0).exercises[0];
  assert.deepEqual(Core.placeholderFor(null, se, 0), { weight: null, reps: null, note: '' });
  Core.toggleSet(db, se.id, se.sets[0].id, T0);
  assert.equal(se.sets[0].weight, null);
});

test('Verlauf wird über den Übungsnamen tagübergreifend geteilt', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]] });
  const pushB = Core.duplicateDay(db, push.id);
  const s = Core.startSession(db, pushB.id, T0 + 86400000);
  assert.equal(s.exercises[0].sets.length, 3, 'Satzanzahl kommt aus dem Plan');
  assert.equal(Core.placeholderFor(Core.lastPerformance(db, 'Bankdrücken'), s.exercises[0], 0).weight, 80);
  assert.equal(Core.lastPerformance(db, '  BANKDRÜCKEN ').sets[0].weight, 80);
});

test('Training beenden speichert nur Sätze mit Werten', () => {
  const { db, push } = freshDb();
  const s = Core.startSession(db, push.id, T0);
  const [bench, ohp] = s.exercises;
  Core.updateSet(db, bench.id, bench.sets[0].id, 'weight', '80');
  Core.updateSet(db, bench.id, bench.sets[0].id, 'reps', '8');
  Core.toggleSet(db, bench.id, bench.sets[0].id, T0);
  Core.updateSet(db, bench.id, bench.sets[1].id, 'reps', '6'); // nicht abgehakt, aber ausgefüllt
  assert.equal(Core.countLoggedSets(s), 2);

  const done = Core.finishSession(db, T0 + 50 * MIN);
  assert.equal(db.activeSession, null);
  assert.equal(db.sessions.length, 1);
  assert.equal(done.exercises.length, 1, 'Schulterdrücken ohne Sätze wird weggelassen');
  assert.deepEqual(done.exercises[0].sets, [
    { weight: 80, reps: 8, note: '', done: true },
    { weight: null, reps: 6, note: '', done: false },
  ]);
  assert.equal(Core.lastTrained(db, push.id), T0 + 50 * MIN);
  assert.ok(ohp);
});

test('Leeres Training beenden speichert nichts', () => {
  const { db, push } = freshDb();
  Core.startSession(db, push.id, T0);
  assert.equal(Core.finishSession(db, T0 + MIN), null);
  assert.equal(db.sessions.length, 0);
  assert.equal(db.activeSession, null);
});

test('Planänderungen während des Trainings werden übernommen', () => {
  const { db, push } = freshDb();
  const s = Core.startSession(db, push.id, T0);
  const bench = s.exercises[0];
  Core.updateSet(db, bench.id, bench.sets[0].id, 'weight', '80');

  const dips = Core.addExercise(db, push.id, 'Dips', 90);
  assert.equal(db.activeSession.exercises.length, 3);
  assert.equal(db.activeSession.exercises[2].name, 'Dips');

  Core.moveExercise(db, push.id, 2, 0);
  assert.equal(db.activeSession.exercises[0].name, 'Dips');
  assert.equal(db.activeSession.exercises[1], bench, 'eingetragene Werte bleiben erhalten');

  Core.setRest(db, push.id, push.exercises[1].id, 150);
  assert.equal(bench.rest, 150);

  // Entfernte Übung ohne Daten verschwindet, mit Daten bleibt sie erhalten
  Core.removeExercise(db, push.id, dips.id);
  assert.ok(!db.activeSession.exercises.some((e) => e.name === 'Dips'));
  Core.removeExercise(db, push.id, push.exercises[0].id); // Bankdrücken (hat Daten)
  const kept = db.activeSession.exercises.find((e) => e.name === 'Bankdrücken');
  assert.ok(kept);
  assert.equal(kept.exId, null);
  Core.syncSession(db);
  assert.equal(db.activeSession.exercises.filter((e) => e.name === 'Bankdrücken').length, 1, 'nicht doppelt');
});

/* ---------- Verlauf & Auswertung ---------- */

test('Verlauf, Statistiken und Löschen von Einheiten', () => {
  const { db, push } = freshDb();
  const a = doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8], [80, 6]], 'Schulterdrücken': [[40, 10]] });
  const b = doSession(db, push.id, T0 + 3 * 86400000, { 'Bankdrücken': [[85, 5, 'Schulter zwickt']] });

  const hist = Core.exerciseHistory(db, 'bankdrücken');
  assert.equal(hist.length, 2);
  assert.equal(hist[0].sessionId, a.id, 'älteste zuerst');
  assert.equal(hist[1].best.weight, 85);
  assert.ok(Math.abs(hist[0].best.e1rm - 80 * (1 + 8 / 30)) < 1e-9);

  const stats = Core.exerciseStats(db);
  assert.equal(stats[0].key, 'bankdrücken', 'zuletzt trainiert zuerst');
  assert.equal(stats[0].count, 2);
  assert.equal(stats[0].best.weight, 85);

  const ss = Core.sessionStats(a);
  assert.equal(ss.sets, 3);
  assert.equal(ss.volume, 80 * 8 + 80 * 6 + 40 * 10);
  assert.equal(ss.duration, 45 * MIN);

  assert.ok(Core.deleteSession(db, b.id));
  assert.equal(Core.lastPerformance(db, 'Bankdrücken').sets[0].weight, 80);
  assert.equal(Core.exerciseHistory(db, 'bankdrücken').length, 1);
});

/* ---------- Import / Export ---------- */

test('Export → Import ergibt dieselben Daten', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8, 'leicht']] });
  Core.startSession(db, push.id, T0 + 86400000);
  db.settings.defaultRest = 75;
  const exported = JSON.parse(JSON.stringify({ app: 'gym-tracker', version: 1, exportedAt: 'x', data: db }));
  const restored = Core.normalize(exported);
  assert.deepEqual(restored, JSON.parse(JSON.stringify(db)));
});

test('Import lehnt fremde Dateien ab und bereinigt kaputte Werte', () => {
  assert.throws(() => Core.normalize({ foo: 1 }), /keine Gym-Tracker-Daten/);
  assert.throws(() => Core.normalize(null));
  const db = Core.normalize({
    days: [{ name: 'A', exercises: [{ name: 'X', rest: 'abc' }, null] }, null],
    sessions: [{ finishedAt: 5, exercises: [{ name: 'X', sets: [{ weight: '80,5', reps: '8.4' }] }] }, { exercises: 'kaputt' }],
    settings: { sound: false },
  });
  assert.equal(db.days.length, 1);
  assert.equal(db.days[0].exercises.length, 1);
  assert.equal(db.days[0].exercises[0].rest, 90);
  assert.equal(db.days[0].exercises[0].sets, 1, 'ältere Daten: Satzanzahl vom letzten Training');
  assert.ok(db.days[0].id);
  assert.equal(db.sessions.length, 1);
  assert.deepEqual(db.sessions[0].exercises[0].sets[0], { weight: 80.5, reps: 8, note: '', done: false });
  assert.equal(db.settings.sound, false);
  assert.equal(db.settings.vibrate, true, 'fehlende Einstellungen → Standard');
});

/* ---------- Timer ---------- */

test('Timer rechnet mit End-Zeitstempel', () => {
  const t = TimerCore.create(90, T0, 'Bankdrücken');
  assert.equal(t.endAt, T0 + 90000);
  assert.equal(TimerCore.remaining(t, T0), 90);
  assert.equal(TimerCore.remaining(t, T0 + 30000), 60);
  assert.equal(TimerCore.isDone(t, T0 + 89999), false);
  assert.equal(TimerCore.isDone(t, T0 + 90000), true);
  // "Sperrbildschirm": 10 Minuten keine Ticks – Restzeit stimmt trotzdem
  assert.equal(TimerCore.remaining(t, T0 + 600000), 0);
  assert.equal(TimerCore.isDone(t, T0 + 600000), true);
  assert.equal(TimerCore.progress(t, T0 + 45000), 0.5);
  assert.equal(TimerCore.progress(t, T0 + 999999), 1);
});

test('Timer +15 / −15', () => {
  let t = TimerCore.create(60, T0);
  t = TimerCore.adjust(t, 15, T0 + 10000);
  assert.equal(TimerCore.remaining(t, T0 + 10000), 65);
  assert.equal(t.duration, 75);
  t = TimerCore.adjust(t, -15, T0 + 10000);
  assert.equal(TimerCore.remaining(t, T0 + 10000), 50);
  assert.equal(t.duration, 60);
  // −15 bei 5 s Rest → endet jetzt, nicht in der Vergangenheit
  t = TimerCore.adjust(t, -15, T0 + 55000);
  assert.equal(t.endAt, T0 + 55000);
  assert.equal(TimerCore.isDone(t, T0 + 55000), true);
  // Abgelaufene Timer werden nicht wiederbelebt
  const same = TimerCore.adjust(t, 15, T0 + 70000);
  assert.equal(same, t);
});

/* ---------- Ziel-Wiederholungen, Steigerung, Notizen, +/−, Rekorde ---------- */

test('Wiederholungs-Ziel lesen und speichern', () => {
  assert.deepEqual(util.parseRepTarget('8-12'), { min: 8, max: 12 });
  assert.deepEqual(util.parseRepTarget('8–12'), { min: 8, max: 12 });
  assert.deepEqual(util.parseRepTarget('12 bis 8'), { min: 8, max: 12 });
  assert.deepEqual(util.parseRepTarget('5'), { min: 5, max: 5 });
  assert.equal(util.parseRepTarget(''), null);
  assert.equal(util.parseRepTarget('abc'), undefined);
  assert.equal(util.parseRepTarget('0-5'), undefined);
  assert.equal(util.fmtRepTarget(8, 12), '8–12 Wdh.');
  assert.equal(util.fmtRepTarget(5, 5), '5 Wdh.');

  const { db, push } = freshDb();
  const bench = push.exercises[0];
  assert.equal(bench.repMin, null);
  Core.setRepTarget(db, push.id, bench.id, 8, 12);
  assert.deepEqual([bench.repMin, bench.repMax], [8, 12]);
  Core.setExerciseNote(db, push.id, bench.id, '  Sitz Stufe 4 ');
  assert.equal(bench.note, 'Sitz Stufe 4');
  const copy = Core.duplicateDay(db, push.id).exercises[0];
  assert.deepEqual([copy.repMin, copy.repMax, copy.note], [8, 12, 'Sitz Stufe 4']);
  Core.setRepTarget(db, push.id, bench.id, null, null);
  assert.deepEqual([bench.repMin, bench.repMax], [null, null]);
  // Import/Normalisierung behält die Felder
  Core.setRepTarget(db, push.id, bench.id, 6, 8);
  const n = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.deepEqual([n.days[0].exercises[0].repMin, n.days[0].exercises[0].repMax, n.days[0].exercises[0].note], [6, 8, 'Sitz Stufe 4']);
  assert.equal(n.settings.increment, 2.5);
});

test('Steigerungsvorschlag (doppelte Progression)', () => {
  const t = { min: 8, max: 12 };
  const P = (...sets) => ({ date: 1, sets: sets.map(([weight, reps]) => ({ weight, reps, note: '' })) });
  assert.equal(Core.progression(null, null, 2.5, 3), null, 'ohne Ziel kein Vorschlag');
  assert.deepEqual(Core.progression(null, t, 2.5, 3), { kind: 'first' });
  assert.deepEqual(Core.progression(P([80, 12], [80, 12], [80, 13]), t, 2.5, 3), { kind: 'increase', top: 80, next: 82.5 });
  assert.equal(Core.progression(P([80, 12], [80, 12]), t, 2.5, 3).kind, 'reps', 'nur 2 von 3 Sätzen → noch nicht steigern');
  assert.equal(Core.progression(P([80, 12], [80, 11], [80, 10]), t, 2.5, 3).kind, 'reps');
  assert.equal(Core.progression(P([80, 9], [80, 7], [80, 6]), t, 2.5, 3).kind, 'below');
  assert.deepEqual(Core.progression(P([null, 12], [null, 12], [null, 12]), t, 2.5, 3), { kind: 'increase', top: null, next: null });
});

test('Vorlagen folgen dem Vorschlag und landen beim Abhaken im Satz', () => {
  const { db, push } = freshDb();
  const bench = push.exercises[0];
  Core.setRepTarget(db, push.id, bench.id, 8, 12);
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 12], [80, 12], [80, 12]] });
  let se = Core.startSession(db, push.id, T0 + 2 * 86400000).exercises[0];
  let ctx = Core.exerciseContext(db, se);
  assert.equal(ctx.prog.kind, 'increase');
  assert.deepEqual([0, 1, 2].map((i) => Core.placeholderFor(ctx.prev, se, i, ctx)).map((p) => [p.weight, p.reps]),
    [[82.5, 8], [82.5, 8], [82.5, 8]]);
  Core.toggleSet(db, se.id, se.sets[0].id, T0);
  assert.deepEqual([se.sets[0].weight, se.sets[0].reps], [82.5, 8]);
  Core.discardSession(db);

  // Im Bereich → gleiches Gewicht, +1 Wdh.
  doSession(db, push.id, T0 + 3 * 86400000, { 'Bankdrücken': [[82.5, 9], [82.5, 8], [82.5, 12]] });
  se = Core.startSession(db, push.id, T0 + 4 * 86400000).exercises[0];
  ctx = Core.exerciseContext(db, se);
  assert.equal(ctx.prog.kind, 'reps');
  assert.deepEqual([0, 1, 2].map((i) => Core.placeholderFor(ctx.prev, se, i, ctx)).map((p) => [p.weight, p.reps]),
    [[82.5, 10], [82.5, 9], [82.5, 12]], 'Obergrenze wird nicht überschritten');

  // Eigener Gewichtsschritt
  db.settings.increment = 1.25;
  Core.discardSession(db);
  doSession(db, push.id, T0 + 5 * 86400000, { 'Bankdrücken': [[82.5, 12], [82.5, 12], [82.5, 12]] });
  se = Core.startSession(db, push.id, T0 + 6 * 86400000).exercises[0];
  ctx = Core.exerciseContext(db, se);
  assert.equal(ctx.prog.next, 83.75);
});

test('Ohne Ziel bleiben die Vorlagen wie bisher (Werte vom letzten Mal)', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 12], [80, 12], [80, 12]] });
  const se = Core.startSession(db, push.id, T0 + 86400000).exercises[0];
  const ctx = Core.exerciseContext(db, se);
  assert.equal(ctx.prog, null);
  assert.deepEqual(Core.placeholderFor(ctx.prev, se, 0, ctx), { weight: 80, reps: 12, note: '' });
});

test('+/− Buttons rechnen von der Vorlage aus', () => {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]] });
  const se = Core.startSession(db, push.id, T0 + 86400000).exercises[0];
  const st = se.sets[0];
  assert.equal(Core.stepSet(db, se.id, st.id, 'weight', 2.5), 82.5, 'leeres Feld → Vorlage 80 + 2,5');
  assert.equal(Core.stepSet(db, se.id, st.id, 'weight', -2.5), 80);
  assert.equal(Core.stepSet(db, se.id, st.id, 'reps', 1), 9);
  assert.equal(Core.stepSet(db, se.id, st.id, 'reps', -20), 0, 'nicht negativ');
  // ganz ohne Vorlage startet es bei 0
  const fresh = Core.startSession(db, push.id, T0).exercises[1];
  assert.equal(Core.stepSet(db, fresh.id, fresh.sets[0].id, 'weight', 2.5), 2.5);
  assert.equal(Core.stepSet(db, fresh.id, fresh.sets[0].id, 'note', 1), null);
});

test('Rekorde und Vergleich mit der letzten Einheit', () => {
  const { db, push } = freshDb();
  const a = doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]], 'Schulterdrücken': [[40, 10]] });
  assert.deepEqual(Core.sessionRecords(db, a), [], 'erstes Mal ist kein Rekord');
  const b = doSession(db, push.id, T0 + 86400000, { 'Bankdrücken': [[82.5, 6]], 'Schulterdrücken': [[40, 12]] });
  assert.deepEqual(Core.sessionRecords(db, b), [
    { name: 'Bankdrücken', type: 'weight', value: 82.5, prev: 80 },
    { name: 'Schulterdrücken', type: 'e1rm', value: 56, prev: 53.3 },
  ]);
  const c = doSession(db, push.id, T0 + 2 * 86400000, { 'Bankdrücken': [[80, 5]] });
  assert.deepEqual(Core.sessionRecords(db, c), []);
  assert.equal(Core.previousSessionOfDay(db, c).id, b.id);
  assert.equal(Core.previousSessionOfDay(db, a), null);
  // Übung ohne Gewicht: mehr Wdh. = Rekord
  const pull = Core.addDay(db, 'Pull');
  Core.addExercise(db, pull.id, 'Klimmzüge', 90);
  doSession(db, pull.id, T0, { 'Klimmzüge': [[null, 8]] });
  const d = doSession(db, pull.id, T0 + 86400000, { 'Klimmzüge': [[null, 10]] });
  assert.deepEqual(Core.sessionRecords(db, d), [{ name: 'Klimmzüge', type: 'reps', value: 10, prev: 8 }]);
});

/* ---------- B6 Wochenziel, B8 RIR/RPE, B10 Körper, B12 Teilen, B13 Reihenfolge ---------- */

/** Ein Satz ohne RIR/RPE nach Export/Import */
function normSetless() {
  const { db, push } = freshDb();
  doSession(db, push.id, T0, { 'Bankdrücken': [[80, 8]] });
  return Core.normalize(JSON.parse(JSON.stringify(db))).sessions[0].exercises[0].sets[0];
}

test('Wochenziel und Serie', () => {
  const { db, push } = freshDb();
  const mon = new Date('2026-09-21T18:00:00').getTime(); // Montag
  const W = 7 * 86400000;
  // 3 Wochen zurück je 3 Trainings, vorletzte Woche nur 1, diese Woche 2
  const add = (t) => doSession(db, push.id, t, { 'Bankdrücken': [[80, 8]] });
  [mon - 3 * W, mon - 3 * W + 86400000, mon - 3 * W + 2 * 86400000].forEach(add);
  add(mon - 2 * W);
  [mon - W, mon - W + 86400000, mon - W + 2 * 86400000].forEach(add);
  add(mon); add(mon + 86400000);
  const now = mon + 2 * 86400000;
  assert.deepEqual(Core.weekStats(db, now, 3), { thisWeek: 2, goal: 3, streak: 1 }, 'laufende Woche bricht die Serie nicht');
  add(mon + 2 * 86400000 - 3600000);
  assert.deepEqual(Core.weekStats(db, now, 3), { thisWeek: 3, goal: 3, streak: 2 });
  assert.equal(Core.weekStats(db, now, 1).streak, 4);
  assert.equal(Core.dayKey(mon), '2026-09-21');
  assert.equal(Core.sessionsByDay(db).get('2026-09-21').length, 1);
});

test('RIR/RPE pro Satz: optional, begrenzt, landet im Verlauf', () => {
  const { db, push } = freshDb();
  const se = Core.startSession(db, push.id, T0).exercises[0];
  const st = se.sets[0];
  Core.updateSet(db, se.id, st.id, 'weight', '80');
  Core.updateSet(db, se.id, st.id, 'reps', '8');
  assert.ok(Core.updateSet(db, se.id, st.id, 'rir', '2'));
  Core.updateSet(db, se.id, st.id, 'rpe', '8,5');
  Core.updateSet(db, se.id, se.sets[1].id, 'rir', '99');
  assert.equal(se.sets[1].rir, 10, 'max. 10');
  Core.updateSet(db, se.id, se.sets[1].id, 'rir', '');
  assert.ok(!('rir' in se.sets[1]), 'leer → Feld entfernt');
  const done = Core.finishSession(db, T0 + MIN);
  assert.deepEqual(done.exercises[0].sets[0], { weight: 80, reps: 8, note: '', done: false, rir: 2, rpe: 8.5 });
  const n = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.equal(n.sessions[0].exercises[0].sets[0].rir, 2);
  assert.equal(n.sessions[0].exercises[0].sets.length, 1, 'Satz nur mit gelöschtem RIR wird nicht gespeichert');
  assert.ok(!('rir' in normSetless(n)), 'Sätze ohne RIR bekommen kein leeres Feld');
});

test('Körpergewicht & Maße', () => {
  const db = Core.emptyData();
  assert.equal(Core.saveBodyEntry(db, { date: T0 }), null, 'ohne Werte nichts speichern');
  const a = Core.saveBodyEntry(db, { date: T0 + 86400000, weight: '82,4', waist: '85' });
  Core.saveBodyEntry(db, { date: T0, weight: 83.05, note: 'morgens' });
  assert.deepEqual(db.body.map((e) => e.weight), [83.1, 82.4], 'sortiert nach Datum, 1 Nachkommastelle');
  assert.deepEqual(Core.latestBody(db, 'weight'), { value: 82.4, date: T0 + 86400000 });
  assert.deepEqual(Core.latestBody(db, 'waist').value, 85);
  assert.equal(Core.latestBody(db, 'arm'), null);
  Core.saveBodyEntry(db, { ...a, weight: 81 });
  assert.equal(db.body.length, 2, 'gleiche ID → ändern statt neu');
  assert.equal(Core.latestBody(db, 'weight').value, 81);
  assert.ok(Core.deleteBodyEntry(db, a.id));
  assert.equal(db.body.length, 1);
  const n = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.deepEqual(n.body, db.body);
});

test('Trainingsplan teilen und bei jemand anderem übernehmen', () => {
  const { db, push } = freshDb();
  Core.setRepTarget(db, push.id, push.exercises[0].id, 8, 12);
  Core.setSetCount(db, push.id, push.exercises[1].id, 4);
  Core.setExerciseNote(db, push.id, push.exercises[0].id, 'privat');
  const code = Core.encodePlan(Core.planFromDay(push));
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'URL-tauglich');
  const plan = Core.decodePlan(code);
  assert.equal(plan.name, 'Push');
  assert.deepEqual(plan.exercises.map((e) => [e.name, e.sets, e.rest, e.repMin, e.repMax]),
    [['Bankdrücken', 3, 120, 8, 12], ['Schulterdrücken', 4, 90, null, null]]);

  const other = Core.emptyData();
  const day = Core.addDayFromPlan(other, plan);
  assert.equal(other.days.length, 1);
  assert.equal(day.exercises[0].note, '', 'persönliche Notizen werden nicht geteilt');
  assert.notEqual(day.id, push.id);
  const s = Core.startSession(other, day.id, T0);
  assert.deepEqual(s.exercises.map((e) => e.sets.length), [3, 4]);

  // aus einer abgeschlossenen Einheit
  const done = doSession(db, push.id, T0, { 'Bankdrücken': [[80, 10], [80, 9]] });
  const fromSession = Core.decodePlan(Core.encodePlan(Core.planFromSession(db, done)));
  assert.deepEqual(fromSession.exercises.map((e) => [e.name, e.sets, e.repMin]), [['Bankdrücken', 3, 8]]);

  assert.throws(() => Core.decodePlan('kaputt!!'), /ungültig/);
  assert.throws(() => Core.decodePlan(Core.encodePlan({ v: 1, n: 'x', e: [] })), /keinen Trainingsplan/);
  // nur leere oder ungültige Einträge ergeben keinen leeren Trainingstag
  assert.throws(() => Core.decodePlan(Core.encodePlan({ v: 1, n: 'x', e: [null, {}, { n: '' }, 'Bankdrücken'] })), /keinen Trainingsplan/);
  assert.equal(Core.decodePlan(Core.encodePlan({ v: 1, n: 'x', e: [null, { n: 'Kniebeugen' }] })).exercises.length, 1, 'gültige Übungen bleiben, ungültige fallen weg');
});

test('Im Training umsortieren und überspringen, ohne den Plan zu ändern', () => {
  const { db, push } = freshDb();
  Core.addExercise(db, push.id, 'Dips', 90);
  const s = Core.startSession(db, push.id, T0);
  const names = () => db.activeSession.exercises.map((e) => e.name + (e.skipped ? '*' : ''));
  assert.ok(Core.moveSessionExercise(db, s.exercises[2].id, 'up'));
  assert.deepEqual(names(), ['Bankdrücken', 'Dips', 'Schulterdrücken']);
  assert.deepEqual(push.exercises.map((e) => e.name), ['Bankdrücken', 'Schulterdrücken', 'Dips'], 'Plan unverändert');
  assert.equal(Core.moveSessionExercise(db, s.exercises[0].id, 'up'), false);
  Core.setSkipped(db, s.exercises[0].id, true);
  assert.deepEqual(names(), ['Dips', 'Schulterdrücken', 'Bankdrücken*']);
  // Planänderung während des Trainings behält die eigene Reihenfolge
  Core.addExercise(db, push.id, 'Seitheben', 60);
  Core.renameExercise(db, push.id, push.exercises[1].id, 'Schulterdrücken KH');
  assert.deepEqual(names(), ['Dips', 'Schulterdrücken KH', 'Bankdrücken*', 'Seitheben']);
  Core.setSkipped(db, db.activeSession.exercises[2].id, false);
  assert.equal(db.activeSession.exercises[2].skipped, false);
  const n = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.equal(n.activeSession.customOrder, true);
});

test('Geschätzte Trainingsdauer für die Vorschau', () => {
  const { db, push } = freshDb(); // Bankdrücken 3×/120 s, Schulterdrücken 3×/90 s
  // (3·45 + 2·120 + 60) + (3·45 + 2·90 + 60) = 435 + 375 = 810 s ≈ 13,5 min → 15
  assert.equal(Core.estimateMinutes(push), 15);
  assert.equal(Core.estimateMinutes(Core.addDay(db, 'Leer')), 0);
});

/* ================= v2: Ernährung, Lebensmittel, Übungsbibliothek ================= */

const LIB = require('../exercises.json').exercises;

test('Migration: altes Backup (v1) bleibt importierbar, neue Felder werden ergänzt', () => {
  const oldBackup = {
    app: 'gym-tracker', version: 1,
    data: {
      days: [{ id: 'd1', name: 'Push', exercises: [{ id: 'e1', name: 'Bankdrücken', rest: 120, sets: 3 }] }],
      sessions: [{ id: 's1', dayId: 'd1', dayName: 'Push', finishedAt: T0, startedAt: T0 - 3600000,
        exercises: [{ exId: 'e1', name: 'Bankdrücken', sets: [{ weight: 80, reps: 8, note: '', done: true }] }] }],
      settings: { defaultRest: 90, sound: true },
    },
  };
  const db = Core.normalize(oldBackup);
  assert.equal(db.version, 2, 'Schema-Version erhoeht');
  assert.deepEqual(db.customExercises, []);
  assert.deepEqual(db.libMeta, {});
  assert.deepEqual(db.settings.mealPlan, []);
  assert.deepEqual(db.settings.mealLog, {});
  assert.equal(db.days[0].exercises[0].libId, null);
  assert.equal(db.days[0].name, 'Push');
  assert.equal(db.sessions.length, 1);
  assert.equal(Core.lastPerformance(db, 'Bankdrücken').sets[0].weight, 80);
});

test('Uebungen mit der Bibliothek verknuepfen (feste ID, Name/Alias, Gross-/Kleinschreibung)', () => {
  const db = Core.emptyData();
  const d = Core.addDay(db, 'Push');
  Core.addExercise(db, d.id, 'Bankdrücken');
  Core.addExercise(db, d.id, 'KNIEBEUGEN');
  Core.addExercise(db, d.id, 'bench press');
  Core.addExercise(db, d.id, 'Mein Spezial-Curl');
  assert.ok(Core.linkPlanToLibrary(db, LIB));
  assert.ok(d.exercises.every((e) => e.libId));
  assert.equal(d.exercises[0].libId, 'bankdruecken-lh');
  assert.equal(d.exercises[1].libId, 'kniebeugen');
  assert.equal(d.exercises[2].libId, 'bankdruecken-lh');
  const custom = db.customExercises.find((c) => util.normName(c.name) === 'mein spezial-curl');
  assert.ok(custom);
  assert.equal(d.exercises[3].libId, custom.id);
  assert.equal(Core.linkPlanToLibrary(db, LIB), false);
});

test('Eigene Uebung anlegen, bearbeiten, loeschen - Verlauf bleibt erhalten', () => {
  const db = Core.emptyData();
  const d = Core.addDay(db, 'Tag');
  const libId = Core.resolveExercise(db, 'Meine Übung', LIB);
  Core.addExercise(db, d.id, 'Meine Übung', 90, 3, libId);
  doSession(db, d.id, T0, { 'Meine Übung': [[50, 10]] });
  assert.ok(db.customExercises.some((c) => c.id === libId));
  Core.saveCustomExercise(db, { id: libId, name: 'Meine Übung', muscle: 'Bizeps', equipment: 'Kurzhantel', type: 'Isolation', steps: ['Schritt 1'] });
  assert.equal(Core.customExerciseById(db, libId).muscle, 'Bizeps');
  Core.deleteCustomExercise(db, libId);
  assert.equal(db.customExercises.length, 0);
  assert.equal(Core.lastPerformance(db, 'Meine Übung').sets[0].weight, 50);
});

test('Favoriten und zuletzt verwendet fuer Bibliotheksuebungen', () => {
  const db = Core.emptyData();
  assert.equal(Core.libFav(db, 'bankdruecken-lh'), false);
  Core.toggleLibFav(db, 'bankdruecken-lh');
  assert.equal(Core.libFav(db, 'bankdruecken-lh'), true);
  Core.markExerciseUsed(db, 'kniebeugen', T0);
  assert.equal(Core.libUsed(db, 'kniebeugen'), T0);
  Core.toggleLibFav(db, 'bankdruecken-lh');
  assert.equal(db.libMeta['bankdruecken-lh'], undefined);
});

test('Export/Import: neue Daten sind enthalten und ueberstehen die Runde', () => {
  const db = Core.emptyData();
  const d = Core.addDay(db, 'Push');
  Core.addExercise(db, d.id, 'Bankdrücken', 120, 3, Core.resolveExercise(db, 'Bankdrücken', LIB));
  Core.addMeal(db, { name: 'Frühstück', time: '08:00', kcal: 500 });
  Core.toggleLibFav(db, 'kniebeugen');
  Core.saveCustomExercise(db, { name: 'Custom', muscle: 'Bauch', equipment: 'Körpergewicht', type: 'Isolation', steps: ['x'] });
  const exported = JSON.parse(JSON.stringify({ app: 'gym-tracker', version: 2, data: db }));
  const back = Core.normalize(exported);
  assert.deepEqual(back.settings.mealPlan, db.settings.mealPlan);
  assert.deepEqual(back.customExercises, db.customExercises);
  assert.deepEqual(back.libMeta, db.libMeta);
  assert.equal(back.days[0].exercises[0].libId, 'bankdruecken-lh');
});

/* ---------- Mein Gym ---------- */

test('Mein Gym: bereinigen und Routen-Links für Apple Karten und Google Maps', () => {
  assert.equal(Core.normGym(null), null);
  assert.equal(Core.normGym({ name: 'Nur Name' }), null); // ohne Adresse/Standort nicht routbar
  assert.equal(Core.normGym({ address: 'x', lat: 999, lng: 0 }).lat, null); // ungültige Koordinaten verworfen
  const gym = { name: 'McFit', address: '  Hauptstraße 1,\n 10115 Berlin ', maps: 'apple' };
  assert.equal(Core.normGym(gym).address, 'Hauptstraße 1, 10115 Berlin');
  assert.equal(Core.routeUrl(gym, 'driving', 'apple'), 'https://maps.apple.com/?daddr=' + encodeURIComponent('McFit, Hauptstraße 1, 10115 Berlin') + '&dirflg=d');
  assert.match(Core.routeUrl(gym, 'walking', 'apple'), /dirflg=w$/);
  assert.match(Core.routeUrl(gym, 'transit', 'apple'), /dirflg=r$/);
  assert.match(Core.routeUrl(gym, 'cycling', 'apple'), /^https:\/\/maps\.apple\.com\/directions\?destination=.+&mode=cycling$/);
  // Mit Standort: Koordinaten sind eindeutig und werden bevorzugt
  const pos = { name: 'Gym', address: 'Hauptstraße 1', lat: 52.5200081, lng: 13.4049541 };
  assert.equal(Core.routeUrl(pos, 'transit', 'google'), 'https://www.google.com/maps/dir/?api=1&destination=52.520008%2C13.404954&travelmode=transit');
  assert.match(Core.routeUrl(pos, 'cycling', 'google'), /travelmode=bicycling$/);
  assert.equal(Core.routeUrl({ lat: 1, lng: 2 }, 'unbekannt', 'apple'), 'https://maps.apple.com/?daddr=1%2C2&dirflg=d');
  // Übersteht normalize und wird nicht an Freunde geteilt
  const db = Core.normalize({ days: [], settings: { gym: pos } });
  assert.equal(db.settings.gym.lat, 52.520008);
  assert.ok(!JSON.stringify(Core.socialStats(db, Date.now(), [])).includes('52.52'));
});

test('Aufwärmsätze: Vorschlag aus dem Arbeitsgewicht', () => {
  assert.deepEqual(Core.warmupPlan(80, { inc: 2.5, bar: 20 }), [
    { weight: 20, reps: 10 }, { weight: 32.5, reps: 5 }, { weight: 47.5, reps: 3 }, { weight: 65, reps: 2 },
  ]);
  // Ohne Stange (z. B. Kurzhantel): nur die Prozent-Stufen
  assert.deepEqual(Core.warmupPlan('12', { inc: 2.5 }), [{ weight: 5, reps: 5 }, { weight: 7.5, reps: 3 }, { weight: 10, reps: 2 }]);
  // Leichte Langhantel: nichts unter der leeren Stange, nichts doppelt, nichts so schwer wie der Arbeitssatz
  assert.deepEqual(Core.warmupPlan(25, { inc: 2.5, bar: 20 }), [{ weight: 20, reps: 2 }]);
  assert.deepEqual(Core.warmupPlan(2.5, { inc: 2.5 }), []);
  assert.deepEqual(Core.warmupPlan(null), []);
  assert.deepEqual(Core.warmupPlan('abc'), []);
});

test('Aufwärmsätze zählen nicht für Sätze, Volumen, Rekorde und Steigerung – und kommen beim nächsten Mal wieder', () => {
  const { db, push } = freshDb();
  const day = db.days[0];
  Core.setRepTarget(db, push.id, day.exercises[0].id, 8, 10);
  // 1. Einheit: Aufwärmen + 3 Arbeitssätze
  const s = Core.startSession(db, push.id, T0);
  const se = s.exercises[0];
  assert.equal(se.sets.some((st) => st.warmup), false); // noch nie aufgewärmt → keine Aufwärmsätze
  Core.setWarmups(db, se.id, Core.warmupPlan(80, { inc: 2.5, bar: 20 }));
  assert.equal(se.sets.length, 4 + 3);
  assert.deepEqual(se.sets.slice(0, 4).map((st) => st.warmup), [true, true, true, true]);
  // Neuer Aufwärmsatz landet hinter den Aufwärmsätzen, vor dem ersten Arbeitssatz
  const extra = Core.addSet(db, se.id, true);
  assert.equal(se.sets.indexOf(extra), 4);
  Core.removeSet(db, se.id, extra.id);
  for (const st of se.sets) {
    if (!st.warmup) { Core.updateSet(db, se.id, st.id, 'weight', 80); Core.updateSet(db, se.id, st.id, 'reps', 10); }
    const r = Core.toggleSet(db, se.id, st.id, T0 + MIN);
    assert.equal(r.rest, st.warmup ? 60 : 120); // nach dem Aufwärmen nur kurze Pause
  }
  const done = Core.finishSession(db, T0 + 60 * MIN);
  const st = Core.sessionStats(done);
  assert.equal(st.sets, 3);
  assert.equal(st.volume, 3 * 800);
  assert.equal(done.exercises[0].sets.filter((x) => x.warmup).length, 4);

  // Letztes Mal = nur Arbeitssätze; Aufwärmsätze separat
  const prev = Core.lastPerformance(db, 'Bankdrücken');
  assert.equal(prev.sets.length, 3);
  assert.equal(prev.warmups.length, 4);
  // Alle Sätze am oberen Ende → Gewicht hoch (Aufwärmsätze mit 2–10 Wdh. stören nicht)
  assert.equal(Core.progression(prev, { min: 8, max: 10 }, 2.5, 3).kind, 'increase');

  // 2. Einheit: Aufwärmsätze werden wieder angelegt, Vorlagen passen zur Satzart
  const s2 = Core.startSession(db, push.id, T0 + 2 * 86400000);
  const se2 = s2.exercises[0];
  assert.deepEqual(se2.sets.map((x) => !!x.warmup), [true, true, true, true, false, false, false]);
  const ctx = Core.exerciseContext(db, se2);
  assert.deepEqual(Core.placeholderFor(ctx.prev, se2, 0, ctx), { weight: 20, reps: 10, note: '' });
  assert.deepEqual(Core.placeholderFor(ctx.prev, se2, 3, ctx), { weight: 65, reps: 2, note: '' });
  assert.equal(Core.placeholderFor(ctx.prev, se2, 4, ctx).weight, 82.5); // 1. Arbeitssatz: Steigerung
  // Satzanzahl im Plan ändern betrifft nur Arbeitssätze
  Core.setSetCount(db, push.id, se2.exId, 2);
  assert.equal(se2.sets.length, 4 + 2);
  assert.equal(Core.workSetCount(se2.sets), 2);
  // Nicht abgehakte Aufwärmsätze (übersprungen) werden nicht gespeichert
  const s3db = Core.normalize(JSON.parse(JSON.stringify(db)));
  const se3 = s3db.activeSession.exercises[0];
  for (const x of se3.sets) if (!x.warmup) { Core.updateSet(s3db, se3.id, x.id, 'weight', 80); Core.updateSet(s3db, se3.id, x.id, 'reps', 8); Core.toggleSet(s3db, se3.id, x.id, T0); }
  assert.equal(Core.workDone(se3), true);
  assert.equal(Core.warmupPassed(se3, se3.sets[0]), true);
  Core.updateSet(s3db, se3.id, se3.sets[0].id, 'weight', 20);
  assert.equal(Core.countLoggedSets(s3db.activeSession), 2); // 2 Arbeitssätze (Plan oben auf 2 gesetzt), Aufwärmsätze offen
  assert.equal(Core.finishSession(s3db, T0 + 3 * 86400000).exercises[0].sets.some((x) => x.warmup), false);
  // Offene Aufwärmsätze entfernen; abgehakte bleiben
  Core.toggleSet(db, se2.id, se2.sets[0].id, T0);
  Core.setWarmups(db, se2.id, []);
  assert.deepEqual(se2.sets.map((x) => !!x.warmup), [true, false, false]);

  // Rekorde: ein schwerer Aufwärmsatz ist kein Rekord
  Core.updateSet(db, se2.id, se2.sets[0].id, 'weight', 200);
  Core.updateSet(db, se2.id, se2.sets[0].id, 'reps', 1);
  for (const x of se2.sets.slice(1)) { Core.updateSet(db, se2.id, x.id, 'weight', 80); Core.updateSet(db, se2.id, x.id, 'reps', 8); }
  const d2 = Core.finishSession(db, T0 + 2 * 86400000 + 3600000);
  assert.deepEqual(Core.sessionRecords(db, d2), []);
  assert.equal(Core.exerciseStats(db)[0].best.weight, 80);
});

test('Aufwärmsätze überstehen Export/Import, alte Daten bleiben unverändert', () => {
  const { db, push } = freshDb();
  const s = Core.startSession(db, push.id, T0);
  Core.setWarmups(db, s.exercises[0].id, [{ weight: 20, reps: 10 }]);
  const again = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.equal(again.activeSession.exercises[0].sets[0].warmup, true);
  assert.equal('warmup' in again.activeSession.exercises[0].sets[1], false);
  const old = Core.normalize({ days: [], sessions: [{ id: 'a', finishedAt: T0, exercises: [{ name: 'X', sets: [{ weight: 50, reps: 5 }] }] }] });
  assert.equal('warmup' in old.sessions[0].exercises[0].sets[0], false);
});

/* ---------- Chat: Zeit in Wien, Prüfungen, Zusammenführen ---------- */

test('Chat-Zeit: Europe/Vienna, 24 h, Sommer- und Winterzeit', () => {
  // 18.10.2026 12:00 UTC = 14:00 in Wien (MESZ); 15.12.2026 12:00 UTC = 13:00 (MEZ)
  assert.equal(Core.fmtViennaTime(Date.UTC(2026, 9, 18, 12, 0)), '14:00');
  assert.equal(Core.fmtViennaTime(Date.UTC(2026, 11, 15, 12, 0)), '13:00');
  assert.equal(Core.fmtViennaTime(Date.UTC(2026, 11, 15, 22, 59)), '23:59');
  assert.equal(Core.fmtViennaTime(Date.UTC(2026, 11, 15, 23, 0)), '00:00'); // nie „24:00“
  // Wiener Datum + Uhrzeit → Zeitstempel (Umkehrung)
  assert.equal(Core.viennaTs('2026-10-18', '14:00'), Date.UTC(2026, 9, 18, 12, 0));
  assert.equal(Core.viennaTs('2026-12-15', '13:00'), Date.UTC(2026, 11, 15, 12, 0));
  assert.equal(Core.viennaTs('2026-07-01', '0:05'), Date.UTC(2026, 5, 30, 22, 5));
  // Zeitumstellung: 25.10.2026 (03:00 → 02:00) und 29.03.2026 (02:00 → 03:00)
  assert.equal(Core.viennaTs('2026-10-25', '12:00'), Date.UTC(2026, 9, 25, 11, 0));
  assert.equal(Core.viennaTs('2026-10-24', '12:00'), Date.UTC(2026, 9, 24, 10, 0));
  assert.equal(Core.viennaTs('2026-03-29', '12:00'), Date.UTC(2026, 2, 29, 10, 0));
  for (const [d, t] of [['2026-03-28', '23:30'], ['2026-03-29', '03:30'], ['2026-10-25', '01:30'], ['2026-10-25', '04:00']]) {
    const ts = Core.viennaTs(d, t);
    assert.equal(Core.viennaDayKey(ts), d);
    assert.equal(Core.fmtViennaTime(ts), t);
  }
  // Ungültiges
  assert.equal(Core.viennaTs('2026-02-31', '10:00'), null);
  assert.equal(Core.viennaTs('2026-10-18', '24:00'), null);
  assert.equal(Core.viennaTs('', ''), null);
  assert.equal(Core.viennaTs('18.10.2026', '10:00'), null);
});

test('Chat-Tage: Kalendertag in Wien, Tagesgrenzen und Beschriftungen', () => {
  // 18.10.2026 23:30 UTC ist in Wien schon der 19.10. (01:30)
  const late = Date.UTC(2026, 9, 18, 23, 30);
  assert.equal(Core.viennaDayKey(late), '2026-10-19');
  const [from, to] = Core.viennaDayRange(late);
  assert.equal(from, Date.UTC(2026, 9, 18, 22, 0));
  assert.equal(to, Date.UTC(2026, 9, 19, 22, 0));
  // Tag der Umstellung ist 25 Stunden lang
  const [f2, t2] = Core.viennaDayRange(Core.viennaTs('2026-10-25', '12:00'));
  assert.equal((t2 - f2) / 3600000, 25);

  const now = Core.viennaTs('2026-10-14', '18:30');
  const at = (d, t) => Core.viennaTs(d, t);
  assert.equal(Core.chatDayLabel(at('2026-10-14', '07:00'), now), 'Heute');
  assert.equal(Core.chatDayLabel(at('2026-10-13', '23:59'), now), 'Gestern');
  assert.equal(Core.chatDayLabel(at('2026-10-15', '00:01'), now), 'Morgen');
  assert.equal(Core.chatDayLabel(at('2026-10-19', '12:00'), now), 'Mo., 19.10.');
  assert.equal(Core.chatDayLabel(at('2027-01-04', '12:00'), now), 'Mo., 04.01.2027');
  assert.equal(Core.chatWhenLabel(at('2026-10-14', '18:00'), now), 'Heute, 18:00 Uhr');
  // Besuch gilt 90 Minuten nach dem Start als vorbei
  assert.equal(Core.chatCardPast({ when: now - 80 * 60000 }, now), false);
  assert.equal(Core.chatCardPast({ when: now - 100 * 60000 }, now), true);
});

test('Chat-Prüfungen: Text, Gym-Karte, Blockierliste', () => {
  assert.equal(Core.chatCheckText('  Ich bin um 18 Uhr da  '), 'Ich bin um 18 Uhr da');
  assert.equal(Core.chatCheckText('a\r\nb'), 'a\nb');
  assert.equal(Core.chatCheckText('   \n '), null);
  assert.equal(Core.chatCheckText(''), null);
  assert.equal(Core.chatCheckText(null), null);
  assert.equal(Core.chatCheckText('x'.repeat(500)).length, 500);
  assert.equal(Core.chatCheckText('x'.repeat(501)), null);

  const now = Core.viennaTs('2026-10-14', '12:00');
  const ok = Core.chatCheckCard({ date: '2026-10-14', time: '18:00', workout: 'push', note: '  Brust   und Schulter ' }, now);
  assert.deepEqual(ok, { when: Core.viennaTs('2026-10-14', '18:00'), workout: 'push', note: 'Brust und Schulter' });
  assert.equal(Core.chatCheckCard({ date: '2026-10-14', time: '18:00', workout: 'yoga', note: '' }, now).workout, ''); // unbekannte Art → keine
  assert.match(Core.chatCheckCard({ date: '', time: '18:00' }, now).error, /Datum/);
  assert.match(Core.chatCheckCard({ date: '2026-10-14', time: '09:00' }, now).error, /Vergangenheit/);
  assert.ok(Core.chatCheckCard({ date: '2026-10-14', time: '11:30' }, now).when); // 30 min zurück ist okay
  assert.match(Core.chatCheckCard({ date: '2027-03-01', time: '09:00' }, now).error, /60 Tage/);
  assert.ok(Core.chatCheckCard({ date: '2026-12-10', time: '09:00' }, now).when);
  assert.match(Core.chatCheckCard({ date: '2026-10-15', time: '09:00', note: 'n'.repeat(121) }, now).error, /Notiz/);

  assert.deepEqual(Core.normChatBlocked([{ uid: 'a', name: 'anna' }, { uid: 'a', name: 'doppelt' }, { uid: '' }, null, { uid: 'b', name: 'x'.repeat(50) }]),
    [{ uid: 'a', name: 'anna' }, { uid: 'b', name: 'x'.repeat(30) }]);
  assert.deepEqual(Core.normChatBlocked('kaputt'), []);
  assert.deepEqual(Core.normalize({ days: [], settings: { chatBlocked: [{ uid: 'u1', name: 'bob' }], chatNotify: false } }).settings.chatBlocked, [{ uid: 'u1', name: 'bob' }]);
  assert.equal(Core.normalize({ days: [], settings: { chatNotify: false } }).settings.chatNotify, false);
  assert.equal(Core.normalize({ days: [] }).settings.chatNotify, true);
  assert.deepEqual(Core.normalize({ days: [] }).settings.chatBlocked, []);
});

test('Chat-Listen: zusammenführen, „Heute im Gym“, Teilnehmer', () => {
  const m = (id, createdAt, extra) => ({ id, createdAt, kind: 'text', text: id, ...extra });
  const merged = Core.chatMerge([m('c', 30), m('b', 20, { text: 'neu' })], [m('b', 20, { text: 'alt' }), m('a', 10)]);
  assert.deepEqual(merged.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(merged[1].text, 'alt'); // spätere Liste gewinnt – die Reihenfolge der Argumente entscheidet
  assert.deepEqual(Core.chatMerge([m('b', 5), m('a', 5)]).map((x) => x.id), ['a', 'b']); // gleiche Zeit → nach ID

  const now = Core.viennaTs('2026-10-14', '12:00');
  const card = (id, d, t) => ({ id, kind: 'gym', when: Core.viennaTs(d, t) });
  const today = Core.chatPlansToday([
    card('abend', '2026-10-14', '19:00'), card('früh', '2026-10-14', '06:30'),
    card('gestern', '2026-10-13', '23:59'), card('morgen', '2026-10-15', '00:00'), { id: 't', kind: 'text', createdAt: 1 },
  ], now);
  assert.deepEqual(today.map((c) => c.id), ['früh', 'abend']);

  assert.deepEqual(Core.chatJoined({ joined: { u2: 'ben', u1: 'anna' } }), [{ uid: 'u1', name: 'anna' }, { uid: 'u2', name: 'ben' }]);
  assert.deepEqual(Core.chatJoined({}), []);
  assert.equal(Core.chatWorkoutLabel('legs'), 'Legs');
  assert.equal(Core.chatWorkoutLabel('x'), '');
});

test('Daily: Mealplan anlegen, ändern, sortieren, abhaken, löschen', () => {
  const db = Core.emptyData();
  assert.deepEqual(db.settings.mealPlan, []);
  assert.deepEqual(Core.emptyData().settings.mealPlan, []); // jede Datenbank hat ihre eigene Liste

  // ohne Namen wird nichts angelegt; Uhrzeit, Kalorien und Texte werden bereinigt
  assert.equal(Core.addMeal(db, { name: '   ' }), null);
  const a = Core.addMeal(db, { name: '  Frühstück ', time: '8:05', note: ' Haferflocken ', kcal: '520,4' });
  assert.deepEqual({ ...a, id: 0 }, { id: 0, name: 'Frühstück', time: '08:05', note: 'Haferflocken', kcal: 520 });
  const b = Core.addMeal(db, { name: 'Mittag', time: '25:99', kcal: -5 });
  assert.equal(b.time, '');
  assert.equal(b.kcal, null);
  const c = Core.addMeal(db, { name: 'Abend', time: '19:30' });
  assert.deepEqual(db.settings.mealPlan.map((m) => m.name), ['Frühstück', 'Mittag', 'Abend']);

  // ändern (Name darf nicht leer werden), verschieben
  assert.equal(Core.updateMeal(db, b.id, { name: '' }), null);
  assert.equal(Core.updateMeal(db, b.id, { name: 'Mittagessen', kcal: 740 }).kcal, 740);
  assert.equal(Core.moveMeal(db, 2, 0), true);
  assert.equal(Core.moveMeal(db, 0, 9), false);
  assert.deepEqual(db.settings.mealPlan.map((m) => m.name), ['Abend', 'Frühstück', 'Mittagessen']);

  // abhaken: pro Tag, wieder lösbar, Fortschritt und Kalorien
  const day = '2026-10-15';
  assert.equal(Core.toggleMeal(db, day, a.id), true);
  assert.equal(Core.toggleMeal(db, day, b.id), true);
  assert.deepEqual(Core.mealProgress(db, day), { done: 2, total: 3, kcalDone: 1260, kcalTotal: 1260 });
  assert.deepEqual(Core.mealProgress(db, '2026-10-14'), { done: 0, total: 3, kcalDone: 0, kcalTotal: 1260 });
  assert.equal(Core.toggleMeal(db, day, a.id), false);
  assert.deepEqual(Core.mealsDone(db, day), [b.id]);
  assert.equal(Core.toggleMeal(db, 'kaputt', a.id), false); // ungültiger Tag
  assert.equal(Core.toggleMeal(db, day, 'gibt-es-nicht'), false);
  assert.equal(Core.toggleMeal(db, day, b.id), false); // letzte gelöst → Tag verschwindet aus dem Verlauf
  assert.deepEqual(db.settings.mealLog, {});

  // Wochenstreifen: 7 Tage, älteste zuerst, endet am angegebenen Tag
  Core.toggleMeal(db, day, c.id);
  const week = Core.mealWeek(db, day, 7);
  assert.equal(week.length, 7);
  assert.equal(week[6].key, day);
  assert.equal(week[0].key, '2026-10-09');
  assert.equal(week[6].done, 1);
  assert.equal(week[5].done, 0);

  // Löschen räumt auch den Verlauf auf
  assert.equal(Core.deleteMeal(db, c.id), true);
  assert.deepEqual(db.settings.mealLog, {});
  assert.equal(db.settings.mealPlan.length, 2);

  // höchstens 20 Mahlzeiten
  while (Core.addMeal(db, { name: 'x' })) { /* auffüllen */ }
  assert.equal(db.settings.mealPlan.length, 20);
});

test('Daily: Mealplan übersteht Speichern, Import und Cloud-Abgleich (bereinigt)', () => {
  const db = Core.emptyData();
  Core.sampleMeals().forEach((m) => Core.addMeal(db, m));
  Core.toggleMeal(db, '2026-10-15', db.settings.mealPlan[1].id);
  const copy = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.deepEqual(copy.settings.mealPlan, db.settings.mealPlan);
  assert.deepEqual(copy.settings.mealLog, db.settings.mealLog);

  // Müll wird entfernt: doppelte IDs, falsche Tage, leere Listen, uralte Einträge
  const dirty = Core.normalize({ days: [], settings: {
    mealPlan: [{ id: 'a', name: 'A' }, { id: 'a', name: 'doppelt' }, null, 'x', { id: 'b' }],
    mealLog: { '2026-10-15': ['a', 'a', 7], 'morgen': ['a'], '2026-10-14': [] },
  } });
  assert.deepEqual(dirty.settings.mealPlan.map((m) => [m.id, m.name]), [['a', 'A'], ['b', 'Mahlzeit']]);
  assert.deepEqual(dirty.settings.mealLog, { '2026-10-15': ['a', '7'] });
  assert.deepEqual(Core.normalize({ days: [] }).settings.mealPlan, []);
  const many = {};
  for (let i = 0; i < 500; i++) many[new Date(2025, 0, 1 + i, 12).toISOString().slice(0, 10)] = ['a'];
  assert.equal(Object.keys(Core.normMealLog(many)).length, 400);
});

test('Daily: Gewicht für einen Tag eintragen und ändern (gleiche Messungen wie im Verlauf)', () => {
  const db = Core.emptyData();
  const day = '2026-10-15';
  assert.equal(Core.weightOn(db, day), null);
  assert.equal(Core.setWeightOn(db, day, '5'), null);      // zu leicht
  assert.equal(Core.setWeightOn(db, day, '600'), null);    // zu schwer
  assert.equal(Core.setWeightOn(db, day, 'abc'), null);
  const first = Core.setWeightOn(db, day, '82,46');
  assert.equal(first.weight, 82.5);
  assert.equal(Core.dayKey(first.date), day);
  assert.equal(db.body.length, 1);

  // am selben Tag ändern statt doppelt anlegen – andere Maße der Messung bleiben
  Core.saveBodyEntry(db, { ...first, waist: 90 });
  const again = Core.setWeightOn(db, day, 81.9);
  assert.equal(again.id, first.id);
  assert.equal(db.body.length, 1);
  assert.equal(db.body[0].waist, 90);
  assert.equal(Core.weightOn(db, day).weight, 81.9);

  // vorheriger Wert für „± seit …“
  assert.equal(Core.weightBefore(db, day), null);
  Core.setWeightOn(db, '2026-10-12', 83.4);
  assert.equal(Core.weightBefore(db, day).weight, 83.4);
  assert.equal(Core.weightBefore(db, '2026-10-12'), null);
  assert.deepEqual(db.body.map((e) => e.weight), [83.4, 81.9]);
});

test('Das Kalorien-Tagebuch gibt es nicht mehr: alte Felder in Backups werden ignoriert, nichts bricht', () => {
  const old = Core.normalize({
    days: [], nutrition: [{ id: 'n1', date: '2026-10-01', meal: 'lunch', name: 'Reis', kcal: 200 }],
    foods: [{ id: 'f1', name: 'Quark', kcal: 67 }],
    settings: { calorieGoal: 2200, proteinGoal: 140, carbGoal: 200, fatGoal: 70, weeklyGoal: 4 },
  });
  assert.equal(old.nutrition, undefined);
  assert.equal(old.foods, undefined);
  assert.equal(old.settings.calorieGoal, undefined);
  assert.equal(old.settings.proteinGoal, undefined);
  assert.equal(old.settings.weeklyGoal, 4);
  assert.deepEqual(Object.keys(Core.emptyData()).sort(), ['activeSession', 'body', 'customExercises', 'days', 'libMeta', 'sessions', 'settings', 'version']);
});

test('Liquid-Glass-Regler: 0…100, ganze Zahl, Vorgabe 50; kaputte Werte fallen auf die Vorgabe zurück', () => {
  assert.equal(util.clampGlass(0), 0);
  assert.equal(util.clampGlass(100), 100);
  assert.equal(util.clampGlass(37.6), 38);
  assert.equal(util.clampGlass(-20), 0);
  assert.equal(util.clampGlass(250), 100);
  for (const bad of [undefined, null, '', 'abc', NaN]) assert.equal(util.clampGlass(bad), 0, String(bad));
  const db = Core.normalize({ days: [], settings: { glass: 999 } });
  assert.equal(db.settings.glass, 100);
  assert.equal(Core.normalize({ days: [], settings: {} }).settings.glass, 0);
  assert.equal(Core.normalize({ days: [], settings: { glass: 'x' } }).settings.glass, 0);
  assert.equal(Core.emptyData().settings.glass, 0);
});

test('Buchstaben-Avatare: Anfangsbuchstabe groß, Farbe stabil pro Name und breit gestreut', () => {
  const { avatarInitial, avatarIndex, AVATAR_COLORS } = util;
  assert.equal(avatarInitial('anna'), 'A');
  assert.equal(avatarInitial('  @ben '), 'B');
  assert.equal(avatarInitial('émile'), 'É');
  assert.equal(avatarInitial('ßeta'), 'S');       // ß wird zu „SS“ – nur ein Buchstabe
  assert.equal(avatarInitial('😀x'), '😀');        // Emoji bleibt ganz (kein halbes Zeichen)
  assert.equal(avatarInitial(''), '?');
  assert.equal(avatarInitial(null), '?');
  assert.equal(avatarIndex('Anna'), avatarIndex('anna'));       // Groß-/Kleinschreibung egal
  assert.equal(avatarIndex('@anna'), avatarIndex('anna'));
  assert.equal(avatarIndex('anna'), avatarIndex('anna'));       // stabil
  const names = ['anna', 'ben', 'cleo', 'dora', 'emil', 'finn', 'gina', 'hugo', 'ida', 'jonas', 'kira', 'leon', 'mia', 'noah', 'olga', 'paul', 'quinn', 'rosa', 'sam', 'tina'];
  const idx = names.map(avatarIndex);
  for (const i of idx) assert.ok(i >= 0 && i < AVATAR_COLORS);
  assert.ok(new Set(idx).size >= 6, 'Farben zu wenig gestreut: ' + [...new Set(idx)]);
});
