// Browser-Test (Chromium) für das iOS-27-Verhalten der echten App: Berührung, Tab-Leiste, Sheets, Regler.
//   cd tests/emulator && npm install      (einmalig, installiert Playwright)
//   node --test tests/glass-touch.ui.mjs
// Läuft ohne Firebase-Emulator (Gastmodus). Optional: GT_SHOTS=/pfad speichert Screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'tests/emulator/package.json'))('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.GT_SHOTS;

let server, base, browser;
const errors = [];

test.before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
});
test.after(async () => { await browser?.close(); server?.close(); });

/** App im Gastmodus öffnen (Einführung und Einrichtung durchklicken). */
async function open({ scheme = 'dark', reducedMotion = 'no-preference', width = 390, height = 844, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion, serviceWorkers: 'block', locale: 'de-DE', hasTouch: touch });
  await ctx.route('https://www.gstatic.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.locator('[data-action="intro-done"]').click();
  await page.locator('[data-action="auth-guest"]').click();
  for (let i = 0; i < 3; i++) { await page.locator('[data-action="setup-next"]').click(); await sleep(300); }
  await page.waitForSelector('.day-card');
  await sleep(300);
  return { ctx, page };
}

const center = (b, fx = 0.5, fy = 0.5) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
const lit = (page) => page.evaluate(() => [...document.querySelectorAll('.gt-lit')].map((o) => ({
  ga: Number(o.style.getPropertyValue('--ga')), gr: parseFloat(o.style.getPropertyValue('--gr')), w: parseFloat(o.style.width), t: o.style.transform,
})));
const shot = (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name + '.png') });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

test('Berührung (Karte): hebt sich leicht, Licht beginnt unter dem Finger und breitet sich aus, nahes Glas leuchtet mit', async () => {
  const { ctx, page } = await open();
  const card = page.locator('.day-card').first();
  const b = await card.boundingBox();
  const p = center(b, 0.3, 0.4);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(40);
  const early = (await lit(page)).find((o) => Math.abs(o.w - b.width) < 1);
  await sleep(300);
  const during = await lit(page);
  const main = during.find((o) => Math.abs(o.w - b.width) < 1 && o.ga > 0.9);
  assert.ok(main, 'Lichtfläche der Karte fehlt');
  assert.ok(main.gr > early.gr, 'Das Licht breitet sich nicht aus (Radius wächst nicht)');
  assert.ok(main.gr > b.width * 0.6, 'Das Licht erreicht nicht die ganze Fläche: ' + main.gr);
  assert.ok(during.length >= 2, 'Nahes Glas leuchtet nicht mit');
  assert.ok(during.some((o) => o.ga > 0.05 && o.ga < 0.7 && o !== main), 'Nachbarn leuchten nicht schwächer');
  const scale = await card.evaluate((e) => e.style.scale);
  const [sx, sy] = scale.split(' ').map(Number);
  assert.ok(sx > 1.005 && sx <= 1.03 && sy > 1.005 && sy <= 1.03, 'Karte wächst um höchstens ~2 %: ' + scale);
  await shot(page, 'press-card');
  await ctx.close();
});

test('Berührung (Knopf): wächst um höchstens ~7,5 %, federt beim Loslassen mit Nachschwingen zurück, danach bleibt nichts hängen', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => { location.hash = '#/settings/appearance'; });
  await page.waitForSelector('.theme-pick');
  await sleep(500);
  const el = page.locator('.hdr-btn').first();
  const handle = await el.elementHandle();
  const b = await el.boundingBox();
  const p = center(b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(350);
  const down = await handle.evaluate((e) => e.style.scale);
  const [sx] = down.split(' ').map(Number);
  assert.ok(sx > 1.05 && sx <= 1.08, 'Knopf-Skalierung beim Drücken: ' + down);
  // Wegziehen bricht ab (kein Klick, keine Navigation) → Rückfederung messen
  await page.mouse.move(p.x + 140, p.y + 200, { steps: 4 });
  const vals = [];
  for (let i = 0; i < 40; i++) { vals.push(Number((await handle.evaluate((e) => e.style.scale || '1')).split(' ')[0])); await sleep(25); }
  await page.mouse.up();
  assert.ok(Math.min(...vals) < 0.999, 'Kein Nachschwingen unter 1,0: min ' + Math.min(...vals));
  assert.ok(Math.min(...vals) > 0.96, 'Nachschwingen zu stark: ' + Math.min(...vals));
  await sleep(1200);
  assert.equal(await handle.evaluate((e) => e.style.scale + '|' + e.style.translate), '|', 'Inline-Reste nach dem Loslassen');
  assert.equal((await lit(page)).length, 0, 'Lichtflächen bleiben stehen');
  assert.equal(await page.evaluate(() => location.hash), '#/settings/appearance', 'Abbrechen darf nichts auslösen');
  await ctx.close();
});

