// Pixel-Kontrast (WCAG AA): schaltet jeden sichtbaren Text unsichtbar, fotografiert den Hintergrund dahinter
// und rechnet die Textfarbe gegen jeden einzelnen Hintergrundpixel (Glas über Farbflecken ist so geprüft,
// nicht nur gegen eine Annahme). Text unter der Tab-Leiste (samt Ausblendzone), dem Timer oder hinter einem Sheet zählt nicht.
//
//   node scripts/contrast-pixels.mjs [#/,#/history,…] [Breite]      (Standard: Startseite, Daily, Verlauf, … bei 390 px)
//   GLASS=0 node scripts/contrast-pixels.mjs      Regler „Klar ↔ Getönt“ (0 … 100, Standard 50) – beide Enden müssen bestehen
//
// Gibt „Unter Schwelle: 0“ aus, wenn alles ≥ 4,5:1 (große Schrift ≥ 3:1) ist.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'tests/emulator/package.json'))('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
const ROUTES = (process.argv[2] || '#/,#/daily,#/daily/plan,#/history,#/library,#/profile,#/settings,#/settings/training,#/workout').split(',');
const WIDTH = Number(process.argv[3] || 390);
const GLASS = Number(process.env.GLASS ?? 50);
let worst = [];
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, serviceWorkers: 'block', locale: 'de-DE', reducedMotion: 'reduce' });
  await ctx.route('https://www.gstatic.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.locator('[data-action="intro-done"]').click();
  await page.locator('[data-action="auth-guest"]').click();
  for (let i = 0; i < 3; i++) { await page.locator('[data-action="setup-next"]').click(); await page.waitForTimeout(300); }
  await page.evaluate(([theme, glass]) => {
    const { Core, db } = window.GymApp;
    db.settings.theme = theme;
    db.settings.glass = glass;
    const s0 = Core.startSession(db, db.days[0].id, Date.now() - 86400000 * 2);
    s0.exercises.forEach((se) => se.sets.forEach((st) => { Core.updateSet(db, se.id, st.id, 'weight', 50); Core.updateSet(db, se.id, st.id, 'reps', 8); Core.toggleSet(db, se.id, st.id, Date.now()); }));
    Core.finishSession(db, Date.now() - 86400000 * 2 + 3600000);
    Core.startSession(db, db.days[1].id, Date.now() - 600000);
    // Daily: Gewichte der letzten Tage und ein Mealplan (teils abgehakt)
    [[6, 83.8], [3, 83.1], [1, 82.4]].forEach(([n, w]) => Core.setWeightOn(db, Core.dayKey(Date.now() - n * 86400000), w));
    [['Frühstück', '08:00', 'Haferflocken, Skyr, Beeren', 520], ['Mittagessen', '12:30', 'Reis, Hähnchen, Brokkoli', 740], ['Snack', '16:00', 'Proteinshake', 180]].forEach(([name, time, note, kcal]) => Core.addMeal(db, { name, time, note, kcal }));
    Core.toggleMeal(db, Core.dayKey(Date.now()), db.settings.mealPlan[0].id);
    window.GymApp.save();
  }, [scheme, GLASS]);
  await page.reload();
  await page.waitForTimeout(600);
  const scenarios = ROUTES.map((r) => ({ name: r, run: async () => { await page.evaluate((h) => { location.hash = h; }, r); await page.waitForTimeout(500); } }));
  scenarios.push({ name: 'workout+timer', run: async () => { await page.evaluate(() => { location.hash = '#/workout'; }); await page.waitForTimeout(500); await page.locator('.check').first().click().catch(() => {}); await page.waitForTimeout(700); } });
  scenarios.push({ name: 'sheet', run: async () => { await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(500); await page.locator('[data-action="add-day"]').first().click().catch(() => {}); await page.waitForTimeout(700); } });
  for (const sc of scenarios) {
    await sc.run();
    const targets = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el || el.closest('script,style,[hidden],[aria-hidden="true"],.sr-only,svg')) continue;
        let op = 1, e = el;
        while (e) { op *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement; }
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (op < 0.85) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
        // Text in der Ausblendzone über der Tab-Leiste (Inhalt blendet dort absichtlich aus) zählt nicht
        const tb = document.querySelector('.tabbar');
        if (!document.querySelector('.modal-card') && tb && getComputedStyle(tb).display !== 'none' && b.bottom > tb.getBoundingClientRect().top - 28) continue;
        // ebenso über dem Pausentimer: die Karte blendet dort aus
        const tm = document.querySelector('.timer-bar.show');
        if (tm && !document.querySelector('.modal-card') && b.bottom > tm.getBoundingClientRect().top - 28) continue;
        // verdeckt (Tab-Leiste, Timer, Sheet-Hintergrund …)? Dann zählt der Text nicht
        const modal = document.querySelector('.modal-card');
        if (modal && !modal.contains(el)) continue;
        const pts = [[b.left + b.width / 2, b.top + b.height / 2], [b.left + 2, b.top + b.height / 2], [b.right - 2, b.top + b.height / 2]];
        if (pts.some(([px, py]) => { if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) return true; const hit = document.elementFromPoint(px, py); return !hit || !(el.contains(hit) || hit.contains(el)); })) continue;
        const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10);
        out.push({ t: t.slice(0, 28), x: Math.max(0, Math.floor(b.left)), y: Math.max(0, Math.floor(b.top)), w: Math.ceil(Math.min(b.width, innerWidth - b.left)), h: Math.ceil(Math.min(b.height, innerHeight - b.top)), color: cs.color, big: fs >= 24 || (fs >= 18.66 && fw >= 700), cls: (el.className && el.className.toString().split(' ')[0]) || el.tagName.toLowerCase(), op });
      }
      return out;
    });
    await page.addStyleTag({ content: '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}', }).then(async (h) => {
      await page.waitForTimeout(150);
      const png = (await page.screenshot()).toString('base64');
      await h.evaluate((el) => el.remove());
      const res = await page.evaluate(async ({ png, targets }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
        const out = [];
        for (const t of targets) {
          const m = t.color.match(/[\d.]+/g).map(Number);
          const a = m[3] === undefined ? 1 : m[3];
          const d = g.getImageData(t.x, t.y, Math.max(1, t.w), Math.max(1, t.h)).data;
          let min = 99;
          for (let i = 0; i < d.length; i += 4) {
            const r = m[0] * a + d[i] * (1 - a), gg = m[1] * a + d[i + 1] * (1 - a), b = m[2] * a + d[i + 2] * (1 - a);
            const l1 = L(r, gg, b), l2 = L(d[i], d[i + 1], d[i + 2]);
            const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (cr < min) min = cr;
          }
          out.push({ ...t, ratio: min });
        }
        return out;
      }, { png, targets });
      for (const r of res) {
        const need = r.big ? 3 : 4.5;
        if (r.ratio < need) worst.push({ scheme, screen: sc.name, text: r.t, cls: r.cls, ratio: +r.ratio.toFixed(2), need });
      }
      console.log(scheme, sc.name, res.length, 'Texte, min', Math.min(...res.map((r) => r.ratio)).toFixed(2));
    });
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log('\nUnter Schwelle:', worst.length);
for (const w of worst.slice(0, 40)) console.log(JSON.stringify(w));
