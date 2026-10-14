# Liquid Glass

Ein Glas-Material im Stil von macOS / visionOS, eine schwebende Tab-Leiste (auch als Segmented Control) mit
Feder-Physik und Richtungs-Übergänge für Inhalte. Als Web Components, ohne Framework und ohne Build-Schritt.

**Ausprobieren:** [`liquid-glass-demo.html`](liquid-glass-demo.html) per Doppelklick öffnen (eine Datei, kein Server nötig).
Mit Server (z. B. `npx serve .` im Projektordner): `/liquid-glass/index.html`. Auf der Seite *Einstellungen*:
**Zeitlupe** (alles 4× langsamer: Dehnung und Federn sichtbar), **Bewegung reduzieren**, **feste Fläche statt Glas** (Fallback)
und der Kontrastbericht, live aus den aktuellen Farben berechnet.

## Aufbau

```
liquid-glass/
  index.html                 Demo (nutzt die Module in src/ und demo/)
  liquid-glass-demo.html     dieselbe Demo als EINE Datei – erzeugt mit: node scripts/build-liquid-glass.mjs
  src/
    liquid-glass.css         Tokens (hell/dunkel), Material .lg-surface / .lg-card, Tab-Leiste, Panels, Fallbacks
    spring.js                gedämpfte Feder (Simulation, unterbrechbar)
    glass-tabs.js            <glass-tabs>   – Tab-Leiste / Segmented Control
    glass-panels.js          <glass-panels> – Inhalte mit Richtungs-Übergang und Parallax
    contrast.js              WCAG-Kontrast für halbtransparente Flächen (Test und Demo teilen sich die Regeln)
  demo/                      nur Beispielinhalte (Karten, Diagramm, Schalter)
```

## Benutzung

```html
<link rel="stylesheet" href="src/liquid-glass.css">
<script type="module">
  import './src/glass-tabs.js';
  import './src/glass-panels.js';
</script>

<glass-panels for="nav">
  <section role="tabpanel" id="p-a" data-panel="a" aria-labelledby="t-a"> … <h2 data-depth="1.6">…</h2> … </section>
  <section role="tabpanel" id="p-b" data-panel="b" aria-labelledby="t-b" hidden> … </section>
</glass-panels>

<glass-tabs id="nav" label="Hauptnavigation" value="a">
  <button type="button" role="tab" id="t-a" data-value="a" aria-controls="p-a">
    <svg class="lg-icon" viewBox="0 0 24 24">…</svg><span class="lg-label">Übersicht</span>
  </button>
  …
</glass-tabs>
```

| | |
|---|---|
| `<glass-tabs>` Attribute | `value` · `label` · `variant="bar"` (Standard) oder `"segmented"` · `time-scale` (Zeitlupe, z. B. `0.25`) · `reduced-motion` · `solid` |
| `<glass-tabs>` API | `select(value)` · `value` · `refresh()` · Ereignis `change` mit `detail { value, index, previous, direction }` (−1 links, +1 rechts) |
| `<glass-panels>` Attribute | `for` (ID der Leiste) · `offset` (px, Standard 16) · `time-scale` · `reduced-motion` |
| Material für alles andere | Klasse `lg-surface` (Leisten, Schaltflächen) bzw. `lg-card` (Flächen mit Fließtext); `data-solid` = deckend |

Die Leiste positioniert sich nicht selbst. Für „schwebend am unteren Rand“ siehe `.dock` in `demo/demo.css`
(`position: fixed`, `padding-bottom: env(safe-area-inset-bottom)`).

## Das Material: fünf Schichten

1. **Backdrop-Filter:** `blur(40px) saturate(1.8) brightness(1.04)` – der Hintergrund verläuft hinter dem Glas.
2. **Deckschicht:** hell `rgba(255,255,255,.55)`, dunkel getöntes Grau `rgba(28,28,32,.74)`.
3. **Specular-Highlight (`::before`):** Kuppel oben, Glanzpunkt oben links, Glanzkante; läuft im oberen Drittel aus.
4. **Lichtkante (`::after`):** 1-px-Verlaufsrahmen (per Maske nur der Rand): oben Lichteinfall, unten Schattenkante,
   Ecken oben links / unten rechts brechen das Licht. Dazu Randlicht innen (`inset`) und eine äußere Haarlinie.
5. **Schatten:** vier gestaffelte Schatten (Kontakt → weit), das Glas schwebt über dem Hintergrund.

Fallbacks: ohne `backdrop-filter` (`@supports not`), bei „Transparenz reduzieren“ (`prefers-reduced-transparency`),
`prefers-contrast: more` und mit `data-solid` wird die Fläche deckend. `forced-colors` (Windows-Kontrastmodus) nutzt Systemfarben.

## Bewegung

**Liquid Stretch.** Die Pille besteht aus zwei Kanten, jede mit eigener Feder. Die vordere Kante ist straffer
(Steifigkeit 560, Dämpfung 33, ζ ≈ 0,70) und eilt voraus, die hintere hinkt nach (360 / 29, ζ ≈ 0,76). Dadurch dehnt
sich die Pille in Laufrichtung (×1,18 beim Nachbar-Reiter, ×1,54 über drei Reiter), wird dabei minimal flacher
(Volumen bleibt „flüssig“), schwingt 3–9 px über das Ziel und zieht sich federnd zusammen; nach ~0,5 s ist sie in Ruhe.

