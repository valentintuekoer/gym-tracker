---
name: design-system
description: Verbindliche Design-Richtlinie dieses Projekts (Anti-AI-Slop, Typografie und Abstände, Marketing vs. App, Mobile-First, WCAG AA). Vor jeder UI-Arbeit lesen – beim Gestalten, Umbauen oder Prüfen von Oberflächen, Komponenten und Styles.
---

# Design-Richtlinie

Rangfolge: **`/DESIGN.md` und die Tokens in `style.css` > diese Richtlinie > die übrigen Design-Skills.**
Widerspricht ein Skill dem Projekt-Designsystem, gilt das Projekt. Diese Regeln gelten zusätzlich für neue Projekte und Seiten.

## 1. Keine austauschbare KI-Optik

Verboten, weil sie jede Oberfläche gleich aussehen lassen:

- Standard-Lila/Indigo-Verläufe (Indigo → Violett → Pink), Mesh-Gradients als Dekoration, Verlaufs-Text in Überschriften, Neon-Glow und farbige Leuchtschatten.
- Glassmorphism auf allem. Glas nur für schwebende Ebenen (Navigation, Sheets, Toasts), nie für Inhaltskarten.
- Karten in Karten, endlose 3er-Reihen aus „Icon im Kreis + Überschrift + zwei Zeilen“, Emoji als Icons, Stockfoto-Heldenbilder.
- Unveränderte Framework-Defaults (Tailwind-/shadcn-Standardradius, -schrift, -grau, `rounded-2xl` überall). Radius, Schrift und Farbe bewusst wählen und als Tokens festhalten.
- Erfundene Inhalte: kein Lorem ipsum, keine Fantasie-Zahlen („10.000+ Nutzer“), keine austauschbaren Slogans. Echte Texte und echte Daten.

Stattdessen:

- **Eine** Farbstrategie pro Produkt: neutrale, leicht getönte Basis; ein Akzent (in dieser App bewusst keine eigene Farbe: weiß im dunklen, tiefblau im hellen Design, Token `--inv`) auf höchstens ~10 % der Fläche. Farbe trägt Bedeutung (Zustand, Aktion), nie Dekoration.
- Wiedererkennbarkeit durch präzise Details: Abstände, Zahlendarstellung (`tabular-nums`), Bewegungskurven, eigene Icons-Strichstärke – nicht durch Effekte.
- Immer mit Tokens arbeiten (`var(--…)`), keine Hex-Werte oder Pixel-Zufallswerte in Komponenten.

## 2. Typografie und Abstände

- Eine **feste Typo-Skala** (hier: 11/12/13/14/15/16/17/20/34 px, siehe DESIGN.md). Pro Ansicht höchstens 5–6 Stufen. Hierarchie über Größe **und** Gewicht, nicht über Farbe allein.
- Pro Stufe genau ein Zeilenabstand und Buchstabenabstand (große Titel enger, kleiner Text neutral). Überschriften `text-wrap: balance`, Fließtext `text-wrap: pretty`, Zeilenlänge 45–75 Zeichen.
- Zahlen, Gewichte, Zeiten immer mit `font-variant-numeric: tabular-nums`. Mindestschrift 11 px, Eingaben ≥ 16 px (sonst zoomt iOS).
- **Abstände nur aus dem Raster** (4/8-px-Tokens `--s-1` … `--s-7`). Nähe gruppiert: innerhalb einer Gruppe klein, zwischen Gruppen mindestens doppelt so groß. Gruppieren mit Abstand und Fläche statt mit zusätzlichen Linien und Rahmen.
- Pro Ansicht **eine** Hauptaktion (invertierter Primärknopf); alles andere ruhiger.

## 3. Marketing-Seite ≠ App-Dashboard

Nie mischen. Wer beides baut, trennt Layout, Komponenten und Tokens-Überschreibungen.

| | Marketing / Landingpage | App / datendichtes Dashboard |
|---|---|---|
| Ziel | überzeugen, erzählen, eine Handlung auslösen | Aufgaben erledigen, Überblick, Tempo |
| Modus | expressiv: große Typografie, Hero, Rhythmus aus Weißraum und Dichte | **Operate**: ruhig, konsistent, vorhersehbar |
| Layout | Abschnitte mit je einer klaren Aussage und einem Call-to-Action | Listen, Tabellen, Karten mit festen Maßen; Inhalt vor Dekoration |
| Bewegung | Einstiegs- und Scroll-Effekte erlaubt (sparsam, `prefers-reduced-motion` beachten) | nur funktionale Bewegung: Zustandswechsel, Übergänge, Rückmeldung |
| Pflicht | echte Inhalte, schnelle Ladezeit, Meta-Daten | Zustände für **leer, lädt, Fehler, offline**; Tastatur/Daumenzone; schnelle Eingabe |
| Verboten | Dashboard-Dichte, Formularwüsten | Hero-Flächen, Slogans, dekorative Animation, Marketing-Verläufe |

