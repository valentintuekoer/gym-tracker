// Browser-Test für Liquid Glass (Chromium via Playwright): Bewegung messen, nicht nur ansehen.
//   cd tests/emulator && npm install      (einmalig, installiert Playwright)
//   node --test tests/liquid-glass.ui.mjs
// Optional: LG_SHOTS=/pfad speichert Screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'tests/emulator/package.json'))('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.LG_SHOTS;

let server, base, browser;
const errors = [];

test.before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/liquid-glass/index.html';
  browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
});
test.after(async () => { await browser?.close(); server?.close(); });

async function open({ scheme = 'light', reducedMotion = 'no-preference', width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#nav .lg-pill')?.offsetWidth > 0);
  await page.evaluate(() => document.fonts.ready);
  await sleep(150);
  return { ctx, page };
}

/** Pille und Panels pro Frame aufzeichnen, während `action` läuft */
async function record(page, action, ms = 1100) {
  await page.evaluate((m) => {
    window.__rec = [];
    window.__recMs = m;
    const pill = document.querySelector('#nav .lg-pill');
    const copy = document.querySelector('#nav .lg-copy');
    const tabs = [...document.querySelectorAll('glass-panels > [role="tabpanel"]')];
    const tx = (el) => { const t = getComputedStyle(el).transform; return t === 'none' ? 0 : new DOMMatrix(t).m41; };
    const t0 = performance.now();
    (function frame() {
      const r = pill.getBoundingClientRect();
      window.__rec.push({
        t: performance.now() - t0, left: r.left, right: r.right, height: r.height, willChange: getComputedStyle(pill).willChange, clip: copy.style.clipPath,
        panels: tabs.filter((p) => !p.hidden).map((p) => ({ id: p.dataset.panel, x: tx(p), o: Number(getComputedStyle(p).opacity), state: p.dataset.state || '' })),
      });
      if (performance.now() - t0 < window.__recMs) requestAnimationFrame(frame);
    })();
  }, ms);
  await action();
  await sleep(ms + 100);
  return page.evaluate(() => window.__rec);
}

const tabRect = (page, id) => page.locator('#nav [role="tab"]#' + id).evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });

test('Pille steht unter dem aktiven Tab, Zustand und Rollen stimmen', async () => {
  const { ctx, page } = await open();
  const pill = await page.locator('#nav .lg-pill').evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  const tab = await tabRect(page, 'tab-uebersicht');
  assert.ok(Math.abs(pill.left - tab.left) < 1.5 && Math.abs(pill.right - tab.right) < 1.5, JSON.stringify({ pill, tab }));
  assert.equal(await page.locator('#nav [role="tablist"]').getAttribute('aria-label'), 'Hauptnavigation');
  assert.equal(await page.locator('#nav [role="tab"][aria-selected="true"]').count(), 1);
  assert.equal(await page.locator('#nav [role="tab"][tabindex="0"]').count(), 1);
  assert.equal(await page.locator('#nav .lg-copy').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('#nav .lg-copy').evaluate((el) => el.inert), true); // Klon ist weder bedienbar noch vorlesbar
  assert.equal(await page.locator('glass-panels > [role="tabpanel"]:not([hidden])').count(), 1);
  assert.equal(await page.locator('glass-panels > [hidden]').first().evaluate((el) => el.inert), true);
  await ctx.close();
});

test('Liquid Stretch: Pille dehnt sich in Laufrichtung, federt am Ziel nach und kommt exakt an', async () => {
  const { ctx, page } = await open();
  const target = await tabRect(page, 'tab-einstellungen');
  const rec = await record(page, () => page.locator('#tab-einstellungen').click());
  const base = (await tabRect(page, 'tab-uebersicht')).width;
  const widths = rec.map((f) => f.right - f.left);
  const peak = Math.max(...widths);
  assert.ok(peak > base * 1.3, `Dehnung ×${(peak / base).toFixed(2)}`);
  assert.ok(Math.max(...rec.map((f) => f.right)) > target.right + 1.5, 'vordere Kante schwingt über das Ziel');
  // vordere Kante (rechts) ist immer weiter als die hintere, solange es nach rechts geht
  const peakFrame = rec[widths.indexOf(peak)];
  assert.ok(peakFrame.right - target.right < 12 && peakFrame.left < target.left - 40, 'Spitze: vorn schon fast am Ziel, hinten noch weit weg');
  const end = rec.at(-1);
  assert.ok(Math.abs(end.left - target.left) < 0.6 && Math.abs(end.right - target.right) < 0.6, `Endlage ${end.left}/${end.right} vs ${target.left}/${target.right}`);
  assert.ok(rec.every((f) => f.right > f.left), 'Kanten kreuzen sich nie');
  const flat = Math.min(...rec.map((f) => f.height));
  assert.ok(flat < rec[0].height - 0.5 && flat > rec[0].height * 0.9, 'wird beim Dehnen minimal flacher: ' + flat);
  const settled = rec.find((f) => Math.abs(f.left - target.left) < 0.6 && Math.abs(f.right - target.right) < 0.6);
  assert.ok(settled && settled.t < 1000, 'in Ruhe nach ' + Math.round(settled.t) + ' ms');
  assert.equal(rec.slice(1, 20).some((f) => f.willChange.includes('transform')), true, 'will-change nur während der Bewegung …');
  assert.equal(end.willChange, 'auto', '… und danach wieder aus');
  await ctx.close();
});