**Unterbrechbar.** Ein neues Ziel mitten in der Bewegung ändert nur das Federziel: Position und Geschwindigkeit bleiben
erhalten, es gibt keinen Sprung (der Logik-Test prüft das exakt). Je nach Laufrichtung tauschen die Kanten Vorder-/Hinterrolle.

**Beschriftungen wechseln Pixel für Pixel die Farbe.** Ein geklonter, nicht bedienbarer Layer in Akzentfarbe wird per
`clip-path` auf die Pille zugeschnitten. Text und Symbol sind so genau dort farbig, wo die (gedehnte) Pille ist.

**Press und Hover.** Drücken: sofort `scale(.97)` (auch die Pille sinkt ein, wenn der aktive Reiter gedrückt wird).
Hover (nur Maus/Stift, `@media (hover: hover) and (pointer: fine)`): Lichtschein, der dem Zeiger folgt, nur auf inaktiven Reitern.

**Inhalte.** Nach rechts: das alte Panel gleitet nach links aus (−16 px, Fade, 150 ms), das neue kommt von rechts herein
(+16 px → 0, 380 ms, weiches Ausschwingen). Nach links umgekehrt. Elemente mit `data-depth` > 1 bewegen sich weiter
(Parallax). Bei „Bewegung reduzieren“ nur Überblenden. Animiert werden nur `transform` und `opacity`; `will-change`
steht nur, solange etwas läuft. Einzige Ausnahme ist die Breite der Pille (ein einzelnes, abgeschirmtes Element
ohne Nachbarn im Layout) – mit `scaleX` würden die 1-px-Kanten verzerrt.

Warum keine Framer Motion? Dasselbe Verhalten (Federn, `layoutId`-artiges Gleiten) ohne React und ohne 50 kB Bibliothek;
`spring.js` ist ein Dutzend Zeilen. Wer Tailwind nutzt, kann die Tokens (`--lg-*`) und `.lg-surface` direkt verwenden
oder in `theme.extend` abbilden.

## Barrierefreiheit und Kontrast

Auf Glas ist der Hintergrund unbekannt. Weil der Kontrast monoton von dessen Helligkeit abhängt, genügt die Prüfung der
Extreme: Besteht ein Text vor Schwarz **und** vor Weiß, besteht er vor jedem Hintergrund dazwischen.

| Regel (WCAG 2.2) | Wert |
|---|---|
| Tab-Beschriftung hell / dunkel | 5,8 : 1 / 6,2 : 1 (Ziel 4,5) |
| Aktiver Tab auf der Pille | ≥ 4,5 : 1 in beiden Themes |
| Text und Sekundärtext auf Karten | ≥ 4,5 : 1 |
| Fokusring, Symbole | ≥ 3 : 1 |
| Ohne Glas (deckender Fallback) | ≥ 4,5 : 1 |

Deshalb ist dunkles Glas deckender (0,74) als helles (0,55): Weißer Text braucht eine dunklere Fläche dahinter.
Geprüft wird zweifach: **rechnerisch** aus den echten CSS-Tokens (`tests/liquid-glass.test.mjs`, dieselben Regeln wie
der Bericht in der Demo) und **am echten Rendering** (`tests/liquid-glass.ui.mjs`: Beschriftungen ausblenden,
Hintergrund hinter jedem Text und Symbol pixelweise messen – vor Schwarz und Weiß, in beiden Themes).

Weiteres: `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, Roving-Tabindex, Pfeile/Home/End (RTL-fähig),
sichtbarer Fokusring, Tippflächen ≥ 44 px, der Klon-Layer ist `inert` und `aria-hidden`.

## Tests

```
node --test tests/liquid-glass.test.mjs            Logik: Feder-Physik, Kontrast, Token-Konsistenz
node --test tests/liquid-glass.ui.mjs              Browser (Chromium): Bewegung pro Frame gemessen, Richtung, Tastatur,
                                                   Press/Hover, reduzierte Bewegung, Fallback, echter Kontrast, 320–430 px
```
(Browser-Tests: einmal `npm install` in `tests/emulator`, dort kommt Playwright her.)

## Grenzen

- Getestet in Chromium. WebKit (Safari) und Firefox nutzen dieselben Standard-Eigenschaften (`backdrop-filter` mit
  `-webkit-`-Präfix, `mask-composite`, `clip-path`, individuelle `scale`-Eigenschaft); die Fallbacks greifen, wo sie fehlen.
  Auf einem echten iPhone/Mac mit Safari bitte kurz gegenprüfen.
- Echte Lichtbrechung (verzerrter Hintergrund am Rand) ist bewusst nicht enthalten: `backdrop-filter: url(#svg)` geht nur in
  Chromium. Das Material kommt ohne aus.
- Viel Glas übereinander kostet Grafikleistung (jede Fläche rechnet ihre Unschärfe). Deshalb nur schwebende Ebenen aus Glas
  machen und den Hintergrund nicht dauerhaft bewegen.
