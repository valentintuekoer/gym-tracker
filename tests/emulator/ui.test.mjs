// Ende-zu-Ende-Tests der echten App im Browser (Chromium via Playwright) gegen den Firebase-Emulator.
// Ausführen (einmalig `npm install` in diesem Ordner):  npm run test:ui
// Das Firebase-SDK wird aus node_modules/firebase geladen (gleiche Dateien wie auf gstatic.com).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SDK_DIR = path.join(HERE, 'node_modules/firebase');
const PROJECT = 'demo-gym';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const EMU_CONFIG = `window.GYM_FIREBASE_CONFIG = { apiKey: 'demo-key', authDomain: '${PROJECT}.firebaseapp.com', projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com', useEmulator: true };`;

let server, base, browser;
const errors = [];
const toastLog = [];
const pages = [];

async function resetEmulators() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Neues „Gerät“: eigener Browser-Kontext. cloud=false → Firebase nicht erreichbar (nur offline/ohne Konto). */
async function device(name, { cloud = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'de-DE', reducedMotion: 'reduce' });
  await ctx.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: EMU_CONFIG }));
  await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
    if (!cloud) return r.abort();
    const file = path.join(SDK_DIR, path.basename(new URL(r.request().url()).pathname));
    return r.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(file) });
  });
  // Jeder Toast wird mitgeschrieben: Fehlermeldungen dürfen im normalen Ablauf nicht auftauchen
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.getElementById('toast');
      new MutationObserver(() => { const m = t.querySelector('.toast-msg'); if (m && !t.hidden) (window.__toasts = window.__toasts || []).push(m.textContent); })
        .observe(t, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  });
  const page = await ctx.newPage();
  page.on('framenavigated', async (f) => { if (f === page.mainFrame()) toastLog.push(...await page.evaluate(() => window.__toasts || []).catch(() => [])); });
  pages.push({ name, page });
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // erwartet: Firebase nicht ladbar (Test ohne Cloud), abgelehnte Emulator-Zugriffe, bewusst offline
    if (/Firebase konnte nicht geladen|ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|Failed to load resource|@firebase\/firestore/.test(t)) return;
    errors.push(name + ': ' + t);
  });
  page.setDefaultTimeout(15000);
  return { ctx, page };
}

const dlgButton = (page, label) => page.locator('.modal:not(.closing) .modal-actions button', { hasText: label }).last();
const toastText = (page) => page.locator('#toast .toast-msg');

async function waitHash(page, re) {
  await page.waitForFunction((src) => new RegExp(src).test(location.hash), re.source);
}

