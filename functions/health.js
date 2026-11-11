'use strict';
/* Anchor – Gesundheitsdaten (Apple Health, Garmin über Apple Health) empfangen
 *
 * Ein iPhone-Kurzbefehl liest Apple Health und schickt die Tageswerte per POST an die Funktion healthIngest (index.js).
 * Sie erkennt das Konto am persönlichen Schlüssel und legt die Werte unter users/{uid}/health/{Tag} ab,
 * die App liest sie von dort (Daily).
 *
 *   healthTokens/{sha256(Schlüssel)}  → { uid, createdAt }          (von der App angelegt, siehe health-client.js)
 *   users/{uid}/health/{YYYY-MM-DD}   → { day, steps?, activeKcal?, restingHr?, sleepMin?, weightKg?, workouts?, source, updatedAt }
 *
 * Anfrage:  POST, Kopf  Authorization: Bearer <Schlüssel>
 *   { "date": "2026-11-11", "steps": 8123, "activeKcal": 512, "restingHr": 54, "sleepHours": 7.4, "weightKg": 82.4,
 *     "workouts": [ { "type": "Laufen", "minutes": 42, "km": 6.3, "kcal": 410, "avgHr": 152 } ] }
 *   oder { "days": [ { "date": …, … }, … ] }  (höchstens 31 Tage). Alle Werte sind optional – es zählt, was ankommt.
 */
const crypto = require('node:crypto');

const TZ = 'Europe/Vienna';
const DAY_MS = 86400000;
const MAX_DAYS = 31;
const MAX_AGE_DAYS = 400;
const MAX_WORKOUTS = 10;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Heutiger Tag in Wiener Zeit als YYYY-MM-DD */
const viennaDay = (ts) => dayFmt.format(new Date(ts));

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Zahl aus Zahl oder Text (Kurzbefehle liefern oft „82,4“ oder „8.123“). min/max begrenzen, integer rundet.
 * Ganze Zahlen (Schritte, Kalorien, Minuten …) dürfen Tausenderpunkte oder -kommas haben; bei Dezimalzahlen zählt das letzte Zeichen
 * „,“ oder „.“ als Dezimaltrenner. → Zahl oder null (leer/ungültig/außerhalb)
 */
function num(v, { min, max, integer = false, digits = 1 } = {}) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    let s = v.replace(/[\s\u00a0\u202f]/g, '').replace(/[^\d.,+-]+$/u, ''); // Leerzeichen und eine angehängte Einheit („82,4 kg“) weg
    if (!s || !/^[+-]?[\d.,]+$/.test(s)) return null;
    if (integer) s = s.replace(/[.,]/g, '');
    else {
      const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
      s = last < 0 ? s : s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1);
    }
    n = Number(s);
  } else return null;
  if (!Number.isFinite(n)) return null;
  n = integer ? Math.round(n) : Math.round(n * 10 ** digits) / 10 ** digits;
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null;
  return n;
}

