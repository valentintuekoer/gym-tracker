/* <glass-tabs> – schwebende Tab-Leiste bzw. Segmented Control im „Liquid Glass“-Look.
 *
 *   <glass-tabs value="uebersicht" label="Hauptnavigation" variant="bar">
 *     <button type="button" role="tab" data-value="uebersicht" aria-controls="panel-uebersicht">
 *       <svg class="lg-icon" viewBox="0 0 24 24">…</svg><span class="lg-label">Übersicht</span>
 *     </button>
 *     …
 *   </glass-tabs>
 *
 * Attribute:  value · label · variant="bar" (Standard, Symbol über Text) | "segmented" (nur Text, kompakt)
 *             time-scale (Zeitlupe, z. B. 0.25) · reduced-motion (Reduzieren erzwingen) · solid (ohne Glas)
 * Methoden:   select(value) · refresh()          Eigenschaft: value
 * Ereignis:   "change"  detail: { value, index, previous, direction }   direction: −1 links · +1 rechts · 0 erster Stand
 *
 * Bewegung (Liquid Stretch): Die Pille besteht aus zwei Kanten, jede mit eigener Feder. Die vordere Kante ist straffer
 * und eilt voraus, die hintere hinkt nach – dadurch dehnt sich die Pille in Laufrichtung und zieht sich am Ziel
 * federnd zusammen (leichtes Überschwingen). Ein neues Ziel mitten in der Bewegung setzt die Federn einfach um:
 * Position und Geschwindigkeit bleiben erhalten, nichts springt.
 *
 * Beschriftungen: Ein zweiter, geklonter Layer in Akzentfarbe wird per clip-path exakt auf die Pille zugeschnitten.
 * Text und Symbole wechseln so Pixel für Pixel mit der Pille die Farbe, ohne einzelne Farbübergänge zu takten.
 */
import { Spring } from './spring.js';

