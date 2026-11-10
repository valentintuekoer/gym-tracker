'use strict';
/* Anchor – Push-Mitteilungen für neue Chat-Nachrichten
 *
 * Wird von index.js bei jeder neuen Nachricht aufgerufen (Cloud Function, Firestore-Trigger).
 * Die Geräte, die Mitteilungen bekommen wollen, stehen in pushDevices/{id}
 * (von der App eingetragen, siehe cloud.js):
 *   { uid, token (FCM), chat (an/aus), blocked [Nutzer-IDs, deren Nachrichten das Gerät nicht will], platform, updatedAt }
 *
 * Empfänger:  Gym-Chat (rooms/gym)        → alle Geräte mit chat = true
 *             Gruppe / Direktchat (@id)   → nur Geräte der Mitglieder
 * Nie an den Absender selbst und nicht an Geräte, die den Absender blockiert haben.
 * Die Mitteilung enthält nur Daten (title, body, tag, url) – der Service Worker der App zeigt sie an.
 */

const TZ = 'Europe/Vienna';
const DAY_MS = 86400000;
const MAX_BODY = 120;
const IN_LIMIT = 30;     // Firestore: höchstens 30 Werte pro „in“-Abfrage (= Gruppengröße)
const SEND_LIMIT = 500;  // FCM: höchstens 500 Empfänger pro Aufruf
const WORKOUTS = { push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Oberkörper', lower: 'Unterkörper', fullbody: 'Ganzkörper', cardio: 'Cardio', other: 'Sonstiges' };
const WD_SHORT = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Wiener Ortszeit: { y, m, d, h, mi } */
function viennaParts(ts) {
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(ts))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => { const p = viennaParts(ts); return p.y + '-' + pad2(p.m) + '-' + pad2(p.d); };

/** „Heute, 18:00 Uhr“ / „Morgen, 18:00 Uhr“ / „Mo., 12.10., 18:00 Uhr“ (wie in der App) */
function whenLabel(ts, now) {
  const k = dayKey(ts);
  const p = viennaParts(ts);
  const time = pad2(p.h) + ':' + pad2(p.mi) + ' Uhr';
  if (k === dayKey(now)) return 'Heute, ' + time;
  if (k === dayKey(now - DAY_MS)) return 'Gestern, ' + time;
  if (k === dayKey(now + DAY_MS)) return 'Morgen, ' + time;
  const wd = WD_SHORT[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return wd + ', ' + pad2(p.d) + '.' + pad2(p.m) + '.' + (p.y === viennaParts(now).y ? '' : p.y) + ', ' + time;
}

function clip(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY - 1) + '…' : t;
}

/**
 * Inhalt der Mitteilung (gleiche Texte wie die Hinweise in der App).
 * → { title, body, tag, url } oder null, wenn es nichts zu melden gibt
 */
function describe({ room, msg, group, now }) {
  if (!msg || typeof msg.uid !== 'string' || !msg.uid) return null;
  const card = msg.kind === 'gym';
  if (!card && msg.kind !== 'text') return null;
  const name = '@' + (String(msg.name || '').trim() || 'jemand');
  let body;
  if (card) {
    if (typeof msg.when !== 'number') return null;
    body = name + ': ' + whenLabel(msg.when, now) + (WORKOUTS[msg.workout] ? ' · ' + WORKOUTS[msg.workout] : '');
  } else {
    const text = clip(msg.text);
    if (!text) return null;
    body = name + ': ' + text;
  }
  if (!group) {
    return { title: card ? 'Neuer Gym-Besuch' : 'Gym-Chat', body, tag: 'chat-' + room, url: '#/chat/gym' };
  }
  const dm = group.kind === 'dm';
  return {
    title: dm ? 'Neue Nachricht' : String(group.name || 'Gruppe'),
    body,
    tag: 'chat-' + room,
    url: dm ? '#/chat/dm/' + encodeURIComponent(msg.uid) : '#/chat/g/' + encodeURIComponent(room.slice(1)),
  };
}

/** Welche Geräte bekommen die Nachricht? (ohne Absender, ohne Geräte, die ihn blockiert haben, ohne doppelte Tokens) */
function chooseDevices(devices, { senderUid, members }) {
  const seen = new Set();
  const out = [];
  for (const d of devices) {
    if (!d || typeof d.token !== 'string' || !d.token || d.chat !== true || d.uid === senderUid) continue;
    if (members && !members.includes(d.uid)) continue;
    if (Array.isArray(d.blocked) && d.blocked.includes(senderUid)) continue;
    if (seen.has(d.token)) continue;
    seen.add(d.token);
    out.push(d);
  }
  return out;
}

/** Hat FCM gemeldet, dass das Gerät nicht mehr erreichbar ist (App gelöscht, Erlaubnis entzogen …)? */
function isDeadToken(err) {
  const code = (err && err.code) || '';
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
    || (code === 'messaging/invalid-argument' && /registration token/i.test((err && err.message) || ''));
}

async function loadDevices(db, members) {
  const col = db.collection('pushDevices');
  const snaps = [];
  if (!members) snaps.push(await col.where('chat', '==', true).get());
  else for (let i = 0; i < members.length; i += IN_LIMIT) snaps.push(await col.where('uid', 'in', members.slice(i, i + IN_LIMIT)).get());
  return snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/**
 * Eine neue Nachricht verteilen.
 * db = Firestore (Admin SDK), messaging = admin.messaging(), room = 'gym' | '@<Gruppen-ID>', msg = Nachrichten-Dokument.
 * → { sent, failed, removed }
 */
async function deliver({ db, messaging, room, msg, now = Date.now(), log = () => {} }) {
  const none = { sent: 0, failed: 0, removed: 0 };
  let group = null;
  if (room.charAt(0) === '@') {
    const snap = await db.collection('groups').doc(room.slice(1)).get();
    if (!snap.exists) return none;
    group = snap.data();
    if (!Array.isArray(group.memberIds) || !group.memberIds.includes(msg && msg.uid)) return none;
  }
  const note = describe({ room, msg, group, now });
  if (!note) return none;

  const devices = chooseDevices(await loadDevices(db, group && group.memberIds), { senderUid: msg.uid, members: group && group.memberIds });
  if (!devices.length) return none;

  const data = { title: note.title, body: note.body, tag: note.tag, url: note.url };
  const result = { sent: 0, failed: 0, removed: 0 };
  for (let i = 0; i < devices.length; i += SEND_LIMIT) {
    const chunk = devices.slice(i, i + SEND_LIMIT);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk.map((d) => d.token),
      data,
      webpush: { headers: { TTL: '86400', Urgency: 'high' } },
    });
    result.sent += res.successCount;
    result.failed += res.failureCount;
    const dead = [];
    res.responses.forEach((r, k) => {
      if (r.success) return;
      if (isDeadToken(r.error)) dead.push(chunk[k].id);
      else log('Senden fehlgeschlagen', (r.error && r.error.code) || '', chunk[k].uid);
    });
    await Promise.all(dead.map((id) => db.collection('pushDevices').doc(id).delete().catch(() => {})));
    result.removed += dead.length;
  }
  return result;
}

module.exports = { deliver, describe, chooseDevices, whenLabel, isDeadToken, WORKOUTS };