test('Berührung (Maus): sanftes Aufleuchten unter dem Zeiger beim Darüberfahren, ohne Skalieren', async () => {
  const { ctx, page } = await open();
  const card = page.locator('.day-card').first();
  const b = await card.boundingBox();
  const p = center(b, 0.6, 0.5);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await sleep(350);
  const hov = (await lit(page)).sort((x, y) => y.ga - x.ga)[0];   // beim Anfahren verblasst evtl. noch ein vorheriges Element
  assert.ok(hov && hov.ga > 0.2 && hov.ga < 0.5, 'Hover-Licht: ' + JSON.stringify(hov));
  assert.equal(await card.evaluate((e) => e.style.scale), '', 'Hover darf nicht skalieren');
  await page.mouse.move(5, 5, { steps: 3 });
  await sleep(1000);
  assert.equal((await lit(page)).length, 0, 'Hover-Licht bleibt nach dem Verlassen');
  await ctx.close();
});

test('„Bewegung verringern“: nichts wächst, nichts federt – nur das Licht, schwächer', async () => {
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  const card = page.locator('.day-card').first();
  const b = await card.boundingBox();
  const p = center(b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(350);
  assert.equal(await card.evaluate((e) => e.style.scale + '|' + e.style.translate), '|', 'Skalieren/Verschieben trotz „Bewegung verringern“');
  const l = (await lit(page)).find((o) => Math.abs(o.w - b.width) < 1);
  assert.ok(l && l.ga > 0.3 && l.ga <= 0.66, 'Licht bei reduzierter Bewegung: ' + JSON.stringify(l));
  await page.mouse.up();
  await ctx.close();
});

test('Tab-Leiste: Linse dehnt sich in Laufrichtung, schwingt leicht über und kommt in unter 1 s zur Ruhe (zwei Federn)', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => {
    window.__rec = [];
    const lens = document.querySelector('#tab-lens');
    const t0 = performance.now();
    (function f() { const r = lens.getBoundingClientRect(); window.__rec.push({ t: performance.now() - t0, l: r.left, r: r.right, h: r.height }); if (performance.now() - t0 < 1400) requestAnimationFrame(f); })();
    location.hash = '#/profile';
  });
  await sleep(1550);
  const rec = await page.evaluate(() => window.__rec);
  const target = await page.evaluate(() => { const r = document.querySelector('.tab.active').getBoundingClientRect(); return { l: r.left, r: r.right }; });
  const base = rec[0].r - rec[0].l;
  const maxW = Math.max(...rec.map((x) => x.r - x.l));
  assert.ok(maxW > base * 1.25, `Linse dehnt sich nicht (max ${maxW.toFixed(0)} vs ${base.toFixed(0)})`);
  assert.ok(Math.min(...rec.map((x) => x.h)) < rec[0].h - 1, 'Linse wird nicht flacher beim Dehnen');
  assert.ok(Math.max(...rec.map((x) => x.r)) > target.r + 2, 'Kein Überschwingen am Ziel');
  const last = rec[rec.length - 1];
  assert.ok(Math.abs(last.l - target.l) < 1 && Math.abs(last.r - target.r) < 1, 'Linse landet nicht auf dem Reiter');
  const settled = rec.find((x, i) => rec.slice(i).every((y) => Math.abs(y.l - target.l) < 1.5 && Math.abs(y.r - target.r) < 1.5));
  assert.ok(settled && settled.t < 1000, 'Linse braucht zu lange: ' + (settled && settled.t));
  await ctx.close();
});