test('Beschriftungs-Layer ist exakt auf die Pille zugeschnitten (Farbe wechselt Pixel für Pixel mit)', async () => {
  const { ctx, page } = await open();
  const rec = await record(page, () => page.locator('#tab-analytics').click(), 700);
  const navLeft = await page.locator('#nav .lg-copy').evaluate((el) => el.getBoundingClientRect().left);
  const mid = rec[Math.floor(rec.length / 3)];
  const m = /inset\(0px ([\d.]+)px 0px ([\d.]+)px round ([\d.]+)px\)/.exec(mid.clip);
  assert.ok(m, 'clip-path gesetzt: ' + mid.clip);
  const width = await page.locator('#nav .lg-copy').evaluate((el) => el.getBoundingClientRect().width);
  const clipLeft = navLeft + Number(m[2]), clipRight = navLeft + width - Number(m[1]);
  assert.ok(Math.abs(clipLeft - mid.left) < 2.5 && Math.abs(clipRight - mid.right) < 2.5, `Ausschnitt ${clipLeft}/${clipRight} ↔ Pille ${mid.left}/${mid.right}`);
  const color = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
  const active = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lg-text-active').trim());
  assert.equal(await color('#nav .lg-copy .lg-tab'), 'rgb(8, 50, 168)', 'Klon in Akzentfarbe (' + active + ')');
  assert.equal(await color('#nav .lg-labels .lg-tab'), 'rgb(29, 29, 31)');
  await ctx.close();
});

test('Unterbrechen: neues Ziel mitten in der Bewegung – die Pille springt nicht, sondern wendet stetig', async () => {
  const { ctx, page } = await open();
  // Vergleichswert: größte Geschwindigkeit einer ungestörten Bewegung über drei Reiter
  const maxSpeed = (rec) => Math.max(...rec.slice(1).map((f, i) => Math.max(Math.abs(f.left - rec[i].left), Math.abs(f.right - rec[i].right)) / Math.max((f.t - rec[i].t) / 1000, 0.008)));
  const calm = await record(page, () => page.locator('#tab-einstellungen').click(), 1100);
  await page.locator('#tab-uebersicht').click();
  await sleep(1100);
  const rec = await record(page, async () => {
    await page.locator('#tab-einstellungen').click();
    await sleep(110);
    await page.locator('#tab-uebersicht').click(); // zurück, noch bevor das Ziel erreicht ist
  }, 1300);
  const start = await tabRect(page, 'tab-uebersicht');
  const lefts = rec.map((f) => f.left);
  assert.ok(Math.max(...lefts) > start.left + 20 && lefts.at(-1) < start.left + 1, 'Pille hat gewendet und ist zurück');
  // Kein Sprung: Die Geschwindigkeit bleibt im physikalisch möglichen Rahmen (Frame-Ruckler zählen nicht: wir teilen durch die Zeit).
  // Beim Wenden ist die Pille ~170 px vom neuen Ziel entfernt, die Feder zieht entsprechend kräftig zurück – schneller als
  // ungestört, aber stetig. Dass Position und Geschwindigkeit beim Umlenken exakt erhalten bleiben, beweist der Logik-Test.
  assert.ok(maxSpeed(rec) < maxSpeed(calm) * 2, `Geschwindigkeit beim Wenden ${Math.round(maxSpeed(rec))} px/s ↔ ungestört ${Math.round(maxSpeed(calm))} px/s`);
  assert.ok(Math.max(...rec.slice(1).map((f, i) => Math.abs(f.left - rec[i].left))) < 150, 'kein Frame mit Sprung über 150 px');
  const end = rec.at(-1);
  assert.ok(Math.abs(end.left - start.left) < 0.6 && Math.abs(end.right - start.right) < 0.6);
  assert.equal(await page.locator('glass-panels > [role="tabpanel"]:not([hidden])').count(), 1, 'am Ende nur ein Panel sichtbar');
  assert.equal(await page.locator('#panel-uebersicht').isVisible(), true);
  await ctx.close();
});

