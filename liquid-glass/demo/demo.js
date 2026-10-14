/* Demo für Liquid Glass: verdrahtet die Beispielinhalte. Die Komponenten selbst liegen in ../src. */
import '../src/glass-tabs.js';
import '../src/glass-panels.js';
import { checkTokens } from '../src/contrast.js';

const root = document.documentElement;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privater Modus */ } },
};

/* ---------- Darstellung: hell / dunkel / System ---------- */

const themeSeg = $('#theme-seg');
const isDark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

function setTheme(mode) {
  if (mode === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = mode;
  store.set('lg-theme', mode);
  if (themeSeg.value !== mode) themeSeg.select(mode);
  requestAnimationFrame(renderContrast);
}
themeSeg.addEventListener('change', (e) => setTheme(e.detail.value));
$('#theme').addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(renderContrast));
{
  const saved = store.get('lg-theme');
  if (saved === 'light' || saved === 'dark') { root.dataset.theme = saved; themeSeg.setAttribute('value', saved); }
}

/* ---------- Schalter: Zeitlupe · Bewegung reduzieren · feste Fläche ---------- */

const motionEls = () => $$('glass-tabs, glass-panels');
const apply = {
  slow: (on) => motionEls().forEach((el) => (on ? el.setAttribute('time-scale', '0.25') : el.removeAttribute('time-scale'))),
  reduce: (on) => {
    motionEls().forEach((el) => el.toggleAttribute('reduced-motion', on));
    document.body.classList.toggle('demo-reduced', on);
  },
  solid: (on) => { $$('.lg-surface').forEach((el) => el.toggleAttribute('data-solid', on)); requestAnimationFrame(renderContrast); },
};
$$('[data-toggle]').forEach((sw) => sw.addEventListener('click', () => {
  const on = sw.getAttribute('aria-checked') !== 'true';
  sw.setAttribute('aria-checked', String(on));
  apply[sw.dataset.toggle](on);
}));

/* ---------- Diagramm (Analytics) ---------- */

const RANGES = {
  week: { unit: 'kg', labels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], data: [3120, 0, 5820, 3490, 0, 3120, 4010], gap: 8, text: 'Gesamtvolumen der letzten 7 Tage' },
  month: { unit: 'kg', labels: ['KW 38', 'KW 39', 'KW 40', 'KW 41'], data: [9800, 12480, 11250, 13020], gap: 14, text: 'Gesamtvolumen der letzten 30 Tage' },
  year: { unit: 'kg', labels: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'], data: [38200, 41100, 43900, 40200, 45300, 47100, 42800, 44600, 48200, 33100, 0, 0], gap: 6, text: 'Gesamtvolumen in diesem Jahr' },
};
const nf = new Intl.NumberFormat('de-AT');
/** Obergrenze der Skala: nächste „runde“ Zahl (1 · 1,5 · 2 · 2,5 · 3 · 4 · 5 · 6 · 8 · 10 × Zehnerpotenz) über dem Maximum */
const niceMax = (v) => {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((x) => x >= v);
};

function renderChart(key) {
  const r = RANGES[key];
  const max = niceMax(Math.max(...r.data));
  const total = r.data.reduce((a, b) => a + b, 0);
  const active = r.data.filter((v) => v > 0);
  const fmt = (v) => (v >= 1000 ? nf.format(v / 1000) + ' k' : String(v));
  const chart = $('#chart');
  chart.style.setProperty('--gap', r.gap + 'px');
  chart.setAttribute('aria-label', `Balkendiagramm: ${r.text}. ` + r.data.map((v, i) => `${r.labels[i]} ${nf.format(v)} kg`).join(', '));
  chart.innerHTML =
    `<div class="y" aria-hidden="true"><span style="top:0">${fmt(max)}</span><span style="top:50%">${fmt(max / 2)}</span><span style="top:100%">0</span></div>` +
    `<div class="plot" aria-hidden="true">${r.data.map((v) => `<div class="bar${v ? '' : ' zero'}"><i data-h="${v / max}"></i></div>`).join('')}</div>` +
    `<div class="x" aria-hidden="true">${r.labels.map((l) => `<span>${l}</span>`).join('')}</div>`;
  // Balken wachsen von unten (gestaffelt); danach steht alles an seinem Platz
  const bars = $$('.bar i', chart);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('demo-reduced');
  bars.forEach((b, i) => {
    const h = Number(b.dataset.h);
    b.style.transition = 'none';
    b.style.transform = reduced ? `scaleY(${h})` : 'scaleY(0)';
    b.style.height = '100%';
    b.getBoundingClientRect();
    b.style.transition = '';
    b.style.transitionDelay = reduced ? '0ms' : i * 28 + 'ms';
    b.style.transform = `scaleY(${h})`;
  });
  $('#chart-total').textContent = nf.format(total);
  $('#chart-sub').textContent = r.text;
  $('#kpi-best').textContent = nf.format(Math.max(...r.data)) + ' kg';
  $('#kpi-avg').textContent = nf.format(Math.round(total / active.length)) + ' kg';
}
$('#range').addEventListener('change', (e) => renderChart(e.detail.value));

/* ---------- Ring (Übersicht): zeichnet sich ein, wenn der Reiter erscheint ---------- */

const ring = $('#ring');
const CIRC = 2 * Math.PI * 50;
$('#nav').addEventListener('change', (e) => {
  if (e.detail.value !== 'uebersicht' || matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('demo-reduced')) return;
  ring.style.transition = 'none';
  ring.style.strokeDashoffset = CIRC;
  ring.getBoundingClientRect();
  ring.style.transition = '';
  ring.style.strokeDashoffset = CIRC * 0.25;
});

/* ---------- Kontrast-Bericht: dieselbe Rechnung wie in tests/liquid-glass.test.mjs ---------- */

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4 9-9"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
function renderContrast() {
  const cs = getComputedStyle(root);
  const results = checkTokens((name) => cs.getPropertyValue(name).trim());
  $('#contrast-body').innerHTML = results.map((r) => `
    <tr><td>${r.name}</td><td class="r">${r.ratio.toFixed(2)} : 1</td><td class="r">${r.min} : 1</td>
    <td class="r"><span class="badge${r.ok ? '' : ' bad'}">${r.ok ? CHECK + 'AA' : CROSS + 'zu niedrig'}</span></td></tr>`).join('');
}

renderChart('week');
renderContrast();
document.fonts?.ready.then(renderContrast);
