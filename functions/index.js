'use strict';
/* Anchor – Cloud Functions: Push-Mitteilungen bei neuen Chat-Nachrichten.
 * Einrichtung und Kosten: README.md, Abschnitt „Mitteilungen bei geschlossener App“. */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { deliver } = require('./push');

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
