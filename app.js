/* Gym Tracker – App-Logik
 *
 * Aufbau der Datei:
 *   1. Hilfsfunktionen
 *   2. Core      – Datenmodell & reine Logik (kein DOM, in Node testbar)
 *   3. TimerCore – Berechnungen für den zeitstempelbasierten Pausentimer
 *   4. UI        – Speicher, Audio, Wake Lock, Timer-Leiste, Dialoge, Ansichten, Events
 *
 * Datenmodell (alles in einem JSON-Objekt in localStorage):
 *   days:          [{ id, name, exercises: [{ id, name, rest }] }]
 *   sessions:      [{ id, dayId, dayName, startedAt, finishedAt,
 *                     exercises: [{ exId, name, sets: [{ weight, reps, note, done }] }] }]
 *   activeSession: laufende Einheit (wie session, aber mit Satz-IDs und ohne finishedAt) oder null
 *   settings:      { defaultRest, sound, vibrate, loudMode, theme, lastBackup }
 *
 * Übungen werden im Verlauf über ihren (normalisierten) Namen zugeordnet. So teilen sich
 * z. B. "Bankdrücken" in "Push A" und "Push B" denselben Verlauf.
 */
'use strict';

(function () {

  /* =========================================================
   * 1. Hilfsfunktionen
   * ========================================================= */

  const DATA_VERSION = 1;
  const MAX_REST = 1800;
  const DEFAULT_SETS = 3;  // Sätze pro Übung, wenn nichts anderes eingestellt ist
  const MAX_SETS = 20;

  const DEFAULT_SETTINGS = {
    defaultRest: 90,   // Standardpause für neue Übungen (Sekunden)
    sound: true,       // Signalton am Pausenende
    vibrate: true,     // Vibration am Pausenende (wo unterstützt)
    loudMode: false,   // iOS: Ton auch bei Lautlos-Schalter
    theme: 'dark',     // 'dark' | 'light' | 'system'
    lastBackup: null,  // Zeitstempel des letzten Exports
    increment: 2.5,    // Gewichtsschritt (kg) für Steigerungsvorschläge und +/−-Buttons
    weeklyGoal: 3,     // Trainings pro Woche (für Wochenziel & Serie)
    effort: 'off',     // Anstrengung pro Satz erfassen: 'off' | 'rir' | 'rpe'
  };

  /** Körpermaße: Schlüssel, Bezeichnung, Einheit */
  const BODY_FIELDS = [
    ['weight', 'Körpergewicht', 'kg'],
    ['bodyfat', 'Körperfett', '%'],
    ['waist', 'Taille', 'cm'],
    ['chest', 'Brust', 'cm'],
    ['hips', 'Hüfte', 'cm'],
    ['arm', 'Oberarm', 'cm'],
    ['thigh', 'Oberschenkel', 'cm'],
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  /** Liest eine Zahl aus einem Eingabefeld (Komma oder Punkt). Leer/ungültig → null. */
  function parseNum(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /** Zahl im deutschen Format (Komma), max. 2 Nachkommastellen. */
  function fmtNum(n) {
    if (n === null || n === undefined) return '';
    return String(Math.round(n * 100) / 100).replace('.', ',');
  }

  function fmtInt(n) {
    return Math.round(n).toLocaleString('de-DE');
  }

  /** Sekunden → "m:ss" */
  function fmtClock(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtShortDate(ts) {
    return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }

  function fmtLongDate(ts) {
    return new Date(ts).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDuration(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
  }

  function fmtRest(sec) {
    if (sec < 60 || sec % 60 !== 0 && sec < 120) return sec + ' s';
    return sec % 60 === 0 ? (sec / 60) + ' min' : fmtClock(sec) + ' min';
  }

  /** "heute", "gestern", "vor 3 Tagen" oder Datum */
  function fmtRelative(ts, now) {
    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((day(now) - day(ts)) / 86400000);
    if (diff <= 0) return 'heute';
    if (diff === 1) return 'gestern';
    if (diff < 7) return 'vor ' + diff + ' Tagen';
    return fmtDate(ts);
  }

  /** Einzelner Satz als Text, z. B. "80 kg × 8" */
  function fmtSet(st) {
    const w = st.weight !== null && st.weight !== undefined;
    const r = st.reps !== null && st.reps !== undefined;
    if (w && r) return fmtNum(st.weight) + ' kg × ' + st.reps;
    if (w) return fmtNum(st.weight) + ' kg';
    if (r) return st.reps + ' Wdh.';
    return '–';
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Schlüssel, über den Übungen im Verlauf zusammengefasst werden. */
  function normName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function clampRest(v, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback === undefined ? DEFAULT_SETTINGS.defaultRest : fallback;
    return Math.min(MAX_REST, Math.max(0, n));
  }

  function clampSets(v, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1) return fallback === undefined ? DEFAULT_SETS : fallback;
    return Math.min(MAX_SETS, n);
  }

  function fmtSets(n) {
    return n + (n === 1 ? ' Satz' : ' Sätze');
  }

  function clampIncrement(v) {
    const n = parseNum(v);
    return n === null || n <= 0 ? DEFAULT_SETTINGS.increment : Math.min(50, Math.round(n * 100) / 100);
  }

  /** Wiederholungs-Ziel lesen: "8-12", "8–12", "8 bis 12" oder "10". Leer → null, ungültig → undefined. */
  function parseRepTarget(v) {
    const t = String(v === null || v === undefined ? '' : v).trim();
    if (!t) return null;
    const m = t.match(/^(\d{1,3})\s*(?:[-–—]|bis)\s*(\d{1,3})$/i) || t.match(/^(\d{1,3})$/);
    if (!m) return undefined;
    let a = Number(m[1]), b = Number(m[2] || m[1]);
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > 100) return undefined;
    return { min: a, max: b };
  }

  function fmtRepTarget(min, max) {
    if (!min) return '';
    return (min === max ? String(min) : min + '–' + max) + ' Wdh.';
  }

  /** Geschätztes 1RM nach Epley. */
  function e1rm(weight, reps) {
    if (!weight || !reps || reps < 1) return null;
    if (reps === 1) return weight;
    return weight * (1 + reps / 30);
  }

  /* =========================================================
   * 2. Core – Datenmodell & Logik
   * ========================================================= */

  const Core = {};

  Core.emptyData = function () {
    return { version: DATA_VERSION, days: [], sessions: [], activeSession: null, body: [], settings: { ...DEFAULT_SETTINGS } };
  };

  /** Ziel-Wiederholungen einer Übung (beide null = kein Ziel). */
  function repTargetFields(min, max) {
    const t = parseRepTarget(min ? (max && max !== min ? min + '-' + max : String(min)) : '');
    return t ? { repMin: t.min, repMax: t.max } : { repMin: null, repMax: null };
  }

  function newPlanExercise(name, rest, sets) {
    return { id: uid(), name, rest, sets, repMin: null, repMax: null, note: '' };
  }

  Core.sampleDays = function () {
    const mk = (name, list) => ({
      id: uid(), name,
      exercises: list.map(([n, rest]) => newPlanExercise(n, rest, DEFAULT_SETS)),
    });
    return [
      mk('Push', [['Bankdrücken', 120], ['Schulterdrücken', 90], ['Trizeps-Pushdowns', 60]]),
      mk('Pull', [['Klimmzüge', 120], ['Langhantelrudern', 90], ['Bizepscurls', 60]]),
      mk('Beine', [['Kniebeugen', 150], ['Rumänisches Kreuzheben', 120], ['Wadenheben', 60]]),
    ];
  };

  /** Leere Daten plus Beispiel-Trainingstage (nur noch auf Wunsch über die Einstellungen). */
  Core.sampleData = function () {
    const db = Core.emptyData();
    db.days = Core.sampleDays();
    return db;
  };

  function normSet(st, withId) {
    const out = {
      weight: parseNum(st && st.weight),
      reps: parseNum(st && st.reps),
      note: String((st && st.note) || ''),
      done: !!(st && st.done),
    };
    if (out.reps !== null) out.reps = Math.round(out.reps);
    for (const k of ['rir', 'rpe']) {
      const v = clampEffort(st && st[k]);
      if (v !== null) out[k] = v;
    }
    if (withId) out.id = String((st && st.id) || uid());
    return out;
  }

  /** RIR/RPE: 0–10, halbe Schritte erlaubt. */
  function clampEffort(v) {
    const n = parseNum(v);
    return n === null ? null : Math.min(10, Math.round(n * 2) / 2);
  }

  /** Körpermessung bereinigen. */
  function normBodyEntry(e) {
    const out = { id: String(e.id || uid()), date: Number(e.date), note: String(e.note || '') };
    for (const [k] of BODY_FIELDS) {
      const v = parseNum(e[k]);
      out[k] = v === null ? null : Math.round(v * 10) / 10;
    }
    return out;
  }

  /**
   * Prüft und bereinigt Daten (z. B. aus einem Import). Wirft einen Fehler,
   * wenn die Struktur nicht zu dieser App passt.
   */
  Core.normalize = function (raw) {
    if (raw && raw.app === 'gym-tracker' && raw.data) raw = raw.data; // Export-Hülle
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days)) {
      throw new Error('Die Datei enthält keine Gym-Tracker-Daten.');
    }
    const db = Core.emptyData();
    db.settings = { ...DEFAULT_SETTINGS, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) };
    db.settings.defaultRest = clampRest(db.settings.defaultRest);
    db.settings.increment = clampIncrement(db.settings.increment);
    db.settings.weeklyGoal = Math.min(7, Math.max(1, Math.round(Number(db.settings.weeklyGoal)) || DEFAULT_SETTINGS.weeklyGoal));
    if (!['off', 'rir', 'rpe'].includes(db.settings.effort)) db.settings.effort = 'off';

    db.body = (Array.isArray(raw.body) ? raw.body : [])
      .filter((e) => e && Number.isFinite(Number(e.date)))
      .map(normBodyEntry)
      .sort((a, b) => a.date - b.date);

    db.days = raw.days.filter((d) => d && typeof d === 'object').map((d) => ({
      id: String(d.id || uid()),
      name: String(d.name || 'Trainingstag'),
      exercises: (Array.isArray(d.exercises) ? d.exercises : []).filter(Boolean).map((e) => ({
        id: String(e.id || uid()),
        name: String(e.name || 'Übung'),
        rest: clampRest(e.rest, db.settings.defaultRest),
        sets: clampSets(e.sets, null), // fehlt bei älteren Daten → unten ergänzt
        ...repTargetFields(e.repMin, e.repMax),
        note: String(e.note || ''),
      })),
    }));

    db.sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
      .filter((s) => s && Array.isArray(s.exercises) && Number.isFinite(Number(s.finishedAt)))
      .map((s) => ({
        id: String(s.id || uid()),
        dayId: s.dayId ? String(s.dayId) : null,
        dayName: String(s.dayName || 'Training'),
        startedAt: Number(s.startedAt) || Number(s.finishedAt),
        finishedAt: Number(s.finishedAt),
        exercises: s.exercises.filter((e) => e && Array.isArray(e.sets)).map((e) => ({
          exId: e.exId ? String(e.exId) : null,
          name: String(e.name || 'Übung'),
          sets: e.sets.map((st) => normSet(st, false)),
        })),
      }))
      .sort((a, b) => a.finishedAt - b.finishedAt);

    // Ältere Daten ohne Satzanzahl: so viele Sätze wie beim letzten Training (sonst Standard)
    for (const d of db.days) {
      for (const e of d.exercises) {
        if (e.sets !== null) continue;
        const prev = Core.lastPerformance(db, e.name);
        e.sets = prev ? clampSets(prev.sets.length) : DEFAULT_SETS;
      }
    }

    const a = raw.activeSession;
    if (a && typeof a === 'object' && Array.isArray(a.exercises)) {
      db.activeSession = {
        id: String(a.id || uid()),
        dayId: a.dayId ? String(a.dayId) : null,
        dayName: String(a.dayName || 'Training'),
        startedAt: Number(a.startedAt) || Date.now(),
        customOrder: !!a.customOrder, // Reihenfolge im Training geändert → nicht mehr dem Plan folgen
        exercises: a.exercises.filter((e) => e && Array.isArray(e.sets)).map((e) => ({
          id: String(e.id || uid()),
          exId: e.exId ? String(e.exId) : null,
          name: String(e.name || 'Übung'),
          rest: clampRest(e.rest, db.settings.defaultRest),
          skipped: !!e.skipped,
          sets: e.sets.map((st) => normSet(st, true)),
        })),
      };
    }
    return db;
  };

  /* ---------- Trainingstage ---------- */

  Core.findDay = (db, dayId) => db.days.find((d) => d.id === dayId) || null;

  Core.addDay = function (db, name) {
    const day = { id: uid(), name: String(name).trim() || 'Neuer Tag', exercises: [] };
    db.days.push(day);
    return day;
  };

  Core.renameDay = function (db, dayId, name) {
    const day = Core.findDay(db, dayId);
    if (!day || !String(name).trim()) return false;
    day.name = String(name).trim();
    if (db.activeSession && db.activeSession.dayId === dayId) db.activeSession.dayName = day.name;
    return true;
  };

  /** Kopie direkt hinter dem Original einfügen (neue IDs, gleiche Übungen). */
  Core.duplicateDay = function (db, dayId) {
    const idx = db.days.findIndex((d) => d.id === dayId);
    if (idx < 0) return null;
    const src = db.days[idx];
    const copy = {
      id: uid(),
      name: src.name + ' (Kopie)',
      exercises: src.exercises.map((e) => ({ ...e, id: uid() })),
    };
    db.days.splice(idx + 1, 0, copy);
    return copy;
  };

  /** Löscht den Tag. Eine laufende Einheit dieses Tages wird verworfen, der Verlauf bleibt. */
  Core.deleteDay = function (db, dayId) {
    const before = db.days.length;
    db.days = db.days.filter((d) => d.id !== dayId);
    if (db.activeSession && db.activeSession.dayId === dayId) db.activeSession = null;
    return db.days.length < before;
  };

  /** Zeitpunkt des letzten abgeschlossenen Trainings eines Tages (oder null). */
  Core.lastTrained = function (db, dayId) {
    let last = null;
    for (const s of db.sessions) if (s.dayId === dayId && (last === null || s.finishedAt > last)) last = s.finishedAt;
    return last;
  };

  /* ---------- Übungen im Plan ---------- */

  Core.findExercise = function (db, dayId, exId) {
    const day = Core.findDay(db, dayId);
    return day ? day.exercises.find((e) => e.id === exId) || null : null;
  };

  Core.addExercise = function (db, dayId, name, rest, sets) {
    const day = Core.findDay(db, dayId);
    if (!day || !String(name).trim()) return null;
    const ex = newPlanExercise(String(name).trim(), clampRest(rest, db.settings.defaultRest), clampSets(sets));
    day.exercises.push(ex);
    Core.syncSession(db);
    return ex;
  };

  /** Gibt es abgeschlossene Einheiten mit einer Übung dieses Namens? */
  Core.historyHasName = function (db, name) {
    const key = normName(name);
    return db.sessions.some((s) => s.exercises.some((e) => normName(e.name) === key));
  };

  /** Umbenennen; optional werden auch alle Verlaufseinträge mit dem alten Namen umbenannt. */
  Core.renameExercise = function (db, dayId, exId, name, renameHistory) {
    const ex = Core.findExercise(db, dayId, exId);
    const newName = String(name).trim();
    if (!ex || !newName) return false;
    const oldKey = normName(ex.name);
    ex.name = newName;
    if (renameHistory) {
      for (const s of db.sessions) for (const e of s.exercises) if (normName(e.name) === oldKey) e.name = newName;
    }
    Core.syncSession(db);
    return true;
  };

  Core.removeExercise = function (db, dayId, exId) {
    const day = Core.findDay(db, dayId);
    if (!day) return false;
    const before = day.exercises.length;
    day.exercises = day.exercises.filter((e) => e.id !== exId);
    Core.syncSession(db);
    return day.exercises.length < before;
  };

  /** Verschiebt eine Übung von Position `from` nach `to`. */
  Core.moveExercise = function (db, dayId, from, to) {
    const day = Core.findDay(db, dayId);
    if (!day) return false;
    const n = day.exercises.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return false;
    const [ex] = day.exercises.splice(from, 1);
    day.exercises.splice(to, 0, ex);
    Core.syncSession(db);
    return true;
  };

  Core.setRest = function (db, dayId, exId, sec) {
    const ex = Core.findExercise(db, dayId, exId);
    if (!ex) return false;
    ex.rest = clampRest(sec, ex.rest);
    Core.syncSession(db);
    return true;
  };

  /**
   * Satzanzahl einer Übung im Plan ändern. Läuft gerade ein Training, wird die Übung dort
   * angepasst: fehlende Sätze kommen dazu, überzählige leere Sätze am Ende fallen weg
   * (bereits eingetragene Sätze werden nie gelöscht).
   */
  Core.setSetCount = function (db, dayId, exId, n) {
    const ex = Core.findExercise(db, dayId, exId);
    if (!ex) return false;
    ex.sets = clampSets(n, ex.sets);
    const s = db.activeSession;
    if (s && s.dayId === dayId) {
      const se = s.exercises.find((e) => e.exId === exId);
      if (se) Core.resizeSets(se, ex.sets);
    }
    return true;
  };

  /** Ziel-Wiederholungen setzen, z. B. (8, 12). min = null entfernt das Ziel. */
  Core.setRepTarget = function (db, dayId, exId, min, max) {
    const ex = Core.findExercise(db, dayId, exId);
    if (!ex) return false;
    Object.assign(ex, repTargetFields(min, max));
    return true;
  };

  /** Dauerhafte Notiz einer Übung (z. B. „Sitz Stufe 4“). */
  Core.setExerciseNote = function (db, dayId, exId, text) {
    const ex = Core.findExercise(db, dayId, exId);
    if (!ex) return false;
    ex.note = String(text || '').trim();
    return true;
  };

  /* ---------- Verlauf lesen ---------- */

  /** Letzte abgeschlossene Ausführung einer Übung (nach Name): { date, sets } oder null. */
  Core.lastPerformance = function (db, name) {
    const key = normName(name);
    let best = null;
    for (const s of db.sessions) {
      if (best && s.finishedAt <= best.date) continue;
      const e = s.exercises.find((x) => normName(x.name) === key && x.sets.length);
      if (e) best = { date: s.finishedAt, sets: e.sets };
    }
    return best;
  };

  /**
   * Steigerungsvorschlag nach dem Prinzip "doppelte Progression":
   * Erst die Wiederholungen im Zielbereich steigern; schaffst du in allen Sätzen das obere Ende,
   * kommt Gewicht drauf und du startest wieder unten im Bereich.
   *   'first'    – noch kein Verlauf
   *   'increase' – alle geplanten Sätze ≥ Obergrenze → Gewicht + Schritt
   *   'reps'     – im Bereich → gleiches Gewicht, je 1 Wdh. mehr
   *   'below'    – mind. ein Satz unter der Untergrenze → Gewicht halten
   */
  Core.progression = function (prev, target, inc, plannedSets) {
    if (!target || !target.min) return null;
    const work = prev ? prev.sets.filter((st) => st.reps !== null) : [];
    if (!work.length) return { kind: 'first' };
    const weights = work.map((st) => st.weight).filter((w) => w !== null);
    const top = weights.length ? Math.max(...weights) : null;
    const allSetsDone = work.length >= (plannedSets || 1);
    if (allSetsDone && work.every((st) => st.reps >= target.max)) {
      return { kind: 'increase', top, next: top === null ? null : Math.round((top + inc) * 100) / 100 };
    }
    if (work.some((st) => st.reps < target.min)) return { kind: 'below', top };
    return { kind: 'reps', top };
  };

  /**
   * Vorlage (Platzhalter) für Satz Nr. `index` einer Übung der laufenden Einheit:
   * 1. derselbe Satz vom letzten Training (angepasst an den Steigerungsvorschlag),
   * 2. der vorige Satz von heute, 3. letzter Satz vom letzten Training, 4. Untergrenze des Ziels.
   * `ctx` (optional): { target: {min,max}, prog, inc } aus Core.exerciseContext.
   */
  Core.placeholderFor = function (prev, sessionEx, index, ctx) {
    const pick = (st, withNote) => ({ weight: st.weight, reps: st.reps, note: withNote ? st.note || '' : '' });
    const target = ctx && ctx.target;
    const prog = ctx && ctx.prog;
    if (prev && index < prev.sets.length) {
      const p = prev.sets[index];
      const ph = pick(p, true);
      if (target && prog && prog.kind === 'increase') {
        if (p.weight !== null) { ph.weight = Math.round((p.weight + ctx.inc) * 100) / 100; ph.reps = target.min; }
        else if (p.reps !== null) ph.reps = p.reps + 1; // ohne Gewicht: weiter Wdh. steigern
      } else if (target && prog && p.reps !== null && p.reps < target.max) {
        ph.reps = p.reps + 1;
      }
      return ph;
    }
    for (let i = Math.min(index, sessionEx.sets.length) - 1; i >= 0; i--) {
      const st = sessionEx.sets[i];
      if (st.weight !== null || st.reps !== null) return pick(st, false);
    }
    if (prev && prev.sets.length) return pick(prev.sets[prev.sets.length - 1], false);
    return { weight: null, reps: target ? target.min : null, note: '' };
  };

  /** Alles, was für Vorlagen & Vorschläge einer Übung der laufenden Einheit nötig ist. */
  Core.exerciseContext = function (db, se) {
    const s = db.activeSession;
    const plan = s && se.exId ? Core.findExercise(db, s.dayId, se.exId) : null;
    const prev = Core.lastPerformance(db, se.name);
    const target = plan && plan.repMin ? { min: plan.repMin, max: plan.repMax } : null;
    const inc = db.settings.increment || DEFAULT_SETTINGS.increment;
    const prog = Core.progression(prev, target, inc, plan ? plan.sets : se.sets.length);
    return { plan, prev, target, prog, inc };
  };

  /* ---------- Laufende Einheit ---------- */

  function newSet() {
    return { id: uid(), weight: null, reps: null, note: '', done: false };
  }

  function newSessionExercise(db, ex) {
    return {
      id: uid(), exId: ex.id, name: ex.name, rest: ex.rest, skipped: false,
      sets: Array.from({ length: clampSets(ex.sets) }, newSet),
    };
  }

  function setHasValues(st) {
    return st.weight !== null || st.reps !== null || !!(st.note && st.note.trim());
  }

  function exerciseHasData(e) {
    return e.sets.some((st) => st.done || setHasValues(st));
  }

  /** Startet eine neue Einheit für den Tag (eine evtl. laufende wird ersetzt). */
  Core.startSession = function (db, dayId, now) {
    const day = Core.findDay(db, dayId);
    if (!day) return null;
    db.activeSession = {
      id: uid(), dayId, dayName: day.name, startedAt: now, customOrder: false,
      exercises: day.exercises.map((ex) => newSessionExercise(db, ex)),
    };
    return db.activeSession;
  };

  /**
   * Gleicht die laufende Einheit mit dem Plan ab (nach Änderungen am Tag):
   * Reihenfolge, Namen und Pausen kommen aus dem Plan, neue Übungen werden ergänzt.
   * Entfernte Übungen bleiben nur erhalten, wenn schon Sätze eingetragen sind.
   */
  Core.syncSession = function (db) {
    const s = db.activeSession;
    if (!s) return;
    const day = Core.findDay(db, s.dayId);
    if (!day) return;
    s.dayName = day.name;
    if (s.customOrder) {
      // Eigene Reihenfolge im Training behalten; neue Plan-Übungen hinten anhängen
      const plan = new Map(day.exercises.map((ex) => [ex.id, ex]));
      const kept = s.exercises.filter((e) => (e.exId && plan.has(e.exId)) || exerciseHasData(e));
      for (const e of kept) {
        const ex = e.exId && plan.get(e.exId);
        if (ex) { e.name = ex.name; e.rest = ex.rest; } else e.exId = null;
      }
      const have = new Set(kept.map((e) => e.exId).filter(Boolean));
      s.exercises = kept.concat(day.exercises.filter((ex) => !have.has(ex.id)).map((ex) => newSessionExercise(db, ex)));
      return;
    }
    const byExId = new Map(s.exercises.filter((e) => e.exId).map((e) => [e.exId, e]));
    const next = day.exercises.map((ex) => {
      const se = byExId.get(ex.id);
      if (!se) return newSessionExercise(db, ex);
      byExId.delete(ex.id);
      se.name = ex.name;
      se.rest = ex.rest;
      return se;
    });
    const orphans = s.exercises.filter((e) => (!e.exId || byExId.has(e.exId)) && exerciseHasData(e));
    orphans.forEach((e) => { e.exId = null; });
    s.exercises = next.concat(orphans);
  };

  /** Bringt eine Übung der laufenden Einheit auf n Sätze (entfernt nur leere Sätze am Ende). */
  Core.resizeSets = function (se, n) {
    while (se.sets.length < n) se.sets.push(newSet());
    while (se.sets.length > n) {
      const last = se.sets[se.sets.length - 1];
      if (last.done || setHasValues(last)) break;
      se.sets.pop();
    }
    return se.sets.length;
  };

  Core.findSessionExercise = function (db, seId) {
    const s = db.activeSession;
    return s ? s.exercises.find((e) => e.id === seId) || null : null;
  };

  Core.addSet = function (db, seId) {
    const se = Core.findSessionExercise(db, seId);
    if (!se) return null;
    const st = newSet();
    se.sets.push(st);
    return st;
  };

  Core.removeSet = function (db, seId, setId) {
    const se = Core.findSessionExercise(db, seId);
    if (!se) return false;
    const before = se.sets.length;
    se.sets = se.sets.filter((st) => st.id !== setId);
    return se.sets.length < before;
  };

  /** Ändert ein Feld eines Satzes (weight/reps als Text oder Zahl, note als Text). */
  Core.updateSet = function (db, seId, setId, field, value) {
    const se = Core.findSessionExercise(db, seId);
    const st = se && se.sets.find((x) => x.id === setId);
    if (!st) return false;
    if (field === 'weight') st.weight = parseNum(value);
    else if (field === 'reps') { const n = parseNum(value); st.reps = n === null ? null : Math.round(n); }
    else if (field === 'note') st.note = String(value);
    else if (field === 'rir' || field === 'rpe') {
      const v = clampEffort(value);
      if (v === null) delete st[field]; else st[field] = v;
    } else return false;
    return true;
  };

  /**
   * Hakt einen Satz ab (bzw. wieder auf). Leere Felder werden beim Abhaken mit der
   * Vorlage vom letzten Mal gefüllt. Rückgabe: { done, rest, name } oder null.
   */
  Core.toggleSet = function (db, seId, setId, now) {
    const se = Core.findSessionExercise(db, seId);
    if (!se) return null;
    const index = se.sets.findIndex((x) => x.id === setId);
    if (index < 0) return null;
    const st = se.sets[index];
    st.done = !st.done;
    if (st.done) {
      const ctx = Core.exerciseContext(db, se);
      const ph = Core.placeholderFor(ctx.prev, se, index, ctx);
      if (st.weight === null && ph.weight !== null) st.weight = ph.weight;
      if (st.reps === null && ph.reps !== null) st.reps = ph.reps;
      st.doneAt = now;
    } else {
      delete st.doneAt;
    }
    return { done: st.done, rest: se.rest, name: se.name };
  };

  /**
   * +/−-Buttons: Wert ändern. Ist das Feld leer, wird von der Vorlage aus gerechnet.
   * field: 'weight' | 'reps'. Rückgabe: neuer Wert oder null.
   */
  Core.stepSet = function (db, seId, setId, field, delta) {
    const se = Core.findSessionExercise(db, seId);
    const index = se ? se.sets.findIndex((x) => x.id === setId) : -1;
    if (index < 0 || (field !== 'weight' && field !== 'reps')) return null;
    const st = se.sets[index];
    const ctx = Core.exerciseContext(db, se);
    const base = st[field] !== null ? st[field] : Core.placeholderFor(ctx.prev, se, index, ctx)[field];
    let v = (base === null ? 0 : base) + delta;
    v = field === 'reps' ? Math.max(0, Math.round(v)) : Math.max(0, Math.round(v * 100) / 100);
    st[field] = v;
    return v;
  };

  /** Anzahl Sätze, die beim Beenden gespeichert würden. */
  Core.countLoggedSets = function (session) {
    if (!session) return 0;
    return session.exercises.reduce((n, e) => n + e.sets.filter(setHasValues).length, 0);
  };

  /**
   * Beendet die laufende Einheit und speichert sie im Verlauf.
   * Gespeichert werden alle Sätze mit Gewicht, Wdh. oder Notiz. Rückgabe: Einheit oder null (nichts eingetragen).
   */
  Core.finishSession = function (db, now) {
    const s = db.activeSession;
    if (!s) return null;
    db.activeSession = null;
    const exercises = s.exercises
      .map((e) => ({
        exId: e.exId, name: e.name,
        sets: e.sets.filter(setHasValues).map((st) => {
          const out = { weight: st.weight, reps: st.reps, note: (st.note || '').trim(), done: !!st.done };
          if (st.rir !== undefined) out.rir = st.rir;
          if (st.rpe !== undefined) out.rpe = st.rpe;
          return out;
        }),
      }))
      .filter((e) => e.sets.length);
    if (!exercises.length) return null;
    const done = { id: s.id, dayId: s.dayId, dayName: s.dayName, startedAt: s.startedAt, finishedAt: now, exercises };
    db.sessions.push(done);
    db.sessions.sort((a, b) => a.finishedAt - b.finishedAt);
    return done;
  };

  /**
   * Übung im laufenden Training verschieben – nur für diese Einheit, der Plan bleibt.
   * where: 'up' | 'down' | 'end'
   */
  Core.moveSessionExercise = function (db, seId, where) {
    const s = db.activeSession;
    if (!s) return false;
    const i = s.exercises.findIndex((e) => e.id === seId);
    if (i < 0) return false;
    const to = where === 'up' ? i - 1 : where === 'down' ? i + 1 : s.exercises.length - 1;
    if (to < 0 || to >= s.exercises.length || to === i) return false;
    const [e] = s.exercises.splice(i, 1);
    s.exercises.splice(to, 0, e);
    s.customOrder = true;
    return true;
  };

  /** Übung in diesem Training überspringen (wandert ans Ende) bzw. wieder aufnehmen. */
  Core.setSkipped = function (db, seId, skipped) {
    const s = db.activeSession;
    const se = s && s.exercises.find((e) => e.id === seId);
    if (!se) return false;
    se.skipped = !!skipped;
    if (skipped) Core.moveSessionExercise(db, seId, 'end');
    return true;
  };

  Core.discardSession = function (db) {
    db.activeSession = null;
  };

  Core.deleteSession = function (db, sessionId) {
    const before = db.sessions.length;
    db.sessions = db.sessions.filter((s) => s.id !== sessionId);
    return db.sessions.length < before;
  };

  /* ---------- Trainingsplan teilen ---------- */

  /** Kompakter Plan eines Trainingstags zum Teilen. */
  /**
   * Geschätzte Trainingsdauer in Minuten (auf 5 gerundet):
   * pro Satz ca. 45 s Arbeit + die eingestellte Pause (nach dem letzten Satz einer Übung ca. 1 min Wechsel).
   */
  Core.estimateMinutes = function (day) {
    let sec = 0;
    for (const e of day.exercises) sec += e.sets * 45 + Math.max(0, e.sets - 1) * e.rest + 60;
    return sec ? Math.max(5, Math.round(sec / 300) * 5) : 0;
  };

  Core.planFromDay = function (day) {
    return {
      v: 1, n: day.name,
      e: day.exercises.map((e) => ({ n: e.name, s: e.sets, r: e.rest, a: e.repMin, b: e.repMax })),
    };
  };

  /** Plan aus einer abgeschlossenen Einheit (Einstellungen aus dem Tag, falls es ihn noch gibt). */
  Core.planFromSession = function (db, session) {
    const day = session.dayId ? Core.findDay(db, session.dayId) : null;
    return {
      v: 1, n: session.dayName,
      e: session.exercises.map((e) => {
        const ex = day && day.exercises.find((x) => x.id === e.exId || normName(x.name) === normName(e.name));
        return ex
          ? { n: e.name, s: ex.sets, r: ex.rest, a: ex.repMin, b: ex.repMax }
          : { n: e.name, s: clampSets(e.sets.length), r: db.settings.defaultRest, a: null, b: null };
      }),
    };
  };

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(code) {
    let b = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  Core.encodePlan = (plan) => b64urlEncode(JSON.stringify(plan));

  /** Geteilten Plan lesen und prüfen. Wirft bei ungültigem Code. */
  Core.decodePlan = function (code) {
    let p;
    try { p = JSON.parse(b64urlDecode(String(code).trim())); } catch (e) { throw new Error('Der Code ist ungültig oder unvollständig.'); }
    if (!p || typeof p !== 'object' || !Array.isArray(p.e) || !p.e.length) throw new Error('Der Code enthält keinen Trainingsplan.');
    return {
      name: String(p.n || 'Geteiltes Training').slice(0, 60),
      exercises: p.e.slice(0, 40).filter((e) => e && e.n).map((e) => ({
        name: String(e.n).slice(0, 80),
        sets: clampSets(e.s),
        rest: clampRest(e.r),
        ...repTargetFields(e.a, e.b),
      })),
    };
  };

  /** Geteilten Plan als neuen Trainingstag anlegen. */
  Core.addDayFromPlan = function (db, plan) {
    const day = { id: uid(), name: plan.name, exercises: [] };
    for (const e of plan.exercises) {
      day.exercises.push({ ...newPlanExercise(e.name, e.rest, e.sets), repMin: e.repMin, repMax: e.repMax });
    }
    db.days.push(day);
    return day;
  };

  /* ---------- Kalender & Wochenziel ---------- */

  /** Montag 0:00 der Woche (Ortszeit). */
  function weekStart(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }

  function prevWeek(ws) {
    const d = new Date(ws);
    d.setDate(d.getDate() - 7);
    return d.getTime();
  }

  /** "2026-09-23" in Ortszeit */
  Core.dayKey = function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  /**
   * Trainings dieser Woche und Serie = Anzahl Wochen in Folge mit erreichtem Wochenziel.
   * Die laufende Woche zählt erst mit, wenn das Ziel erreicht ist – bis dahin bricht sie die Serie nicht.
   */
  Core.weekStats = function (db, now, goal) {
    const counts = new Map();
    for (const s of db.sessions) {
      const k = weekStart(s.finishedAt);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const cur = weekStart(now);
    const thisWeek = counts.get(cur) || 0;
    let w = thisWeek >= goal ? cur : prevWeek(cur);
    let streak = 0;
    while ((counts.get(w) || 0) >= goal) { streak++; w = prevWeek(w); }
    return { thisWeek, goal, streak };
  };

  /** Einheiten nach Kalendertag: Map "YYYY-MM-DD" → [session] */
  Core.sessionsByDay = function (db) {
    const map = new Map();
    for (const s of db.sessions) {
      const k = Core.dayKey(s.finishedAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return map;
  };

  /* ---------- Körpergewicht & Maße ---------- */

  Core.BODY_FIELDS = BODY_FIELDS;

  /** Messung speichern (neu oder ändern). Ohne einen einzigen Wert → null. */
  Core.saveBodyEntry = function (db, entry) {
    const e = normBodyEntry(entry);
    if (!Number.isFinite(e.date) || BODY_FIELDS.every(([k]) => e[k] === null)) return null;
    db.body = db.body.filter((x) => x.id !== e.id);
    db.body.push(e);
    db.body.sort((a, b) => a.date - b.date);
    return e;
  };

  Core.deleteBodyEntry = function (db, id) {
    const before = db.body.length;
    db.body = db.body.filter((x) => x.id !== id);
    return db.body.length < before;
  };

  /** Neuester Wert eines Maßes: { value, date } oder null */
  Core.latestBody = function (db, key) {
    for (let i = db.body.length - 1; i >= 0; i--) if (db.body[i][key] !== null) return { value: db.body[i][key], date: db.body[i].date };
    return null;
  };

  /* ---------- Auswertungen ---------- */

  function bestOf(sets) {
    let weight = null, e1 = null, reps = null;
    for (const st of sets) {
      if (st.weight !== null && (weight === null || st.weight > weight)) weight = st.weight;
      if (st.reps !== null && (reps === null || st.reps > reps)) reps = st.reps;
      const v = e1rm(st.weight, st.reps);
      if (v !== null && (e1 === null || v > e1)) e1 = v;
    }
    return { weight, e1rm: e1, reps };
  }

  Core.sessionStats = function (s) {
    let sets = 0, volume = 0;
    for (const e of s.exercises) for (const st of e.sets) {
      sets++;
      if (st.weight && st.reps) volume += st.weight * st.reps;
    }
    return { exercises: s.exercises.length, sets, volume, duration: s.finishedAt - s.startedAt };
  };

  /**
   * Neue persönliche Rekorde einer Einheit im Vergleich zu allen Einheiten davor.
   * Rückgabe: [{ name, type: 'weight'|'e1rm'|'reps', value, prev }]
   * Beim allerersten Mal einer Übung gibt es (noch) keinen Rekord.
   */
  Core.sessionRecords = function (db, session) {
    const out = [];
    for (const e of session.exercises) {
      const key = normName(e.name);
      const before = [];
      for (const s of db.sessions) {
        if (s.id === session.id || s.finishedAt >= session.finishedAt) continue;
        for (const x of s.exercises) if (normName(x.name) === key) before.push(...x.sets);
      }
      if (!before.length) continue;
      const old = bestOf(before);
      const cur = bestOf(e.sets);
      if (cur.weight !== null && old.weight !== null && cur.weight > old.weight) {
        out.push({ name: e.name, type: 'weight', value: cur.weight, prev: old.weight });
      } else if (cur.e1rm !== null && old.e1rm !== null && cur.e1rm > old.e1rm + 0.05) {
        out.push({ name: e.name, type: 'e1rm', value: Math.round(cur.e1rm * 10) / 10, prev: Math.round(old.e1rm * 10) / 10 });
      } else if (cur.weight === null && old.weight === null && cur.reps !== null && old.reps !== null && cur.reps > old.reps) {
        out.push({ name: e.name, type: 'reps', value: cur.reps, prev: old.reps });
      }
    }
    return out;
  };

  /** Die vorherige Einheit desselben Trainingstags (für den Vergleich in der Zusammenfassung). */
  Core.previousSessionOfDay = function (db, session) {
    let best = null;
    for (const s of db.sessions) {
      if (s.id === session.id || s.finishedAt >= session.finishedAt) continue;
      const same = session.dayId ? s.dayId === session.dayId : normName(s.dayName) === normName(session.dayName);
      if (same && (!best || s.finishedAt > best.finishedAt)) best = s;
    }
    return best;
  };

  /** Alle Übungen aus dem Verlauf: [{ key, name, count, last, best }] – zuletzt trainierte zuerst. */
  Core.exerciseStats = function (db) {
    const map = new Map();
    for (const s of db.sessions) {
      for (const e of s.exercises) {
        const key = normName(e.name);
        let it = map.get(key);
        if (!it) { it = { key, name: e.name, count: 0, last: 0, best: { weight: null, e1rm: null, reps: null } }; map.set(key, it); }
        it.count++;
        if (s.finishedAt >= it.last) { it.last = s.finishedAt; it.name = e.name; }
        const b = bestOf(e.sets);
        for (const k of ['weight', 'e1rm', 'reps']) {
          if (b[k] !== null && (it.best[k] === null || b[k] > it.best[k])) it.best[k] = b[k];
        }
      }
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
  };

  /** Verlauf einer Übung (älteste zuerst): [{ sessionId, date, dayName, sets, best }] */
  Core.exerciseHistory = function (db, key) {
    const out = [];
    for (const s of db.sessions) {
      for (const e of s.exercises) {
        if (normName(e.name) !== key) continue;
        out.push({ sessionId: s.id, date: s.finishedAt, dayName: s.dayName, name: e.name, sets: e.sets, best: bestOf(e.sets) });
      }
    }
    return out.sort((a, b) => a.date - b.date);
  };

  /* =========================================================
   * 3. TimerCore – Pausentimer auf Basis eines End-Zeitstempels
   *    Die Restzeit wird immer aus (endAt − jetzt) berechnet. Dadurch stimmt sie
   *    auch nach Sperrbildschirm, App-Wechsel oder Neuladen.
   * ========================================================= */

  const TimerCore = {
    create(durationSec, now, label) {
      const d = Math.max(1, Math.round(durationSec));
      return { startedAt: now, endAt: now + d * 1000, duration: d, label: label || '', fired: false };
    },
    remaining(t, now) {
      return Math.max(0, (t.endAt - now) / 1000);
    },
    isDone(t, now) {
      return now >= t.endAt;
    },
    progress(t, now) {
      return Math.min(1, Math.max(0, 1 - TimerCore.remaining(t, now) / t.duration));
    },
    /** ±Sekunden. Nie vor "jetzt"; bereits abgelaufene Timer werden nicht verändert. */
    adjust(t, deltaSec, now) {
      if (TimerCore.isDone(t, now)) return t;
      const endAt = Math.max(now, t.endAt + deltaSec * 1000);
      const duration = Math.max(1, t.duration + (endAt - t.endAt) / 1000);
      return { ...t, endAt, duration };
    },
  };

  /* =========================================================
   * 3b. Sync – Abgleich mit der Cloud (unabhängig von Firebase, in Node testbar)
   *
   * Die App arbeitet immer lokal ("offline first"). Für den Abgleich werden die Daten
   * in einzelne Teile ("Schlüssel") zerlegt, die unabhängig voneinander abgeglichen werden:
   *   'main.days'      → Trainingstage        (Firestore: Feld `days` in users/{uid})
   *   'main.settings'  → Einstellungen        (Feld `settings`)
   *   'main.active'    → laufendes Training   (Feld `activeSession`)
   *   'session:<id>'   → abgeschlossene Einheit (users/{uid}/sessions/{id})
   *   'body:<id>'      → Körpermessung          (users/{uid}/body/{id})
   * Jedes Gerät schreibt nur die Teile, die es selbst geändert hat. So kann z. B. eine
   * Körpermessung vom iPad nie ein laufendes Training auf dem Handy überschreiben.
   * `base` merkt sich pro Teil den Hash des zuletzt mit dem Server abgeglichenen Stands.
   * Damit lässt sich erkennen, wer etwas geändert hat (lokal, Server oder beide).
   * ========================================================= */

  const Sync = {};

  /** Teile des Hauptdokuments: Schlüssel → Feldname in Firestore */
  const MAIN_FIELDS = { 'main.days': 'days', 'main.settings': 'settings', 'main.active': 'activeSession' };
  Sync.MAIN_FIELDS = MAIN_FIELDS;

  /** Ist das ein Schlüssel, der einem Dokument/Feld auf dem Server entspricht? */
  const isDocKey = (k) => k in MAIN_FIELDS || k.startsWith('session:') || k.startsWith('body:');

  /** JSON mit sortierten Schlüsseln → gleicher Inhalt ergibt immer denselben Text. */
  Sync.stableStringify = function stable(v) {
    if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  };

  /** Schneller 64-Bit-Hash (cyrb53-Variante) – nur zum Vergleichen, nicht für Sicherheit. */
  Sync.hash = function (str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0') + str.length.toString(36);
  };

  Sync.hashOf = (data) => (data === null || data === undefined ? null : Sync.hash(Sync.stableStringify(data)));

  /**
   * Hash eines Teils. Felder des Hauptdokuments dürfen null sein (z. B. kein laufendes Training) –
   * das ist ein gültiger Wert und kein "gelöscht", deshalb bekommen sie immer einen Hash.
   */
  Sync.keyHash = (key, data) => (key in MAIN_FIELDS ? Sync.hash('v:' + Sync.stableStringify(data === undefined ? null : data)) : Sync.hashOf(data));

  /** Alles außer den Einheiten – praktisch zum Vergleichen zweier Geräte (Tests). */
  Sync.mainOf = (db) => ({ days: db.days, settings: db.settings, activeSession: db.activeSession, body: db.body });

  Sync.keysOf = (db) => Object.keys(MAIN_FIELDS)
    .concat(db.sessions.map((s) => 'session:' + s.id), db.body.map((b) => 'body:' + b.id));

  Sync.getDoc = function (db, key) {
    if (key in MAIN_FIELDS) return db[MAIN_FIELDS[key]];
    if (key.startsWith('session:')) return db.sessions.find((s) => s.id === key.slice(8)) || null;
    if (key.startsWith('body:')) return db.body.find((b) => b.id === key.slice(5)) || null;
    return null;
  };

  /** Schreibt einen Teil vom Server in die lokalen Daten (bereinigt über Core.normalize). */
  Sync.setDoc = function (db, key, data) {
    if (key === 'main.days') {
      // Das laufende Training wird hier bewusst NICHT angepasst: Es gehört dem Gerät, auf dem
      // trainiert wird, und kommt über 'main.active' von dort.
      db.days = Core.normalize({ days: data || [], sessions: db.sessions, settings: db.settings }).days;
      return;
    }
    if (key === 'main.settings') {
      db.settings = Core.normalize({ days: [], settings: data || {} }).settings;
      return;
    }
    if (key === 'main.active') {
      db.activeSession = data ? Core.normalize({ days: [], activeSession: data, settings: db.settings }).activeSession : null;
      return;
    }
    if (key.startsWith('session:')) {
      const id = key.slice(8);
      db.sessions = db.sessions.filter((s) => s.id !== id);
      const s = data && Core.normalize({ days: [], sessions: [{ ...data, id }] }).sessions[0];
      if (s) {
        db.sessions.push(s);
        db.sessions.sort((a, b) => a.finishedAt - b.finishedAt);
      }
      return;
    }
    if (key.startsWith('body:')) {
      const id = key.slice(5);
      db.body = db.body.filter((b) => b.id !== id);
      const b = data && Core.normalize({ days: [], body: [{ ...data, id }] }).body[0];
      if (b) {
        db.body.push(b);
        db.body.sort((x, y) => x.date - y.date);
      }
    }
  };

  Sync.isEmpty = (db) => !db.days.length && !db.sessions.length && !db.activeSession && !db.body.length;

  /** Hat jemand ohne Konto schon etwas Eigenes angelegt (mehr als die Beispieldaten)? */
  Sync.hasUserContent = function (db) {
    if (db.sessions.length || db.activeSession || db.body.length) return true;
    const sig = (days) => days.map((d) => normName(d.name) + ':' + d.exercises.map((e) => normName(e.name)).join('|')).join(';');
    return db.days.length > 0 && sig(db.days) !== sig(Core.sampleDays());
  };

  /**
   * Führt beim ersten Abgleich eines Geräts lokale Tage mit denen vom Server zusammen.
   * Tage mit gleichem Namen werden vereint (fehlende Übungen ergänzt), IDs in Einheiten angepasst.
   */
  Sync.mergeDaysInto = function (db, remoteDays) {
    const days = JSON.parse(JSON.stringify(remoteDays || []));
    const dayMap = {}; // lokale Tag-ID → Server-Tag-ID
    const exMap = {};  // lokale Übungs-ID → Server-Übungs-ID
    for (const d of db.days) {
      if (days.some((x) => x.id === d.id)) continue;
      const same = days.find((x) => normName(x.name) === normName(d.name));
      if (!same) { days.push(d); continue; }
      dayMap[d.id] = same.id;
      for (const e of d.exercises) {
        const match = same.exercises.find((x) => normName(x.name) === normName(e.name));
        if (match) exMap[e.id] = match.id;
        else same.exercises.push(e);
      }
    }
    const remap = (s) => {
      if (s && dayMap[s.dayId]) s.dayId = dayMap[s.dayId];
      if (s) for (const e of s.exercises) if (e.exId && exMap[e.exId]) e.exId = exMap[e.exId];
    };
    db.sessions.forEach(remap);
    remap(db.activeSession);
    db.days = Core.normalize({ days, sessions: db.sessions, settings: db.settings }).days;
  };

  /** Übernimmt Daten, die ohne Konto angelegt wurden, in die Daten eines Kontos. */
  Sync.mergeGuest = function (target, guest) {
    const g = JSON.parse(JSON.stringify(guest));
    if (Sync.isEmpty(target)) {
      target.days = g.days;
      target.sessions = g.sessions;
      target.activeSession = g.activeSession;
      target.settings = { ...g.settings };
      target.body = g.body;
      return target;
    }
    for (const b of g.body) if (!target.body.some((x) => x.id === b.id)) target.body.push(b);
    target.body.sort((a, b) => a.date - b.date);
    for (const s of g.sessions) if (!target.sessions.some((x) => x.id === s.id)) target.sessions.push(s);
    target.sessions.sort((a, b) => a.finishedAt - b.finishedAt);
    for (const d of g.days) {
      if (!target.days.some((x) => x.id === d.id || normName(x.name) === normName(d.name))) target.days.push(d);
    }
    if (!target.activeSession) target.activeSession = g.activeSession;
    return target;
  };

  /**
   * Welche Teile müssen hochgeladen bzw. gelöscht werden?
   * Die Teile des Hauptdokuments erst, nachdem der Server-Stand einmal gelesen wurde (sonst
   * könnte ein neues, leeres Gerät die Tage eines bestehenden Kontos überschreiben).
   * Hauptdokument-Teile werden nie gelöscht, sondern ggf. auf null gesetzt.
   */
  Sync.pushPlan = function (db, base, inflight, allowMain) {
    const ops = [];
    const local = new Set();
    for (const key of Sync.keysOf(db)) {
      local.add(key);
      if (key in MAIN_FIELDS && !allowMain) continue;
      const data = Sync.getDoc(db, key);
      const h = Sync.keyHash(key, data);
      if (h !== base[key] && h !== inflight[key]) ops.push({ key, data: data === undefined ? null : data, hash: h });
    }
    for (const key of Object.keys(base)) {
      if (isDocKey(key) && !local.has(key) && inflight[key] !== null) ops.push({ key, data: null, hash: null });
    }
    return ops;
  };

  /**
   * Verarbeitet den Server-Stand eines Teils (null = gelöscht bzw. leer).
   * Rückgabe: 'ignored' | 'applied' (lokal übernommen) | 'merged' | 'conflict' (lokal gewinnt)
   */
  Sync.applyRemote = function (db, base, inflight, key, remote) {
    const rHash = Sync.keyHash(key, remote);
    const bHash = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : undefined;
    if (rHash === bHash) return 'ignored';                       // nichts Neues
    if (key in inflight && rHash === inflight[key]) return 'ignored'; // eigenes Echo

    const local = Sync.getDoc(db, key);
    const lHash = Sync.keyHash(key, local);
    const setBase = (h) => { if (h === null) delete base[key]; else base[key] = h; };

    if (lHash === rHash) { setBase(rHash); return 'ignored'; }

    if (bHash === undefined) {                 // noch nie abgeglichen
      if (remote === null) return 'ignored';   // nur lokal vorhanden → wird hochgeladen
      if (key === 'main.days') { Sync.mergeDaysInto(db, remote); setBase(rHash); return 'merged'; }
      if (key === 'main.active' && local) { setBase(rHash); return 'conflict'; } // eigenes Training behalten
      Sync.setDoc(db, key, remote); setBase(rHash); return 'applied';
    }
    if (lHash === bHash) {                     // lokal unverändert → Server-Stand übernehmen
      Sync.setDoc(db, key, remote); setBase(rHash); return 'applied';
    }
    setBase(rHash);                            // beide geändert → lokale Änderung gewinnt
    return 'conflict';
  };

  /**
   * Abgleich-Motor. `adapter` kapselt die Cloud (Firebase oder ein Test-Server):
   *   adapter.subscribe({ main(data|null), sessions([{id, data}]), body([{id, data}]) }, onError) → unsubscribe
   *   adapter.commit([{ key, data|null }]) → Promise (erfüllt, wenn der Server bestätigt hat)
   */
  function createSyncEngine(o) {
    const pushDelay = o.pushDelay === undefined ? 1500 : o.pushDelay;
    const retryDelay = o.retryDelay === undefined ? 15000 : o.retryDelay;
    const base = o.loadBase() || {};
    delete base.main; // Stand einer älteren App-Version (Hauptdokument als Ganzes) – ab jetzt pro Teil
    const inflight = {};
    const state = { status: 'connecting', lastSync: null, error: null };
    let gotMain = false, pushing = false, running = false, timer = null, unsub = null, resub = null;

    const hasMainBase = () => Object.keys(MAIN_FIELDS).some((k) => base[k] !== undefined);

    function setStatus(status, error) {
      state.status = status;
      state.error = error || null;
      if (status === 'synced') state.lastSync = Date.now();
      if (o.onStatus) o.onStatus(state);
    }

    function schedule(delay) {
      if (!running) return;
      clearTimeout(timer);
      timer = setTimeout(push, delay === undefined ? pushDelay : delay);
    }

    async function push() {
      if (!running || pushing) return;
      pushing = true;
      try {
        for (;;) {
          const ops = Sync.pushPlan(o.getDb(), base, inflight, gotMain);
          if (!ops.length) break;
          ops.forEach((op) => { inflight[op.key] = op.hash; });
          setStatus('syncing');
          try {
            await o.adapter.commit(ops);
          } catch (e) {
            ops.forEach((op) => { if (inflight[op.key] === op.hash) delete inflight[op.key]; });
            setStatus('error', e);
            clearTimeout(timer);
            timer = setTimeout(push, retryDelay);
            return;
          }
          ops.forEach((op) => {
            if (op.hash === null) delete base[op.key]; else base[op.key] = op.hash;
            if (inflight[op.key] === op.hash) delete inflight[op.key];
          });
          o.saveBase(base);
          if (!running) return;
        }
        if (gotMain) setStatus('synced');
      } finally {
        pushing = false;
      }
    }

    function handleMain(data) {
      if (!running) return;
      // Hauptdokument war schon abgeglichen und wird jetzt als fehlend gemeldet. Das kann ein
      // veralteter Zwischenstand von Firestore sein (kommt nach dem ersten Anlegen vor) – oder das
      // Konto wurde anderswo gelöscht. Diesen Stand deshalb NIE übernehmen, sondern beim Server nachfragen.
      if (data === null && hasMainBase()) {
        const check = o.adapter.confirmMissing ? o.adapter.confirmMissing() : Promise.resolve(true);
        check.then((missing) => {
          if (!missing || !running) return;
          running = false;
          clearTimeout(timer);
          if (unsub) { unsub(); unsub = null; }
          if (o.onGone) o.onGone();
        }, () => { /* offline o. Ä. → nichts tun */ });
        return;
      }
      const db = o.getDb();
      let changed = false;
      for (const [key, field] of Object.entries(MAIN_FIELDS)) {
        const v = data && data[field] !== undefined ? data[field] : null;
        const r = Sync.applyRemote(db, base, inflight, key, v);
        if (r === 'applied' || r === 'merged') changed = true;
      }
      // Ältere App-Version hatte Körpermessungen im Hauptdokument → einmalig übernehmen
      if (data && Array.isArray(data.body) && !base['legacy.body']) {
        for (const b of data.body) {
          if (b && b.id && !db.body.some((x) => x.id === b.id)) { Sync.setDoc(db, 'body:' + b.id, b); changed = true; }
        }
        base['legacy.body'] = '1';
      }
      gotMain = true;
      o.saveBase(base);
      if (changed) o.onRemoteChange();
      if (state.status === 'connecting' || state.status === 'error') setStatus('synced');
      schedule(0);
    }

    /** Sammlung (Einheiten bzw. Körpermessungen) vom Server */
    function handleCollection(prefix, list) {
      if (!running) return;
      const db = o.getDb();
      const seen = new Set();
      let changed = false;
      for (const { id, data } of list) {
        const key = prefix + id;
        seen.add(key);
        if (Sync.applyRemote(db, base, inflight, key, data) === 'applied') changed = true;
      }
      // Auf dem Server gelöscht (z. B. auf einem anderen Gerät)
      for (const key of Object.keys(base)) {
        if (key.startsWith(prefix) && !seen.has(key) && Sync.applyRemote(db, base, inflight, key, null) === 'applied') changed = true;
      }
      o.saveBase(base);
      if (changed) o.onRemoteChange();
      schedule(0);
    }

    function subscribe() {
      unsub = o.adapter.subscribe({
        main: handleMain,
        sessions: (list) => handleCollection('session:', list),
        body: (list) => handleCollection('body:', list),
      }, (err) => {
        // Listener ist nach einem Fehler beendet → später neu verbinden
        setStatus('error', err);
        if (unsub) { unsub(); unsub = null; }
        clearTimeout(resub);
        resub = setTimeout(() => { if (running) subscribe(); }, retryDelay);
      });
    }

    return {
      state,
      start() {
        if (running) return;
        running = true;
        subscribe();
        schedule(0);
      },
      stop() {
        running = false;
        clearTimeout(timer);
        clearTimeout(resub);
        if (unsub) { unsub(); unsub = null; }
      },
      schedule,
      /** Gibt es lokale Änderungen, die der Server noch nicht bestätigt hat? */
      pending() {
        const allowMain = gotMain || hasMainBase();
        return Object.keys(inflight).length > 0 || Sync.pushPlan(o.getDb(), base, {}, allowMain).length > 0;
      },
    };
  }

  /* ---------- Export für Tests (Node) ---------- */
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') {
      module.exports = { Core, TimerCore, Sync, createSyncEngine, util: { parseNum, fmtNum, fmtClock, fmtRelative, fmtSet, fmtRest, fmtSets, fmtRepTarget, parseRepTarget, normName, e1rm, esc, clampRest, clampSets } };
    }
    return;
  }

  /* =========================================================
   * 4. UI
   * ========================================================= */

  const STORAGE_KEY = 'gymtracker.data.v1';      // Daten ohne Konto (Gast)
  const TIMER_KEY = 'gymtracker.timer.v1';
  const ACCOUNT_KEY = 'gymtracker.account.v1';   // { mode: 'guest' } | { mode: 'user', uid, email }
  const SYNC_PREFIX = 'gymtracker.sync.v1.';     // + uid → Abgleich-Stand ("base")

  // Auch akzeptieren, wenn der Firebase-Codeblock unverändert als `const firebaseConfig = {…}` eingefügt wurde
  /* global firebaseConfig */
  if (!window.GYM_FIREBASE_CONFIG && typeof firebaseConfig !== 'undefined') window.GYM_FIREBASE_CONFIG = firebaseConfig;

  /** Ist in firebase-config.js ein Firebase-Projekt eingetragen? */
  const cloudConfigured = !!(window.GYM_FIREBASE_CONFIG && window.GYM_FIREBASE_CONFIG.apiKey);

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7zm4 2v8h1.5v-8zm2.5 0v8H14v-8z"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.2 19 14l-1.4 1.4L12 10l-5.6 5.4L5 14z"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16.8 5 10l1.4-1.4L12 14l5.6-5.4L19 10z"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
    sets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v2l-3 1v6l3 3v2h-6v5l-1 1-1-1v-5H5v-2l3-3V6L5 5z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 16.7 7.3l-1.4 1.4L13 6.4V15h-2V6.4L8.7 8.7 7.3 7.3zM5 10h3v2H7v8h10v-8h-1v-2h3v12H5z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3zm-1 8v10h12V10zm0-4v2h12V6z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 2v5.4l4.3 2.6 1-1.7-3.3-2V7z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.2V20h2.8l8.3-8.3-2.8-2.8zM19.7 7.1a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.2 1.2 2.8 2.8z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 19.4 16 12 8.6 4.6 10 3.2l8.8 8.8-8.8 8.8z"/></svg>',
  };

  /* ---------- Speicher ---------- */

  let db;
  let saveTimer = null;
  let account = null;  // null = noch nicht entschieden (Anmeldeseite)
  let engine = null;   // Cloud-Abgleich, solange jemand angemeldet ist

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignorieren */ } }

  function loadAccount() {
    try { return JSON.parse(lsGet(ACCOUNT_KEY)); } catch (e) { return null; }
  }

  function saveAccount() {
    if (account) lsSet(ACCOUNT_KEY, JSON.stringify(account));
    else lsDel(ACCOUNT_KEY);
  }

  const isUser = () => !!(account && account.mode === 'user');

  /** Jedes Konto hat seinen eigenen lokalen Speicher (für Offline-Nutzung). */
  function dataKey() {
    return isUser() ? STORAGE_KEY + '.u.' + account.uid : STORAGE_KEY;
  }

  function loadData(key, fallback) {
    const raw = lsGet(key);
    if (!raw) return fallback();
    try {
      return Core.normalize(JSON.parse(raw));
    } catch (e) {
      // Beschädigte Daten nicht überschreiben, sondern zur Sicherheit wegkopieren.
      lsSet(key + '.corrupt.' + Date.now(), raw);
      setTimeout(() => toast('Gespeicherte Daten waren beschädigt – es wurde neu begonnen.'), 500);
      return fallback();
    }
  }

  /** Nur lokal speichern. */
  function writeLocal() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!lsSet(dataKey(), JSON.stringify(db))) {
      toast('Speichern fehlgeschlagen – Speicher voll? Bitte Backup exportieren.');
    }
  }

  /** Lokal speichern und (falls angemeldet) den Cloud-Abgleich anstoßen. */
  function save() {
    writeLocal();
    if (engine) engine.schedule();
  }

  /** Für Tipp-Eingaben: gebündelt speichern. */
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  /* ---------- Audio (Web Audio API) ---------- */

  const Sound = {
    ctx: null,

    /** Muss aus einer Nutzerinteraktion heraus aufgerufen werden (iOS-Vorgabe). */
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        if (!this.ctx) this.ctx = new AC();
        if (this.ctx.state !== 'running') this.ctx.resume();
        // Ein stiller Puffer "entsperrt" die Audioausgabe unter iOS endgültig.
        const buf = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.ctx.destination);
        src.start(0);
      } catch (e) { /* ignorieren */ }
    },

    tone(at, dur, freq, vol) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(vol, at + 0.01);
      gain.gain.setValueAtTime(vol, at + dur - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    },

    /** Deutlicher Signalton: 3 × drei kurze Pieptöne (~2,5 s). */
    alarm() {
      if (!this.ctx) return;
      const loud = db.settings.loudMode && navigator.audioSession;
      try {
        if (loud) navigator.audioSession.type = 'playback'; // ignoriert den Lautlos-Schalter
        if (this.ctx.state !== 'running') this.ctx.resume();
        const t0 = this.ctx.currentTime + 0.05;
        for (let g = 0; g < 3; g++) {
          for (let i = 0; i < 3; i++) {
            this.tone(t0 + g * 0.85 + i * 0.16, 0.11, i === 2 ? 1318 : 1046, 0.35);
          }
        }
        if (loud) setTimeout(() => { try { navigator.audioSession.type = 'auto'; } catch (_) { /* */ } }, 3000);
      } catch (e) { /* ignorieren */ }
    },
  };

  /* ---------- Bildschirm anlassen (Screen Wake Lock API) ---------- */

  const Wake = {
    supported: 'wakeLock' in navigator,
    lock: null,
    wanted: false,

    async acquire() {
      if (!this.supported || !this.wanted || this.lock || document.visibilityState !== 'visible') return;
      try {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
      } catch (e) { this.lock = null; }
    },

    /** Während eines Trainings bzw. laufenden Timers soll der Bildschirm anbleiben. */
    update() {
      this.wanted = !!(db.activeSession || Timer.state);
      if (this.wanted) this.acquire();
      else if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
    },
  };

  /* ---------- Benachrichtigungen ---------- */

  const Notify = {
    supported: 'Notification' in window,
    get permission() { return this.supported ? Notification.permission : 'unsupported'; },

    async request() {
      if (!this.supported) return 'unsupported';
      try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
    },

    /** Dem Service Worker das Pausenende mitteilen (zeigt die Meldung, falls die App im Hintergrund ist). */
    schedule(endAt, body) {
      const c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!c || this.permission !== 'granted') return false;
      c.postMessage({ type: 'schedule-rest', endAt, body });
      return true;
    },

    cancel() {
      const c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (c) c.postMessage({ type: 'cancel-rest' });
    },

    async show(title, body) {
      if (this.permission !== 'granted') return false;
      const opts = { body, tag: 'rest-timer', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) { await reg.showNotification(title, opts); return true; }
        new Notification(title, opts); // eslint-disable-line no-new
        return true;
      } catch (e) { return false; }
    },
  };

  /* ---------- Pausentimer (Leiste unten) ---------- */

  const Timer = {
    state: null,      // { startedAt, endAt, duration, label, fired }
    interval: null,
    swScheduled: false,

    persist() {
      try {
        if (this.state) localStorage.setItem(TIMER_KEY, JSON.stringify(this.state));
        else localStorage.removeItem(TIMER_KEY);
      } catch (e) { /* ignorieren */ }
    },

    /** Nach dem Neuladen: laufenden Timer wiederherstellen. */
    restore() {
      let t = null;
      try { t = JSON.parse(localStorage.getItem(TIMER_KEY)); } catch (e) { t = null; }
      if (!t || !Number.isFinite(t.endAt)) return;
      this.state = t;
      this.check(true);
      if (this.state) this.run();
    },

    start(sec, label) {
      if (!sec || sec <= 0) return;
      this.state = TimerCore.create(sec, Date.now(), label);
      this.persist();
      this.swScheduled = Notify.schedule(this.state.endAt, label ? 'Nächster Satz: ' + label : '');
      this.run();
    },

    adjust(delta) {
      if (!this.state) return;
      this.state = TimerCore.adjust(this.state, delta, Date.now());
      this.persist();
      this.swScheduled = Notify.schedule(this.state.endAt, this.state.label ? 'Nächster Satz: ' + this.state.label : '');
      this.tick();
    },

    /** Überspringen, Abbrechen oder Bestätigen: Timer entfernen. */
    stop() {
      this.state = null;
      this.persist();
      Notify.cancel();
      this.swScheduled = false;
      clearInterval(this.interval);
      this.interval = null;
      this.render();
      Wake.update();
    },

    run() {
      clearInterval(this.interval);
      // Das Intervall zählt nichts, es aktualisiert nur die Anzeige anhand von endAt.
      this.interval = setInterval(() => this.tick(), 250);
      this.tick();
      Wake.update();
    },

    tick() {
      this.check(false);
      this.render();
    },

    /**
     * Prüft, ob die Pause vorbei ist, und löst das Signal genau einmal aus.
     * `resumed`: App kam gerade (wieder) in den Vordergrund / wurde neu geladen.
     */
    check(resumed) {
      const t = this.state;
      if (!t) return;
      const now = Date.now();
      if (!TimerCore.isDone(t, now)) return;
      const late = now - t.endAt;
      if (!t.fired) {
        t.fired = true;
        this.persist();
        // Ist die Pause schon lange vorbei (App war im Hintergrund), nicht mehr piepen.
        this.fire(!resumed || late < 60000);
      }
      // "Pause vorbei"-Anzeige nach 20 s bzw. 2 min (nach Rückkehr) automatisch ausblenden.
      if (late > (resumed ? 120000 : 20000)) this.stop();
    },

    fire(withSound) {
      const s = db.settings;
      if (withSound && s.sound) Sound.alarm();
      if (withSound && s.vibrate && navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      if (document.visibilityState !== 'visible' && !this.swScheduled) {
        Notify.show('Pause vorbei 💪', this.state && this.state.label ? 'Nächster Satz: ' + this.state.label : '');
      }
    },

    render() {
      const bar = $('#timer-bar');
      const t = this.state;
      document.body.classList.toggle('timer-on', !!t);
      if (!t) { bar.hidden = true; return; }
      bar.hidden = false;
      const now = Date.now();
      const done = TimerCore.isDone(t, now);
      bar.classList.toggle('done', done);
      $('#timer-time').textContent = done ? '0:00' : fmtClock(TimerCore.remaining(t, now));
      $('#timer-label').textContent = done ? 'Pause vorbei!' : 'Pause' + (t.label ? ' · ' + t.label : '');
      $('#timer-fill').style.transform = 'scaleX(' + TimerCore.progress(t, now) + ')';
      $('#timer-controls').hidden = done;
      $('#timer-done-controls').hidden = !done;
    },
  };

  /* ---------- Toast ---------- */

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 250);
    }, 2600);
  }

  /* ---------- Dialoge (als Bottom Sheet, gut mit einer Hand bedienbar) ---------- */

  /**
   * Öffnet einen Dialog. Rückgabe: Promise mit dem `value` des gedrückten Buttons,
   * dem Eingabetext (Button mit `submit: true`) oder null (abgebrochen).
   */
  function openDialog({ title, message, html, input, chips, buttons }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      const inp = input ? `
        <input class="in modal-input" id="dlg-input" type="${esc(input.type || 'text')}" autocomplete="${esc(input.autocomplete || 'off')}" autocapitalize="${input.type === 'password' ? 'off' : 'sentences'}"
          inputmode="${esc(input.inputmode || 'text')}" placeholder="${esc(input.placeholder || '')}"
          value="${esc(input.value || '')}" ${input.list ? 'list="dlg-list"' : ''} enterkeyhint="done">
        ${input.list ? `<datalist id="dlg-list">${input.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}` : '';
      wrap.innerHTML = `
        <div class="modal-backdrop" data-close></div>
        <div class="modal-card" role="dialog" aria-modal="true" ${title ? 'aria-labelledby="dlg-title"' : ''}>
          ${title ? `<h2 class="modal-title" id="dlg-title">${esc(title)}</h2>` : ''}
          ${message ? `<p class="modal-msg">${esc(message)}</p>` : ''}
          ${html || ''}
          ${inp}
          ${chips ? `<div class="chips">${chips.map((c) => `<button type="button" class="chip" data-chip="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>` : ''}
          <div class="modal-actions ${buttons.length > 2 ? 'stack' : ''}">
            ${buttons.map((b, i) => `<button type="button" class="btn ${b.style || ''}" data-idx="${i}">${esc(b.label)}</button>`).join('')}
          </div>
        </div>`;
      const field = $('#dlg-input', wrap);
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && field && document.activeElement === field) {
          e.preventDefault();
          const sub = buttons.find((b) => b.submit);
          if (sub) close(field.value);
        }
      };
      function close(val) {
        document.removeEventListener('keydown', onKey);
        wrap.classList.add('closing');
        setTimeout(() => wrap.remove(), 180);
        resolve(val);
      }
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) return close(null);
        const chip = e.target.closest('[data-chip]');
        if (chip && field) { field.value = chip.dataset.chip; return; }
        const b = e.target.closest('[data-idx]');
        if (b) {
          const btn = buttons[Number(b.dataset.idx)];
          close(btn.submit ? (field ? field.value : '') : btn.value === undefined ? null : btn.value);
        }
      });
      document.addEventListener('keydown', onKey);
      $('#modal-root').appendChild(wrap);
      if (field) {
        field.focus(); // synchron im Klick-Handler → iOS öffnet die Tastatur
        if (input.select !== false) field.select();
      }
    });
  }

  async function promptText(title, opts) {
    const o = opts || {};
    const val = await openDialog({
      title, message: o.message,
      input: { value: o.value, placeholder: o.placeholder, inputmode: o.inputmode, list: o.list },
      chips: o.chips,
      buttons: [{ label: 'Abbrechen', style: 'ghost' }, { label: o.okLabel || 'Speichern', style: 'primary', submit: true }],
    });
    if (val === null) return null;
    const t = String(val).trim();
    return t === '' ? null : t;
  }

  async function confirmAction(title, message, okLabel, danger) {
    const v = await openDialog({
      title, message,
      buttons: [{ label: 'Abbrechen', style: 'ghost' }, { label: okLabel || 'OK', style: danger === false ? 'primary' : 'danger', value: true }],
    });
    return v === true;
  }

  function actionSheet(title, items) {
    return openDialog({
      title,
      buttons: items.map((it) => ({ label: it.label, value: it.value, style: it.danger ? 'danger-soft' : 'soft' }))
        .concat([{ label: 'Abbrechen', style: 'ghost' }]),
    });
  }

  function promptRest(title, current) {
    return promptText(title, {
      value: String(current),
      placeholder: 'Sekunden',
      inputmode: 'numeric',
      message: 'Pause in Sekunden (0 = kein Timer).',
      chips: [45, 60, 90, 120, 180, 240].map((s) => ({ label: fmtRest(s), value: String(s) })),
    }).then((v) => {
      if (v === null) return null;
      const n = parseNum(v);
      if (n === null) { toast('Bitte eine Zahl eingeben.'); return null; }
      return clampRest(n);
    });
  }

  /** Alle bekannten Übungsnamen (Pläne + Verlauf) für Vorschläge beim Eintippen. */
  function knownExerciseNames() {
    const set = new Map();
    for (const d of db.days) for (const e of d.exercises) set.set(normName(e.name), e.name);
    for (const s of db.sessions) for (const e of s.exercises) if (!set.has(normName(e.name))) set.set(normName(e.name), e.name);
    return [...set.values()].sort((a, b) => a.localeCompare(b, 'de'));
  }

  /* ---------- Routing (Hash-basiert, funktioniert offline und nach Neuladen) ---------- */

  const ui = {
    historyTab: 'sessions', chartMode: {}, lastRoute: null, authMode: 'login', authEmail: '',
    isAdmin: false,          // wird von cloud.js gesetzt (Prüfung über die Firestore-Regeln)
    admin: { users: null, loading: false, error: null, filter: '', stats: {} },
    blocked: null,           // Sperr-Info, falls sie während des Anmeldens eintrifft
  };

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    switch (parts[0]) {
      case 'day': return { name: 'day', id: parts[1], tab: 'home' };
      case 'workout': return { name: 'workout', tab: 'home' };
      case 'history':
        if (parts[1] === 'ex') return { name: 'history-ex', key: parts[2] || '', tab: 'history' };
        if (parts[1] === 'session') return { name: 'history-session', id: parts[2], tab: 'history' };
        return { name: 'history', tab: 'history' };
      case 'settings': return { name: 'settings', tab: 'settings' };
      case 'summary': return { name: 'summary', id: parts[1], tab: 'home' };
      case 'import': return { name: 'import', code: parts[1] || '', tab: 'home' };
      case 'preview': return { name: 'preview', id: parts[1], tab: 'home' };
      case 'admin': return { name: 'admin', id: parts[1] || null, tab: 'settings' };
      case 'body': return { name: 'body', id: parts[1] || 'new', tab: 'history' };
      case 'login': return { name: 'login', tab: 'settings' };
      default: return { name: 'home', tab: 'home' };
    }
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function setHeader({ title, back, actions, large, hidden }) {
    const h = $('#header');
    h.hidden = !!hidden;
    h.className = 'app-header' + (large ? ' large' : '');
    h.innerHTML = `
      <div class="hdr-side">${back ? `<a class="hdr-btn" href="${back}" aria-label="Zurück">${ICON.back}<span>Zurück</span></a>` : ''}</div>
      <h1 class="hdr-title">${esc(title)}</h1>
      <div class="hdr-side right">${actions || ''}</div>`;
    document.title = title === 'Training' || title === 'Gym Tracker' ? 'Gym Tracker' : title + ' · Gym Tracker';
  }

  /** Zeichnet die aktuelle Ansicht neu. Bei gleicher Route bleibt die Scrollposition erhalten. */
  function render() {
    const route = parseRoute();
    // Noch nicht entschieden (Konto oder ohne Konto)? → Anmeldeseite
    if (!account && route.name !== 'login') {
      if (route.name === 'import') ui.pendingImport = route.code; // nach dem Anmelden weitermachen
      location.replace('#/login');
      return;
    }
    if (isUser() && route.name === 'login') { location.replace('#/'); return; }
    document.body.classList.toggle('no-tabbar', !account);

    const key = location.hash || '#/';
    const sameRoute = key === ui.lastRoute;
    const scrollY = window.scrollY;
    const view = $('#view');

    switch (route.name) {
      case 'day': renderDay(view, route.id); break;
      case 'workout': renderWorkout(view); break;
      case 'history': renderHistory(view); break;
      case 'history-ex': renderExerciseHistory(view, route.key); break;
      case 'history-session': renderSession(view, route.id); break;
      case 'summary': renderSummary(view, route.id); break;
      case 'import': renderImport(view, route.code); break;
      case 'preview': renderPreview(view, route.id); break;
      case 'admin': renderAdmin(view, route.id); break;
      case 'body': renderBodyForm(view, route.id); break;
      case 'settings': renderSettings(view); break;
      case 'login': renderLogin(view); break;
      default: renderHome(view);
    }

    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === route.tab));
    $('#tab-dot').hidden = !db.activeSession;
    ui.lastRoute = key;
    window.scrollTo(0, sameRoute ? scrollY : 0);
  }

  /* ---------- Ansicht: Startseite (Trainingstage) ---------- */

  function renderHome(view) {
    if (ui.pendingImport) {
      const code = ui.pendingImport;
      ui.pendingImport = null;
      location.replace('#/import/' + code);
      return;
    }
    setHeader({ title: 'Training', large: true });
    const now = Date.now();
    const s = db.activeSession;
    const active = s ? `
      <a class="active-banner" href="#/workout">
        <span class="pulse" aria-hidden="true"></span>
        <span class="ab-text"><strong>Training läuft: ${esc(s.dayName)}</strong>
          <small>Seit ${fmtTime(s.startedAt)} Uhr · ${fmtDuration(now - s.startedAt)}</small></span>
        <span class="ab-go">Fortsetzen ${ICON.chevron}</span>
      </a>` : '';

    const cards = db.days.map((d) => {
      const last = Core.lastTrained(db, d.id);
      const isActive = s && s.dayId === d.id;
      const exNames = d.exercises.map((e) => e.name).join(' · ');
      return `
        <div class="day-card ${isActive ? 'is-active' : ''}" data-action="preview-day" data-id="${esc(d.id)}" role="button" tabindex="0">
          <div class="day-main">
            <div class="day-name">${esc(d.name)}</div>
            <div class="day-meta">${d.exercises.length} ${d.exercises.length === 1 ? 'Übung' : 'Übungen'} ·
              ${isActive ? '<span class="accent">läuft gerade</span>' : last ? 'zuletzt ' + fmtRelative(last, now) + (fmtRelative(last, now) === fmtDate(last) ? '' : ' (' + fmtDate(last) + ')') : 'noch nicht trainiert'}</div>
            ${exNames ? `<div class="day-ex">${esc(exNames)}</div>` : ''}
          </div>
          <button class="icon-btn" data-action="day-menu" data-id="${esc(d.id)}" aria-label="Optionen für ${esc(d.name)}">${ICON.more}</button>
        </div>`;
    }).join('');

    view.innerHTML = `
      ${active}
      ${db.sessions.length ? weekCard() : ''}
      ${db.days.length ? `
        <div class="day-list">${cards}</div>
        <button class="btn soft block" data-action="add-day">${ICON.plus} Neuer Trainingstag</button>
        <button class="btn ghost block" data-action="import-paste">${ICON.share} Geteilten Plan einfügen</button>` : `
        <div class="welcome">
          <img class="welcome-logo" src="icons/icon.svg" alt="">
          <h2>Willkommen!</h2>
          <p>Lege zuerst deine Trainingstage an – zum Beispiel „Push“, „Pull“ und „Beine“ oder „Oberkörper“ und „Unterkörper“.</p>
          <ol class="steps">
            <li><strong>Trainingstag anlegen</strong><span>Gib ihm einen Namen.</span></li>
            <li><strong>Übungen hinzufügen</strong><span>Pro Übung legst du die Anzahl der Sätze und die Satzpause fest.</span></li>
            <li><strong>Training starten</strong><span>Tippe auf den Tag, trage Gewicht &amp; Wiederholungen ein und hake Sätze ab.</span></li>
          </ol>
          <button class="btn primary block lg" data-action="add-day">${ICON.plus} Ersten Trainingstag anlegen</button>
          <button class="btn ghost block" data-action="import-paste">${ICON.share} Geteilten Plan einfügen</button>
        </div>`}`;
  }

  /* ---------- Ansicht: Übungsvorschau vor dem Start ---------- */

  /** Kurzer Vorschlag fürs nächste Training einer Plan-Übung (für die Vorschau). */
  function previewHint(ex, prev) {
    if (!ex.repMin) return '';
    const inc = db.settings.increment;
    const p = Core.progression(prev, { min: ex.repMin, max: ex.repMax }, inc, ex.sets);
    if (!p || p.kind === 'first') return '';
    if (p.kind === 'increase') return p.next !== null ? `💡 Heute steigern: ${fmtNum(p.next)} kg × ${ex.repMin}` : '💡 Heute steigern: Zusatzgewicht oder schwerere Variante';
    if (p.kind === 'below') return '🎯 Gewicht halten, Untergrenze schaffen';
    return '🎯 Gleiches Gewicht, je 1 Wdh. mehr';
  }

  function renderPreview(view, dayId) {
    const day = Core.findDay(db, dayId);
    if (!day) { go('#/'); return; }
    const s = db.activeSession;
    const isActive = s && s.dayId === day.id;
    const last = Core.lastTrained(db, day.id);
    const mins = Core.estimateMinutes(day);
    const totalSets = day.exercises.reduce((n, e) => n + e.sets, 0);
    setHeader({
      title: day.name, back: '#/',
      actions: `<a class="hdr-btn" href="#/day/${encodeURIComponent(day.id)}" aria-label="Plan bearbeiten">${ICON.edit}</a>`,
    });

    if (!day.exercises.length) {
      view.innerHTML = `
        <div class="empty"><p><strong>Noch keine Übungen.</strong></p>
          <p class="muted">Füge zuerst Übungen hinzu – mit Sätzen, Ziel-Wiederholungen und Satzpause.</p></div>
        <a class="btn primary block lg" href="#/day/${encodeURIComponent(day.id)}">${ICON.plus} Übungen hinzufügen</a>`;
      return;
    }

    const items = day.exercises.map((ex, i) => {
      const prev = Core.lastPerformance(db, ex.name);
      const hint = previewHint(ex, prev);
      return `
        <li class="pv-item">
          <span class="pv-no">${i + 1}</span>
          <div class="pv-main">
            <div class="pv-name">${esc(ex.name)}</div>
            <div class="pv-meta">${ex.repMin ? ex.sets + ' × ' + fmtRepTarget(ex.repMin, ex.repMax) : fmtSets(ex.sets)} · ${ex.rest ? fmtRest(ex.rest) + ' Pause' : 'kein Timer'}</div>
            ${ex.note ? `<div class="pv-note">${ICON.pin}<span>${esc(ex.note)}</span></div>` : ''}
            ${prev ? `<div class="pv-prev">Letztes Mal: ${prev.sets.map((st) => esc(fmtSet(st).replace(' kg × ', '×'))).join(' · ')}</div>` : ''}
            ${hint ? `<div class="pv-hint">${hint}</div>` : ''}
          </div>
        </li>`;
    }).join('');

    view.innerHTML = `
      <div class="stats">
        <div><strong>${day.exercises.length}</strong><small>${day.exercises.length === 1 ? 'Übung' : 'Übungen'}</small></div>
        <div><strong>${totalSets}</strong><small>Sätze</small></div>
        <div><strong>ca. ${mins} min</strong><small>Dauer</small></div>
      </div>
      <p class="wk-meta">${last ? 'Zuletzt trainiert: ' + fmtRelative(last, Date.now()) + (fmtRelative(last, Date.now()) === fmtDate(last) ? '' : ' (' + fmtDate(last) + ')') : 'Noch nicht trainiert'}</p>
      <section class="card flush"><ol class="pv-list">${items}</ol></section>
      <div class="pv-actions">
        <button class="btn primary block lg" data-action="open-day" data-id="${esc(day.id)}">${ICON.play} ${isActive ? 'Training fortsetzen' : 'Training starten'}</button>
        <div class="btn-row">
          <button class="btn soft" data-action="share-day" data-id="${esc(day.id)}">${ICON.share} Training teilen</button>
          <a class="btn soft" href="#/day/${encodeURIComponent(day.id)}">${ICON.edit} Bearbeiten</a>
        </div>
      </div>`;
  }

  /** Kleine Karte „Diese Woche 2 von 3 · 🔥 4 Wochen in Folge“ */
  function weekCard() {
    const w = Core.weekStats(db, Date.now(), db.settings.weeklyGoal);
    const dots = Array.from({ length: w.goal }, (_, i) => `<i class="${i < w.thisWeek ? 'on' : ''}"></i>`).join('');
    return `
      <button class="week-card" data-action="open-calendar">
        <span class="week-dots" aria-hidden="true">${dots}</span>
        <span class="week-text"><strong>Diese Woche: ${w.thisWeek} von ${w.goal}</strong>
          <small>${w.streak ? '🔥 ' + w.streak + (w.streak === 1 ? ' Woche' : ' Wochen') + ' in Folge geschafft' : 'Wochenziel: ' + w.goal + '× trainieren'}</small></span>
        ${ICON.cal}
      </button>`;
  }

  /* ---------- Ansicht: Trainingstag bearbeiten ---------- */

  function renderDay(view, dayId) {
    const day = Core.findDay(db, dayId);
    if (!day) { go('#/'); return; }
    const isActive = db.activeSession && db.activeSession.dayId === day.id;
    setHeader({
      title: day.name, back: '#/',
      actions: `<button class="hdr-btn" data-action="day-rename" data-id="${esc(day.id)}" aria-label="Tag umbenennen">${ICON.edit}</button>`,
    });

    const rows = day.exercises.map((ex, i) => `
      <li class="ex-row" data-id="${esc(ex.id)}" data-index="${i}">
        <button class="drag-handle" aria-label="Ziehen zum Sortieren">${ICON.grip}</button>
        <div class="ex-row-main">
          <button class="ex-row-name" data-action="ex-rename" data-id="${esc(ex.id)}">${esc(ex.name)}</button>
          <div class="ex-chips">
            <button class="chip small" data-action="ex-sets" data-id="${esc(ex.id)}" aria-label="Sätze für ${esc(ex.name)}">${ICON.sets} ${fmtSets(ex.sets)}</button>
            <button class="chip small ${ex.repMin ? '' : 'dim'}" data-action="ex-target" data-id="${esc(ex.id)}" aria-label="Ziel-Wiederholungen für ${esc(ex.name)}">${ICON.target} ${ex.repMin ? fmtRepTarget(ex.repMin, ex.repMax) : 'Wdh.-Ziel'}</button>
            <button class="chip small" data-action="ex-rest" data-id="${esc(ex.id)}" aria-label="Satzpause für ${esc(ex.name)}">${ICON.clock} ${ex.rest ? fmtRest(ex.rest) : 'kein Timer'}</button>
            ${ex.note ? '' : `<button class="chip small dim" data-action="ex-note" data-id="${esc(ex.id)}">${ICON.pin} Notiz</button>`}
          </div>
          ${ex.note ? `<button class="ex-note" data-action="ex-note" data-id="${esc(ex.id)}">${ICON.pin}<span>${esc(ex.note)}</span></button>` : ''}
        </div>
        <div class="ex-row-actions">
          <button class="icon-btn sm" data-action="ex-up" data-index="${i}" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button class="icon-btn sm" data-action="ex-down" data-index="${i}" aria-label="Nach unten" ${i === day.exercises.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button class="icon-btn sm danger" data-action="ex-del" data-id="${esc(ex.id)}" aria-label="${esc(ex.name)} entfernen">${ICON.trash}</button>
        </div>
      </li>`).join('');

    view.innerHTML = `
      <p class="section-label">Übungen</p>
      ${day.exercises.length ? `<ul class="ex-list" id="ex-list" data-day="${esc(day.id)}">${rows}</ul>`
        : '<div class="empty"><p class="muted">Noch keine Übungen. Füge die erste hinzu.</p></div>'}
      <button class="btn soft block" data-action="ex-add" data-id="${esc(day.id)}">${ICON.plus} Übung hinzufügen</button>
      <p class="hint">Tipp: Am Griff ${ICON.grip} ziehen oder die Pfeile nutzen, um die Reihenfolge zu ändern. Tippe auf den Namen zum Umbenennen und auf die Chips für Sätze, Ziel-Wiederholungen, Satzpause und eine dauerhafte Notiz (z. B. Sitzeinstellung).</p>
      ${day.exercises.length ? `<button class="btn primary block lg" data-action="open-day" data-id="${esc(day.id)}">${ICON.play} ${isActive ? 'Zum laufenden Training' : 'Training starten'}</button>` : ''}`;

    const list = $('#ex-list');
    if (list) enableDragSort(list, (from, to) => {
      Core.moveExercise(db, day.id, from, to);
      save();
      render();
    });
  }

  /**
   * Drag & Drop per Pointer Events (funktioniert mit Finger und Maus).
   * Nur der Griff startet das Ziehen, damit normales Scrollen möglich bleibt.
   */
  function enableDragSort(list, onDrop) {
    list.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle || (e.button !== undefined && e.button !== 0)) return;
      const item = handle.closest('.ex-row');
      const items = [...list.children];
      const from = items.indexOf(item);
      const rects = items.map((el) => el.getBoundingClientRect());
      const step = items.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
      const startY = e.clientY;
      let to = from;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      item.classList.add('dragging');
      list.classList.add('sorting');

      const move = (ev) => {
        const dy = ev.clientY - startY;
        item.style.transform = `translateY(${dy}px)`;
        const center = rects[from].top + rects[from].height / 2 + dy;
        to = from;
        rects.forEach((r, i) => {
          const mid = r.top + r.height / 2;
          if (i < from && center < mid) to = Math.min(to, i);
          if (i > from && center > mid) to = Math.max(to, i);
        });
        items.forEach((el, i) => {
          if (el === item) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -step;
          if (from > to && i < from && i >= to) shift = step;
          el.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const end = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        items.forEach((el) => { el.style.transform = ''; });
        item.classList.remove('dragging');
        list.classList.remove('sorting');
        if (ev.type === 'pointerup' && to !== from) onDrop(from, to);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }

  /* ---------- Ansicht: Laufendes Training ---------- */

  /** Geplante Satzanzahl einer Übung der laufenden Einheit (aus dem Plan). */
  function planSets(se) {
    const ex = db.activeSession && Core.findExercise(db, db.activeSession.dayId, se.exId);
    return ex ? ex.sets : se.sets.length;
  }

  function promptSets(title, current) {
    return promptText(title, {
      value: String(current),
      placeholder: 'Anzahl',
      inputmode: 'numeric',
      message: 'So viele Sätze werden beim Start des Trainings für diese Übung angelegt. Im Training kannst du jederzeit weitere hinzufügen oder entfernen.',
      chips: [1, 2, 3, 4, 5, 6].map((n) => ({ label: fmtSets(n), value: String(n) })),
    }).then((v) => {
      if (v === null) return null;
      const n = parseNum(v);
      if (n === null || n < 1) { toast('Bitte eine Zahl ab 1 eingeben.'); return null; }
      return Math.min(20, Math.round(n));
    });
  }

  /** Dialog für Ziel-Wiederholungen. Rückgabe: {min,max} (min null = kein Ziel) oder null (abgebrochen). */
  async function promptRepTarget(title, min, max) {
    const v = await openDialog({
      title,
      message: 'Wiederholungen pro Satz, z. B. „8-12“ oder eine feste Zahl wie „5“. Schaffst du in allen Sätzen die Obergrenze, schlägt die App beim nächsten Mal mehr Gewicht vor.',
      input: { value: min ? (min === max ? String(min) : min + '-' + max) : '', placeholder: 'z. B. 8-12' },
      chips: ['5', '6-8', '8-10', '8-12', '10-15', '12-15'].map((c) => ({ label: c.replace('-', '–'), value: c })),
      buttons: [{ label: 'Abbrechen', style: 'ghost' }]
        .concat(min ? [{ label: 'Kein Ziel', style: 'soft', value: '__none' }] : [])
        .concat([{ label: 'Speichern', style: 'primary', submit: true }]),
    });
    if (v === null) return null;
    if (v === '__none') return { min: null, max: null };
    const t = parseRepTarget(v);
    if (t === null) return { min: null, max: null };
    if (t === undefined) { toast('Bitte z. B. „8-12“ oder „10“ eingeben.'); return null; }
    return t;
  }

  /** Dialog für die dauerhafte Übungsnotiz. Rückgabe: Text ('' = löschen) oder null (abgebrochen). */
  async function promptExerciseNote(title, current) {
    const v = await openDialog({
      title,
      message: 'Steht bei dieser Übung immer dabei – z. B. Sitzeinstellung, Griff oder Hinweise zur Ausführung.',
      input: { value: current || '', placeholder: 'z. B. Sitz Stufe 4, Griff eng', select: false },
      buttons: [{ label: 'Abbrechen', style: 'ghost' }]
        .concat(current ? [{ label: 'Notiz löschen', style: 'danger-soft', value: '__del' }] : [])
        .concat([{ label: 'Speichern', style: 'primary', submit: true }]),
    });
    if (v === null) return null;
    return v === '__del' ? '' : String(v).trim();
  }

  /** Text zum Steigerungsvorschlag einer Übung. */
  function progressionHint(ctx) {
    const p = ctx.prog;
    if (!p) return '';
    const range = fmtRepTarget(ctx.target.min, ctx.target.max);
    if (p.kind === 'first') return `${ICON.target}<span>Ziel: <b>${range}</b> pro Satz – wähle ein Gewicht, mit dem du im Bereich bleibst.</span>`;
    if (p.kind === 'increase') {
      return p.next !== null
        ? `💡<span>Alle Sätze mit ${ctx.target.max}+ Wdh. geschafft → heute <b>${fmtNum(p.next)} kg</b> (+${fmtNum(ctx.inc)}) für ${ctx.target.min} Wdh.</span>`
        : `💡<span>Alle Sätze mit ${ctx.target.max}+ Wdh. geschafft → Zeit für Zusatzgewicht oder eine schwerere Variante.</span>`;
    }
    if (p.kind === 'below') return `${ICON.target}<span>Letztes Mal unter ${ctx.target.min} Wdh. – Gewicht halten und die Untergrenze schaffen.</span>`;
    return `${ICON.target}<span>Heute: gleiches Gewicht, je <b>1 Wdh. mehr</b> (Ziel ${range}).</span>`;
  }

  function renderWorkout(view) {
    const s = db.activeSession;
    if (!s) { go('#/'); return; }
    setHeader({
      title: s.dayName, back: '#/',
      actions: `<button class="hdr-btn accent" data-action="finish">Beenden</button>`,
    });

    const cards = s.exercises.map((se) => {
      const ctx = Core.exerciseContext(db, se);
      const prev = ctx.prev;
      const plan = ctx.plan;
      const doneCount = se.sets.filter((st) => st.done).length;
      const activeIdx = se.sets.findIndex((st) => !st.done); // hier arbeitest du gerade → +/−-Buttons
      const hint = progressionHint(ctx);
      if (se.skipped) {
        return `
          <section class="card ex-card skipped" data-se="${esc(se.id)}">
            <div class="ex-head">
              <h2>${esc(se.name)}</h2>
              <span class="count">übersprungen</span>
            </div>
            <button class="btn soft block sm" data-action="w-unskip" data-se="${esc(se.id)}">Wieder aufnehmen</button>
          </section>`;
      }
      const eff = db.settings.effort;
      const prevLine = prev
        ? `<div class="prev"><span>Letztes Mal · ${fmtShortDate(prev.date)}</span> ${prev.sets.map((st) => '<b>' + esc(fmtSet(st)) + '</b>').join('<i>·</i>')}</div>`
        : '<div class="prev muted">Noch kein Verlauf – leg los!</div>';

      const sets = se.sets.map((st, i) => {
        const ph = Core.placeholderFor(prev, se, i, ctx);
        const steps = i === activeIdx ? `
            <div class="set-steps">
              <span></span>
              <div class="stepper">
                <button class="step" data-action="set-step" data-field="weight" data-delta="${-ctx.inc}" aria-label="${fmtNum(ctx.inc)} kg weniger">−${fmtNum(ctx.inc)}</button>
                <button class="step" data-action="set-step" data-field="weight" data-delta="${ctx.inc}" aria-label="${fmtNum(ctx.inc)} kg mehr">+${fmtNum(ctx.inc)}</button>
              </div>
              <div class="stepper">
                <button class="step" data-action="set-step" data-field="reps" data-delta="-1" aria-label="1 Wiederholung weniger">−1</button>
                <button class="step" data-action="set-step" data-field="reps" data-delta="1" aria-label="1 Wiederholung mehr">+1</button>
              </div>
              <span></span>
            </div>` : '';
        return `
          <div class="set ${st.done ? 'done' : ''}" data-se="${esc(se.id)}" data-set="${esc(st.id)}">
            <div class="set-main">
              <span class="set-no">${i + 1}</span>
              <label class="field">
                <input class="in num" data-field="weight" type="text" inputmode="decimal" autocomplete="off"
                  placeholder="${esc(fmtNum(ph.weight))}" value="${esc(fmtNum(st.weight))}" aria-label="Gewicht Satz ${i + 1}">
                <span class="unit">kg</span>
              </label>
              <label class="field">
                <input class="in num" data-field="reps" type="text" inputmode="numeric" autocomplete="off"
                  placeholder="${ph.reps === null ? '' : esc(ph.reps)}" value="${st.reps === null ? '' : esc(st.reps)}" aria-label="Wiederholungen Satz ${i + 1}">
                <span class="unit">Wdh.</span>
              </label>
              <button class="check" data-action="set-toggle" aria-pressed="${st.done}" aria-label="Satz ${i + 1} ${st.done ? 'nicht mehr erledigt' : 'erledigt'}">${ICON.check}</button>
            </div>${steps}
            <div class="set-sub">
              <input class="in note" data-field="note" type="text" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"
                placeholder="${esc(ph.note ? 'Letztes Mal: ' + ph.note : 'Notiz / Wie war der Satz?')}" value="${esc(st.note)}" aria-label="Notiz Satz ${i + 1}">
              ${eff !== 'off' ? `<input class="in effort" data-field="${eff}" type="text" inputmode="decimal" autocomplete="off"
                placeholder="${eff.toUpperCase()}${prev && prev.sets[i] && prev.sets[i][eff] !== undefined ? ' ' + fmtNum(prev.sets[i][eff]) : ''}"
                value="${st[eff] !== undefined ? fmtNum(st[eff]) : ''}" aria-label="${eff.toUpperCase()} Satz ${i + 1}">` : ''}
              <button class="icon-btn sm ghost" data-action="set-del" aria-label="Satz ${i + 1} löschen">${ICON.trash}</button>
            </div>
          </div>`;
      }).join('');

      return `
        <section class="card ex-card" data-se="${esc(se.id)}">
          <div class="ex-head">
            <h2>${esc(se.name)}</h2>
            <span class="count ${doneCount && doneCount === se.sets.length ? 'accent' : ''}">${doneCount}/${se.sets.length}</span>
            <button class="icon-btn sm" data-action="w-ex-menu" data-se="${esc(se.id)}" aria-label="Optionen für ${esc(se.name)}">${ICON.more}</button>
          </div>
          ${plan && plan.note ? `<button class="ex-note" data-action="w-note" data-se="${esc(se.id)}">${ICON.pin}<span>${esc(plan.note)}</span></button>` : ''}
          <div class="ex-sub">
            ${se.exId ? `<button class="chip small" data-action="w-sets" data-se="${esc(se.id)}">${ICON.sets} ${fmtSets(planSets(se))} geplant</button>` : ''}
            ${plan ? `<button class="chip small ${plan.repMin ? '' : 'dim'}" data-action="w-target" data-se="${esc(se.id)}">${ICON.target} ${plan.repMin ? fmtRepTarget(plan.repMin, plan.repMax) : 'Wdh.-Ziel'}</button>` : ''}
            <button class="chip small" data-action="w-rest" data-se="${esc(se.id)}">${ICON.clock} Pause ${se.rest ? fmtRest(se.rest) : 'aus'}</button>
            ${plan && !plan.note ? `<button class="chip small dim" data-action="w-note" data-se="${esc(se.id)}">${ICON.pin} Notiz</button>` : ''}
          </div>
          ${prevLine}
          ${hint ? `<div class="prog-hint ${ctx.prog.kind}">${hint}</div>` : ''}
          <div class="sets">${sets}</div>
          <button class="btn soft block sm" data-action="set-add" data-se="${esc(se.id)}">${ICON.plus} Satz</button>
        </section>`;
    }).join('');

    const wakeHint = !Wake.supported ? `
      <p class="hint warn">Dein Browser kann den Bildschirm nicht automatisch anlassen. Tipp: iPhone-Einstellungen → Anzeige &amp; Helligkeit → Automatische Sperre verlängern.</p>` : '';

    view.innerHTML = `
      <div class="wk-meta">Gestartet ${fmtTime(s.startedAt)} Uhr · <span id="elapsed">${fmtDuration(Date.now() - s.startedAt)}</span></div>
      ${wakeHint}
      ${cards || '<div class="empty"><p class="muted">Dieser Tag hat noch keine Übungen.</p></div>'}
      <button class="btn soft block" data-action="w-add-ex">${ICON.plus} Übung hinzufügen</button>
      <a class="btn ghost block" href="#/day/${encodeURIComponent(s.dayId || '')}">${ICON.edit} Plan bearbeiten</a>
      <div class="wk-end">
        <button class="btn primary block lg" data-action="finish">Training beenden &amp; speichern</button>
        <button class="btn ghost block danger-text" data-action="discard">Training verwerfen</button>
      </div>`;
  }

  /* ---------- Ansicht: Verlauf ---------- */

  function renderHistory(view) {
    setHeader({ title: 'Verlauf', large: true });
    const tab = ui.historyTab;
    const seg = `
      <div class="segmented four" role="tablist">
        ${[['sessions', 'Einheiten'], ['calendar', 'Kalender'], ['exercises', 'Übungen'], ['body', 'Körper']].map(([k, l]) => `
          <button role="tab" aria-selected="${tab === k}" data-action="hist-tab" data-tab="${k}">${l}</button>`).join('')}
      </div>`;

    if (tab === 'calendar') { view.innerHTML = seg + calendarHTML(); return; }
    if (tab === 'body') { view.innerHTML = seg + bodyHTML(); return; }

    if (!db.sessions.length) {
      view.innerHTML = seg + `<div class="empty"><p><strong>Noch keine Einheiten.</strong></p>
        <p class="muted">Sobald du ein Training beendest, erscheint es hier.</p></div>`;
      return;
    }

    let body;
    if (tab === 'exercises') {
      body = '<div class="list">' + Core.exerciseStats(db).map((it) => `
        <a class="list-item" href="#/history/ex/${encodeURIComponent(it.key)}">
          <div class="li-main">
            <div class="li-title">${esc(it.name)}</div>
            <div class="li-sub">${it.count}× trainiert · zuletzt ${fmtDate(it.last)}</div>
          </div>
          <div class="li-side">${it.best.weight !== null ? `<strong>${fmtNum(it.best.weight)} kg</strong><small>Bestes Gewicht</small>` : it.best.reps !== null ? `<strong>${it.best.reps}</strong><small>Beste Wdh.</small>` : ''}</div>
          ${ICON.chevron}
        </a>`).join('') + '</div>';
    } else {
      const sessions = db.sessions.slice().reverse();
      let month = '';
      body = sessions.map((s) => {
        const st = Core.sessionStats(s);
        const m = new Date(s.finishedAt).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
        const head = m !== month ? `<p class="section-label">${esc(m)}</p>` : '';
        month = m;
        return head + `
          <a class="list-item card-like" href="#/history/session/${encodeURIComponent(s.id)}">
            <div class="li-main">
              <div class="li-title">${esc(s.dayName)}</div>
              <div class="li-sub">${fmtLongDate(s.finishedAt)} · ${fmtTime(s.startedAt)} Uhr · ${fmtDuration(st.duration)}</div>
              <div class="li-sub">${st.exercises} Übungen · ${st.sets} Sätze${st.volume ? ' · ' + fmtInt(st.volume) + ' kg Volumen' : ''}</div>
            </div>
            ${ICON.chevron}
          </a>`;
      }).join('');
    }
    view.innerHTML = seg + body;
  }

  /** Kalender-Reiter: Wochenziel, Monatsansicht, Einheiten des gewählten Tags */
  function calendarHTML() {
    const now = Date.now();
    const w = Core.weekStats(db, now, db.settings.weeklyGoal);
    const month = ui.calMonth ? new Date(ui.calMonth) : new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1);
    const y = month.getFullYear(), m = month.getMonth();
    const byDay = Core.sessionsByDay(db);
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const todayKey = Core.dayKey(now);
    let monthCount = 0;
    let cells = '<span></span>'.repeat(offset);
    for (let d = 1; d <= days; d++) {
      const key = Core.dayKey(new Date(y, m, d, 12).getTime());
      const list = byDay.get(key) || [];
      monthCount += list.length;
      cells += `<button class="cal-cell ${list.length ? 'has' : ''} ${key === todayKey ? 'today' : ''} ${key === ui.calDay ? 'sel' : ''}"
        data-action="cal-day" data-key="${key}" aria-label="${d}. – ${list.length} Training(s)"><span>${d}</span>${list.length ? '<i></i>' : ''}</button>`;
    }
    const sel = ui.calDay ? byDay.get(ui.calDay) || [] : [];
    const selList = ui.calDay ? (sel.length ? sel.map((x) => `
      <a class="list-item" href="#/history/session/${encodeURIComponent(x.id)}">
        <div class="li-main"><div class="li-title">${esc(x.dayName)}</div>
        <div class="li-sub">${fmtTime(x.startedAt)} Uhr · ${fmtDuration(Core.sessionStats(x).duration)} · ${Core.sessionStats(x).sets} Sätze</div></div>${ICON.chevron}
      </a>`).join('') : '<p class="hint center">An diesem Tag kein Training.</p>') : '';
    return `
      <section class="card week-summary">
        <div><strong>${w.thisWeek}/${w.goal}</strong><small>diese Woche</small></div>
        <div><strong>${w.streak ? '🔥 ' + w.streak : '–'}</strong><small>${w.streak === 1 ? 'Woche' : 'Wochen'} in Folge</small></div>
        <div><strong>${monthCount}</strong><small>im ${month.toLocaleDateString('de-DE', { month: 'long' })}</small></div>
      </section>
      <section class="card cal">
        <div class="cal-head">
          <button class="icon-btn" data-action="cal-month" data-delta="-1" aria-label="Vormonat">${ICON.back}</button>
          <strong>${month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</strong>
          <button class="icon-btn" data-action="cal-month" data-delta="1" aria-label="Nächster Monat">${ICON.chevron}</button>
        </div>
        <div class="cal-grid">
          ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span class="cal-wd">${d}</span>`).join('')}
          ${cells}
        </div>
      </section>
      ${selList ? `<p class="section-label">${new Date(ui.calDay + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>${selList}` : ''}
      <p class="hint center">Wochenziel: ${w.goal}× pro Woche – änderbar in den Einstellungen.</p>`;
  }

  /** Körper-Reiter: aktuelle Werte, Verlauf als Graph, alle Messungen */
  function bodyHTML() {
    const add = '<a class="btn primary block" href="#/body/new">' + ICON.plus + ' Messung eintragen</a>';
    if (!db.body.length) {
      return `<div class="empty"><p><strong>Noch keine Messungen.</strong></p>
        <p class="muted">Trage dein Körpergewicht und – wenn du willst – Maße wie Taille oder Oberarm ein und verfolge sie über die Zeit.</p></div>${add}`;
    }
    const fields = Core.BODY_FIELDS.filter(([k]) => Core.latestBody(db, k));
    let field = ui.bodyField && fields.some(([k]) => k === ui.bodyField) ? ui.bodyField : fields[0][0];
    const [, label, unit] = Core.BODY_FIELDS.find(([k]) => k === field);
    const points = db.body.filter((e) => e[field] !== null).map((e) => ({ x: e.date, y: e[field] }));
    const tiles = fields.map(([k, l, u]) => {
      const vals = db.body.filter((e) => e[k] !== null);
      const last = vals[vals.length - 1][k];
      const before = vals.length > 1 ? vals[vals.length - 2][k] : null;
      const diff = before === null ? '' : `<em class="${last > before ? 'up' : last < before ? 'down' : ''}">${last > before ? '+' : ''}${fmtNum(Math.round((last - before) * 10) / 10)}</em>`;
      return `<button class="body-tile ${k === field ? 'sel' : ''}" data-action="body-field" data-key="${k}">
        <strong>${fmtNum(last)} <small>${u}</small></strong><span>${l} ${diff}</span></button>`;
    }).join('');
    const list = db.body.slice().reverse().map((e) => `
      <a class="list-item" href="#/body/${encodeURIComponent(e.id)}">
        <div class="li-main">
          <div class="li-title">${fmtLongDate(e.date)}</div>
          <div class="li-sub">${Core.BODY_FIELDS.filter(([k]) => e[k] !== null).map(([k, l, u]) => (k === 'weight' ? '' : l + ' ') + fmtNum(e[k]) + ' ' + u).join(' · ')}${e.note ? ' · ' + esc(e.note) : ''}</div>
        </div>${ICON.chevron}
      </a>`).join('');
    return `
      ${add}
      <div class="body-tiles">${tiles}</div>
      <section class="card">
        <div class="chart-head"><span class="muted">${label}</span></div>
        ${chartSVG(points, unit)}
      </section>
      <p class="section-label">Alle Messungen</p>
      <div class="list">${list}</div>`;
  }

  /** Formular: neue Messung oder vorhandene bearbeiten */
  function renderBodyForm(view, id) {
    const e = id === 'new' ? null : db.body.find((x) => x.id === id);
    if (id !== 'new' && !e) { go('#/history'); return; }
    setHeader({ title: e ? 'Messung bearbeiten' : 'Neue Messung', back: '#/history' });
    const today = Core.dayKey(Date.now());
    view.innerHTML = `
      <form id="body-form" class="auth-form" data-id="${e ? esc(e.id) : ''}" novalidate>
        <label class="lbl">Datum
          <input class="in" type="date" name="date" value="${Core.dayKey(e ? e.date : Date.now())}" max="${today}">
        </label>
        <div class="form-grid">
          ${Core.BODY_FIELDS.map(([k, l, u]) => {
            const last = Core.latestBody(db, k);
            return `<label class="lbl ${k === 'weight' ? 'wide' : ''}">${l} (${u})
              <input class="in" name="${k}" type="text" inputmode="decimal" autocomplete="off"
                value="${e && e[k] !== null ? fmtNum(e[k]) : ''}" placeholder="${last ? fmtNum(last.value) : ''}">
            </label>`;
          }).join('')}
        </div>
        <label class="lbl">Notiz
          <input class="in" name="note" type="text" autocomplete="off" value="${e ? esc(e.note) : ''}" placeholder="z. B. morgens, nüchtern">
        </label>
        <p class="hint">Alles optional – trag nur ein, was du misst. Graue Zahlen zeigen deinen letzten Wert.</p>
        <button class="btn primary block lg" type="submit">Speichern</button>
      </form>
      ${e ? `<button class="btn ghost block danger-text" data-action="body-del" data-id="${esc(e.id)}">${ICON.trash} Messung löschen</button>` : ''}`;
  }

  function onBodySubmit(form) {
    const val = (n) => form.elements[n].value;
    const d = val('date').split('-').map(Number);
    const date = d.length === 3 && d[0] ? new Date(d[0], d[1] - 1, d[2], 12).getTime() : Date.now();
    const entry = { id: form.dataset.id || undefined, date, note: val('note').trim() };
    for (const [k] of Core.BODY_FIELDS) entry[k] = val(k);
    const saved = Core.saveBodyEntry(db, entry);
    if (!saved) { toast('Bitte mindestens einen Wert eintragen.'); return; }
    save();
    ui.historyTab = 'body';
    go('#/history');
    toast('Messung gespeichert');
  }

  /* ---------- Teilen ---------- */

  function shareLink(plan) {
    return location.origin + location.pathname + '#/import/' + Core.encodePlan(plan);
  }

  const IMPORT_HOWTO = 'Training nachmachen? In der Gym-Tracker-App auf „Geteilten Plan einfügen“ tippen und diesen Link einfügen:';

  function fmtSetShort(st) {
    if (st.weight !== null && st.reps !== null) return fmtNum(st.weight) + '×' + st.reps;
    return fmtSet(st);
  }

  function planLine(e) {
    return '• ' + e.n + ' – ' + (e.a ? e.s + ' × ' + fmtRepTarget(e.a, e.b) : fmtSets(e.s)) + (e.r ? ', ' + fmtRest(e.r) + ' Pause' : '');
  }

  function sessionShareText(sess) {
    const st = Core.sessionStats(sess);
    const recs = Core.sessionRecords(db, sess);
    const lines = [
      '💪 ' + sess.dayName + ' – ' + fmtLongDate(sess.finishedAt),
      '⏱ ' + fmtDuration(st.duration) + ' · ' + fmtSets(st.sets) + (st.volume ? ' · ' + fmtInt(st.volume) + ' kg Volumen' : ''),
    ];
    for (const r of recs) {
      lines.push('🏆 ' + r.name + ': ' + (r.type === 'reps' ? r.value + ' Wdh.' : (r.type === 'e1rm' ? '≈ ' : '') + fmtNum(r.value) + ' kg') + ' (Rekord)');
    }
    lines.push('');
    for (const e of sess.exercises) lines.push(e.name + ': ' + e.sets.map(fmtSetShort).join(', '));
    lines.push('', IMPORT_HOWTO, shareLink(Core.planFromSession(db, sess)));
    return lines.join('\n');
  }

  function shareDay(day) {
    if (!day.exercises.length) { toast('Dieser Tag hat noch keine Übungen.'); return; }
    const plan = Core.planFromDay(day);
    const text = ['🏋️ Mein Trainingsplan „' + day.name + '“', ''].concat(plan.e.map(planLine), ['', IMPORT_HOWTO, shareLink(plan)]).join('\n');
    shareText('Trainingsplan ' + day.name, text);
  }

  /** Teilen-Menü des Systems (iPhone: WhatsApp, Nachrichten, …) – sonst in die Zwischenablage. */
  async function shareText(title, text) {
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Kopiert – jetzt z. B. in WhatsApp einfügen.');
    } catch (e) {
      await openDialog({
        title, message: 'Text markieren und kopieren:',
        html: `<textarea class="in share-text" readonly rows="8">${esc(text)}</textarea>`,
        buttons: [{ label: 'Schließen', style: 'primary' }],
      });
    }
  }

  /** Vorschau eines geteilten Plans mit „Übernehmen“ */
  function renderImport(view, code) {
    setHeader({ title: 'Plan übernehmen', back: '#/' });
    let plan;
    try { plan = Core.decodePlan(code); } catch (e) {
      view.innerHTML = `<div class="notice warn"><strong>Das hat nicht geklappt</strong>${esc(e.message)} Bitte den kompletten Link kopieren und erneut einfügen.</div>
        <a class="btn soft block" href="#/">Zur Startseite</a>`;
      return;
    }
    view.innerHTML = `
      <div class="summary-hero">
        <div class="hero-emoji" aria-hidden="true">📥</div>
        <h2>${esc(plan.name)}</h2>
        <p>Jemand hat diesen Trainingsplan mit dir geteilt.</p>
      </div>
      <section class="card">
        <ol class="plan-list">${plan.exercises.map((e) => `
          <li><strong>${esc(e.name)}</strong>
            <span>${fmtSets(e.sets)}${e.repMin ? ' · ' + fmtRepTarget(e.repMin, e.repMax) : ''}${e.rest ? ' · ' + fmtRest(e.rest) + ' Pause' : ''}</span></li>`).join('')}
        </ol>
      </section>
      <button class="btn primary block lg" data-action="import-add" data-code="${esc(code)}">${ICON.plus} Als Trainingstag hinzufügen</button>
      <a class="btn ghost block" href="#/">Abbrechen</a>`;
  }

  function renderSession(view, id) {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) { go('#/history'); return; }
    const st = Core.sessionStats(s);
    setHeader({
      title: s.dayName, back: '#/history',
      actions: `<button class="hdr-btn" data-action="share-session" data-id="${esc(s.id)}" aria-label="Training teilen">${ICON.share}</button>
        <button class="hdr-btn danger" data-action="del-session" data-id="${esc(s.id)}" aria-label="Einheit löschen">${ICON.trash}</button>`,
    });
    view.innerHTML = `
      <div class="stats">
        <div><strong>${fmtDuration(st.duration)}</strong><small>Dauer</small></div>
        <div><strong>${st.sets}</strong><small>Sätze</small></div>
        <div><strong>${fmtInt(st.volume)}</strong><small>kg Volumen</small></div>
      </div>
      <p class="wk-meta">${fmtLongDate(s.finishedAt)} · ${fmtTime(s.startedAt)}–${fmtTime(s.finishedAt)} Uhr</p>
      ${recordsCard(Core.sessionRecords(db, s))}
      ${s.exercises.map((e) => `
        <section class="card">
          <a class="ex-head link" href="#/history/ex/${encodeURIComponent(normName(e.name))}"><h2>${esc(e.name)}</h2>${ICON.chevron}</a>
          ${setTable(e.sets)}
        </section>`).join('')}
      <button class="btn ghost block danger-text" data-action="del-session" data-id="${esc(s.id)}">${ICON.trash} Einheit löschen</button>`;
  }

  function recordsCard(recs) {
    if (!recs.length) return '';
    const label = { weight: 'Höchstes Gewicht', e1rm: 'Geschätztes 1RM', reps: 'Meiste Wdh.' };
    const val = (r, v) => (r.type === 'reps' ? v + ' Wdh.' : (r.type === 'e1rm' ? '≈ ' : '') + fmtNum(v) + ' kg');
    return `
      <section class="card records">
        <h2 class="records-title">🏆 Neue Rekorde</h2>
        <ul>${recs.map((r) => `
          <li><strong>${esc(r.name)}</strong>
            <span>${label[r.type]}: <b>${val(r, r.value)}</b> <small>(vorher ${val(r, r.prev)})</small></span></li>`).join('')}
        </ul>
      </section>`;
  }

  /** Zusammenfassung direkt nach dem Training: Statistik, Vergleich, Rekorde. */
  function renderSummary(view, id) {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) { go('#/'); return; }
    const st = Core.sessionStats(s);
    const recs = Core.sessionRecords(db, s);
    const before = Core.previousSessionOfDay(db, s);
    setHeader({ title: 'Zusammenfassung', actions: '<button class="hdr-btn accent" data-action="summary-done">Fertig</button>' });

    let compare = '';
    if (before) {
      const b = Core.sessionStats(before);
      const pct = b.volume ? Math.round((st.volume - b.volume) / b.volume * 100) : null;
      const cls = pct === null ? '' : pct > 0 ? 'up' : pct < 0 ? 'down' : '';
      compare = `
        <section class="card compare">
          <p class="muted">Im Vergleich zum letzten „${esc(before.dayName)}“ (${fmtShortDate(before.finishedAt)})</p>
          <div class="compare-row">
            ${pct !== null ? `<div class="${cls}"><strong>${pct > 0 ? '+' : ''}${pct} %</strong><small>Volumen</small></div>` : ''}
            <div><strong>${st.sets === b.sets ? '±0' : (st.sets > b.sets ? '+' : '') + (st.sets - b.sets)}</strong><small>Sätze</small></div>
            <div><strong>${fmtDuration(st.duration)}</strong><small>statt ${fmtDuration(b.duration)}</small></div>
          </div>
        </section>`;
    }

    view.innerHTML = `
      <div class="summary-hero">
        <div class="hero-emoji" aria-hidden="true">${recs.length ? '🏆' : '🎉'}</div>
        <h2>${recs.length ? (recs.length === 1 ? 'Neuer Rekord!' : recs.length + ' neue Rekorde!') : 'Training geschafft!'}</h2>
        <p>${esc(s.dayName)} · ${fmtLongDate(s.finishedAt)}</p>
      </div>
      <div class="stats">
        <div><strong>${fmtDuration(st.duration)}</strong><small>Dauer</small></div>
        <div><strong>${st.sets}</strong><small>Sätze</small></div>
        <div><strong>${fmtInt(st.volume)}</strong><small>kg Volumen</small></div>
      </div>
      ${recordsCard(recs)}
      ${compare}
      ${s.exercises.map((e) => `
        <section class="card">
          <a class="ex-head link" href="#/history/ex/${encodeURIComponent(normName(e.name))}"><h2>${esc(e.name)}</h2>${ICON.chevron}</a>
          ${setTable(e.sets)}
        </section>`).join('')}
      <button class="btn soft block" data-action="share-session" data-id="${esc(s.id)}">${ICON.share} Training teilen</button>
      <button class="btn primary block lg" data-action="summary-done">Fertig</button>`;
  }

  function setTable(sets) {
    return `<ol class="set-table">${sets.map((st) => `
      <li><span class="st-val">${esc(fmtSet(st))}</span>${st.weight && st.reps ? `<span class="st-e1">≈ ${fmtNum(Math.round(e1rm(st.weight, st.reps) * 10) / 10)} kg 1RM</span>` : ''}
        ${st.rir !== undefined ? `<span class="st-e1">RIR ${fmtNum(st.rir)}</span>` : ''}${st.rpe !== undefined ? `<span class="st-e1">RPE ${fmtNum(st.rpe)}</span>` : ''}
        ${st.note ? `<span class="st-note">${esc(st.note)}</span>` : ''}</li>`).join('')}</ol>`;
  }

  function renderExerciseHistory(view, key) {
    const hist = Core.exerciseHistory(db, key);
    if (!hist.length) { go('#/history'); return; }
    const name = hist[hist.length - 1].name;
    setHeader({ title: name, back: '#/history' });

    const has = {
      e1rm: hist.some((h) => h.best.e1rm !== null),
      weight: hist.some((h) => h.best.weight !== null),
      reps: hist.some((h) => h.best.reps !== null),
    };
    let mode = ui.chartMode[key];
    if (!mode || !has[mode]) mode = has.e1rm ? 'e1rm' : has.weight ? 'weight' : 'reps';
    const tabs = { e1rm: '1RM (geschätzt)', weight: 'Gewicht', reps: 'Wdh.' };
    const labels = { e1rm: 'Bestes geschätztes 1RM', weight: 'Bestes Gewicht', reps: 'Beste Wdh.' };
    const unit = mode === 'reps' ? 'Wdh.' : 'kg';
    const points = hist.filter((h) => h.best[mode] !== null).map((h) => ({ x: h.date, y: h.best[mode] }));
    const bestVal = Math.max(...points.map((p) => p.y));

    view.innerHTML = `
      <section class="card">
        <div class="segmented small" role="tablist">
          ${['e1rm', 'weight', 'reps'].filter((m) => has[m]).map((m) => `
            <button role="tab" aria-selected="${m === mode}" data-action="chart-mode" data-mode="${m}" data-key="${esc(key)}">${tabs[m]}</button>`).join('')}
        </div>
        <div class="chart-head"><span class="muted">${labels[mode]}</span> <strong>${fmtNum(Math.round(bestVal * 10) / 10)} ${unit}</strong></div>
        ${chartSVG(points, unit)}
        ${mode === 'e1rm' ? '<p class="hint">1RM geschätzt nach Epley: Gewicht × (1 + Wdh./30).</p>' : ''}
      </section>
      <p class="section-label">Alle Sätze</p>
      ${hist.slice().reverse().map((h) => `
        <section class="card">
          <a class="ex-head link" href="#/history/session/${encodeURIComponent(h.sessionId)}">
            <h2 class="sm">${fmtLongDate(h.date)} <span class="muted">· ${esc(h.dayName)}</span></h2>${ICON.chevron}
          </a>
          ${setTable(h.sets)}
        </section>`).join('')}`;
  }

  /** Schlanker Fortschrittsgraph als SVG (keine Bibliothek). */
  function chartSVG(points, unit) {
    if (!points.length) return '<p class="muted">Noch keine Daten.</p>';
    const W = 340, H = 190, P = { l: 44, r: 14, t: 16, b: 28 };
    let minX = points[0].x, maxX = points[points.length - 1].x;
    if (minX === maxX) { minX -= 86400000; maxX += 86400000; }
    const ys = points.map((p) => p.y);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = (maxY - minY) * 0.2 || Math.max(1, maxY * 0.1);
    minY = Math.max(0, minY - pad); maxY += pad;
    const sx = (x) => P.l + (x - minX) / (maxX - minX) * (W - P.l - P.r);
    const sy = (y) => H - P.b - (y - minY) / (maxY - minY) * (H - P.t - P.b);
    const pts = points.map((p) => [sx(p.x), sy(p.y)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - P.b} L${pts[0][0].toFixed(1)} ${H - P.b} Z`;
    const grid = [0, 0.5, 1].map((f) => {
      const v = minY + (maxY - minY) * f;
      const y = sy(v);
      return `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" class="c-grid"/>
        <text x="${P.l - 8}" y="${y + 4}" class="c-label" text-anchor="end">${fmtNum(Math.round(v))}</text>`;
    }).join('');
    const last = pts[pts.length - 1];
    const lastP = points[points.length - 1];
    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fortschritt in ${esc(unit)}">
        <defs><linearGradient id="c-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="c-stop1"/><stop offset="1" class="c-stop2"/></linearGradient></defs>
        ${grid}
        ${pts.length > 1 ? `<path d="${area}" fill="url(#c-fill)"/><path d="${line}" class="c-line"/>` : ''}
        ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" class="c-dot"/>`).join('')}
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5.5" class="c-dot-last"/>
        <text x="${Math.min(last[0], W - P.r - 4).toFixed(1)}" y="${Math.max(last[1] - 11, 12).toFixed(1)}" class="c-value" text-anchor="end">${fmtNum(Math.round(lastP.y * 10) / 10)} ${esc(unit)}</text>
        <text x="${P.l}" y="${H - 8}" class="c-label">${fmtShortDate(points[0].x)}</text>
        ${points.length > 1 ? `<text x="${W - P.r}" y="${H - 8}" class="c-label" text-anchor="end">${fmtShortDate(lastP.x)}</text>` : ''}
      </svg>`;
  }

  /* ---------- Ansicht: Anmelden / Konto erstellen ---------- */

  function renderLogin(view) {
    const reg = ui.authMode === 'register';
    // Ohne Konto unterwegs und über die Einstellungen hierher gekommen → Zurück-Knopf
    if (account) setHeader({ title: 'Konto', back: '#/settings' });
    else setHeader({ title: 'Gym Tracker', hidden: true });

    if (!cloudConfigured) {
      view.innerHTML = `
        <div class="auth">
          <img class="auth-logo" src="icons/icon.svg" alt="">
          <h1 class="auth-title">Gym Tracker</h1>
          <div class="notice warn">
            <strong>Konten sind noch nicht eingerichtet</strong>
            Damit man sich registrieren und anmelden kann, muss einmalig ein kostenloses Firebase-Projekt
            angelegt und in <code>firebase-config.js</code> eingetragen werden (siehe README.md).
            Bis dahin speichert die App alles nur auf diesem Gerät.
          </div>
          <button class="btn primary block lg" data-action="auth-guest">Ohne Konto fortfahren</button>
        </div>`;
      return;
    }

    view.innerHTML = `
      <div class="auth">
        <img class="auth-logo" src="icons/icon.svg" alt="">
        <h1 class="auth-title">Gym Tracker</h1>
        <p class="auth-sub">${reg
          ? 'Erstelle ein Konto – deine Trainings werden dann sicher in der Cloud gespeichert und sind auf all deinen Geräten verfügbar.'
          : 'Melde dich an, um deine Trainingsdaten zu laden und zu speichern.'}</p>
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected="${!reg}" data-action="auth-mode" data-mode="login">Anmelden</button>
          <button role="tab" aria-selected="${reg}" data-action="auth-mode" data-mode="register">Konto erstellen</button>
        </div>
        <form id="auth-form" class="auth-form" novalidate>
          <label class="lbl">E-Mail
            <input class="in" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off"
              spellcheck="false" required value="${esc(ui.authEmail || '')}" placeholder="name@beispiel.de">
          </label>
          <label class="lbl">Passwort
            <input class="in" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}"
              required minlength="6" placeholder="${reg ? 'mindestens 6 Zeichen' : ''}">
          </label>
          ${reg ? `<label class="lbl">Passwort wiederholen
            <input class="in" name="password2" type="password" autocomplete="new-password" required minlength="6">
          </label>` : ''}
          <p class="form-error" id="auth-error" role="alert" hidden></p>
          <button class="btn primary block lg" type="submit" id="auth-submit">${reg ? 'Konto erstellen' : 'Anmelden'}</button>
        </form>
        ${reg ? '' : '<button class="btn ghost block" data-action="auth-reset">Passwort vergessen?</button>'}
        ${account ? '' : `
          <div class="divider"><span>oder</span></div>
          <button class="btn soft block" data-action="auth-guest">Ohne Konto fortfahren</button>
          <p class="hint center">Ohne Konto bleiben die Daten nur auf diesem Gerät. Du kannst dich später jederzeit
          in den Einstellungen anmelden und deine Daten übernehmen.</p>`}
      </div>`;
  }

  /** Verständliche deutsche Meldungen für Firebase-Fehlercodes. */
  function authErrorText(e) {
    const code = (e && e.code) || '';
    const wrong = 'E-Mail oder Passwort ist falsch.';
    const map = {
      'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
      'auth/missing-email': 'Bitte gib deine E-Mail-Adresse ein.',
      'auth/missing-password': 'Bitte gib dein Passwort ein.',
      'auth/user-not-found': wrong,
      'auth/wrong-password': wrong,
      'auth/invalid-credential': wrong,
      'auth/invalid-login-credentials': wrong,
      'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto. Melde dich stattdessen an.',
      'auth/weak-password': 'Das Passwort ist zu schwach (mindestens 6 Zeichen).',
      'auth/password-does-not-meet-requirements': 'Das Passwort erfüllt die Anforderungen nicht.',
      'auth/too-many-requests': 'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.',
      'auth/network-request-failed': 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.',
      'auth/user-disabled': 'Dieses Konto wurde deaktiviert.',
      'auth/operation-not-allowed': 'Anmeldung per E-Mail ist im Firebase-Projekt nicht aktiviert.',
      'auth/unauthorized-domain': 'Diese Web-Adresse ist im Firebase-Projekt nicht freigegeben.',
      'auth/requires-recent-login': 'Bitte melde dich erneut an und versuche es dann noch einmal.',
      'permission-denied': 'Keine Berechtigung – bitte die Firestore-Regeln prüfen.',
      'unavailable': 'Server nicht erreichbar.',
      'no-cloud': 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.',
    };
    if (map[code]) return map[code];
    if (code.startsWith('auth/api-key-not-valid')) return 'Die Firebase-Konfiguration ist ungültig (firebase-config.js prüfen).';
    return 'Es ist ein Fehler aufgetreten' + (code ? ' (' + code + ')' : '') + '.';
  }

  function showAuthError(msg) {
    const el = $('#auth-error');
    if (!el) { toast(msg); return; }
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function onAuthSubmit(form) {
    const reg = ui.authMode === 'register';
    const email = form.email.value.trim();
    const pw = form.password.value;
    ui.authEmail = email;
    if (!email) return showAuthError('Bitte gib deine E-Mail-Adresse ein.');
    if (pw.length < 6) return showAuthError('Das Passwort muss mindestens 6 Zeichen lang sein.');
    if (reg && pw !== form.password2.value) return showAuthError('Die Passwörter stimmen nicht überein.');
    if (!window.GymCloud) return showAuthError(authErrorText({ code: 'no-cloud' }));

    const btn = $('#auth-submit');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Einen Moment …';
    showAuthError('');
    try {
      // Nach Erfolg meldet Firebase den Nutzer über onAuthState → enterAccount()
      if (reg) await window.GymCloud.signUp(email, pw);
      else await window.GymCloud.signIn(email, pw);
    } catch (e) {
      showAuthError(authErrorText(e));
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /** Wechselt in ein Konto: lokalen Kontospeicher laden, ggf. Gastdaten übernehmen, Abgleich starten. */
  let entering = false;
  async function enterAccount(user) {
    if (entering) return;
    entering = true;
    try {
      stopSync();
      writeLocal(); // aktuellen Stand (Gast oder anderes Konto) sichern
      const wasGuest = !isUser();
      const guestDb = db;
      let migrate = false;
      if (wasGuest && Sync.hasUserContent(guestDb)) {
        const v = await openDialog({
          title: 'Daten ins Konto übernehmen?',
          message: `Auf diesem Gerät gibt es bereits Daten ohne Konto (${guestDb.days.length} ` +
            `${guestDb.days.length === 1 ? 'Trainingstag' : 'Trainingstage'}, ${guestDb.sessions.length} ` +
            `${guestDb.sessions.length === 1 ? 'Einheit' : 'Einheiten'}). Sollen sie in dein Konto übernommen werden? ` +
            'Gleichnamige Trainingstage werden zusammengeführt.',
          buttons: [
            { label: 'Nicht übernehmen', style: 'ghost', value: false },
            { label: 'Übernehmen', style: 'primary', value: true },
          ],
        });
        migrate = v === true;
      }
      account = { mode: 'user', uid: user.uid, email: user.email };
      saveAccount();
      db = loadData(dataKey(), Core.emptyData);
      if (migrate) {
        Sync.mergeGuest(db, guestDb);
        lsDel(STORAGE_KEY); // steckt jetzt im Konto
      } else {
        Timer.stop();
      }
      writeLocal();
      applyTheme();
      startSync();
      Wake.update();
      ui.authEmail = '';
      go('#/');
      toast('Angemeldet als ' + user.email);
    } finally {
      entering = false;
    }
    if (ui.blocked) { const info = ui.blocked; ui.blocked = null; onBlocked(info); }
  }

  function startSync() {
    if (engine || !isUser() || !window.GymCloud) return;
    const uid = account.uid;
    engine = createSyncEngine({
      adapter: window.GymCloud.createAdapter(uid),
      getDb: () => db,
      loadBase: () => { try { return JSON.parse(lsGet(SYNC_PREFIX + uid)); } catch (e) { return null; } },
      saveBase: (b) => lsSet(SYNC_PREFIX + uid, JSON.stringify(b)),
      onRemoteChange: handleRemoteChange,
      onStatus: renderSyncStatus,
      onGone: async () => {
        await leaveAccount();
        toast('Dieses Konto wurde gelöscht.');
      },
    });
    engine.start();
  }

  function stopSync() {
    if (engine) { engine.stop(); engine = null; }
  }

  /** Neue Daten vom Server (z. B. von einem anderen Gerät). */
  let renderPending = false;
  function handleRemoteChange() {
    writeLocal();
    Wake.update();
    // Nicht neu zeichnen, während jemand tippt – sonst springt der Cursor.
    if (document.activeElement && document.activeElement.matches('input')) { renderPending = true; return; }
    render();
  }

  function syncStatusText() {
    if (!window.GymCloud) return navigator.onLine ? 'Verbinde …' : 'Offline – Abgleich folgt, sobald du online bist';
    if (!engine) return '–';
    const s = engine.state;
    if (!navigator.onLine && s.status !== 'synced') return 'Offline – Abgleich folgt, sobald du online bist';
    if (s.status === 'connecting') return 'Verbinde …';
    if (s.status === 'syncing') return navigator.onLine ? 'Wird synchronisiert …' : 'Offline – Abgleich folgt, sobald du online bist';
    if (s.status === 'error') return 'Fehler: ' + authErrorText(s.error) + ' Neuer Versuch folgt.';
    return '✓ Synchronisiert' + (s.lastSync ? ' · ' + fmtTime(s.lastSync) + ' Uhr' : '');
  }

  function renderSyncStatus() {
    const el = $('#sync-status');
    if (el) el.textContent = syncStatusText();
  }

  /** Abmelden bzw. Konto verlassen: lokale Kopie der Kontodaten entfernen. */
  async function leaveAccount() {
    stopSync();
    const uid = account && account.uid;
    account = null;           // vor signOut, damit onAuthState(null) nichts mehr tut
    saveAccount();
    if (window.GymCloud) { try { await window.GymCloud.signOut(); } catch (e) { /* offline egal */ } }
    if (uid) { lsDel(STORAGE_KEY + '.u.' + uid); lsDel(SYNC_PREFIX + uid); }
    Timer.stop();
    db = loadData(STORAGE_KEY, Core.emptyData);
    applyTheme();
    Wake.update();
    ui.authMode = 'login';
    ui.isAdmin = false;
    ui.admin = { users: null, loading: false, error: null, filter: '', stats: {} };
    go('#/login');
  }

  function accountSection() {
    if (isUser()) {
      return `
        <p class="section-label">Konto</p>
        <section class="card">
          <p class="kv"><span>Angemeldet als</span><span class="break">${esc(account.email)}</span></p>
          <p class="kv"><span>Cloud</span><span id="sync-status">${esc(syncStatusText())}</span></p>
          <p class="kv"><span>Nutzer-ID</span><button class="uid-btn" data-action="copy-uid" aria-label="Nutzer-ID kopieren">${esc(account.uid)}</button></p>
          <p class="hint">Deine Daten werden in deinem Konto gespeichert und auf allen Geräten abgeglichen, auf denen du angemeldet bist. Offline eingetragene Sätze werden automatisch nachgeladen.</p>
          <div class="btn-row">
            <button class="btn soft" data-action="sync-now">Jetzt abgleichen</button>
            <button class="btn soft" data-action="logout">Abmelden</button>
          </div>
          <button class="btn ghost block danger-text" data-action="delete-account">Konto löschen</button>
        </section>
        ${ui.isAdmin ? `
        <p class="section-label">Verwaltung</p>
        <section class="card">
          <p class="hint" style="margin-top:0">Du bist Administrator und kannst alle Konten verwalten.</p>
          <a class="btn primary block" href="#/admin">Nutzer verwalten</a>
        </section>` : ''}`;
    }
    return `
      <p class="section-label">Konto</p>
      <section class="card">
        <p class="kv"><span>Status</span><span>ohne Konto</span></p>
        <p class="hint">Ohne Konto liegen deine Daten nur auf diesem Gerät. Mit einem Konto werden sie in der Cloud gespeichert und sind auf allen Geräten verfügbar.</p>
        ${cloudConfigured
          ? '<button class="btn primary block" data-action="open-login">Anmelden oder Konto erstellen</button>'
          : '<div class="notice">Die Konto-Funktion ist noch nicht eingerichtet (Firebase-Daten in <code>firebase-config.js</code> eintragen, siehe README.md).</div>'}
      </section>`;
  }

  /* ---------- Ansicht: Nutzerverwaltung (nur für Administratoren) ---------- */

  async function loadAdminUsers() {
    const a = ui.admin;
    if (a.loading || !window.GymCloud) return;
    a.loading = true;
    a.error = null;
    try {
      a.users = await window.GymCloud.admin.listUsers();
      a.users.sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0));
    } catch (e) {
      a.error = e;
    }
    a.loading = false;
    if (parseRoute().name === 'admin') render();
  }

  async function loadAdminStats(uid) {
    try {
      ui.admin.stats[uid] = await window.GymCloud.admin.stats(uid);
    } catch (e) {
      ui.admin.stats[uid] = { error: e };
    }
    if (parseRoute().name === 'admin') render();
  }

  function adminListHTML() {
    const a = ui.admin;
    const q = a.filter.trim().toLowerCase();
    const users = (a.users || []).filter((u) => !q || (u.email || '').toLowerCase().includes(q) || u.uid.toLowerCase().includes(q));
    if (!users.length) return '<p class="hint center">Keine Nutzer gefunden.</p>';
    return users.map((u) => `
      <a class="list-item" href="#/admin/${encodeURIComponent(u.uid)}">
        <div class="li-main">
          <div class="li-title break">${esc(u.email || '(ohne E-Mail)')}
            ${u.uid === account.uid ? '<span class="badge">Du</span>' : ''}
            ${u.removed ? '<span class="badge danger">Entfernt</span>' : u.blocked ? '<span class="badge danger">Gesperrt</span>' : ''}</div>
          <div class="li-sub">${u.lastSeen ? 'Zuletzt aktiv ' + fmtRelative(u.lastSeen, Date.now()) : 'noch nicht aktiv'}${u.createdAt ? ' · seit ' + fmtDate(u.createdAt) : ''}</div>
        </div>${ICON.chevron}
      </a>`).join('');
  }

  function renderAdmin(view, uid) {
    if (!isUser() || !ui.isAdmin) { go('#/settings'); return; }
    const a = ui.admin;
    if (!a.users && !a.loading && !a.error) loadAdminUsers();

    if (!uid) {
      setHeader({ title: 'Nutzerverwaltung', back: '#/settings',
        actions: `<button class="hdr-btn" data-action="admin-reload" aria-label="Neu laden">↻</button>` });
      if (a.error) {
        view.innerHTML = `<div class="notice warn"><strong>Laden fehlgeschlagen</strong>${esc(authErrorText(a.error))}</div>
          <button class="btn soft block" data-action="admin-reload">Erneut versuchen</button>`;
        return;
      }
      if (!a.users) { view.innerHTML = '<p class="hint center">Lädt …</p>'; return; }
      const blocked = a.users.filter((u) => u.blocked).length;
      view.innerHTML = `
        <div class="stats">
          <div><strong>${a.users.filter((u) => !u.removed).length}</strong><small>Konten</small></div>
          <div><strong>${a.users.filter((u) => u.lastSeen && Date.now() - u.lastSeen < 7 * 86400000).length}</strong><small>aktiv (7 Tage)</small></div>
          <div><strong>${blocked}</strong><small>gesperrt</small></div>
        </div>
        <input class="in" id="admin-search" type="search" placeholder="Nach E-Mail suchen" value="${esc(a.filter)}" autocomplete="off" autocapitalize="off">
        <div class="list" id="admin-list" style="margin-top:10px">${adminListHTML()}</div>
        <p class="hint">Neue Nutzer erscheinen hier, sobald sie die App einmal geöffnet haben. Das Login selbst (E-Mail + Passwort) kannst du zusätzlich in der Firebase-Konsole unter Authentication → Nutzer endgültig löschen.</p>`;
      return;
    }

    const u = (a.users || []).find((x) => x.uid === uid);
    setHeader({ title: 'Nutzer', back: '#/admin' });
    if (!u) { view.innerHTML = a.users ? '<p class="hint center">Nutzer nicht gefunden.</p>' : '<p class="hint center">Lädt …</p>'; return; }
    const st = a.stats[uid];
    if (st === undefined) { a.stats[uid] = null; loadAdminStats(uid); }
    const self = uid === account.uid;
    view.innerHTML = `
      <section class="card">
        <h2 class="records-title break">${esc(u.email || '(ohne E-Mail)')}</h2>
        <p class="kv"><span>Nutzer-ID</span><span class="break">${esc(u.uid)}</span></p>
        <p class="kv"><span>Registriert</span><span>${u.createdAt ? fmtDate(u.createdAt) : '–'}</span></p>
        <p class="kv"><span>Zuletzt aktiv</span><span>${u.lastSeen ? fmtDate(u.lastSeen) + ' ' + fmtTime(u.lastSeen) : '–'}</span></p>
        <p class="kv"><span>Status</span><span>${u.removed ? '<span class="danger-text">entfernt</span>' : u.blocked ? '<span class="danger-text">gesperrt</span>' : '<span class="accent">aktiv</span>'}</span></p>
        ${u.blocked && u.blocked.reason ? `<p class="kv"><span>Grund</span><span>${esc(u.blocked.reason)}</span></p>` : ''}
      </section>
      <section class="card">
        ${st === null || st === undefined ? '<p class="hint center" style="margin:0">Daten werden gezählt …</p>'
          : st.error ? `<p class="hint" style="margin:0">Daten konnten nicht geladen werden: ${esc(authErrorText(st.error))}</p>`
          : `<div class="compare-row">
              <div><strong>${st.days}</strong><small>Trainingstage</small></div>
              <div><strong>${st.sessions}</strong><small>Einheiten</small></div>
              <div><strong>${st.body}</strong><small>Messungen</small></div>
            </div>${st.active ? '<p class="hint" style="margin-bottom:0">Hat gerade ein Training offen.</p>' : ''}`}
      </section>
      ${self ? '<p class="hint center">Das ist dein eigenes Konto – hier kannst du dich nicht selbst sperren oder löschen.</p>' : `
        ${u.blocked
          ? `<button class="btn primary block" data-action="admin-unblock" data-uid="${esc(uid)}">Entsperren</button>`
          : `<button class="btn soft block" data-action="admin-block" data-uid="${esc(uid)}">Sperren</button>`}
        <button class="btn soft block danger-text" data-action="admin-wipe" data-uid="${esc(uid)}">Trainingsdaten löschen</button>
        ${u.removed ? '' : `<button class="btn danger block" data-action="admin-remove" data-uid="${esc(uid)}">Konto entfernen</button>`}
        <p class="hint"><b>Sperren:</b> Der Nutzer wird sofort abgemeldet und kommt nicht mehr an seine Daten.
          <b>Trainingsdaten löschen:</b> löscht Tage, Einheiten und Messungen, das Konto bleibt.
          <b>Konto entfernen:</b> löscht alle Daten und sperrt das Konto dauerhaft.</p>`}`;
  }

  /** Wird von cloud.js aufgerufen, wenn das eigene Konto gesperrt wurde. */
  async function onBlocked(info) {
    if (entering) { ui.blocked = info; return; }
    if (!isUser()) return;
    await leaveAccount();
    await openDialog({
      title: 'Konto gesperrt',
      message: 'Dein Konto wurde vom Administrator gesperrt.' + (info && info.reason ? ' Grund: ' + info.reason : ''),
      buttons: [{ label: 'OK', style: 'primary' }],
    });
  }

  function setAdmin(v) {
    if (ui.isAdmin === !!v) return;
    ui.isAdmin = !!v;
    if (parseRoute().name === 'settings') render();
  }

  /* ---------- Ansicht: Einstellungen ---------- */

  function switchRow(key, label, desc) {
    const on = !!db.settings[key];
    return `
      <button class="row switch-row" role="switch" aria-checked="${on}" data-action="toggle-setting" data-key="${key}">
        <span class="row-text"><span>${label}</span>${desc ? `<small>${desc}</small>` : ''}</span>
        <span class="switch" aria-hidden="true"></span>
      </button>`;
  }

  function renderSettings(view) {
    setHeader({ title: 'Einstellungen', large: true });
    const st = db.settings;
    const perm = Notify.permission;
    const permText = {
      granted: '<span class="accent">erlaubt</span>',
      denied: '<span class="danger-text">blockiert</span>',
      default: 'noch nicht gefragt',
      unsupported: 'hier nicht verfügbar',
    }[perm];
    const lastBackup = st.lastBackup ? fmtRelative(st.lastBackup, Date.now()) + ' (' + fmtDate(st.lastBackup) + ')' : 'noch nie';
    const backupOld = !isUser() && (!st.lastBackup || Date.now() - st.lastBackup > 7 * 86400000);

    view.innerHTML = `
      ${accountSection()}

      <p class="section-label">Datensicherung</p>
      <section class="card">
        ${isUser() ? `
        <div class="notice">
          <strong>In der Cloud gesichert</strong>
          Deine Daten liegen in deinem Konto. Ein zusätzlicher Export als Datei schadet trotzdem nicht –
          z. B. bevor du etwas Größeres änderst.
        </div>` : `
        <div class="notice ${backupOld ? 'warn' : ''}">
          <strong>Regelmäßig sichern!</strong>
          Safari kann lokal gespeicherte Website-Daten löschen, z. B. wenn die App mehrere Wochen nicht geöffnet wurde
          oder der Speicher knapp ist. Exportiere daher regelmäßig (z. B. wöchentlich) ein Backup und lege es in
          „Dateien“ bzw. iCloud Drive ab${cloudConfigured ? ' – oder melde dich an, dann liegen die Daten in der Cloud' : ''}.
        </div>`}
        <p class="kv"><span>Letztes Backup</span><span>${lastBackup}</span></p>
        <p class="kv"><span>Gespeichert</span><span>${db.days.length} Tage · ${db.sessions.length} Einheiten</span></p>
        <div class="btn-row">
          <button class="btn primary" data-action="export">Exportieren</button>
          <button class="btn soft" data-action="import">Importieren</button>
        </div>
      </section>

      <p class="section-label">Training &amp; Pausentimer</p>
      <section class="card flush">
        <button class="row" data-action="increment">
          <span class="row-text"><span>Gewichtsschritt</span><small>für Steigerungsvorschläge und die +/− Buttons</small></span>
          <span class="row-value">${fmtNum(st.increment)} kg ${ICON.chevron}</span>
        </button>
        <button class="row" data-action="weekly-goal">
          <span class="row-text"><span>Wochenziel</span><small>Trainings pro Woche – für Serie &amp; Kalender</small></span>
          <span class="row-value">${st.weeklyGoal}× ${ICON.chevron}</span>
        </button>
        <button class="row" data-action="default-rest">
          <span class="row-text"><span>Standardpause</span><small>für neue Übungen</small></span>
          <span class="row-value">${fmtRest(st.defaultRest)} ${ICON.chevron}</span>
        </button>
        ${switchRow('sound', 'Signalton', 'Piept, wenn die Pause vorbei ist')}
        ${switchRow('vibrate', 'Vibration', 'Nur wo unterstützt (nicht auf dem iPhone)')}
        ${'audioSession' in navigator ? switchRow('loudMode', 'Ton trotz Lautlos-Schalter', 'Kann laufende Musik unterbrechen') : ''}
        <button class="row" data-action="test-sound">
          <span class="row-text"><span>Ton testen</span></span><span class="row-value">${ICON.play}</span>
        </button>
      </section>

      <p class="section-label">Anstrengung pro Satz</p>
      <section class="card">
        <div class="segmented" role="radiogroup" aria-label="Anstrengung erfassen">
          ${[['off', 'Aus'], ['rir', 'RIR'], ['rpe', 'RPE']].map(([v, l]) => `
            <button role="radio" aria-checked="${st.effort === v}" aria-selected="${st.effort === v}" data-action="effort" data-value="${v}">${l}</button>`).join('')}
        </div>
        <p class="hint"><b>RIR</b> („Reps in Reserve“): Wie viele Wiederholungen wären noch gegangen? 0 = bis zum Versagen.
          <b>RPE</b>: gefühlte Anstrengung von 1 bis 10 (10 = Maximum). Das Feld erscheint im Training neben der Notiz.</p>
      </section>

      <p class="section-label">Benachrichtigungen</p>
      <section class="card">
        <p class="kv"><span>Status</span><span>${permText}</span></p>
        ${perm === 'default' ? '<button class="btn primary block" data-action="notif">Benachrichtigungen erlauben</button>' : ''}
        ${perm === 'granted' ? '<button class="btn soft block" data-action="notif-test">Test-Benachrichtigung</button>' : ''}
        <div class="notice">
          <strong>So klappt es auf dem iPhone (ab iOS 16.4):</strong>
          <ol>
            <li>Öffne die App in Safari und tippe auf <em>Teilen</em> → <em>Zum Home-Bildschirm</em>.</li>
            <li>Starte die App über das neue Icon auf dem Home-Bildschirm.</li>
            <li>Tippe hier auf <em>Benachrichtigungen erlauben</em> und bestätige.</li>
          </ol>
          <p>Wichtig: iOS pausiert Web-Apps im Hintergrund. Am zuverlässigsten ist es, die App während der Pause
          geöffnet zu lassen – der Bildschirm bleibt dabei automatisch an und der Signalton ertönt pünktlich.
          Der Ton ist nur zu hören, wenn der Lautlos-Schalter aus ist${'audioSession' in navigator ? ' (oder die Option oben aktiv ist)' : ''}.</p>
          ${isIOS && !isStandalone() ? '<p class="accent"><strong>Du nutzt die App gerade im Browser – füge sie zuerst zum Home-Bildschirm hinzu.</strong></p>' : ''}
          ${perm === 'denied' ? '<p>Du hast Benachrichtigungen blockiert. Aktivieren: iPhone-Einstellungen → Mitteilungen → Gym.</p>' : ''}
        </div>
      </section>

      <p class="section-label">Darstellung</p>
      <section class="card">
        <div class="segmented" role="radiogroup" aria-label="Design">
          ${[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'System']].map(([v, l]) => `
            <button role="radio" aria-checked="${st.theme === v}" aria-selected="${st.theme === v}" data-action="theme" data-value="${v}">${l}</button>`).join('')}
        </div>
      </section>

      <p class="section-label">Daten</p>
      <section class="card flush">
        <button class="row" data-action="load-sample"><span class="row-text"><span>Beispiel-Trainingstage hinzufügen</span><small>Push, Pull, Beine</small></span></button>
        <button class="row danger-text" data-action="reset"><span class="row-text"><span>Alle Daten löschen</span></span></button>
      </section>
      <p class="hint center">Gym Tracker · ${isUser() ? 'Daten in deinem Konto gespeichert.' : 'Daten bleiben nur auf diesem Gerät.'}</p>`;
  }

  /* ---------- Theme ---------- */

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const t = db.settings.theme;
    const dark = t === 'dark' || (t === 'system' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#0b0d10' : '#f4f5f7');
  }

  /* ---------- Backup: Export & Import ---------- */

  function backupFileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `gym-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  }

  async function exportData() {
    save();
    const payload = { app: 'gym-tracker', version: DATA_VERSION, exportedAt: new Date().toISOString(), data: db };
    const json = JSON.stringify(payload, null, 2);
    const name = backupFileName();
    const file = new File([json], name, { type: 'application/json' });
    const touch = window.matchMedia('(pointer: coarse)').matches;

    // Auf dem iPhone: Teilen-Menü → "In Dateien sichern" (zuverlässiger als ein Download in der Home-Bildschirm-App).
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Gym Tracker Backup' });
        markBackup();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        // sonst: Download versuchen
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markBackup();
  }

  function markBackup() {
    db.settings.lastBackup = Date.now();
    save();
    toast('Backup erstellt ✓');
    render();
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      let data;
      try {
        data = Core.normalize(JSON.parse(await f.text()));
      } catch (e) {
        toast(e instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : e.message);
        return;
      }
      const ok = await confirmAction('Backup wiederherstellen?',
        `Das Backup enthält ${data.days.length} Trainingstage und ${data.sessions.length} Einheiten. ` +
        (isUser() ? 'Alle aktuellen Daten in deinem Konto werden dadurch ersetzt – auf allen Geräten.'
          : 'Alle aktuellen Daten auf diesem Gerät werden dadurch ersetzt.'), 'Ersetzen');
      if (!ok) return;
      data.settings.lastBackup = data.settings.lastBackup || Date.now();
      db = data;
      save();
      Timer.stop();
      applyTheme();
      toast('Backup wiederhergestellt ✓');
      render();
    });
    input.click();
  }

  /* ---------- Aktionen ---------- */

  async function openDay(dayId) {
    const day = Core.findDay(db, dayId);
    if (!day) return;
    const s = db.activeSession;
    if (s && s.dayId === dayId) { go('#/workout'); return; }
    if (!day.exercises.length) {
      toast('Füge zuerst Übungen hinzu.');
      go('#/day/' + encodeURIComponent(dayId));
      return;
    }
    if (s) {
      const choice = await actionSheet(`Es läuft bereits „${s.dayName}“`, [
        { label: `„${s.dayName}“ fortsetzen`, value: 'resume' },
        { label: `„${s.dayName}“ speichern und „${day.name}“ starten`, value: 'save' },
        { label: `„${s.dayName}“ verwerfen und „${day.name}“ starten`, value: 'discard', danger: true },
      ]);
      if (!choice) return;
      if (choice === 'resume') { go('#/workout'); return; }
      if (choice === 'save') Core.finishSession(db, Date.now());
      Timer.stop();
    }
    Core.startSession(db, dayId, Date.now());
    save();
    Wake.update();
    go('#/workout');
  }

  async function dayMenu(dayId) {
    const day = Core.findDay(db, dayId);
    if (!day) return;
    const choice = await actionSheet(day.name, [
      { label: 'Übungen bearbeiten', value: 'edit' },
      { label: 'Umbenennen', value: 'rename' },
      { label: 'Duplizieren', value: 'dup' },
      { label: 'Teilen', value: 'share' },
      { label: 'Löschen', value: 'del', danger: true },
    ]);
    if (choice === 'edit') go('#/day/' + encodeURIComponent(dayId));
    else if (choice === 'rename') renameDay(dayId);
    else if (choice === 'share') shareDay(day);
    else if (choice === 'dup') {
      Core.duplicateDay(db, dayId);
      save(); render(); toast('Tag dupliziert');
    } else if (choice === 'del') {
      const active = db.activeSession && db.activeSession.dayId === dayId;
      const ok = await confirmAction(`„${day.name}“ löschen?`,
        'Der Trainingstag und seine Übungen werden entfernt. Bereits gespeicherte Einheiten bleiben im Verlauf.' +
        (active ? ' Das laufende Training dieses Tages wird verworfen.' : ''), 'Löschen');
      if (!ok) return;
      if (active) Timer.stop();
      Core.deleteDay(db, dayId);
      save(); Wake.update(); go('#/');
      toast('Tag gelöscht');
    }
  }

  async function renameDay(dayId) {
    const day = Core.findDay(db, dayId);
    const name = await promptText('Tag umbenennen', { value: day.name, placeholder: 'z. B. Push' });
    if (name === null) return;
    Core.renameDay(db, dayId, name);
    save(); render();
  }

  async function addExercise(dayId) {
    const name = await promptText('Neue Übung', {
      placeholder: 'z. B. Bankdrücken', list: knownExerciseNames(), okLabel: 'Hinzufügen',
      message: 'Gleicher Name = gemeinsamer Verlauf, auch über mehrere Tage.',
    });
    if (name === null) return;
    Core.addExercise(db, dayId, name, db.settings.defaultRest);
    save(); render();
    toast(`„${name}“ hinzugefügt – Sätze & Pause kannst du antippen und ändern.`);
  }

  async function renameExercise(dayId, exId) {
    const ex = Core.findExercise(db, dayId, exId);
    if (!ex) return;
    const name = await promptText('Übung umbenennen', { value: ex.name, list: knownExerciseNames() });
    if (name === null || name === ex.name) return;
    let renameHistory = false;
    if (Core.historyHasName(db, ex.name) && normName(name) !== normName(ex.name)) {
      renameHistory = await confirmAction('Verlauf mit umbenennen?',
        `Im Verlauf gibt es Einträge für „${ex.name}“. Sollen sie ebenfalls „${name}“ heißen? ` +
        'Sonst beginnt für den neuen Namen ein eigener Verlauf.', 'Ja, mit umbenennen', false);
    }
    Core.renameExercise(db, dayId, exId, name, renameHistory);
    save(); render();
  }

  /* ---------- Event-Handling (Delegation) ---------- */

  const actions = {
    'add-day': async () => {
      const name = await promptText('Neuer Trainingstag', { placeholder: 'z. B. Push', okLabel: 'Anlegen' });
      if (name === null) return;
      const day = Core.addDay(db, name);
      save();
      go('#/day/' + encodeURIComponent(day.id));
    },
    'open-day': (el) => openDay(el.dataset.id),
    'day-menu': (el) => dayMenu(el.dataset.id),
    'day-rename': (el) => renameDay(el.dataset.id),

    'ex-add': (el) => addExercise(el.dataset.id),
    'ex-rename': (el) => renameExercise(parseRoute().id, el.dataset.id),
    'ex-rest': async (el) => {
      const dayId = parseRoute().id;
      const ex = Core.findExercise(db, dayId, el.dataset.id);
      if (!ex) return;
      const sec = await promptRest(`Satzpause: ${ex.name}`, ex.rest);
      if (sec === null) return;
      Core.setRest(db, dayId, ex.id, sec);
      save(); render();
    },
    'ex-sets': async (el) => {
      const dayId = parseRoute().id;
      const ex = Core.findExercise(db, dayId, el.dataset.id);
      if (!ex) return;
      const n = await promptSets(`Sätze: ${ex.name}`, ex.sets);
      if (n === null) return;
      Core.setSetCount(db, dayId, ex.id, n);
      save(); render();
    },
    'ex-target': async (el) => {
      const dayId = parseRoute().id;
      const ex = Core.findExercise(db, dayId, el.dataset.id);
      if (!ex) return;
      const t = await promptRepTarget(`Ziel-Wiederholungen: ${ex.name}`, ex.repMin, ex.repMax);
      if (!t) return;
      Core.setRepTarget(db, dayId, ex.id, t.min, t.max);
      save(); render();
    },
    'ex-note': async (el) => {
      const dayId = parseRoute().id;
      const ex = Core.findExercise(db, dayId, el.dataset.id);
      if (!ex) return;
      const text = await promptExerciseNote(`Notiz: ${ex.name}`, ex.note);
      if (text === null) return;
      Core.setExerciseNote(db, dayId, ex.id, text);
      save(); render();
    },
    'ex-up': (el) => {
      const i = Number(el.dataset.index);
      if (Core.moveExercise(db, parseRoute().id, i, i - 1)) { save(); render(); }
    },
    'ex-down': (el) => {
      const i = Number(el.dataset.index);
      if (Core.moveExercise(db, parseRoute().id, i, i + 1)) { save(); render(); }
    },
    'ex-del': async (el) => {
      const dayId = parseRoute().id;
      const ex = Core.findExercise(db, dayId, el.dataset.id);
      if (!ex) return;
      const ok = await confirmAction(`„${ex.name}“ entfernen?`,
        'Die Übung wird aus diesem Trainingstag entfernt. Der bisherige Verlauf bleibt erhalten.', 'Entfernen');
      if (!ok) return;
      Core.removeExercise(db, dayId, ex.id);
      save(); render();
    },

    'set-toggle': (el) => {
      const row = el.closest('.set');
      blurActive();
      const res = Core.toggleSet(db, row.dataset.se, row.dataset.set, Date.now());
      if (!res) return;
      save();
      if (res.done) {
        if (navigator.vibrate && db.settings.vibrate) navigator.vibrate(30);
        if (res.rest > 0) Timer.start(res.rest, res.name);
      }
      render();
    },
    'set-add': (el) => {
      Core.addSet(db, el.dataset.se);
      save(); render();
    },
    'set-del': async (el) => {
      const row = el.closest('.set');
      const se = Core.findSessionExercise(db, row.dataset.se);
      const st = se && se.sets.find((x) => x.id === row.dataset.set);
      if (!st) return;
      if (st.done || st.weight !== null || st.reps !== null || st.note) {
        const ok = await confirmAction('Satz löschen?', `${fmtSet(st)}${st.note ? ' – ' + st.note : ''}`, 'Löschen');
        if (!ok) return;
      }
      Core.removeSet(db, row.dataset.se, row.dataset.set);
      save(); render();
    },
    'w-rest': async (el) => {
      const se = Core.findSessionExercise(db, el.dataset.se);
      if (!se) return;
      const sec = await promptRest(`Satzpause: ${se.name}`, se.rest);
      if (sec === null) return;
      se.rest = sec;
      if (se.exId) Core.setRest(db, db.activeSession.dayId, se.exId, sec);
      save(); render();
    },
    'w-sets': async (el) => {
      const se = Core.findSessionExercise(db, el.dataset.se);
      if (!se || !se.exId) return;
      const n = await promptSets(`Sätze: ${se.name}`, planSets(se));
      if (n === null) return;
      Core.setSetCount(db, db.activeSession.dayId, se.exId, n);
      if (se.sets.length > n) toast('Sätze mit Einträgen wurden nicht entfernt.');
      save(); render();
    },
    'w-target': async (el) => {
      const se = Core.findSessionExercise(db, el.dataset.se);
      const plan = se && se.exId && Core.findExercise(db, db.activeSession.dayId, se.exId);
      if (!plan) return;
      const t = await promptRepTarget(`Ziel-Wiederholungen: ${se.name}`, plan.repMin, plan.repMax);
      if (!t) return;
      Core.setRepTarget(db, db.activeSession.dayId, se.exId, t.min, t.max);
      save(); render();
    },
    'w-note': async (el) => {
      const se = Core.findSessionExercise(db, el.dataset.se);
      const plan = se && se.exId && Core.findExercise(db, db.activeSession.dayId, se.exId);
      if (!plan) return;
      const text = await promptExerciseNote(`Notiz: ${se.name}`, plan.note);
      if (text === null) return;
      Core.setExerciseNote(db, db.activeSession.dayId, se.exId, text);
      save(); render();
    },
    'set-step': (el) => {
      const row = el.closest('.set');
      const field = el.dataset.field;
      const v = Core.stepSet(db, row.dataset.se, row.dataset.set, field, Number(el.dataset.delta));
      if (v === null) return;
      // Nur das Feld aktualisieren (kein Neuzeichnen → schnelles Mehrfach-Tippen)
      const input = row.querySelector(`[data-field="${field}"]`);
      if (input) input.value = field === 'weight' ? fmtNum(v) : String(v);
      saveSoon();
    },
    'summary-done': () => go('#/'),
    'preview-day': (el) => {
      const s = db.activeSession;
      // Läuft dieser Tag schon, direkt zurück ins Training – sonst erst die Vorschau
      if (s && s.dayId === el.dataset.id) go('#/workout');
      else go('#/preview/' + encodeURIComponent(el.dataset.id));
    },
    'copy-uid': async () => {
      try { await navigator.clipboard.writeText(account.uid); toast('Nutzer-ID kopiert'); } catch (e) { toast(account.uid); }
    },
    'admin-reload': () => { ui.admin.users = null; ui.admin.error = null; ui.admin.stats = {}; loadAdminUsers(); render(); },
    'admin-block': async (el) => {
      const u = ui.admin.users.find((x) => x.uid === el.dataset.uid);
      const reason = await openDialog({
        title: 'Nutzer sperren?',
        message: `„${u.email}“ wird sofort abgemeldet und kann die App mit diesem Konto nicht mehr nutzen. Die Daten bleiben erhalten.`,
        input: { placeholder: 'Grund (optional, wird dem Nutzer angezeigt)', select: false },
        buttons: [{ label: 'Abbrechen', style: 'ghost' }, { label: 'Sperren', style: 'danger', submit: true }],
      });
      if (reason === null) return;
      try { await window.GymCloud.admin.block(u.uid, u.email, reason.trim()); toast('Gesperrt'); } catch (e) { toast(authErrorText(e)); }
      actions['admin-reload']();
    },
    'admin-unblock': async (el) => {
      const u = ui.admin.users.find((x) => x.uid === el.dataset.uid);
      try { await window.GymCloud.admin.unblock(u.uid); toast('Entsperrt'); } catch (e) { toast(authErrorText(e)); }
      actions['admin-reload']();
    },
    'admin-wipe': async (el) => {
      const u = ui.admin.users.find((x) => x.uid === el.dataset.uid);
      const ok = await confirmAction('Trainingsdaten löschen?',
        `Alle Trainingstage, Einheiten und Messungen von „${u.email}“ werden endgültig gelöscht. Das Konto selbst bleibt bestehen.`, 'Löschen');
      if (!ok) return;
      try { await window.GymCloud.admin.wipe(u.uid); toast('Daten gelöscht'); } catch (e) { toast(authErrorText(e)); }
      actions['admin-reload']();
    },
    'admin-remove': async (el) => {
      const u = ui.admin.users.find((x) => x.uid === el.dataset.uid);
      const ok = await confirmAction('Konto entfernen?',
        `Alle Daten von „${u.email}“ werden gelöscht und das Konto dauerhaft gesperrt.`, 'Weiter');
      if (!ok) return;
      const ok2 = await confirmAction('Wirklich entfernen?', 'Das kann nicht rückgängig gemacht werden.', 'Endgültig entfernen');
      if (!ok2) return;
      try { await window.GymCloud.admin.remove(u.uid, u.email); toast('Konto entfernt'); } catch (e) { toast(authErrorText(e)); }
      actions['admin-reload']();
      go('#/admin');
    },
    'share-day': (el) => {
      const day = Core.findDay(db, el.dataset.id);
      if (day) shareDay(day);
    },
    'share-session': (el) => {
      const sess = db.sessions.find((x) => x.id === el.dataset.id);
      if (sess) shareText('Training ' + sess.dayName, sessionShareText(sess));
    },
    'import-paste': async () => {
      const v = await promptText('Geteilten Plan einfügen', {
        placeholder: 'Link oder Code einfügen',
        message: 'Füge den Link ein, den du bekommen hast (z. B. aus WhatsApp). Tipp: Feld gedrückt halten → „Einsetzen“.',
        okLabel: 'Weiter',
      });
      if (v === null) return;
      const code = (v.split('#/import/')[1] || v).replace(/[^A-Za-z0-9_-]/g, '');
      if (!code) { toast('Kein Code gefunden.'); return; }
      go('#/import/' + code);
    },
    'import-add': (el) => {
      let plan;
      try { plan = Core.decodePlan(el.dataset.code); } catch (e) { toast(e.message); return; }
      if (db.days.some((d) => normName(d.name) === normName(plan.name))) plan.name += ' (geteilt)';
      const day = Core.addDayFromPlan(db, plan);
      save();
      go('#/day/' + encodeURIComponent(day.id));
      toast(`„${day.name}“ hinzugefügt`);
    },
    'w-ex-menu': async (el) => {
      const s = db.activeSession;
      const i = s ? s.exercises.findIndex((e) => e.id === el.dataset.se) : -1;
      if (i < 0) return;
      const se = s.exercises[i];
      const items = [];
      if (i > 0) items.push({ label: 'Nach oben', value: 'up' });
      if (i < s.exercises.length - 1) items.push({ label: 'Nach unten', value: 'down' }, { label: 'Später machen (ans Ende)', value: 'end' });
      items.push({ label: 'Überspringen', value: 'skip' });
      const c = await actionSheet(se.name, items);
      if (!c) return;
      if (c === 'skip') Core.setSkipped(db, se.id, true);
      else Core.moveSessionExercise(db, se.id, c);
      save(); render();
      if (c !== 'skip') toast('Nur für dieses Training – dein Plan bleibt unverändert.');
    },
    'w-unskip': (el) => {
      Core.setSkipped(db, el.dataset.se, false);
      save(); render();
    },
    'open-calendar': () => { ui.historyTab = 'calendar'; go('#/history'); },
    'cal-month': (el) => {
      const now = new Date();
      const cur = ui.calMonth ? new Date(ui.calMonth) : new Date(now.getFullYear(), now.getMonth(), 1);
      ui.calMonth = new Date(cur.getFullYear(), cur.getMonth() + Number(el.dataset.delta), 1).getTime();
      ui.calDay = null;
      render();
    },
    'cal-day': (el) => { ui.calDay = ui.calDay === el.dataset.key ? null : el.dataset.key; render(); },
    'body-field': (el) => { ui.bodyField = el.dataset.key; render(); },
    'body-del': async (el) => {
      const ok = await confirmAction('Messung löschen?', 'Die Messung wird endgültig entfernt.', 'Löschen');
      if (!ok) return;
      Core.deleteBodyEntry(db, el.dataset.id);
      save();
      ui.historyTab = 'body';
      go('#/history');
    },
    'weekly-goal': async () => {
      const v = await promptText('Wochenziel', {
        value: String(db.settings.weeklyGoal), inputmode: 'numeric',
        message: 'Wie oft pro Woche willst du trainieren? Schaffst du das Ziel mehrere Wochen am Stück, wächst deine Serie 🔥.',
        chips: [1, 2, 3, 4, 5, 6].map((n) => ({ label: n + '×', value: String(n) })),
      });
      if (v === null) return;
      const n = Math.round(parseNum(v));
      if (!n || n < 1 || n > 7) { toast('Bitte eine Zahl von 1 bis 7 eingeben.'); return; }
      db.settings.weeklyGoal = n;
      save(); render();
    },
    'effort': (el) => { db.settings.effort = el.dataset.value; save(); render(); },
    'w-add-ex': () => addExercise(db.activeSession.dayId),
    'finish': async () => {
      const s = db.activeSession;
      if (!s) return;
      const n = Core.countLoggedSets(s);
      let finished = null;
      if (!n) {
        const ok = await confirmAction('Keine Sätze eingetragen', 'Es gibt nichts zu speichern. Training verwerfen?', 'Verwerfen');
        if (!ok) return;
        Core.discardSession(db);
      } else {
        const open = s.exercises.reduce((c, e) => c + e.sets.filter((st) => !st.done && (st.weight !== null || st.reps !== null)).length, 0);
        const ok = await confirmAction('Training beenden?',
          `${n} ${n === 1 ? 'Satz wird' : 'Sätze werden'} im Verlauf gespeichert.` +
          (open ? ` (${open} davon nicht abgehakt.)` : '') + ' Leere Sätze werden ignoriert.', 'Speichern', false);
        if (!ok) return;
        finished = Core.finishSession(db, Date.now());
      }
      Timer.stop();
      save(); Wake.update();
      if (finished) go('#/summary/' + encodeURIComponent(finished.id));
      else { go('#/'); toast('Training verworfen'); }
    },
    'discard': async () => {
      const ok = await confirmAction('Training verwerfen?', 'Alle Einträge dieser Einheit gehen verloren.', 'Verwerfen');
      if (!ok) return;
      Core.discardSession(db);
      Timer.stop();
      save(); Wake.update();
      go('#/');
    },

    'hist-tab': (el) => { ui.historyTab = el.dataset.tab; render(); },
    'chart-mode': (el) => { ui.chartMode[el.dataset.key] = el.dataset.mode; render(); },
    'del-session': async (el) => {
      const s = db.sessions.find((x) => x.id === el.dataset.id);
      if (!s) return;
      const ok = await confirmAction('Einheit löschen?', `„${s.dayName}“ vom ${fmtDate(s.finishedAt)} wird endgültig gelöscht.`, 'Löschen');
      if (!ok) return;
      Core.deleteSession(db, s.id);
      save();
      go('#/history');
      toast('Einheit gelöscht');
    },

    'export': () => exportData(),
    'import': () => importData(),
    'toggle-setting': (el) => {
      const k = el.dataset.key;
      db.settings[k] = !db.settings[k];
      save(); render();
    },
    'increment': async () => {
      const v = await promptText('Gewichtsschritt', {
        value: fmtNum(db.settings.increment), placeholder: 'kg', inputmode: 'decimal',
        message: 'Um so viel wird bei einem Steigerungsvorschlag erhöht – und so viel ändern die +/− Buttons beim Gewicht.',
        chips: [1, 1.25, 2, 2.5, 5].map((n) => ({ label: fmtNum(n) + ' kg', value: fmtNum(n) })),
      });
      if (v === null) return;
      const n = parseNum(v);
      if (n === null || n <= 0) { toast('Bitte eine Zahl größer 0 eingeben.'); return; }
      db.settings.increment = Math.min(50, Math.round(n * 100) / 100);
      save(); render();
    },
    'default-rest': async () => {
      const sec = await promptRest('Standardpause', db.settings.defaultRest);
      if (sec === null) return;
      db.settings.defaultRest = sec;
      save(); render();
    },
    'test-sound': () => {
      Sound.alarm();
      if (navigator.vibrate && db.settings.vibrate) navigator.vibrate([400, 150, 400]);
    },
    'notif': async () => {
      if (!Notify.supported) {
        toast(isIOS ? 'Erst zum Home-Bildschirm hinzufügen, dann hier erlauben.' : 'Dein Browser unterstützt keine Benachrichtigungen.');
        return;
      }
      const p = await Notify.request();
      toast(p === 'granted' ? 'Benachrichtigungen aktiviert ✓' : 'Benachrichtigungen nicht erlaubt');
      render();
    },
    'notif-test': async () => {
      const ok = await Notify.show('Gym Tracker', 'So sieht die Pausen-Benachrichtigung aus.');
      if (!ok) toast('Benachrichtigung konnte nicht angezeigt werden.');
    },
    'theme': (el) => {
      db.settings.theme = el.dataset.value;
      save(); applyTheme(); render();
    },
    /* Konto */
    'auth-mode': (el) => {
      const email = $('#auth-form input[name="email"]');
      if (email) ui.authEmail = email.value.trim();
      ui.authMode = el.dataset.mode;
      render();
    },
    'auth-guest': async () => {
      if (window.GymCloud && window.GymCloud.currentUser()) { try { await window.GymCloud.signOut(); } catch (e) { /* */ } }
      account = { mode: 'guest' };
      saveAccount();
      go('#/');
    },
    'open-login': () => { ui.authMode = 'login'; go('#/login'); },
    'auth-reset': async () => {
      const field = $('#auth-form input[name="email"]');
      const email = await promptText('Passwort zurücksetzen', {
        value: (field && field.value.trim()) || ui.authEmail, placeholder: 'name@beispiel.de', inputmode: 'email',
        message: 'Wir schicken dir eine E-Mail mit einem Link, über den du ein neues Passwort festlegen kannst.',
        okLabel: 'E-Mail senden',
      });
      if (email === null) return;
      if (!window.GymCloud) { toast(authErrorText({ code: 'no-cloud' })); return; }
      try {
        await window.GymCloud.resetPassword(email);
        toast('E-Mail verschickt – schau in dein Postfach (auch im Spam).');
      } catch (e) {
        toast(authErrorText(e));
      }
    },
    'sync-now': () => {
      if (!engine) { startSync(); toast(window.GymCloud ? 'Abgleich gestartet' : authErrorText({ code: 'no-cloud' })); return; }
      engine.schedule(0);
      renderSyncStatus();
    },
    'logout': async () => {
      const pending = engine && engine.pending();
      const ok = await confirmAction('Abmelden?',
        pending
          ? 'Achtung: Einige Änderungen sind noch nicht in der Cloud (z. B. weil du offline bist). Wenn du dich jetzt abmeldest, gehen sie verloren.'
          : 'Deine Daten bleiben in deinem Konto gespeichert und werden von diesem Gerät entfernt. Beim nächsten Anmelden sind sie wieder da.',
        'Abmelden', !!pending);
      if (!ok) return;
      await leaveAccount();
      toast('Abgemeldet');
    },
    'delete-account': async () => {
      const ok = await confirmAction('Konto löschen?',
        'Dein Konto und alle in der Cloud gespeicherten Trainingsdaten werden endgültig gelöscht. ' +
        'Das kann nicht rückgängig gemacht werden. Tipp: Vorher ein Backup exportieren.', 'Weiter');
      if (!ok) return;
      const pw = await openDialog({
        title: 'Passwort bestätigen',
        message: 'Zur Sicherheit gib bitte dein Passwort ein.',
        input: { type: 'password', autocomplete: 'current-password', select: false },
        buttons: [{ label: 'Abbrechen', style: 'ghost' }, { label: 'Konto endgültig löschen', style: 'danger', submit: true }],
      });
      if (!pw) return;
      if (!window.GymCloud) { toast(authErrorText({ code: 'no-cloud' })); return; }
      stopSync();
      try {
        await window.GymCloud.deleteAccount(pw);
      } catch (e) {
        toast(authErrorText(e));
        startSync();
        return;
      }
      await leaveAccount();
      toast('Konto gelöscht');
    },

    'load-sample': () => {
      db.days.push(...Core.sampleDays());
      save(); toast('Beispieltage hinzugefügt'); go('#/');
    },
    'reset': async () => {
      const ok = await confirmAction('Alle Daten löschen?',
        (isUser() ? 'Trainingstage, Verlauf und Einstellungen werden aus deinem Konto gelöscht – auf allen Geräten. Dein Konto selbst bleibt bestehen.'
          : 'Trainingstage, Verlauf und Einstellungen werden von diesem Gerät gelöscht.') + ' Tipp: Vorher ein Backup exportieren.', 'Alles löschen');
      if (!ok) return;
      const ok2 = await confirmAction('Wirklich alles löschen?', 'Das kann nicht rückgängig gemacht werden.', 'Endgültig löschen');
      if (!ok2) return;
      Timer.stop();
      db = Core.emptyData();
      save(); applyTheme(); Wake.update();
      go('#/');
      toast('Alle Daten gelöscht');
    },
  };

  function blurActive() {
    const a = document.activeElement;
    if (a && a.matches && a.matches('input, textarea')) a.blur();
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled && actions[el.dataset.action]) {
      e.preventDefault();
      actions[el.dataset.action](el);
      return;
    }
    const t = e.target.closest('[data-timer]');
    if (t) {
      const a = t.dataset.timer;
      if (a === 'plus') Timer.adjust(15);
      else if (a === 'minus') Timer.adjust(-15);
      else Timer.stop(); // skip, cancel, dismiss
    }
  }

  /** Eingaben in Satz-Feldern: sofort ins Datenmodell, gebündelt speichern, ohne neu zu zeichnen. */
  function onInput(e) {
    if (e.target.id === 'admin-search') {
      ui.admin.filter = e.target.value;
      const list = $('#admin-list');
      if (list) list.innerHTML = adminListHTML();
      return;
    }
    const f = e.target.dataset && e.target.dataset.field;
    if (!f) return;
    const row = e.target.closest('.set');
    if (row && Core.updateSet(db, row.dataset.se, row.dataset.set, f, e.target.value)) saveSoon();
  }

  function onKeydown(e) {
    // Tastatur: Enter/Leertaste auf Karten mit role="button"
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault();
      actions[e.target.dataset.action](e.target);
    }
    // "Fertig" auf der iOS-Tastatur schließt das Notizfeld
    if (e.key === 'Enter' && e.target.matches('.set input')) e.target.blur();
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      if (Sound.ctx && Sound.ctx.state !== 'running') Sound.ctx.resume().catch(() => {});
      Timer.check(true);
      Timer.render();
      Wake.acquire();
      if (parseRoute().name === 'home' || parseRoute().name === 'settings') render();
      // Home-Bildschirm-Apps werden oft nur "aufgeweckt" statt neu gestartet → dabei nach Updates schauen
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    } else {
      save(); // beim Wechsel in den Hintergrund sicher speichern
    }
  }

  /* ---------- Start ---------- */

  /* ---------- Schnittstelle für cloud.js (Firebase) ---------- */

  /** Firebase ist geladen → falls angemeldet, Abgleich starten. */
  function onCloudReady() {
    startSync();
    if (parseRoute().name === 'settings') renderSyncStatus();
  }

  /** Firebase meldet den aktuellen Anmeldestatus (beim Start und nach jeder Änderung). */
  function onAuthState(user) {
    if (user) {
      if (isUser() && account.uid === user.uid) {
        if (user.email && account.email !== user.email) { account.email = user.email; saveAccount(); }
        startSync();
        return;
      }
      enterAccount(user);
    } else if (isUser()) {
      // Sitzung abgelaufen oder auf einem anderen Gerät Passwort geändert / Konto gelöscht.
      // Die lokale Kopie bleibt erhalten und wird beim nächsten Anmelden weiter abgeglichen.
      stopSync();
      ui.authEmail = account.email;
      account = null;
      saveAccount();
      db = loadData(STORAGE_KEY, Core.emptyData);
      Timer.stop();
      Wake.update();
      go('#/login');
      toast('Bitte melde dich erneut an.');
    }
  }

  function init() {
    account = loadAccount();
    // Ohne Firebase-Konfiguration direkt ohne Konto starten. Bewusst nicht speichern:
    // Sobald Konten eingerichtet sind, erscheint beim nächsten Start die Anmeldeseite.
    if (!account && !cloudConfigured) account = { mode: 'guest' };
    db = isUser() ? loadData(dataKey(), Core.emptyData) : loadData(STORAGE_KEY, Core.emptyData);
    writeLocal();
    applyTheme();
    darkQuery.addEventListener && darkQuery.addEventListener('change', applyTheme);

    // Audio bei jeder Interaktion (falls nötig) freischalten – iOS erlaubt Ton nur nach einer Geste.
    const unlock = () => { if (!Sound.ctx || Sound.ctx.state !== 'running') Sound.unlock(); };
    ['touchend', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));

    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    window.addEventListener('hashchange', render);

    // Navigation + Timer ausblenden, solange die Bildschirmtastatur für ein Eingabefeld offen ist.
    document.addEventListener('focusin', (e) => { if (e.target.matches('.view input')) document.body.classList.add('kb-open'); });
    document.addEventListener('focusout', () => {
      document.body.classList.remove('kb-open');
      // Aufgeschobene Aktualisierung vom Server nachholen, sobald kein Feld mehr aktiv ist
      setTimeout(() => {
        const a = document.activeElement;
        if (renderPending && !(a && a.matches('input'))) { renderPending = false; render(); }
      }, 0);
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'auth-form') { e.preventDefault(); onAuthSubmit(e.target); }
      if (e.target.id === 'body-form') { e.preventDefault(); onBodySubmit(e.target); }
    });
    window.addEventListener('online', () => { if (engine) engine.schedule(0); renderSyncStatus(); });
    window.addEventListener('offline', renderSyncStatus);

    // Laufzeit des Trainings aktualisieren
    setInterval(() => {
      const el = $('#elapsed');
      if (el && db.activeSession) el.textContent = fmtDuration(Date.now() - db.activeSession.startedAt);
    }, 30000);

    Timer.restore();
    Wake.update();
    render();

    // Browser bitten, die Daten nicht automatisch zu löschen (wird nicht überall gewährt).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      // Neue Version wurde installiert und übernimmt → einmal neu laden, damit sie sofort sichtbar ist
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        save();
        location.reload();
      });
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
        .then((reg) => reg.update())
        .catch(() => {});
    }

    // Schnittstelle für cloud.js und für Tests in der Browser-Konsole
    window.GymApp = {
      Core, TimerCore, Sync, Timer, save, render, onCloudReady, onAuthState, onBlocked, setAdmin,
      get db() { return db; },
      get account() { return account; },
      get engine() { return engine; },
    };
  }

  init();
})();
