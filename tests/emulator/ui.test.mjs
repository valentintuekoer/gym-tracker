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
async function device(name, { cloud = true, tz } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'de-DE', reducedMotion: 'reduce', ...(tz ? { timezoneId: tz } : {}),
    geolocation: { latitude: 52.5200081, longitude: 13.4049541, accuracy: 12 }, permissions: ['geolocation'] });
  await ctx.route('https://maps.apple.com/**', (r) => r.fulfill({ contentType: 'text/html', body: 'Apple Karten' }));
  await ctx.route('https://www.google.com/maps/**', (r) => r.fulfill({ contentType: 'text/html', body: 'Google Maps' }));
  await ctx.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: EMU_CONFIG }));
  await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
    if (!cloud) return r.abort();
    const file = path.join(SDK_DIR, path.basename(new URL(r.request().url()).pathname));
    return r.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(file) });
  });
  // iOS-Audiosteuerung nachbilden (Chromium hat sie nicht) und mitzählen, wann ein Audiokanal geöffnet wird
  await ctx.addInitScript(() => {
    window.__audioTypes = [];
    let type = 'auto';
    if (!('audioSession' in navigator)) {
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { get type() { return type; }, set type(v) { type = v; window.__audioTypes.push(v); } } });
    }
    window.__acCount = 0;
    const AC = window.AudioContext;
    window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__acCount++; window.__acType = navigator.audioSession.type; } };
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
  // Seitenübergang abwarten: währenddessen nimmt der Browser keine Taps an (Playwright würde sonst mit
  // erzwungenem Scrollen erneut klicken – im Training springt das Karussell dabei zur nächsten Übung)
  await page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 0)));
  await page.waitForFunction(() => !document.documentElement.dataset.nav);
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