## 4. Mobile-First und Barrierefreiheit (WCAG 2.2 AA als Untergrenze)

- **Mobile-First**: Basis-CSS für 360–390 px; größere Bildschirme per `min-width`-Regeln ergänzen. Kein seitliches Scrollen, Safe Areas (`env(safe-area-inset-*)`), `100dvh` statt `100vh`.
- **Tippflächen ≥ 44 × 44 px** (kleine Elemente vergrößern ihre Fläche unsichtbar, z. B. per `::after`), ausreichend Abstand dazwischen; jede Geste hat eine Tipp-Alternative.
- **Kontrast**: normaler Text ≥ **4,5:1**, großer Text (≥ 24 px bzw. ≥ 19 px fett) ≥ 3:1, Bedienelemente, Icons, Rahmen und Fokusring ≥ 3:1 gegen den Hintergrund. Beide Themes (hell/dunkel) einzeln prüfen; Dekofarben (`--faint`) nie für Text oder Bedienelemente.
- Information nie nur über Farbe (zusätzlich Form, Muster, Text, Icon). Sichtbarer Fokus bei Tastatur, sinnvolle Tab-Reihenfolge, echte `<button>`/`<a>`, jedes Feld mit Label, Icon-Knöpfe mit `aria-label`.
- `prefers-reduced-motion`, `prefers-color-scheme` und `prefers-contrast` respektieren; Seitensprache (`lang`) setzen.

## 5. Arbeitsablauf mit Sichtprüfung

1. Vor dem Gestalten: `DESIGN.md` und die `:root`-Tokens in `style.css` lesen; vorhandene Komponenten wiederverwenden.
2. Bauen. Kein UI-Code ohne Blick auf das Ergebnis.
3. **Sichtprüfung**: `node scripts/screenshots.mjs <Ordner>` (hell + dunkel, Phone; `--wide` zusätzlich Tablet; `--routes=#/history,…` für bestimmte Ansichten). Screenshots mit dem Bildbetrachter ansehen und den Report beachten (seitliches Scrollen, Tippflächen < 44 pt, Buttons ohne Namen, Skriptfehler). Alternativ der Playwright-MCP-Server aus `.mcp.json` (`browser_navigate`, `browser_take_screenshot`, `browser_snapshot`).
4. Alles Gefundene in **einer** Runde beheben, höchstens **eine** Kontrollrunde, dann aufhören.
5. Neue Muster in `DESIGN.md` dokumentieren.

**Glas, Berührung, Bewegung (iOS 27):** Neue Bedienflächen bekommen die Berührungsreaktion automatisch, wenn sie in den Listen `CTRL`/`SURF` von `GlassTouch` (app.js) stehen – kein eigenes `:active { transform }` schreiben (es wird dort abgeschaltet). Federn statt fester Kurven, bei „Bewegung verringern“ nur Aufhellen. Formen: Kapsel für Leisten/Knöpfe, innerer Radius = äußerer − Abstand. Nach jeder Änderung am Material `node --test tests/glass-touch.ui.mjs` und `GLASS=0 node scripts/contrast-pixels.mjs` (und `GLASS=100`) laufen lassen. Apple nennt keine Zahlen – Werte sind Näherungen, Quellen in DESIGN.md.

## 6. Welcher Skill wofür

| Aufgabe | Skill |
|---|---|
| Gestalterische Richtung, Politur, Kritik | `frontend-design` (Plugin), `impeccable`, `taste-skill` |
| Bewegung, Mikro-Interaktionen, Federn, Gesten | `animate`, `emil-design-eng`, `review-animations`, `animation-performance`, `apple-design` |
| iPhone-Gefühl, PWA auf dem Handy | `apple-hig-ios`, `mobile-native` |
| Prüfen gegen Richtlinien / Barrierefreiheit | `web-design-guidelines`, `web-interface-guidelines`, `web-design-rules` |
| Worst-Case-Daten, Randfälle | `break-ui` |
| React-Komponenten (nur mit React + Tailwind + `components.json`) | `shadcn` – in dieser Vanilla-JS-App nicht anwendbar |