/** Einführung überspringen → Anmeldeseite */
async function openApp(page) {
  await page.goto(base + '/');
  await page.locator('[data-action="intro-done"]').click();
  await waitHash(page, /#\/login/);
}

async function register(page, email) {
  await openApp(page);
  await page.locator('[data-action="auth-mode"][data-mode="register"]').click();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'geheim123');
  await page.fill('input[name="password2"]', 'geheim123');
  await page.locator('#auth-submit').click();
  // Neues Konto → Einrichtung → „Später“ → danach die Profil-Einrichtung
  await waitHash(page, /#\/setup/);
  await page.locator('[data-action="setup-skip"]').click();
  await waitHash(page, /#\/profile\/edit/);
}

async function createProfile(page, username, withPhoto) {
  await page.locator('.privacy').waitFor(); // Datenschutz-Erklärung beim ersten Verbinden
  if (withPhoto) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.avatar-edit [data-action="photo-library"]').first().click()]);
    await chooser.setFiles(path.join(ROOT, 'icons/icon-512.png'));
    await page.locator('.avatar-edit .avatar img').waitFor();
  }
  await page.fill('#pedit-username', username);
  await page.locator('#uname-status .ok').waitFor();
  await page.locator('#pedit-save').click();
  await waitHash(page, /#\/profile$/);
  await page.locator('.profile-hero h2', { hasText: '@' + username }).waitFor();
}

/** Trainingseinheit mit Bankdrücken anlegen (über die App-Logik, wie nach einem Training). */
async function logBench(page, weight, reps) {
  await page.evaluate(([w, r]) => {
    const { Core } = window.GymApp;
    const db = window.GymApp.db;
    let day = db.days.find((d) => d.name === 'Push');
    if (!day) { day = Core.addDay(db, 'Push'); Core.addExercise(db, day.id, 'Bankdrücken', 90, 1, 'bankdruecken-lh'); }
    const s = Core.startSession(db, day.id, Date.now() - 3600000);
    const se = s.exercises[0];
    Core.updateSet(db, se.id, se.sets[0].id, 'weight', w);
    Core.updateSet(db, se.id, se.sets[0].id, 'reps', r);
    Core.toggleSet(db, se.id, se.sets[0].id, Date.now());
    Core.finishSession(db, Date.now());
    window.GymApp.save();
    window.GymApp.Social.schedulePublish(0);
  }, [weight, reps]);
}

test.before(async () => {
  await resetEmulators();
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

test('Ohne Konto und ohne Firebase: Training, Timer, Ernährung, Bibliothek, Verlauf, Profil', async () => {
  const { ctx, page } = await device('gast', { cloud: false });
  await openApp(page);
  await page.locator('.btn.apple').waitFor(); // „Mit Apple anmelden“ wird angeboten
  await page.locator('[data-action="auth-guest"]').click();
  // Einrichtung mit Beispielplan
  await waitHash(page, /#\/setup/);
  for (let i = 0; i < 4; i++) await page.locator('[data-action="setup-next"]').click();
  await waitHash(page, /#\/$/);
  await page.locator('.day-card', { hasText: 'Push' }).click();
  await page.locator('[data-action="open-day"]').click();
  await waitHash(page, /#\/workout/);
  // Satz eintragen und abhaken → Pausentimer läuft
  const set = page.locator('.wk-slide').first().locator('.set').first();
  await set.locator('input[data-field="weight"]').fill('60');
  await set.locator('input[data-field="reps"]').fill('10');
  await set.locator('[data-action="set-toggle"]').click();
  await page.locator('#timer-bar.show').waitFor();
  await page.locator('[data-timer="skip"]').click();
  await page.locator('.wk-end [data-action="finish"]').click();
  await dlgButton(page, 'Speichern').click();
  await waitHash(page, /#\/summary\//);
  await page.locator('[data-action="summary-done"]').first().click();
  // Ernährung: Schnelleingabe
  await page.locator('.tab[data-tab="food"]').click();
  await page.locator('[data-action="food-add"][data-meal="lunch"]').click();
  await dlgButton(page, 'Schnelleingabe').click();
  await page.fill('.modal:not(.closing) #dlg-input', 'Pasta');
  await dlgButton(page, 'Weiter').click();
  await page.locator('.modal:not(.closing) #dlg-input').fill('650');
  await dlgButton(page, 'Speichern').click();
  await page.locator('.food-row', { hasText: 'Pasta' }).waitFor();
  // Bibliothek lädt die Übungen
  await page.locator('.tab[data-tab="library"]').click();
  await page.locator('.section-label', { hasText: 'Alle Übungen (207)' }).waitFor();
  // Verlauf zeigt die Einheit
  await page.locator('.tab[data-tab="history"]').click();
  await page.locator('.list-item.card-like', { hasText: 'Push' }).waitFor();
  // Profil ohne Konto: eigene Kennzahlen + Hinweis, keine Fehler
  await page.locator('.tab[data-tab="profile"]').click();
  await page.locator('.profile-hero h2', { hasText: 'Ohne Konto' }).waitFor();
  assert.match(await page.locator('.stats').innerText(), /1\s*Einheiten/);
  await page.locator('.social-cta', { hasText: 'Mit Freunden vergleichen' }).waitFor();
  // Einstellungen erreichbar, Export ohne Konto vorhanden
  await page.locator('.hdr-btn[href="#/settings"]').click();
  await page.locator('a[href="#/settings/backup"]').click();
  await page.locator('[data-action="export"]').waitFor();
  // Freunde-Seiten ohne Konto: Hinweis statt Fehler
  await page.goto(base + '/#/friends/add');
  await page.locator('.social-cta').waitFor();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.data.v1')));
  assert.equal(data.sessions.length, 1);
  assert.equal(data.nutrition.length, 1);
  await ctx.close();
});

test('Freunde: Registrierung, Profil mit Foto, Anfrage, Vergleich, Rangliste, offline, entfernen, Konto löschen', async () => {
  const A = await device('anna');
  const B = await device('ben');
  const C = await device('cleo');

  // --- Registrierung + Profil (A mit Foto, das in Cloud Storage landet) ---
  await register(A.page, 'anna@test.de');
  await createProfile(A.page, 'anna', true);
  const src = await A.page.locator('.profile-hero .avatar img').getAttribute('src');
  assert.match(src, /^http:\/\/127\.0\.0\.1:9199\/.*avatars%2F.*\.jpg/);
  const img = await (await fetch(src)).arrayBuffer();
  assert.ok(img.byteLength > 1000 && img.byteLength < 200000, 'Foto verkleinert/komprimiert: ' + img.byteLength);

  await register(B.page, 'ben@test.de');
  // Benutzername schon vergeben → Hinweis
  await B.page.fill('#pedit-username', 'anna');
  await B.page.locator('#uname-status .bad', { hasText: 'vergeben' }).waitFor();
  await B.page.fill('#pedit-username', 'Ben!');
  await B.page.locator('#uname-status .bad').waitFor();
  await createProfile(B.page, 'ben', false);
  await B.page.locator('.profile-hero .avatar.avatar-empty').waitFor(); // grauer Platzhalter ohne Foto
  await logBench(B.page, 100, 5);

  // --- Anfrage senden (B → A) ---
  await B.page.locator('a[href="#/friends/add"]').click();
  await B.page.locator('#invite-qr svg').waitFor(); // QR-Code mit Einladungslink
  await B.page.fill('#friend-q', 'an');
  const row = B.page.locator('#friend-results .person', { hasText: '@anna' });
  await row.locator('img').waitFor(); // Foto in der Suche
  await row.locator('[data-action="friend-request"]').click();
  await row.locator('.tag', { hasText: 'Angefragt' }).waitFor();

  // --- A: Punkt am Reiter, annehmen ---
  await A.page.locator('#tab-dot-profile:not([hidden])').waitFor();
  await A.page.locator('a[href="#/friends/requests"]').click();
  await A.page.locator('.person', { hasText: '@ben' }).locator('[data-action="friend-accept"]').click();
  await toastText(A.page).filter({ hasText: 'befreundet' }).waitFor();
  assert.equal(await A.page.locator('#tab-dot-profile').isHidden(), true);
  await A.page.locator('.hdr-btn[aria-label="Zurück"]').click();
  await A.page.locator('.list .person', { hasText: '@ben' }).waitFor();
  await A.page.locator('.list .person', { hasText: 'trainiert' }).waitFor(); // letzte Aktivität

  // --- Vergleich ohne gemeinsame Übungen (A hat noch nichts trainiert) ---
  await A.page.locator('.list .person', { hasText: '@ben' }).click();
  await waitHash(A.page, /#\/friend\//);
  await A.page.locator('.cmp', { hasText: 'Trainings insgesamt' }).waitFor();
  assert.match(await A.page.locator('.cmp', { hasText: 'Trainings insgesamt' }).innerText(), /Du\s*0[\s\S]*@ben\s*1/);
  await A.page.locator('.card', { hasText: 'Rekorde bei gemeinsamen Übungen' }).locator('text=Noch keine gemeinsamen Übungen').waitFor();

  // --- A trainiert Bankdrücken → gemeinsame Übung, Vergleich bei B ---
  await logBench(A.page, 80, 8);
  await A.page.waitForTimeout(1500);
  await B.page.reload();
  await B.page.goto(base + '/#/profile');
  await B.page.locator('.list .person', { hasText: '@anna' }).click();
  const rec = B.page.locator('.cmp', { hasText: 'Bankdrücken' });
  await rec.waitFor();
  assert.match(await rec.innerText(), /Du\s*100 kg[\s\S]*@anna\s*80 kg/);
  await B.page.locator('[data-action="rec-mode"][data-mode="e"]').click();
  assert.match(await B.page.locator('.cmp', { hasText: 'Bankdrücken' }).innerText(), /116,7 kg[\s\S]*101,3 kg/);
  // Keine Sätze/Notizen/Ernährung des Freundes sichtbar – nur Kennzahlen
  const shared = await B.page.evaluate(() => JSON.stringify(window.GymApp.Social.people));
  assert.ok(!/weight|reps|note|nutrition|kcal/.test(shared), shared);

  // --- Rangliste ---
  await B.page.goto(base + '/#/leaderboard');
  await B.page.locator('.lb-row').nth(1).waitFor();
  await B.page.locator('[data-action="lb-metric"][data-value="vol7"]').click();
  // Volumen: anna 80×8 = 640 kg vor ben 100×5 = 500 kg
  assert.match(await B.page.locator('.lb-row').nth(0).innerText(), /1[\s\S]*@anna[\s\S]*640 kg/);
  assert.match(await B.page.locator('.lb-row').nth(1).innerText(), /2[\s\S]*Du[\s\S]*500 kg/);
  await B.page.locator('[data-action="lb-metric"][data-value="total"]').click();
  assert.match(await B.page.locator('.lb-row').nth(1).innerText(), /1[\s\S]*1 Einheit/); // Gleichstand → gleicher Platz

  // --- Offline: zuletzt geladene Freundesdaten mit Hinweis statt Fehler ---
  await B.ctx.setOffline(true);
  await B.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await B.page.evaluate(() => { const S = window.GymApp.Social; S.detach(); S.attach(); }); // wie ein Neustart ohne Netz
  await B.page.goto(base + '/#/profile');
  await B.page.locator('.list .person', { hasText: '@anna' }).waitFor();
  await B.page.locator('.offline-note', { hasText: 'zuletzt aktualisiert am' }).waitFor();
  await B.page.locator('.list .person', { hasText: '@anna' }).click();
  await B.page.locator('.cmp', { hasText: 'Bankdrücken' }).waitFor();
  await B.page.locator('.offline-note').waitFor();
  await B.page.goto(base + '/#/friends/add');
  await B.page.fill('#friend-q', 'cl');
  await B.page.locator('#friend-results', { hasText: 'nur mit Internetverbindung' }).waitFor();
  // Training funktioniert offline weiter
  await logBench(B.page, 102.5, 5);
  await B.ctx.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')));

  // --- Ablehnen: C → A ---
  await register(C.page, 'cleo@test.de');
  await createProfile(C.page, 'cleo', false);
  await C.page.goto(base + '/#/invite/anna'); // Einladungslink
  await C.page.locator('.profile-hero h2', { hasText: '@anna' }).waitFor();
  await C.page.locator('[data-action="friend-request"]').click();
  await C.page.locator('[data-action="friend-cancel"]').waitFor();
  await A.page.goto(base + '/#/friends/requests');
  await A.page.locator('.person', { hasText: '@cleo' }).locator('[data-action="friend-decline"]').click();
  await toastText(A.page).filter({ hasText: 'abgelehnt' }).waitFor();
  await A.page.locator('.empty', { hasText: 'Keine offenen Anfragen' }).waitFor();
  await C.page.goto(base + '/#/friends/requests');
  await C.page.locator('[data-action="req-tab"][data-tab="out"]').click();
  await C.page.locator('.empty', { hasText: 'keine offenen Anfragen gesendet' }).waitFor();

  // --- Freund entfernen (mit Bestätigung) ---
  await B.page.goto(base + '/#/profile');
  await B.page.locator('.list .person', { hasText: '@anna' }).click();
  await B.page.locator('[data-action="friend-menu"]').click();
  await dlgButton(B.page, 'Freund entfernen').click();
  await dlgButton(B.page, 'Entfernen').click();
  await waitHash(B.page, /#\/profile$/);
  await B.page.locator('.empty', { hasText: 'Noch keine Freunde' }).waitFor();
  await A.page.goto(base + '/#/profile');
  await A.page.locator('.empty', { hasText: 'Noch keine Freunde' }).waitFor();

  // --- Abmelden: lokale Trainingsdaten bleiben auf dem Gerät ---
  await B.page.goto(base + '/#/settings/account');
  await B.page.locator('[data-action="logout"]').click();
  await dlgButton(B.page, 'Abmelden').click();
  await waitHash(B.page, /#\/login/);
  const guest = await B.page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.data.v1')));
  assert.equal(guest.sessions.length, 2);
  assert.equal(await B.page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('gymtracker.social.v1.'))), false);
  // Wieder anmelden: keine Rückfrage, Daten und Profil sind da
  await B.page.fill('input[name="email"]', 'ben@test.de');
  await B.page.fill('input[name="password"]', 'geheim123');
  await B.page.locator('#auth-submit').click();
  await waitHash(B.page, /#\/$/);
  await B.page.waitForTimeout(500);
  assert.equal(await B.page.locator('.modal:not(.closing)').count(), 0, await B.page.locator('#modal-root').innerText());
  await B.page.goto(base + '/#/profile');
  await B.page.locator('.profile-hero h2', { hasText: '@ben' }).waitFor();
  assert.match(await B.page.locator('.stats').innerText(), /2\s*Einheiten/);

  // --- Konto löschen: alles in der Cloud weg, lokale Daten bleiben ---
  await A.page.goto(base + '/#/settings/account');
  await A.page.locator('[data-action="delete-account"]').click();
  await dlgButton(A.page, 'Weiter').click();
  await A.page.fill('.modal:not(.closing) #dlg-input', 'geheim123');
  await dlgButton(A.page, 'Konto endgültig löschen').click();
  await toastText(A.page).filter({ hasText: 'Konto gelöscht' }).waitFor();
  await waitHash(A.page, /#\/login/);
  const local = await A.page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.data.v1')));
  assert.equal(local.sessions.length, 1);
  assert.equal((await (await fetch(src)).status) === 200, false, 'Foto gelöscht');
  await C.page.goto(base + '/#/friends/add');
  await C.page.fill('#friend-q', 'anna');
  await C.page.locator('#friend-results', { hasText: 'Niemand mit „anna“ gefunden' }).waitFor();
  // Firestore direkt (am Regelwerk vorbei) prüfen: kein Rest von anna
  const docs = await (await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/usernames`, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.deepEqual((docs.documents || []).map((d) => d.name.split('/').pop()).sort(), ['ben', 'cleo']);
  const profiles = await (await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/publicProfiles`, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.equal(profiles.documents.length, 2);

  for (const p of pages) toastLog.push(...await p.page.evaluate(() => window.__toasts || []).catch(() => []));
  await Promise.all([A.ctx.close(), B.ctx.close(), C.ctx.close()]);
  assert.deepEqual(errors, []);
  assert.ok(toastLog.some((t) => /befreundet/.test(t)), 'Toasts werden mitgeschrieben');
  assert.deepEqual(toastLog.filter((t) => /Fehler|fehlgeschlagen|nicht geklappt|Berechtigung/.test(t)), []);
});
