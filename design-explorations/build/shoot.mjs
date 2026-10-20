// Erzeugt aus den Prototypen alle Screenshots, Blätter je Variante und die Gesamtübersicht.
//   cd tests/emulator && npm install      (einmalig; installiert Playwright)
//   node design-explorations/build/shoot.mjs            alles
//   node design-explorations/build/shoot.mjs v03        nur Varianten, deren Ordner so beginnt
//   SCALE=1 node …                                      kleinere Bilder (Standard 2)
//
// Ergebnis (alles unter design-explorations/):
//   screens/NN-name/{1-training,2-workout,3-verlauf,4-daily}.png   Einzel-Screenshots (390 × 844 Punkte)
//   sheets/NN-name.png                                            Blatt je Variante mit den vier Screens
//   overview.png                                                  alle Varianten im Vergleich (aus overview.html)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { chromium } = createRequire(path.join(HERE, '../../tests/emulator/package.json'))('playwright');
const SCALE = Number(process.env.SCALE || 2);
const only = process.argv[2] || '';
const SCREENS = [['training', '1-training', 'Training'], ['workout', '2-workout', 'Laufendes Training'], ['verlauf', '3-verlauf', 'Verlauf'], ['daily', '4-daily', 'Daily']];

const variants = JSON.parse(fs.readFileSync(path.join(ROOT, 'variants.json'), 'utf8'));
const browser = await chromium.launch();
const problems = [];

for (const v of variants) {
  if (only && !v.dir.startsWith(only)) continue;
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${v.dir}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${v.dir}: ${m.text()}`); });
  await page.goto('file://' + path.join(ROOT, v.dir, 'index.html'));
  await page.waitForSelector('html[data-glass="ready"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  const out = path.join(ROOT, 'screens', v.dir.replace(/^v/, ''));
  fs.mkdirSync(out, { recursive: true });
  for (const [key, file] of SCREENS) await page.locator(`.phone[data-screen="${key}"]`).screenshot({ path: path.join(out, file + '.png') });
  // seitlicher Überlauf innerhalb eines Handys
  const over = await page.$$eval('.phone', (els) => els.map((e) => {
    const r = e.getBoundingClientRect(); const bad = [];
    e.querySelectorAll('*').forEach((c) => { if (c.closest('svg') && c.tagName.toLowerCase() !== 'svg') return; const b = c.getBoundingClientRect(); if (b.width && getComputedStyle(c).position !== 'absolute' && (b.right > r.right + 1 || b.left < r.left - 1)) bad.push(c.tagName.toLowerCase() + '.' + String(c.className).split(' ')[0]); });
    return e.dataset.screen + ': ' + [...new Set(bad)].slice(0, 3).join(', ');
  }).filter((x) => !x.endsWith(': ')));
  if (over.length) problems.push(`${v.dir}: Inhalt ragt seitlich über den Rand – ${over.join(' | ')}`);
  await ctx.close();
  console.log('Screens', v.dir);
}

// Blätter aus den Einzelbildern (als echte Seite neben den Bildern, damit relative Pfade und Schriften geladen werden)
const sheetCtx = await browser.newContext({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
const sp = await sheetCtx.newPage();
fs.mkdirSync(path.join(ROOT, 'sheets'), { recursive: true });
const tmp = path.join(ROOT, 'sheets', '_blatt.html');
for (const v of variants) {
  if (only && !v.dir.startsWith(only)) continue;
  const id = v.dir.replace(/^v/, '');
  const imgs = SCREENS.map(([, file, label]) => `<figure><img src="../screens/${id}/${file}.png" width="390" height="844" alt="${label}"><figcaption>${label}</figcaption></figure>`).join('');
  const tags = (v.tags || []).map((t) => `<span>${t}</span>`).join('');
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>
    @import url('../fonts/fonts.css');
    body{margin:0;background:#0b0b0d;color:#fff;font-family:Inter,sans-serif;padding:36px 40px 40px;width:1700px;box-sizing:border-box}
    header{display:flex;align-items:center;gap:18px;margin-bottom:4px}
    h1{font:700 32px/1 Inter;letter-spacing:-.02em;margin:0} .nr{font:600 13px Inter;letter-spacing:.14em;color:#8c8c92;text-transform:uppercase}
    .sw{width:14px;height:14px;border-radius:50%;background:${v.accent};box-shadow:0 0 0 1px rgba(255,255,255,.35)}
    p{margin:12px 0 14px;font:400 16px/1.5 Inter;color:#c9c9ce;max-width:1150px}
    .tags{display:flex;gap:8px;margin-bottom:26px;flex-wrap:wrap} .tags span{font:500 12px Inter;color:#b5b5bb;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16)}
    .row{display:flex;gap:30px} figure{margin:0} img{display:block;border-radius:34px;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
    figcaption{font:600 12px Inter;letter-spacing:.12em;text-transform:uppercase;color:#8c8c92;margin-top:12px;text-align:center}
  </style><header><span class="nr">Variante ${v.nr}</span><h1>${v.name}</h1><span class="sw" title="Akzent ${v.accent}"></span></header><p>${v.idea}</p><div class="tags">${tags}</div><div class="row">${imgs}</div>`);
  await sp.goto('file://' + tmp);
  await sp.waitForLoadState('load');
  await sp.evaluate(() => document.fonts.ready);
  await sp.waitForTimeout(300);
  await sp.screenshot({ path: path.join(ROOT, 'sheets', id + '.png'), fullPage: true });
  console.log('Blatt', id);
}
fs.rmSync(tmp, { force: true });
await sheetCtx.close();