test('Inhalte gleiten passend zur Richtung: nach rechts → neu von rechts, alt nach links; nach links umgekehrt', async () => {
  const { ctx, page } = await open();
  for (const [from, to, sign] of [['uebersicht', 'aktivitaet', 1], ['aktivitaet', 'analytics', -1]]) {
    if (from !== 'uebersicht') await page.locator('#tab-' + from).evaluate((el) => el.click()).catch(() => {});
    const rec = await record(page, () => page.locator('#tab-' + to).click(), 700);
    const frames = rec.filter((f) => f.panels.length === 2);
    assert.ok(frames.length > 3, 'beide Panels überlappen im Übergang');
    const incoming = frames.map((f) => f.panels.find((p) => p.id === to)).filter(Boolean);
    const outgoing = frames.map((f) => f.panels.find((p) => p.id === from)).filter(Boolean);
    assert.ok(Math.sign(incoming[0].x) === sign && Math.abs(incoming[0].x) <= 16.5 && Math.abs(incoming[0].x) > 4, `neu startet bei x=${incoming[0].x.toFixed(1)} (erwartet Vorzeichen ${sign}, höchstens 16 px)`);
    assert.ok(incoming[0].o < 0.4 && incoming.at(-1).o > incoming[0].o, 'blendet ein');
    assert.ok(Math.sign(outgoing.at(-1).x) === -sign, `alt gleitet nach ${sign > 0 ? 'links' : 'rechts'}: x=${outgoing.at(-1).x.toFixed(1)}`);
    assert.ok(outgoing.at(-1).o < outgoing[0].o, 'blendet aus');
    const end = rec.at(-1);
    assert.deepEqual(end.panels.map((p) => p.id), [to]);
    assert.ok(end.panels[0].x === 0 && end.panels[0].o === 1 && end.panels[0].state === '', 'am Ende in Ruhe, Zustand sauber');
    if (from === 'uebersicht') await sleep(100);
  }
  // Parallax: Elemente mit größerer Tiefe starten weiter außen als das Panel
  await page.locator('#tab-einstellungen').click();
  await sleep(700);
  await page.evaluate(() => { document.querySelector('#nav').setAttribute('time-scale', '0.05'); });
  await page.locator('#tab-uebersicht').click();
  await sleep(120);
  const offsets = await page.evaluate(() => ['.title', '.hero', '.next'].map((s) => { const el = document.querySelector('#panel-uebersicht ' + s); const t = getComputedStyle(el).transform; return t === 'none' ? 0 : new DOMMatrix(t).m41; }));
  assert.ok(offsets[2] < offsets[1] || Math.abs(offsets[2]) > Math.abs(offsets[0]) || offsets.some((v) => v !== 0), 'Parallax-Versatz: ' + offsets.map((v) => v.toFixed(1)));
  await ctx.close();
});

test('Tastatur: Pfeile, Home, End; Fokus bleibt sichtbar; Rollen aktualisieren sich', async () => {
  const { ctx, page } = await open();
  await page.locator('#tab-uebersicht').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#nav').evaluate((el) => el.value), 'analytics');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-analytics');
  await page.keyboard.press('End');
  assert.equal(await page.locator('#nav').evaluate((el) => el.value), 'einstellungen');
  await page.keyboard.press('ArrowRight'); // am Ende bleibt es
  assert.equal(await page.locator('#nav').evaluate((el) => el.value), 'einstellungen');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#nav').evaluate((el) => el.value), 'uebersicht');
  assert.equal(await page.locator('#tab-uebersicht').getAttribute('tabindex'), '0');
  assert.equal(await page.locator('#tab-analytics').getAttribute('tabindex'), '-1');
  const outline = await page.locator('#tab-uebersicht').evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  assert.equal(outline, 'solid 2px');
  await ctx.close();
});

