// Bereitet firestore.rules für das automatische Veröffentlichen vor (GitHub Action .github/workflows/deploy-firebase.yml):
// Der Platzhalter für die Administrator-IDs wird ersetzt – durch die Repository-Variable ADMIN_UIDS (Komma-getrennt)
// oder, wenn die fehlt, durch die IDs aus den aktuell veröffentlichten Regeln. So bleibt ein Administrator Administrator,
// ohne dass bei jedem Update jemand die Regeln von Hand anpasst. Ändert nur die Arbeitskopie im CI, nie das Repository.
//
// Aufruf:  node scripts/deploy/prepare-rules.mjs [Pfad zu firestore.rules]
// Braucht: GOOGLE_APPLICATION_CREDENTIALS (Dienstkonto) und functions/node_modules (google-auth-library).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const PLACEHOLDER = 'ADMIN-NUTZER-ID-HIER-EINTRAGEN';
const UID = /^[A-Za-z0-9_-]{1,128}$/;

/** Administrator-IDs aus einem Regel-Text (Funktion isAdmin) – ohne Platzhalter und ungültige Einträge */
export function adminIdsFrom(rules) {
  const m = /function\s+isAdmin\s*\(\s*\)\s*\{[\s\S]*?request\.auth\.uid\s+in\s+\[([^\]]*)\]/.exec(rules || '');
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => (x[1] ?? x[2]).trim()).filter((id) => id && id !== PLACEHOLDER && UID.test(id));
}

/** IDs aus der Variable ADMIN_UIDS („a, b“) */
export function adminIdsFromEnv(value) {
  return String(value || '').split(/[\s,;]+/).map((s) => s.trim()).filter((id) => UID.test(id));
}

/** Platzhalter-Liste in isAdmin durch die IDs ersetzen (keine IDs → unverändert) */
export function injectAdminIds(rules, ids) {
  if (!ids.length) return rules;
  const list = ids.map((id) => `'${id}'`).join(', ');
  const out = rules.replace(`['${PLACEHOLDER}']`, `[${list}]`);
  if (out === rules) throw new Error('Platzhalter für die Administrator-IDs nicht gefunden – firestore.rules geändert?');
  return out;
}

/** Text der aktuell veröffentlichten Firestore-Regeln (Firebase Rules API) oder null */
async function publishedRules(projectId) {
  const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../functions/index.js'));
  const { GoogleAuth } = require('google-auth-library');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const base = 'https://firebaserules.googleapis.com/v1/';
  const release = await client.request({ url: `${base}projects/${projectId}/releases/cloud.firestore` });
  const ruleset = await client.request({ url: base + release.data.rulesetName });
  const files = (ruleset.data.source && ruleset.data.source.files) || [];
  return files.map((f) => f.content).join('\n');
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const file = process.argv[2] || path.join(root, 'firestore.rules');
  const projectId = process.env.FIREBASE_PROJECT || JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8')).projects.default;
  let ids = adminIdsFromEnv(process.env.ADMIN_UIDS);
  let from = 'Variable ADMIN_UIDS';
  if (!ids.length) {
    try {
      ids = adminIdsFrom(await publishedRules(projectId));
      from = 'bisher veröffentlichten Regeln';
    } catch (e) {
      // Noch nie Regeln veröffentlicht → kein Administrator zu übernehmen. Jeder andere Fehler: abbrechen, statt den
      // bisherigen Administrator mit neuen Regeln stillschweigend auszusperren.
      if (!(e.response && e.response.status === 404)) {
        throw new Error(`Veröffentlichte Regeln nicht lesbar (${e.message}) – abgebrochen, damit kein Administrator verloren geht. `
          + 'Dienstkonto-Rechte prüfen oder die Repository-Variable ADMIN_UIDS setzen.');
      }
      console.log('Noch keine Regeln veröffentlicht – kein Administrator zu übernehmen.');
    }
  }
  const rules = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, injectAdminIds(rules, ids));
  console.log(ids.length ? `Administratoren (${from}): ${ids.length}` : 'Keine Administrator-IDs gefunden – Platzhalter bleibt (kein Administrator).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
