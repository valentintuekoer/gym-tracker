// Tests für die Freundes-Kennzahlen (reine Logik, ohne Browser/Firebase). Ausführen mit: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core } = require('../app.js');

const DAY = 86400000;
const NOW = new Date('2026-09-24T18:00:00').getTime(); // Donnerstag
const LIB = [
  { id: 'bankdruecken-lh', name: 'Bankdrücken', aliases: ['bench press'] },
  { id: 'kniebeuge-lh', name: 'Kniebeugen', aliases: ['squat'] },
];

function session(db, at, exercises, dayId) {
  db.sessions.push({
    id: 's' + db.sessions.length, dayId: dayId || null, dayName: 'T', startedAt: at - 3600000, finishedAt: at,
    exercises: exercises.map(([name, sets, exId]) => ({ exId: exId || null, name, sets: sets.map(([w, r]) => ({ weight: w, reps: r, note: '', done: true })) })),
  });
  db.sessions.sort((a, b) => a.finishedAt - b.finishedAt);
}

test('Benutzername: Normalisierung und Prüfung', () => {
  assert.equal(Core.normUsername('  @Max.Muster '), 'max.muster');
  assert.equal(Core.usernameError('max_1'), null);
  assert.equal(Core.usernameError('ab'), 'Mindestens 3 Zeichen.');
  assert.ok(Core.usernameError('a'.repeat(21)));
  assert.ok(Core.usernameError('_max'));
  assert.ok(Core.usernameError('max muster'));
  assert.ok(Core.usernameError('mäx'));
});

test('socialStats: Tage, Volumen, Rekorde über die feste Bibliotheks-ID', () => {
  const db = Core.emptyData();
  const day = Core.addDay(db, 'Push');
  const ex = Core.addExercise(db, day.id, 'Flachbank', 90, 3, 'bankdruecken-lh'); // anderer Name, aber verknüpft
  session(db, NOW - 2 * DAY, [['Flachbank', [[80, 8], [82.5, 6]], ex.id]], day.id);
  session(db, NOW - 1 * DAY, [['bench press', [[85, 5]]], ['Eigene Übung', [[20, 10]]]]);
  const st = Core.socialStats(db, NOW, LIB);
  assert.equal(st.total, 2);
  assert.equal(st.last, NOW - DAY);
  assert.deepEqual(st.days[Core.dayKey(NOW - 2 * DAY)], [1, 80 * 8 + 82.5 * 6]);
  assert.deepEqual(st.days[Core.dayKey(NOW - DAY)], [1, 85 * 5 + 200]);
  assert.deepEqual(Object.keys(st.records), ['bankdruecken-lh']); // eigene Übung wird nicht geteilt
  assert.equal(st.records['bankdruecken-lh'].w, 85);
  assert.equal(st.records['bankdruecken-lh'].e, Math.round(80 * (1 + 8 / 30) * 10) / 10); // 80×8 > 85×5
  assert.equal(st.records['bankdruecken-lh'].r, 8);
  assert.equal(st.fav, 'bankdruecken-lh');
  // Keine Sätze, Notizen, Namen oder Pläne in den geteilten Daten
  const json = JSON.stringify(st);
  assert.ok(!json.includes('Flachbank') && !json.includes('Eigene') && !json.includes('note'));
});

test('socialStats: Rekorde abschaltbar, alte Tage (> 1 Jahr) werden nicht geteilt', () => {
  const db = Core.emptyData();
  session(db, NOW - 400 * DAY, [['Kniebeugen', [[100, 5]]]]);
  session(db, NOW, [['Kniebeugen', [[110, 5]]]]);
  const st = Core.socialStats(db, NOW, LIB, { shareRecords: false });
  assert.deepEqual(st.records, {});
  assert.equal(st.fav, null);
  assert.equal(Object.keys(st.days).length, 1);
  assert.equal(st.total, 2);
});

