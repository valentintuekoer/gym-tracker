/* WCAG-2.x-Kontrast für halbtransparente Flächen.
 *
 * Auf Glas ist der Hintergrund unbekannt: Was hinter der Leiste liegt, scheint durch die Deckschicht. Weil das
 * Ergebnis monoton von der Helligkeit des Hintergrunds abhängt, genügt es, die beiden Extreme zu prüfen –
 * Schwarz und Weiß hinter der Fläche. Besteht ein Text dort, besteht er vor jedem Hintergrund dazwischen.
 * (Blur, Sättigung und Helligkeit des Backdrop-Filters halten die Kanäle im Bereich 0–255.)
 */

/** '#rgb' | '#rrggbb' | 'rgb(r g b / a)' | 'rgba(r, g, b, a)' → [r, g, b, a] */
export function parseColor(input) {
  const s = String(input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error('Farbe nicht lesbar: ' + input);
}

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Relative Helligkeit (0–1) einer deckenden Farbe [r, g, b] */
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Kontrastverhältnis zweier deckender Farben (1–21) */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Farbe mit Alpha über einen deckenden Hintergrund legen → deckende Farbe */
export const over = ([r, g, b, a], bg) => [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];

/** Mehrere Schichten (unten → oben) über einem Hintergrund zusammenrechnen */
export const stack = (layers, backdrop) => layers.reduce((under, layer) => over(layer, under), backdrop);

export const BLACK = [0, 0, 0];
export const WHITE = [255, 255, 255];

/**
 * Prüft Texte/Symbole auf Glasflächen.
 * surfaces: { name: [Schicht-Farben von unten nach oben] }  (Strings, mit Alpha)
 * rules:    [{ name, color, surface, min }]  – Farbe liegt auf Fläche, Mindestverhältnis (4,5 Text · 3 Symbole/Fokus)
 * Rückgabe: [{ name, surface, ratio, min, ok, worstBackdrop }]  – ratio = ungünstigster Hintergrund
 */
export function checkContrast(surfaces, rules) {
  return rules.map((rule) => {
    const fg = parseColor(rule.color);
    const layers = surfaces[rule.surface].map(parseColor);
    let worst = Infinity;
    let worstBackdrop = '';
    for (const [label, backdrop] of [['Schwarz', BLACK], ['Weiß', WHITE]]) {
      const bg = stack(layers, backdrop);
      const ratio = contrast(fg[3] < 1 ? over(fg, bg) : fg, bg);
      if (ratio < worst) { worst = ratio; worstBackdrop = label; }
    }
    return { name: rule.name, surface: rule.surface, ratio: worst, min: rule.min, ok: worst >= rule.min, worstBackdrop };
  });
}

/* ---------- Die Regeln dieses Materials (eine Quelle für Test und Demo) ---------- */

/** Name der CSS-Variable (Farbe) · Fläche · Mindestverhältnis: 4,5 für Text, 3 für Fokusring/Symbole (WCAG 1.4.3 / 1.4.11) */
export const RULES = [
  { name: 'Tab-Beschriftung und Symbol', color: '--lg-text', surface: 'bar', min: 4.5 },
  { name: 'Tab beim Überfahren (Lichtschein)', color: '--lg-text', surface: 'bar-hover', min: 4.5 },
  { name: 'Aktiver Tab auf der Pille', color: '--lg-text-active', surface: 'pill', min: 4.5 },
  { name: 'Text auf Karte', color: '--lg-text', surface: 'card', min: 4.5 },
  { name: 'Sekundärtext auf Karte', color: '--lg-text-2', surface: 'card', min: 4.5 },
  { name: 'Fokusring auf Leiste', color: '--lg-focus', surface: 'bar', min: 3 },
  { name: 'Ohne Glas: Tab-Beschriftung', color: '--lg-text', surface: 'bar-solid', min: 4.5 },
  { name: 'Ohne Glas: Sekundärtext', color: '--lg-text-2', surface: 'card-solid', min: 4.5 },
];

/** Flächen (Schichten von unten nach oben) aus den Tokens: Leiste, Pille, Karte und die deckenden Fallbacks */
export function tokenSurfaces(get) {
  const spec = `rgba(255,255,255,${get('--lg-spec-label')})`;
  const bar = [get('--lg-fill'), spec];
  return {
    bar,
    'bar-hover': [...bar, get('--lg-hover-a')],
    pill: [...bar, get('--lg-pill-fill'), get('--lg-pill-spec')],
    card: [get('--lg-card-fill'), spec],
    'bar-solid': [get('--lg-fill-solid')],
    'card-solid': [get('--lg-card-fill-solid')],
  };
}

/** Alle Regeln prüfen. get(name) liefert den Wert einer CSS-Variable als String. */
export function checkTokens(get) {
  return checkContrast(tokenSurfaces(get), RULES.map((r) => ({ ...r, color: get(r.color) })));
}
