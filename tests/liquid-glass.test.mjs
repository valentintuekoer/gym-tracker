// Tests für Liquid Glass (reine Logik, ohne Browser): Feder-Physik und WCAG-Kontrast der Material-Tokens.
// Ausführen mit: node --test tests/liquid-glass.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Spring, dampingRatio, overshoot } from '../liquid-glass/src/spring.js';
import { parseColor, contrast, luminance, over, stack, checkTokens, RULES, BLACK, WHITE } from '../liquid-glass/src/contrast.js';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../liquid-glass/src/liquid-glass.css'), 'utf8');

/* ---------- Feder ---------- */

const run = (s, seconds, dt = 1 / 120) => { const out = []; for (let t = 0; t < seconds; t += dt) out.push(s.step(dt)); return out; };

test('Feder: kommt am Ziel an und bleibt dort', () => {
  const s = new Spring(0, { stiffness: 300, damping: 25 });
  s.target = 100;
  run(s, 2);
  assert.equal(s.value, 100);
  assert.equal(s.velocity, 0);
  assert.equal(s.settled, true);
});

test('Feder: unterdämpft schwingt über, kritisch gedämpft nicht', () => {
  const bouncy = new Spring(0, { stiffness: 520, damping: 31 });
  bouncy.target = 100;
  const peak = Math.max(...run(bouncy, 1));
  assert.ok(peak > 100 && peak < 108, 'Überschwingen ' + peak);
  assert.ok(Math.abs((peak - 100) / 100 - overshoot({ stiffness: 520, damping: 31 })) < 0.01, 'stimmt mit der Theorie überein');
  const critical = new Spring(0, { stiffness: 300, damping: 2 * Math.sqrt(300) });
  critical.target = 100;
  assert.ok(Math.max(...run(critical, 2)) <= 100.001);
});

test('Liquid Stretch: die vordere Kante eilt der hinteren voraus, am Ende sind beide am Ziel', () => {
  const LEAD = { stiffness: 560, damping: 33 }, TRAIL = { stiffness: 360, damping: 29 }; // wie in glass-tabs.js
  const w = 84; // Reiterbreite
  const move = (dist) => {
    const lead = new Spring(w, LEAD), trail = new Spring(0, TRAIL);
    lead.target = dist + w; trail.target = dist; // Pille wandert nach rechts: Breite bleibt w
    let maxWidth = 0, minWidth = Infinity, over = 0, ordered = true;
    for (let t = 0; t < 1.5; t += 1 / 120) {
      const r = lead.step(1 / 120), l = trail.step(1 / 120);
      maxWidth = Math.max(maxWidth, r - l);
      minWidth = Math.min(minWidth, r - l);
      over = Math.max(over, r - (dist + w));
      if (r < l) ordered = false;
    }
    assert.equal(lead.value, dist + w);
    assert.equal(trail.value, dist);
    assert.equal(ordered, true, 'Kanten kreuzen sich nie');
    return { stretch: maxWidth / w, min: minWidth, over };
  };
  const near = move(84), far = move(252);
  assert.ok(near.stretch > 1.1 && near.stretch < 1.3, 'Nachbar-Reiter: ×' + near.stretch.toFixed(2));
  assert.ok(far.stretch > near.stretch && far.stretch < 1.7, 'drei Reiter weit: ×' + far.stretch.toFixed(2));
  assert.ok(near.over > 1 && near.over < 8, 'federt am Ziel nach: ' + near.over.toFixed(1) + ' px');
  assert.ok(near.min >= w * 0.9, 'federt höchstens um 10 % schmaler als der Reiter: ' + (near.min / w).toFixed(3));
});

test('Feder: Umlenken mitten in der Bewegung behält Position und Geschwindigkeit (kein Sprung)', () => {
  const s = new Spring(0, { stiffness: 300, damping: 25 });
  s.target = 100;
  run(s, 0.12);
  const before = { value: s.value, velocity: s.velocity };
  assert.ok(before.velocity > 100, 'in Fahrt');
  s.target = 0; // Richtungswechsel
  s.configure({ stiffness: 520, damping: 31 }); // andere Federparameter ändern nichts an Zustand
  assert.equal(s.value, before.value);
  assert.equal(s.velocity, before.velocity);
  const next = s.step(1 / 120);
  assert.ok(Math.abs(next - before.value) < 3, 'nächster Schritt schließt stetig an: ' + (next - before.value));
  run(s, 2);
  assert.equal(s.value, 0);
});

