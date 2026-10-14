/* <glass-panels for="tabs-id"> – Inhalte zu einer <glass-tabs>-Leiste, mit Richtungs-Übergang.
 *
 *   <glass-panels for="nav" offset="16">
 *     <section role="tabpanel" id="panel-uebersicht" data-panel="uebersicht" aria-labelledby="tab-uebersicht">
 *       <h2 data-depth="1">…</h2> <div data-depth="1.8">…</div>        ← optional: Parallax-Tiefe
 *     </section>
 *   </glass-panels>
 *
 * Wechsel nach rechts: das alte Panel gleitet nach links aus (x −16 px, Fade), das neue kommt von rechts herein
 * (x +16 px → 0). Nach links umgekehrt. Elemente mit data-depth bewegen sich weiter als ihr Panel (Parallax).
 * Bei „Bewegung reduzieren“: nur Überblenden, keine Verschiebung.
 *
 * Unterbrechbar: Beim nächsten Wechsel startet jede Animation vom aktuell sichtbaren Zustand (Deckkraft und
 * Position werden vor dem Abbrechen gelesen), nichts springt. Animiert werden nur transform und opacity.
 * Attribute: for · offset (px, Standard 16) · time-scale (Zeitlupe) · reduced-motion
 */
const REDUCED = '(prefers-reduced-motion: reduce)';
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';  // Ausblenden: schnell, stark gebremst
const EASE_IN = 'cubic-bezier(0.16, 1, 0.3, 1)';    // Einblenden: weiches Ausschwingen
const OUT_MS = 150;
const IN_MS = 380;

export class GlassPanels extends HTMLElement {
  #tabs = null;
  #panels = [];
  #current = null;
  #visible = new Set();
  #onChange = (e) => this.#go(e.detail.value, e.detail.direction);

  async connectedCallback() {
    this.classList.add('lg-panels');
    this.#panels = [...this.querySelectorAll(':scope > [role="tabpanel"]')];
    const id = this.getAttribute('for');
    this.#tabs = (id && document.getElementById(id)) || this.previousElementSibling;
    if (!this.#tabs) return;
    await customElements.whenDefined('glass-tabs');
    this.#tabs.addEventListener('change', this.#onChange);
    const first = this.#tabs.value ?? this.#panels[0]?.dataset.panel;
    this.#panels.forEach((p) => this.#hide(p));
    const start = this.#panel(first);
    if (start) { this.#show(start); this.#current = start; this.#visible.add(start); }
  }

  disconnectedCallback() { this.#tabs?.removeEventListener('change', this.#onChange); }

  #panel(value) { return this.#panels.find((p) => p.dataset.panel === value) || null; }
  #hide(p) { p.hidden = true; p.inert = true; delete p.dataset.state; }
  #show(p) { p.hidden = false; p.inert = false; }
  #reduced() { return this.hasAttribute('reduced-motion') || matchMedia(REDUCED).matches; }
  #scale() { const s = parseFloat(this.getAttribute('time-scale')); return s > 0 ? 1 / s : 1; } // 0.25 → 4× länger
  #offset() { const o = parseFloat(this.getAttribute('offset')); return Number.isFinite(o) ? o : 16; }

  /** Zustand, in dem das Element gerade auf dem Bildschirm steht (auch mitten in einer Animation) */
  #live(el) {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, transform: cs.transform === 'none' ? 'translate3d(0,0,0)' : cs.transform };
  }

  #go(value, dir) {
    const next = this.#panel(value);
    if (!next || next === this.#current) return;
    this.#current = next;
    const reduced = this.#reduced();
    const offset = reduced ? 0 : this.#offset();
    // Alles, was gerade sichtbar ist und nicht das neue Ziel – auch ein halb eingeblendetes Panel – geht hinaus
    for (const p of [...this.#visible]) if (p !== next) this.#out(p, dir, offset);
    this.#in(next, dir, offset);
    this.#visible.add(next);
  }

  #out(p, dir, offset) {
    const from = this.#live(p);
    const kids = this.#depthKids(p).map((k) => [k, this.#live(k)]);
    p.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    p.dataset.state = 'out';
    const t = OUT_MS * this.#scale();
    const anim = p.animate([from, { opacity: 0, transform: `translate3d(${-dir * offset}px,0,0)` }], { duration: t, easing: EASE_OUT, fill: 'forwards' });
    for (const [k, f] of kids) {
      const d = Number(k.dataset.depth) || 1;
      k.animate([f, { transform: `translate3d(${-dir * offset * (d - 1) * 0.6}px,0,0)` }], { duration: t, easing: EASE_OUT, fill: 'forwards' });
    }
    anim.finished.then(() => {
      if (p.dataset.state !== 'out') return; // inzwischen wieder auf dem Weg hinein
      p.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      this.#hide(p);
      this.#visible.delete(p);
    }).catch(() => {});
  }

  #in(p, dir, offset) {
    const wasVisible = this.#visible.has(p) && !p.hidden;
    const from = wasVisible ? this.#live(p) : { opacity: 0, transform: `translate3d(${dir * offset}px,0,0)` };
    const kids = this.#depthKids(p).map((k) => [k, wasVisible ? this.#live(k) : null]);
    p.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    this.#show(p);
    p.dataset.state = 'in';
    const t = IN_MS * this.#scale();
    const anim = p.animate([from, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: t, easing: EASE_IN });
    // Parallax: Elemente mit größerer Tiefe starten weiter außen und kommen etwas später an
    kids.forEach(([k, f], i) => {
      const d = Number(k.dataset.depth) || 1;
      const start = f ?? { transform: `translate3d(${dir * offset * (d - 1)}px,0,0)` };
      k.animate([start, { transform: 'translate3d(0,0,0)' }], { duration: t * (1 + (d - 1) * 0.25), delay: Math.min(i, 6) * 18 * this.#scale(), easing: EASE_IN, fill: 'backwards' });
    });
    anim.finished.then(() => { if (p.dataset.state === 'in') delete p.dataset.state; }).catch(() => {});
  }

  #depthKids(p) { return [...p.querySelectorAll('[data-depth]')].filter((k) => Number(k.dataset.depth) > 1); }
}

if (!customElements.get('glass-panels')) customElements.define('glass-panels', GlassPanels);