const REDUCED = '(prefers-reduced-motion: reduce)';
// Vordere Kante: straff (ζ ≈ 0,70) · hintere Kante: träger (ζ ≈ 0,76). Ergebnis bei ~84 px breiten Reitern:
// Dehnung ×1,18 bei Nachbar-Reiter, ×1,54 über drei Reiter; Überschwingen 3–9 px; nach ~0,5–0,6 s in Ruhe.
const LEAD = { stiffness: 560, damping: 33 };
const TRAIL = { stiffness: 360, damping: 29 };
const SQUASH = 0.07; // höchstens so viel flacher wird die Pille bei maximaler Dehnung (Volumen bleibt „flüssig“)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class GlassTabs extends HTMLElement {
  static observedAttributes = ['value', 'solid'];

  #ready = false;
  #tabs = [];
  #clones = [];
  #labels = null;
  #copy = null;
  #pill = null;
  #rects = [];
  #index = -1;
  #left = new Spring(0, TRAIL);
  #right = new Spring(0, LEAD);
  #raf = 0;
  #last = 0;
  #ro = null;
  #mo = null;
  #radius = 0;
  #width = 0;

  connectedCallback() {
    if (this.#ready) return;
    this.#ready = true;
    this.classList.add('lg-surface', 'lg-tabs');
    this.toggleAttribute('data-solid', this.hasAttribute('solid'));

    const tabs = [...this.querySelectorAll(':scope > [role="tab"]')];
    this.#labels = document.createElement('div');
    this.#labels.className = 'lg-labels';
    this.#labels.setAttribute('role', 'tablist');
    if (this.getAttribute('label')) this.#labels.setAttribute('aria-label', this.getAttribute('label'));
    this.#pill = Object.assign(document.createElement('span'), { className: 'lg-pill' });
    this.#pill.setAttribute('aria-hidden', 'true');
    this.#copy = Object.assign(document.createElement('div'), { className: 'lg-copy' });
    this.#copy.setAttribute('aria-hidden', 'true');
    this.#copy.inert = true;
    tabs.forEach((t) => { t.classList.add('lg-tab'); this.#labels.append(t); });
    this.append(this.#pill, this.#labels, this.#copy);

    this.#labels.addEventListener('click', (e) => this.#onClick(e));
    this.#labels.addEventListener('keydown', (e) => this.#onKey(e));
    this.#labels.addEventListener('pointerdown', (e) => this.#onPress(e));
    this.#labels.addEventListener('pointermove', (e) => this.#onHover(e), { passive: true });
    this.#labels.addEventListener('pointerleave', () => this.#clearHover());

    this.#sync();
    const initial = this.getAttribute('value') || this.#tabs[0]?.dataset.value;
    this.#apply(this.#tabs.findIndex((t) => t.dataset.value === initial), { animate: false, silent: true });

    // Maße ändern sich mit Schrift, Fenstergröße und Inhalt → neu messen, Pille bleibt am Ziel
    this.#ro = new ResizeObserver(() => this.#remeasure());
    this.#ro.observe(this);
    this.#mo = new MutationObserver(() => this.refresh());
    this.#mo.observe(this.#labels, { childList: true, subtree: true, characterData: true });
    document.fonts?.ready.then(() => this.#remeasure());
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    this.#ro?.disconnect();
    this.#mo?.disconnect();
    this.#ready = false;
  }

  attributeChangedCallback(name, _old, value) {
    if (!this.#ready) return;
    if (name === 'value' && value !== this.value) this.select(value);
    if (name === 'solid') this.toggleAttribute('data-solid', value !== null);
  }

  get value() { return this.#tabs[this.#index]?.dataset.value ?? null; }
  set value(v) { this.select(v); }

  /** Reiter wechseln. Rückgabe: true, wenn sich etwas geändert hat. */
  select(value) {
    const i = this.#tabs.findIndex((t) => t.dataset.value === value);
    return i >= 0 && i !== this.#index ? (this.#apply(i, { animate: true }), true) : false;
  }

  /** Nach dynamischen Änderungen an den Reitern neu aufbauen. */
  refresh() {
    this.#sync();
    this.#remeasure();
  }

  /* ---------- Aufbau ---------- */

  #sync() {
    this.#tabs = [...this.#labels.querySelectorAll('[role="tab"]')];
    this.#tabs.forEach((t, i) => {
      t.type = 'button';
      if (!t.dataset.value) t.dataset.value = String(i);
    });
    // Klone für den aktiven Layer: gleiche Maße, aber nicht bedienbar und für Screenreader unsichtbar
    this.#copy.replaceChildren(...this.#tabs.map((t) => {
      const c = t.cloneNode(true);
      for (const a of ['id', 'aria-controls', 'aria-selected', 'role', 'data-value']) c.removeAttribute(a);
      c.tabIndex = -1;
      c.classList.remove('is-pressed');
      return c;
    }));
    this.#clones = [...this.#copy.children];
  }

  #measure() {
    this.#rects = this.#tabs.map((t) => ({ left: t.offsetLeft, width: t.offsetWidth }));
    this.#width = this.#labels.offsetWidth;
    this.#radius = this.#pill.offsetHeight / 2;
  }

  #remeasure() {
    if (!this.#tabs.length) return;
    this.#measure();
    if (this.#index < 0) return;
    const r = this.#rects[this.#index];
    this.#left.target = r.left;
    this.#right.target = r.left + r.width;
    if (!this.#raf) { this.#left.snap(); this.#right.snap(); this.#paint(); }
  }

  /* ---------- Auswahl ---------- */

  #apply(i, { animate, silent = false }) {
    if (i < 0) i = 0;
    const prev = this.#index;
    this.#index = i;
    this.#tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-active', on);
    });
    if (this.getAttribute('value') !== this.value) this.setAttribute('value', this.value); // Attribut spiegelt den Zustand
    this.#measure();
    const to = this.#rects[i];
    const from = prev >= 0 ? this.#rects[prev] : null;
    const dir = from ? Math.sign(to.left + to.width / 2 - (from.left + from.width / 2)) : 0;

    if (animate && from && !this.#reduced() && this.isConnected && this.getClientRects().length) {
      // Laufrichtung bestimmt, welche Kante vorauseilt; Position und Geschwindigkeit bleiben erhalten
      const lead = dir >= 0 ? this.#right : this.#left;
      const trail = dir >= 0 ? this.#left : this.#right;
      lead.configure(LEAD);
      trail.configure(TRAIL);
      this.#left.target = to.left;
      this.#right.target = to.left + to.width;
      this.#run();
    } else {
      this.#left.snap(to.left);
      this.#right.snap(to.left + to.width);
      this.#paint();
    }
    if (!silent) {
      this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: this.value, index: i, previous: prev, direction: dir } }));
    }
  }

  /* ---------- Animation ---------- */

  #reduced() { return this.hasAttribute('reduced-motion') || matchMedia(REDUCED).matches; }
  #timeScale() { const s = parseFloat(this.getAttribute('time-scale')); return s > 0 ? s : 1; }

  #run() {
    if (this.#raf) return;
    this.#pill.style.willChange = 'transform, width'; // nur während der Bewegung (spart Grafikspeicher)
    this.#last = performance.now();
    this.#raf = requestAnimationFrame((t) => this.#tick(t));
  }

  #tick(now) {
    const dt = ((now - this.#last) / 1000) * this.#timeScale();
    this.#last = now;
    this.#left.step(dt);
    this.#right.step(dt);
    this.#paint();
    if (this.#left.settled && this.#right.settled) {
      this.#raf = 0;
      this.#pill.style.willChange = '';
      return;
    }
    this.#raf = requestAnimationFrame((t) => this.#tick(t));
  }

  #paint() {
    const l = this.#left.value;
    const r = this.#right.value;
    const w = Math.max(r - l, 0);
    const base = this.#rects[this.#index]?.width || w || 1;
    const stretch = clamp(w / base - 1, 0, 1);
    // Dehnt sich die Pille, wird sie minimal flacher – wie ein Tropfen, dessen Volumen gleich bleibt
    this.#pill.style.width = w + 'px';
    this.#pill.style.transform = `translate3d(${l}px,0,0) scaleY(${(1 - SQUASH * stretch).toFixed(4)})`;
    this.#copy.style.clipPath = `inset(0 ${Math.max(this.#width - r, 0)}px 0 ${l}px round ${this.#radius}px)`;
  }

  /* ---------- Eingaben ---------- */

  #tabOf(e) { return e.target.closest?.('[role="tab"]'); }

  #onClick(e) {
    const t = this.#tabOf(e);
    if (t) this.select(t.dataset.value);
  }

  #onKey(e) {
    const t = this.#tabOf(e);
    if (!t) return;
    const rtl = getComputedStyle(this).direction === 'rtl';
    const last = this.#tabs.length - 1;
    const i = this.#tabs.indexOf(t);
    const next = { ArrowRight: rtl ? i - 1 : i + 1, ArrowLeft: rtl ? i + 1 : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const to = this.#tabs[clamp(next, 0, last)];
    to.focus();
    this.select(to.dataset.value); // automatische Aktivierung (WAI-ARIA Tabs)
  }

  /** Einsinken sofort beim Drücken – nicht erst beim Loslassen. Der Klon im aktiven Layer sinkt synchron mit. */
  #onPress(e) {
    const t = this.#tabOf(e);
    if (!t || e.button > 0) return;
    const i = this.#tabs.indexOf(t);
    const clone = this.#clones[i];
    t.classList.add('is-pressed');
    clone?.classList.add('is-pressed');
    if (i === this.#index) this.setAttribute('data-press', '');
    const release = () => {
      t.classList.remove('is-pressed');
      clone?.classList.remove('is-pressed');
      this.removeAttribute('data-press');
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  }

  #hoverRaf = 0;
  #hoverTab = null;
  #hoverX = 0;
  #hoverY = 0;
  /** Lichtschein folgt dem Zeiger (nur Maus/Stift; ob er zu sehen ist, steuert das CSS) */
  #onHover(e) {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    this.#hoverTab = this.#tabOf(e) || null;
    this.#hoverX = e.clientX;
    this.#hoverY = e.clientY;
    if (!this.#hoverTab || this.#hoverRaf) return;
    this.#hoverRaf = requestAnimationFrame(() => {
      this.#hoverRaf = 0;
      const tab = this.#hoverTab;
      if (!tab) return;
      const r = tab.getBoundingClientRect();
      tab.style.setProperty('--mx', this.#hoverX - r.left + 'px');
      tab.style.setProperty('--my', this.#hoverY - r.top + 'px');
    });
  }

  #clearHover() { this.#hoverTab = null; }
}

if (!customElements.get('glass-tabs')) customElements.define('glass-tabs', GlassTabs);