test('Feder: lange Frames (Tab im Hintergrund) lassen sie nicht explodieren', () => {
  const s = new Spring(0, { stiffness: 520, damping: 31 });
  s.target = 500;
  for (let i = 0; i < 100; i++) s.step(5); // 5-s-Frames werden auf 50 ms begrenzt
  assert.ok(Number.isFinite(s.value));
  assert.equal(s.value, 500);
});

test('Dämpfungsgrad der gewählten Parameter', () => {
  assert.ok(Math.abs(dampingRatio({ stiffness: 560, damping: 33 }) - 0.70) < 0.01);
  assert.ok(Math.abs(dampingRatio({ stiffness: 360, damping: 29 }) - 0.76) < 0.01);
  assert.equal(overshoot({ stiffness: 100, damping: 20 }), 0);
});

/* ---------- Kontrast ---------- */

test('Kontrast-Rechnung stimmt mit bekannten Werten überein', () => {
  assert.ok(Math.abs(contrast(BLACK, WHITE) - 21) < 1e-9);
  assert.equal(contrast([119, 119, 119], WHITE).toFixed(2), '4.48'); // #777 auf Weiß: knapp unter AA
  assert.equal(contrast([118, 118, 118], WHITE).toFixed(2), '4.54'); // #767676: knapp darüber
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('rgba(28, 28, 32, .74)'), [28, 28, 32, 0.74]);
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'.replace('50%', '0.5')), [10, 20, 30, 0.5]);
  assert.deepEqual(over([255, 255, 255, 0.5], BLACK).map(Math.round), [128, 128, 128]);
  assert.ok(luminance(WHITE) > luminance([200, 200, 200]));
  assert.deepEqual(stack([[255, 255, 255, 1]], BLACK), [255, 255, 255]);
});