test('Tab-Leiste: mit dem Finger über die Reiter wischen – Linse folgt, gewechselt wird beim Loslassen, kein zweiter Klick', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => { location.hash = '#/profile'; });
  await sleep(900);
  const tabs = page.locator('.tab');
  const t0 = await tabs.nth(0).boundingBox(), t3 = await tabs.nth(3).boundingBox();
  const y = t3.y + t3.height / 2;
  await page.mouse.move(t3.x + t3.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(t3.x + t3.width / 2 - (t3.x - t0.x) * i / 14, y); await sleep(22); }
  await sleep(500);
  assert.ok(await page.locator('.tabbar.scrubbing').count(), 'Wischen wird nicht erkannt');
  const lensLeft = await page.evaluate(() => document.querySelector('#tab-lens').getBoundingClientRect().left);
  assert.ok(Math.abs(lensLeft - t0.x) < 14, 'Linse folgt dem Finger nicht (links ' + lensLeft + ' vs ' + t0.x + ')');
  assert.equal(await page.evaluate(() => location.hash), '#/profile', 'Es darf erst beim Loslassen gewechselt werden');
  assert.ok(await tabs.nth(0).evaluate((e) => e.classList.contains('over')), 'Reiter unter dem Finger ist nicht markiert');
  await shot(page, 'tab-scrub');
  await page.mouse.up();
  await sleep(1000);
  assert.equal(await page.evaluate(() => location.hash), '#/', 'Wechsel zum Reiter unter dem Finger fehlt');
  assert.ok(await tabs.nth(0).evaluate((e) => e.classList.contains('active')));
  assert.equal(await page.locator('.tab.over').count(), 0);
  // Wischen und zurück auf den aktiven Reiter: bleibt dort, Linse federt zurück
  const a = await tabs.nth(0).boundingBox(), c = await tabs.nth(1).boundingBox();
  await page.mouse.move(a.x + a.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + a.width / 2 + (c.x - a.x) * i / 8, y); await sleep(20); }
  for (let i = 1; i <= 8; i++) { await page.mouse.move(c.x + c.width / 2 - (c.x - a.x) * i / 8, y); await sleep(20); }
  await page.mouse.up();
  await sleep(900);
  assert.equal(await page.evaluate(() => location.hash), '#/');
  const back = await page.evaluate(() => document.querySelector('#tab-lens').getBoundingClientRect().left);
  assert.ok(Math.abs(back - a.x) < 3, 'Linse kehrt nicht zum aktiven Reiter zurück');
  await ctx.close();
});

