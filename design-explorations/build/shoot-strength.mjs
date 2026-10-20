// Dieselben Prototypen in fünf Glasstärken (ultraklar … voll getönt): Einzelbilder, Blatt je Variante und Gesamtübersicht.
//   node design-explorations/build/shoot-strength.mjs            alles
//   node design-explorations/build/shoot-strength.mjs v10        nur Varianten, deren Ordner so beginnt
//   SCALE=1 node …                                               kleinere Bilder (Standard 2)
//
// Ergebnis unter design-explorations/glass-strength/:
//   screens/NN-name/<Stärke>-{training,workout,probe}.png   Einzelbilder (probe = Glasprobe auf buntem Grund, glass-strength/probe.html)
//   sheets/NN-name.png                                  Blatt je Variante: Training, Laufendes Training und Glasprobe in allen fünf Stärken
//   overview.png / overview.html                        alle Varianten nebeneinander, je Reihe eine Stärke (Laufendes Training)
//   probe-overview.png / probe-overview.html            Glasprobe: je Zeile eine Variante, je Spalte eine Stärke
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'glass-strength');
const { chromium } = createRequire(path.join(HERE, '../../tests/emulator/package.json'))('playwright');
const SCALE = Number(process.env.SCALE || 2);
const only = process.argv[2] || '';
const LEVELS = [[0, 'Ultraklar'], [25, 'Klar'], [50, 'Standard der Variante'], [75, 'Getönt'], [100, 'Voll getönt']];
const SCREENS = [['training', 'Training'], ['workout', 'Laufendes Training']];

const variants = JSON.parse(fs.readFileSync(path.join(ROOT, 'variants.json'), 'utf8'));
const browser = await chromium.launch();
const problems = [];

