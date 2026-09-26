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

  const DATA_VERSION = 2; // v2: Ernährung, Lebensmittel, Übungsbibliothek/eigene Übungen
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
    calorieGoal: 2000, // Kalorien-Tagesziel (kcal)
    proteinGoal: 150,  // Makroziele in Gramm
    carbGoal: 220,
    fatGoal: 70,
    effort: 'off',     // Anstrengung pro Satz erfassen: 'off' | 'rir' | 'rpe'
    shareRecords: true, // Freunde: Rekorde je Übung teilen (Kennzahlen wie Einheiten/Serie immer)
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

  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

  /** Nährwert lesen: Zahl ≥ 0 (auf 1 Nachkommastelle) oder null (= unbekannt, NICHT mit 0 füllen). */
  function parseNut(v) {
    const n = parseNum(v);
    return n === null ? null : Math.round(n * 10) / 10;
  }

  /** Tagesziel/Menge: ganze Zahl ≥ 0 oder null. */
  function parseGoal(v) {
    const n = parseNum(v);
    return n === null ? null : Math.round(n);
  }

  /** 'YYYY-MM-DD' aus String (unverändert) oder Zeitstempel; sonst null. */
  function parseDayKey(v) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Core.dayKey(n) : null;
  }

  /** Lebensmittel bereinigen. Nährwerte pro 100 g, unbekannte Werte bleiben null. */
  function normFood(f) {
    return {
      id: String((f && f.id) || uid()),
      barcode: f && f.barcode ? String(f.barcode) : null,
      name: String((f && f.name) || 'Lebensmittel').slice(0, 120),
      brand: String((f && f.brand) || '').slice(0, 80),
      kcal: parseNut(f && f.kcal),
      protein: parseNut(f && f.protein),
      carbs: parseNut(f && f.carbs),
      fat: parseNut(f && f.fat),
      serving: parseNut(f && f.serving),      // Gramm pro Portion (optional)
      favorite: !!(f && f.favorite),
      lastUsed: Number(f && f.lastUsed) || null,
      custom: !!(f && f.custom),              // manuell angelegt
      at: Number(f && f.at) || Date.now(),
    };
  }

  /** Ernährungseintrag bereinigen. Gespeichert werden die absoluten Werte für die Menge. */
  function normNutrition(n) {
    return {
      id: String((n && n.id) || uid()),
      date: parseDayKey(n && n.date) || Core.dayKey(Date.now()),
      meal: MEALS.includes(n && n.meal) ? n.meal : 'snack',
      name: String((n && n.name) || '').slice(0, 120),
      kcal: parseNut(n && n.kcal),
      protein: parseNut(n && n.protein),
      carbs: parseNut(n && n.carbs),
      fat: parseNut(n && n.fat),
      grams: parseNut(n && n.grams),          // verzehrte Menge in g (optional, z. B. bei Schnelleingabe null)
      foodId: n && n.foodId ? String(n.foodId) : null,
      at: Number(n && n.at) || Date.now(),
    };
  }

  const MUSCLES = ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Beine', 'Gesäß', 'Waden', 'Bauch', 'Unterarme', 'Ganzkörper'];
  const EQUIPMENT = ['Langhantel', 'Kurzhantel', 'Maschine', 'Kabel', 'Körpergewicht', 'Kettlebell', 'Band'];

  /** Eigene Übung bereinigen. */
  function normCustomExercise(e) {
    return {
      id: String((e && e.id) || uid()),
      name: String((e && e.name) || 'Übung').slice(0, 80),
      muscle: e && MUSCLES.includes(e.muscle) ? e.muscle : 'Ganzkörper',
      secondary: Array.isArray(e && e.secondary) ? e.secondary.map(String).slice(0, 6) : [],
      equipment: e && EQUIPMENT.includes(e.equipment) ? e.equipment : 'Kurzhantel',
      type: e && e.type === 'Isolation' ? 'Isolation' : 'Grundübung',
      steps: Array.isArray(e && e.steps) ? e.steps.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 6) : [],
      custom: true,
    };
  }

  /** libMeta bereinigen: { exerciseId: { fav, used } } für Favoriten & "zuletzt verwendet". */
  function normLibMeta(m) {
    const out = {};
    if (m && typeof m === 'object') {
      for (const [k, v] of Object.entries(m)) {
        if (!v || typeof v !== 'object') continue;
        const fav = !!v.fav;
        const used = Number(v.used) || null;
        if (fav || used) out[String(k)] = { fav, used };
      }
    }
    return out;
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
    return {
      version: DATA_VERSION, days: [], sessions: [], activeSession: null, body: [],
      nutrition: [], foods: [], customExercises: [], libMeta: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  };

  /** Ziel-Wiederholungen einer Übung (beide null = kein Ziel). */
  function repTargetFields(min, max) {
    const t = parseRepTarget(min ? (max && max !== min ? min + '-' + max : String(min)) : '');
    return t ? { repMin: t.min, repMax: t.max } : { repMin: null, repMax: null };
  }

  function newPlanExercise(name, rest, sets, libId) {
    return { id: uid(), name, rest, sets, repMin: null, repMax: null, note: '', libId: libId || null };
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
    db.settings.shareRecords = db.settings.shareRecords !== false;
    db.settings.calorieGoal = parseGoal(db.settings.calorieGoal);
    db.settings.proteinGoal = parseGoal(db.settings.proteinGoal);
    db.settings.carbGoal = parseGoal(db.settings.carbGoal);
    db.settings.fatGoal = parseGoal(db.settings.fatGoal);

    db.foods = (Array.isArray(raw.foods) ? raw.foods : []).filter(Boolean).map(normFood);
    db.nutrition = (Array.isArray(raw.nutrition) ? raw.nutrition : []).filter(Boolean).map(normNutrition)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at));
    db.customExercises = (Array.isArray(raw.customExercises) ? raw.customExercises : []).filter(Boolean).map(normCustomExercise);
    db.libMeta = normLibMeta(raw.libMeta);

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
        libId: e.libId ? String(e.libId) : null, // Verknüpfung zur Bibliothek (bei Altdaten null → Laufzeit-Verknüpfung)
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

  Core.addExercise = function (db, dayId, name, rest, sets, libId) {
    const day = Core.findDay(db, dayId);
    if (!day || !String(name).trim()) return null;
    const ex = newPlanExercise(String(name).trim(), clampRest(rest, db.settings.defaultRest), clampSets(sets), libId);
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

  /* ---------- Ernährung & Kalorien ---------- */

  Core.MEALS = MEALS;

  Core.nutritionForDay = (db, dayKey) => db.nutrition.filter((n) => n.date === dayKey).sort((a, b) => a.at - b.at);

  /** Tagessummen (unbekannte Einzelwerte zählen als 0). */
  Core.dayTotals = function (db, dayKey) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const n of db.nutrition) {
      if (n.date !== dayKey) continue;
      for (const k of ['kcal', 'protein', 'carbs', 'fat']) if (n[k] !== null) t[k] += n[k];
    }
    for (const k in t) t[k] = Math.round(t[k] * 10) / 10;
    return t;
  };

  /** Nährwerte eines Lebensmittels (pro 100 g) auf eine Menge in Gramm umrechnen; unbekannt bleibt null. */
  Core.scaleFood = function (food, grams) {
    const f = (Number(grams) || 0) / 100;
    const out = {};
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
      out[k] = food[k] === null || food[k] === undefined ? null : Math.round(food[k] * f * 10) / 10;
    }
    return out;
  };

  function sortNutrition(db) {
    db.nutrition.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at));
  }

  Core.addNutrition = function (db, entry) {
    const n = normNutrition(entry);
    db.nutrition.push(n);
    sortNutrition(db);
    return n;
  };

  Core.updateNutrition = function (db, id, patch) {
    const i = db.nutrition.findIndex((n) => n.id === id);
    if (i < 0) return false;
    db.nutrition[i] = normNutrition({ ...db.nutrition[i], ...patch, id });
    sortNutrition(db);
    return true;
  };

  Core.deleteNutrition = function (db, id) {
    const before = db.nutrition.length;
    db.nutrition = db.nutrition.filter((n) => n.id !== id);
    return db.nutrition.length < before;
  };

  /* ---------- Lebensmittel ---------- */

  Core.findFoodByBarcode = (db, code) => db.foods.find((f) => f.barcode && f.barcode === String(code)) || null;
  Core.foodById = (db, id) => db.foods.find((f) => f.id === id) || null;

  /** Lebensmittel anlegen oder aktualisieren (per id). Rückgabe: gespeichertes Lebensmittel. */
  Core.saveFood = function (db, food) {
    const f = normFood(food);
    const i = db.foods.findIndex((x) => x.id === f.id);
    if (i >= 0) db.foods[i] = f; else db.foods.push(f);
    return f;
  };

  Core.deleteFood = function (db, id) {
    const before = db.foods.length;
    db.foods = db.foods.filter((f) => f.id !== id);
    return db.foods.length < before;
  };

  Core.toggleFoodFavorite = function (db, id) {
    const f = Core.foodById(db, id);
    if (!f) return false;
    f.favorite = !f.favorite;
    return true;
  };

  Core.markFoodUsed = function (db, id, now) {
    const f = Core.foodById(db, id);
    if (f) f.lastUsed = now || Date.now();
  };

  /** Lebensmittel durchsuchen; Favoriten zuerst, dann zuletzt verwendet. Leerer Query = alle. */
  Core.searchFoods = function (db, q) {
    const key = normName(q || '');
    const list = key ? db.foods.filter((f) => normName(f.name).includes(key) || normName(f.brand).includes(key)) : db.foods.slice();
    return list.sort((a, b) => (b.favorite - a.favorite) || ((b.lastUsed || 0) - (a.lastUsed || 0)) || a.name.localeCompare(b.name, 'de'));
  };

  /** Produktdaten aus der Open-Food-Facts-Antwort lesen (pro 100 g). Fehlende Werte bleiben null. */
  Core.parseOFF = function (json) {
    const p = json && json.product;
    if (!json || json.status === 0 || !p) return null;
    const nutr = p.nutriments || {};
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null; };
    // Portionsgröße in g (auch aus ml; für Getränke ~1 ml = 1 g als Näherung)
    const m = String(p.serving_size || '').match(/([\d.,]+)\s*(g|ml)/i);
    const serving = m ? num(m[1].replace(',', '.')) : num(p.serving_quantity);
    // pro 100 g: direkter Wert, sonst aus dem Portionswert hochgerechnet
    const per = (k100, kServ) => {
      let v = num(nutr[k100]);
      if (v === null && serving && num(nutr[kServ]) !== null) v = Math.round(num(nutr[kServ]) / serving * 1000) / 10;
      return v;
    };
    // Kalorien: kcal direkt, sonst aus kJ, sonst aus dem Portionswert
    let kcal = num(nutr['energy-kcal_100g']);
    if (kcal === null && num(nutr['energy-kj_100g']) !== null) kcal = Math.round(num(nutr['energy-kj_100g']) / 4.184 * 10) / 10;
    if (kcal === null) kcal = per('energy-kcal', 'energy-kcal_serving');
    return {
      barcode: p.code ? String(p.code) : null,
      name: String(p.product_name_de || p.product_name || p.product_name_en || p.generic_name || '').trim(),
      brand: String(p.brands || '').split(',')[0].trim(),
      kcal,
      protein: per('proteins_100g', 'proteins_serving'),
      carbs: per('carbohydrates_100g', 'carbohydrates_serving'),
      fat: per('fat_100g', 'fat_serving'),
      serving,
      custom: false,
    };
  };

  /* ---------- Übungsbibliothek & eigene Übungen ---------- */

  Core.libFav = (db, id) => !!(db.libMeta[id] && db.libMeta[id].fav);
  Core.libUsed = (db, id) => (db.libMeta[id] && db.libMeta[id].used) || 0;

  function setLibMeta(db, id, patch) {
    const cur = db.libMeta[id] || { fav: false, used: 0 };
    const next = { fav: !!cur.fav, used: cur.used || 0, ...patch };
    if (next.fav || next.used) db.libMeta[id] = { fav: !!next.fav, used: next.used || null };
    else delete db.libMeta[id];
  }

  Core.toggleLibFav = function (db, id) {
    setLibMeta(db, id, { fav: !Core.libFav(db, id) });
    return Core.libFav(db, id);
  };

  Core.markExerciseUsed = function (db, id, now) {
    if (id) setLibMeta(db, id, { used: now || Date.now() });
  };

  Core.customExerciseById = (db, id) => db.customExercises.find((e) => e.id === id) || null;

  Core.saveCustomExercise = function (db, e) {
    const c = normCustomExercise(e);
    const i = db.customExercises.findIndex((x) => x.id === c.id);
    if (i >= 0) db.customExercises[i] = c; else db.customExercises.push(c);
    return c;
  };

  /** Eigene Übung löschen. Verlauf (nach Name) und Trainingstage bleiben erhalten. */
  Core.deleteCustomExercise = function (db, id) {
    const before = db.customExercises.length;
    db.customExercises = db.customExercises.filter((e) => e.id !== id);
    delete db.libMeta[id];
    return db.customExercises.length < before;
  };

  /**
   * Übung zu einer Bibliotheks-ID auflösen (feste ID, nicht Name):
   * 1. eingebaute Bibliothek (Name oder englischer Alias), 2. eigene Übung, 3. sonst neu als eigene Übung anlegen.
   */
  Core.resolveExercise = function (db, name, library) {
    const key = normName(name);
    if (!key) return null;
    const lib = (library || []).find((x) => normName(x.name) === key || (x.aliases || []).some((a) => normName(a) === key));
    if (lib) return lib.id;
    const cust = db.customExercises.find((x) => normName(x.name) === key);
    if (cust) return cust.id;
    const created = normCustomExercise({ name: String(name).trim() });
    db.customExercises.push(created);
    return created.id;
  };

  /** Übung nach ID finden (eingebaut oder eigen). */
  Core.exerciseById = function (db, library, id) {
    return (library || []).find((x) => x.id === id) || db.customExercises.find((x) => x.id === id) || null;
  };

  /** Alle Übungen der Trainingstage nachträglich mit der Bibliothek verknüpfen (nur fehlende libId). */
  Core.linkPlanToLibrary = function (db, library) {
    let changed = false;
    for (const d of db.days) for (const e of d.exercises) {
      if (e.libId) continue;
      e.libId = Core.resolveExercise(db, e.name, library);
      changed = true;
    }
    return changed;
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

  /* ---------- Freunde: Benutzername & geteilte Kennzahlen ----------
   * Geteilt werden nur Aggregate: Anzahl Einheiten und Volumen pro Kalendertag (letzte 53 Wochen),
   * Gesamtzahl, Wochenziel und – abschaltbar – Rekorde je Bibliotheks-Übung (feste ID).
   * Einzelne Sätze, Notizen, Pläne, Körpermaße und Ernährung verlassen das Gerät dafür nie.
   */

  const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,19}$/;
  const DAY_MS = 86400000;

  Core.normUsername = (s) => String(s || '').trim().replace(/^@+/, '').toLowerCase();

  /** Fehlertext oder null, wenn der Benutzername gültig ist. */
  Core.usernameError = function (s) {
    const u = Core.normUsername(s);
    if (u.length < 3) return 'Mindestens 3 Zeichen.';
    if (u.length > 20) return 'Höchstens 20 Zeichen.';
    if (!USERNAME_RE.test(u)) return 'Nur a–z, Ziffern, Punkt und Unterstrich – am Anfang ein Buchstabe oder eine Ziffer.';
    return null;
  };

  /** Namen/Aliasse der eingebauten Bibliothek → feste Übungs-ID */
  function libraryIndex(library) {
    const byName = new Map();
    const ids = new Set();
    for (const x of library || []) {
      ids.add(x.id);
      byName.set(normName(x.name), x.id);
      for (const a of x.aliases || []) if (!byName.has(normName(a))) byName.set(normName(a), x.id);
    }
    return { byName, ids };
  }

  /** Feste Bibliotheks-ID einer Übung aus einer Einheit (über den Plan, sonst über den Namen) oder null. */
  function libIdOf(db, session, e, idx) {
    if (e.exId && session.dayId) {
      const plan = Core.findExercise(db, session.dayId, e.exId);
      if (plan && plan.libId && idx.ids.has(plan.libId)) return plan.libId;
    }
    return idx.byName.get(normName(e.name)) || null;
  }

  /** Kennzahlen zum Teilen mit Freunden (siehe oben). */
  Core.socialStats = function (db, now, library, opts) {
    const shareRecords = !opts || opts.shareRecords !== false;
    const idx = libraryIndex(library);
    const since = Core.dayKey(now - 371 * DAY_MS);
    const days = {};
    const recs = {};
    const usage = {};
    let last = null;
    for (const s of db.sessions) {
      if (last === null || s.finishedAt > last) last = s.finishedAt;
      const k = Core.dayKey(s.finishedAt);
      if (k >= since) {
        const d = days[k] || (days[k] = [0, 0]);
        d[0]++;
        d[1] += Math.round(Core.sessionStats(s).volume);
      }
      for (const e of s.exercises) {
        const id = libIdOf(db, s, e, idx);
        if (!id) continue;
        usage[id] = (usage[id] || 0) + 1;
        const b = bestOf(e.sets);
        const r = recs[id] || (recs[id] = { w: null, e: null, r: null });
        if (b.weight !== null && (r.w === null || b.weight > r.w)) r.w = b.weight;
        if (b.e1rm !== null && (r.e === null || b.e1rm > r.e)) r.e = Math.round(b.e1rm * 10) / 10;
        if (b.reps !== null && (r.r === null || b.reps > r.r)) r.r = b.reps;
      }
    }
    let fav = null;
    for (const id of Object.keys(usage)) if (fav === null || usage[id] > usage[fav]) fav = id;
    const records = {};
    if (shareRecords) {
      Object.keys(recs).sort((a, b) => usage[b] - usage[a]).slice(0, 80).forEach((id) => { records[id] = recs[id]; });
    }
    return {
      v: 1, goal: db.settings.weeklyGoal || DEFAULT_SETTINGS.weeklyGoal, total: db.sessions.length, last,
      days, records, fav: shareRecords ? fav : null, favCount: shareRecords && fav ? usage[fav] : 0,
    };
  };

  /**
   * Vergleichbare Werte aus geteilten Kennzahlen – bezogen auf „jetzt“. Dadurch stimmen z. B.
   * „diese Woche“ und die Serie auch dann, wenn ein Freund die App länger nicht geöffnet hat.
   */
  Core.socialMetrics = function (stats, now) {
    const st = stats || {};
    const days = st.days && typeof st.days === 'object' ? st.days : {};
    const goal = Math.min(7, Math.max(1, Math.round(Number(st.goal)) || DEFAULT_SETTINGS.weeklyGoal));
    const d = new Date(now);
    const weekKey = Core.dayKey(weekStart(now));
    const monthKey = Core.dayKey(new Date(d.getFullYear(), d.getMonth(), 1, 12).getTime());
    const from7 = Core.dayKey(now - 6 * DAY_MS);
    const from30 = Core.dayKey(now - 29 * DAY_MS);
    const today = Core.dayKey(now);
    const weeks = new Map();
    let week = 0, month = 0, vol7 = 0, vol30 = 0;
    for (const [k, v] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v) || k > today) continue;
      const n = Math.max(0, Number(v[0]) || 0), vol = Math.max(0, Number(v[1]) || 0);
      if (k >= weekKey) week += n;
      if (k >= monthKey) month += n;
      if (k >= from7) vol7 += vol;
      if (k >= from30) vol30 += vol;
      const wk = weekStart(new Date(k + 'T12:00').getTime());
      weeks.set(wk, (weeks.get(wk) || 0) + n);
    }
    const cur = weekStart(now);
    let w = (weeks.get(cur) || 0) >= goal ? cur : prevWeek(cur);
    let streak = 0;
    while ((weeks.get(w) || 0) >= goal && streak < 60) { streak++; w = prevWeek(w); }
    return { week, month, streak, total: Math.max(0, Number(st.total) || 0), vol7, vol30, goal, last: Number(st.last) || null };
  };

  /** Rekorde bei Übungen, die beide teilen: [{ id, me: {w,e,r}, them: {w,e,r} }] */
  Core.commonRecords = function (mine, theirs) {
    const a = (mine && mine.records) || {}, b = (theirs && theirs.records) || {};
    return Object.keys(a).filter((id) => b[id] && typeof b[id] === 'object').map((id) => ({ id, me: a[id], them: b[id] }));
  };

  /** Rangliste: [{ …entry, value, rank }] – gleiche Werte teilen sich den Platz. */
  Core.rankBy = function (entries, metric) {
    const list = entries.map((e) => ({ ...e, value: Number(e.metrics && e.metrics[metric]) || 0 }))
      .sort((x, y) => (y.value - x.value) || (x.me ? -1 : y.me ? 1 : 0) || String(x.name || '').localeCompare(String(y.name || ''), 'de'));
    let rank = 0, prev = null;
    list.forEach((e, i) => { if (e.value !== prev) { rank = i + 1; prev = e.value; } e.rank = rank; });
    return list;
  };

  /** "heute trainiert", "vor 3 Tagen trainiert" … */
  Core.activityText = function (last, now) {
    if (!last) return 'noch kein Training';
    const r = fmtRelative(last, now);
    return r === fmtDate(last) ? 'zuletzt am ' + r : r + ' trainiert';
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
  const MAIN_FIELDS = {
    'main.days': 'days', 'main.settings': 'settings', 'main.active': 'activeSession',
    'main.customex': 'customExercises', 'main.libmeta': 'libMeta',
  };
  Sync.MAIN_FIELDS = MAIN_FIELDS;

  /** Ist das ein Schlüssel, der einem Dokument/Feld auf dem Server entspricht? */
  const isDocKey = (k) => k in MAIN_FIELDS || k.startsWith('session:') || k.startsWith('body:') || k.startsWith('nutrition:') || k.startsWith('food:');

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
  Sync.mainOf = (db) => ({
    days: db.days, settings: db.settings, activeSession: db.activeSession, body: db.body,
    nutrition: db.nutrition, foods: db.foods, customExercises: db.customExercises, libMeta: db.libMeta,
  });

  Sync.keysOf = (db) => Object.keys(MAIN_FIELDS).concat(
    db.sessions.map((s) => 'session:' + s.id),
    db.body.map((b) => 'body:' + b.id),
    db.nutrition.map((n) => 'nutrition:' + n.id),
    db.foods.map((f) => 'food:' + f.id),
  );

  Sync.getDoc = function (db, key) {
    if (key in MAIN_FIELDS) return db[MAIN_FIELDS[key]];
    if (key.startsWith('session:')) return db.sessions.find((s) => s.id === key.slice(8)) || null;
    if (key.startsWith('body:')) return db.body.find((b) => b.id === key.slice(5)) || null;
    if (key.startsWith('nutrition:')) return db.nutrition.find((n) => n.id === key.slice(10)) || null;
    if (key.startsWith('food:')) return db.foods.find((f) => f.id === key.slice(5)) || null;
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
    if (key === 'main.customex') { db.customExercises = Core.normalize({ days: [], customExercises: data || [] }).customExercises; return; }
    if (key === 'main.libmeta') { db.libMeta = Core.normalize({ days: [], libMeta: data || {} }).libMeta; return; }
    if (key.startsWith('body:')) {
      const id = key.slice(5);
      db.body = db.body.filter((b) => b.id !== id);
      const b = data && Core.normalize({ days: [], body: [{ ...data, id }] }).body[0];
      if (b) {
        db.body.push(b);
        db.body.sort((x, y) => x.date - y.date);
      }
      return;
    }
    if (key.startsWith('nutrition:')) {
      const id = key.slice(10);
      db.nutrition = db.nutrition.filter((n) => n.id !== id);
      const n = data && Core.normalize({ days: [], nutrition: [{ ...data, id }] }).nutrition[0];
      if (n) db.nutrition.push(n);
      db.nutrition.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at));
      return;
    }
    if (key.startsWith('food:')) {
      const id = key.slice(5);
      db.foods = db.foods.filter((f) => f.id !== id);
      const f = data && Core.normalize({ days: [], foods: [{ ...data, id }] }).foods[0];
      if (f) db.foods.push(f);
    }
  };

  Sync.isEmpty = (db) => !db.days.length && !db.sessions.length && !db.activeSession && !db.body.length
    && !db.nutrition.length && !db.foods.length && !db.customExercises.length;

  /** Hat jemand ohne Konto schon etwas Eigenes angelegt (mehr als die Beispieldaten)? */
  Sync.hasUserContent = function (db) {
    if (db.sessions.length || db.activeSession || db.body.length
      || db.nutrition.length || db.foods.length || db.customExercises.length) return true;
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
      target.nutrition = g.nutrition;
      target.foods = g.foods;
      target.customExercises = g.customExercises;
      target.libMeta = { ...g.libMeta };
      return target;
    }
    for (const b of g.body) if (!target.body.some((x) => x.id === b.id)) target.body.push(b);
    target.body.sort((a, b) => a.date - b.date);
    for (const f of g.foods) if (!target.foods.some((x) => x.id === f.id)) target.foods.push(f);
    for (const n of g.nutrition) if (!target.nutrition.some((x) => x.id === n.id)) target.nutrition.push(n);
    for (const e of g.customExercises) if (!target.customExercises.some((x) => x.id === e.id)) target.customExercises.push(e);
    target.libMeta = { ...g.libMeta, ...target.libMeta };
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
        nutrition: (list) => handleCollection('nutrition:', list),
        foods: (list) => handleCollection('food:', list),
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
      module.exports = { Core, TimerCore, Sync, createSyncEngine, util: { fmtDate, parseNum, fmtNum, fmtClock, fmtRelative, fmtSet, fmtRest, fmtSets, fmtRepTarget, parseRepTarget, normName, e1rm, esc, clampRest, clampSets } };
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
  const GUEST_FROM_KEY = 'gymtracker.guestfrom.v1'; // uid, aus dessen Konto die Daten ohne Konto stammen (nach Abmelden)

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

  /** Einheitliche Linien-Icons (24er Raster, Strichstärke per CSS). */
  const svgI = (body) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  const ICON = {
    back: svgI('<path d="M15 5l-7 7 7 7"/>'),
    more: svgI('<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="3"/>'),
    trash: svgI('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.2 11v5.5M13.8 11v5.5"/>'),
    up: svgI('<path d="M6 15l6-6 6 6"/>'),
    down: svgI('<path d="M6 9l6 6 6-6"/>'),
    grip: svgI('<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>'),
    check: svgI('<path d="M5.5 12.5l4 4 9-9" pathLength="1"/>'),
    plus: svgI('<path d="M12 5v14M5 12h14"/>'),
    sets: svgI('<path d="M5 7h14M5 12h14M5 17h14"/>'),
    target: svgI('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>'),
    pin: svgI('<path d="M9 3.5h6M10 3.5v4.5l-3.5 4h11L14 8V3.5M12 12v8.5"/>'),
    share: svgI('<path d="M12 3.5v11M7.5 8L12 3.5 16.5 8M7 11H5.5v9.5h13V11H17"/>'),
    cal: svgI('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>'),
    clock: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    edit: svgI('<path d="M4.5 19.5h4l10.5-10.5-4-4L4.5 15.5zM13.5 6.5l4 4"/>'),
    play: svgI('<path class="fill" d="M8 5.5v13l10-6.5z"/>'),
    chevron: svgI('<path d="M9 5l7 7-7 7"/>'),
    flame: svgI('<path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.7-2.8-5.6-3.6-8.7-.3 1.6-1 2.8-2.2 3.6C12.5 7.3 11 4.7 8.6 3c.4 3.3-2.6 5.8-2.6 10.2C6 18.6 8.4 21 12 21z"/>'),
    bulb: svgI('<path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
    warn: svgI('<path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2h.01"/>'),
    trophy: svgI('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5a3 3 0 0 0 3 3M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>'),
    done: svgI('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>'),
    inbox: svgI('<path d="M12 4v10M8 10l4 4 4-4M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>'),
    close: svgI('<path d="M6 6l12 12M18 6 6 18"/>'),
    reload: svgI('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>'),
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
    Social.schedulePublish(); // geteilte Kennzahlen (nur falls ein Profil besteht)
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
      if (withSound && isIOS) Haptics.tap(); // wirkt nur, wenn iOS es ohne Berührung zulässt
      if (document.visibilityState !== 'visible' && !this.swScheduled) {
        Notify.show('Pause vorbei 💪', this.state && this.state.label ? 'Nächster Satz: ' + this.state.label : '');
      }
    },

    render() {
      const bar = $('#timer-bar');
      const t = this.state;
      document.body.classList.toggle('timer-on', !!t);
      // Die Leiste fährt per CSS-Übergang ein und aus (statt hart zu erscheinen)
      bar.hidden = false;
      bar.classList.toggle('show', !!t);
      bar.inert = !t;
      bar.setAttribute('aria-hidden', String(!t));
      if (!t) return;
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

  /* ---------- Bewegung & Haptik ---------- */

  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceMQ.matches;
  const EASE = {
    out: 'cubic-bezier(0.22, 1, 0.36, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
  };
  // Leichte Feder für WAAPI (fällt auf eine Bezier-Kurve zurück, wo linear() fehlt)
  EASE.spring = (window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'))
    ? 'linear(0, 0.063, 0.237, 0.459, 0.662 15.5%, 0.81, 0.909, 0.974 29.4%, 1.012, 1.032 38.5%, 1.037 43%, 1.033 48.6%, 1.01 62.1%, 0.998 76.3%, 1)'
    : 'cubic-bezier(0.3, 1.35, 0.5, 1)';

  /** Web Animations API mit Absicherung (ältere Browser: einfach nichts animieren). */
  function anim(el, frames, opts) {
    try { if (el && el.animate) return el.animate(frames, opts); } catch (e) { /* ignorieren */ }
    return null;
  }

  /** Zahl weich hoch-/runterzählen (nur Text, kein Layout). */
  function countUp(el, from, to, fmt, dur) {
    if (!el) return;
    if (reduced() || from === to || !Number.isFinite(from)) { el.textContent = fmt(to); return; }
    el.textContent = fmt(from);
    const t0 = performance.now();
    const d = dur || 650;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / d);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * Leichtes haptisches Feedback.
   * iPhone: Safari kennt navigator.vibrate nicht – ein unsichtbarer iOS-Schalter
   * (<input type="checkbox" switch>) löst beim Umschalten ein kurzes „Tick“ aus (iOS 18+,
   * nur direkt nach einer Berührung). Sonst navigator.vibrate. Wirft nie einen Fehler.
   */
  const Haptics = {
    tap() {
      try {
        if (!db || !db.settings.vibrate) return;
        if (isIOS) {
          const label = document.createElement('label');
          label.setAttribute('aria-hidden', 'true');
          label.style.display = 'none';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.setAttribute('switch', '');
          input.tabIndex = -1;
          label.appendChild(input);
          document.head.appendChild(label);
          label.click();
          label.remove();
        } else if (navigator.vibrate) {
          navigator.vibrate(12);
        }
      } catch (e) { /* nie stören */ }
    },
  };

  /* ---------- Toast (optional mit Aktion, z. B. „Rückgängig“) ---------- */

  let toastTimer = null;
  let toastHide = null;
  function toast(msg, opts) {
    const o = opts || {};
    const el = $('#toast');
    clearTimeout(toastTimer);
    clearTimeout(toastHide);
    el.innerHTML = '<span class="toast-msg"></span>' + (o.action ? '<button type="button" class="toast-btn">' + esc(o.action) + '</button>' : '');
    el.firstChild.textContent = msg;
    el.classList.toggle('has-action', !!o.action);
    const wasHidden = el.hidden;
    el.hidden = false;
    if (wasHidden) { el.classList.remove('show'); void el.offsetWidth; }
    el.classList.add('show');
    const hide = () => {
      el.classList.remove('show');
      toastHide = setTimeout(() => { el.hidden = true; el.classList.remove('has-action'); }, 220);
    };
    if (o.action) {
      el.querySelector('.toast-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(toastTimer);
        hide();
        Haptics.tap();
        o.onAction();
      }, { once: true });
    }
    toastTimer = setTimeout(hide, o.action ? 5000 : 2600);
  }

  /* ---------- Bottom Sheets: folgen dem Finger, Wischen nach unten schließt ---------- */

  const openSheets = new Set();
  function syncModalClass() { document.body.classList.toggle('modal-open', openSheets.size > 0); }

  /** Gummiband-Effekt (wie iOS) für Bewegungen über die Grenze hinaus. */
  const rubber = (x, dim) => (1 - 1 / (x * 0.55 / dim + 1)) * dim;

  /**
   * Macht aus einem .modal ein interaktives Sheet.
   * onDismiss: wird beim Wegwischen aufgerufen (der Aufrufer schließt dann wie gewohnt).
   * Rückgabe: { hide(done) } – animiert von der aktuellen Position aus nach unten.
   */
  function presentSheet(wrap, onDismiss, opts) {
    const o = opts || {};
    const card = wrap.querySelector('.modal-card');
    const backdrop = wrap.querySelector('.modal-backdrop');
    const desktop = window.matchMedia('(min-width: 700px)').matches;
    let y = 0;
    let closing = false;
    let running = [];
    openSheets.add(wrap);
    syncModalClass();

    if (!o.fullscreen) {
      const g = document.createElement('div');
      g.className = 'sheet-grabber';
      g.setAttribute('aria-hidden', 'true');
      card.prepend(g);
    }
    const markScroll = () => card.classList.toggle('scrolls', card.scrollHeight > card.clientHeight + 1);
    requestAnimationFrame(markScroll);
    card.addEventListener('input', () => requestAnimationFrame(markScroll));

    const stopRunning = () => { running.forEach((a) => { if (a) a.cancel(); }); running = []; };
    const setY = (v) => {
      y = v;
      card.style.transform = v ? 'translateY(' + v + 'px)' : '';
      if (backdrop) backdrop.style.opacity = String(Math.max(0, Math.min(1, 1 - v / Math.max(1, card.offsetHeight))));
    };

    // Einblenden (Einblenden etwas langsamer als Ausblenden)
    if (o.handoff) {
      running.push(anim(card, [{ opacity: 0.5 }, { opacity: 1 }], { duration: 220, easing: EASE.out }));
    } else if (reduced()) {
      running.push(anim(wrap, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'linear' }));
    } else if (o.fullscreen) {
      running.push(anim(card, [{ opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE.out }));
    } else if (desktop) {
      running.push(anim(card, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE.spring }));
      if (backdrop) running.push(anim(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE.out }));
    } else {
      running.push(anim(card, [{ transform: 'translateY(calc(100% + 48px))' }, { transform: 'none' }], { duration: 480, easing: EASE.sheet }));
      if (backdrop) running.push(anim(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE.out }));
    }

    // Ziehen per Pointer Events (die Karte hat touch-action: none, der Griff immer)
    let start = null, dragging = false, samples = [], raf = 0, pendingY = 0, swallow = false;
    if (!o.fullscreen && !desktop) {
      card.addEventListener('pointerdown', (e) => {
        if (closing || (e.button !== undefined && e.button > 0) || !e.isPrimary) return;
        if (e.target.closest('input, textarea, select, .scroll-list, video, .filter-chips')) return;
        const inGrab = !!e.target.closest('.sheet-grabber') || e.clientY - card.getBoundingClientRect().top < 30;
        if (card.classList.contains('scrolls') && !inGrab) return; // scrollbarer Inhalt: nur am Griff ziehen
        start = { x: e.clientX, y: e.clientY, id: e.pointerId };
        dragging = false;
        samples = [{ y: e.clientY, t: e.timeStamp }];
      });
      card.addEventListener('pointermove', (e) => {
        if (!start || e.pointerId !== start.id) return;
        const dy = e.clientY - start.y, dx = e.clientX - start.x;
        if (!dragging) {
          if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
          if (Math.abs(dx) > Math.abs(dy)) { start = null; return; }
          dragging = true;
          stopRunning();
          try { card.setPointerCapture(e.pointerId); } catch (err) { /* */ }
          card.classList.add('dragging');
          card.style.willChange = 'transform';
          const a = document.activeElement;
          if (a && card.contains(a) && a.blur) a.blur();
        }
        samples.push({ y: e.clientY, t: e.timeStamp });
        if (samples.length > 6) samples.shift();
        pendingY = dy >= 0 ? dy : -rubber(-dy, 70);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; setY(pendingY); });
      });
      const end = (e) => {
        if (!start || e.pointerId !== start.id) return;
        start = null;
        if (!dragging) return;
        dragging = false;
        swallow = true;
        setTimeout(() => { swallow = false; }, 350);
        cancelAnimationFrame(raf); raf = 0;
        setY(pendingY);
        card.classList.remove('dragging');
        card.style.willChange = '';
        const a = samples[0], b = samples[samples.length - 1];
        const v = b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px/ms
        if (e.type !== 'pointercancel' && (y > card.offsetHeight * 0.3 || (v > 0.55 && y > 10))) {
          sheet.velocity = v;
          onDismiss();
        } else {
          // zurückschnappen mit leichter Feder
          const from = y;
          const bd = backdrop ? Number(backdrop.style.opacity || 1) : 1;
          setY(0);
          running.push(anim(card, [{ transform: 'translateY(' + from + 'px)' }, { transform: 'none' }], { duration: 440, easing: EASE.spring }));
          if (backdrop) running.push(anim(backdrop, [{ opacity: bd }, { opacity: 1 }], { duration: 260, easing: EASE.out }));
        }
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
      // Nach dem Ziehen keinen Klick auslösen
      wrap.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
    }

    const sheet = {
      velocity: 0,
      get closing() { return closing; },
      hide(done) {
        if (closing) return;
        closing = true;
        openSheets.delete(wrap);
        syncModalClass();
        stopRunning();
        wrap.style.pointerEvents = 'none';
        const finish = () => { if (done) done(); };
        let a;
        if (reduced()) {
          a = anim(wrap, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear', fill: 'forwards' });
        } else if (o.fullscreen) {
          a = anim(card, [{ opacity: 1 }, { opacity: 0, transform: 'scale(1.03)' }], { duration: 220, easing: EASE.in, fill: 'forwards' });
        } else if (desktop) {
          a = anim(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 180, easing: EASE.in, fill: 'forwards' });
        } else {
          const h = card.offsetHeight || 400;
          const remaining = Math.max(0, h - y);
          const v = Math.max(sheet.velocity, 0);
          const dur = Math.round(Math.max(170, Math.min(300, v > 0.05 ? remaining / (v * 1.3) : 280)));
          a = anim(card, [{ transform: 'translateY(' + y + 'px)' }, { transform: 'translateY(' + (h + 24) + 'px)' }],
            { duration: dur, easing: v > 0.3 ? EASE.out : EASE.sheet, fill: 'forwards' });
        }
        if (backdrop && !reduced()) {
          anim(backdrop, [{ opacity: Number(backdrop.style.opacity || 1) }, { opacity: 0 }], { duration: 200, easing: EASE.in, fill: 'forwards' });
        }
        if (a) a.onfinish = finish; else finish();
      },
    };
    return sheet;
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
            ${buttons.map((b, i) => `<button type="button" class="btn ${b.style || ''}" data-idx="${i}">${b.icon || ''}${esc(b.label)}</button>`).join('')}
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
      let closed = false;
      let sheet = null;
      function close(val) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        wrap.classList.add('closing');
        if (sheet) sheet.hide(() => wrap.remove()); else wrap.remove();
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
      sheet = presentSheet(wrap, () => close(null));
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
      buttons: items.map((it) => ({ label: it.label, value: it.value, icon: it.icon, style: it.danger ? 'danger-soft' : 'soft' }))
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
    foodDate: null,
    lib: { q: '', muscle: new Set(), equip: new Set(), fav: false, custom: false },
    isAdmin: false,          // wird von cloud.js gesetzt (Prüfung über die Firestore-Regeln)
    admin: { users: null, loading: false, error: null, filter: '', stats: {} },
    blocked: null,           // Sperr-Info, falls sie während des Anmeldens eintrifft
    // Oberfläche / Übergänge
    hdr: { title: '', back: null, large: false, eyebrow: '', set: false },
    lastTab: null,
    navDir: null,
    scrollMem: {},           // Scrollposition je Seite (für Zurück & Tab-Wechsel)
    fadeContent: null,       // Inhalt unterhalb dieses Elements beim nächsten Zeichnen einblenden
    foodFx: null,            // letzte Werte des Kalorienrings (für Zähl-Animation)
    popSet: null,            // gerade abgehakter Satz (Haken-Animation)
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
      case 'settings': return { name: 'settings', sub: parts[1] || null, tab: 'profile' };
      case 'profile': return { name: parts[1] === 'edit' ? 'profile-edit' : 'profile', tab: 'profile' };
      case 'friends': return { name: parts[1] === 'requests' ? 'friends-requests' : 'friends-add', tab: 'profile' };
      case 'friend': return { name: 'friend', id: parts[1] || '', tab: 'profile' };
      case 'leaderboard': return { name: 'leaderboard', tab: 'profile' };
      case 'invite': return { name: 'invite', id: parts[1] || '', tab: 'profile' };
      case 'food': return { name: 'food', tab: 'food' };
      case 'library':
        if (parts[1] === 'ex') return { name: 'libex', id: parts[2] || '', tab: 'library' };
        return { name: 'library', tab: 'library' };
      case 'summary': return { name: 'summary', id: parts[1], tab: 'home' };
      case 'import': return { name: 'import', code: parts[1] || '', tab: 'home' };
      case 'preview': return { name: 'preview', id: parts[1], tab: 'home' };
      case 'admin': return { name: 'admin', id: parts[1] || null, tab: 'profile' };
      case 'body': return { name: 'body', id: parts[1] || 'new', tab: 'history' };
      case 'login': return { name: 'login', tab: 'profile' };
      case 'intro': return { name: 'intro', tab: 'profile' };
      case 'setup': return { name: 'setup', tab: 'home' };
      default: return { name: 'home', tab: 'home' };
    }
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function setHeader({ title, back, actions, large, hidden, eyebrow }) {
    const h = $('#header');
    h.hidden = !!hidden;
    h.className = 'app-header' + (large ? ' large' : '');
    h.innerHTML = `
      <div class="hdr-bg" aria-hidden="true"></div>
      <div class="hdr-side">${back ? `<a class="hdr-btn" href="${back}" aria-label="Zurück">${ICON.back}<span>Zurück</span></a>` : ''}</div>
      <h1 class="hdr-title">${esc(title)}</h1>
      <div class="hdr-side right">${actions || ''}</div>`;
    ui.hdr = { title, back: back || null, large: !!large, eyebrow: eyebrow || '', set: true };
    document.title = title === 'Training' || title === 'Gym Tracker' ? 'Gym Tracker' : title + ' · Gym Tracker';
  }

  /* ---------- Kopfzeile beim Scrollen (Hintergrund einblenden, großer Titel schrumpft) ---------- */

  const HeaderFx = {
    raf: 0,
    last: '',
    update() {
      const h = $('#header');
      if (!h || h.hidden) return;
      const y = window.scrollY;
      const bg = Math.max(0, Math.min(1, y / 16));
      let title = 1;
      const lt = $('#view > .large-title');
      if (lt) {
        const p = Math.max(0, Math.min(1, (y - 6) / 38));
        title = p;
        // Großer Titel: schrumpft leicht und blendet aus; beim Nachfedern (iOS) wächst er
        const s = y < 0 ? Math.min(1.08, 1 + (-y) / 600) : 1 - 0.08 * p;
        lt.style.transform = s === 1 ? '' : 'scale(' + s.toFixed(4) + ')';
        lt.style.opacity = y > 0 ? String(1 - p) : '';
      }
      const key = bg.toFixed(3) + '|' + title.toFixed(3);
      if (key === this.last) return;
      this.last = key;
      h.style.setProperty('--hdr-bg', bg.toFixed(3));
      h.style.setProperty('--hdr-title', title.toFixed(3));
    },
    onScroll() {
      if (HeaderFx.raf) return;
      HeaderFx.raf = requestAnimationFrame(() => { HeaderFx.raf = 0; HeaderFx.update(); });
    },
  };

  /* ---------- Tab-Leiste: Glas-Linse gleitet zum aktiven Reiter (mit „flüssigem“ Dehnen) ---------- */

  const TabLens = {
    last: null,
    update(noAnim) {
      const lens = $('#tab-lens');
      const tab = $('.tab.active');
      if (!lens || !tab || document.body.classList.contains('no-tabbar')) return;
      const x = tab.offsetLeft, w = tab.offsetWidth;
      const prev = this.last;
      this.last = { x, w };
      lens.style.width = w + 'px';
      lens.style.transform = 'translateX(' + x + 'px)';
      if (noAnim || !prev || prev.x === x || reduced()) return;
      const mid = (prev.x + x) / 2;
      anim(lens, [
        { transform: 'translateX(' + prev.x + 'px)' },
        { transform: 'translateX(' + mid + 'px) scale(1.28, 0.86)', offset: 0.45 },
        { transform: 'translateX(' + x + 'px)' },
      ], { duration: 560, easing: EASE.out });
    },
  };

  /* ---------- Navigation mit Übergängen ---------- */

  const TAB_ROOT = { home: '#/', history: '#/history', food: '#/food', library: '#/library', profile: '#/profile' };
  const navStack = [];

  /** Richtung eines Seitenwechsels: push (tiefer), pop (zurück), tab (anderer Reiter). */
  function navDirection(newKey, newRoute) {
    const oldKey = ui.lastRoute;
    const oldTab = ui.lastTab;
    if (!oldKey) return null;
    if (newRoute.tab !== oldTab) {
      navStack.length = 0;
      navStack.push(newKey);
      return 'tab';
    }
    const isRoot = TAB_ROOT[newRoute.tab] === newKey || (newKey === '#/' && newRoute.name === 'home');
    const prevIdx = navStack.lastIndexOf(newKey);
    if (isRoot || newKey === ui.hdr.back || (prevIdx >= 0 && prevIdx === navStack.length - 2)) {
      if (prevIdx >= 0) navStack.length = prevIdx + 1; else { navStack.length = 0; navStack.push(newKey); }
      return 'pop';
    }
    if (!navStack.length) navStack.push(oldKey);
    navStack.push(newKey);
    return 'push';
  }

  let vtPending = false;

  /**
   * View Transitions API nur dort, wo sie stabil läuft. In WebKit (Safari, alle iPhone-Browser)
   * hat sie im Test die Seite abstürzen lassen – dort übernimmt ein eigener Übergang
   * mit gleichem Aussehen (Schnappschuss der alten Seite + Web Animations).
   */
  const ua = navigator.userAgent;
  const isWebKitEngine = isIOS || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua));
  const nativeVT = () => !!document.startViewTransition && !isWebKitEngine;

  /** Führt fn mit View Transition aus. Rückgabe false = nicht möglich, fn wurde NICHT ausgeführt. */
  function withTransition(kind, fn) {
    const can = nativeVT() && document.visibilityState === 'visible' && !openSheets.size &&
      !$('#modal-root').children.length;
    if (!can) return false;
    const root = document.documentElement;
    const nav = reduced() ? 'fade' : kind;
    root.dataset.nav = nav;
    vtPending = true;
    try {
      const vt = document.startViewTransition(() => { vtPending = false; fn(); });
      const clear = () => { if (root.dataset.nav === nav) delete root.dataset.nav; };
      vt.finished.then(clear, clear);
      vt.ready.catch(() => {});
      vt.updateCallbackDone.catch(() => {});
    } catch (e) {
      vtPending = false;
      delete root.dataset.nav;
      fn();
    }
    return true;
  }

  /** Zeichnet die aktuelle Ansicht neu. Seitenwechsel werden animiert, gleiche Route behält die Scrollposition. */
  function render() {
    if (vtPending) return; // der ausstehende Übergang zeichnet ohnehin den neuesten Stand
    const key = location.hash || '#/';
    if (ui.lastRoute && key !== ui.lastRoute && (account || ui.lastRoute === '#/intro')) {
      const route = parseRoute();
      const dir = navDirection(key, route);
      if (dir) {
        ui.navDir = dir;
        if (!withTransition(dir, renderNow)) GhostNav.run(dir, renderNow);
        return;
      }
    }
    GhostNav.clear();
    renderNow();
  }

  /**
   * Seitenübergang ohne View Transitions API: Die alte Seite wird als Schnappschuss (DOM-Kopie)
   * fixiert, die neue sofort gezeichnet – dann gleiten beide per transform/opacity.
   * push: neue Seite kommt von rechts, alte weicht nach links und dunkelt ab.
   * pop:  alte Seite gleitet nach rechts weg, darunter kommt die vorige zurück.
   * tab:  kurze Überblendung mit minimaler Verschiebung.
   * Die neue Seite ist sofort bedienbar.
   */
  const GhostNav = {
    active: null,
    clear() {
      const a = this.active;
      if (!a) return;
      this.active = null;
      a.anims.forEach((x) => { if (x) x.cancel(); });
      a.layer.remove();
      if (a.hdr) a.hdr.remove();
      document.body.classList.remove('navving', 'navving-pop');
    },
    snapshot(el) {
      const c = el.cloneNode(true);
      c.removeAttribute('id');
      c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
      c.querySelectorAll('[data-action], [data-flip], [data-swipe]').forEach((x) => {
        x.removeAttribute('data-action'); x.removeAttribute('data-flip'); x.removeAttribute('data-swipe');
      });
      c.setAttribute('aria-hidden', 'true');
      c.inert = true;
      return c;
    },
    run(dir, fn) {
      this.clear();
      const view = $('#view');
      if (reduced() || document.visibilityState !== 'visible' || !view.animate) {
        fn();
        if (reduced()) anim(view, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
        return;
      }
      const r = view.getBoundingClientRect();
      const layer = document.createElement('div');
      layer.className = 'nav-ghost' + (dir === 'push' ? '' : ' over');
      layer.setAttribute('aria-hidden', 'true');
      const ghost = this.snapshot(view);
      const startX = view.style.transform || ''; // z. B. nach Wischen vom Rand
      Object.assign(ghost.style, { position: 'absolute', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', margin: '0', transform: '' });
      layer.appendChild(ghost);
      const header = $('#header');
      const hdr = header.hidden ? null : this.snapshot(header);
      if (hdr) hdr.classList.add('nav-ghost-hdr');

      document.body.classList.add('navving');
      if (dir !== 'push') document.body.classList.add('navving-pop');
      fn();
      document.body.appendChild(layer);
      if (hdr) document.body.appendChild(hdr);

      const anims = [];
      let main;
      if (dir === 'push') {
        main = anim(view, [{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: 480, easing: EASE.sheet });
        anims.push(anim(ghost, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-24%)', opacity: 0.35 }], { duration: 480, easing: EASE.sheet, fill: 'forwards' }));
      } else if (dir === 'pop') {
        main = anim(ghost, [{ transform: startX || 'none' }, { transform: 'translateX(100%)' }], { duration: 400, easing: EASE.sheet, fill: 'forwards' });
        anims.push(anim(view, [{ transform: 'translateX(-24%)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 400, easing: EASE.sheet }));
      } else {
        main = anim(view, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 40, easing: EASE.out, fill: 'backwards' });
        anims.push(anim(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE.in, fill: 'forwards' }));
      }
      if (hdr) anims.push(anim(hdr, [{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: EASE.in, fill: 'forwards' }));
      anims.push(main);
      const state = { layer, hdr, anims };
      this.active = state;
      const done = () => { if (this.active === state) this.clear(); };
      if (main) main.onfinish = done; else done();
    },
  };

  function renderNow() {
    const route = parseRoute();
    // Noch nicht entschieden (Konto oder ohne Konto)? → Anmeldeseite
    if (!account && route.name !== 'login' && route.name !== 'intro') {
      if (route.name === 'import') ui.pendingImport = route.code; // nach dem Anmelden weitermachen
      if (route.name === 'invite') ui.pendingInvite = Core.normUsername(route.id);
      location.replace(introSeen() ? '#/login' : '#/intro');
      return;
    }
    // Beim allerersten Öffnen zuerst die Einführung zeigen
    if (!account && route.name === 'login' && !introSeen()) { location.replace('#/intro'); return; }
    if (account && route.name === 'intro') { location.replace('#/'); return; }
    if (isUser() && route.name === 'login') { location.replace('#/'); return; }
    document.body.classList.toggle('no-tabbar', !account || route.name === 'setup');

    const key = location.hash || '#/';
    const sameRoute = key === ui.lastRoute;
    const scrollY = window.scrollY;
    const view = $('#view');
    if (!sameRoute && ui.lastRoute) ui.scrollMem[ui.lastRoute] = scrollY;
    const flip = sameRoute ? Flip.measure(view) : null;
    view.style.transform = '';
    ui.hdr.set = false;

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
      case 'settings': renderSettings(view, route.sub); break;
      case 'profile': renderProfile(view); break;
      case 'profile-edit': renderProfileEdit(view); break;
      case 'friends-add': renderFriendsAdd(view); break;
      case 'friends-requests': renderRequests(view); break;
      case 'friend': renderFriend(view, route.id); break;
      case 'leaderboard': renderLeaderboard(view); break;
      case 'invite': renderInvite(view, route.id); break;
      case 'food': renderFood(view); break;
      case 'library': renderLibrary(view); break;
      case 'libex': renderLibEx(view, route.id); break;
      case 'login': renderLogin(view); break;
      case 'intro': renderIntro(view); break;
      case 'setup': renderSetup(view); break;
      default: renderHome(view);
    }

    // Großer iOS-Titel als erstes Element des Inhalts
    if (ui.hdr.set && ui.hdr.large && !(view.firstElementChild && view.firstElementChild.classList.contains('large-title'))) {
      view.insertAdjacentHTML('afterbegin', '<div class="large-title" aria-hidden="true">' +
        (ui.hdr.eyebrow ? '<span class="large-eyebrow">' + esc(ui.hdr.eyebrow) + '</span>' : '') + esc(ui.hdr.title) + '</div>');
    }

    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === route.tab));
    TabLens.update();
    $('#tab-dot').hidden = !db.activeSession;
    Social.badge();
    ui.lastRoute = key;
    ui.lastTab = route.tab;
    const dir = ui.navDir;
    ui.navDir = null;
    const y = sameRoute ? scrollY : (dir === 'pop' || dir === 'tab') ? (ui.scrollMem[key] || 0) : 0;
    window.scrollTo(0, y);
    HeaderFx.last = '';
    HeaderFx.update();
    enhanceView(view, sameRoute);
    if (flip) Flip.play(flip, view);
  }

  /* ---------- FLIP: Listenelemente gleiten an ihren neuen Platz ---------- */

  /**
   * Elemente mit data-flip="schlüssel" werden über Neuzeichnungen hinweg verfolgt:
   * verschobene gleiten weich, neue blenden ein, entfernte blenden am alten Platz aus.
   */
  const Flip = {
    measure(root) {
      if (reduced()) return null;
      const map = new Map();
      const sy = window.scrollY;
      const vh = window.innerHeight;
      for (const el of root.querySelectorAll('[data-flip]')) {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement && el.parentElement.closest('[data-flip]');
        map.set(el.dataset.flip, {
          el, top: r.top + sy, left: r.left, w: r.width, h: r.height,
          off: r.bottom < -100 || r.top > vh + 100,
          parent: parent ? parent.dataset.flip : null,
        });
      }
      return map;
    },
    play(before, root) {
      if (!before || !before.size) return;
      const sy = window.scrollY;
      const vh = window.innerHeight;
      const now = new Map();
      for (const el of root.querySelectorAll('[data-flip]')) {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement && el.parentElement.closest('[data-flip]');
        now.set(el.dataset.flip, { el, r, top: r.top + sy, parent: parent ? parent.dataset.flip : null });
      }
      const delta = new Map();
      for (const [k, n] of now) {
        const b = before.get(k);
        if (b) delta.set(k, { dx: b.left - n.r.left, dy: b.top - n.top });
      }
      for (const [k, n] of now) {
        if (n.r.bottom < 0 || n.r.top > vh) continue;
        const d = delta.get(k);
        if (!d) {
          // neu: einblenden (nicht, wenn das umgebende Element selbst neu ist)
          if (n.parent && !before.has(n.parent)) continue;
          anim(n.el, [{ opacity: 0, transform: 'scale(0.97) translateY(-4px)' }, { opacity: 1, transform: 'none' }],
            { duration: 320, delay: 60, easing: EASE.out, fill: 'backwards' });
          continue;
        }
        // Bewegung relativ zum ebenfalls animierten Elternelement
        const pd = n.parent && delta.get(n.parent);
        const dx = d.dx - (pd ? pd.dx : 0), dy = d.dy - (pd ? pd.dy : 0);
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        anim(n.el, [{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }],
          { duration: 420, easing: EASE.sheet });
      }
      // Entfernt: am alten Platz kurz ausblenden
      for (const [k, b] of before) {
        if (now.has(k) || b.off || b.el.dataset.gone || (b.parent && !now.has(b.parent))) continue;
        const g = b.el;
        g.removeAttribute('data-flip');
        Object.assign(g.style, {
          position: 'absolute', top: b.top + 'px', left: (b.left + window.scrollX) + 'px', width: b.w + 'px', height: b.h + 'px',
          margin: '0', pointerEvents: 'none', zIndex: '0', transform: '',
        });
        root.appendChild(g);
        const a = anim(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
          { duration: 200, easing: EASE.in, fill: 'forwards' });
        if (a) a.onfinish = () => g.remove(); else g.remove();
      }
    },
  };

  /* ---------- Nach jedem Zeichnen: Segment-Daumen, Zähler, Einblendungen ---------- */

  function enhanceView(view, sameRoute) {
    Seg.enhance(view, sameRoute);
    if (ui.fadeContent) {
      const from = ui.fadeContent;
      ui.fadeContent = null;
      if (!reduced()) {
        let on = false;
        for (const el of view.children) {
          if (el === from || (from.nodeType !== 1 && el.matches(from))) { on = true; continue; }
          if (on) anim(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE.out });
        }
      }
    }
    const rn = parseRoute().name;
    if (rn === 'food') FoodFx.play(view, sameRoute);
    if (!sameRoute && (rn === 'friend' || rn === 'leaderboard')) SocialFx.bars(view);
    if (rn === 'workout') WorkoutPager.init(view); else WorkoutPager.stop();
  }

  /** Segment-Steuerungen: weiß gefüllter „Daumen“ gleitet zur Auswahl. */
  const Seg = {
    mem: {},
    enhance(root, animate) {
      $$('.segmented', root).forEach((seg, i) => {
        const sel = seg.querySelector('[aria-selected="true"]');
        if (!sel) return;
        const first = seg.querySelector('[data-action]');
        const key = (ui.lastRoute || '') + '|' + (first ? first.dataset.action : i);
        const thumb = document.createElement('span');
        thumb.className = 'seg-thumb';
        seg.prepend(thumb);
        seg.classList.add('has-thumb');
        const left = sel.offsetLeft, width = sel.offsetWidth;
        thumb.style.width = width + 'px';
        thumb.style.transform = 'translateX(' + left + 'px)';
        const prev = this.mem[key];
        this.mem[key] = { left, width };
        if (animate && prev && (prev.left !== left || prev.width !== width) && !reduced()) {
          anim(thumb, [
            { transform: 'translateX(' + prev.left + 'px) scaleX(' + (prev.width / width) + ')' },
            { transform: 'translateX(' + left + 'px)' },
          ], { duration: 420, easing: EASE.spring });
        }
      });
    },
  };
  /* ---------- Ansicht: Startseite (Trainingstage) ---------- */

  function renderHome(view) {
    if (ui.pendingImport) {
      const code = ui.pendingImport;
      ui.pendingImport = null;
      location.replace('#/import/' + code);
      return;
    }
    if (ui.pendingInvite && isUser()) {
      const name = ui.pendingInvite;
      ui.pendingInvite = null;
      location.replace('#/invite/' + encodeURIComponent(name));
      return;
    }
    const now = Date.now();
    setHeader({ title: 'Training', large: true, eyebrow: new Date(now).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) });
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
        <div class="day-card ${isActive ? 'is-active' : ''}" data-flip="day-${esc(d.id)}" data-action="preview-day" data-id="${esc(d.id)}" role="button" tabindex="0">
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
    if (p.kind === 'increase') return p.next !== null ? `${ICON.bulb}Heute steigern: ${fmtNum(p.next)} kg × ${ex.repMin}` : ICON.bulb + 'Heute steigern: Zusatzgewicht oder schwerere Variante';
    if (p.kind === 'below') return ICON.target + 'Gewicht halten, Untergrenze schaffen';
    return ICON.target + 'Gleiches Gewicht, je 1 Wdh. mehr';
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
          <small>${w.streak ? ICON.flame + w.streak + (w.streak === 1 ? ' Woche' : ' Wochen') + ' in Folge geschafft' : 'Wochenziel: ' + w.goal + '× trainieren'}</small></span>
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
      <li class="ex-row" data-id="${esc(ex.id)}" data-index="${i}" data-flip="exr-${esc(ex.id)}" data-swipe="ex:${esc(ex.id)}">
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
      <button class="btn soft block" data-flip="ex-add" data-action="ex-add" data-id="${esc(day.id)}">${ICON.plus} Übung hinzufügen</button>
      <p class="hint" data-flip="ex-hint">Tipp: Am Griff ${ICON.grip} ziehen oder die Pfeile nutzen, um die Reihenfolge zu ändern. Nach links wischen entfernt eine Übung. Tippe auf den Namen zum Umbenennen und auf die Chips für Sätze, Ziel-Wiederholungen, Satzpause und eine dauerhafte Notiz (z. B. Sitzeinstellung).</p>
      ${day.exercises.length ? `<button class="btn primary block lg" data-flip="ex-start" data-action="open-day" data-id="${esc(day.id)}">${ICON.play} ${isActive ? 'Zum laufenden Training' : 'Training starten'}</button>` : ''}`;

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
   * Das gezogene Element hebt sich an, die Nachbarn weichen weich aus und nach dem
   * Loslassen gleitet alles per FLIP an den neuen Platz.
   */
  function enableDragSort(list, onDrop) {
    list.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle || (e.button !== undefined && e.button !== 0)) return;
      const item = handle.closest('.ex-row');
      const items = [...list.children].filter((el) => el.classList.contains('ex-row'));
      const from = items.indexOf(item);
      const rects = items.map((el) => el.getBoundingClientRect());
      const step = items.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
      const startY = e.clientY;
      let to = from;
      let dy = 0;
      let raf = 0;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      item.classList.add('dragging');
      list.classList.add('sorting');
      item.style.willChange = 'transform';
      const lift = () => { item.style.transform = 'translateY(' + dy + 'px) scale(1.03)'; };
      if (!reduced()) anim(item, [{ transform: 'none' }, { transform: 'scale(1.03)' }], { duration: 220, easing: EASE.spring });
      lift();

      const frame = () => {
        raf = 0;
        lift();
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
      const move = (ev) => {
        dy = ev.clientY - startY;
        if (!raf) raf = requestAnimationFrame(frame);
      };
      const end = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        cancelAnimationFrame(raf);
        item.style.willChange = '';
        if (ev.type === 'pointerup' && to !== from) {
          // Positionen bleiben stehen → render() misst sie und lässt alles an den neuen Platz gleiten
          Haptics.tap();
          onDrop(from, to);
          return;
        }
        const cur = item.style.transform;
        items.forEach((el) => { el.style.transform = ''; });
        item.classList.remove('dragging');
        list.classList.remove('sorting');
        anim(item, [{ transform: cur || 'none' }, { transform: 'none' }], { duration: 380, easing: EASE.spring });
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
        ? `${ICON.bulb}<span>Alle Sätze mit ${ctx.target.max}+ Wdh. geschafft → heute <b>${fmtNum(p.next)} kg</b> (+${fmtNum(ctx.inc)}) für ${ctx.target.min} Wdh.</span>`
        : `${ICON.bulb}<span>Alle Sätze mit ${ctx.target.max}+ Wdh. geschafft → Zeit für Zusatzgewicht oder eine schwerere Variante.</span>`;
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

    const cardList = s.exercises.map((se, idx) => {
      const ctx = Core.exerciseContext(db, se);
      const prev = ctx.prev;
      const plan = ctx.plan;
      const doneCount = se.sets.filter((st) => st.done).length;
      const activeIdx = se.sets.findIndex((st) => !st.done); // hier arbeitest du gerade → +/−-Buttons
      const hint = progressionHint(ctx);
      const allDone = se.sets.length > 0 && activeIdx < 0;
      const nextEx = s.exercises[idx + 1];
      const everyDone = s.exercises.every((e) => e.skipped || (e.sets.length && e.sets.every((st) => st.done)));
      if (se.skipped) {
        return `
          <section class="card ex-card skipped" data-se="${esc(se.id)}" data-flip="se-${esc(se.id)}">
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
          <div class="set ${st.done ? 'done' : ''}${ui.popSet && ui.popSet.id === st.id ? (st.done ? ' pop' : ' unpop') : ''}" data-se="${esc(se.id)}" data-set="${esc(st.id)}" data-flip="set-${esc(st.id)}">
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
              <button class="check" data-action="set-toggle" aria-pressed="${st.done}" aria-label="Satz ${i + 1} ${st.done ? 'nicht mehr erledigt' : 'erledigt'}"><span class="check-c">${ICON.check}</span></button>
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
        <section class="card ex-card" data-se="${esc(se.id)}" data-flip="se-${esc(se.id)}">
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
          <button class="btn soft block sm" data-flip="add-${esc(se.id)}" data-action="set-add" data-se="${esc(se.id)}">${ICON.plus} Satz</button>
          ${allDone && nextEx ? `<button class="btn primary block wk-advance" data-flip="adv-${esc(se.id)}" data-action="wk-go" data-index="${idx + 1}">Weiter: ${esc(nextEx.name)} ${ICON.chevron}</button>` : ''}
          ${allDone && !nextEx && everyDone ? `<button class="btn primary block wk-advance" data-flip="adv-${esc(se.id)}" data-action="finish">Training beenden</button>` : ''}
        </section>`;
    });
    const doneState = (se) => (se.skipped ? 'skipped' : se.sets.length && se.sets.every((st) => st.done) ? 'done' : '');
    const cards = cardList.length ? `
      <div class="wk-pager" id="wk-pager">
        <div class="wk-pills">${s.exercises.map((se, i) => `<button class="wk-pill ${doneState(se)}" data-action="wk-go" data-index="${i}" aria-label="${i + 1}. ${esc(se.name)}"></button>`).join('')}</div>
        <div class="wk-pager-row"><span id="wk-pos">Übung 1 von ${cardList.length}</span><button class="wk-next-link" id="wk-next" data-action="wk-go" data-index="1" hidden></button></div>
      </div>
      <div class="wk-track" id="wk-track">${cardList.map((c, i) => `<div class="wk-slide" data-se="${esc(s.exercises[i].id)}">${c}</div>`).join('')}</div>
      <p class="hint center wk-swipe-hint">Nach links wischen für die nächste Übung</p>` : '';

    const wakeHint = !Wake.supported ? `
      <p class="hint warn">Dein Browser kann den Bildschirm nicht automatisch anlassen. Tipp: iPhone-Einstellungen → Anzeige &amp; Helligkeit → Automatische Sperre verlängern.</p>` : '';

    view.innerHTML = `
      <div class="wk-meta">Gestartet ${fmtTime(s.startedAt)} Uhr · <span id="elapsed">${fmtDuration(Date.now() - s.startedAt)}</span></div>
      ${wakeHint}
      ${cards || '<div class="empty"><p class="muted">Dieser Tag hat noch keine Übungen.</p></div>'}
      <button class="btn soft block" data-flip="w-add" data-action="w-add-ex">${ICON.plus} Übung hinzufügen</button>
      <a class="btn ghost block" data-flip="w-plan" href="#/day/${encodeURIComponent(s.dayId || '')}">${ICON.edit} Plan bearbeiten</a>
      <div class="wk-end" data-flip="w-end">
        <button class="btn primary block lg" data-action="finish">Training beenden &amp; speichern</button>
        <button class="btn ghost block danger-text" data-action="discard">Training verwerfen</button>
      </div>`;
  }

  /**
   * Training: jede Übung als eigene Karte, per Wischen zur nächsten (Scroll-Snap).
   * Die Höhe passt sich der sichtbaren Karte an, die Nachbarn treten leicht zurück.
   */
  const WorkoutPager = {
    ro: null,
    track: null,
    stop() {
      if (this.ro) { this.ro.disconnect(); this.ro = null; }
      this.track = null;
    },
    init(view) {
      this.stop();
      const track = $('#wk-track', view);
      const s = db.activeSession;
      if (!track || !s) return;
      this.track = track;
      const slides = [...track.children];
      const pills = $$('.wk-pill', view);
      const pos = $('#wk-pos', view);
      const nextBtn = $('#wk-next', view);
      const width = () => track.clientWidth || 1;
      let cur = slides.findIndex((sl) => sl.dataset.se === ui.wkSe);
      if (cur < 0) cur = Math.max(0, s.exercises.findIndex((e) => !e.skipped && e.sets.some((st) => !st.done)));
      const labels = (i) => {
        ui.wkSe = slides[i] ? slides[i].dataset.se : null;
        pills.forEach((p, k) => p.classList.toggle('on', k === i));
        if (pos) pos.textContent = 'Übung ' + (i + 1) + ' von ' + slides.length;
        const nx = s.exercises[i + 1];
        if (nextBtn) {
          nextBtn.hidden = !nx;
          if (nx) { nextBtn.dataset.index = String(i + 1); nextBtn.innerHTML = '<span>Als Nächstes: ' + esc(nx.name) + '</span>' + ICON.chevron; }
        }
      };
      const syncHeight = (animate) => {
        const sl = slides[cur];
        if (!sl || !track.isConnected) return;
        track.style.transition = animate && !reduced() ? '' : 'none';
        track.style.height = sl.offsetHeight + 'px';
      };
      track.scrollLeft = cur * width();
      labels(cur);
      syncHeight(false);
      let raf = 0, settle = 0;
      const frame = () => {
        raf = 0;
        const p = track.scrollLeft / width();
        if (!reduced()) {
          slides.forEach((sl, k) => {
            const card = sl.firstElementChild;
            if (!card) return;
            const d = Math.min(1, Math.abs(k - p));
            card.style.transform = d > 0.002 ? 'scale(' + (1 - d * 0.06).toFixed(4) + ')' : '';
            card.style.opacity = d > 0.002 ? (1 - d * 0.55).toFixed(3) : '';
          });
        }
        const i = Math.max(0, Math.min(slides.length - 1, Math.round(p)));
        if (i !== cur) { cur = i; labels(i); }
        clearTimeout(settle);
        settle = setTimeout(() => syncHeight(true), 80);
      };
      track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
      if (window.ResizeObserver) {
        this.ro = new ResizeObserver(() => syncHeight(true));
        slides.forEach((sl) => this.ro.observe(sl));
      }
    },
    go(i) {
      const t = this.track;
      if (!t || !t.isConnected) return;
      const n = t.children.length;
      const idx = Math.max(0, Math.min(n - 1, i));
      t.scrollTo({ left: idx * t.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
    },
  };

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
        <div><strong>${w.streak ? ICON.flame + w.streak : '–'}</strong><small>${w.streak === 1 ? 'Woche' : 'Wochen'} in Folge</small></div>
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
        <div class="hero-icon outline" aria-hidden="true">${ICON.inbox}</div>
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
        <h2 class="records-title">${ICON.trophy} Neue Rekorde</h2>
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
        <div class="hero-icon" aria-hidden="true">${recs.length ? ICON.trophy : ICON.done}</div>
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
    const tabs = { e1rm: '1RM (ca.)', weight: 'Gewicht', reps: 'Wdh.' };
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
        ${pts.length > 1 ? `<path d="${area}" fill="url(#c-fill)" class="c-area"/><path d="${line}" class="c-line" pathLength="1"/>` : ''}
        ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" class="c-dot"/>`).join('')}
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5.5" class="c-dot-last"/>
        <text x="${Math.min(last[0], W - P.r - 4).toFixed(1)}" y="${Math.max(last[1] - 11, 12).toFixed(1)}" class="c-value" text-anchor="end">${fmtNum(Math.round(lastP.y * 10) / 10)} ${esc(unit)}</text>
        <text x="${P.l}" y="${H - 8}" class="c-label">${fmtShortDate(points[0].x)}</text>
        ${points.length > 1 ? `<text x="${W - P.r}" y="${H - 8}" class="c-label" text-anchor="end">${fmtShortDate(lastP.x)}</text>` : ''}
      </svg>`;
  }

  /* ---------- Einführung beim ersten Öffnen ---------- */

  const INTRO_KEY = 'gymtracker.intro.v1';   // nur ein Merker „Einführung gesehen“ auf diesem Gerät
  const introSeen = () => lsGet(INTRO_KEY) === '1';

  const INTRO_SLIDES = [
    {
      title: 'Willkommen bei Gym Tracker',
      text: 'Plane dein Training, trage jeden Satz ein und sieh, wie du stärker wirst – schnell, übersichtlich und auch ohne Internet.',
      art: '<div class="ia-logo"><img src="icons/icon.svg" alt=""></div>',
    },
    {
      title: 'Jeder Satz zählt',
      text: 'Gewicht und Wiederholungen eintragen, abhaken – fertig. Die Werte vom letzten Mal stehen schon da, und die App schlägt vor, wann du steigern kannst.',
      art: '<div class="ia-card">' +
        [['60 kg', '10'], ['60 kg', '9'], ['62,5 kg', '8']].map(([w, r], i) =>
          '<div class="ia-set" style="--i:' + i + '"><span class="ia-no">' + (i + 1) + '</span><b>' + w + '</b><b>' + r + ' Wdh.</b>' +
          '<span class="check-c">' + ICON.check + '</span></div>').join('') +
        '<div class="ia-hint">' + ICON.bulb + '<span>Heute <b>+2,5 kg</b> versuchen</span></div></div>',
    },
    {
      title: 'Pausen im Griff',
      text: 'Nach jedem abgehakten Satz startet der Pausentimer automatisch – mit Signalton, Benachrichtigung und ±15 Sekunden auf Knopfdruck.',
      art: '<div class="ia-timer"><div class="ia-timer-bar"><i></i></div><div class="ia-timer-row"><b class="ia-timer-time">1:30</b>' +
        '<span class="ia-round">−15</span><span class="ia-round">+15</span><span class="ia-pill">Überspringen</span></div></div>',
    },
    {
      title: 'Fortschritt sehen',
      text: 'Diagramme, Kalender, Wochenziel und neue Rekorde – du siehst auf einen Blick, wie es vorangeht.',
      art: '<div class="ia-card ia-chart"><svg viewBox="0 0 240 110" aria-hidden="true"><path class="ia-grid" d="M0 20h240M0 55h240M0 90h240"/>' +
        '<path class="ia-line" pathLength="1" d="M8 92 C40 88 52 70 80 72 S120 50 140 52 S185 26 232 14"/><circle class="ia-dot" cx="232" cy="14" r="5"/></svg>' +
        '<div class="ia-badge">' + ICON.trophy + '<span>Neuer Rekord: 85 kg</span></div></div>',
    },
    {
      title: 'Ernährung & 200+ Übungen',
      text: 'Kalorien und Makros per Barcode scannen und über 200 Übungen mit Anleitung entdecken – alles in einer App.',
      art: '<div class="ia-card ia-food"><svg class="ia-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" class="ia-ring-bg"/>' +
        '<circle cx="60" cy="60" r="50" class="ia-ring-fg" pathLength="1" transform="rotate(-90 60 60)"/><text x="60" y="66">1.840</text></svg>' +
        '<div class="ia-chips"><span>' + ICON.scan + ' Scannen</span><span>' + ICON.dumbbell + ' Bibliothek</span></div></div>',
    },
  ];

  function renderIntro(view) {
    setHeader({ title: 'Willkommen', hidden: true });
    const n = INTRO_SLIDES.length;
    view.innerHTML =
      '<div class="intro">' +
        '<button class="intro-skip" data-action="intro-done">Überspringen</button>' +
        '<div class="intro-track" id="intro-track">' +
          INTRO_SLIDES.map((s, i) => '<section class="intro-slide' + (i === 0 ? ' on' : '') + '" aria-label="' + (i + 1) + ' von ' + n + '">' +
            '<div class="intro-art">' + s.art + '</div>' +
            '<h1 class="intro-title">' + esc(s.title) + '</h1><p class="intro-text">' + esc(s.text) + '</p></section>').join('') +
        '</div>' +
        '<div class="intro-foot">' +
          '<div class="intro-dots" aria-hidden="true">' + INTRO_SLIDES.map((_, i) => '<i class="' + (i === 0 ? 'on' : '') + '"></i>').join('') + '</div>' +
          '<button class="btn primary block lg" id="intro-next" data-action="intro-next">Weiter</button>' +
        '</div>' +
      '</div>';
    const track = $('#intro-track', view);
    const slides = $$('.intro-slide', view);
    const dots = $$('.intro-dots i', view);
    const next = $('#intro-next', view);
    let raf = 0, cur = 0;
    const update = () => {
      raf = 0;
      const w = track.clientWidth || 1;
      const pos = track.scrollLeft / w;
      // Leichter Parallax-Effekt: Illustrationen bewegen sich langsamer als der Text
      slides.forEach((s, i) => {
        const d = i - pos;
        const art = s.firstElementChild;
        if (!reduced()) art.style.transform = Math.abs(d) < 1.2 ? 'translateX(' + (d * 38).toFixed(1) + '%) scale(' + (1 - Math.min(1, Math.abs(d)) * 0.12).toFixed(3) + ')' : '';
        art.style.opacity = String(Math.max(0, 1 - Math.abs(d) * 1.2).toFixed(3));
      });
      const idx = Math.max(0, Math.min(slides.length - 1, Math.round(pos)));
      if (idx !== cur) {
        cur = idx;
        slides.forEach((s, i) => s.classList.toggle('on', i === idx));
        dots.forEach((d, i) => d.classList.toggle('on', i === idx));
        next.textContent = idx === slides.length - 1 ? 'Los geht’s' : 'Weiter';
      }
    };
    track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }

  function finishIntro() {
    lsSet(INTRO_KEY, '1');
    location.replace('#/login');
  }

  /* ---------- Einrichtung nach dem Registrieren / „Ohne Konto“ ---------- */

  const SETUP_STEPS = 4;

  function startSetup() {
    ui.setup = {
      step: 0,
      goal: db.settings.weeklyGoal || 3,
      start: 'sample',
      kcal: db.settings.calorieGoal || 2000,
      dir: 1,
    };
    go('#/setup');
  }

  function renderSetup(view) {
    if (!ui.setup) { ui.setup = { step: 0, goal: db.settings.weeklyGoal || 3, start: 'sample', kcal: db.settings.calorieGoal || 2000, dir: 1 }; }
    const st = ui.setup;
    setHeader({ title: 'Einrichtung', hidden: true });
    const bar = Array.from({ length: SETUP_STEPS }, (_, i) => '<i class="' + (i <= st.step ? 'on' : '') + '"></i>').join('');
    let body = '';
    let cta = 'Weiter';
    if (st.step === 0) {
      body =
        '<div class="setup-icon">' + ICON.cal + '</div>' +
        '<h1 class="setup-title">Wie oft willst du trainieren?</h1>' +
        '<p class="setup-text">Dein Wochenziel. Schaffst du es mehrere Wochen am Stück, wächst deine Serie. Du kannst es jederzeit ändern.</p>' +
        '<div class="setup-goal">' + [1, 2, 3, 4, 5, 6, 7].map((n) =>
          '<button class="goal-tile' + (st.goal === n ? ' on' : '') + '" data-action="setup-goal" data-value="' + n + '"><b>' + n + '×</b></button>').join('') + '</div>' +
        '<p class="setup-note">' + (st.goal <= 2 ? 'Guter Einstieg – Hauptsache regelmäßig.' : st.goal <= 4 ? 'Ideal für die meisten Trainingspläne.' : 'Ambitioniert – plane genug Erholung ein.') + '</p>';
    } else if (st.step === 1) {
      const opt = (key, title, sub, icon) => '<button class="setup-opt' + (st.start === key ? ' on' : '') + '" data-action="setup-start" data-value="' + key + '">' +
        '<span class="setup-opt-ic">' + icon + '</span><span class="setup-opt-text"><b>' + title + '</b><small>' + sub + '</small></span>' +
        '<span class="setup-radio" aria-hidden="true"></span></button>';
      body =
        '<div class="setup-icon">' + ICON.dumbbell + '</div>' +
        '<h1 class="setup-title">Womit startest du?</h1>' +
        '<p class="setup-text">Du kannst alles später anpassen, umbenennen oder löschen.</p>' +
        '<div class="setup-opts">' +
          opt('sample', 'Push · Pull · Beine', 'Fertiger Plan mit 3 Trainingstagen', ICON.list) +
          opt('own', 'Eigenen Plan erstellen', 'Du legst Tage und Übungen selbst an', ICON.edit) +
          opt('import', 'Geteilten Plan einfügen', 'Link von Freunden übernehmen', ICON.share) +
        '</div>';
    } else if (st.step === 2) {
      body =
        '<div class="setup-icon">' + ICON.target + '</div>' +
        '<h1 class="setup-title">Dein Kalorienziel</h1>' +
        '<p class="setup-text">Für den Kalorienring in „Ernährung“. Keine Ahnung? Nimm erst mal 2.000 kcal – du kannst es jederzeit ändern.</p>' +
        '<div class="setup-kcal"><b id="setup-kcal-val">' + fmtInt(st.kcal) + '</b><span>kcal pro Tag</span></div>' +
        '<div class="setup-kcal-row">' +
          '<button class="tbtn" data-action="setup-kcal" data-delta="-100" aria-label="100 kcal weniger">−100</button>' +
          '<input class="setup-range" id="setup-range" type="range" min="1200" max="4000" step="50" value="' + st.kcal + '" aria-label="Kalorienziel">' +
          '<button class="tbtn" data-action="setup-kcal" data-delta="100" aria-label="100 kcal mehr">+100</button>' +
        '</div>' +
        '<div class="chips setup-presets">' + [1800, 2000, 2200, 2500, 2800].map((k) =>
          '<button class="chip' + (st.kcal === k ? ' on' : '') + '" data-action="setup-kcal-set" data-value="' + k + '">' + fmtInt(k) + '</button>').join('') + '</div>';
    } else {
      cta = 'Fertig';
      const tips = [];
      if (isIOS && !isStandalone()) {
        tips.push('<div class="setup-tip"><span class="setup-opt-ic">' + ICON.share + '</span><span class="setup-opt-text"><b>Zum Home-Bildschirm hinzufügen</b>' +
          '<small>In Safari auf <em>Teilen</em> → <em>Zum Home-Bildschirm</em>. Dann startet die App im Vollbild und der Pausentimer kann dich benachrichtigen.</small></span></div>');
      }
      if (Notify.supported && Notify.permission === 'default') {
        tips.push('<button class="setup-tip setup-opt" data-action="setup-notif"><span class="setup-opt-ic">' + ICON.clock + '</span><span class="setup-opt-text"><b>Benachrichtigungen erlauben</b>' +
          '<small>Damit du das Ende der Satzpause mitbekommst.</small></span>' + ICON.chevron + '</button>');
      } else if (Notify.permission === 'granted') {
        tips.push('<div class="setup-tip"><span class="setup-opt-ic">' + ICON.done + '</span><span class="setup-opt-text"><b>Benachrichtigungen sind an</b><small>Du wirst ans Pausenende erinnert.</small></span></div>');
      }
      tips.push('<div class="setup-tip"><span class="setup-opt-ic">' + ICON.check + '</span><span class="setup-opt-text"><b>So geht’s im Training</b>' +
        '<small>Satz abhaken → Pause startet. +/− gedrückt halten zählt schneller. Nach links wischen löscht, mit „Rückgängig“.</small></span></div>');
      body =
        '<div class="setup-icon setup-icon-done">' + ICON.done + '</div>' +
        '<h1 class="setup-title">Alles bereit!</h1>' +
        '<p class="setup-text">Noch ein paar Tipps, damit alles rund läuft:</p>' +
        '<div class="setup-opts">' + tips.join('') + '</div>';
    }
    view.innerHTML =
      '<div class="setup">' +
        '<div class="setup-top">' +
          (st.step > 0 ? '<button class="hdr-btn" data-action="setup-back" aria-label="Zurück">' + ICON.back + '</button>' : '<span class="setup-top-sp"></span>') +
          '<div class="setup-progress" aria-label="Schritt ' + (st.step + 1) + ' von ' + SETUP_STEPS + '">' + bar + '</div>' +
          '<button class="setup-skip" data-action="setup-skip">Später</button>' +
        '</div>' +
        '<div class="setup-body" id="setup-body">' + body + '</div>' +
        '<div class="setup-foot"><button class="btn primary block lg" data-action="setup-next">' + cta + '</button></div>' +
      '</div>';
    const range = $('#setup-range', view);
    if (range) {
      range.addEventListener('input', () => {
        st.kcal = Number(range.value);
        $('#setup-kcal-val').textContent = fmtInt(st.kcal);
        $$('.setup-presets .chip', view).forEach((c) => c.classList.toggle('on', Number(c.dataset.value) === st.kcal));
      });
    }
    if (st.animate && !reduced()) {
      anim($('#setup-body', view), [{ opacity: 0, transform: 'translateX(' + (st.dir * 40) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE.sheet });
    }
    st.animate = false;
  }

  function setupStep(delta) {
    const st = ui.setup;
    st.dir = delta;
    st.animate = true;
    st.step = Math.max(0, Math.min(SETUP_STEPS - 1, st.step + delta));
    Haptics.tap();
    render();
  }

  /** Einrichtung übernehmen (nur bestehende Einstellungen + optional Beispielplan). */
  function finishSetup(skip) {
    const st = ui.setup;
    ui.setup = null;
    if (!skip && st) {
      db.settings.weeklyGoal = st.goal;
      db.settings.calorieGoal = st.kcal;
      if (st.start === 'sample' && !db.days.length) db.days.push(...Core.sampleDays());
      save();
    }
    location.replace('#/');
    if (skip || !st || st.start === 'sample') Social.maybeOnboard();
    if (skip || !st) return;
    if (st.start === 'sample') toast('Plan „Push · Pull · Beine“ angelegt');
    else if (st.start === 'own') setTimeout(() => actions['add-day'](), 450);
    else if (st.start === 'import') setTimeout(() => actions['import-paste'](), 450);
  }

  /** Nach Registrierung bzw. „Ohne Konto“: Einrichtung nur bei leerem Konto anbieten. */
  const isFreshData = () => !db.days.length && !db.sessions.length;

  /* ---------- Ansicht: Anmelden / Konto erstellen ---------- */


  function renderLogin(view) {
    const reg = ui.authMode === 'register';
    // Ohne Konto unterwegs und über die Einstellungen hierher gekommen → Zurück-Knopf
    if (account) setHeader({ title: 'Konto', back: '#/settings/account' });
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
        <h1 class="auth-title">${reg ? 'Konto erstellen' : 'Willkommen'}</h1>
        <p class="auth-sub">${reg
          ? 'Erstelle ein Konto – deine Trainings werden dann sicher in der Cloud gespeichert und sind auf all deinen Geräten verfügbar.'
          : 'Melde dich an, um deine Trainingsdaten zu laden und zu speichern.'}</p>
        ${reg ? `<div class="auth-perks">
          <div>${ICON.reload}<span><b>Auf allen Geräten</b>iPhone, iPad und Computer bleiben automatisch synchron.</span></div>
          <div>${ICON.done}<span><b>Sicher gespeichert</b>Deine Trainings gehen nicht verloren, auch wenn Safari Daten löscht.</span></div>
        </div>` : ''}
        <button class="btn apple block lg" data-action="auth-apple">${APPLE_LOGO}Mit Apple ${reg ? 'registrieren' : 'anmelden'}</button>
        <p class="form-error" id="apple-error" role="alert" hidden></p>
        <div class="divider"><span>oder mit E-Mail</span></div>
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
      'auth/popup-blocked': 'Das Anmeldefenster wurde blockiert. Bitte erneut tippen.',
      'auth/account-exists-with-different-credential': 'Für diese E-Mail gibt es schon ein Konto mit Passwort – bitte mit E-Mail und Passwort anmelden.',
      'auth/user-mismatch': 'Bitte bestätige mit demselben Apple-Konto, mit dem du angemeldet bist.',
      'username-taken': 'Dieser Benutzername ist leider schon vergeben.',
      'deadline-exceeded': 'Der Server antwortet nicht. Bitte später erneut versuchen.',
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
      ui.afterRegister = reg;
      if (reg) await window.GymCloud.signUp(email, pw);
      else await window.GymCloud.signIn(email, pw);
    } catch (e) {
      ui.afterRegister = false;
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
      // Nach dem Abmelden liegen die Daten dieses Kontos „ohne Konto“ auf dem Gerät → einfach wieder übernehmen
      if (wasGuest && Sync.hasUserContent(guestDb) && lsGet(GUEST_FROM_KEY) === user.uid) {
        migrate = true;
      } else if (wasGuest && Sync.hasUserContent(guestDb)) {
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
      lsDel(GUEST_FROM_KEY);
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
      Social.attach();
      ui.socialOnboard = true; // nach dem Anmelden: Profil (Benutzername, Foto) anlegen lassen, falls noch keins
      startSync();
      Wake.update();
      ui.authEmail = '';
      if ((ui.afterRegister || user.isNew) && isFreshData()) startSetup();
      else { go('#/'); toast('Angemeldet' + (user.email ? ' als ' + user.email : '')); }
      ui.afterRegister = false;
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
    Social.connect();
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

  /**
   * Abmelden bzw. Konto verlassen. Die Trainingsdaten bleiben auf dem Gerät: Sie wandern in den
   * Speicher „ohne Konto“. Entfernt werden nur die Kontokopie, der Abgleich-Stand und die
   * zwischengespeicherten Freundesdaten.
   */
  async function leaveAccount() {
    stopSync();
    const uid = account && account.uid;
    const accountDb = db;
    Social.detach();
    account = null;           // vor signOut, damit onAuthState(null) nichts mehr tut
    saveAccount();
    if (window.GymCloud) { try { await window.GymCloud.signOut(); } catch (e) { /* offline egal */ } }
    const guest = loadData(STORAGE_KEY, Core.emptyData);
    const guestWasEmpty = Sync.isEmpty(guest);
    db = Sync.mergeGuest(guest, accountDb);
    writeLocal();
    if (uid) {
      lsDel(STORAGE_KEY + '.u.' + uid);
      lsDel(SYNC_PREFIX + uid);
      Social.forget(uid);
      // Beim nächsten Anmelden mit demselben Konto ohne Rückfrage wieder übernehmen
      if (guestWasEmpty) lsSet(GUEST_FROM_KEY, uid); else lsDel(GUEST_FROM_KEY);
    }
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
          <p class="kv"><span>Angemeldet als</span><span class="break">${esc(account.email || 'Apple-ID')}</span></p>
          ${Social.profile && Social.profile.username ? `<p class="kv"><span>Benutzername</span><a href="#/profile">@${esc(Social.profile.username)}</a></p>` : ''}
          <p class="kv"><span>Cloud</span><span id="sync-status">${esc(syncStatusText())}</span></p>
          <p class="kv"><span>Nutzer-ID</span><button class="uid-btn" data-action="copy-uid" aria-label="Nutzer-ID kopieren">${esc(account.uid)}</button></p>
          <p class="hint">Deine Daten werden in deinem Konto gespeichert und auf allen Geräten abgeglichen, auf denen du angemeldet bist. Offline eingetragene Sätze werden automatisch nachgeladen.</p>
          <div class="btn-row">
            <button class="btn soft" data-action="sync-now">Jetzt abgleichen</button>
            <button class="btn soft" data-action="logout">Abmelden</button>
          </div>
          <button class="btn ghost block danger-text" data-action="delete-account">Konto und alle Cloud-Daten löschen</button>
          <p class="hint">Löscht Konto, Profil, Freundschaften, geteilte Kennzahlen und die Cloud-Sicherung. Die Trainingsdaten auf diesem Gerät bleiben erhalten; der Export unter „Datensicherung“ funktioniert jederzeit auch ohne Konto.</p>
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
        actions: `<button class="hdr-btn" data-action="admin-reload" aria-label="Neu laden">${ICON.reload}</button>` });
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
        <label class="search">${ICON.search}<input class="in" id="admin-search" type="search" placeholder="Nach E-Mail suchen" value="${esc(a.filter)}" autocomplete="off" autocapitalize="off"></label>
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

  /** Menüzeile mit Icon-Kachel, die in eine Unterseite führt (wie in den iOS-Einstellungen). */
  function menuRow(href, icon, label, value, sub) {
    return `
      <a class="row menu-row" href="${href}">
        <span class="row-ic" aria-hidden="true">${icon}</span>
        <span class="row-text"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</span>
        <span class="row-value">${value || ''} ${ICON.chevron}</span>
      </a>`;
  }

  const SETTINGS_PAGES = {
    account: 'Konto',
    training: 'Training & Timer',
    nutrition: 'Ernährung',
    notifications: 'Benachrichtigungen & Ton',
    appearance: 'Darstellung',
    backup: 'Datensicherung',
    data: 'Daten',
  };

  function renderSettings(view, sub) {
    if (sub && !SETTINGS_PAGES[sub]) { go('#/settings'); return; }
    if (sub) setHeader({ title: SETTINGS_PAGES[sub], back: '#/settings' });
    else setHeader({ title: 'Einstellungen', large: true, back: '#/profile' });
    const st = db.settings;
    const perm = Notify.permission;
    const permText = {
      granted: '<span class="accent">erlaubt</span>',
      denied: '<span class="danger-text">blockiert</span>',
      default: 'noch nicht gefragt',
      unsupported: 'hier nicht verfügbar',
    }[perm];
    const permShort = { granted: 'An', denied: 'Blockiert', default: 'Aus', unsupported: '–' }[perm];
    const lastBackup = st.lastBackup ? fmtRelative(st.lastBackup, Date.now()) + ' (' + fmtDate(st.lastBackup) + ')' : 'noch nie';
    const backupOld = !isUser() && (!st.lastBackup || Date.now() - st.lastBackup > 7 * 86400000);
    const themeLabel = { dark: 'Dunkel', light: 'Hell', system: 'System' }[st.theme] || 'Dunkel';

    /* ---------- Hauptseite ---------- */
    if (!sub) {
      const name = isUser() ? account.email : 'Ohne Konto';
      const initial = isUser() ? esc((account.email || '?').trim().charAt(0).toUpperCase()) : svgI('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>');
      view.innerHTML = `
        <a class="profile-card" href="#/settings/account">
          <span class="profile-avatar" aria-hidden="true">${initial}</span>
          <span class="profile-text">
            <b class="break">${esc(name)}</b>
            <small id="sync-status">${isUser() ? esc(syncStatusText()) : 'Daten nur auf diesem Gerät · Anmelden'}</small>
          </span>
          ${ICON.chevron}
        </a>
        ${ui.isAdmin && isUser() ? `<section class="card flush">${menuRow('#/admin', svgI('<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M16 7.5h5M18.5 5v5"/>'), 'Nutzerverwaltung', '', 'Alle Konten verwalten')}</section>` : ''}
        <section class="card flush">
          ${menuRow('#/settings/training', ICON.dumbbell, 'Training & Timer', fmtRest(st.defaultRest), 'Pause, Gewichtsschritt, Wochenziel')}
          ${menuRow('#/settings/nutrition', ICON.target, 'Ernährung', st.calorieGoal ? fmtInt(st.calorieGoal) + ' kcal' : '–', 'Kalorien- und Makroziele')}
          ${menuRow('#/settings/notifications', ICON.clock, 'Benachrichtigungen & Ton', permShort, 'Signalton, Haptik, Pausen-Hinweis')}
          ${menuRow('#/settings/appearance', svgI('<circle cx="12" cy="12" r="8"/><path class="fill" d="M12 4a8 8 0 0 1 0 16z"/>'), 'Darstellung', themeLabel)}
        </section>
        <section class="card flush">
          ${menuRow('#/settings/backup', ICON.inbox, 'Datensicherung', backupOld ? ICON.warn : '', isUser() ? 'In der Cloud · Export als Datei' : 'Letztes Backup: ' + lastBackup)}
          ${menuRow('#/settings/data', ICON.list, 'Daten', `${db.days.length} Tage`, `${db.sessions.length} Einheiten gespeichert`)}
        </section>
        <p class="hint center">Gym Tracker · ${isUser() ? 'Daten in deinem Konto gespeichert.' : 'Daten bleiben nur auf diesem Gerät.'}</p>`;
      return;
    }

    /* ---------- Unterseiten ---------- */
    let html = '';
    if (sub === 'account') {
      html = accountSection();
    } else if (sub === 'training') {
      html = `
        <p class="section-label">Training</p>
        <section class="card flush">
          <button class="row" data-action="increment">
            <span class="row-text"><span>Gewichtsschritt</span><small>für Steigerungsvorschläge und die +/− Buttons</small></span>
            <span class="row-value">${fmtNum(st.increment)} kg ${ICON.chevron}</span>
          </button>
          <button class="row" data-action="weekly-goal">
            <span class="row-text"><span>Wochenziel</span><small>Trainings pro Woche – für Serie &amp; Kalender</small></span>
            <span class="row-value">${st.weeklyGoal}× ${ICON.chevron}</span>
          </button>
        </section>
        <p class="section-label">Pausentimer</p>
        <section class="card flush">
          <button class="row" data-action="default-rest">
            <span class="row-text"><span>Standardpause</span><small>für neue Übungen</small></span>
            <span class="row-value">${fmtRest(st.defaultRest)} ${ICON.chevron}</span>
          </button>
          <a class="row" href="#/settings/notifications">
            <span class="row-text"><span>Signalton &amp; Benachrichtigung</span><small>am Ende der Pause</small></span>
            <span class="row-value">${ICON.chevron}</span>
          </a>
        </section>
        <p class="section-label">Anstrengung pro Satz</p>
        <section class="card">
          <div class="segmented" role="radiogroup" aria-label="Anstrengung erfassen">
            ${[['off', 'Aus'], ['rir', 'RIR'], ['rpe', 'RPE']].map(([v, l]) => `
              <button role="radio" aria-checked="${st.effort === v}" aria-selected="${st.effort === v}" data-action="effort" data-value="${v}">${l}</button>`).join('')}
          </div>
          <p class="hint"><b>RIR</b> („Reps in Reserve“): Wie viele Wiederholungen wären noch gegangen? 0 = bis zum Versagen.
            <b>RPE</b>: gefühlte Anstrengung von 1 bis 10 (10 = Maximum). Das Feld erscheint im Training neben der Notiz.</p>
        </section>`;
    } else if (sub === 'nutrition') {
      html = `
        <p class="section-label">Tagesziele</p>
        <section class="card flush">
          <button class="row" data-action="edit-goal" data-key="calorieGoal"><span class="row-text"><span>Kalorienziel</span></span><span class="row-value">${st.calorieGoal ? st.calorieGoal + ' kcal' : '–'} ${ICON.chevron}</span></button>
          <button class="row" data-action="edit-goal" data-key="proteinGoal"><span class="row-text"><span>Protein-Ziel</span></span><span class="row-value">${st.proteinGoal ? st.proteinGoal + ' g' : '–'} ${ICON.chevron}</span></button>
          <button class="row" data-action="edit-goal" data-key="carbGoal"><span class="row-text"><span>Kohlenhydrat-Ziel</span></span><span class="row-value">${st.carbGoal ? st.carbGoal + ' g' : '–'} ${ICON.chevron}</span></button>
          <button class="row" data-action="edit-goal" data-key="fatGoal"><span class="row-text"><span>Fett-Ziel</span></span><span class="row-value">${st.fatGoal ? st.fatGoal + ' g' : '–'} ${ICON.chevron}</span></button>
        </section>
        <p class="hint">Die Ziele bestimmen den Kalorienring und die Makro-Balken im Reiter „Ernährung“.</p>`;
    } else if (sub === 'notifications') {
      html = `
        <p class="section-label">Ton &amp; Haptik</p>
        <section class="card flush">
          ${switchRow('sound', 'Signalton', 'Piept, wenn die Pause vorbei ist')}
          ${switchRow('vibrate', 'Vibration & Haptik', isIOS ? 'Leichtes Tippen beim Abhaken (iPhone ab iOS 18)' : 'Beim Abhaken und am Ende der Pause')}
          ${'audioSession' in navigator ? switchRow('loudMode', 'Ton trotz Lautlos-Schalter', 'Kann laufende Musik unterbrechen') : ''}
          <button class="row" data-action="test-sound">
            <span class="row-text"><span>Ton testen</span></span><span class="row-value">${ICON.play}</span>
          </button>
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
        </section>`;
    } else if (sub === 'appearance') {
      html = `
        <p class="section-label">Design</p>
        <section class="card">
          <div class="theme-previews">
            ${[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'System']].map(([v, l]) => `
              <button class="theme-pick${st.theme === v ? ' on' : ''}" data-action="theme" data-value="${v}" aria-pressed="${st.theme === v}">
                <span class="theme-mock ${v}" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="theme-name">${l}</span>
                <span class="setup-radio" aria-hidden="true"></span>
              </button>`).join('')}
          </div>
          <p class="hint">„System“ folgt automatisch der Einstellung deines iPhones (Hell/Dunkel).</p>
        </section>`;
    } else if (sub === 'backup') {
      html = `
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
        </section>`;
    } else if (sub === 'data') {
      html = `
        <section class="card flush">
          <button class="row" data-action="load-sample"><span class="row-text"><span>Beispiel-Trainingstage hinzufügen</span><small>Push, Pull, Beine</small></span><span class="row-value">${ICON.plus}</span></button>
        </section>
        <section class="card flush">
          <button class="row danger-text" data-action="reset"><span class="row-text"><span>Alle Daten löschen</span><small>${isUser() ? 'Aus deinem Konto – auf allen Geräten' : 'Von diesem Gerät'}</small></span><span class="row-value">${ICON.trash}</span></button>
        </section>
        <p class="hint">Tipp: Vor dem Löschen ein Backup unter „Datensicherung“ exportieren.</p>`;
    }
    view.innerHTML = html;
  }

  /* =========================================================
   *  v2-Oberfläche: Ernährung & Übungsbibliothek
   * ========================================================= */

  Object.assign(ICON, {
    scan: svgI('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 8.5v7M11 8.5v7M14 8.5v7M17 8.5v7"/>'),
    star: svgI('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    search: svgI('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),
    dumbbell: svgI('<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'),
    list: svgI('<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />'),
    pencil: svgI('<path d="M4.5 19.5h4l10.5-10.5-4-4L4.5 15.5z"/>'),
  });

  /* Muskelgruppen als Linien-Icons (Bibliothek) */
  const MUSCLE_ICON = {
    'Brust': svgI('<path d="M12 7.5c-1.2-1.6-3-2.2-5-1.8-1.9.4-2.8 2-2.5 4 .3 2.2 1.6 4.3 4 4.8 1.4.3 2.6-.2 3.5-1.2.9 1 2.1 1.5 3.5 1.2 2.4-.5 3.7-2.6 4-4.8.3-2-.6-3.6-2.5-4-2-.4-3.8.2-5 1.8zM12 7.5v5"/>'),
    'Rücken': svgI('<path d="M5 4.5l3 15h8l3-15M12 4.5v15M8 9.5c1.5.8 2.7 1.2 4 1.2s2.5-.4 4-1.2"/>'),
    'Schultern': svgI('<path d="M3.5 15c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5M8.5 8.4a3.5 3.5 0 0 1 7 0M3.5 15h3.5M17 15h3.5"/>'),
    'Bizeps': svgI('<path d="M5 19.5c0-5 1.3-9.5 4.5-12l2.2 3c-1 1-1 3 0 4 2-2 6-2.2 8 .8v4.2z"/>'),
    'Trizeps': svgI('<path d="M8 3.5v10a4 4 0 0 0 8 0v-10M12 3.5v6"/>'),
    'Beine': svgI('<path d="M8 3.5 7 12l1 8.5M16 3.5l1 8.5-1 8.5M8 3.5h8M12 3.5v6"/>'),
    'Gesäß': svgI('<path d="M4 10.5C4 7.5 7 5.5 12 7c5-1.5 8 .5 8 3.5 0 5-3.5 8-8 8s-8-3-8-8zM12 7v11.5"/>'),
    'Waden': svgI('<path d="M9.5 3.5c-3 5-3 10.5 0 17M14.5 3.5c3 5 3 10.5 0 17M9.5 20.5h5"/>'),
    'Bauch': svgI('<rect x="7.5" y="3.5" width="9" height="17" rx="3"/><path d="M7.5 9h9M7.5 14.5h9M12 3.5v17"/>'),
    'Unterarme': svgI('<path d="M3.5 17.5l9.5-6.5M13 11l2.8-1 3 2-.8 3-3 1.2-2-2.2M3.5 17.5l2 2.5 9.5-6"/>'),
    'Ganzkörper': svgI('<circle cx="12" cy="4.8" r="2"/><path d="M12 7.5v7M6.5 10.5h11M12 14.5l-3.5 6M12 14.5l3.5 6"/>'),
  };
  const muscleIcon = (m) => MUSCLE_ICON[m] || ICON.dumbbell;

  const MEAL_LABEL = { breakfast: 'Frühstück', lunch: 'Mittag', dinner: 'Abend', snack: 'Snacks' };

  /* ---------- Übungsbibliothek laden ---------- */

  let LIB = [];
  let libLoaded = false;

  function allExercises() { return LIB.concat(db.customExercises); }
  function libById(id) { return LIB.find((x) => x.id === id) || Core.customExerciseById(db, id) || null; }

  async function loadLibrary() {
    if (libLoaded) return;
    try {
      const res = await fetch('exercises.json', { cache: 'force-cache' });
      const data = await res.json();
      LIB = Array.isArray(data && data.exercises) ? data.exercises : [];
    } catch (e) { LIB = []; }
    libLoaded = true;
    // Bestehende Trainingstage nachträglich mit der Bibliothek verknüpfen (feste ID)
    if (Core.linkPlanToLibrary(db, LIB)) save();
    const n = parseRoute().name;
    if (n === 'library' || n === 'libex' || n === 'day' || n === 'workout' || SOCIAL_ROUTES.has(n)) render();
    Social.schedulePublish(500);
  }

  /* ---------- Allgemeine Modal-Hülle für interaktive Formulare ---------- */

  /**
   * Übergabe zwischen zwei Sheets (z. B. Lade-Skeleton → Ergebnis): Das nächste
   * customModal ersetzt das wartende Sheet an Ort und Stelle, ohne neu hochzufahren.
   */
  let sheetHandoff = null;

  function customModal(inner, opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'modal' + (o.full ? ' modal-full' : '') + (o.scanner ? ' modal-scanner' : '');
    wrap.innerHTML = '<div class="modal-backdrop" data-close></div><div class="modal-card" role="dialog" aria-modal="true">' + inner + '</div>';
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    let closed = false;
    let sheet = null;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.classList.add('closing');
      if (sheet) sheet.hide(() => wrap.remove()); else wrap.remove();
      if (o.onClose) o.onClose();
    }
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    const prev = !o.scanner && sheetHandoff && !sheetHandoff.isClosed() ? sheetHandoff : null;
    sheetHandoff = null;
    $('#modal-root').appendChild(wrap);
    if (prev) prev.dispose();
    sheet = presentSheet(wrap, close, { fullscreen: !!o.scanner, handoff: !!prev });
    return { wrap, card: wrap.querySelector('.modal-card'), close, isClosed: () => closed };
  }

  /** Lade-Sheet mit Skeleton, das vom nächsten customModal nahtlos ersetzt wird. */
  function loadingSheet(title) {
    const m = customModal(
      '<h2 class="modal-title">' + esc(title) + '</h2>' +
      '<div class="sk sk-line" style="width:40%;margin:6px 0 16px"></div>' +
      '<div class="pn-grid">' + '<div class="sk" style="height:58px"></div>'.repeat(4) + '</div>' +
      '<div class="sk" style="height:48px;margin-bottom:12px"></div>' +
      '<div class="sk" style="height:48px;margin-bottom:16px"></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Abbrechen</button><div class="btn sk" style="flex:1"></div></div>');
    let disposed = false;
    const handle = {
      isClosed: () => disposed || m.isClosed(),
      dispose() { disposed = true; openSheets.delete(m.wrap); syncModalClass(); m.wrap.remove(); },
    };
    sheetHandoff = handle;
    return handle;
  }

  /* ---------- Ansicht: Ernährung ---------- */

  function shiftDayKey(key, delta) {
    const p = key.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2] + delta, 12);
    return Core.dayKey(d.getTime());
  }

  function macroBar(label, value, goal, cls) {
    const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : 0;
    return '<div class="macro">' +
      '<div class="macro-head"><span>' + label + '</span><span><b class="count-up" data-to="' + Math.round(value) + '" style="font-weight:600">' + fmtNum(Math.round(value)) + '</b>' + (goal ? ' / ' + goal : '') + ' g</span></div>' +
      '<div class="macro-track"><div class="macro-fill ' + cls + '" data-pct="' + pct + '" style="transform:translateX(' + (pct - 100) + '%)"></div></div></div>';
  }

  /** Streifen der letzten 14 Tage (Scroll-Snap) – Tippen wählt den Tag. */
  function dateStripHTML(sel, today) {
    const withData = new Set(db.nutrition.map((n) => n.date));
    let html = '';
    for (let i = 13; i >= 0; i--) {
      const k = shiftDayKey(today, -i);
      const p = k.split('-').map(Number);
      const d = new Date(p[0], p[1] - 1, p[2], 12);
      html += '<button class="strip-day' + (k === sel ? ' sel' : '') + (k === today ? ' today' : '') + '" data-action="food-date" data-key="' + k + '"' +
        ' aria-label="' + esc(fmtLongDate(d.getTime())) + '"' + (k === sel ? ' aria-current="date"' : '') + '>' +
        '<small>' + d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') + '</small><b>' + d.getDate() + '</b>' +
        (withData.has(k) ? '<i></i>' : '') + '</button>';
    }
    return '<div class="date-strip" id="date-strip">' + html + '</div>';
  }

  function renderFood(view) {
    setHeader({ title: 'Ernährung', large: true });
    if (!ui.foodDate) ui.foodDate = Core.dayKey(Date.now());
    const key = ui.foodDate;
    const today = Core.dayKey(Date.now());
    const parts = key.split('-').map(Number);
    const ts = new Date(parts[0], parts[1] - 1, parts[2], 12).getTime();
    const dLabel = key === today ? 'Heute' : (key === shiftDayKey(today, -1) ? 'Gestern' : fmtLongDate(ts));

    const t = Core.dayTotals(db, key);
    const goal = db.settings.calorieGoal;
    const pct = goal ? Math.min(1, t.kcal / goal) : 0;
    const R = 52, C = 2 * Math.PI * R;
    const ring = '<svg class="cal-ring" viewBox="0 0 120 120" role="img" aria-label="Kalorien heute">' +
      '<circle cx="60" cy="60" r="' + R + '" class="ring-bg"/>' +
      '<circle cx="60" cy="60" r="' + R + '" class="ring-fg" id="ring-fg" data-off="' + (C * (1 - pct)).toFixed(1) + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="58" class="ring-num count-up" data-to="' + Math.round(t.kcal) + '">' + fmtInt(Math.round(t.kcal)) + '</text>' +
      '<text x="60" y="76" class="ring-sub">' + (goal ? '/ ' + fmtInt(goal) + ' kcal' : 'kcal') + '</text></svg>';
    const remaining = goal ? goal - t.kcal : null;

    const meals = MEALS.map((meal) => {
      const entries = Core.nutritionForDay(db, key).filter((n) => n.meal === meal);
      const sum = entries.reduce((a, n) => a + (n.kcal || 0), 0);
      const rows = entries.map((n) => '' +
        '<div class="food-row" data-action="food-edit" data-id="' + esc(n.id) + '" data-flip="n-' + esc(n.id) + '" data-swipe="food:' + esc(n.id) + '" role="button" tabindex="0">' +
          '<div class="fr-main"><div class="fr-name">' + esc(n.name || 'Eintrag') + '</div>' +
          '<div class="fr-sub">' + (n.grams !== null ? fmtNum(n.grams) + ' g · ' : '') +
            [n.protein !== null ? 'E ' + fmtNum(n.protein) : '', n.carbs !== null ? 'K ' + fmtNum(n.carbs) : '', n.fat !== null ? 'F ' + fmtNum(n.fat) : ''].filter(Boolean).join(' · ') + '</div></div>' +
          '<div class="fr-kcal">' + (n.kcal !== null ? fmtInt(Math.round(n.kcal)) + ' kcal' : '–') + '</div>' +
          '<button class="icon-btn sm danger" data-action="food-del" data-id="' + esc(n.id) + '" aria-label="Eintrag löschen">' + ICON.trash + '</button>' +
        '</div>').join('');
      return '<section class="card meal" data-flip="meal-' + meal + '">' +
        '<div class="meal-head"><h2>' + MEAL_LABEL[meal] + '</h2><span class="meal-sum">' + (sum ? fmtInt(Math.round(sum)) + ' kcal' : '') + '</span></div>' +
        (rows || '<p class="meal-empty">Noch nichts eingetragen.</p>') +
        '<button class="btn soft block sm" data-flip="madd-' + meal + '" data-action="food-add" data-meal="' + meal + '">' + ICON.plus + ' Hinzufügen</button>' +
      '</section>';
    }).join('');

    view.innerHTML =
      '<div class="date-nav">' +
        '<button class="icon-btn" data-action="food-prev" aria-label="Vorheriger Tag">' + ICON.back + '</button>' +
        '<button class="date-label" data-action="food-today">' + dLabel + '</button>' +
        '<button class="icon-btn" data-action="food-next" aria-label="Nächster Tag" ' + (key >= today ? 'disabled' : '') + '>' + ICON.chevron + '</button>' +
      '</div>' +
      dateStripHTML(key, today) +
      '<section class="card cal-card">' +
        ring +
        '<div class="cal-side">' +
          (goal ? '<div class="cal-remain ' + (remaining < 0 ? 'over' : '') + '"><strong class="count-up" data-to="' + Math.abs(Math.round(remaining)) + '">' + fmtInt(Math.abs(Math.round(remaining))) + '</strong><small>kcal ' + (remaining < 0 ? 'drüber' : 'übrig') + '</small></div>' : '<div class="cal-remain"><strong class="count-up" data-to="' + Math.round(t.kcal) + '">' + fmtInt(Math.round(t.kcal)) + '</strong><small>kcal heute</small></div>') +
          macroBar('Protein', t.protein, db.settings.proteinGoal, 'p') +
          macroBar('Kohlenhydrate', t.carbs, db.settings.carbGoal, 'c') +
          macroBar('Fett', t.fat, db.settings.fatGoal, 'f') +
        '</div>' +
      '</section>' +
      meals +
      '<p class="hint center" data-flip="food-hint">Ziele änderst du in den Einstellungen. Barcode scannen über „Hinzufügen“ bei einer Mahlzeit. Einträge nach links wischen zum Löschen.</p>';
  }

  /**
   * Kalorienring & Makros: Ring füllt sich weich (stroke-dashoffset), Balken gleiten
   * per transform, Zahlen zählen hoch/runter – ausgehend vom zuletzt gezeigten Stand.
   */
  const FoodFx = {
    play(view, sameRoute) {
      const ring = $('#ring-fg', view);
      if (!ring) return;
      const nums = $$('.count-up', view);
      const fills = $$('.macro-fill', view);
      const cur = {
        date: ui.foodDate,
        off: Number(ring.dataset.off),
        nums: nums.map((el) => Number(el.dataset.to)),
        pcts: fills.map((el) => Number(el.dataset.pct)),
      };
      const prev = ui.foodFx;
      ui.foodFx = cur;
      // Streifen: gewählten Tag sichtbar halten, ohne zu springen
      const strip = $('#date-strip', view);
      if (strip) {
        if (sameRoute && ui.stripScroll !== undefined) strip.scrollLeft = ui.stripScroll;
        else strip.scrollLeft = strip.scrollWidth;
        const sel = strip.querySelector('.sel');
        if (sel) {
          const l = sel.offsetLeft - strip.offsetLeft, r = l + sel.offsetWidth;
          if (l < strip.scrollLeft + 16 || r > strip.scrollLeft + strip.clientWidth - 16) {
            strip.scrollTo({ left: l - strip.clientWidth / 2 + sel.offsetWidth / 2, behavior: reduced() || !sameRoute ? 'auto' : 'smooth' });
          }
        }
        strip.addEventListener('scroll', () => { ui.stripScroll = strip.scrollLeft; }, { passive: true });
        ui.stripScroll = strip.scrollLeft;
      }
      if (reduced()) return;
      const C = Number(ring.getAttribute('stroke-dasharray'));
      // Beim Öffnen der Seite von leer aus füllen, sonst vom vorherigen Stand
      const from = sameRoute && prev ? prev : { off: C, nums: cur.nums.map(() => 0), pcts: cur.pcts.map(() => 0) };
      if (from.off !== cur.off) anim(ring, [{ strokeDashoffset: from.off }, { strokeDashoffset: cur.off }], { duration: 900, easing: EASE.out });
      nums.forEach((el, i) => {
        const to = cur.nums[i];
        const f = from.nums[i] !== undefined ? from.nums[i] : 0;
        countUp(el, f, to, (v) => fmtInt(Math.round(v)), 800);
      });
      fills.forEach((el, i) => {
        const f = from.pcts[i] !== undefined ? from.pcts[i] : 0;
        if (f !== cur.pcts[i]) anim(el, [{ transform: 'translateX(' + (f - 100) + '%)' }, { transform: 'translateX(' + (cur.pcts[i] - 100) + '%)' }], { duration: 800, easing: EASE.out });
      });
    },
  };
  /* ---------- Ernährung: Eintrag hinzufügen ---------- */

  async function chooseAddMethod(meal) {
    const c = await actionSheet('Zu ' + MEAL_LABEL[meal] + ' hinzufügen', [
      { label: 'Barcode scannen', value: 'scan', icon: ICON.scan },
      { label: 'Aus meinen Lebensmitteln', value: 'search', icon: ICON.search },
      { label: 'Schnelleingabe (nur kcal)', value: 'quick', icon: ICON.pencil },
      { label: 'Lebensmittel manuell anlegen', value: 'manual', icon: ICON.plus },
    ]);
    if (c === 'scan') openScanner((code) => onScanned(code, meal));
    else if (c === 'search') openFoodSearch(meal);
    else if (c === 'quick') openQuick(meal);
    else if (c === 'manual') openFoodForm({}, meal);
  }

  async function openQuick(meal) {
    const name = await promptText('Schnelleingabe', { placeholder: 'z. B. Restaurant-Essen', message: 'Name optional, danach die Kalorien.', okLabel: 'Weiter' });
    if (name === null && name !== '') { /* Abbruch */ }
    const kcalStr = await promptText('Kalorien', { placeholder: 'kcal', inputmode: 'numeric', okLabel: 'Speichern' });
    if (kcalStr === null) return;
    const kcal = parseNum(kcalStr);
    if (kcal === null) { toast('Bitte Kalorien eingeben.'); return; }
    Core.addNutrition(db, { date: ui.foodDate, meal, name: name || 'Eintrag', kcal });
    save(); render();
    toast('Eingetragen');
  }

  /* ---------- Barcode-Scanner ---------- */

  function manualBarcodeDefault(onCode) {
    promptText('Barcode eingeben', { placeholder: 'z. B. 4000417025005', inputmode: 'numeric', okLabel: 'Suchen' })
      .then((v) => { if (v) onCode(v.replace(/\D/g, '')); });
  }

  /** Kamera-Scanner (Barcodes und QR-Codes). opts: { title, hint, manual(onCode), manualLabel } */
  async function openScanner(onCode, opts) {
    const o = opts || {};
    const manualBarcode = o.manual || manualBarcodeDefault;
    if (!window.ZXing || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Kamera hier nicht verfügbar – bitte von Hand eingeben.');
      manualBarcode(onCode);
      return;
    }
    let stopFn = () => {};
    const m = customModal(
      '<div class="scanner"><video id="scan-video" playsinline muted autoplay></video>' +
        '<div class="scan-frame" id="scan-frame"><i></i><i></i><i></i><i></i></div>' +
        '<div class="scan-top"><h2 class="scan-title">' + esc(o.title || 'Barcode scannen') + '</h2>' +
        '<p class="scan-hint" id="scan-hint">' + esc(o.hint || 'Halte den Strichcode in den Rahmen.') + '</p></div>' +
      '</div>' +
      '<div class="scan-bar">' +
        '<button class="btn soft" data-manual>' + ICON.pencil + ' Eingeben</button>' +
        '<button class="btn primary" data-stop data-close>Abbrechen</button>' +
      '</div>', { scanner: true, onClose: () => stopFn() });
    const video = m.card.querySelector('#scan-video');
    const reader = new ZXing.BrowserMultiFormatReader();
    let done = false;
    const stop = () => {
      try { reader.reset(); } catch (e) { /* */ }
      const s = video && video.srcObject;
      if (s && s.getTracks) s.getTracks().forEach((t) => t.stop());
    };
    stopFn = stop;
    const finish = (code) => {
      if (done) return;
      done = true;
      const frame = m.card.querySelector('#scan-frame');
      if (frame) frame.classList.add('hit');
      stop(); m.close(); onCode(code);
    };
    m.wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) stop();
      if (e.target.closest('[data-manual]')) { stop(); m.close(); manualBarcode(onCode); }
    });
    try {
      await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video, (result) => {
        if (result) finish(result.getText());
      });
    } catch (e) {
      stop();
      if (!done) m.close();
      const denied = e && (e.name === 'NotAllowedError' || /permission|denied|notallowed/i.test(String(e.name || e)));
      const hint = m.card.querySelector('#scan-hint');
      if (denied) {
        const v = await openDialog({
          title: 'Kamerazugriff nötig',
          message: 'Bitte erlaube den Zugriff auf die Kamera. Auf dem iPhone: Einstellungen → Apps bzw. Safari → Kamera → „Erlauben“. Du kannst den Code auch von Hand eingeben.',
          buttons: [{ label: o.manualLabel || 'Barcode eingeben', style: 'primary', value: 'm' }, { label: 'Abbrechen', style: 'ghost' }],
        });
        if (v === 'm') manualBarcode(onCode);
      } else {
        if (hint) hint.textContent = 'Kamera nicht verfügbar.';
        manualBarcode(onCode);
      }
    }
  }

  // Open Food Facts (global) – die größte freie Lebensmittel-Barcode-Datenbank.
  function fetchOFF(barcode) {
    const code = encodeURIComponent(String(barcode).trim());
    const base = 'https://world.openfoodfacts.org/api/';
    const fields = 'code,product_name,product_name_de,product_name_en,generic_name,brands,serving_size,serving_quantity,nutriments';
    return fetch(base + 'v2/product/' + code + '.json?fields=' + fields)
      .then((r) => r.json())
      .then((json) => {
        const food = Core.parseOFF(json);
        if (food && food.name) return food;
        // Fallback auf die ältere API-Version (findet gelegentlich weitere Produkte)
        return fetch(base + 'v0/product/' + code + '.json')
          .then((r) => r.json()).then((j) => Core.parseOFF(j) || food).catch(() => food);
      });
  }

  function onScanned(barcode, meal) {
    if (!barcode) return;
    const local = Core.findFoodByBarcode(db, barcode);
    if (local) { openPortion(local, meal); return; }
    loadingSheet('Suche Produkt …');
    fetchOFF(barcode).then((food) => {
      if (food && food.name) {
        const saved = Core.saveFood(db, { ...food, barcode });
        save();
        openPortion(saved, meal, true);
      } else {
        toast('Produkt nicht gefunden – bitte anlegen.');
        openFoodForm({ barcode }, meal);
      }
    }).catch(() => {
      toast('Keine Verbindung – bitte manuell anlegen.');
      openFoodForm({ barcode }, meal);
    });
  }

  /* ---------- Meine Lebensmittel: suchen ---------- */

  function foodListHTML(q) {
    const list = Core.searchFoods(db, q);
    if (!list.length) return '<p class="hint center">' + (q ? 'Nichts gefunden.' : 'Noch keine Lebensmittel. Scanne einen Barcode oder lege eines an.') + '</p>';
    return list.map((f) => '' +
      '<div class="list-item" data-pick="' + esc(f.id) + '" role="button" tabindex="0">' +
        '<button class="fav-btn ' + (f.favorite ? 'on' : '') + '" data-fav="' + esc(f.id) + '" aria-label="Favorit">' + ICON.star + '</button>' +
        '<div class="li-main"><div class="li-title">' + esc(f.name) + (f.custom ? ' <span class="badge">eigen</span>' : '') + '</div>' +
        '<div class="li-sub">' + (f.brand ? esc(f.brand) + ' · ' : '') + (f.kcal !== null ? fmtInt(f.kcal) + ' kcal/100 g' : 'ohne kcal') + '</div></div>' +
        ICON.chevron +
      '</div>').join('');
  }

  function openFoodSearch(meal) {
    const m = customModal(
      '<h2 class="modal-title">Meine Lebensmittel</h2>' +
      '<label class="search">' + ICON.search + '<input class="in" id="food-q" type="search" placeholder="Suchen" autocomplete="off" autocapitalize="off"></label>' +
      '<div class="list scroll-list" id="food-list">' + foodListHTML('') + '</div>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Schließen</button></div>');
    const q = m.card.querySelector('#food-q');
    const listEl = m.card.querySelector('#food-list');
    q.addEventListener('input', () => { listEl.innerHTML = foodListHTML(q.value); });
    m.card.addEventListener('click', (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        e.stopPropagation();
        const id = fav.dataset.fav;
        Core.toggleFoodFavorite(db, id); save(); Haptics.tap();
        listEl.innerHTML = foodListHTML(q.value);
        popStar([...listEl.querySelectorAll('[data-fav]')].find((b) => b.dataset.fav === id));
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) { const f = Core.foodById(db, pick.dataset.pick); m.close(); if (f) openPortion(f, meal); }
    });
  }

  /* ---------- Portion wählen & eintragen ---------- */

  function openPortion(food, meal, isNew) {
    const hasServing = food.serving && food.serving > 0;
    const startAmount = hasServing ? 1 : (food.serving || 100);
    const state = { unit: hasServing ? 'portion' : 'g', amount: hasServing ? 1 : 100, meal: meal || 'snack' };
    const nutRow = (k, label) => '<div class="pn"><span>' + label + '</span><strong id="pn-' + k + '">–</strong></div>';
    const m = customModal(
      '<h2 class="modal-title">' + esc(food.name) + '</h2>' +
      (food.brand ? '<p class="modal-msg">' + esc(food.brand) + '</p>' : '') +
      (isNew ? '<div class="notice ok">Produkt gefunden und gespeichert.</div>' : '') +
      '<div class="portion">' +
        '<label class="lbl">Menge<input class="in" id="p-amount" type="text" inputmode="decimal" value="' + fmtNum(startAmount) + '"></label>' +
        (hasServing ? '<div class="segmented small" id="p-unit"><button data-unit="portion" aria-selected="true">Portion (' + fmtNum(food.serving) + ' g)</button><button data-unit="g" aria-selected="false">Gramm</button></div>' : '<span class="unit-fixed">Gramm</span>') +
      '</div>' +
      '<div class="pn-grid">' + nutRow('kcal', 'kcal') + nutRow('protein', 'Protein') + nutRow('carbs', 'KH') + nutRow('fat', 'Fett') + '</div>' +
      '<label class="lbl">Mahlzeit<select class="in" id="p-meal">' + MEALS.map((x) => '<option value="' + x + '"' + (x === state.meal ? ' selected' : '') + '>' + MEAL_LABEL[x] + '</option>').join('') + '</select></label>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div>' +
      '<button class="btn ghost block sm" data-edit>Nährwerte des Produkts bearbeiten</button>');
    const amountEl = m.card.querySelector('#p-amount');
    const mealEl = m.card.querySelector('#p-meal');
    const grams = () => {
      const a = parseNum(amountEl.value) || 0;
      return state.unit === 'portion' && hasServing ? a * food.serving : a;
    };
    const refresh = () => {
      const sc = Core.scaleFood(food, grams());
      for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
        m.card.querySelector('#pn-' + k).textContent = sc[k] === null ? '–' : fmtNum(sc[k]) + (k === 'kcal' ? '' : ' g');
      }
    };
    amountEl.addEventListener('input', refresh);
    const unitSeg = m.card.querySelector('#p-unit');
    if (unitSeg) unitSeg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-unit]'); if (!b) return;
      state.unit = b.dataset.unit;
      [...unitSeg.children].forEach((c) => c.setAttribute('aria-selected', c === b));
      if (state.unit === 'portion') amountEl.value = '1'; else amountEl.value = fmtNum(food.serving || 100);
      refresh();
    });
    m.card.querySelector('[data-edit]').addEventListener('click', () => { m.close(); openFoodForm(food, mealEl.value); });
    m.card.querySelector('[data-save]').addEventListener('click', () => {
      const g = grams();
      if (!g) { toast('Bitte eine Menge eingeben.'); return; }
      const sc = Core.scaleFood(food, g);
      Core.addNutrition(db, { date: ui.foodDate, meal: mealEl.value, name: food.name, kcal: sc.kcal, protein: sc.protein, carbs: sc.carbs, fat: sc.fat, grams: g, foodId: food.id });
      Core.markFoodUsed(db, food.id, Date.now());
      save(); m.close(); render();
      toast('Eingetragen');
    });
    refresh();
  }

  /* ---------- Lebensmittel manuell anlegen / bearbeiten ---------- */

  function openFoodForm(prefill, meal) {
    const f = prefill || {};
    const num = (v) => (v === null || v === undefined ? '' : fmtNum(v));
    const m = customModal(
      '<h2 class="modal-title">' + (f.id ? 'Lebensmittel bearbeiten' : 'Neues Lebensmittel') + '</h2>' +
      '<p class="modal-msg">Nährwerte pro 100 g. Leer lassen, wenn unbekannt.</p>' +
      '<form id="ff" class="ff">' +
        (f.barcode ? '<p class="kv"><span>Barcode</span><span class="break">' + esc(f.barcode) + '</span></p>' : '') +
        '<label class="lbl">Name<input class="in" name="name" value="' + esc(f.name || '') + '" required></label>' +
        '<label class="lbl">Marke (optional)<input class="in" name="brand" value="' + esc(f.brand || '') + '"></label>' +
        '<div class="form-grid">' +
          '<label class="lbl">kcal<input class="in" name="kcal" inputmode="decimal" value="' + num(f.kcal) + '"></label>' +
          '<label class="lbl">Protein (g)<input class="in" name="protein" inputmode="decimal" value="' + num(f.protein) + '"></label>' +
          '<label class="lbl">Kohlenhydrate (g)<input class="in" name="carbs" inputmode="decimal" value="' + num(f.carbs) + '"></label>' +
          '<label class="lbl">Fett (g)<input class="in" name="fat" inputmode="decimal" value="' + num(f.fat) + '"></label>' +
        '</div>' +
        '<label class="lbl">Portionsgröße in g (optional)<input class="in" name="serving" inputmode="decimal" value="' + num(f.serving) + '"></label>' +
        '<div class="modal-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn primary">Speichern</button></div>' +
      '</form>');
    m.card.querySelector('#ff').addEventListener('submit', (e) => {
      e.preventDefault();
      const el = e.target.elements;
      if (!el.name.value.trim()) { toast('Bitte einen Namen eingeben.'); return; }
      const saved = Core.saveFood(db, {
        id: f.id, barcode: f.barcode || null, custom: true,
        name: el.name.value, brand: el.brand.value,
        kcal: el.kcal.value, protein: el.protein.value, carbs: el.carbs.value, fat: el.fat.value, serving: el.serving.value,
      });
      save();
      m.close();
      if (meal) openPortion(saved, meal);
      else { toast('Gespeichert'); render(); }
    });
  }

  /* ---------- Ansicht: Übungsbibliothek ---------- */

  function exerciseMatchesFilter(ex) {
    const f = ui.lib;
    if (f.muscle.size && !f.muscle.has(ex.muscle)) return false;
    if (f.equip.size && !f.equip.has(ex.equipment)) return false;
    if (f.fav && !Core.libFav(db, ex.id)) return false;
    if (f.custom && !ex.custom) return false;
    if (f.q) {
      const key = normName(f.q);
      const hay = normName(ex.name) + ' ' + (ex.aliases || []).map(normName).join(' ');
      if (!hay.includes(key)) return false;
    }
    return true;
  }

  function filteredExercises() {
    return allExercises().filter(exerciseMatchesFilter).sort((a, b) => {
      const fa = Core.libFav(db, a.id), fb = Core.libFav(db, b.id);
      if (fa !== fb) return fb - fa;
      return a.name.localeCompare(b.name, 'de');
    });
  }

  function libItemHTML(ex) {
    return '<a class="list-item" href="#/library/ex/' + encodeURIComponent(ex.id) + '">' +
      '<span class="lib-ic" aria-hidden="true">' + muscleIcon(ex.muscle) + '</span>' +
      '<div class="li-main"><div class="li-title">' + esc(ex.name) + (ex.custom ? ' <span class="badge">eigen</span>' : '') + '</div>' +
      '<div class="li-sub">' + esc(ex.muscle) + ' · ' + esc(ex.equipment) + ' · ' + esc(ex.type) + '</div></div>' +
      '<button class="fav-btn ' + (Core.libFav(db, ex.id) ? 'on' : '') + '" data-libfav="' + esc(ex.id) + '" aria-label="Favorit" aria-pressed="' + Core.libFav(db, ex.id) + '">' + ICON.star + '</button>' +
      '</a>';
  }

  function chip(label, active, action, value) {
    return '<button class="chip small ' + (active ? '' : 'dim') + '" data-action="' + action + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';
  }

  function renderLibrary(view) {
    setHeader({ title: 'Bibliothek', large: true });
    const f = ui.lib;
    const recent = allExercises().filter((e) => Core.libUsed(db, e.id)).sort((a, b) => Core.libUsed(db, b.id) - Core.libUsed(db, a.id)).slice(0, 5);
    const list = filteredExercises();
    const anyFilter = f.q || f.muscle.size || f.equip.size || f.fav || f.custom;
    const skeleton = '<div class="sk-item"><div class="sk sk-circle"></div><div class="sk-lines"><div class="sk sk-line" style="width:70%"></div><div class="sk sk-line" style="width:45%"></div></div></div>';
    const listHTML = !libLoaded ? skeleton.repeat(7)
      : list.length ? list.map(libItemHTML).join('') : '<p class="hint center">Keine Übung gefunden.</p>';
    view.innerHTML =
      '<label class="search">' + ICON.search + '<input class="in" id="lib-q" type="search" placeholder="Übung suchen (deutsch oder englisch)" value="' + esc(f.q) + '" autocomplete="off" autocapitalize="off" enterkeyhint="search"></label>' +
      '<div class="chips filter-chips">' +
        chip('Favoriten', f.fav, 'lib-fav') + chip('Eigene', f.custom, 'lib-custom') +
      '</div>' +
      '<div class="chips filter-chips">' + MUSCLES.map((mu) => chip(mu, f.muscle.has(mu), 'lib-muscle', mu)).join('') + '</div>' +
      '<div class="chips filter-chips">' + EQUIPMENT.map((eq) => chip(eq, f.equip.has(eq), 'lib-equip', eq)).join('') + '</div>' +
      (!anyFilter && recent.length ? '<p class="section-label">Zuletzt verwendet</p><div class="list">' + recent.map(libItemHTML).join('') + '</div>' : '') +
      '<p class="section-label">' + (!libLoaded ? 'Übungen werden geladen …' : anyFilter ? list.length + ' Treffer' : 'Alle Übungen (' + list.length + ')') + '</p>' +
      '<div class="list' + (ui.libWasLoading && libLoaded ? ' fade-in' : '') + '" id="lib-list">' + listHTML + '</div>' +
      '<button class="btn soft block" data-action="lib-new">' + ICON.plus + ' Eigene Übung anlegen</button>';
    ui.libWasLoading = !libLoaded;
    const q = view.querySelector('#lib-q');
    q.addEventListener('input', () => {
      f.q = q.value;
      view.querySelector('#lib-list').innerHTML = (() => { const l = filteredExercises(); return l.length ? l.map(libItemHTML).join('') : '<p class="hint center">Keine Übung gefunden.</p>'; })();
    });
  }

  /* ---------- Ansicht: Übungsdetail ---------- */

  function renderLibEx(view, id) {
    const ex = libById(id);
    if (!ex) { go('#/library'); return; }
    setHeader({ title: ex.name, back: '#/library',
      actions: '<button class="hdr-btn fav-btn' + (Core.libFav(db, ex.id) ? ' on' : '') + '" data-action="lib-fav-toggle" data-id="' + esc(ex.id) + '" aria-label="Favorit" aria-pressed="' + Core.libFav(db, ex.id) + '">' + ICON.star + '</button>' });
    const hist = Core.exerciseHistory(db, normName(ex.name));
    const best = hist.reduce((b, h) => Math.max(b, h.best.weight || 0), 0);
    const points = hist.filter((h) => h.best.e1rm !== null).map((h) => ({ x: h.date, y: h.best.e1rm }));
    view.innerHTML =
      '<section class="card">' +
        '<div class="lib-hero"><span class="lib-ic" aria-hidden="true">' + muscleIcon(ex.muscle) + '</span>' +
          '<div><div class="li-title">' + esc(ex.muscle) + '</div><div class="li-sub">' + esc(ex.equipment) + ' · ' + esc(ex.type) + '</div></div></div>' +
        '<div class="ex-tags">' +
          '<span class="tag">' + esc(ex.muscle) + '</span>' +
          (ex.secondary || []).map((sMx) => '<span class="tag ghost">' + esc(sMx) + '</span>').join('') +
          '<span class="tag">' + esc(ex.equipment) + '</span><span class="tag">' + esc(ex.type) + '</span>' +
          (ex.custom ? '<span class="tag accent">eigene Übung</span>' : '') +
        '</div>' +
        (ex.steps && ex.steps.length ? '<p class="section-label" style="margin-left:0">Ausführung</p><ul class="steps-list">' + ex.steps.map((st) => '<li>' + esc(st) + '</li>').join('') + '</ul>' : '<p class="hint">Keine Beschreibung hinterlegt.</p>') +
      '</section>' +
      (hist.length ?
        '<section class="card"><div class="chart-head"><span class="muted">Bestes Gewicht</span> <strong>' + (best ? fmtNum(best) + ' kg' : '–') + '</strong></div>' +
        (points.length ? chartSVG(points, 'kg') : '<p class="hint">Noch keine 1RM-Daten.</p>') + '</section>' +
        '<p class="section-label">Letzte Einheiten</p>' +
        hist.slice().reverse().slice(0, 5).map((h) => '<section class="card"><a class="ex-head link" href="#/history/session/' + encodeURIComponent(h.sessionId) + '"><h2 class="sm">' + fmtLongDate(h.date) + '</h2>' + ICON.chevron + '</a>' + setTable(h.sets) + '</section>').join('')
        : '<p class="hint center">Noch keine Einheiten mit dieser Übung.</p>') +
      '<button class="btn primary block" data-action="lib-add-to-day" data-id="' + esc(ex.id) + '">' + ICON.plus + ' Zu Trainingstag hinzufügen</button>' +
      (ex.custom ? '<div class="btn-row"><button class="btn soft" data-action="lib-edit" data-id="' + esc(ex.id) + '">' + ICON.edit + ' Bearbeiten</button><button class="btn soft danger-text" data-action="lib-del" data-id="' + esc(ex.id) + '">' + ICON.trash + ' Löschen</button></div>' : '');
  }

  /* ---------- Eigene Übung anlegen / bearbeiten ---------- */

  function openCustomExerciseForm(existing) {
    const e = existing || {};
    const sel = (name, options, cur) => '<select class="in" name="' + name + '">' + options.map((o) => '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
    const m = customModal(
      '<h2 class="modal-title">' + (e.id ? 'Übung bearbeiten' : 'Eigene Übung') + '</h2>' +
      '<form id="cf" class="ff">' +
        '<label class="lbl">Name<input class="in" name="name" value="' + esc(e.name || '') + '" required></label>' +
        '<label class="lbl">Hauptmuskel' + sel('muscle', MUSCLES, e.muscle || 'Brust') + '</label>' +
        '<label class="lbl">Equipment' + sel('equipment', EQUIPMENT, e.equipment || 'Kurzhantel') + '</label>' +
        '<label class="lbl">Art' + sel('type', ['Grundübung', 'Isolation'], e.type || 'Grundübung') + '</label>' +
        '<label class="lbl">Ausführung (eine Zeile pro Punkt)<textarea class="in" name="steps" rows="4">' + esc((e.steps || []).join('\n')) + '</textarea></label>' +
        '<div class="modal-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn primary">Speichern</button></div>' +
      '</form>');
    m.card.querySelector('#cf').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const el = ev.target.elements;
      if (!el.name.value.trim()) { toast('Bitte einen Namen eingeben.'); return; }
      const saved = Core.saveCustomExercise(db, {
        id: e.id, name: el.name.value, muscle: el.muscle.value, equipment: el.equipment.value, type: el.type.value,
        secondary: e.secondary || [],
        steps: el.steps.value.split('\n').map((x) => x.trim()).filter(Boolean),
      });
      save(); m.close();
      if (parseRoute().name === 'libex') go('#/library/ex/' + encodeURIComponent(saved.id));
      else render();
      toast('Gespeichert');
    });
  }

  /* ---------- Übungen zu einem Trainingstag hinzufügen (Bibliothek, Mehrfachauswahl) ---------- */

  function openExercisePicker(dayId) {
    const chosen = new Set();
    const pickList = (q) => {
      const key = normName(q);
      const list = allExercises().filter((ex) => !key || (normName(ex.name) + ' ' + (ex.aliases || []).map(normName).join(' ')).includes(key))
        .sort((a, b) => (Core.libFav(db, b.id) - Core.libFav(db, a.id)) || a.name.localeCompare(b.name, 'de'));
      let html = list.map((ex) => '<label class="pick-row"><input type="checkbox" value="' + esc(ex.id) + '"' + (chosen.has(ex.id) ? ' checked' : '') + '>' +
        '<span class="pick-main"><span class="pick-name">' + esc(ex.name) + (ex.custom ? ' <span class="badge">eigen</span>' : '') + '</span><span class="pick-sub">' + esc(ex.muscle) + ' · ' + esc(ex.equipment) + '</span></span></label>').join('');
      const exact = list.some((ex) => normName(ex.name) === key);
      if (q.trim() && !exact) html += '<button type="button" class="btn ghost block sm" data-create>„' + esc(q.trim()) + '“ als eigene Übung anlegen</button>';
      return html || '<p class="hint center">Nichts gefunden.</p>';
    };
    const m = customModal(
      '<h2 class="modal-title">Übungen hinzufügen</h2>' +
      '<label class="search">' + ICON.search + '<input class="in" id="pick-q" type="search" placeholder="Suchen oder neue Übung tippen" autocomplete="off" autocapitalize="sentences"></label>' +
      '<div class="list scroll-list" id="pick-list">' + pickList('') + '</div>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" data-add>Hinzufügen</button></div>', { full: true });
    const q = m.card.querySelector('#pick-q');
    const listEl = m.card.querySelector('#pick-list');
    const addBtn = m.card.querySelector('[data-add]');
    const updateBtn = () => { addBtn.textContent = chosen.size ? 'Hinzufügen (' + chosen.size + ')' : 'Hinzufügen'; };
    q.addEventListener('input', () => { listEl.innerHTML = pickList(q.value); });
    listEl.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (cb) { if (cb.checked) chosen.add(cb.value); else chosen.delete(cb.value); updateBtn(); }
    });
    listEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-create]')) {
        const name = q.value.trim();
        const id = Core.resolveExercise(db, name, LIB);
        Core.addExercise(db, dayId, name, db.settings.defaultRest, undefined, id);
        Core.markExerciseUsed(db, id, Date.now());
        save(); m.close(); render();
        toast('„' + name + '“ hinzugefügt');
      }
    });
    addBtn.addEventListener('click', () => {
      if (!chosen.size) { m.close(); return; }
      let n = 0;
      for (const id of chosen) {
        const ex = libById(id);
        if (!ex) continue;
        Core.addExercise(db, dayId, ex.name, db.settings.defaultRest, undefined, id);
        Core.markExerciseUsed(db, id, Date.now());
        n++;
      }
      save(); m.close(); render();
      toast(n + (n === 1 ? ' Übung' : ' Übungen') + ' hinzugefügt');
    });
    updateBtn();
  }

  /** Zu welchem Trainingstag hinzufügen? (aus der Bibliothek heraus) */
  async function addExerciseToDay(ex) {
    if (!db.days.length) { toast('Lege zuerst einen Trainingstag an.'); return; }
    const choice = await actionSheet('„' + ex.name + '“ hinzufügen zu …', db.days.map((d) => ({ label: d.name, value: d.id })));
    if (!choice) return;
    Core.addExercise(db, choice, ex.name, db.settings.defaultRest, undefined, ex.id);
    Core.markExerciseUsed(db, ex.id, Date.now());
    save();
    toast('Zu „' + (Core.findDay(db, choice) || {}).name + '“ hinzugefügt');
  }

  function toggleSet(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

  /** Kleiner Feder-Hüpfer für einen Favoriten-Stern. */
  function popStar(btn) {
    if (!btn || reduced()) return;
    anim(btn.querySelector('svg'), [{ transform: 'scale(0.6)' }, { transform: 'none' }], { duration: 480, easing: EASE.spring });
  }

  function editNutrition(id) {
    const n = db.nutrition.find((x) => x.id === id);
    if (!n) return;
    const num = (v) => (v === null ? '' : fmtNum(v));
    const m = customModal(
      '<h2 class="modal-title">Eintrag bearbeiten</h2>' +
      '<form id="ne" class="ff">' +
        '<label class="lbl">Name<input class="in" name="name" value="' + esc(n.name) + '"></label>' +
        '<label class="lbl">Mahlzeit<select class="in" name="meal">' + MEALS.map((x) => '<option value="' + x + '"' + (x === n.meal ? ' selected' : '') + '>' + MEAL_LABEL[x] + '</option>').join('') + '</select></label>' +
        '<div class="form-grid">' +
          '<label class="lbl">kcal<input class="in" name="kcal" inputmode="decimal" value="' + num(n.kcal) + '"></label>' +
          '<label class="lbl">Protein (g)<input class="in" name="protein" inputmode="decimal" value="' + num(n.protein) + '"></label>' +
          '<label class="lbl">KH (g)<input class="in" name="carbs" inputmode="decimal" value="' + num(n.carbs) + '"></label>' +
          '<label class="lbl">Fett (g)<input class="in" name="fat" inputmode="decimal" value="' + num(n.fat) + '"></label>' +
        '</div>' +
        '<div class="modal-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn primary">Speichern</button></div>' +
      '</form>');
    m.card.querySelector('#ne').addEventListener('submit', (e) => {
      e.preventDefault();
      const el = e.target.elements;
      Core.updateNutrition(db, id, { name: el.name.value, meal: el.meal.value, kcal: el.kcal.value, protein: el.protein.value, carbs: el.carbs.value, fat: el.fat.value });
      save(); m.close(); render(); toast('Gespeichert');
    });
  }

  async function editGoal(key) {
    const meta = { calorieGoal: ['Kalorienziel', 'kcal'], proteinGoal: ['Protein-Ziel', 'g'], carbGoal: ['Kohlenhydrat-Ziel', 'g'], fatGoal: ['Fett-Ziel', 'g'] }[key];
    const v = await promptText(meta[0], { value: db.settings[key] == null ? '' : String(db.settings[key]), inputmode: 'numeric', placeholder: meta[1], okLabel: 'Speichern' });
    if (v === null) return;
    const n = parseNum(v);
    if (n === null || n <= 0) { toast('Bitte eine Zahl eingeben.'); return; }
    db.settings[key] = Math.round(n);
    save(); render();
  }

  /* ---------- Theme ---------- */

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const t = db.settings.theme;
    const dark = t === 'dark' || (t === 'system' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#000000' : '#f2f2f2');
    // Statusleiste der Home-Bildschirm-App (wirkt ab dem nächsten Start der App)
    const bar = $('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) bar.setAttribute('content', dark ? 'black-translucent' : 'default');
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

  function addExercise(dayId) { openExercisePicker(dayId); }

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

  /* ---------- Gesten ---------- */

  /**
   * Nach links wischen zum Löschen (Mahlzeit-Einträge, Plan-Übungen, Sätze).
   * Die Aktion wird hinter der Zeile sichtbar; danach gibt es ein paar Sekunden „Rückgängig“.
   * Löschen per Mülleimer-Symbol funktioniert unverändert (mit Rückfrage).
   */
  const SwipeDelete = {
    /** Führt das Löschen aus und liefert eine Funktion zum Wiederherstellen (oder null). */
    remove(spec) {
      const [type, a, b] = spec.split(':');
      if (type === 'food') {
        const i = db.nutrition.findIndex((n) => n.id === a);
        if (i < 0) return null;
        const entry = db.nutrition[i];
        Core.deleteNutrition(db, a);
        return { label: 'Eintrag gelöscht', undo: () => { if (!db.nutrition.some((n) => n.id === entry.id)) db.nutrition.splice(Math.min(i, db.nutrition.length), 0, entry); } };
      }
      if (type === 'ex') {
        const dayId = parseRoute().id;
        const day = Core.findDay(db, dayId);
        const i = day ? day.exercises.findIndex((e) => e.id === a) : -1;
        if (i < 0) return null;
        const ex = day.exercises[i];
        const s = db.activeSession;
        const snap = s && s.dayId === dayId ? { id: s.id, exercises: JSON.parse(JSON.stringify(s.exercises)) } : null;
        Core.removeExercise(db, dayId, a);
        return {
          label: '„' + ex.name + '“ entfernt',
          undo: () => {
            const d = Core.findDay(db, dayId);
            if (!d || d.exercises.some((e) => e.id === ex.id)) return;
            d.exercises.splice(Math.min(i, d.exercises.length), 0, ex);
            const cur = db.activeSession;
            if (snap && cur && cur.id === snap.id) cur.exercises = snap.exercises;
            else Core.syncSession(db);
          },
        };
      }
      if (type === 'set') {
        const se = Core.findSessionExercise(db, a);
        const i = se ? se.sets.findIndex((x) => x.id === b) : -1;
        if (i < 0) return null;
        const st = se.sets[i];
        Core.removeSet(db, a, b);
        return {
          label: 'Satz gelöscht',
          undo: () => {
            const cur = Core.findSessionExercise(db, a);
            if (cur && !cur.sets.some((x) => x.id === st.id)) cur.sets.splice(Math.min(i, cur.sets.length), 0, st);
          },
        };
      }
      return null;
    },

    init() {
      let g = null;
      const reset = () => { g = null; };
      document.addEventListener('pointerdown', (e) => {
        if (g || !e.isPrimary || (e.button !== undefined && e.button > 0)) return;
        const row = e.target.closest('[data-swipe]');
        if (!row || e.target.closest('.drag-handle, .check, .step')) return;
        if (e.target.matches('input:focus, textarea:focus')) return;
        if (row.closest('.ex-list.sorting')) return;
        g = { row, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false, samples: [], raf: 0, bg: null };
      }, { passive: true });

      document.addEventListener('pointermove', (e) => {
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.active) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          if (dx > -10 || Math.abs(dx) < Math.abs(dy) * 1.3) { reset(); return; }
          g.active = true;
          const row = g.row;
          try { row.setPointerCapture(e.pointerId); } catch (err) { /* */ }
          const bg = document.createElement('div');
          bg.className = 'swipe-bg';
          bg.innerHTML = ICON.trash + '<span>Löschen</span>';
          const par = row.offsetParent || row.parentElement;
          const r = row.getBoundingClientRect(), pr = par.getBoundingClientRect();
          Object.assign(bg.style, {
            top: (r.top - pr.top + par.scrollTop - par.clientTop) + 'px',
            left: (r.left - pr.left - par.clientLeft) + 'px',
            width: r.width + 'px', height: r.height + 'px',
            borderRadius: getComputedStyle(row).borderRadius,
          });
          par.insertBefore(bg, row);
          row.classList.add('swiping');
          row.style.willChange = 'transform';
          g.bg = bg;
          g.w = r.width;
          const a = document.activeElement;
          if (a && a.blur && row.contains(a)) a.blur();
        }
        g.samples.push({ x: e.clientX, t: e.timeStamp });
        if (g.samples.length > 6) g.samples.shift();
        g.dx = dx < 0 ? dx : rubber(dx, 40);
        if (!g.raf) {
          g.raf = requestAnimationFrame(() => {
            if (!g) return;
            g.raf = 0;
            g.row.style.transform = 'translateX(' + g.dx + 'px)';
            const p = Math.min(1, -g.dx / (g.w * 0.4));
            g.bg.style.opacity = String(Math.max(0, Math.min(1, p * 1.4)));
            g.bg.classList.toggle('armed', -g.dx > g.w * 0.4);
          });
        }
      }, { passive: true });

      const end = (e) => {
        if (!g || e.pointerId !== g.id) return;
        const s = g;
        g = null;
        if (!s.active) return;
        cancelAnimationFrame(s.raf);
        // Klick nach dem Wischen unterdrücken
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', swallow, true);
        setTimeout(() => document.removeEventListener('click', swallow, true), 350);
        const a = s.samples[0], b = s.samples[s.samples.length - 1];
        const v = a && b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
        const commit = e.type === 'pointerup' && (-s.dx > s.w * 0.4 || (v < -0.6 && s.dx < -30));
        if (!commit) {
          const from = s.dx;
          s.row.style.transform = '';
          const an = anim(s.row, [{ transform: 'translateX(' + from + 'px)' }, { transform: 'none' }], { duration: 420, easing: EASE.spring });
          const done = () => { s.bg.remove(); s.row.classList.remove('swiping'); s.row.style.willChange = ''; };
          if (an) { anim(s.bg, [{ opacity: Number(s.bg.style.opacity || 0) }, { opacity: 0 }], { duration: 200, fill: 'forwards' }); an.onfinish = done; } else done();
          return;
        }
        Haptics.tap();
        const out = anim(s.row, [{ transform: 'translateX(' + s.dx + 'px)' }, { transform: 'translateX(' + (-s.w - 20) + 'px)' }],
          { duration: 200, easing: EASE.in, fill: 'forwards' });
        const finish = () => {
          anim(s.bg, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: EASE.in, fill: 'forwards' });
          s.row.dataset.gone = '1';
          const res = SwipeDelete.remove(s.row.dataset.swipe);
          if (!res) { s.bg.remove(); render(); return; }
          save();
          render();
          setTimeout(() => s.bg.remove(), 200);
          toast(res.label, {
            action: 'Rückgängig',
            onAction: () => { res.undo(); save(); render(); },
          });
        };
        if (out) out.onfinish = finish; else finish();
      };
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
    },
  };

  /** +/− gedrückt halten: wiederholt mit steigendem Tempo. */
  const StepRepeat = {
    t: null,
    el: null,
    fired: false,
    init() {
      const stop = () => {
        clearTimeout(this.t);
        this.t = null;
        if (this.el) this.el.classList.remove('repeating');
      };
      document.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.step[data-action="set-step"]');
        stop();
        this.fired = false;
        this.el = b;
        if (!b) return;
        let n = 0;
        const x0 = e.clientX, y0 = e.clientY;
        const tick = () => {
          if (!this.el || !this.el.isConnected) return stop();
          this.fired = true;
          this.el.classList.add('repeating');
          actions['set-step'](this.el);
          n++;
          this.t = setTimeout(tick, Math.max(45, Math.round(180 * Math.pow(0.86, n))));
        };
        this.t = setTimeout(tick, 420);
        const mv = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 12) stop(); };
        document.addEventListener('pointermove', mv, { passive: true });
        const up = () => {
          stop();
          document.removeEventListener('pointermove', mv);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
        };
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      }, { passive: true });
      // Langes Drücken soll kein Kontextmenü öffnen
      document.addEventListener('contextmenu', (e) => { if (e.target.closest('.step')) e.preventDefault(); });
    },
    /** Nach einer Wiederholungs-Serie den folgenden Klick nicht zusätzlich zählen. */
    consumeClick(el) {
      if (this.fired && el === this.el) { this.fired = false; return true; }
      return false;
    },
  };

  /** Als Home-Bildschirm-App: vom linken Rand nach rechts wischen = zurück. */
  const EdgeBack = {
    init() {
      let g = null;
      document.addEventListener('touchstart', (e) => {
        g = null;
        if (!isStandalone() || e.touches.length !== 1 || openSheets.size || !ui.hdr.back) return;
        const t = e.touches[0];
        if (t.clientX > 22) return;
        g = { x: t.clientX, y: t.clientY, dx: 0, active: false, t0: e.timeStamp, raf: 0 };
      }, { passive: true });
      document.addEventListener('touchmove', (e) => {
        if (!g) return;
        const t = e.touches[0];
        const dx = t.clientX - g.x, dy = t.clientY - g.y;
        if (!g.active) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) { g = null; return; }
          g.active = true;
        }
        e.preventDefault();
        g.dx = Math.max(0, dx);
        if (!g.raf) g.raf = requestAnimationFrame(() => { if (g) { g.raf = 0; $('#view').style.transform = 'translateX(' + g.dx + 'px)'; } });
      }, { passive: false });
      const end = (e) => {
        if (!g) return;
        const s = g;
        g = null;
        if (!s.active) return;
        cancelAnimationFrame(s.raf);
        const view = $('#view');
        const v = s.dx / Math.max(1, e.timeStamp - s.t0);
        if (e.type === 'touchend' && (s.dx > window.innerWidth * 0.35 || v > 0.5)) {
          Haptics.tap();
          location.hash = ui.hdr.back; // render() setzt die Verschiebung im Übergang zurück
        } else {
          const from = s.dx;
          view.style.transform = '';
          anim(view, [{ transform: 'translateX(' + from + 'px)' }, { transform: 'none' }], { duration: 380, easing: EASE.spring });
        }
      };
      document.addEventListener('touchend', end, { passive: true });
      document.addEventListener('touchcancel', end, { passive: true });
    },
  };

  /** Bildschirmtastatur: Sheets rücken per visualViewport nach oben, nichts wird verdeckt. */
  const Keyboard = {
    init() {
      const vv = window.visualViewport;
      if (!vv) return;
      let raf = 0;
      const update = () => {
        raf = 0;
        const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        const root = document.documentElement.style;
        root.setProperty('--kb', (kb > 60 ? kb : 0) + 'px');
        root.setProperty('--vvh', Math.round(vv.height) + 'px');
        const a = document.activeElement;
        if (kb > 60 && a && a.closest && a.closest('.modal-card')) {
          setTimeout(() => { try { a.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* */ } }, 320);
        }
      };
      const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
      vv.addEventListener('resize', schedule);
      vv.addEventListener('scroll', schedule);
      update();
    },
  };



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
      Haptics.tap();
      if (res.done && res.rest > 0) Timer.start(res.rest, res.name);
      ui.popSet = { id: row.dataset.set };
      render();
      ui.popSet = null;
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
      if (input) {
        input.value = field === 'weight' ? fmtNum(v) : String(v);
        if (!reduced()) anim(input, [{ transform: 'scale(1.045)' }, { transform: 'none' }], { duration: 260, easing: EASE.spring });
      }
      saveSoon();
    },
    'summary-done': () => go('#/'),
    'wk-go': (el) => { Haptics.tap(); WorkoutPager.go(Number(el.dataset.index)); },
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
    'food-add': (el) => chooseAddMethod(el.dataset.meal),
    'food-prev': () => { ui.foodDate = shiftDayKey(ui.foodDate || Core.dayKey(Date.now()), -1); render(); },
    'food-next': () => { const today = Core.dayKey(Date.now()); if ((ui.foodDate || today) < today) { ui.foodDate = shiftDayKey(ui.foodDate, 1); render(); } },
    'food-today': () => { ui.foodDate = Core.dayKey(Date.now()); render(); },
    'food-edit': (el) => editNutrition(el.dataset.id),
    'food-del': async (el) => {
      const n = db.nutrition.find((x) => x.id === el.dataset.id);
      if (!n) return;
      const ok = await confirmAction('Eintrag löschen?', (n.name || 'Eintrag') + (n.kcal !== null ? ' · ' + Math.round(n.kcal) + ' kcal' : ''), 'Löschen');
      if (!ok) return;
      Core.deleteNutrition(db, el.dataset.id); save(); render();
    },
    'edit-goal': (el) => editGoal(el.dataset.key),
    'lib-fav': () => { ui.lib.fav = !ui.lib.fav; render(); },
    'lib-custom': () => { ui.lib.custom = !ui.lib.custom; render(); },
    'lib-muscle': (el) => { toggleSet(ui.lib.muscle, el.dataset.value); render(); },
    'lib-equip': (el) => { toggleSet(ui.lib.equip, el.dataset.value); render(); },
    'lib-new': () => openCustomExerciseForm(),
    'lib-fav-toggle': (el) => { Core.toggleLibFav(db, el.dataset.id); save(); Haptics.tap(); render(); popStar($('.hdr-btn.fav-btn')); },
    'lib-add-to-day': (el) => { const ex = libById(el.dataset.id); if (ex) addExerciseToDay(ex); },
    'lib-edit': (el) => { const ex = Core.customExerciseById(db, el.dataset.id); if (ex) openCustomExerciseForm(ex); },
    'lib-del': async (el) => {
      const ex = Core.customExerciseById(db, el.dataset.id);
      if (!ex) return;
      const ok = await confirmAction('„' + ex.name + '“ löschen?', 'Die eigene Übung wird aus der Bibliothek entfernt. Dein Trainingsverlauf bleibt erhalten.', 'Löschen');
      if (!ok) return;
      Core.deleteCustomExercise(db, ex.id); save(); go('#/library');
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
      const grid = $('.cal-grid');
      if (grid && !reduced()) anim(grid, [{ opacity: 0, transform: 'translateX(' + (Number(el.dataset.delta) * 16) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE.out });
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
        message: 'Wie oft pro Woche willst du trainieren? Schaffst du das Ziel mehrere Wochen am Stück, wächst deine Serie.',
        chips: [1, 2, 3, 4, 5, 6].map((n) => ({ label: n + '×', value: String(n) })),
      });
      if (v === null) return;
      const n = Math.round(parseNum(v));
      if (!n || n < 1 || n > 7) { toast('Bitte eine Zahl von 1 bis 7 eingeben.'); return; }
      db.settings.weeklyGoal = n;
      save(); render();
    },
    'effort': (el) => { db.settings.effort = el.dataset.value; save(); render(); },
    'food-date': (el) => { ui.foodDate = el.dataset.key; render(); },
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

    'hist-tab': (el) => { ui.historyTab = el.dataset.tab; ui.fadeContent = '.segmented'; render(); },
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
      save();
      // Nur den Schalter umlegen (animiert), statt die Seite neu zu zeichnen
      el.setAttribute('aria-checked', String(!!db.settings[k]));
      Haptics.tap();
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
      save();
      const swap = () => { applyTheme(); renderNow(); };
      if (!withTransition('fade', swap)) {
        // Weiche Farbüberblendung (nur für diesen Moment)
        const root = document.documentElement;
        root.classList.add('theme-anim');
        swap();
        setTimeout(() => root.classList.remove('theme-anim'), 420);
      }
    },
    /* Konto */
    'auth-mode': (el) => {
      const email = $('#auth-form input[name="email"]');
      if (email) ui.authEmail = email.value.trim();
      ui.authMode = el.dataset.mode;
      ui.fadeContent = '.auth';
      render();
      const form = $('#auth-form');
      if (form && !reduced()) anim(form, [{ opacity: 0.4, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE.out });
    },
    'auth-guest': async () => {
      if (window.GymCloud && window.GymCloud.currentUser()) { try { await window.GymCloud.signOut(); } catch (e) { /* */ } }
      account = { mode: 'guest' };
      saveAccount();
      if (isFreshData()) startSetup(); else go('#/');
    },
    /* Einführung & Einrichtung */
    'intro-next': () => {
      const track = $('#intro-track');
      if (!track) return;
      const w = track.clientWidth || 1;
      const idx = Math.round(track.scrollLeft / w);
      if (idx >= INTRO_SLIDES.length - 1) { finishIntro(); return; }
      track.scrollTo({ left: (idx + 1) * w, behavior: reduced() ? 'auto' : 'smooth' });
    },
    'intro-done': () => finishIntro(),
    'setup-goal': (el) => { ui.setup.goal = Number(el.dataset.value); Haptics.tap(); render(); },
    'setup-start': (el) => { ui.setup.start = el.dataset.value; Haptics.tap(); render(); },
    'setup-kcal': (el) => { ui.setup.kcal = Math.max(1200, Math.min(4000, ui.setup.kcal + Number(el.dataset.delta))); render(); },
    'setup-kcal-set': (el) => { ui.setup.kcal = Number(el.dataset.value); Haptics.tap(); render(); },
    'setup-back': () => setupStep(-1),
    'setup-next': () => { if (ui.setup.step >= SETUP_STEPS - 1) finishSetup(false); else setupStep(1); },
    'setup-skip': () => finishSetup(true),
    'setup-notif': async () => {
      const p = await Notify.request();
      toast(p === 'granted' ? 'Benachrichtigungen aktiviert ✓' : 'Benachrichtigungen nicht erlaubt');
      render();
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
        'Deine Trainingsdaten bleiben auf diesem Gerät (ohne Konto) und in deinem Konto. ' +
        'Freunde und Vergleiche sind nach dem nächsten Anmelden wieder da.' +
        (pending ? ' Noch nicht hochgeladene Änderungen werden übertragen, wenn du dich wieder anmeldest.' : ''),
        'Abmelden', false);
      if (!ok) return;
      await leaveAccount();
      toast('Abgemeldet – deine Daten sind weiter auf dem Gerät');
    },
    'delete-account': async () => {
      const ok = await confirmAction('Konto löschen?',
        'Endgültig gelöscht werden: dein Konto, dein Profil (Benutzername, Foto), alle Freundschaften und Anfragen, ' +
        'deine geteilten Kennzahlen und alle in der Cloud gesicherten Trainingsdaten. ' +
        'Deine Trainingsdaten auf diesem Gerät bleiben erhalten (ohne Konto). Das kann nicht rückgängig gemacht werden.', 'Weiter');
      if (!ok) return;
      if (!window.GymCloud || !navigator.onLine) { toast(authErrorText({ code: 'no-cloud' })); return; }
      let pw = null;
      if (window.GymCloud.providers().includes('password')) {
        pw = await openDialog({
          title: 'Passwort bestätigen',
          message: 'Zur Sicherheit gib bitte dein Passwort ein.',
          input: { type: 'password', autocomplete: 'current-password', select: false },
          buttons: [{ label: 'Abbrechen', style: 'ghost' }, { label: 'Konto endgültig löschen', style: 'danger', submit: true }],
        });
        if (!pw) return;
      } else {
        const ok2 = await confirmAction('Mit Apple bestätigen', 'Zur Sicherheit meldest du dich im nächsten Schritt noch einmal kurz mit Apple an.', 'Konto endgültig löschen');
        if (!ok2) return;
      }
      stopSync();
      ui.deleting = true; // Firebase meldet gleich „abgemeldet“ – das übernimmt hier leaveAccount (Daten bleiben lokal)
      try {
        await window.GymCloud.deleteAccount(pw);
      } catch (e) {
        ui.deleting = false;
        toast(authErrorText(e));
        startSync();
        return;
      }
      await leaveAccount();
      ui.deleting = false;
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

  /* =========================================================
   *  Freunde: Profil, Anfragen, Vergleich, Rangliste
   *  Alles hier braucht ein Konto. Ohne Konto bleibt der Rest der App unverändert offline nutzbar.
   * ========================================================= */

  Object.assign(ICON, {
    gear: svgI('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>'),
    user: svgI('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>'),
    users: svgI('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M15.5 5.8a3 3 0 0 1 0 5.6M17.5 14.4c1.6.6 2.7 2.2 3 4.6"/>'),
    userPlus: svgI('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M18 8v6M15 11h6"/>'),
    camera: svgI('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>'),
    image: svgI('<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/>'),
    qr: svgI('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2h-2z"/>'),
    cloudOff: svgI('<path d="M7 18.5h10.5a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7.6 9.1 4.5 4.5 0 0 0 7 18.5zM4 4l16 16"/>'),
    shield: svgI('<path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
    podium: svgI('<path d="M9 20.5V9.5h6v11M3.5 20.5v-7H9M15 15.5h5.5v5M2.5 20.5h19M12 4l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>'),
  });
  // Apple-Logo (Simple Icons, CC0)
  const APPLE_LOGO = '<svg class="i apple-logo" viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';

  const SOCIAL_KEY = 'gymtracker.social.v1.';        // + uid → zuletzt geladene Freundesdaten (für offline)
  const SOCIAL_PUB = 'gymtracker.socialpub.v1.';     // + uid → Hash der zuletzt geteilten Kennzahlen
  const SOCIAL_LATER = 'gymtracker.sociallater.v1.'; // + uid → „Profil später anlegen“ gewählt
  const SOCIAL_ROUTES = new Set(['profile', 'profile-edit', 'friends-add', 'friends-requests', 'friend', 'leaderboard', 'invite']);

  /** Profilfotos nur von sicheren Quellen (Storage-Adresse oder eingebettetes JPEG/PNG). */
  function safePhoto(p) {
    if (typeof p !== 'string') return null;
    if (/^https:\/\/[^\s"'<>]+$/.test(p)) return p;
    if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s"'<>]*$/.test(p)) return p; // Firebase-Emulator
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)) return p;
    return null;
  }

  /** Rundes Profilfoto – ohne Foto ein grauer Platzhalter. size: '' (42px) | 'md' | 'lg' | 'xl' */
  function avatarHTML(photo, size) {
    const src = safePhoto(photo);
    const cls = 'avatar' + (size ? ' ' + size : '');
    return src
      ? `<span class="${cls}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="${cls} avatar-empty" aria-hidden="true">${ICON.user}</span>`;
  }

  const Social = {
    uid: null,
    profile: undefined,  // undefined = noch unbekannt, null = keins angelegt, sonst { username, photo }
    friends: null,       // [{ uid, since }] – null = noch nie geladen
    people: {},          // uid → { username, photo, stats, updatedAt } | { missing: true }
    incoming: null,      // eingehende Anfragen
    outgoing: null,      // ausgehende Anfragen
    fetchedAt: null,     // letzter bestätigter Server-Stand
    error: null,
    peopleAt: 0,
    loadingPeople: false,
    unsub: null,
    pubTimer: null,
    retryTimer: null,

    api() { return window.GymCloud && window.GymCloud.social; },
    ready() { return !!(this.uid && this.profile && this.profile.username); },
    /** Zeigen wir gerade zwischengespeicherte Daten (offline bzw. Verbindung gestört)? */
    stale() { return !navigator.onLine || !!this.error || !this.api(); },

    /** Zwischengespeicherte Daten des angemeldeten Kontos laden (ohne Netz). */
    attach() {
      if (!isUser()) { this.detach(); return; }
      if (this.uid === account.uid) return;
      this.detach();
      this.uid = account.uid;
      let c = null;
      try { c = JSON.parse(lsGet(SOCIAL_KEY + this.uid)); } catch (e) { c = null; }
      c = c || {};
      this.profile = c.profile === undefined ? undefined : c.profile;
      this.friends = Array.isArray(c.friends) ? c.friends : null;
      this.people = c.people && typeof c.people === 'object' ? c.people : {};
      this.incoming = Array.isArray(c.incoming) ? c.incoming : null;
      this.outgoing = Array.isArray(c.outgoing) ? c.outgoing : null;
      this.fetchedAt = c.fetchedAt || null;
      this.badge();
    },

    /** Mit der Cloud verbinden: Profil laden, Freunde & Anfragen live beobachten. */
    connect() {
      this.attach();
      if (!this.uid || !this.api() || this.unsub) return;
      const uid = this.uid;
      this.fetchProfile();
      this.unsub = this.api().watch({
        friends: (list) => {
          if (uid !== this.uid) return;
          this.friends = list;
          for (const k of Object.keys(this.people)) if (!list.some((f) => f.uid === k)) delete this.people[k];
          this.gotServer();
          this.refreshPeople(true);
          this.changed();
        },
        incoming: (list) => { if (uid === this.uid) { this.incoming = list; this.gotServer(); this.changed(); } },
        outgoing: (list) => { if (uid === this.uid) { this.outgoing = list; this.gotServer(); this.changed(); } },
      }, (err) => {
        if (uid !== this.uid) return;
        this.error = err;
        if (this.unsub) { this.unsub(); this.unsub = null; }
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.connect(), 15000);
        this.changed();
      });
    },

    detach() {
      if (this.unsub) { this.unsub(); this.unsub = null; }
      clearTimeout(this.pubTimer);
      clearTimeout(this.retryTimer);
      Object.assign(this, { uid: null, profile: undefined, friends: null, people: {}, incoming: null, outgoing: null, fetchedAt: null, error: null, peopleAt: 0, forceAgain: false });
      this.badge();
    },

    /** Beim Abmelden: Freundesdaten dieses Kontos vom Gerät entfernen. */
    forget(uid) { lsDel(SOCIAL_KEY + uid); lsDel(SOCIAL_PUB + uid); lsDel(SOCIAL_LATER + uid); },

    persist() {
      if (!this.uid) return;
      lsSet(SOCIAL_KEY + this.uid, JSON.stringify({
        profile: this.profile, friends: this.friends, people: this.people,
        incoming: this.incoming, outgoing: this.outgoing, fetchedAt: this.fetchedAt,
      }));
    },

    gotServer() { this.error = null; this.fetchedAt = Date.now(); this.persist(); },

    async fetchProfile() {
      const uid = this.uid;
      try {
        const p = await this.api().getMyProfile();
        if (uid !== this.uid) return;
        this.profile = p && p.username ? { username: p.username, photo: p.photo || null } : null;
        this.gotServer();
        this.changed();
        if (this.profile) this.schedulePublish(1500);
        else this.maybeOnboard();
      } catch (e) {
        if (uid !== this.uid) return;
        if (e && e.code !== 'unavailable' && navigator.onLine) this.error = e;
        // offline: zwischengespeichertes Profil weiter nutzen und später erneut fragen
        if (navigator.onLine) setTimeout(() => { if (this.uid === uid) this.fetchProfile(); }, 10000);
        else window.addEventListener('online', () => { if (this.uid === uid) this.fetchProfile(); }, { once: true });
      }
    },

    /** Profile (inkl. Kennzahlen) der Freunde laden – höchstens einmal pro Minute, außer `force`. */
    async refreshPeople(force) {
      if (this.loadingPeople) { if (force) this.forceAgain = true; return; }
      if (!this.uid || !this.api() || !this.friends || !navigator.onLine) return;
      if (!force && Date.now() - this.peopleAt < 60000) return;
      const uid = this.uid;
      const uids = this.friends.map((f) => f.uid);
      this.peopleAt = Date.now();
      if (!uids.length) return;
      this.loadingPeople = true;
      try {
        const res = await this.api().getProfiles(uids);
        if (uid !== this.uid) return;
        for (const [k, v] of Object.entries(res)) {
          this.people[k] = v ? { username: v.username || '', photo: v.photo || null, stats: v.stats || null, updatedAt: v.updatedAt || null } : { missing: true };
        }
        this.gotServer();
      } catch (e) {
        if (uid === this.uid) this.error = e;
      } finally {
        this.loadingPeople = false;
      }
      if (uid !== this.uid) return;
      this.changed();
      if (this.forceAgain) { this.forceAgain = false; this.refreshPeople(true); }
    },

    /** Neue Daten → Reiter-Punkt aktualisieren und die offene Freunde-Ansicht neu zeichnen. */
    changed() {
      this.badge();
      if (!SOCIAL_ROUTES.has(parseRoute().name)) return;
      const a = document.activeElement;
      if (a && a.matches && a.matches('input')) { renderPending = true; return; }
      render();
    },

    badge() {
      const d = $('#tab-dot-profile');
      if (d) d.hidden = !(this.uid && this.incoming && this.incoming.length);
    },

    onOnline() {
      this.error = null;
      if (this.uid && !this.unsub) this.connect();
      this.refreshPeople(true);
      this.schedulePublish(1000);
      this.changed();
    },
    onOffline() { this.changed(); },

    /** Geteilte Kennzahlen aktualisieren (gebündelt, nur bei Änderungen). */
    schedulePublish(delay) {
      if (!this.ready() || !this.api()) return;
      clearTimeout(this.pubTimer);
      this.pubTimer = setTimeout(() => this.publish(), delay === undefined ? 4000 : delay);
    },

    async publish() {
      if (!this.ready() || !this.api()) return;
      if (!libLoaded) { this.schedulePublish(2000); return; }
      const stats = sharedStats();
      const h = Sync.hash(Sync.stableStringify(stats));
      const uid = this.uid;
      if (lsGet(SOCIAL_PUB + uid) === h) return;
      try {
        await this.api().publishStats(stats);
        if (uid === this.uid) lsSet(SOCIAL_PUB + uid, h);
      } catch (e) { /* offline o. Ä. – nächster Versuch beim nächsten Speichern bzw. online */ }
    },

    /** Nach dem Anmelden einmalig zur Profil-Einrichtung (Benutzername, Foto) führen. */
    maybeOnboard() {
      if (!ui.socialOnboard || this.profile !== null || !this.uid) return;
      if (lsGet(SOCIAL_LATER + this.uid)) { ui.socialOnboard = false; return; }
      if (parseRoute().name !== 'home') return; // nicht mitten in der Einrichtung o. Ä. stören
      ui.socialOnboard = false;
      ui.pedit = null;
      go('#/profile/edit');
    },

    /** Beziehung zu einem Nutzer: self | friend | incoming | outgoing | none */
    relation(uid) {
      if (uid === this.uid) return 'self';
      if ((this.friends || []).some((f) => f.uid === uid)) return 'friend';
      if ((this.incoming || []).some((r) => r.from === uid)) return 'incoming';
      if ((this.outgoing || []).some((r) => r.to === uid)) return 'outgoing';
      return 'none';
    },
  };

  /** Das wird geteilt (siehe Core.socialStats) – Rekorde nur, wenn in den Einstellungen erlaubt. */
  const sharedStats = () => Core.socialStats(db, Date.now(), LIB, { shareRecords: db.settings.shareRecords });
  /** Eigene Werte für Profil, Vergleich und Rangliste (lokal, immer aktuell). */
  const myFullStats = () => Core.socialStats(db, Date.now(), LIB);

  function fmtVolume(v) {
    return v >= 10000 ? fmtNum(Math.round(v / 100) / 10) + ' t' : fmtInt(v) + ' kg';
  }

  function fmtRecord(r) {
    if (!r) return '–';
    if (r.w !== null && r.w !== undefined) return fmtNum(r.w) + ' kg';
    if (r.r !== null && r.r !== undefined) return r.r + ' Wdh.';
    return '–';
  }

  function offlineNote() {
    if (!Social.stale()) return '';
    const t = Social.fetchedAt;
    return `<p class="hint center offline-note">${ICON.cloudOff}<span>${navigator.onLine ? 'Keine Verbindung zum Server' : 'Offline'}${t
      ? ' – zuletzt aktualisiert am ' + fmtDate(t) + ' um ' + fmtTime(t) + ' Uhr' : ''}</span></p>`;
  }

  function skeletonRows(n) {
    return '<div class="sk-item"><div class="sk sk-circle"></div><div class="sk-lines"><div class="sk sk-line" style="width:55%"></div><div class="sk sk-line" style="width:35%"></div></div></div>'.repeat(n);
  }

  function socialErrorText(e) {
    const code = (e && e.code) || '';
    if (code === 'unavailable' || !navigator.onLine) return 'Keine Verbindung – bitte später erneut versuchen.';
    if (code === 'permission-denied') return 'Das ist gerade nicht möglich (keine Berechtigung).';
    return authErrorText(e);
  }

  function needOnline() {
    if (!Social.api()) { toast(authErrorText({ code: 'no-cloud' })); return false; }
    if (!navigator.onLine) { toast('Keine Internetverbindung – bitte später erneut versuchen.'); return false; }
    return true;
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms))]);
  }

  /* ---------- Profilfoto: verkleinern & komprimieren (auf dem Gerät) ---------- */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  /** Quadratischer Ausschnitt aus der Bildmitte, max. `size` Pixel. */
  function squareCanvas(img, size) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(w, h);
    const out = Math.max(1, Math.min(size, s));
    const c = document.createElement('canvas');
    c.width = out;
    c.height = out;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, out, out);
    return c;
  }

  /** → { blob: JPEG 512 px (für Cloud Storage), dataUrl: JPEG 256 px (Vorschau/Ersatz ohne Storage) } */
  async function prepareAvatar(file) {
    const img = await loadImage(file);
    const big = squareCanvas(img, 512);
    const blob = await new Promise((r) => big.toBlob(r, 'image/jpeg', 0.84));
    if (!blob) throw new Error('image');
    const dataUrl = squareCanvas(img, 256).toDataURL('image/jpeg', 0.78);
    return { blob, dataUrl };
  }

  function pickPhoto(camera) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'user');
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const r = await prepareAvatar(f);
        if (!ui.pedit) return;
        Object.assign(ui.pedit, { blob: r.blob, dataUrl: r.dataUrl, changedPhoto: true });
        render();
      } catch (e) {
        toast('Das Foto konnte nicht gelesen werden.');
      }
    });
    input.click();
  }

  /* ---------- Bausteine ---------- */

  function privacyHTML(first) {
    return `
      <section class="card privacy">
        <h2 class="card-title">${ICON.shield}${first ? 'Deine Privatsphäre' : 'Was Freunde sehen'}</h2>
        ${first ? '<p class="privacy-intro">Mit einem Profil kannst du Freunde hinzufügen und euch vergleichen. Das wird dafür geteilt:</p>' : ''}
        <p class="privacy-h">Für bestätigte Freunde sichtbar</p>
        <ul class="privacy-list">
          <li>Benutzername und Profilfoto <small>– beides auch in der Suche für angemeldete Nutzer</small></li>
          <li>Trainingskennzahlen: Einheiten pro Tag, Wochen-Serie, Gesamtzahl, Trainingsvolumen pro Tag</li>
          <li>Rekorde (Bestgewicht, geschätztes 1RM) bei Übungen aus der Bibliothek <small>– abschaltbar</small></li>
        </ul>
        <p class="privacy-h">Bleibt privat</p>
        <ul class="privacy-list private">
          <li>Einzelne Sätze, Gewichte pro Satz, Notizen und Trainingspläne</li>
          <li>Ernährung, Körpergewicht und Körpermaße</li>
          <li>Deine E-Mail-Adresse</li>
        </ul>
        <p class="hint">Deine vollständigen Trainingsdaten sichert die App wie bisher nur für dich in deinem Konto (für deine Geräte) – Freunde haben darauf keinen Zugriff. Profil, Freundschaften und alle Cloud-Daten löschst du jederzeit unter Einstellungen → Konto.</p>
      </section>`;
  }

  function statTilesHTML(m) {
    return `
      <div class="stats">
        <div><strong>${m.streak ? ICON.flame : ''}${m.streak}</strong><small>${m.streak === 1 ? 'Woche' : 'Wochen'} Serie</small></div>
        <div><strong>${m.week}/${m.goal}</strong><small>diese Woche</small></div>
        <div><strong>${fmtInt(m.total)}</strong><small>Einheiten</small></div>
      </div>`;
  }

  function favRecordHTML(st) {
    const ex = st.fav && libById(st.fav);
    const r = st.fav && st.records[st.fav];
    if (!ex || !r) return '';
    return `
      <a class="list-item fav-rec" href="#/library/ex/${encodeURIComponent(ex.id)}">
        <span class="lib-ic" aria-hidden="true">${ICON.trophy}</span>
        <div class="li-main"><div class="li-sub">Lieblings-Rekord</div><div class="li-title">${esc(ex.name)}</div></div>
        <div class="li-side"><strong>${fmtRecord(r)}</strong><small>${st.favCount}× trainiert</small></div>
      </a>`;
  }

  /** Karte für alle, die (noch) kein Konto haben. */
  function socialGuestHTML(text) {
    return `
      <section class="card social-cta">
        <span class="social-cta-ic" aria-hidden="true">${ICON.users}</span>
        <h2>Mit Freunden vergleichen</h2>
        <p>${esc(text || 'Mit einem Konto kannst du Freunde über ihren Benutzernamen hinzufügen und Trainings, Serien und Rekorde vergleichen.')}</p>
        <p class="muted">Training, Timer, Ernährung, Bibliothek und Verlauf funktionieren weiterhin komplett ohne Konto und offline.</p>
        ${cloudConfigured
          ? '<button class="btn primary block" data-action="open-login">Anmelden oder Konto erstellen</button>'
          : '<div class="notice">Konten sind noch nicht eingerichtet (Firebase-Daten in <code>firebase-config.js</code> eintragen, siehe README.md).</div>'}
      </section>`;
  }

  function setupPromptHTML(text) {
    return `
      <section class="card social-cta">
        <span class="social-cta-ic" aria-hidden="true">${ICON.user}</span>
        <h2>Profil einrichten</h2>
        <p>${esc(text || 'Wähle einen Benutzernamen und ein Foto, damit Freunde dich finden können.')}</p>
        <a class="btn primary block" href="#/profile/edit">Profil erstellen</a>
      </section>`;
  }

  /** Prüft, ob Freunde-Funktionen nutzbar sind; sonst passenden Hinweis zeigen. */
  function socialGate(view) {
    if (!isUser()) { view.innerHTML = socialGuestHTML(); return false; }
    if (Social.profile === undefined) {
      view.innerHTML = navigator.onLine ? skeletonRows(3) : '<div class="empty"><p class="muted">Offline – dein Profil wird geladen, sobald du wieder online bist.</p></div>';
      return false;
    }
    if (!Social.ready()) { view.innerHTML = setupPromptHTML(); return false; }
    return true;
  }

  function personRowHTML(p, side, href, flip) {
    const inner = avatarHTML(p.photo) +
      `<div class="li-main"><div class="li-title break">${p.self ? 'Du' : '@' + esc(p.username)}</div>${p.sub ? `<div class="li-sub">${esc(p.sub)}</div>` : ''}</div>` + (side || '');
    const fl = flip ? ` data-flip="${esc(flip)}"` : '';
    return href ? `<a class="list-item person" href="${href}"${fl}>${inner}${ICON.chevron}</a>` : `<div class="list-item person"${fl}>${inner}</div>`;
  }

  /** Knopf je nach Beziehung (Suche, Einladung). */
  function relationHTML(uid, big) {
    const cls = big ? 'btn block lg' : 'btn sm';
    switch (Social.relation(uid)) {
      case 'self': return '<span class="tag">Du</span>';
      case 'friend': return `<a class="${cls} soft" href="#/friend/${encodeURIComponent(uid)}">Vergleichen</a>`;
      case 'outgoing': return big ? `<button class="${cls} soft" data-action="friend-cancel" data-uid="${esc(uid)}">Anfrage zurückziehen</button>` : '<span class="tag ghost">Angefragt</span>';
      case 'incoming': return `<button class="${cls} primary" data-action="friend-accept" data-uid="${esc(uid)}">Annehmen</button>`;
      default: return `<button class="${cls} primary" data-action="friend-request" data-uid="${esc(uid)}">${ICON.userPlus}${big ? 'Freundschaftsanfrage senden' : 'Anfragen'}</button>`;
    }
  }

  /* ---------- Ansicht: Profil ---------- */

  function renderProfile(view) {
    setHeader({ title: 'Profil', large: true, actions: `<a class="hdr-btn" href="#/settings" aria-label="Einstellungen">${ICON.gear}</a>` });
    const now = Date.now();
    const full = myFullStats();
    const m = Core.socialMetrics(full, now);
    const settingsCard = `
      <section class="card flush">
        ${isUser() && Social.ready() ? menuRow('#/profile/edit', ICON.edit, 'Profil bearbeiten', '', 'Foto, Benutzername, Rekorde teilen') : ''}
        ${isUser() ? `<button class="row menu-row" data-action="privacy-info"><span class="row-ic" aria-hidden="true">${ICON.shield}</span><span class="row-text"><span>Datenschutz</span><small>Was Freunde sehen – und was privat bleibt</small></span><span class="row-value">${ICON.chevron}</span></button>` : ''}
        ${menuRow('#/settings', ICON.gear, 'Einstellungen', '', 'Training, Ernährung, Konto, Datensicherung')}
      </section>`;

    if (!isUser()) {
      view.innerHTML = `
        <section class="profile-hero">
          ${avatarHTML(null, 'xl')}
          <h2>Ohne Konto</h2>
          <p>Deine Daten bleiben nur auf diesem Gerät.</p>
        </section>
        ${statTilesHTML(m)}
        ${favRecordHTML(full)}
        ${socialGuestHTML()}
        ${settingsCard}`;
      return;
    }

    let hero;
    if (Social.profile === undefined) {
      hero = `<section class="profile-hero"><div class="sk avatar xl"></div><div class="sk sk-title" style="width:40%;margin:12px auto 6px"></div><div class="sk sk-line" style="width:30%;margin:0 auto"></div></section>`;
    } else if (!Social.profile) {
      hero = `<section class="profile-hero">${avatarHTML(null, 'xl')}<h2 class="break">${esc(account.email || 'Dein Konto')}</h2><p>Noch kein Profil</p></section>`;
    } else {
      hero = `
        <section class="profile-hero">
          <a href="#/profile/edit" class="avatar-link" aria-label="Profil bearbeiten">${avatarHTML(Social.profile.photo, 'xl')}</a>
          <h2 class="break">@${esc(Social.profile.username)}</h2>
          <p>${esc(Core.activityText(m.last, now))}</p>
          <a class="btn soft sm" href="#/profile/edit">${ICON.edit} Profil bearbeiten</a>
        </section>`;
    }

    let friends = '';
    if (Social.profile === null) {
      friends = setupPromptHTML();
    } else if (Social.profile) {
      const nIn = (Social.incoming || []).length;
      const list = Social.friends;
      let body;
      if (list === null) {
        body = navigator.onLine ? skeletonRows(2) : '<p class="hint center">Freunde werden geladen, sobald du online bist.</p>';
      } else if (!list.length) {
        body = `<div class="empty"><p><strong>Noch keine Freunde</strong></p><p class="muted">Suche nach Benutzernamen oder teile deinen Einladungslink.</p></div>`;
      } else {
        const rows = list.map((f) => {
          const p = Social.people[f.uid];
          if (!p) return navigator.onLine ? skeletonRows(1) : '';
          if (p.missing) return '';
          const fm = p.stats ? Core.socialMetrics(p.stats, now) : null;
          return personRowHTML({ username: p.username, photo: p.photo, sub: fm ? Core.activityText(fm.last, now) : 'noch keine Kennzahlen' },
            fm ? `<div class="li-side"><strong>${fm.week}</strong><small>diese Woche</small></div>` : '', '#/friend/' + encodeURIComponent(f.uid), 'fr-' + f.uid);
        }).join('');
        body = `<div class="list">${rows}</div>`;
      }
      friends = `
        <section class="card flush">
          ${menuRow('#/friends/requests', ICON.inbox, 'Anfragen', nIn ? `<span class="count-badge">${nIn}</span>` : '', nIn ? (nIn === 1 ? '1 neue Anfrage' : nIn + ' neue Anfragen') : 'Eingehend und gesendet')}
          ${menuRow('#/friends/add', ICON.userPlus, 'Freund hinzufügen', '', 'Suchen, Link teilen, QR-Code')}
          ${menuRow('#/leaderboard', ICON.podium, 'Rangliste', '', 'Wer trainiert am meisten?')}
        </section>
        <p class="section-label">Freunde${list && list.length ? ' (' + list.length + ')' : ''}</p>
        ${body}
        ${offlineNote()}`;
      Social.refreshPeople();
    }

    view.innerHTML = `
      ${hero}
      ${statTilesHTML(m)}
      ${favRecordHTML(full)}
      ${friends}
      ${settingsCard}`;
  }

  /* ---------- Ansicht: Profil anlegen / bearbeiten ---------- */

  let unameTimer = null;

  function unameStatusHTML() {
    const s = ui.pedit && ui.pedit.status;
    if (!s) return '<span class="muted">3–20 Zeichen: a–z, 0–9, Punkt und Unterstrich.</span>';
    return `<span class="${s.kind}">${s.kind === 'ok' ? ICON.check : s.kind === 'bad' ? ICON.warn : ''}${esc(s.text)}</span>`;
  }

  function setUnameStatus(s) {
    if (ui.pedit) ui.pedit.status = s;
    const el = $('#uname-status');
    if (el) el.innerHTML = unameStatusHTML();
  }

  function onUsernameInput(el) {
    const p = ui.pedit;
    if (!p) return;
    // Nur Kleinbuchstaben – ohne dass der Cursor springt
    if (el.value !== el.value.toLowerCase()) {
      const pos = el.selectionStart;
      el.value = el.value.toLowerCase();
      try { el.setSelectionRange(pos, pos); } catch (e) { /* */ }
    }
    p.username = el.value;
    const name = Core.normUsername(el.value);
    clearTimeout(unameTimer);
    if (!el.value.trim()) { setUnameStatus(null); return; }
    const err = Core.usernameError(name);
    if (err) { setUnameStatus({ kind: 'bad', text: err }); return; }
    if (Social.profile && Social.profile.username === name) { setUnameStatus({ kind: 'ok', text: 'Dein aktueller Benutzername' }); return; }
    if (!navigator.onLine || !Social.api()) { setUnameStatus({ kind: 'info', text: 'Die Verfügbarkeit wird beim Speichern geprüft.' }); return; }
    setUnameStatus({ kind: 'info', text: 'Prüfe Verfügbarkeit …' });
    unameTimer = setTimeout(async () => {
      try {
        const free = await Social.api().isUsernameFree(name);
        if (!ui.pedit || Core.normUsername(ui.pedit.username) !== name) return;
        setUnameStatus(free ? { kind: 'ok', text: '@' + name + ' ist verfügbar' } : { kind: 'bad', text: '@' + name + ' ist leider schon vergeben' });
      } catch (e) {
        setUnameStatus({ kind: 'info', text: 'Die Verfügbarkeit wird beim Speichern geprüft.' });
      }
    }, 400);
  }

  function renderProfileEdit(view) {
    if (!isUser()) { go('#/profile'); return; }
    const first = !Social.ready();
    if (ui.lastRoute !== '#/profile/edit') ui.pedit = null; // neu geöffnet → frisch beginnen
    if (Social.profile === undefined && navigator.onLine) {
      setHeader({ title: 'Profil', back: '#/profile' });
      view.innerHTML = skeletonRows(2);
      return;
    }
    if (!ui.pedit) {
      ui.pedit = {
        username: first ? '' : Social.profile.username, photo: first ? null : Social.profile.photo,
        blob: null, dataUrl: null, changedPhoto: false, status: null, saving: false,
      };
    }
    const p = ui.pedit;
    setHeader({ title: first ? 'Profil erstellen' : 'Profil bearbeiten', back: '#/profile' });
    const preview = p.changedPhoto ? p.dataUrl : p.photo;
    view.innerHTML = `
      ${first ? privacyHTML(true) : ''}
      <section class="avatar-edit">
        <button class="avatar-btn" type="button" data-action="photo-library" aria-label="Profilfoto wählen">
          ${avatarHTML(preview, 'xl')}<span class="avatar-cam" aria-hidden="true">${ICON.camera}</span>
        </button>
        <div class="btn-row">
          <button class="btn soft sm" type="button" data-action="photo-library">${ICON.image} Foto wählen</button>
          <button class="btn soft sm" type="button" data-action="photo-camera">${ICON.camera} Kamera</button>
        </div>
        ${preview ? '<button class="btn ghost block sm" type="button" data-action="photo-remove">Foto entfernen</button>' : ''}
      </section>
      <form id="profile-form" class="auth-form" novalidate>
        <label class="lbl">Benutzername
          <span class="uname"><span class="uname-at" aria-hidden="true">@</span><input class="in" id="pedit-username" name="username" type="text"
            autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="21"
            value="${esc(p.username)}" placeholder="z. B. max.muster" enterkeyhint="done"></span>
        </label>
        <p class="uname-status" id="uname-status" aria-live="polite">${unameStatusHTML()}</p>
        <section class="card flush">
          ${switchRow('shareRecords', 'Rekorde mit Freunden teilen', 'Bestgewicht und 1RM je Übung aus der Bibliothek')}
        </section>
        <button class="btn primary block lg" type="submit" id="pedit-save">${first ? 'Profil erstellen' : 'Speichern'}</button>
      </form>
      ${first ? '<button class="btn ghost block" data-action="profile-later">Später</button>' : '<button class="btn ghost block" data-action="privacy-info">Was sehen meine Freunde?</button>'}`;
  }

  async function onProfileSubmit(form) {
    const p = ui.pedit;
    if (!p || p.saving) return;
    const name = Core.normUsername(form.elements.username.value);
    const err = Core.usernameError(name);
    if (err) { setUnameStatus({ kind: 'bad', text: err }); form.elements.username.focus(); return; }
    if (!needOnline()) return;
    const api = Social.api();
    const first = !Social.ready();
    const btn = $('#pedit-save');
    const label = btn.textContent;
    p.saving = true;
    btn.disabled = true;
    btn.textContent = 'Wird gespeichert …';
    try {
      let photo = p.photo;
      if (p.changedPhoto) {
        photo = null;
        if (p.blob) {
          try {
            photo = await withTimeout(api.uploadPhoto(p.blob), 20000);
          } catch (e) {
            // Ohne Cloud Storage (z. B. kostenloser Tarif ohne Storage): kleines Foto direkt im Profil speichern
            photo = p.dataUrl;
          }
        } else {
          api.deletePhoto().catch(() => {});
        }
      }
      const stats = libLoaded ? sharedStats() : undefined;
      await withTimeout(api.saveProfile({ username: name, photo, stats }), 20000);
      Social.profile = { username: name, photo: photo || null };
      if (stats) lsSet(SOCIAL_PUB + Social.uid, Sync.hash(Sync.stableStringify(stats)));
      Social.persist();
      Social.schedulePublish(1000);
      ui.pedit = null;
      Haptics.tap();
      toast(first ? 'Profil erstellt – willkommen, @' + name + '!' : 'Profil gespeichert');
      if (ui.pendingInvite) {
        const n = ui.pendingInvite;
        ui.pendingInvite = null;
        go('#/invite/' + encodeURIComponent(n));
      } else go('#/profile');
    } catch (e) {
      p.saving = false;
      btn.disabled = false;
      btn.textContent = label;
      if (e && e.code === 'username-taken') setUnameStatus({ kind: 'bad', text: '@' + name + ' ist leider schon vergeben' });
      else toast(socialErrorText(e));
    }
  }

  /* ---------- Ansicht: Freund hinzufügen (Suche, Link, QR-Code) ---------- */

  let searchTimer = null;

  function friendResultsHTML() {
    const s = ui.friendSearch;
    const q = Core.normUsername(s.q);
    if (q.length < 2) return '<p class="hint center">Gib mindestens 2 Zeichen des Benutzernamens ein.</p>';
    if (!navigator.onLine) return '<p class="hint center">Suche nur mit Internetverbindung möglich.</p>';
    if (s.error) return '<p class="hint center">Die Suche hat nicht geklappt. Bitte erneut versuchen.</p>';
    if (!s.results) return skeletonRows(2);
    if (!s.results.length) return `<p class="hint center">Niemand mit „${esc(q)}“ gefunden.</p>`;
    return s.results.map((p) => personRowHTML({ username: p.username, photo: p.photo, self: p.uid === Social.uid }, relationHTML(p.uid))).join('');
  }

  function renderFriendResults() {
    const el = $('#friend-results');
    if (el) el.innerHTML = friendResultsHTML();
  }

  function onFriendSearch(el) {
    const s = ui.friendSearch;
    if (!s) return;
    s.q = el.value;
    const q = Core.normUsername(el.value);
    clearTimeout(searchTimer);
    s.results = null;
    s.error = null;
    renderFriendResults();
    if (q.length < 2 || !navigator.onLine || !Social.api()) return;
    searchTimer = setTimeout(async () => {
      try {
        const r = await Social.api().search(q);
        if (Core.normUsername(s.q) !== q) return;
        s.results = r;
      } catch (e) {
        s.error = e;
      }
      renderFriendResults();
    }, 300);
  }

  function inviteLink() {
    return location.origin + location.pathname + '#/invite/' + encodeURIComponent(Social.profile.username);
  }

  let qrLoader = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return qrLoader || (qrLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/qrcode.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = () => { qrLoader = null; reject(new Error('qr')); };
      document.head.appendChild(s);
    }));
  }

  /** QR-Code als SVG – immer schwarz auf weiß, damit ihn jede Kamera lesen kann. */
  async function drawInviteQR(el) {
    if (!el) return;
    try {
      const qrcode = await loadQR();
      const qr = qrcode(0, 'M');
      qr.addData(inviteLink());
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + 3) + ' ' + (r + 3) + 'h1v1h-1z';
      el.innerHTML = `<svg viewBox="0 0 ${n + 6} ${n + 6}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    } catch (e) {
      el.innerHTML = '<p class="hint center">QR-Code nicht verfügbar.</p>';
    }
  }

  function renderFriendsAdd(view) {
    setHeader({ title: 'Freund hinzufügen', back: '#/profile' });
    if (!socialGate(view)) return;
    const s = ui.friendSearch || (ui.friendSearch = { q: '', results: null, error: null });
    view.innerHTML = `
      <label class="search">${ICON.search}<input class="in" id="friend-q" type="search" placeholder="Benutzernamen suchen" value="${esc(s.q)}"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></label>
      <div class="list" id="friend-results">${friendResultsHTML()}</div>
      <p class="section-label">Einladen</p>
      <section class="card invite">
        <div class="qr-tile" id="invite-qr" role="img" aria-label="QR-Code mit deinem Einladungslink"><div class="sk"></div></div>
        <p class="invite-name">@${esc(Social.profile.username)}</p>
        <p class="hint center">Lass deinen Freund den Code in der App unter „Freund hinzufügen → Scannen“ oder mit der iPhone-Kamera scannen – oder schick ihm den Link.</p>
        <div class="btn-row">
          <button class="btn primary" data-action="invite-share">${ICON.share} Link teilen</button>
          <button class="btn soft" data-action="qr-scan">${ICON.qr} Scannen</button>
        </div>
      </section>`;
    drawInviteQR($('#invite-qr', view));
  }

  /* ---------- Ansicht: Einladung (Link oder QR-Code) ---------- */

  function renderInvite(view, raw) {
    const name = Core.normUsername(raw);
    setHeader({ title: 'Einladung', back: '#/profile' });
    if (!isUser()) {
      ui.pendingInvite = name;
      view.innerHTML = socialGuestHTML('@' + name + ' möchte sich mit dir vergleichen. Melde dich an oder erstelle ein Konto, um die Anfrage zu senden.');
      return;
    }
    if (Social.profile !== undefined && !Social.ready()) {
      ui.pendingInvite = name;
      view.innerHTML = setupPromptHTML('Lege zuerst dein Profil an – danach kannst du @' + name + ' direkt hinzufügen.');
      return;
    }
    if (!socialGate(view)) return;
    const c = ui.invite && ui.invite.name === name ? ui.invite : (ui.invite = { name, person: undefined, loading: false, error: null });
    if (c.person === undefined && !c.loading && !c.error && navigator.onLine && Social.api()) {
      c.loading = true;
      Social.api().lookup(name).then((p) => { c.person = p; }, (e) => { c.error = e; })
        .finally(() => { c.loading = false; if (parseRoute().name === 'invite') render(); });
    }
    let body;
    if (c.person) {
      body = `
        <section class="profile-hero">
          ${avatarHTML(c.person.photo, 'xl')}
          <h2 class="break">@${esc(c.person.username)}</h2>
          <p>${Social.relation(c.person.uid) === 'self' ? 'Das ist dein eigener Einladungslink.' : 'möchte sich mit dir im Training vergleichen.'}</p>
        </section>
        ${Social.relation(c.person.uid) === 'self' ? '<a class="btn soft block" href="#/friends/add">Eigenen Link teilen</a>' : relationHTML(c.person.uid, true)}`;
    } else if (c.person === null) {
      body = `<div class="empty"><p><strong>@${esc(name)} gibt es nicht (mehr).</strong></p><p class="muted">Vielleicht hat sich der Benutzername geändert.</p></div>
        <a class="btn soft block" href="#/friends/add">Freunde suchen</a>`;
    } else if (c.error || !navigator.onLine) {
      body = `<div class="empty"><p class="muted">Die Einladung kann nur mit Internetverbindung geöffnet werden.</p></div>
        <button class="btn soft block" data-action="invite-retry">Erneut versuchen</button>`;
    } else {
      body = `<section class="profile-hero"><div class="sk avatar xl"></div><div class="sk sk-title" style="width:40%;margin:12px auto"></div></section>`;
    }
    view.innerHTML = body;
  }

  /* ---------- Ansicht: Anfragen ---------- */

  function renderRequests(view) {
    setHeader({ title: 'Anfragen', back: '#/profile' });
    if (!socialGate(view)) return;
    const tab = ui.reqTab || 'in';
    const inc = Social.incoming, out = Social.outgoing;
    const seg = `
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected="${tab === 'in'}" data-action="req-tab" data-tab="in">Erhalten${inc && inc.length ? ' (' + inc.length + ')' : ''}</button>
        <button role="tab" aria-selected="${tab === 'out'}" data-action="req-tab" data-tab="out">Gesendet${out && out.length ? ' (' + out.length + ')' : ''}</button>
      </div>`;
    const list = tab === 'in' ? inc : out;
    let body;
    if (list === null) {
      body = navigator.onLine ? skeletonRows(2) : '<p class="hint center">Anfragen werden geladen, sobald du online bist.</p>';
    } else if (!list.length) {
      body = `<div class="empty"><p class="muted">${tab === 'in' ? 'Keine offenen Anfragen.' : 'Du hast keine offenen Anfragen gesendet.'}</p></div>
        ${tab === 'out' ? '<a class="btn soft block" href="#/friends/add">' + ICON.userPlus + ' Freund hinzufügen</a>' : ''}`;
    } else if (tab === 'in') {
      body = '<div class="list">' + list.map((r) => personRowHTML({ username: r.fromName, photo: r.fromPhoto, sub: r.at ? 'Anfrage ' + fmtRelative(r.at, Date.now()) : '' },
        `<div class="req-actions">
          <button class="icon-btn sm" data-action="friend-decline" data-uid="${esc(r.from)}" aria-label="Anfrage von @${esc(r.fromName)} ablehnen">${ICON.close}</button>
          <button class="btn primary sm" data-action="friend-accept" data-uid="${esc(r.from)}">Annehmen</button>
        </div>`, null, 'rq-' + r.id)).join('') + '</div>';
    } else {
      body = '<div class="list">' + list.map((r) => personRowHTML({ username: r.toName, photo: r.toPhoto, sub: 'wartet auf Antwort' },
        `<button class="btn soft sm" data-action="friend-cancel" data-uid="${esc(r.to)}">Zurückziehen</button>`, null, 'rq-' + r.id)).join('') + '</div>';
    }
    view.innerHTML = seg + body + offlineNote();
  }

  /* ---------- Ansicht: Vergleich mit einem Freund ---------- */

  function cmpRowHTML(label, a, b, fmt, them) {
    const max = Math.max(a, b) || 1;
    const lead = a === b ? '' : a > b ? ' lead-me' : ' lead-them';
    return `
      <div class="cmp${lead}">
        <div class="cmp-label">${label}</div>
        <div class="cmp-bar me"><span class="cmp-who">Du</span><span class="cmp-track"><i style="transform:scaleX(${(a / max).toFixed(4)})"></i></span><b>${fmt(a)}</b></div>
        <div class="cmp-bar them"><span class="cmp-who">${esc(them)}</span><span class="cmp-track"><i style="transform:scaleX(${(b / max).toFixed(4)})"></i></span><b>${fmt(b)}</b></div>
      </div>`;
  }

  function renderFriend(view, uid) {
    const f = (Social.friends || []).find((x) => x.uid === uid);
    const p = Social.people[uid];
    const name = p && !p.missing ? '@' + p.username : 'Freund';
    setHeader({
      title: name, back: '#/profile',
      actions: f ? `<button class="hdr-btn" data-action="friend-menu" data-uid="${esc(uid)}" aria-label="Optionen">${ICON.more}</button>` : '',
    });
    if (!socialGate(view)) return;
    if (Social.friends !== null && !f) { go('#/profile'); return; }
    Social.refreshPeople();
    if (!p) {
      view.innerHTML = navigator.onLine
        ? `<section class="vs-hero"><div class="sk avatar lg"></div><span class="vs-mid">vs</span><div class="sk avatar lg"></div></section><div class="sk" style="height:220px;border-radius:20px;margin-bottom:12px"></div><div class="sk" style="height:160px;border-radius:20px"></div>`
        : '<div class="empty"><p class="muted">Die Daten deines Freundes werden geladen, sobald du online bist.</p></div>';
      return;
    }
    if (p.missing) {
      view.innerHTML = '<div class="notice warn"><strong>Profil nicht verfügbar</strong>Dieses Konto wurde gelöscht oder hat die Freundschaft beendet.</div>';
      return;
    }
    const now = Date.now();
    const mine = myFullStats();
    const me = Core.socialMetrics(mine, now);
    const fr = Core.socialMetrics(p.stats, now);
    const who = '@' + p.username;
    const int = (v) => fmtInt(v);
    const weeks = (v) => v + ' Wo.';

    // Rekorde: nur bei Übungen, die beide teilen (feste Bibliotheks-ID)
    let recs;
    const mode = ui.recMode || 'w';
    if (!db.settings.shareRecords) {
      recs = `<p class="hint">Du teilst deine Rekorde nicht. Aktiviere „Rekorde mit Freunden teilen“ im Profil, um Rekorde zu vergleichen.</p>
        <a class="btn soft block sm" href="#/profile/edit">Profil bearbeiten</a>`;
    } else if (!p.stats || !p.stats.records || !Object.keys(p.stats.records).length) {
      recs = `<p class="hint">${esc(who)} teilt (noch) keine Rekorde.</p>`;
    } else {
      const common = Core.commonRecords(mine, p.stats)
        .map((c) => ({ ...c, ex: libById(c.id) }))
        .filter((c) => c.ex && ((c.me[mode] || 0) || (c.them[mode] || 0)))
        .sort((x, y) => x.ex.name.localeCompare(y.ex.name, 'de'));
      recs = `
        <div class="segmented small" role="tablist">
          <button role="tab" aria-selected="${mode === 'w'}" data-action="rec-mode" data-mode="w">Bestgewicht</button>
          <button role="tab" aria-selected="${mode === 'e'}" data-action="rec-mode" data-mode="e">1RM (geschätzt)</button>
        </div>` + (common.length
        ? common.map((c) => cmpRowHTML(esc(c.ex.name), c.me[mode] || 0, c.them[mode] || 0, (v) => (v ? fmtNum(v) + ' kg' : '–'), who)).join('')
        : '<p class="hint">Noch keine gemeinsamen Übungen. Rekorde erscheinen hier, sobald ihr beide dieselbe Übung aus der Bibliothek trainiert habt.</p>');
    }

    view.innerHTML = `
      <section class="vs-hero">
        <div class="vs-side">${avatarHTML(Social.profile.photo, 'lg')}<b>Du</b></div>
        <span class="vs-mid">vs</span>
        <div class="vs-side">${avatarHTML(p.photo, 'lg')}<b class="break">${esc(who)}</b></div>
      </section>
      <p class="wk-meta center">${esc(who)}: ${esc(Core.activityText(fr.last, now))}${p.updatedAt ? ' · Stand ' + esc(fmtRelative(p.updatedAt, now)) : ''}</p>
      <div class="cmp-legend" aria-hidden="true"><span class="me">Du</span><span class="them">${esc(who)}</span></div>
      <section class="card">
        <h2 class="card-title">Training</h2>
        ${cmpRowHTML('Einheiten diese Woche', me.week, fr.week, int, who)}
        ${cmpRowHTML('Einheiten diesen Monat', me.month, fr.month, int, who)}
        ${cmpRowHTML('Aktuelle Serie (Wochen mit Wochenziel)', me.streak, fr.streak, weeks, who)}
        ${cmpRowHTML('Trainings insgesamt', me.total, fr.total, int, who)}
      </section>
      <section class="card">
        <h2 class="card-title">Volumen <small>Gewicht × Wiederholungen</small></h2>
        ${cmpRowHTML('Letzte 7 Tage', me.vol7, fr.vol7, fmtVolume, who)}
        ${cmpRowHTML('Letzte 30 Tage', me.vol30, fr.vol30, fmtVolume, who)}
      </section>
      <section class="card">
        <h2 class="card-title">Rekorde bei gemeinsamen Übungen</h2>
        ${recs}
      </section>
      <p class="hint center">Wochenziel: du ${me.goal}×, ${esc(who)} ${fr.goal}× pro Woche. Einzelne Sätze, Gewichte pro Satz und Ernährung bleiben privat.</p>
      ${offlineNote()}`;
  }

  /* ---------- Ansicht: Rangliste ---------- */

  const LB_METRICS = [['week', 'Diese Woche'], ['month', 'Dieser Monat'], ['streak', 'Serie'], ['total', 'Gesamt'], ['vol7', 'Volumen 7 T.'], ['vol30', 'Volumen 30 T.']];

  function metricText(k, v) {
    if (k === 'streak') return v + (v === 1 ? ' Woche' : ' Wochen');
    if (k === 'vol7' || k === 'vol30') return fmtVolume(v);
    return fmtInt(v) + (v === 1 ? ' Einheit' : ' Einheiten');
  }

  function renderLeaderboard(view) {
    setHeader({ title: 'Rangliste', back: '#/profile' });
    if (!socialGate(view)) return;
    Social.refreshPeople();
    const metric = ui.lbMetric || 'week';
    const chips = '<div class="chips filter-chips lb-chips">' + LB_METRICS.map(([k, l]) => chip(l, k === metric, 'lb-metric', k)).join('') + '</div>';
    if (Social.friends === null) {
      view.innerHTML = chips + (navigator.onLine ? skeletonRows(3) : '<p class="hint center">Die Rangliste wird geladen, sobald du online bist.</p>');
      return;
    }
    const now = Date.now();
    const entries = [{ uid: Social.uid, name: Social.profile.username, photo: Social.profile.photo, me: true, metrics: Core.socialMetrics(myFullStats(), now) }];
    let loading = 0;
    for (const f of Social.friends) {
      const p = Social.people[f.uid];
      if (!p) { loading++; continue; }
      if (p.missing) continue;
      entries.push({ uid: f.uid, name: p.username, photo: p.photo, metrics: Core.socialMetrics(p.stats, now) });
    }
    const ranked = Core.rankBy(entries, metric);
    const max = Math.max(1, ...ranked.map((e) => e.value));
    const rows = ranked.map((e) => `
      <a class="list-item lb-row${e.me ? ' me' : ''}${e.rank <= 3 && e.value ? ' top' : ''}" href="${e.me ? '#/profile' : '#/friend/' + encodeURIComponent(e.uid)}" data-flip="lb-${esc(e.uid)}">
        <span class="lb-rank">${e.rank}</span>
        ${avatarHTML(e.photo)}
        <div class="li-main">
          <div class="li-title break">${e.me ? 'Du' : '@' + esc(e.name)}</div>
          <span class="cmp-track lb-track"><i style="transform:scaleX(${(e.value / max).toFixed(4)})"></i></span>
        </div>
        <strong class="lb-val">${metricText(metric, e.value)}</strong>
      </a>`).join('');
    view.innerHTML = chips + `<div class="list">${rows}${navigator.onLine && loading ? skeletonRows(Math.min(loading, 3)) : ''}</div>` +
      (Social.friends.length ? '' : `<div class="empty"><p class="muted">Füge Freunde hinzu, um dich mit ihnen zu messen.</p></div><a class="btn primary block" href="#/friends/add">${ICON.userPlus} Freund hinzufügen</a>`) +
      offlineNote();
  }

  /** Vergleichsbalken wachsen beim Öffnen von links auf. */
  const SocialFx = {
    bars(view) {
      if (reduced()) return;
      $$('.cmp-track i', view).forEach((el, i) => {
        const to = el.style.transform;
        anim(el, [{ transform: 'scaleX(0)' }, { transform: to }], { duration: 700, delay: Math.min(i, 12) * 35, easing: EASE.out, fill: 'backwards' });
      });
    },
  };

  /* ---------- Aktionen: Freunde ---------- */

  /** Person zu einer uid aus Suche/Einladung (für Name & Foto in der Anfrage). */
  function knownPerson(uid) {
    const s = ui.friendSearch && ui.friendSearch.results && ui.friendSearch.results.find((p) => p.uid === uid);
    if (s) return s;
    if (ui.invite && ui.invite.person && ui.invite.person.uid === uid) return ui.invite.person;
    return null;
  }

  /** Nach einer Aktion: Suchergebnisse direkt aktualisieren (Fokus bleibt), sonst neu zeichnen. */
  function refreshSocialView() {
    if ($('#friend-results')) renderFriendResults(); else render();
  }

  async function sendFriendRequest(uid) {
    if (!Social.ready()) { toast('Lege zuerst dein Profil an.'); go('#/profile/edit'); return; }
    const rel = Social.relation(uid);
    if (rel === 'incoming') { acceptFriend(uid); return; }
    if (rel !== 'none') return;
    const person = knownPerson(uid);
    if (!person || !needOnline()) return;
    try {
      await withTimeout(Social.api().sendRequest(uid, Social.profile, person), 20000);
      Social.outgoing = (Social.outgoing || []).filter((r) => r.to !== uid).concat([{
        id: Social.uid + '_' + uid, from: Social.uid, to: uid, fromName: Social.profile.username, fromPhoto: Social.profile.photo,
        toName: person.username, toPhoto: person.photo || null, at: Date.now(),
      }]);
      Social.persist();
      Haptics.tap();
      toast('Anfrage an @' + person.username + ' gesendet');
      refreshSocialView();
    } catch (e) {
      toast(socialErrorText(e));
    }
  }

  async function acceptFriend(uid) {
    if (!needOnline()) return;
    const req = (Social.incoming || []).find((r) => r.from === uid);
    const hasOut = (Social.outgoing || []).some((r) => r.to === uid);
    try {
      await withTimeout(Social.api().acceptRequest(uid, hasOut), 20000);
      Social.incoming = (Social.incoming || []).filter((r) => r.from !== uid);
      Social.outgoing = (Social.outgoing || []).filter((r) => r.to !== uid);
      if (!(Social.friends || []).some((f) => f.uid === uid)) Social.friends = (Social.friends || []).concat([{ uid, since: Date.now() }]);
      const known = Social.people[uid];
      if (req && (!known || known.missing)) Social.people[uid] = { username: req.fromName, photo: req.fromPhoto, stats: null, updatedAt: null };
      Social.persist();
      Social.badge();
      Haptics.tap();
      toast(req ? 'Du und @' + req.fromName + ' seid jetzt befreundet' : 'Ihr seid jetzt befreundet');
      Social.refreshPeople(true);
      refreshSocialView();
    } catch (e) {
      toast(socialErrorText(e));
    }
  }

  Object.assign(actions, {
    'auth-apple': async (el) => {
      const errEl = $('#apple-error');
      const show = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = !msg; } else if (msg) toast(msg); };
      if (!window.GymCloud) { show(authErrorText({ code: 'no-cloud' })); return; }
      el.disabled = true;
      show('');
      try {
        await window.GymCloud.signInWithApple(); // Erfolg meldet onAuthState → enterAccount()
      } catch (e) {
        const code = (e && e.code) || '';
        if (code === 'auth/operation-not-allowed') show('„Mit Apple anmelden“ ist im Firebase-Projekt noch nicht aktiviert (siehe README.md).');
        else if (!/popup-closed|cancelled-popup/.test(code)) show(authErrorText(e));
      } finally {
        el.disabled = false;
      }
    },
    'privacy-info': () => openDialog({ html: privacyHTML(false), buttons: [{ label: 'Verstanden', style: 'primary' }] }),
    'photo-library': () => pickPhoto(false),
    'photo-camera': () => pickPhoto(true),
    'photo-remove': () => {
      if (!ui.pedit) return;
      Object.assign(ui.pedit, { blob: null, dataUrl: null, changedPhoto: true });
      render();
    },
    'profile-later': () => {
      if (Social.uid) lsSet(SOCIAL_LATER + Social.uid, '1');
      ui.pedit = null;
      go('#/profile');
      toast('Du kannst dein Profil jederzeit hier anlegen.');
    },
    'friend-request': (el) => sendFriendRequest(el.dataset.uid),
    'friend-accept': (el) => acceptFriend(el.dataset.uid),
    'friend-decline': async (el) => {
      const uid = el.dataset.uid;
      if (!needOnline()) return;
      try {
        await withTimeout(Social.api().declineRequest(uid), 20000);
        Social.incoming = (Social.incoming || []).filter((r) => r.from !== uid);
        Social.persist();
        Social.badge();
        toast('Anfrage abgelehnt');
        refreshSocialView();
      } catch (e) { toast(socialErrorText(e)); }
    },
    'friend-cancel': async (el) => {
      const uid = el.dataset.uid;
      if (!needOnline()) return;
      try {
        await withTimeout(Social.api().cancelRequest(uid), 20000);
        Social.outgoing = (Social.outgoing || []).filter((r) => r.to !== uid);
        Social.persist();
        toast('Anfrage zurückgezogen');
        refreshSocialView();
      } catch (e) { toast(socialErrorText(e)); }
    },
    'friend-menu': async (el) => {
      const uid = el.dataset.uid;
      const p = Social.people[uid];
      const name = p && p.username ? '@' + p.username : 'Freund';
      const c = await actionSheet(name, [{ label: 'Freund entfernen', value: 'rm', danger: true }]);
      if (c !== 'rm') return;
      const ok = await confirmAction(name + ' entfernen?',
        'Ihr seht danach gegenseitig keine Kennzahlen und Rekorde mehr. Du kannst jederzeit eine neue Anfrage senden.', 'Entfernen');
      if (!ok || !needOnline()) return;
      try {
        await withTimeout(Social.api().removeFriend(uid), 20000);
        Social.friends = (Social.friends || []).filter((f) => f.uid !== uid);
        delete Social.people[uid];
        Social.persist();
        go('#/profile');
        toast(name + ' entfernt');
      } catch (e) { toast(socialErrorText(e)); }
    },
    'req-tab': (el) => { ui.reqTab = el.dataset.tab; ui.fadeContent = '.segmented'; render(); },
    'rec-mode': (el) => { ui.recMode = el.dataset.mode; render(); },
    'lb-metric': (el) => { ui.lbMetric = el.dataset.value; Haptics.tap(); render(); },
    'invite-share': () => {
      if (!Social.ready()) return;
      shareText('Gym Tracker', 'Lass uns im Gym Tracker unsere Trainings vergleichen! Füge mich hinzu: @' + Social.profile.username + '\n\n' + inviteLink());
    },
    'invite-retry': () => { ui.invite = null; render(); },
    'qr-scan': () => {
      const onCode = (code) => {
        const m = String(code || '').match(/#\/invite\/([^/?#\s]+)/);
        let name = '';
        try { name = Core.normUsername(m ? decodeURIComponent(m[1]) : code); } catch (e) { name = ''; }
        if (!name || Core.usernameError(name)) { toast('Das ist kein Gym-Tracker-Einladungscode.'); return; }
        ui.invite = null;
        go('#/invite/' + encodeURIComponent(name));
      };
      openScanner(onCode, {
        title: 'Code scannen', hint: 'Halte den QR-Code deines Freundes in den Rahmen.', manualLabel: 'Benutzernamen eingeben',
        manual: (cb) => promptText('Benutzername', { placeholder: 'z. B. max.muster', okLabel: 'Weiter' }).then((v) => { if (v) cb(v); }),
      });
    },
  });

  function blurActive() {
    const a = document.activeElement;
    if (a && a.matches && a.matches('input, textarea')) a.blur();
  }

  function onClick(e) {
    // Aktiven Reiter nochmal antippen: sanft nach oben scrollen (wie iOS)
    const tab = e.target.closest('.tab');
    if (tab && tab.getAttribute('href') === (location.hash || '#/')) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      return;
    }
    const stepEl = e.target.closest('.step');
    if (stepEl && StepRepeat.consumeClick(stepEl)) { e.preventDefault(); return; }
    const favEl = e.target.closest('[data-libfav]');
    if (favEl) {
      e.preventDefault();
      const id = favEl.dataset.libfav;
      Core.toggleLibFav(db, id);
      save(); Haptics.tap(); render();
      popStar($$('[data-libfav]').find((b) => b.dataset.libfav === id));
      return;
    }
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
    if (e.target.id === 'pedit-username') { onUsernameInput(e.target); return; }
    if (e.target.id === 'friend-q') { onFriendSearch(e.target); return; }
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
      const rn = parseRoute().name;
      if (rn === 'home' || rn === 'settings' || rn === 'profile') render();
      if (SOCIAL_ROUTES.has(rn)) Social.refreshPeople();
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
    } else if (isUser() && !ui.deleting) {
      // Sitzung abgelaufen oder auf einem anderen Gerät Passwort geändert / Konto gelöscht.
      // Die lokale Kopie bleibt erhalten und wird beim nächsten Anmelden weiter abgeglichen.
      stopSync();
      Social.detach();
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
    Social.attach(); // zuletzt geladene Freundesdaten (auch offline) – verbunden wird, sobald Firebase bereit ist
    applyTheme();
    darkQuery.addEventListener && darkQuery.addEventListener('change', applyTheme);

    // Audio bei jeder Interaktion (falls nötig) freischalten – iOS erlaubt Ton nur nach einer Geste.
    const unlock = () => { if (!Sound.ctx || Sound.ctx.state !== 'running') Sound.unlock(); };
    ['touchend', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));

    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    // iOS Safari zeigt :active nur, wenn es einen touchstart-Listener gibt
    document.addEventListener('touchstart', () => {}, { passive: true });
    window.addEventListener('scroll', HeaderFx.onScroll, { passive: true });
    window.addEventListener('resize', HeaderFx.onScroll, { passive: true });
    window.addEventListener('resize', () => TabLens.update(true), { passive: true });
    SwipeDelete.init();
    StepRepeat.init();
    EdgeBack.init();
    Keyboard.init();
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
      if (e.target.id === 'profile-form') { e.preventDefault(); onProfileSubmit(e.target); }
    });
    window.addEventListener('online', () => { if (engine) engine.schedule(0); renderSyncStatus(); Social.onOnline(); });
    window.addEventListener('offline', () => { renderSyncStatus(); Social.onOffline(); });
    // Profilfoto nicht ladbar (offline, gelöscht) → grauer Platzhalter
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (img && img.tagName === 'IMG' && img.parentElement && img.parentElement.classList.contains('avatar')) {
        img.parentElement.classList.add('avatar-empty');
        img.replaceWith(document.createRange().createContextualFragment(ICON.user));
      }
    }, true);

    // Laufzeit des Trainings aktualisieren
    setInterval(() => {
      const el = $('#elapsed');
      if (el && db.activeSession) el.textContent = fmtDuration(Date.now() - db.activeSession.startedAt);
    }, 30000);

    Timer.restore();
    Timer.render();
    Wake.update();
    render();
    loadLibrary();

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
      Core, TimerCore, Sync, Timer, Social, save, render, onCloudReady, onAuthState, onBlocked, setAdmin,
      /** Fehler bei „Mit Apple anmelden“ per Weiterleitung */
      onAuthError(e) { if (e && !/popup-closed|cancelled-popup|no-auth-event/.test(e.code || '')) toast(authErrorText(e)); },
      get db() { return db; },
      get account() { return account; },
      get engine() { return engine; },
    };
  }

  init();
})();
