// Visueller Check: startet die App lokal, öffnet die wichtigsten Ansichten in Chromium (Playwright),
// speichert Screenshots (hell + dunkel) und meldet typische Layout-Fehler.
//
//   node scripts/screenshots.mjs [Ausgabeordner] [--wide] [--routes=#/,#/history]
//
// Einmalig: `npm install` in tests/emulator (installiert Playwright). Der Browser kommt aus PLAYWRIGHT_BROWSERS_PATH
// bzw. /opt/pw-browsers/chromium. Die Screenshots kann Claude danach direkt ansehen und beurteilen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith('--' + name));
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'screenshots'));
const WIDE = !!flag('wide');
const ROUTES = (flag('routes') || '').split('=')[1];

let chromium;
try {
  ({ chromium } = createRequire(path.join(ROOT, 'tests/emulator/package.json'))('playwright'));
} catch (e) {
  console.error('Playwright fehlt – bitte einmal `npm install` in tests/emulator ausführen.');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SCREENS = [
  ['home', '#/'], ['daily', '#/daily'], ['daily-plan', '#/daily/plan'], ['history', '#/history'], ['library', '#/library'],
  ['settings', '#/settings'], ['settings-training', '#/settings/training'],
];
const DEVICES = [['phone', { width: 390, height: 844 }]].concat(WIDE ? [['tablet', { width: 820, height: 1180 }]] : []);

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
const report = [];
const settle = (page) => page.waitForTimeout(500);

for (const [device, viewport] of DEVICES) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block', locale: 'de-DE', reducedMotion: 'reduce' });
    await ctx.route('https://www.gstatic.com/**', (r) => r.abort()); // ohne Cloud: Gastmodus
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push('Skriptfehler: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|Firebase/.test(m.text())) problems.push('Konsole: ' + m.text()); });

    // Gast mit Beispielplan und einer abgeschlossenen Einheit, damit Verlauf & Co. nicht leer sind
    await page.goto(base + '/');
    await page.locator('[data-action="intro-done"]').click();
    await page.locator('[data-action="auth-guest"]').click();
    for (let i = 0; i < 3; i++) { await page.locator('[data-action="setup-next"]').click(); await settle(page); }
    await page.evaluate((theme) => {
      const { Core, db } = window.GymApp;
      db.settings.theme = theme; // die App hat eine eigene Darstellung-Einstellung (Standard: dunkel)
      const day = db.days[0];
      const s = Core.startSession(db, day.id, Date.now() - 3600000);
      s.exercises.forEach((se, i) => se.sets.forEach((st) => {
        Core.updateSet(db, se.id, st.id, 'weight', 40 + i * 20);
        Core.updateSet(db, se.id, st.id, 'reps', 8);
        Core.toggleSet(db, se.id, st.id, Date.now());
      }));
      Core.finishSession(db, Date.now());
      window.GymApp.save();
    }, scheme);
    await page.reload(); // Theme anwenden
    await settle(page);

    const screens = ROUTES ? ROUTES.split(',').map((r) => [r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home', r]) : SCREENS;
    for (const [name, route] of screens) {
      await page.evaluate((r) => { location.hash = r; }, route);
      await settle(page);
      await page.screenshot({ path: path.join(OUT, `${device}-${scheme}-${name}.png`) });
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const overflow = [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1 && !el.closest('.wk-track, .chips, [data-scroll-x]')).slice(0, 3)
          .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''));
        const small = [...document.querySelectorAll('button, a[href], [role="button"], input, select')].filter((el) => {
          if (!visible(el) || el.closest('[hidden]')) return false;
          const r = el.getBoundingClientRect();
          // Manche Elemente vergrößern ihre Tippfläche unsichtbar über ::after (inset: -6px) – das zählt mit
          const a = getComputedStyle(el, '::after');
          const grown = a.content !== 'none' && a.position === 'absolute';
          const w = Math.max(r.width, grown ? parseFloat(a.width) || 0 : 0);
          const h = Math.max(r.height, grown ? parseFloat(a.height) || 0 : 0);
          return w < 44 || h < 44;
        }).slice(0, 5).map((el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().slice(0, 24));
        const noName = [...document.querySelectorAll('button, a[href]')].filter((el) => visible(el) && !(el.getAttribute('aria-label') || el.textContent.trim())).length;
        return { overflowX: document.documentElement.scrollWidth > vw + 1, overflow, small, noName };
      });
      report.push({ device, scheme, screen: name, ...m });
    }
    if (problems.length) report.push({ device, scheme, screen: '*', problems: [...new Set(problems)] });
    await ctx.close();
  }
}
await browser.close();
server.close();

const bad = report.filter((r) => r.overflowX || (r.overflow && r.overflow.length) || (r.small && r.small.length) || r.noName || r.problems);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.filter((r) => r.screen !== '*').length} Screenshots in ${OUT}`);
if (!bad.length) console.log('Keine Auffälligkeiten (Überlauf, Tippflächen < 44 pt, Buttons ohne Namen, Skriptfehler).');
for (const r of bad) {
  const parts = [];
  if (r.overflowX) parts.push('seitliches Scrollen');
  if (r.overflow && r.overflow.length) parts.push('ragt rechts raus: ' + r.overflow.join(', '));
  if (r.small && r.small.length) parts.push('Tippfläche < 44 pt: ' + r.small.join(' | '));
  if (r.noName) parts.push(r.noName + '× Button ohne Namen');
  if (r.problems) parts.push(r.problems.join('; '));
  console.log(`- ${r.device}/${r.scheme}/${r.screen}: ${parts.join(' · ')}`);
}