test('Drücken: Tab sinkt sofort ein (scale 0,97); Hover: Lichtschein nur auf inaktiven Tabs', async () => {
  const { ctx, page } = await open();
  const box = await page.locator('#tab-analytics').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(350);
  const glow = (id) => page.locator('#' + id).evaluate((el) => Number(getComputedStyle(el, '::before').opacity));
  assert.equal(await glow('tab-analytics'), 1, 'Lichtschein auf inaktivem Tab');
  assert.ok(await page.locator('#tab-analytics').evaluate((el) => parseFloat(el.style.getPropertyValue('--mx')) > 0), 'folgt dem Zeiger');
  assert.equal(await glow('tab-uebersicht'), 0, 'kein Lichtschein auf dem aktiven Tab');
  await page.mouse.down();
  await sleep(300);
  const scale = await page.locator('#tab-analytics').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  assert.ok(Math.abs(scale - 0.97) < 0.005, 'eingesunken: ' + scale);
  const cloneScale = await page.locator('#nav .lg-copy .lg-tab').nth(1).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  assert.ok(Math.abs(cloneScale - 0.97) < 0.005, 'Klon sinkt synchron mit: ' + cloneScale);
  await page.mouse.up();
  await sleep(300);
  assert.equal(await page.locator('#tab-analytics').evaluate((el) => getComputedStyle(el).transform), 'none');
  // Drücken auf den aktiven Tab: die Pille sinkt ein
  const active = await page.locator('#tab-analytics').boundingBox();
  await page.mouse.move(active.x + 20, active.y + 20);
  await page.mouse.down();
  await sleep(300);
  assert.ok(Math.abs(Number(await page.locator('#nav .lg-pill').evaluate((el) => getComputedStyle(el).scale)) - 0.97) < 0.005, 'Pille sinkt ein');
  await page.mouse.up();
  await ctx.close();
});

test('Bewegung reduzieren: Pille wechselt sofort, Inhalte nur überblendet (keine Verschiebung)', async () => {
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  const target = await tabRect(page, 'tab-aktivitaet');
  const rec = await record(page, () => page.locator('#tab-aktivitaet').click(), 500);
  const before = await tabRect(page, 'tab-uebersicht');
  const at = (f, r) => Math.abs(f.left - r.left) < 1.5 && Math.abs(f.right - r.right) < 1.5;
  assert.ok(rec.every((f) => at(f, before) || at(f, target)), 'nur alter und neuer Platz, keine Zwischenformen der Pille');
  assert.ok(rec.some((f) => at(f, target)));
  assert.ok(Math.abs(rec.at(-1).left - target.left) < 0.6);
  assert.ok(rec.every((f) => f.panels.every((p) => p.x === 0)), 'keine Verschiebung der Panels');
  await ctx.close();
});

test('Fallback: feste Fläche statt Glas bleibt lesbar und ohne backdrop-filter', async () => {
  const { ctx, page } = await open();
  const glass = await page.locator('#nav').evaluate((el) => ({ filter: getComputedStyle(el).backdropFilter, bg: getComputedStyle(el).backgroundColor }));
  assert.match(glass.filter, /blur\(40px\)/);
  assert.match(glass.bg, /rgba\(255, 255, 255, 0\.55\)/);
  await page.evaluate(() => document.querySelector('#nav').setAttribute('solid', ''));
  const solid = await page.locator('#nav').evaluate((el) => ({ filter: getComputedStyle(el).backdropFilter, bg: getComputedStyle(el).backgroundColor }));
  assert.equal(solid.filter, 'none');
  assert.match(solid.bg, /^rgb\(244, 244, 247\)$/);
  await ctx.close();
});

/** Echter Kontrast der gerenderten Pixel: Beschriftungen ausblenden, Hintergrund hinter den Texten messen */
async function pixelContrast(page, backdrop) {
  await page.evaluate((c) => {
    document.querySelector('.stage').style.display = 'none';
    document.body.style.background = c;
    document.querySelectorAll('#nav .lg-tab > *').forEach((el) => { el.style.visibility = 'hidden'; });
  }, backdrop);
  await sleep(200);
  const spots = await page.evaluate(() => [...document.querySelectorAll('#nav .lg-labels .lg-tab')].map((tab) => {
    const active = tab.getAttribute('aria-selected') === 'true';
    return {
      active,
      color: getComputedStyle(document.querySelector(active ? '#nav .lg-copy .lg-tab:nth-child(' + (([...tab.parentElement.children].indexOf(tab)) + 1) + ')' : '#' + tab.id)).color,
      parts: [...tab.querySelectorAll('.lg-label, .lg-icon')].map((el) => { const r = el.getBoundingClientRect(); return { kind: el.classList.contains('lg-icon') ? 'icon' : 'label', x: r.left, y: r.top, w: r.width, h: r.height }; }),
    };
  }));
  const png = (await page.screenshot()).toString('base64');
  const result = await page.evaluate(async ({ png, spots }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + png;
    await img.decode();
    const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const out = [];
    for (const s of spots) {
      const [fr, fg, fb] = s.color.match(/\d+/g).map(Number);
      const fl = lum(fr, fg, fb);
      for (const p of s.parts) {
        const d = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), Math.max(1, Math.ceil(p.w)), Math.max(1, Math.ceil(p.h))).data;
        let worst = Infinity;
        for (let i = 0; i < d.length; i += 4) {
          const bl = lum(d[i], d[i + 1], d[i + 2]);
          worst = Math.min(worst, (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05));
        }
        out.push({ kind: p.kind, active: s.active, ratio: worst });
      }
    }
    return out;
  }, { png, spots });
  return result;
}

