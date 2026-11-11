'use strict';
/* Anchor – Cloud Functions: Push-Mitteilungen bei neuen Chat-Nachrichten und Empfang der Gesundheitsdaten.
 * Einrichtung und Kosten: README.md, Abschnitte 1e (Mitteilungen) und 1f (Apple Health). */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { deliver } = require('./push');
const { handleHealth } = require('./health');

initializeApp();

// Muss zum Standort der Firestore-Datenbank passen (README: europe-west3). Anderer Standort:
// Datei functions/.env mit der Zeile PUSH_REGION=<region> anlegen, z. B. PUSH_REGION=us-central1
const region = process.env.PUSH_REGION || 'europe-west3';

const run = (roomOf) => async (event) => {
  const snap = event.data;
  if (!snap) return;
  const result = await deliver({
    db: getFirestore(), messaging: getMessaging(), room: roomOf(event.params), msg: snap.data(),
    log: (...a) => logger.warn(...a),
  });
  if (result.sent || result.failed) logger.info('Mitteilungen', result);
};

// Gym-Chat und weitere vom Administrator angelegte Räume
exports.pushRoomMessage = onDocumentCreated({ document: 'rooms/{room}/messages/{id}', region, maxInstances: 10 }, run((p) => p.room));
// Gruppen und Direktnachrichten
exports.pushGroupMessage = onDocumentCreated({ document: 'groups/{gid}/messages/{id}', region, maxInstances: 10 }, run((p) => '@' + p.gid));

// Gesundheitsdaten vom iPhone-Kurzbefehl (Apple Health, Garmin über Apple Health) – siehe health.js und README, Abschnitt 1f.
// Öffentlich aufrufbar; geschützt durch den persönlichen Schlüssel, den die App erzeugt (Authorization: Bearer …).
exports.healthIngest = onRequest({ region, invoker: 'public', maxInstances: 5, cors: false }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).set('Allow', 'POST').json({ ok: false, error: 'Nur POST.' }); return; }
  try {
    const out = await handleHealth({ db: getFirestore(), headers: req.headers, body: req.body, serverTime: FieldValue.serverTimestamp() });
    res.status(out.status).json(out.json);
  } catch (e) {
    logger.error('healthIngest', e);
    res.status(500).json({ ok: false, error: 'Interner Fehler.' });
  }
});