test('Sheets: Aktionsblatt wächst aus dem Knopf (Morph), Radius 40, schwebt mit Abstand; bei „Bewegung verringern“ nur Einblenden', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => {
    window.__anims = [];
    const o = Element.prototype.animate;
    Element.prototype.animate = function (f, opts) { window.__anims.push({ cls: String(this.className), f: JSON.parse(JSON.stringify(f)), opts }); return o.call(this, f, opts); };
  });
  const dots = page.locator('.day-card .icon-btn').first();
  const b = await dots.boundingBox();
  const p = center(b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(100);
  await page.mouse.up();
  await page.waitForSelector('.modal-card');
  await sleep(150);
  const a = await page.evaluate(() => window.__anims.find((x) => /modal-card/.test(x.cls)));
  assert.ok(a, 'Keine Eintrittsanimation');
  assert.match(a.f[0].transform, /translate\(.*\) scale\(0\.\d+\)/, 'Kein Morph aus dem Knopf: ' + a.f[0].transform);
  assert.ok(a.f[0].filter.includes('blur'), 'Glas „materialisiert“ nicht (Unschärfe fehlt)');
  assert.ok(parseFloat(a.f[0].borderRadius) > 40, 'Start-Ecken nicht rund genug');
  assert.equal(a.f[a.f.length - 1].transform, 'none');
  await sleep(700);
  const m = await page.evaluate(() => {
    const c = document.querySelector('.modal-card'); const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
    return { radius: parseFloat(cs.borderTopLeftRadius), left: r.left, right: innerWidth - r.right, bottom: innerHeight - r.bottom };
  });
  assert.equal(m.radius, 40);
  assert.ok(m.left >= 7.5 && m.right >= 7.5, 'Sheet schwebt nicht mit Abstand zu den Seiten');
  assert.ok(m.bottom >= 7.5 && m.bottom < 12, 'Sheet schwebt nicht knapp über dem unteren Rand: ' + m.bottom);
  await shot(page, 'sheet');
  // Schließen: Rückwärts-Morph
  await page.evaluate(() => { window.__anims.length = 0; });
  await page.keyboard.press('Escape');
  await sleep(80);
  const back = await page.evaluate(() => window.__anims.find((x) => /modal-card/.test(x.cls)));
  assert.ok(back && /scale\(0\.\d+\)/.test(back.f[back.f.length - 1].transform), 'Kein Rückwärts-Morph beim Schließen');
  await ctx.close();

  const r = await open({ reducedMotion: 'reduce' });
  await r.page.evaluate(() => {
    window.__anims = [];
    const o = Element.prototype.animate;
    Element.prototype.animate = function (f, opts) { window.__anims.push({ cls: String(this.className), f: JSON.parse(JSON.stringify(f)) }); return o.call(this, f, opts); };
  });
  const rb = await r.page.locator('.day-card .icon-btn').first().boundingBox();
  await r.page.mouse.move(rb.x + 20, rb.y + 20);
  await r.page.mouse.down(); await sleep(100); await r.page.mouse.up();
  await r.page.waitForSelector('.modal-card');
  const rm = await r.page.evaluate(() => window.__anims.map((x) => JSON.stringify(x.f)).join(''));
  assert.ok(!/scale\(|blur\(/.test(rm), 'Bei „Bewegung verringern“ darf nichts skalieren oder verschwimmen: ' + rm);
  await r.ctx.close();
});

test('Regler „Klar ↔ Getönt“: wirkt sofort auf alle Glasflächen, wird gespeichert und beim Start vor dem ersten Bild angewendet', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => { location.hash = '#/settings/appearance'; });
  await page.waitForSelector('#glass-range');
  const alpha = () => page.evaluate(() => {
    const m = getComputedStyle(document.querySelector('.gd-pane')).backgroundColor.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
    return m.length > 3 ? m[3] : 1;
  });
  const set = async (v) => { await page.evaluate((x) => { const r = document.querySelector('#glass-range'); r.value = x; r.dispatchEvent(new Event('input', { bubbles: true })); }, v); await sleep(120); };
  await set(0); const clear = await alpha();
  await set(100); const tinted = await alpha();
  assert.ok(clear < 0.7 && tinted > 0.9 && tinted - clear > 0.25, `Vorschau-Glas ${clear} → ${tinted}`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lg-tint').trim()), '1.00');
  await set(25);
  await sleep(1200); // saveSoon
  const saved = await page.evaluate(() => window.GymApp.db.settings.glass);
  assert.equal(saved, 25);
  // Neustart: Wert liegt schon vor dem ersten Bild an (Skript im <head>)
  await page.addInitScript(() => { window.__tintAtStart = null; });
  await page.reload();
  const early = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lg-tint').trim());
  assert.equal(early, '0.25');
  await page.evaluate(() => { location.hash = '#/settings/appearance'; });
  await page.waitForSelector('#glass-range');
  assert.equal(await page.locator('#glass-range').inputValue(), '25');
  await ctx.close();
});

test('Keine Skriptfehler in allen Durchläufen', () => {
  assert.deepEqual(errors, []);
});