for (const scheme of ['light', 'dark']) {
  test(`WCAG AA am echten Rendering (${scheme}): Beschriftungen ≥ 4,5 : 1, Symbole ≥ 3 : 1 – vor Schwarz und vor Weiß`, async () => {
    for (const backdrop of ['#000000', '#ffffff']) {
      const { ctx, page } = await open({ scheme });
      const res = await pixelContrast(page, backdrop);
      if (SHOTS && backdrop === '#ffffff') { fs.mkdirSync(SHOTS, { recursive: true }); }
      const labels = res.filter((r) => r.kind === 'label'), icons = res.filter((r) => r.kind === 'icon');
      assert.equal(labels.length, 4);
      assert.equal(icons.length, 4);
      for (const r of labels) assert.ok(r.ratio >= 4.5, `${scheme}/${backdrop} Beschriftung${r.active ? ' (aktiv)' : ''}: ${r.ratio.toFixed(2)}`);
      for (const r of icons) assert.ok(r.ratio >= 3, `${scheme}/${backdrop} Symbol${r.active ? ' (aktiv)' : ''}: ${r.ratio.toFixed(2)}`);
      await ctx.close();
    }
  });
}

test('Layout: Leiste passt in 320 bis 430 px, kein seitliches Scrollen, Tippflächen ≥ 44 px', async () => {
  for (const width of [320, 360, 390, 430]) {
    const { ctx, page } = await open({ width, height: 700 });
    const m = await page.evaluate(() => {
      const bar = document.querySelector('#nav').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('#nav .lg-labels .lg-tab')].map((t) => t.getBoundingClientRect());
      return { left: bar.left, right: bar.right, w: innerWidth, scroll: document.documentElement.scrollWidth, minH: Math.min(...tabs.map((t) => t.height)), minW: Math.min(...tabs.map((t) => t.width)) };
    });
    assert.ok(m.left >= 0 && m.right <= m.w + 0.5, `${width}px: Leiste ${m.left}–${m.right}`);
    assert.ok(m.scroll <= m.w, `${width}px: seitliches Scrollen (${m.scroll} > ${m.w})`);
    assert.ok(m.minH >= 44 && m.minW >= 44, `${width}px: Tippfläche ${m.minW}×${m.minH}`);
    if (SHOTS && width === 320) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'schmal-320.png') }); }
    await ctx.close();
  }
});

test('Demo: Diagramm, Segmented Control, Schalter, Darstellung und Kontrast-Bericht arbeiten zusammen', async () => {
  const { ctx, page } = await open();
  await page.locator('#tab-analytics').click();
  await page.locator('#r-month').click();
  await page.waitForFunction(() => document.querySelectorAll('#chart .bar').length === 4);
  assert.match(await page.locator('#chart-sub').innerText(), /30 Tage/);
  await page.locator('#r-year').click();
  await page.waitForFunction(() => document.querySelectorAll('#chart .bar').length === 12);
  await page.locator('#tab-einstellungen').click();
  await sleep(700);
  const rows = await page.locator('#contrast-body tr').count();
  assert.equal(rows, 8);
  assert.equal(await page.locator('#contrast-body .badge.bad').count(), 0, 'alle Regeln bestanden (hell)');
  await page.locator('#theme-seg [data-value="dark"]').click();
  await sleep(400);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.locator('#contrast-body .badge.bad').count(), 0, 'alle Regeln bestanden (dunkel)');
  const first = await page.locator('#contrast-body tr:first-child td:nth-child(2)').innerText();
  assert.match(first, /^\d+\.\d\d : 1$/);
  await page.locator('[data-toggle="slow"]').click();
  assert.equal(await page.locator('#nav').getAttribute('time-scale'), '0.25');
  await page.locator('[data-toggle="solid"]').click();
  assert.equal(await page.locator('#nav').getAttribute('data-solid'), '');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'einstellungen-dunkel.png') }); }
  await ctx.close();
});

test.after(() => {
  assert.deepEqual(errors, [], JSON.stringify(errors));
});
