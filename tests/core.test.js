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
  assert.deepEqual(db.nutrition, []);
  assert.deepEqual(db.foods, []);
  assert.deepEqual(db.customExercises, []);
  assert.deepEqual(db.libMeta, {});
  assert.equal(db.settings.calorieGoal, 2000);
  assert.equal(db.settings.proteinGoal, 150);
  assert.equal(db.days[0].exercises[0].libId, null);
  assert.equal(db.days[0].name, 'Push');
  assert.equal(db.sessions.length, 1);
  assert.equal(Core.lastPerformance(db, 'Bankdrücken').sets[0].weight, 80);
});

test('Open Food Facts: Parser uebernimmt vorhandene Werte, fehlende bleiben null', () => {
  const ok = Core.parseOFF({ status: 1, product: {
    code: '4000417025005', product_name: 'Haferflocken', brands: 'Kölln, Marke',
    serving_size: '40 g', nutriments: { 'energy-kcal_100g': 372, 'proteins_100g': 13.5, 'carbohydrates_100g': 58.7, 'fat_100g': 7 },
  } });
  assert.deepEqual(ok, { barcode: '4000417025005', name: 'Haferflocken', brand: 'Kölln', kcal: 372, protein: 13.5, carbs: 58.7, fat: 7, serving: 40, custom: false });
  const partial = Core.parseOFF({ status: 1, product: { code: '1', product_name: 'X', nutriments: { 'energy-kcal_100g': 100, 'proteins_100g': 5 } } });
  assert.equal(partial.fat, null);
  assert.equal(partial.carbs, null);
  assert.equal(partial.serving, null);
  assert.equal(Core.parseOFF({ status: 0 }), null);
  assert.equal(Core.parseOFF(null), null);
});

test('Portionsumrechnung: unbekannte Naehrwerte bleiben null', () => {
  const food = { kcal: 372, protein: 13.5, carbs: 58.7, fat: null };
  assert.deepEqual(Core.scaleFood(food, 40), { kcal: 148.8, protein: 5.4, carbs: 23.5, fat: null });
  assert.deepEqual(Core.scaleFood(food, 0), { kcal: 0, protein: 0, carbs: 0, fat: null });
});

test('Ernaehrungseintraege: hinzufuegen, Tagessumme, aendern, loeschen', () => {
  const db = Core.emptyData();
  const today = Core.dayKey(Date.now());
  Core.addNutrition(db, { date: today, meal: 'breakfast', name: 'Haferflocken', kcal: 149, protein: 5.4, carbs: 23.5, fat: 3, grams: 40 });
  Core.addNutrition(db, { date: today, meal: 'lunch', name: 'Reis', kcal: 200, protein: 4, carbs: 44, fat: null });
  Core.addNutrition(db, { date: '2020-01-01', meal: 'snack', name: 'Alt', kcal: 999 });
  assert.deepEqual(Core.dayTotals(db, today), { kcal: 349, protein: 9.4, carbs: 67.5, fat: 3 });
  assert.equal(Core.nutritionForDay(db, today).length, 2);
  const id = db.nutrition.find((n) => n.name === 'Reis').id;
  Core.updateNutrition(db, id, { kcal: 250 });
  assert.equal(Core.dayTotals(db, today).kcal, 399);
  Core.deleteNutrition(db, id);
  assert.equal(Core.nutritionForDay(db, today).length, 1);
  Core.addNutrition(db, { date: today, meal: 'snack', name: 'Apfel', kcal: 80 });
  const apfel = db.nutrition.find((n) => n.name === 'Apfel');
  assert.equal(apfel.protein, null);
  assert.equal(apfel.grams, null);
});

test('Lebensmittel: speichern, per Barcode finden, Favorit, Suche', () => {
  const db = Core.emptyData();
  const a = Core.saveFood(db, { barcode: '111', name: 'Magerquark', brand: 'Milbona', kcal: 67, protein: 12, carbs: 4, fat: 0.2 });
  Core.saveFood(db, { barcode: '222', name: 'Vollkornbrot', kcal: 220, protein: 8 });
  assert.equal(Core.findFoodByBarcode(db, '111').name, 'Magerquark');
  assert.equal(Core.findFoodByBarcode(db, '999'), null);
  Core.saveFood(db, Object.assign({}, a, { kcal: 68 }));
  assert.equal(db.foods.length, 2);
  assert.equal(Core.foodById(db, a.id).kcal, 68);
  Core.toggleFoodFavorite(db, a.id);
  Core.markFoodUsed(db, db.foods[1].id, T0);
  assert.equal(Core.searchFoods(db, '')[0].name, 'Magerquark');
  assert.equal(Core.searchFoods(db, 'quark').length, 1);
  Core.deleteFood(db, a.id);
  assert.equal(db.foods.length, 1);
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
  Core.addNutrition(db, { date: Core.dayKey(T0), meal: 'lunch', name: 'Reis', kcal: 200, protein: 4, carbs: 44, fat: 1, grams: 100 });
  Core.saveFood(db, { barcode: '111', name: 'Magerquark', kcal: 67, protein: 12 });
  Core.toggleLibFav(db, 'kniebeugen');
  Core.saveCustomExercise(db, { name: 'Custom', muscle: 'Bauch', equipment: 'Körpergewicht', type: 'Isolation', steps: ['x'] });
  const exported = JSON.parse(JSON.stringify({ app: 'gym-tracker', version: 2, data: db }));
  const back = Core.normalize(exported);
  assert.deepEqual(back.nutrition, db.nutrition);
  assert.deepEqual(back.foods, db.foods);
  assert.deepEqual(back.customExercises, db.customExercises);
  assert.deepEqual(back.libMeta, db.libMeta);
  assert.equal(back.days[0].exercises[0].libId, 'bankdruecken-lh');
});