for (const v of variants) {
  if (only && !v.dir.startsWith(only)) continue;
  const id = v.dir.replace(/^v/, '');
  const out = path.join(OUT, 'screens', id);
  fs.mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${v.dir}: ${e.message}`));
  for (const [lv] of LEVELS) {
    await page.goto(`file://${path.join(ROOT, v.dir, 'index.html')}?glass=${lv}`);
    await page.waitForSelector('html[data-glass="ready"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    for (const [key] of SCREENS) await page.locator(`.phone[data-screen="${key}"]`).screenshot({ path: path.join(out, `${lv}-${key}.png`) });
    await page.goto(`file://${path.join(OUT, 'probe.html')}?v=${v.dir}&a=${encodeURIComponent(v.accent)}&glass=${lv}`);
    await page.waitForSelector('html[data-glass="ready"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.locator('.probe').screenshot({ path: path.join(out, `${lv}-probe.png`) });
  }
  await ctx.close();
  console.log('Stärken', v.dir);
}

// Blätter
const sheetCtx = await browser.newContext({ viewport: { width: 2200, height: 1200 }, deviceScaleFactor: 1 });
const sp = await sheetCtx.newPage();
fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
const tmp = path.join(OUT, 'sheets', '_blatt.html');
for (const v of variants) {
  if (only && !v.dir.startsWith(only)) continue;
  const id = v.dir.replace(/^v/, '');
  const probe = `<h3>Glasprobe auf buntem Grund (das Material dieser Variante über kontrastreichem Inhalt)</h3><div class="row probe">${LEVELS.map(([lv, name]) => `<figure><img src="../screens/${id}/${lv}-probe.png" width="390" height="260" alt="Glasprobe, Glasstärke ${lv}"><figcaption><b>${lv}</b> ${name}</figcaption></figure>`).join('')}</div>`;
  const rows = SCREENS.map(([key, label]) => `<h3>${label}</h3><div class="row">${LEVELS.map(([lv, name]) => `<figure><img src="../screens/${id}/${lv}-${key}.png" width="390" height="844" alt="${label}, Glasstärke ${lv}"><figcaption><b>${lv}</b> ${name}</figcaption></figure>`).join('')}</div>`).join('') + probe;
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>
    @import url('../../fonts/fonts.css');
    body{margin:0;background:#0b0b0d;color:#fff;font-family:Inter,sans-serif;padding:36px 40px 40px;width:2200px;box-sizing:border-box}
    header{display:flex;align-items:center;gap:18px;margin-bottom:6px}
    h1{font:700 32px/1 Inter;letter-spacing:-.02em;margin:0} .nr{font:600 13px Inter;letter-spacing:.14em;color:#8c8c92;text-transform:uppercase}
    .sw{width:14px;height:14px;border-radius:50%;background:${v.accent};box-shadow:0 0 0 1px rgba(255,255,255,.35)}
    p{margin:8px 0 26px;font:400 15px/1.5 Inter;color:#a9a9b0;max-width:1300px}
    h3{font:600 12px Inter;letter-spacing:.14em;text-transform:uppercase;color:#8c8c92;margin:10px 0 14px} .probe img{border-radius:28px}
    .row{display:flex;gap:30px;margin-bottom:34px} figure{margin:0} img{display:block;border-radius:34px;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
    figcaption{font:500 13px Inter;color:#c9c9ce;margin-top:11px;text-align:center} figcaption b{color:#8c8c92;font-variant-numeric:tabular-nums;margin-right:4px}
  </style><header><span class="nr">Variante ${v.nr} · Glasstärke</span><h1>${v.name}</h1><span class="sw"></span></header><p>Derselbe Entwurf in fünf Glasstärken. 0 = ultraklar (kaum Tönung, wenig Weichzeichnung), 50 = Standard der Variante (so wie im ersten Blatt), 100 = voll getönt (deckende, dunkle Fläche). Akzentfarbene Knöpfe bleiben Akzent.</p>${rows}`);
  await sp.goto('file://' + tmp);
  await sp.waitForLoadState('load');
  await sp.evaluate(() => document.fonts.ready);
  await sp.waitForTimeout(300);
  await sp.screenshot({ path: path.join(OUT, 'sheets', id + '.png'), fullPage: true });
  console.log('Blatt', id);
}
fs.rmSync(tmp, { force: true });
await sheetCtx.close();

// Gesamtübersicht: je Reihe eine Stärke, alle Varianten nebeneinander (Laufendes Training)
if (!only) {
  const strips = LEVELS.map(([lv, name]) => `<section><h2><b>${lv}</b> ${name}</h2><div class="strip">${variants.map((v) => { const id = v.dir.replace(/^v/, ''); return `<a class="col" href="../${v.dir}/index.html?glass=${lv}&ui=1"><img src="screens/${id}/${lv}-workout.png" alt="${v.name}, Glasstärke ${lv}"><span class="cap"><i style="background:${v.accent}"></i><b>${v.nr}</b> ${v.name}</span></a>`; }).join('')}</div></section>`).join('');
  fs.writeFileSync(path.join(OUT, 'overview.html'), `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gym Tracker · Glasstärke</title>
<style>
@import url('../fonts/fonts.css');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0b0b0d;color:#fff;font-family:Inter,system-ui,sans-serif;width:2400px;padding:36px 24px 40px;-webkit-font-smoothing:antialiased}
header{margin:0 4px 28px} h1{font:700 30px/1.1 Inter;letter-spacing:-.02em} header p{margin-top:8px;font:400 15px/1.5 Inter;color:#a9a9b0;max-width:1500px}
section{margin-bottom:34px} h2{font:600 13px/1 Inter;letter-spacing:.12em;text-transform:uppercase;color:#c9c9ce;margin:0 4px 12px} h2 b{color:#8c8c92;margin-right:6px}
.strip{display:grid;grid-template-columns:repeat(10,224px);gap:12px}
.col{display:block;color:inherit;text-decoration:none} .col img{display:block;width:224px;height:485px;border-radius:22px;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
.cap{display:flex;align-items:center;gap:7px;margin-top:9px;font:500 13px/1 Inter;color:#c9c9ce;white-space:nowrap} .cap i{width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.35);flex:none} .cap b{font-weight:700;color:#8c8c92;font-variant-numeric:tabular-nums}
</style></head><body>
<header><h1>Gym Tracker · Glasstärke von ultraklar bis voll getönt</h1><p>Laufendes Training in allen zehn Varianten, je Reihe eine Glasstärke. Die Reihenfolge der Varianten ist die Nummerierung und keine Wertung. Ein Klick öffnet den Prototyp mit Regler (Chromium).</p></header>
${strips}
</body></html>`);
  const rowsP = variants.map((v) => { const id = v.dir.replace(/^v/, ''); return `<div class="r"><div class="n"><i style="background:${v.accent}"></i><b>${v.nr}</b> ${v.name}</div>${LEVELS.map(([lv]) => `<a href="probe.html?v=${v.dir}&a=${encodeURIComponent(v.accent)}&glass=${lv}&ui=1"><img src="screens/${id}/${lv}-probe.png" width="390" height="260" alt="${v.name}, Glasstärke ${lv}"></a>`).join('')}</div>`; }).join('');
  fs.writeFileSync(path.join(OUT, 'probe-overview.html'), `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gym Tracker · Glasprobe</title>
<style>
@import url('../fonts/fonts.css');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0b0b0d;color:#fff;font-family:Inter,system-ui,sans-serif;width:2300px;padding:36px 30px 40px;-webkit-font-smoothing:antialiased}
header{margin-bottom:26px} h1{font:700 30px/1.1 Inter;letter-spacing:-.02em} header p{margin-top:8px;font:400 15px/1.5 Inter;color:#a9a9b0;max-width:1500px}
.cols,.r{display:grid;grid-template-columns:150px repeat(5,390px);gap:14px;align-items:center}
.cols{margin-bottom:10px;font:600 13px Inter;color:#c9c9ce} .cols b{color:#8c8c92;margin-right:5px;font-variant-numeric:tabular-nums}
.r{margin-bottom:14px} .r img{display:block;border-radius:28px;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
.n{display:flex;align-items:center;gap:8px;font:600 15px Inter;color:#c9c9ce} .n i{width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.35);flex:none} .n b{color:#8c8c92;font-variant-numeric:tabular-nums}
</style></head><body>
<header><h1>Glasprobe · Glasstärke von ultraklar bis voll getönt</h1><p>Das Glas-Material jeder Variante über buntem, kontrastreichem Grund (heller Kasten, gelbe Zahl, Farbflächen): Stepper oben, Navigation und runder Hauptknopf unten. Je Spalte eine Glasstärke, je Zeile eine Variante, Reihenfolge = Nummerierung, keine Wertung. Ein Klick öffnet die Probe mit Regler (Chromium).</p></header>
<div class="cols"><span></span>${LEVELS.map(([lv, name]) => `<span><b>${lv}</b>${name}</span>`).join('')}</div>
${rowsP}
</body></html>`);
  const ctx = await browser.newContext({ viewport: { width: 2400, height: 1000 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('file://' + path.join(OUT, 'probe-overview.html'));
  await p.waitForLoadState('load');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(OUT, 'probe-overview.png'), fullPage: true });
  await p.goto('file://' + path.join(OUT, 'overview.html'));
  await p.waitForLoadState('load');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, 'overview.png'), fullPage: true });
  await ctx.close();
  console.log('Übersicht glass-strength/overview.png');
}
await browser.close();
if (problems.length) { console.log('\nPROBLEME:\n' + [...new Set(problems)].join('\n')); process.exitCode = 1; }
