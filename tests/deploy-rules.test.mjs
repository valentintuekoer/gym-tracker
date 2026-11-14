// Automatisches Veröffentlichen: Administrator-IDs aus veröffentlichten Regeln übernehmen und in firestore.rules eintragen
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adminIdsFrom, adminIdsFromEnv, injectAdminIds, PLACEHOLDER } from '../scripts/deploy/prepare-rules.mjs';

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('Die Regeln im Repository enthalten genau den Platzhalter (sonst findet das Veröffentlichen ihn nicht)', () => {
  assert.equal(rules.split(`['${PLACEHOLDER}']`).length, 2);
  assert.deepEqual(adminIdsFrom(rules), []);
});

test('IDs aus veröffentlichten Regeln lesen (auch mehrere, auch doppelte Anführungszeichen)', () => {
  const published = rules.replace(`['${PLACEHOLDER}']`, `['AbC123xyz', "Zz9_-q"]`);
  assert.deepEqual(adminIdsFrom(published), ['AbC123xyz', 'Zz9_-q']);
  assert.deepEqual(adminIdsFrom('kein isAdmin hier'), []);
  assert.deepEqual(adminIdsFrom(rules.replace(`['${PLACEHOLDER}']`, `['x y', 'ok1']`)), ['ok1']);   // ungültige fallen weg
});

test('IDs aus der Variable ADMIN_UIDS', () => {
  assert.deepEqual(adminIdsFromEnv(' a1, b2 ;c3 '), ['a1', 'b2', 'c3']);
  assert.deepEqual(adminIdsFromEnv(''), []);
  assert.deepEqual(adminIdsFromEnv(undefined), []);
  // nichts außer Buchstaben, Ziffern, _ und - gelangt in die Regeln (jede ID steht danach in Anführungszeichen)
  for (const id of adminIdsFromEnv("x'); allow write: if true; //")) assert.match(id, /^[A-Za-z0-9_-]+$/);
});

test('Eintragen: ersetzt nur den Platzhalter; ohne IDs bleibt alles wie es ist', () => {
  const out = injectAdminIds(rules, ['u1', 'u2']);
  assert.ok(out.includes("request.auth.uid in ['u1', 'u2']"));
  assert.ok(!out.includes(PLACEHOLDER));
  assert.deepEqual(adminIdsFrom(out), ['u1', 'u2']);
  assert.equal(out.length - rules.length, "'u1', 'u2'".length - `'${PLACEHOLDER}'`.length);
  assert.equal(injectAdminIds(rules, []), rules);
  assert.throws(() => injectAdminIds('ohne Platzhalter', ['u1']), /Platzhalter/);
});