// Gesamtübersicht: je Screen eine Reihe, in der alle Varianten nebeneinander stehen (Reihenfolge = Nummerierung, keine Wertung)
function overviewHtml() {
  const strips = SCREENS.map(([, file, label]) => {
    const cols = variants.map((v) => {
      const id = v.dir.replace(/^v/, '');
      return `<a class="col" href="${v.dir}/index.html"><img src="screens/${id}/${file}.png" alt="${label} – ${v.name}"><span class="cap"><i style="background:${v.accent}"></i><b>${v.nr}</b> ${v.name}</span></a>`;
    }).join('');
    return `<section><h2>${label}</h2><div class="strip">${cols}</div></section>`;
  }).join('');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gym Tracker · 10 Design-Richtungen</title>
<style>
@import url('fonts/fonts.css');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0b0b0d;color:#fff;font-family:Inter,system-ui,sans-serif;width:2400px;padding:36px 24px 40px;-webkit-font-smoothing:antialiased}
header{margin:0 4px 28px} h1{font:700 30px/1.1 Inter;letter-spacing:-.02em} header p{margin-top:8px;font:400 15px/1.5 Inter;color:#a9a9b0}
section{margin-bottom:34px} h2{font:600 12px/1 Inter;letter-spacing:.14em;text-transform:uppercase;color:#8c8c92;margin:0 4px 12px}
.strip{display:grid;grid-template-columns:repeat(10,224px);gap:12px}
.col{display:block;color:inherit;text-decoration:none} .col img{display:block;width:224px;height:485px;border-radius:22px;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
.cap{display:flex;align-items:center;gap:7px;margin-top:9px;font:500 13px/1 Inter;color:#c9c9ce;white-space:nowrap} .cap i{width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.35);flex:none} .cap b{font-weight:700;color:#8c8c92;font-variant-numeric:tabular-nums}
</style></head><body>
<header><h1>Gym Tracker · 10 Design-Richtungen</h1><p>Schwarze Grundfläche, Liquid Glass. Je Reihe ein Screen, alle zehn Varianten nebeneinander – die Reihenfolge entspricht der Nummerierung und sagt nichts über Qualität. Ein Klick auf einen Screen öffnet den Prototyp (Chromium).</p></header>
${strips}
</body></html>`;
}
if (!only) {
  fs.writeFileSync(path.join(ROOT, 'overview.html'), overviewHtml());
  const ctx = await browser.newContext({ viewport: { width: 2400, height: 1000 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('file://' + path.join(ROOT, 'overview.html'));
  await p.waitForLoadState('load');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(ROOT, 'overview.png'), fullPage: true });
  await ctx.close();
  console.log('Übersicht overview.png');
}
await browser.close();
if (problems.length) { console.log('\nPROBLEME:\n' + [...new Set(problems)].join('\n')); process.exitCode = 1; }