test('Ohne Konto und ohne Firebase: Training, Timer, Bibliothek, Verlauf, Profil', async () => {
  const { ctx, page } = await device('gast', { cloud: false });
  await openApp(page);
  await page.locator('.btn.apple').waitFor(); // „Mit Apple anmelden“ wird angeboten
  await page.locator('[data-action="auth-guest"]').click();
  // Einrichtung mit Beispielplan
  await waitHash(page, /#\/setup/);
  for (let i = 0; i < 3; i++) await page.locator('[data-action="setup-next"]').click();
  await waitHash(page, /#\/$/);
  // Musik aus anderen Apps darf nicht pausieren: Ton ist auf „mischen“ gestellt, und solange keine Pause läuft,
  // wird gar kein Audiokanal geöffnet (schon das Öffnen würde unter iOS die Musik anhalten)
  assert.deepEqual(await page.evaluate(() => ({ type: navigator.audioSession.type, ctx: window.__acCount })), { type: 'ambient', ctx: 0 });
  await page.locator('.day-card', { hasText: 'Push' }).click();
  await page.locator('[data-action="open-day"]').click();
  await waitHash(page, /#\/workout/);
  // Aufwärmsätze aus dem Arbeitsgewicht berechnen lassen
  await page.locator('.wk-slide').first().locator('[data-action="w-warmup"]').click();
  await page.fill('#warm-form [name="work"]', '80');
  await page.locator('#warm-preview li').nth(2).waitFor();
  await dlgButton(page, 'Einfügen').click();
  await page.locator('.wk-slide').first().locator('.set.warm').nth(2).waitFor();
  assert.match(await page.locator('.wk-slide').first().locator('.ex-head .count').innerText(), /^0\/\d$/); // zählt nur Arbeitssätze
  // Satz eintragen und abhaken → Pausentimer läuft
  const set = page.locator('.wk-slide').first().locator('.set:not(.warm)').first();
  await set.locator('input[data-field="weight"]').fill('60');
  await set.locator('input[data-field="reps"]').fill('10');
  await set.locator('[data-action="set-toggle"]').click();
  await page.locator('#timer-bar.show').waitFor();
  // Mit der ersten Pause öffnet sich der Audiokanal – bereits im „mischen“-Modus
  assert.deepEqual(await page.evaluate(() => ({ type: navigator.audioSession.type, ctx: window.__acCount, atOpen: window.__acType })), { type: 'ambient', ctx: 1, atOpen: 'ambient' });
  // Im Training steht die Seite fest: kein Scrollen nach unten, nur seitlich wischen
  const lock = await page.evaluate(async () => {
    window.scrollTo(0, 400);
    await new Promise((r) => setTimeout(r, 50));
    const se = document.scrollingElement;
    return { y: window.scrollY, fits: se.scrollHeight <= window.innerHeight + 1, cls: document.body.classList.contains('wk-lock') };
  });
  assert.deepEqual(lock, { y: 0, fits: true, cls: true });
  await page.locator('.wk-next-link').click(); // zur nächsten Übung
  await page.waitForFunction(() => document.getElementById('wk-track').scrollLeft > 100);
  await page.locator('#wk-pos', { hasText: /2 von/i }).waitFor(); // Beschriftung folgt im nächsten Frame
  // Viele Sätze → nur die Karte scrollt, die Seite bleibt stehen
  await page.evaluate(() => { const s = window.GymApp.db.activeSession; for (let i = 0; i < 8; i++) window.GymApp.Core.addSet(window.GymApp.db, s.exercises[1].id); window.GymApp.render(); });
  const inner = await page.evaluate(() => {
    const sl = document.querySelectorAll('.wk-slide')[1];
    sl.scrollTop = 300;
    return { slide: sl.scrollTop > 0, page: document.scrollingElement.scrollHeight <= window.innerHeight + 1 };
  });
  assert.deepEqual(inner, { slide: true, page: true });
  await page.locator('[data-timer="skip"]').click();
  await page.locator('.app-header [data-action="finish"]').click();
  await dlgButton(page, 'Speichern').click();
  await waitHash(page, /#\/summary\//);
  await page.locator('[data-action="summary-done"]').first().click();
  // Chat: Reiter ist da, ohne Konto kommt der Hinweis zum Anmelden
  await page.locator('.tab[data-tab="chat"]').click();
  await waitHash(page, /#\/chat/);
  await page.locator('.social-cta h2', { hasText: 'Chats' }).waitFor();
  await page.locator('.tab[data-tab="home"]').click();
  await waitHash(page, /#\/$/);
  // Mein Gym: festlegen (Adresse + GPS-Standort) → Route öffnet die Karten-App
  await page.locator('[data-action="gym-edit"]').click();
  await page.fill('#gym-form input[name="name"]', 'FitX Mitte');
  await page.fill('#gym-form input[name="address"]', 'Hauptstraße 1, 10115 Berlin');
  await page.locator('#gym-form [data-locate]').click();
  await page.locator('#gym-pos', { hasText: 'Standort gespeichert' }).waitFor();
  await page.locator('#gym-maps [data-maps="apple"]').click();
  await page.locator('#gym-form button[type="submit"]').click();
  await page.locator('.gym-card', { hasText: 'FitX Mitte' }).waitFor();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    (async () => { await page.locator('[data-action="gym-route"]').click(); await dlgButton(page, 'Zu Fuß').click(); })(),
  ]);
  assert.equal(popup.url().split('#')[0], 'https://maps.apple.com/?daddr=52.520008%2C13.404954&dirflg=w');
  await popup.close();
  // Vier Reiter: Training, Daily, Chat, Profil – Verlauf und Bibliothek öffnen sich aus dem Profil; ein Kalorien-Tagebuch gibt es nicht mehr
  assert.deepEqual(await page.locator('.tab').evaluateAll((els) => els.map((e) => e.dataset.tab)), ['home', 'daily', 'chat', 'profile']);
  await page.locator('.tab[data-tab="profile"]').click();
  await page.locator('.profile-hero h2', { hasText: 'Ohne Konto' }).waitFor();
  assert.equal(await page.locator('a[href="#/food"]').count(), 0);
  await page.goto(base + '/#/food'); // die alte Adresse führt einfach zur Startseite statt zu einem Fehler
  await page.locator('.large-title', { hasText: 'Training' }).waitFor();
  await page.locator('.tab[data-tab="profile"]').click();
  await page.locator('.profile-hero h2', { hasText: 'Ohne Konto' }).waitFor();
  // Bibliothek lädt die Übungen
  await page.locator('a[href="#/library"]').click();
  await page.locator('.section-label', { hasText: 'Alle Übungen (207)' }).waitFor();
  await page.locator('.app-header a.hdr-btn[href="#/profile"]').click();
  // Verlauf zeigt die Einheit
  await page.locator('a[href="#/history"]').click();
  await page.locator('.list-item.card-like', { hasText: 'Push' }).waitFor();
  await page.locator('.app-header a.hdr-btn[href="#/profile"]').click();
  // Profil ohne Konto: eigene Kennzahlen + Hinweis, keine Fehler
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
  assert.equal(data.nutrition, undefined);
  assert.equal(data.foods, undefined);
  await ctx.close();
});

test('Daily: Gewicht eintragen, Mealplan anlegen, jeden Tag abhaken', async () => {
  const errorsBefore = errors.length;
  const { ctx, page } = await device('daily', { cloud: false });
  await openApp(page);
  await page.locator('[data-action="auth-guest"]').click();
  await waitHash(page, /#\/setup/);
  for (let i = 0; i < 3; i++) await page.locator('[data-action="setup-next"]').click();
  await waitHash(page, /#\/$/);
  await page.locator('.tab[data-tab="daily"]').click();
  await waitHash(page, /#\/daily/);
  await page.locator('.large-title', { hasText: 'Daily' }).waitFor();

  // Gewicht: ungültig wird abgelehnt, gültig gespeichert (Komma ok) und danach geändert statt doppelt angelegt
  await page.fill('#weight-form input[name="weight"]', '5');
  await page.locator('#weight-form button[type="submit"]').click();
  await page.locator('.toast-msg', { hasText: 'zwischen 20 und 500 kg' }).waitFor();
  await page.fill('#weight-form input[name="weight"]', '82,46');
  await page.locator('#weight-form button[type="submit"]').click();
  await page.locator('.daily-head .count', { hasText: 'gespeichert' }).waitFor();
  assert.equal(await page.locator('#weight-form input[name="weight"]').inputValue(), '82,5');
  await page.fill('#weight-form input[name="weight"]', '81,9');
  await page.locator('#weight-form button[type="submit"]').click();
  await page.waitForFunction(() => window.GymApp.db.body.length === 1 && window.GymApp.db.body[0].weight === 81.9);

  // Mealplan: leer → Beispielplan → eigene Mahlzeit mit Uhrzeit, Beschreibung, Kalorien
  await page.locator('[data-action="meal-sample"]').click();
  assert.equal(await page.locator('.meal-row').count(), 4);
  await page.locator('a[href="#/daily/plan"]').click();
  await waitHash(page, /#\/daily\/plan/);
  await page.locator('.hdr-btn[data-action="meal-add"]').click();
  await page.fill('.modal:not(.closing) #meal-form input[name="name"]', 'Shake nach dem Training');
  await page.fill('.modal:not(.closing) #meal-form input[name="time"]', '18:45');
  await page.fill('.modal:not(.closing) #meal-form input[name="kcal"]', '320');
  await page.fill('.modal:not(.closing) #meal-form input[name="note"]', 'Whey + Banane');
  await page.locator('.modal:not(.closing) #meal-form button[type="submit"]').click();
  await page.locator('.meal-edit', { hasText: 'Shake nach dem Training' }).waitFor();
  // Reihenfolge ändern: nach oben
  await page.locator('.meal-edit', { hasText: 'Shake nach dem Training' }).locator('[data-action="meal-up"]').click();
  await page.waitForFunction(() => window.GymApp.db.settings.mealPlan[3].name === 'Shake nach dem Training');
  // Name ändern
  await page.locator('.meal-edit-main', { hasText: 'Snack' }).click();
  await page.fill('.modal:not(.closing) #meal-form input[name="name"]', 'Mittags-Snack');
  await page.locator('.modal:not(.closing) #meal-form button[type="submit"]').click();
  await page.locator('.meal-edit', { hasText: 'Mittags-Snack' }).waitFor();
  await page.locator('.app-header a.hdr-btn[href="#/daily"]').click();
  await waitHash(page, /#\/daily$/);

  // Abhaken: Fortschritt, Kalorien, Durchgestrichen, bleibt nach dem Neuladen erhalten
  assert.equal(await page.locator('.meal-row').count(), 5);
  await page.locator('.meal-row', { hasText: 'Frühstück' }).click();
  await page.locator('.meal-row.done', { hasText: 'Frühstück' }).waitFor();
  await page.locator('.meal-row', { hasText: 'Shake nach dem Training' }).click();
  await page.locator('.daily-head .count', { hasText: '2 / 5' }).waitFor();
  await page.locator('.daily-meals .daily-sub', { hasText: '320 von 320 kcal' }).waitFor();
  assert.equal(await page.locator('.meal-row[aria-checked="true"]').count(), 2);
  assert.equal(await page.locator('.dstrip-day.sel .dstrip-dot.part').count(), 1);
  await page.reload();
  await page.locator('.meal-row.done', { hasText: 'Frühstück' }).waitFor();
  assert.equal(await page.locator('.meal-row[aria-checked="true"]').count(), 2);
  // wieder lösen
  await page.locator('.meal-row.done', { hasText: 'Frühstück' }).click();
  await page.locator('.daily-head .count', { hasText: '1 / 5' }).waitFor();

  // Gestern nachtragen: eigener Stand pro Tag
  await page.locator('.dstrip-day').nth(5).click();
  await page.locator('.dstrip-day.sel').nth(0).waitFor();
  assert.equal(await page.locator('.meal-row[aria-checked="true"]').count(), 0);
  await page.locator('.meal-row', { hasText: 'Abendessen' }).click();
  await page.locator('.daily-head .count', { hasText: '1 / 5' }).waitFor();
  await page.locator('.dstrip-day').nth(6).click(); // heute: unverändert 1 / 5 (Shake)
  assert.equal(await page.locator('.meal-row[aria-checked="true"]').count(), 1);

  // Alles gespeichert: Mealplan, Abhak-Verlauf und Gewicht (inkl. Verlauf → Körper)
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.data.v1')));
  assert.equal(data.settings.mealPlan.length, 5);
  assert.equal(Object.keys(data.settings.mealLog).length, 2);
  assert.equal(data.body[0].weight, 81.9);
  // Mahlzeit löschen räumt auch den Abhak-Verlauf auf
  await page.locator('a[href="#/daily/plan"]').click();
  await page.locator('.meal-edit', { hasText: 'Shake nach dem Training' }).locator('[data-action="meal-del"]').click();
  await dlgButton(page, 'Löschen').click();
  await page.locator('.meal-edit', { hasText: 'Shake nach dem Training' }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => Object.values(window.GymApp.db.settings.mealLog).flat().length), 1);
  // „Alle Messungen“ führt zum Verlauf (Körper), der Zurück-Pfeil zurück zu Daily
  await page.locator('.app-header a.hdr-btn[href="#/daily"]').click();
  await waitHash(page, /#\/daily$/);
  await page.locator('[data-action="open-body"]').click();
  await waitHash(page, /#\/history/);
  await page.locator('.body-tile', { hasText: 'Körpergewicht' }).waitFor();
  assert.equal(await page.locator('.tab.active').getAttribute('data-tab'), 'daily');
  await page.locator('.app-header a.hdr-btn[href="#/daily"]').click();
  await waitHash(page, /#\/daily$/);
  assert.equal(errors.length, errorsBefore, errors.slice(errorsBefore).join('\n'));
  await ctx.close();
});

test('Nach einem Update mit alter Cloud-Anbindung im Cache: einmal neu laden, dann klarer Hinweis', async () => {
  const OLD = process.env.OLD_CLOUD_JS; // cloud.js der Vorversion (ohne Freunde)
  if (!OLD || !fs.existsSync(OLD)) return;
  const { ctx, page } = await device('update');
  await register(page, 'update@test.de');
  await createProfile(page, 'updater', false);
  // wie ein iPhone, das noch die alte cloud.js aus dem Cache liefert
  await ctx.route('**/cloud.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(OLD) }));
  await page.reload();
  await page.waitForFunction(() => sessionStorage.getItem('gymtracker.updateReload') === '1');
  await page.waitForFunction(() => window.GymCloud && window.GymApp && location.hash === '#/profile' && performance.getEntriesByType('navigation')[0].type === 'reload' && document.readyState === 'complete');
  const note = page.locator('.offline-note', { hasText: 'Die App wurde aktualisiert' });
  try { await note.waitFor(); } catch (e) {
    console.log('DEBUG', await page.evaluate(() => document.querySelector('#view').innerText.slice(0, 400)));
    throw e;
  }
  await note.locator('[data-action="social-retry"]', { hasText: 'Neu laden' }).waitFor();
  // Mit der aktuellen cloud.js ist wieder alles verbunden
  await ctx.unroute('**/cloud.js');
  await Promise.all([page.waitForEvent('load'), note.locator('[data-action="social-retry"]').click()]);
  await page.locator('.profile-hero h2', { hasText: '@updater' }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.offline-note').count(), 0);
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
  const initial = B.page.locator('.profile-hero .avatar.avatar-initial'); // ohne Foto: großer Anfangsbuchstabe auf Farbe
  await initial.waitFor();
  assert.equal((await initial.textContent()).trim(), 'B');
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
  // App neu öffnen, während angemeldet: Anmeldung wird erst nach dem Laden von Firebase wiederhergestellt
  await B.page.reload();
  await B.page.goto(base + '/#/settings/account');
  await B.page.locator('#sync-status', { hasText: 'Synchronisiert' }).waitFor();
  await B.page.goto(base + '/#/profile');
  await B.page.waitForTimeout(1500);
  assert.equal(await B.page.locator('.offline-note').count(), 0, 'nach Neustart mit Freunden verbunden');
  assert.equal(await B.page.evaluate(() => !!window.GymApp.Social.unsub), true);
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
  const names = (docs.documents || []).map((d) => d.name.split('/').pop());
  assert.ok(!names.includes('anna') && names.includes('ben') && names.includes('cleo'), names.join(','));
  const profiles = await (await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/publicProfiles`, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.ok(!profiles.documents.some((d) => d.fields.username.stringValue === 'anna'));

  for (const p of pages) toastLog.push(...await p.page.evaluate(() => window.__toasts || []).catch(() => []));
  await Promise.all([A.ctx.close(), B.ctx.close(), C.ctx.close()]);
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.ok(toastLog.some((t) => /befreundet/.test(t)), 'Toasts werden mitgeschrieben');
  assert.deepEqual(toastLog.filter((t) => /Fehler|fehlgeschlagen|nicht geklappt|Berechtigung/.test(t)), []);
});

test('Chat: Nachrichten in Echtzeit, Gym-Karte, mitkommen, Wiener Zeit, Fehler mit Retry, melden/blockieren, Nachladen', async () => {
  const shots = process.env.CHAT_SHOTS;
  const shot = async (page, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
  await resetEmulators();
  const A = await device('chat-anna');
  const B = await device('chat-ben', { tz: 'Pacific/Auckland' }); // Gerät in Neuseeland: der Chat zeigt trotzdem Wiener Zeit
  await register(A.page, 'chatanna@test.de');
  await createProfile(A.page, 'chatanna', false);
  await register(B.page, 'chatben@test.de');
  await createProfile(B.page, 'chatben', false);
  const list = (p) => p.locator('#chat-list');
  const openChat = async (p) => { await p.locator('.tab[data-tab="chat"]').click(); await p.locator('a.chat-row[href="#/chat/gym"]').click(); await waitHash(p, /#\/chat\/gym/); await p.locator('#chat-input').waitFor(); };

  // --- A: leerer Chat, erste Nachricht (Enter sendet) ---
  await openChat(A.page);
  await A.page.locator('.chat-empty').waitFor();
  await A.page.locator('.today-empty').waitFor();
  await shot(A.page, '1-leer');
  await A.page.fill('#chat-input', 'Wer ist heute dabei?');
  await A.page.press('#chat-input', 'Enter');
  const mine = list(A.page).locator('.msg.mine .bubble', { hasText: 'Wer ist heute dabei?' });
  await mine.waitFor();
  await shot(A.page, '1b-nachricht');
  assert.equal(await A.page.inputValue('#chat-input'), ''); // Feld ist wieder leer
  // Eigene Nachricht rechts: Mitte der Blase rechts von der Bildschirmmitte
  // Position messen, sobald die Liste fertig gezeichnet ist (sie wird bei jedem Stand neu aufgebaut)
  const bubbleX = (page, sel, text) => page.waitForFunction(([s, t]) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? r.x + r.width / 2 : false;
  }, [sel, text]).then((h) => h.jsonValue());
  assert.ok(await bubbleX(A.page, '#chat-list .msg.mine .bubble', 'Wer ist heute dabei?') > 195, 'eigene Nachricht rechts');
  // Zu schnell hintereinander: Hinweis, Text bleibt im Feld
  await A.page.fill('#chat-input', 'zweite sofort');
  await A.page.press('#chat-input', 'Enter');
  await toastText(A.page).filter({ hasText: 'kurz warten' }).waitFor();
  assert.equal(await A.page.inputValue('#chat-input'), 'zweite sofort');
  await A.page.fill('#chat-input', '');

  // --- B (auf dem Profil-Reiter): Punkt am Chat-Reiter, dann Nachricht links mit Name ---
  await B.page.locator('#tab-dot-chat:not([hidden])').waitFor().catch(async (e) => {
    throw new Error(e.message + ' | Chat-Zustand: ' + JSON.stringify(await B.page.evaluate(() => { const c = window.GymApp.Chat; return { uid: c.uid, verbunden: !!c.unsub, bereit: c.ready, fehler: c.error && (c.error.code || String(c.error)), aktiv: c.enabled(), gesehen: c.seenAt && c.seenAt.gym, anzahl: c.store.size, route: location.hash, cloud: !!(window.GymCloud && window.GymCloud.chat) }; })));
  });
  await openChat(B.page);
  assert.equal(await B.page.locator('#tab-dot-chat').isHidden(), true);
  const theirs = list(B.page).locator('.msg.theirs .bubble', { hasText: 'Wer ist heute dabei?' });
  await theirs.waitFor();
  assert.ok(await bubbleX(B.page, '#chat-list .msg.theirs .bubble', 'Wer ist heute dabei?') < 195, 'fremde Nachricht links');
  await list(B.page).locator('.msg-name', { hasText: '@chatanna' }).waitFor();
  assert.match(await list(B.page).locator('.msg.theirs .msg-meta').first().innerText(), /^\d\d:\d\d/); // 24-h-Zeit

  // --- A: „Ich gehe ins Gym“ → Karte (heute 23:55, Push) ---
  await sleepMs(2300);
  await A.page.locator('[data-action="chat-plan"]').click();
  const form = A.page.locator('#plan-form');
  await form.waitFor();
  await form.locator('select[name="hour"]').selectOption('23');
  await form.locator('select[name="minute"]').selectOption('55');
  await form.locator('[data-workout="push"]').click();
  await form.locator('[data-workout="push"][aria-pressed="true"]').waitFor();
  await form.locator('[data-workout="cardio"]').click();
  await form.locator('[data-workout="cardio"]').click(); // erneut tippen = abwählen
  await form.locator('[data-workout="push"]').click();
  await form.locator('input[name="note"]').fill('Brust & Schulter <b>fett</b>');
  assert.match(await A.page.locator('#plan-preview').innerText(), /Heute, 23:55 Uhr · Push/);
  await shot(A.page, '2-formular');
  // Vergangenes Datum: Fehler im Formular
  await form.locator('input[name="date"]').fill('2020-01-01');
  await dlgButtonSubmit(A.page).click();
  await A.page.locator('#plan-error', { hasText: /Vergangenheit|Datum/ }).waitFor();
  await form.locator('input[name="date"]').fill(await A.page.evaluate(() => window.GymApp.Core.viennaDayKey(Date.now())));
  await dlgButtonSubmit(A.page).click();
  const plan = list(A.page).locator('.plan', { hasText: 'Heute, 23:55 Uhr' });
  await plan.waitFor();
  assert.match(await plan.innerText(), /Push/);
  assert.match(await plan.innerText(), /<b>fett<\/b>/); // als Text, nicht als HTML
  assert.equal(await plan.locator('b').count(), 0);
  assert.equal(await plan.locator('[data-action="chat-join"]').count(), 0); // eigene Karte: kein „Mitkommen“
  await A.page.locator('.today-item', { hasText: '23:55' }).waitFor();

  // --- B: sieht Karte (auch in Neuseeland um 23:55 Wiener Zeit), kommt mit ---
  const planB = list(B.page).locator('.plan', { hasText: 'Heute, 23:55 Uhr' });
  await planB.waitFor();
  await B.page.locator('.today-item', { hasText: '23:55' }).waitFor();
  await planB.locator('.plan-people.muted').waitFor();
  await planB.locator('[data-action="chat-join"]', { hasText: 'Ich komme mit' }).click();
  await planB.locator('[data-action="chat-join"]', { hasText: 'doch nicht' }).waitFor();
  await planB.locator('.plan-people', { hasText: '@chatben kommt mit' }).waitFor();
  await shot(B.page, '3-mitgekommen');
  // A sieht die Teilnehmerliste live
  await list(A.page).locator('.plan .plan-people', { hasText: '@chatben kommt mit' }).waitFor();
  await A.page.locator('.today-item', { hasText: '+1' }).waitFor();
  await shot(A.page, '4-teilnehmer');
  // B tritt wieder aus
  await planB.locator('[data-action="chat-join"]').click();
  await planB.locator('.plan-people.muted').waitFor();
  await list(A.page).locator('.plan .plan-people.muted').waitFor();
  await planB.locator('[data-action="chat-join"]', { hasText: 'Ich komme mit' }).click();
  await planB.locator('.plan-people', { hasText: '@chatben kommt mit' }).waitFor();

  // --- B: Offline → „Nicht gesendet“ mit Retry; wieder online → erneut senden klappt ---
  await sleepMs(1500);
  await B.ctx.setOffline(true);
  await B.page.locator('.chat-note', { hasText: 'Offline' }).waitFor();
  await B.page.fill('#chat-input', 'Ich bin um 18 Uhr da');
  await B.page.press('#chat-input', 'Enter');
  const failed = list(B.page).locator('.msg.failed');
  await failed.locator('.msg-state', { hasText: 'Keine Verbindung' }).waitFor();
  await shot(B.page, '5-offline');
  await B.ctx.setOffline(false);
  await B.page.locator('.chat-note').waitFor({ state: 'detached' }).catch(() => {});
  await B.page.waitForFunction(() => !document.querySelector('.chat-note'), null, { timeout: 30000 });
  await failed.locator('[data-action="chat-retry"]').click();
  await list(B.page).locator('.msg.mine:not(.failed):not(.pending) .bubble', { hasText: 'Ich bin um 18 Uhr da' }).waitFor({ timeout: 30000 });
  assert.equal(await list(B.page).locator('.msg.failed').count(), 0);
  await list(A.page).locator('.msg.theirs .bubble', { hasText: 'Ich bin um 18 Uhr da' }).waitFor();
  // „Verwerfen“
  await B.ctx.setOffline(true);
  await sleepMs(2300);
  await B.page.fill('#chat-input', 'wird verworfen');
  await B.page.press('#chat-input', 'Enter');
  await list(B.page).locator('.msg.failed [data-action="chat-discard"]').click();
  assert.equal(await list(B.page).locator('.msg', { hasText: 'wird verworfen' }).count(), 0);
  await B.ctx.setOffline(false);
  await B.page.waitForFunction(() => !document.querySelector('.chat-note'), null, { timeout: 30000 });

  // --- A: melden, blockieren, entsperren ---
  await list(A.page).locator('.msg.theirs .bubble', { hasText: 'Ich bin um 18 Uhr da' }).click();
  await dlgButton(A.page, 'Melden').click();
  await dlgButton(A.page, 'Spam oder Werbung').click();
  await toastText(A.page).filter({ hasText: 'Meldung ist angekommen' }).waitFor();
  const reports = await (await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/reports`, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.equal(reports.documents.length, 1);
  assert.equal(reports.documents[0].fields.targetName.stringValue, 'chatben');
  assert.equal(reports.documents[0].fields.reason.stringValue, 'spam');
  await list(A.page).locator('.msg.theirs .bubble', { hasText: 'Ich bin um 18 Uhr da' }).click();
  await dlgButton(A.page, '@chatben blockieren').click();
  await dlgButton(A.page, 'Blockieren').click();
  await list(A.page).locator('.msg.theirs').first().waitFor({ state: 'detached' });
  assert.equal(await list(A.page).locator('.plan .plan-people', { hasText: 'chatben' }).count(), 1); // Teilnahme steht weiter auf der eigenen Karte
  await A.page.goto(base + '/#/settings/chat');
  await A.page.locator('.row', { hasText: '@chatben' }).locator('[data-action="chat-unblock"]').click();
  await A.page.locator('.empty', { hasText: 'niemanden blockiert' }).waitFor();
  await openChat(A.page);
  await list(A.page).locator('.msg.theirs .bubble', { hasText: 'Ich bin um 18 Uhr da' }).waitFor();

  // --- Eigene Nachricht bearbeiten und löschen (A) ---
  await sleepMs(2300);
  await A.page.fill('#chat-input', 'Tippfehler');
  await A.page.press('#chat-input', 'Enter');
  await list(A.page).locator('.msg.mine .bubble', { hasText: 'Tippfehler' }).click();
  await dlgButton(A.page, 'Bearbeiten').click();
  await A.page.fill('.modal:not(.closing) #dlg-input', 'Korrigiert');
  await dlgButton(A.page, 'Speichern').click();
  await list(A.page).locator('.msg.mine .bubble', { hasText: 'Korrigiert' }).waitFor();
  await list(B.page).locator('.msg.theirs .bubble', { hasText: 'Korrigiert' }).waitFor();
  await list(B.page).locator('.msg.theirs .msg-meta', { hasText: 'bearbeitet' }).waitFor();
  await list(A.page).locator('.msg.mine .bubble', { hasText: 'Korrigiert' }).click();
  await dlgButton(A.page, 'Löschen').click();
  await dlgButton(A.page, 'Löschen').click();
  await list(B.page).locator('.msg .bubble', { hasText: 'Korrigiert' }).waitFor({ state: 'detached' });
  // Fremde Nachrichten bieten kein Bearbeiten/Löschen
  await list(B.page).locator('.msg.theirs .bubble', { hasText: 'Wer ist heute dabei?' }).click();
  assert.equal(await dlgButton(B.page, 'Löschen').count(), 0);
  await dlgButton(B.page, 'Abbrechen').click();

  // --- Verlauf: viele ältere Nachrichten werden beim Hochscrollen nachgeladen ---
  const docs = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/rooms/gym/messages`;
  const base0 = Date.now() - 3 * 86400000;
  await Promise.all(Array.from({ length: 70 }, (_, i) => fetch(docs, {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { uid: { stringValue: 'seed' }, name: { stringValue: 'verlauf' }, kind: { stringValue: 'text' }, text: { stringValue: 'alt ' + (i + 1) },
      createdAt: { timestampValue: new Date(base0 + i * 60000).toISOString() } } }),
  })));
  await A.page.reload();
  await list(A.page).locator('.msg').first().waitFor();
  await A.page.locator('#chat-list .bubble', { hasText: 'alt 70' }).waitFor();
  const first = await list(A.page).locator('.msg').count();
  assert.ok(first <= 40, 'zuerst nur die neuesten: ' + first);
  assert.equal(await list(A.page).locator('.bubble', { hasText: /^alt 1$/ }).count(), 0);
  await shot(A.page, '6-verlauf');
  // bis ganz nach oben scrollen → alles wird in Seiten nachgeladen, Position bleibt erhalten
  for (let i = 0; i < 6 && await list(A.page).locator('.chat-start').count() === 0; i++) {
    await A.page.evaluate(() => { document.getElementById('chat-list').scrollTop = 0; });
    await A.page.waitForFunction((n) => document.querySelectorAll('#chat-list .msg').length > n || document.querySelector('.chat-start'), await list(A.page).locator('.msg').count());
    await sleepMs(250);
  }
  await list(A.page).locator('.chat-start').waitFor();
  await list(A.page).locator('.bubble', { hasText: /^alt 1$/ }).waitFor();
  assert.ok(await A.page.evaluate(() => document.getElementById('chat-list').scrollTop) > 0, 'Position nach dem Nachladen erhalten');
  await list(A.page).locator('.chat-day span', { hasText: /^[A-Z][a-z]\., \d\d\.\d\d\.$/ }).first().waitFor(); // Tagestrenner „Mo., 12.10.“

  // --- Neue Nachricht, während A weit oben liest: kein Springen, dafür „Neue Nachrichten“ ---
  await sleepMs(2300);
  const readingAt = await A.page.evaluate(() => document.getElementById('chat-list').scrollTop);
  assert.ok(await A.page.evaluate(() => { const l = document.getElementById('chat-list'); return l.scrollHeight - l.scrollTop - l.clientHeight > 300; }), 'A liest weiter oben');
  await B.page.fill('#chat-input', 'Neu für A');
  await B.page.press('#chat-input', 'Enter');
  await A.page.locator('#chat-jump:not([hidden])').waitFor();
  assert.ok(Math.abs(await A.page.evaluate(() => document.getElementById('chat-list').scrollTop) - readingAt) < 5, 'Liste springt nicht');
  await A.page.locator('#chat-jump').click();
  await list(A.page).locator('.bubble', { hasText: 'Neu für A' }).waitFor();
  assert.equal(await A.page.evaluate(() => { const l = document.getElementById('chat-list'); return l.scrollHeight - l.scrollTop - l.clientHeight < 5; }), true);

  // --- Heller Modus und schmaler Bildschirm (320 px): nichts läuft über, Kontraste stimmen ---
  await A.page.goto(base + '/#/settings/appearance');
  await A.page.locator('[data-action="theme"][data-value="light"]').click();
  await openChat(A.page);
  await list(A.page).locator('.plan').waitFor();
  await sleepMs(600); // Seitenübergang abwarten
  await shot(A.page, '7-hell');
  const colors = await A.page.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const pair = (sel) => { const el = document.querySelector(sel); const cs = getComputedStyle(el); return ratio(cs.color, cs.backgroundColor); };
    return { mine: pair('.msg.mine .bubble'), theirs: pair('.msg.theirs .bubble'), meta: ratio(getComputedStyle(document.querySelector('.msg-meta')).color, getComputedStyle(document.documentElement).backgroundColor) };
  });
  assert.ok(colors.mine >= 4.5 && colors.theirs >= 4.5 && colors.meta >= 4.5, 'Kontrast (WCAG AA): ' + JSON.stringify(colors));
  await A.page.setViewportSize({ width: 320, height: 640 });
  await sleepMs(300);
  await shot(A.page, '8-schmal');
  assert.equal(await A.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('.chat').scrollWidth <= document.querySelector('.chat').clientWidth + 1), true, 'kein seitliches Scrollen bei 320 px');
  assert.ok(await A.page.locator('.chat-composer').isVisible());
  await A.page.setViewportSize({ width: 390, height: 844 });

  // --- Hilfe „Chat freischalten“: kopiert die Firestore-Regeln mit der eigenen Nutzer-ID als Administrator ---
  await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await A.page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'chat-rules-help'; document.body.append(b); b.click(); b.remove(); });
  await A.page.locator('.modal:not(.closing) .modal-title', { hasText: 'Chat freischalten' }).waitFor();
  await A.page.locator('.modal:not(.closing) [data-copy]').click();
  await A.page.locator('.modal:not(.closing) [data-copy]', { hasText: 'Kopiert' }).waitFor();
  const copied = await A.page.evaluate(() => navigator.clipboard.readText());
  const myUid = await A.page.evaluate(() => window.GymCloud.currentUser().uid);
  assert.ok(copied.includes('service cloud.firestore') && copied.includes('match /rooms/{room}'), 'kopiert die Regeln samt Chat');
  assert.ok(copied.includes("'" + myUid + "'") && !copied.includes('ADMIN-NUTZER-ID-HIER-EINTRAGEN'), 'eigene Nutzer-ID statt Platzhalter');
  assert.match(await A.page.locator('.modal:not(.closing) a.btn', { hasText: 'Firebase-Regeln öffnen' }).getAttribute('href'), /^https:\/\/console\.firebase\.google\.com\/project\/demo-gym\/firestore\/databases\/-default-\/rules$/);
  await A.page.locator('.modal:not(.closing) [data-close]').last().click();

  // --- Konto löschen räumt auch den Chat auf ---
  await B.page.goto(base + '/#/settings/account');
  await B.page.locator('[data-action="delete-account"]').click();
  await dlgButton(B.page, 'Weiter').click();
  await B.page.fill('.modal:not(.closing) #dlg-input', 'geheim123');
  await dlgButton(B.page, 'Konto endgültig löschen').click();
  await toastText(B.page).filter({ hasText: 'Konto gelöscht' }).waitFor();
  await list(A.page).locator('.bubble', { hasText: 'Neu für A' }).waitFor({ state: 'detached' });
  await A.page.locator('.plan .plan-people.muted').waitFor(); // Teilnahme von ben ist weg

  for (const p of pages) toastLog.push(...await p.page.evaluate(() => window.__toasts || []).catch(() => []));
  await Promise.all([A.ctx.close(), B.ctx.close()]);
  assert.deepEqual(errors.filter((e) => /chat-/.test(e)), [], JSON.stringify(errors));
  assert.deepEqual(toastLog.filter((t) => /Fehler|fehlgeschlagen|nicht geklappt|Berechtigung/.test(t)), []);
});

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const dlgButtonSubmit = (page) => page.locator('.modal:not(.closing) form button[type="submit"]');

test('Chats: Gruppe erstellen, Kontakte (Freunde) mit Direktnachricht, Mitglieder verwalten, Buchstaben-Avatare', async () => {
  await resetEmulators();
  const A = await device('grp-anna');
  const B = await device('grp-ben');
  await register(A.page, 'grpanna@test.de');
  await createProfile(A.page, 'grpanna', false);
  await register(B.page, 'grpben@test.de');
  await createProfile(B.page, 'grpben', false);
  // Freundschaft über dieselbe Cloud-Schicht wie die App (Anfrage von B, A nimmt an)
  const uidA = await A.page.evaluate(() => window.GymCloud.currentUser().uid);
  const uidB = await B.page.evaluate(() => window.GymCloud.currentUser().uid);
  await B.page.evaluate(([to]) => window.GymCloud.social.sendRequest(to, { username: 'grpben', photo: null }, { username: 'grpanna', photo: null }), [uidA]);
  await A.page.evaluate(([from]) => window.GymCloud.social.acceptRequest(from, false), [uidB]);

  const shots = process.env.GRP_SHOTS;
  const shot = async (page, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await sleepMs(500); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
  const openList = async (p) => { await p.locator('.tab[data-tab="chat"]').click(); await p.locator('#chat-home').waitFor(); };
  const send = async (p, text) => { await p.fill('#chat-input', text); await p.press('#chat-input', 'Enter'); };

  // --- A: Chat-Reiter = Liste: Gym-Chat, noch keine Gruppen, Kontakt @grpben mit Buchstaben-Avatar ---
  await openList(A.page);
  await A.page.locator('a.chat-row[href="#/chat/gym"]', { hasText: 'Gym-Chat' }).waitFor();
  await A.page.locator('.chat-empty-small', { hasText: 'Noch keine Gruppen' }).waitFor();
  const contact = A.page.locator('a.chat-row[href="#/chat/dm/' + uidB + '"]');
  await contact.waitFor();
  assert.equal((await contact.locator('.li-title').innerText()).trim(), '@grpben');
  await shot(A.page, '1-liste-leer');
  const av = contact.locator('.avatar.avatar-initial');
  assert.equal((await av.innerText()).trim(), 'G');                       // großer Anfangsbuchstabe
  assert.match(await av.getAttribute('class'), /\bac\d\b/);               // eigene Hintergrundfarbe
  const avColor = await av.evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(avColor, 'rgba(0, 0, 0, 0)');

  // --- Neue Gruppe: Name + Freund wählen ---
  await A.page.locator('.app-header [data-action="chat-new-group"]').click();
  const ok = A.page.locator('.modal:not(.closing) [data-ok]');
  assert.equal(await ok.isDisabled(), true);                              // ohne Namen und Auswahl nicht möglich
  await A.page.fill('.modal:not(.closing) #grp-name', 'Push-Team');
  assert.equal(await ok.isDisabled(), true);                              // ohne Freund auch nicht
  await A.page.locator('.modal:not(.closing) .pick-row', { hasText: '@grpben' }).click();
  await shot(A.page, '2-neue-gruppe');
  await ok.click();
  await waitHash(A.page, /#\/chat\/g\//);
  await A.page.locator('#chat-input').waitFor();
  assert.equal((await A.page.locator('.app-header .hdr-title').innerText()).trim(), 'Push-Team');
  await A.page.locator('.chat-empty').waitFor();
  await send(A.page, 'Hallo Team');
  await A.page.locator('#chat-list .msg.mine .bubble', { hasText: 'Hallo Team' }).waitFor();

  // --- B: Gruppe erscheint mit Vorschau und Ungelesen-Punkt; am Reiter ein Punkt, solange B woanders ist ---
  await B.page.locator('#tab-dot-chat:not([hidden])').waitFor();
  await openList(B.page);
  const grp = B.page.locator('a.chat-row[href^="#/chat/g/"]', { hasText: 'Push-Team' });
  await grp.waitFor();
  assert.match(await grp.locator('.li-sub').innerText(), /^@grpanna: Hallo Team$/);
  await grp.locator('.unread-dot').waitFor();
  await shot(B.page, '3a-liste-ungelesen');
  assert.equal((await grp.locator('.avatar-initial').innerText()).trim(), 'P'); // Gruppen-Avatar: Anfangsbuchstabe des Namens
  await grp.click();
  await B.page.locator('#chat-list .msg.theirs .bubble', { hasText: 'Hallo Team' }).waitFor();
  await B.page.locator('#chat-list .msg-name', { hasText: '@grpanna' }).waitFor();
  await B.page.locator('#chat-list .msg.theirs .avatar-initial', { hasText: 'G' }).waitFor(); // Absender ohne Foto: Buchstabe
  await shot(B.page, '3-gruppe-raum');
  await sleepMs(2300);
  await send(B.page, 'Bin dabei');
  await A.page.locator('#chat-list .msg.theirs .bubble', { hasText: 'Bin dabei' }).waitFor();
  // zurück zur Liste: kein Ungelesen-Punkt mehr (gesehen)
  await B.page.locator('.app-header a.hdr-btn[href="#/chat"]').click();
  await B.page.locator('#chat-home').waitFor();
  await B.page.locator('a.chat-row[href^="#/chat/g/"]', { hasText: 'Push-Team' }).waitFor();
  assert.equal(await B.page.locator('a.chat-row[href^="#/chat/g/"] .unread-dot').count(), 0);

  // --- Direktnachricht: B → A über „Kontakte“ (entsteht erst beim Senden) ---
  await B.page.locator('a.chat-row[href="#/chat/dm/' + uidA + '"]').click();
  await B.page.locator('#chat-input').waitFor();
  assert.equal((await B.page.locator('.app-header .hdr-title').innerText()).trim(), '@grpanna');
  await B.page.locator('.chat-empty').waitFor();
  assert.equal(await B.page.locator('.app-header [data-action="chat-info"]').count(), 0);     // kein Gruppen-Info im Direktchat
  await sleepMs(2300);
  await send(B.page, 'Direkt gefragt');
  await B.page.locator('#chat-list .msg.mine .bubble', { hasText: 'Direkt gefragt' }).waitFor();
  await A.page.locator('.app-header a.hdr-btn[href="#/chat"]').click();
  const dmRow = A.page.locator('a.chat-row[href="#/chat/dm/' + uidB + '"]');
  await dmRow.locator('.li-sub', { hasText: 'Direkt gefragt' }).waitFor();
  await dmRow.locator('.unread-dot').waitFor();
  await dmRow.click();
  await A.page.locator('#chat-list .msg.theirs .bubble', { hasText: 'Direkt gefragt' }).waitFor();
  // ein Direktchat mit jemandem, der kein Freund ist
  await A.page.goto(base + '/#/chat/dm/fremde-uid-123');
  await A.page.locator('.empty', { hasText: 'Kein Kontakt' }).waitFor();

  // --- Gruppeninfo: A (Besitzerin) sieht beide, B verlässt die Gruppe ---
  await A.page.goto(base + '/#/chat');
  await A.page.locator('a.chat-row[href^="#/chat/g/"]', { hasText: 'Push-Team' }).click();
  await A.page.locator('.app-header [data-action="chat-info"]').click();
  const info = A.page.locator('.modal:not(.closing)');
  await info.locator('.grp-member', { hasText: 'Du' }).waitFor();
  await info.locator('.grp-member', { hasText: '@grpben' }).waitFor();
  await info.locator('[data-act="add"]').waitFor();
  await shot(A.page, '4-gruppeninfo');
  await A.page.keyboard.press('Escape');
  await B.page.locator('.app-header a.hdr-btn[href="#/chat"]').click();
  await B.page.locator('a.chat-row[href^="#/chat/g/"]', { hasText: 'Push-Team' }).click();
  await B.page.locator('.app-header [data-action="chat-info"]').click();
  assert.equal(await B.page.locator('.modal:not(.closing) [data-act="delete"]').count(), 0);    // Mitglieder löschen nichts
  await B.page.locator('.modal:not(.closing) [data-act="leave"]').click();
  await dlgButton(B.page, 'Verlassen').click();
  await waitHash(B.page, /#\/chat$/);
  await B.page.locator('.chat-empty-small', { hasText: 'Noch keine Gruppen' }).waitFor();

  // --- A lädt B wieder ein (Mitglieder hinzufügen), dann löscht die Gruppe ---
  await A.page.locator('.app-header [data-action="chat-info"]').click();
  await A.page.locator('.modal:not(.closing) [data-act="add"]').click();
  await A.page.locator('.modal:not(.closing) .pick-row', { hasText: '@grpben' }).click();
  await A.page.locator('.modal:not(.closing) [data-ok]').click();
  await B.page.locator('a.chat-row[href^="#/chat/g/"]', { hasText: 'Push-Team' }).waitFor();
  // Die Gruppeninfo öffnet sich nach dem Hinzufügen von selbst wieder – jetzt mit beiden Mitgliedern
  await A.page.locator('.modal:not(.closing) .grp-member', { hasText: '@grpben' }).waitFor();
  await A.page.locator('.modal:not(.closing) [data-act="delete"]').click();
  await dlgButton(A.page, 'Löschen').click();
  await waitHash(A.page, /#\/chat$/);
  await A.page.locator('.chat-empty-small', { hasText: 'Noch keine Gruppen' }).waitFor();
  await B.page.locator('.chat-empty-small', { hasText: 'Noch keine Gruppen' }).waitFor();

  for (const p of pages) toastLog.push(...await p.page.evaluate(() => window.__toasts || []).catch(() => []));
  await Promise.all([A.ctx.close(), B.ctx.close()]);
  assert.deepEqual(errors.filter((e) => /grp-/.test(e)), [], JSON.stringify(errors));
  assert.deepEqual(toastLog.filter((t) => /Fehler|fehlgeschlagen|nicht geklappt|Berechtigung|Nicht erlaubt/.test(t)), []);
});