test('socialMetrics: Woche, Monat, Volumen 7/30 Tage und Serie', () => {
  const days = {};
  const add = (ts, n, v) => { days[Core.dayKey(ts)] = [n, v]; };
  add(NOW, 1, 1000);                 // Do (diese Woche)
  add(NOW - 3 * DAY, 1, 2000);       // Mo (diese Woche)
  add(NOW - 8 * DAY, 2, 500);        // Vorwoche
  add(NOW - 14 * DAY, 2, 500);       // vor 2 Wochen
  add(NOW - 20 * DAY, 2, 500);       // vor 3 Wochen (Fr)
  add(NOW - 40 * DAY, 3, 9999);      // außerhalb 30 Tage
  const m = Core.socialMetrics({ goal: 2, total: 11, last: NOW, days }, NOW);
  assert.equal(m.week, 2);
  assert.equal(m.month, 2 + 2 + 2 + 2); // 1.–24. September
  assert.equal(m.vol7, 3000);
  assert.equal(m.vol30, 4500);
  assert.equal(m.streak, 4);            // diese Woche erreicht + 3 Wochen davor
  assert.equal(m.total, 11);
});

test('socialMetrics: veraltete Daten eines Freundes zählen nicht als „diese Woche“', () => {
  const days = { [Core.dayKey(NOW - 30 * DAY)]: [3, 100] };
  const m = Core.socialMetrics({ goal: 3, total: 3, days }, NOW);
  assert.equal(m.week, 0);
  assert.equal(m.vol7, 0);
  assert.equal(m.streak, 0);
  // Ungültige Daten werfen nicht
  assert.equal(Core.socialMetrics(null, NOW).total, 0);
  assert.equal(Core.socialMetrics({ days: { x: 'y', '2026-01-01': 'kaputt' } }, NOW).week, 0);
});

test('socialMetrics und weekStats liefern dieselbe Serie', () => {
  const db = Core.emptyData();
  db.settings.weeklyGoal = 2;
  for (let w = 0; w < 5; w++) { session(db, NOW - w * 7 * DAY, [['Kniebeugen', [[100, 5]]]]); session(db, NOW - w * 7 * DAY - DAY, [['Kniebeugen', [[100, 5]]]]); }
  const m = Core.socialMetrics(Core.socialStats(db, NOW, LIB), NOW);
  assert.equal(m.streak, Core.weekStats(db, NOW, 2).streak);
  assert.equal(m.streak, 5);
});

test('commonRecords: nur Übungen, die beide teilen', () => {
  const mine = { records: { a: { w: 100 }, b: { w: 50 } } };
  const theirs = { records: { b: { w: 60 }, c: { w: 10 } } };
  assert.deepEqual(Core.commonRecords(mine, theirs), [{ id: 'b', me: { w: 50 }, them: { w: 60 } }]);
  assert.deepEqual(Core.commonRecords(mine, { records: {} }), []);
  assert.deepEqual(Core.commonRecords(mine, null), []);
});

test('rankBy: absteigend, gleiche Werte teilen den Platz', () => {
  const r = Core.rankBy([
    { uid: 'a', name: 'anna', metrics: { week: 2 } },
    { uid: 'me', name: 'ich', me: true, metrics: { week: 3 } },
    { uid: 'b', name: 'ben', metrics: { week: 3 } },
    { uid: 'c', name: 'carl', metrics: {} },
  ], 'week');
  assert.deepEqual(r.map((e) => [e.uid, e.rank]), [['me', 1], ['b', 1], ['a', 3], ['c', 4]]);
});

test('activityText', () => {
  assert.equal(Core.activityText(NOW - 3600000, NOW), 'heute trainiert');
  assert.equal(Core.activityText(NOW - 3 * DAY, NOW), 'vor 3 Tagen trainiert');
  assert.match(Core.activityText(NOW - 30 * DAY, NOW), /^zuletzt am \d\d\.\d\d\.\d{4}$/);
  assert.equal(Core.activityText(null, NOW), 'noch kein Training');
});

test('Einstellung „Rekorde teilen“ ist standardmäßig an und übersteht normalize', () => {
  assert.equal(Core.emptyData().settings.shareRecords, true);
  assert.equal(Core.normalize({ days: [], settings: { shareRecords: false } }).settings.shareRecords, false);
  assert.equal(Core.normalize({ days: [] }).settings.shareRecords, true);
});