/** Token-Blöcke aus dem echten CSS lesen (eine Quelle der Wahrheit) */
function tokens(selectorStart) {
  const i = css.indexOf(selectorStart);
  assert.ok(i >= 0, selectorStart + ' fehlt');
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/(--lg-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const light = tokens(':root {');
const darkForced = tokens(':root[data-theme="dark"] {');
const darkSystem = tokens(':root:not([data-theme="light"]) {');

test('Tokens: Dunkelwerte im System-Block und im [data-theme="dark"]-Block sind identisch', () => {
  assert.deepEqual(darkSystem, darkForced);
  for (const k of Object.keys(darkForced)) assert.ok(k in light, k + ' hat keinen hellen Grundwert auf :root');
});

for (const [name, dark] of [['hell', null], ['dunkel', darkForced]]) {
  test(`WCAG AA (${name}): Beschriftungen, Symbole und Fokusring auf Glas vor jedem Hintergrund zwischen Schwarz und Weiß`, () => {
    const get = (v) => (dark && v in dark ? dark[v] : light[v]);
    const results = checkTokens(get);
    assert.equal(results.length, RULES.length);
    const failed = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.ratio.toFixed(2)} < ${r.min} (Hintergrund ${r.worstBackdrop})`);
    assert.deepEqual(failed, []);
  });
}

test('Das helle Glas hat wie vorgegeben 55 % Weiß; die Kontrastwerte sind mit Reserve eingehalten', () => {
  assert.equal(light['--lg-fill'], 'rgba(255, 255, 255, 0.55)');
  const worst = Math.min(...checkTokens((v) => light[v]).map((r) => r.ratio / r.min));
  assert.ok(worst >= 1.04, 'Reserve: ' + worst.toFixed(2));
});

/* ---------- App-Stylesheet (style.css): iOS-27-Material und Regler „Klar ↔ Getönt“ ---------- */

const appCss = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../style.css'), 'utf8');

/** Füllung bei gegebenem Reglerwert: rgba(r, g, b, calc(a + b * var(--lg-tint))) auswerten */
function fillAt(block, name, tint) {
  const m = block.match(new RegExp(name + ':\\s*rgba\\(([^,]+),([^,]+),([^,]+),\\s*calc\\(([\\d.]+)\\s*\\+\\s*([\\d.]+)\\s*\\*\\s*var\\(--lg-tint\\)\\)\\)'));
  assert.ok(m, name + ' hängt nicht am Regler (--lg-tint)');
  return Number(m[4]) + Number(m[5]) * tint;
}
const darkBlock = appCss.slice(appCss.indexOf(':root,'), appCss.indexOf(':root[data-theme="light"] {'));
const lightBlock = appCss.slice(appCss.indexOf(':root[data-theme="light"] {'), appCss.indexOf(':root[data-theme="light"] {') + 6000);

test('Regler: Füllung wird mit dem Regler deckender, bleibt im sinnvollen Bereich und der Mittelwert entspricht dem Look', () => {
  // dunkel: „klar“ ist fast durchsichtig (Vorgabe 0, Auswahl im Design-Builder); hell: wie bisher
  for (const [block, name, mid, min] of [[darkBlock, '--lg-fill', 0.462, 0.01], [darkBlock, '--lg-card-fill', 0.47, 0.01], [lightBlock, '--lg-fill', 0.55, 0.38], [lightBlock, '--lg-card-fill', 0.72, 0.38]]) {
    const lo = fillAt(block, name, 0), m = fillAt(block, name, 0.5), hi = fillAt(block, name, 1);
    assert.ok(lo < m && m < hi, name + ' wächst nicht mit dem Regler');
    assert.ok(lo >= min && hi <= 0.96, `${name}: ${lo}…${hi} außerhalb ${min}…0,96`);
    assert.ok(Math.abs(m - mid) < 0.011, `${name} Mitte ${m} ≠ ${mid}`);
  }
  assert.match(appCss, /--lg-tint:\s*0;/);
  // Sheets, Toast und Timer bleiben deckend genug zum Lesen, auch bei „ultraklar“
  assert.ok(fillAt(darkBlock, '--lg-overlay-fill', 0) >= 0.8, 'Überlagerungen (Sheet, Toast, Timer) zu durchsichtig');
});

test('Material iOS 27: dunkle Kante und hellere Glanzlichter sind in beiden Designs definiert', () => {
  for (const block of [darkBlock, lightBlock]) {
    assert.match(block, /--lg-edge-dark:/);
    assert.match(block, /--gt-a1:/);
  }
  assert.ok(Number(darkBlock.match(/--lg-spec-spot:\s*rgba\(255, 255, 255, ([\d.]+)\)/)[1]) >= 0.1, 'Glanzpunkt dunkel zu schwach');
  assert.match(appCss, /inset 0 0 14px -3px var\(--lg-edge-dark\)/, 'Kantenabdunklung fehlt im Material');
  assert.match(appCss, /at var\(--spec-x, 11%\) 6%/, 'Glanzpunkt reagiert nicht auf --spec-x');
});

test('Formen: Kapsel, großer Sheet-Radius und konzentrischer Innenradius sind als Werte festgelegt', () => {
  assert.match(appCss, /--r-capsule:\s*999px/);
  assert.match(appCss, /--r-sheet:\s*40px/);
  assert.match(appCss, /\.modal-card \{ --r-input: max\(12px, calc\(var\(--r-sheet\) - var\(--s-5\)\)\); \}/);
  assert.match(appCss, /\.modal-card\.scrolls,\s*\n\.modal-card\.stretched \{[^}]*border-bottom-left-radius: 0/);
});

test('Berührung: Lichtfläche, Reduzierte Bewegung und erzwungene Farben sind abgedeckt', () => {
  assert.match(appCss, /\.gt-lit \{[^}]*mix-blend-mode: var\(--gt-blend, plus-lighter\)/);
  assert.match(appCss, /@media \(forced-colors: active\) \{\s*\.gt-lit \{ display: none; \}/);
  assert.match(appCss, /html\.gt :is\(/);
});

/* ---------- Avatare ohne Foto: Farben mit weißer Schrift lesbar ---------- */

test('Buchstaben-Avatare: alle zehn Hintergrundfarben tragen weiße Schrift mit mindestens 4,5:1', () => {
  const hsl = (h, s, l) => { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); }; return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)); };
  const found = [...appCss.matchAll(/\.ac(\d)\s*\{\s*--ac:\s*(\d+) (\d+)% (\d+)%;\s*\}/g)];
  assert.equal(found.length, 10);
  assert.deepEqual(found.map((m) => Number(m[1])), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const m of found) {
    const bg = hsl(Number(m[2]), Number(m[3]), Number(m[4]));
    const ratio = contrast(WHITE, bg);
    assert.ok(ratio >= 4.5, `.ac${m[1]} hsl(${m[2]} ${m[3]}% ${m[4]}%) → ${ratio.toFixed(2)}:1`);
  }
  // die Farben unterscheiden sich spürbar (verschiedene Farbtöne)
  assert.equal(new Set(found.map((m) => m[2])).size, 10);
});
