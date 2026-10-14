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