function workoutOf(w) {
  if (!w || typeof w !== 'object') return null;
  const type = String(w.type || w.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const minutes = num(w.minutes !== undefined ? w.minutes : w.durationMin, { min: 1, max: 1440, integer: true });
  if (!type || minutes === null) return null;
  const out = { type, minutes };
  const km = num(w.km !== undefined ? w.km : w.distanceKm, { min: 0, max: 1000 });
  const kcal = num(w.kcal, { min: 0, max: 10000, integer: true });
  const avgHr = num(w.avgHr, { min: 25, max: 230, integer: true });
  if (km !== null) out.km = km;
  if (kcal !== null) out.kcal = kcal;
  if (avgHr !== null) out.avgHr = avgHr;
  return out;
}

/** Ein Tag aus der Anfrage → { day, fields } (fields = nur die gültigen Werte) oder { error } */
function dayOf(raw, now) {
  if (!raw || typeof raw !== 'object') return { error: 'Tag fehlt oder ist kein Objekt.' };
  const today = viennaDay(now);
  const day = raw.date === undefined || raw.date === '' ? today : String(raw.date).slice(0, 10);
  const ts = Date.parse(day + 'T12:00:00Z');
  // auch „2026-02-31“ erkennen: V8 rechnet das auf den 3. März um, der Text bliebe aber als Dokument-ID
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(ts) || new Date(ts).toISOString().slice(0, 10) !== day) return { error: 'Datum muss JJJJ-MM-TT sein: ' + day };
  if (ts > Date.parse(viennaDay(now + DAY_MS) + 'T12:00:00Z')) return { error: 'Datum liegt in der Zukunft: ' + day };
  if (ts < Date.parse(today + 'T12:00:00Z') - MAX_AGE_DAYS * DAY_MS) return { error: 'Datum ist zu alt: ' + day };

  const fields = {};
  const set = (k, v) => { if (v !== null) fields[k] = v; };
  set('steps', num(raw.steps, { min: 0, max: 200000, integer: true }));
  set('activeKcal', num(raw.activeKcal, { min: 0, max: 20000, integer: true }));
  set('restingHr', num(raw.restingHr, { min: 25, max: 220, integer: true }));
  let sleepMin = num(raw.sleepMin, { min: 0, max: 1440, integer: true });
  if (sleepMin === null) {
    const hours = num(raw.sleepHours, { min: 0, max: 24, digits: 2 });
    if (hours !== null) sleepMin = Math.round(hours * 60);
  }
  set('sleepMin', sleepMin);
  set('weightKg', num(raw.weightKg !== undefined ? raw.weightKg : raw.weight, { min: 20, max: 500 }));
  if (Array.isArray(raw.workouts)) fields.workouts = raw.workouts.slice(0, MAX_WORKOUTS).map(workoutOf).filter(Boolean);
  if (!Object.keys(fields).length) return { error: 'Keine gültigen Werte für ' + day + '.' };
  return { day, fields };
}

/** Anfrage-Inhalt prüfen → { days: [{ day, fields }] } oder { error } */
function parseHealth(body, now) {
  let b = body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return { error: 'Der Inhalt ist kein gültiges JSON.' }; } }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Der Inhalt muss ein JSON-Objekt sein.' };
  const list = Array.isArray(b.days) ? b.days : [b];
  if (!list.length) return { error: 'days ist leer.' };
  if (list.length > MAX_DAYS) return { error: 'Höchstens ' + MAX_DAYS + ' Tage pro Anfrage.' };
  const byDay = new Map();
  for (const raw of list) {
    const r = dayOf(raw, now);
    if (r.error) return { error: r.error };
    byDay.set(r.day, { ...(byDay.get(r.day) || {}), ...r.fields }); // derselbe Tag zweimal: spätere Werte gewinnen
  }
  return { days: [...byDay].map(([day, fields]) => ({ day, fields })) };
}

/** Schlüssel aus dem Kopf „Authorization: Bearer …“ (oder x-api-key) bzw. aus dem Inhalt */
function tokenOf(headers, body) {
  const h = (headers && (headers.authorization || headers.Authorization)) || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m) return m[1];
  const k = headers && (headers['x-api-key'] || headers['X-Api-Key']);
  if (typeof k === 'string' && k) return k;
  return body && typeof body === 'object' && typeof body.token === 'string' ? body.token : '';
}

/**
 * Eine Anfrage bearbeiten. db = Firestore (Admin SDK), serverTime = FieldValue.serverTimestamp().
 * → { status, json }
 */
async function handleHealth({ db, headers, body, now = Date.now(), serverTime }) {
  const token = tokenOf(headers, body);
  if (!token || token.length < 20 || token.length > 200) return { status: 401, json: { ok: false, error: 'Schlüssel fehlt oder ist ungültig.' } };
  const link = await db.collection('healthTokens').doc(hashToken(token)).get();
  if (!link.exists || typeof link.data().uid !== 'string') return { status: 401, json: { ok: false, error: 'Schlüssel fehlt oder ist ungültig.' } };
  const parsed = parseHealth(body, now);
  if (parsed.error) return { status: 400, json: { ok: false, error: parsed.error } };
  const uid = link.data().uid;
  const batch = db.batch();
  for (const { day, fields } of parsed.days) {
    batch.set(db.collection('users').doc(uid).collection('health').doc(day), { ...fields, day, source: 'shortcut', updatedAt: serverTime }, { merge: true });
  }
  await batch.commit();
  return { status: 200, json: { ok: true, days: parsed.days.map((d) => d.day) } };
}

module.exports = { handleHealth, parseHealth, num, hashToken, tokenOf, viennaDay };
