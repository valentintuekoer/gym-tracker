---
name: Anchor
description: Training, Pausen-Timer, Daily (Gewicht & Mealplan) und Fortschritt – „Liquid Glass“ auf tiefem Schwarz mit feinem Raster, klares Glas aus fünf Schichten, Akzent Blau nur für Hauptaktion und Zustände, nah an iOS, gebaut für eine Hand im Gym.
colors:
  bg-dark: "#000000"
  bg-a-dark: "#060d1c"
  bg-b-dark: "#0b1626"
  orb-1-dark: "#1b6dff"
  orb-2-dark: "#0fb89a"
  orb-3-dark: "#e0762f"
  surface-dark: "#1e1e22"
  surface-2-dark: "#26262c"
  surface-3-dark: "#34343c"
  text-dark: "#ffffff"
  text-2-dark: "#9d9d9d"
  muted-dark: "#9d9d9d"
  faint-dark: "#7f8596"
  accent-dark: "#0061fe"
  on-accent-dark: "#ffffff"
  accent-ink-dark: "#3d8bff"
  danger-dark: "#ff8fa3"
  bg-light: "#f1f4fb"
  bg-a-light: "#eaf3ff"
  bg-b-light: "#fbf1e4"
  orb-1-light: "#6fb7ff"
  orb-2-light: "#7fe3c6"
  orb-3-light: "#ffbe8a"
  surface-light: "#fafafc"
  surface-2-light: "#f1f2f6"
  surface-3-light: "#e2e4ea"
  text-light: "#1d1d1f"
  text-2-light: "#3a3a3f"
  muted-light: "#3d3d44"
  faint-light: "#9a9aa4"
  accent-light: "#0832a8"
  on-accent-light: "#ffffff"
  danger-light: "#bb1d42"
typography:
  large-title:
    fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Nunito', -apple-system, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  headline:
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  subheadline:
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.35
  secondary:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  footnote:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  caption:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
  section-label:
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.06em"
  eyebrow:
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.06em"
  numeral:
    fontFamily: "'Nunito', -apple-system, sans-serif"
    fontSize: "31px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  tab-label:
    fontSize: "11px"
    fontWeight: 600
rounded:
  xs: "4px"
  sm: "8px"
  input: "14px"
  card-sm: "20px"
  card: "24px"
  sheet: "34px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  gutter: "16px"
  tap: "44px"
components:
  button-primary:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.on-accent-dark}"
    rounded: "{rounded.pill}"
    height: "50px"
    padding: "0 24px"
  button-soft:
    backgroundColor: "{colors.surface-2-dark}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.pill}"
    height: "50px"
  card:
    backgroundColor: "{colors.surface-dark}"
    rounded: "{rounded.card}"
    padding: "16px"
  list-item:
    backgroundColor: "{colors.surface-dark}"
    rounded: "{rounded.card-sm}"
    height: "64px"
  input:
    backgroundColor: "rgba(255, 255, 255, 0.07)"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.input}"
    height: "48px"
  chip:
    textColor: "{colors.text-dark}"
    rounded: "{rounded.pill}"
    height: "36px"
  avatar:
    backgroundColor: "{colors.surface-3-dark}"
    textColor: "{colors.muted-dark}"
    rounded: "{rounded.pill}"
    size: "42px"
  tab-bar:
    backgroundColor: "rgba(22, 22, 26, 0.012)"
    rounded: "{rounded.pill}"
    height: "54px"
---

# Anchor – Designsystem

Quelle der Wahrheit sind die Tokens in `style.css` (`:root`). Diese Datei beschreibt, wie sie eingesetzt werden. Neue Bildschirme müssen sich so anfühlen, als hätte es sie immer gegeben.

## Overview

Eine iPhone-Web-App (PWA) für das Training im Gym: eine Hand, schwitzige Finger, grelles oder schummriges Licht, 60–120 Sekunden Satzpause. Daraus folgt alles. Die Gestaltung stammt aus dem Design-Builder (Auswahl des Besitzers) und baut auf dem Liquid-Glass-System der Demo (`liquid-glass/`) auf: Material, große Titel, schwebende Tab-Leiste:

- **Liquid Glass auf Schwarz (dunkel, Standard).** Hintergrund: tiefes Schwarz (`--bg` `#000`) mit feinem Raster (26 px, Linien 5,5 % Weiß; `--stage`). Darauf **klares Glas** aus fünf Schichten: bei Reglerstellung 0 („ultraklar“, Vorgabe) fast durchsichtig, ohne Unschärfe, mit Lichtkante und Glanz; Sheets, Toast und Timer bleiben deckend (`--lg-overlay-*`). **Akzent Blau `#0061fe`** (`--inv`) nur für Hauptaktion und Zustände (primärer Knopf, gewähltes Segment/Chip, Haken, Fortschritt, „Du“); Zahlen, Linien und Diagramme bleiben weiß. Blauer Text und blaue Symbole auf Schwarz nutzen die aufgehellte Variante `#3d8bff` (`--accent-ink`, `--lg-text-active`, 6,3:1), weil `#0061fe` selbst nur 4,1:1 erreicht. Zweittext `#9d9d9d` (`--muted`, `--text-2`).
- **Hell (gleichwertig):** blauer Verlauf mit drei ruhigen Farbflecken, Glas aus fünf Schichten, tiefblauer Akzent `#0832a8`. Er behält das Aussehen der Demo unter `liquid-glass/`.
- **Nah an iOS 26 („Liquid Glass“).** Große Titel, gruppierte Listen, Bottom Sheets, schwebende Glas-Tab-Leiste, Wischgesten. Keine Web-Konventionen, die sich auf dem iPhone fremd anfühlen.
- **Der Satz ist die wichtigste Interaktion.** Gewicht, Wiederholungen, Haken – groß, direkt erreichbar, mit Haptik.

Modus: **Operate** – Übersicht, Konsistenz und Tempo schlagen Ausdruck. Die Marke lebt in präzisen Details (Glas, Federn, Zahlen in Tabellenziffern).

## Colors

Zwei Themes über `data-theme="dark|light"` auf `<html>`; „System“ folgt `prefers-color-scheme`. Immer Tokens verwenden, nie Hex-Werte in Komponenten (einzige Ausnahme: der QR-Code ist immer schwarz auf weiß, damit ihn jede Kamera liest).

| Token | Rolle |
|---|---|
| `--bg` | Seitenhintergrund (dunkel: reines Schwarz, mit Raster über `--stage`; hell: warmes Off-White) |
| `--surface`, `--surface-2`, `--surface-3` | Karten → vertiefte Flächen → Platzhalter/Tracks |
| `--text`, `--text-2` | Primärtext, ruhigerer Fließtext |
| `--muted`, `--text-2` | Zweittext **und bedienbare Icons** (dunkel `#9d9d9d`, ≥ 4,5:1 auch auf Glas, Pillen und Rasterlinien) |
| `--faint` | nur Deko (Chevrons, Trenner) – nie für Text oder Bedienelemente (< 3:1) |
| `--inv`, `--on-inv` | **aktive/primäre Fläche** und Text darauf: dunkel Akzentblau `#0061fe`/Weiß (5,1:1), hell Tiefblau/Weiß. Haupt-Knopf, abgehakter Satz, aktives Chip, gewähltes Segment, „Du“ in Vergleichen |
| `--lg-text-active`, `--accent-ink` | Farbe für aktive Texte/Icons (aktiver Tab, Ring, Fokus, Fortschritt): dunkel `#3d8bff` (aufgehelltes Akzentblau, 6,3:1 auf Schwarz), hell `#0832a8` |
| `--danger`, `--on-danger` | zerstörerische Aktionen und Fehler (Rosé) – immer zusätzlich Warn-Icon oder Text, nie nur Farbe |
| `--bg-a`, `--bg-b`, `--orb-1/2/3`, `--stage` | Verlauf und drei Farbflecken (hell und für die Glas-Vorschau in den Einstellungen); `--stage` ist der fertige Hintergrund für `body::before` und die Seitenübergänge – dunkel das Raster auf Schwarz, hell der Verlauf mit Farbflecken |
| `--lg-*` | Glas-Material: Füllungen (`--lg-fill` Leisten, `--lg-card-fill` Karten, `--lg-pill-fill` Pillen, `--lg-overlay-fill` Sheet/Toast/Timer), Unschärfen (`--lg-blur`, `--lg-card-blur`, `--lg-overlay-blur`), Glanz (`--lg-spec-*`), Lichtkante (`--lg-edge-*`), Randlicht (`--lg-rim-*`), vier Schatten (`--lg-shadow-a…d`) |
| `--border`, `--border-strong` | Haarlinien, Umrandungen |
| `--glass-*` | ältere Namen für dasselbe Material (Timer, Toast, Sheets) |

Vergleiche (Freunde): **Du = `--inv`** (Akzentblau), **andere = `--muted`** – Information nie nur über Helligkeit (Beschriftung „Du“ / „@name“ steht immer dabei).

`@media (prefers-contrast: more)` hebt `--muted`, Linien und Glas-Deckkraft an (iOS: „Kontrast erhöhen“).

## Typography

**Überschriften: Systemschrift** (SF Pro auf Apple-Geräten). **Fließtext, Bezeichnungen und Zahlen: Nunito** (`--font`), eine variable Datei (`fonts/nunito-latin-wght-normal.woff2`, 39 KB, OFL) lokal eingebunden und vom Service Worker gecacht – kein Webfont-Server, läuft offline. Nunitos Ziffern sind von Haus aus tabellarisch.

Die Stufen folgen den iOS-Textstilen: Large Title 34–46 · Title 20 · Headline 17 · Body 16 · Subheadline 15 · Sekundär 14 · Footnote 13 · Caption 12.

- **Große Titel** `clamp(34px, 9.4vw, 46px)` / 700 / −0,01em, schrumpfen beim Scrollen in die Kopfzeile. Darüber optional die **Eyebrow** (Datum o. Ä.): 13 px / 600 / +0,06em, Versalien, `--text-2`.
- **Große Ziffern** (Pausen-Timer 24–31 px, auf 70 % der früheren Größe; Intro-Timer 28 px): 700 / −0,02em in Nunito, `tabular-nums`; Kennzahlen 24 px / 700; kleine Versalien-Beschriftung 13 px / 600 / +0,04em in `--text-2`.
- **Kartentitel** 17–20 px / 650. **Fließtext** 16 px (Eingaben immer ≥ 16 px, sonst zoomt iOS). **Sekundär** 13–14 px in `--muted`.
- Monospace nur für echte Codes/IDs (Nutzer-ID), nie als Stilmittel. Überschriften-Laufweite überall −0,01em.
- **Minimum 11 px** für alles Lesbare.
- Zahlen, Gewichte, Zeiten: `font-variant-numeric: tabular-nums`.
- Überschriften `text-wrap: balance`, Hinweise `text-wrap: pretty`.
- Abschnittsbeschriftungen in Versalien 13 px / 600 / +0,06em, `--text-2` – sparsam, nur über Listengruppen.
- Deutsche Typografie: „…“ statt `...`, „Anführungszeichen“, geschützte Leerzeichen in Einheiten (`80 kg`).

## Layout

- **8-px-Raster** (`--s-1` … `--s-7`), 16 px Seitenrand, Inhalt max. 640 px breit (iPad/Desktop zentriert).
- **Safe Areas** über `env(safe-area-inset-*)`: nichts unter Dynamic Island, Statusleiste oder Home-Indikator.
- **Daumenzone:** Primäraktionen unten (Training starten, Beenden, Speichern), Navigation oben.
- **Tippflächen ≥ 44 × 44 px** (Token `--tap`) – kleine Chips und Icons vergrößern ihre Fläche mit `::after`, statt größer zu werden.
- **Dichte „kompakt“:** Kartenabstand 8 px, Kartenpolster 12 px (Tageskarten 16 px), Wochenkarte 12/16 px.
- Listen sind gruppiert (`.card.flush` + `.row`) wie iOS-Einstellungen; Menüzeilen haben Icon-Kachel, Titel, Unterzeile, Wert, Chevron.

## Elevation & Depth

Alles, was auf dem Hintergrund liegt, ist **Glas** (Klasse `.lg-surface` in der Demo, in der App per Selektorliste in `style.css`) aus fünf Schichten von hinten nach vorn: (1) `backdrop-filter` (Unschärfe von 0 px bei Reglerstellung 0 bis 34 px bzw. 28 px auf Karten bei 100, Sättigung 1,7, Helligkeit 1,04), (2) getönte Fläche (`--lg-fill` / `--lg-card-fill`), (3) **Glanz** (`::before`, Kuppel oben + Glanzpunkt oben links, liegt mit `z-index: −1` hinter dem Inhalt), (4) **Lichtkante** (`::after`, 1-px-Verlaufsrahmen per Maske), (5) Randlicht innen und vier gestaffelte Schatten außen. Listeneinträge (`.list-item`, `.ex-row`, `.body-tile`) bekommen dasselbe Aussehen **ohne** eigenen `backdrop-filter` (lange Listen). Sheets haben das Material ohne Pseudo-Elemente (die Karte scrollt).

Textfarben stehen auf Glas immer so, dass sie vor **jedem** Hintergrund lesbar sind (geprüft per Pixel, siehe unten). Fallbacks wie in der Demo: ohne `backdrop-filter`, mit „Transparenz reduzieren“ und „Kontrast erhöhen“ werden Flächen deckend, der Windows-Kontrastmodus zeigt Rahmen statt Glas.

- **Tab-Leiste, Kopfzeilen-Knöpfe, Pausentimer, Toasts, Sheets** sind Liquid Glass (Material unten): `backdrop-filter: blur() saturate()`, halbtransparente Füllung, helle Oberkante, weicher Schatten. **Sheets, Toast und Timer** nutzen `--lg-overlay-fill` (84–96 % deckend) und 40 px Unschärfe, damit sie auch bei „ultraklar“ lesbar sind; Leisten und Karten folgen dem Regler. Unter der Tab-Leiste blendet ein Verlauf (`body::after`, bis 100 % Schwarz) den Inhalt aus – dort tragen die dünnen Symbole auf klarem Glas.
- Die aktive Tab-„Pille“ (`--lg-pill-fill`, Glanz, Randlicht) gleitet mit leichtem Dehnen zum Ziel; aktiver Text `--lg-text-active`.
- **Tab-Leiste nur mit Symbolen:** 54 px hoch, Beschriftungen nur noch für Screenreader (`.tab span` visuell versteckt). Die Klasse `body.tabs-compact` und der Höhen-Übergang bleiben im Code, wirken aber nicht mehr (`--tabbar-hc` = `--tabbar-h`).

## Shapes

Radien: 4/8 für Kleinteile · Eingabe 12–14 (im Sheet 20, konzentrisch) · kleine Karte/Listeneintrag 20 · Karte 24 · Sheet 40 · Dialog ab 700 px 30 · Icon-Kachel 12 · Knopf/Chip/Segment/Tab-Leiste/Toast/Avatar **Kapsel** (`--r-capsule`, Radius = halbe Höhe). Verschachtelte Flächen (Glas-Linse in der Tab-Leiste, Daumen im Segment) folgen der Regel **innerer Radius = äußerer Radius − Abstand**; daraus entstehen Einzelwerte wie 22/26/34 px – das ist gewollt, kein Drift. Die Mini-Vorschauen (Einführung, Design-Auswahl) sind Illustrationen und dürfen eigene Radien haben. Keine eckigen Elemente, keine farbigen Seitenränder. Icons: eigenes Linien-Set, 24er-Raster, Strich 1,5 (Häkchen kräftiger), Tab-Symbole 22 px, runde Enden – keine Emojis als Icons.

## Liquid Glass wie in iOS 27

Grundlage ist Apples Entwickler-Dokumentation. **Apple veröffentlicht dort Prinzipien, keine Zahlen** – jeder Zahlenwert unten ist eine eigene, auf Apples Beschreibung abgestimmte Näherung und steht deshalb in der Spalte „Näherung“.

Quellen: WWDC25 [„Meet Liquid Glass“ (219)](https://developer.apple.com/videos/play/wwdc2025/219/), [„Get to know the new design system“ (356)](https://developer.apple.com/videos/play/wwdc2025/356/), [„Build a SwiftUI app with the new design“ (323)](https://developer.apple.com/videos/play/wwdc2025/323/); HIG [Materials](https://developer.apple.com/design/human-interface-guidelines/materials); [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass); [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views); WWDC26 Sessions [101](https://developer.apple.com/videos/play/wwdc2026/101/), [102](https://developer.apple.com/videos/play/wwdc2026/102/), [269](https://developer.apple.com/videos/play/wwdc2026/269/).

| Bereich | Apple sagt (Prinzip) | Umsetzung hier (Näherung) |
| --- | --- | --- |
| **Formen** | Drei Formen: fest, **Kapsel** (Radius = halbe Höhe), **konzentrisch** (Radius = Radius außen − Abstand). iPhone: Kapsel mit Abstand zum Bildschirmrand; Abschnitte in Listen/Formularen haben größere Radien; Halb-Sheets sind vom Rand eingerückt, ihre unteren Ecken schmiegen sich an die Display-Ecken und werden bei voller Höhe deckender und verankert. | `--r-capsule: 999px` für Leisten, Knöpfe, Chips, Segmente, Toast. Karte 26, Sheet 40 mit 8 px Abstand (`--sheet-gap`), im Sheet Eingaben `max(12px, 40 − 20)` = 20. Scrollt der Sheet-Inhalt oder wird nach oben gezogen (`.scrolls`/`.stretched`): Abstand unten 0, untere Ecken eckig, Füllung 94 % deckend. |
| **Material** | Linsen-Effekt (biegt und bündelt Licht), Glanzlichter folgen der Geometrie, adaptive Schatten; iOS 27: Hintergrund wird stärker diffundiert, **dunklere Kante** und **hellere Glanzlichter** geben Tiefe; neuer Regler von „ganz klar“ bis „voll getönt“; nie Glas auf Glas, Inhalt ohne Glas. | Dunkel: Unschärfe `34·t` / `28·t` px (Karten), Sättigung 1,7. Dunkle Innenkante `--lg-edge-dark` (`inset 0 0 14px -3px`), Glanzpunkt `--lg-spec-spot` 0,12, Lichtkante oben 0,34 (Randlicht dezent, Glanz 30 %). Regler in Einstellungen → Darstellung: `settings.glass` 0…100 → `--lg-tint` 0…1, **Vorgabe 0 (ultraklar)**; Füllung `0,012 + 0,9·t` (Leisten) bzw. `0,02 + 0,9·t` (Karten) im dunklen Design, Sheet/Toast/Timer `0,84 + 0,12·t` (hell: 0,40/0,58 bzw. 0,58/0,86 Karten und Überlagerungen, Unschärfe 44/32 px). Alle Stufen bestehen den Pixel-Kontrast (`GLASS=0|50|100 node scripts/contrast-pixels.mjs`). **Echte Lichtbrechung (Linse) und Farbsäume gibt es im Web nur in Chromium** (`backdrop-filter: url()`) und nicht auf dem iPhone – sie werden durch Kantenlicht und Abdunklung nachempfunden; die im Design-Builder gewählten Werte (Lichtbrechung 66 %, Farbsäume 39 %) sind deshalb nur dort sichtbar. |
| **Glanz bewegt sich** | Glanzlichter reagieren auf Bewegung (iOS 27 auch beim Scrollen). | Glanzpunkt von Kopfzeile, Tab-Leiste und Timer wandert beim Scrollen (`--spec-x = 50 % + 40 %·sin(y/260)`). Die Karten im Inhalt behalten ihren Glanz (sonst Neuberechnung aller Karten pro Scroll-Schritt). |
| **Berührung** | „Reagiert sofort: biegt und leuchtet von innen auf – beginnend genau unter der Fingerspitze; das Leuchten breitet sich über das Element und auf nahes Glas aus.“ `.interactive()` = skalieren, federn, schimmern; Schieber-/Schalter-Knopf wird beim Berühren zu Glas; Zeiger auf dem Mac wirkt genauso. | `GlassTouch` (app.js): Federn für Skalierung/Verschiebung/Licht. Knöpfe wachsen um höchstens 7,5 % (max. ~9 px), Karten um ≤ 2,2 %; Loslassen: Feder mit ~19 % Überschwingen (`k 340, c 17`). Licht: weißer Radialverlauf ab Fingerposition, Radius wächst auf die ganze Fläche, plus Randlicht; nahes Glas (≤ 150 px, höchstens 4) leuchtet schwächer mit; die Fläche folgt dem Finger um bis zu ~7 px (Gel); Wegziehen > 30 px bricht ab. Mindestens 150 ms „eingerastet“, auch bei kurzem Tippen. Maus: Hover-Licht (38 %). Schalter und Regler: Knopf streckt sich und wird durchsichtig. |
| **Bewegung** | Glas **materialisiert** statt einzublenden (Licht-Biegung wird stufenlos zugeschaltet); Menüs, Dialoge und Sheets entstehen aus der Schaltfläche; Leisten fließen und federn; Tab-Leiste schrumpft beim Herunterscrollen. | Tab-Linse: zwei Kanten mit je einer Feder (vorne `k 560, c 33`, hinten `k 360, c 29`), dehnt sich ≈ 1,5×, wird bis 7 % flacher, Überschwingen ~9 px, ruhig nach ~0,6 s; per Finger über die Reiter ziehbar, gewechselt wird beim Loslassen. Aktionsblätter/Dialoge (Höhe ≤ 55 % des Bildschirms) wachsen gleichmäßig aus dem gedrückten Knopf (Skalierung, Radius, Unschärfe 10 → 0 px, 560 ms Feder) und schrumpfen beim Schließen zurück; hohe Formulare gleiten von unten herein. Toast: Unschärfe und Größe (0,84 → 1) blenden das Glas ein. |
| **Bedienungshilfen** | „Bewegung verringern“ senkt die Intensität und **schaltet elastische Eigenschaften ab**; „Transparenz reduzieren“ macht frostiger; „Kontrast erhöhen“ = Schwarz/Weiß mit Rahmen. | Kein Skalieren/Verschieben/Federn, kein Morph, nur Aufhellen (65 %); Flächen deckend; Kontrastrahmen; im Windows-Kontrastmodus kein Lichtschein. |

Regeln: Glas bleibt Funktion (Leisten, Knöpfe, Karten, Sheets), der Inhalt darunter ist kein Glas; Tönung nur für die Hauptaktion (`primary`); die Fläche unter dem Finger darf kurz heller sein als erlaubt (Licht liegt über dem Text) – im Ruhezustand gilt immer der Pixel-Kontrast ≥ 4,5:1 (hell: Licht dezenter, weil es sonst die dunkle Schrift ausbleicht).

## Components

- **Knöpfe:** `primary` (`--inv` mit Glanz, eine pro Ansicht), `soft` (Glas-Pille), `ghost` (nur Text), `danger`/`danger-soft` (Rosé, immer mit Warn-Icon). „Mit Apple anmelden“ bleibt schwarz bzw. weiß (Apple-Richtlinie). Höhe 50 (lg 56, sm 44).
- **Chips:** 36 px, Glas-Pille; `dim` gestrichelt = „noch nicht gesetzt“; `on` = `--inv`. **Umriss-Pille** (`.chip-o`, 1,5-px-Umriss in `--text-2`, z. B. „zuletzt gestern“). **Läuft-Abzeichen** (`.live-badge` + `.live-dot`): Umriss-Pille mit atmendem Punkt.
- **Segmente:** Glas-Leiste mit gleitender Pille (`.seg-thumb`, Feder); dunkel ist die gewählte Pille **gefüllt in `--inv`** mit weißem Text (hell: Glas-Pille, Text `--lg-text-active`).
- **Startseite:** Eyebrow (Datum) + großer Titel, dann **Wochenkarte** (`.week-card`: Fortschrittsbalken in Segmenten, „Diese Woche: 2 von 3“, Serie), Mein Gym und die **Trainingstage** (`.day-card`: Name, Unterzeile, Übungen; läuft der Tag: Rahmen in `--lg-text-active` und „läuft gerade“ in der Unterzeile).
- **Listen-Einträge:** 64 px, Titel 17/600, Unterzeile 14 `--muted`, rechts Wert + Chevron (`--faint`).
- **Skeletons** (`.sk`) statt Spinner für alles, was aus der Cloud kommt; Schimmer nur per `transform`.
- **Leere Zustände:** kurze fette Zeile + ein Satz + eine Aktion.
- **Profilfoto (`.avatar`):** rund, 42/52/72/104 px; ohne Foto grauer Personen-Platzhalter (`.avatar-empty`).
- **Vergleichsbalken (`.cmp`):** Beschriftung „Du“/„@name“, Track `--surface-2`, Füllung per `scaleX`.
- **Toast:** unten über der Tab-Leiste, optional mit „Rückgängig“ (5 s).
- **Laufendes Training:** Die Seite steht fest (`body.wk-lock`) – kein vertikales Scrollen, nur seitliches Wischen zwischen den Übungskarten. Jede Karte füllt den freien Bereich bis zur Tab-Leiste bzw. zum Pausentimer; ist sie länger, scrollt nur sie (unten weich ausgeblendet). Nach dem Abhaken rollt die Karte zum nächsten offenen Satz. Weitere Aktionen (Übung hinzufügen, Plan bearbeiten, Verwerfen) im „⋯“-Menü der Kopfzeile neben „Beenden“.
- **Tab-Leiste:** vier Reiter nur mit Symbolen – Training, Daily, Chat, Profil (Beschriftung für Screenreader; Verlauf und Bibliothek öffnen sich aus dem Profil, dabei bleibt der Reiter hervorgehoben, von dem man kam). Inaktiv `--muted`, aktiv `--lg-text-active` auf der gleitenden Glas-Pille.
- **Daily (`#/daily`):** Streifen der letzten 7 Tage (`.dstrip`: Pillen, gewählter Tag in `--inv`, Punkt leer/halb/voll = Mealplan-Fortschritt), Karte **Gewicht** (Eingabe + „Speichern/Ändern“, Zeile „± seit …“, Diagramm), Karte **Mealplan** (`.meal-row`: runder Haken `--inv`, Name 17/650 – abgehakt durchgestrichen und gedämpft –, Uhrzeit · Beschreibung, Kalorien rechts; Fortschrittsbalken `.meter` und „3 / 5“). Bearbeiten auf `#/daily/plan` (Zeilen mit Hoch/Runter/Löschen), Neu/Ändern als Sheet.
- **Chat-Liste (`#/chat`, `.chat-home`):** große Überschrift „Chats“, oben rechts **+** (neue Gruppe) und Zahnrad. Zeilen sind `.list-item.chat-row` (68 px): Avatar, Titel 17/650, darunter die letzte Nachricht einzeilig mit Ellipse, rechts Uhrzeit (heute) bzw. Tag und bei Ungelesenem ein Punkt (`.unread-dot`, `--lg-text-active`) mit fetter Schrift. Reihenfolge: **Gym-Chat** (Avatar `.avatar-room`: invertierte Fläche mit Hantel), Abschnitt **Gruppen** („Neu“ in der Abschnittszeile), Abschnitt **Kontakte** (Freunde, Direktnachricht). Leerzustände: ein Satz + ein Knopf.
- **Gruppeninfo und „Neue Gruppe“:** Sheets (`customModal`, hoch): Name als Eingabe, Freunde als `.pick-row` mit Avatar und Häkchen, Knopf „Erstellen (n)“ erst aktiv mit Namen und mindestens einem Freund. Info: Mitgliederzeilen (Besitzer beschriftet), als Besitzer Papierkorb je Mitglied, darunter gestapelte Knöpfe (hinzufügen, umbenennen, löschen = `danger-soft`) bzw. „Gruppe verlassen“.
- **Avatare (`.avatar`):** Größen 24/32/42/52/58/72/104 px (`--av`). **Ohne Foto: der große Anfangsbuchstabe** (Schrift 46 % des Durchmessers, 700) auf einer von zehn Farben (`.ac0` … `.ac9`, HSL mit 56 % Sättigung, alle mit weißer Schrift ≥ 4,5:1); die Farbe folgt aus dem Namen (FNV-1a-Hash → `avatarIndex`), ist also pro Person und Gerät gleich. Ohne Namen (z. B. Gastmodus) bleibt ein grauer Platzhalter. Fällt ein Foto aus (offline), wird daraus der Buchstabe.
- **Chat (`.chat`):** feststehende Seite (`body.chat-lock`) – nur die Nachrichtenliste scrollt, das Eingabefeld sitzt über der Tab-Leiste (mit Tastatur: Tab-Leiste und „Heute im Gym“ weg). Eigene Nachrichten rechts in der Akzentfläche (`--inv`), fremde links in `--surface-3` mit Avatar (32 px) und @Name; gruppiert innerhalb 5 min, Tagestrenner als Pille. Gym-Karte (`.plan`): 1,5-px-Umriss `--border-strong`, runder Kreis mit Hantel-Icon in `--inv`, Zeit als Titel, Teilnehmer als überlappende Avatare, ein Knopf „Ich komme mit“ (`primary`) bzw. „Ich komme doch nicht mit“ (`soft`). „Heute im Gym“ (`.chat-today`): Karte mit horizontal scrollenden Zeit-Kacheln. Fehlgeschlagene Nachrichten: gestrichelter Umriss, Warn-Icon, „Erneut senden“.
- **Aufwärmsätze (`.set.warm`):** gleiche Zeile wie ein Arbeitssatz, Nummer „A“/„A1…“ statt Zahl; übersprungene (offen, obwohl schon ein Arbeitssatz abgehakt ist) werden wie erledigte gedimmt (`.passed`). Im Verlauf: „A“ + kleines Label „Aufwärmen“, gedämpfte Farbe, kein 1RM. Unter jeder Übungskarte zwei gleich breite Knöpfe „+ Satz“ / „Aufwärmen“ (`.set-adds`).
- **Mein Gym (`.gym-card`):** Karte auf der Startseite unter dem Wochenziel – links Pin-Kreis + Name/Adresse (je eine Zeile, Ellipse), rechts „Route“ als `primary sm`. Noch nicht festgelegt: gestrichelter Umriss (`.gym-empty`) mit Chevron. „Route“ öffnet ein Sheet mit Auto / Zu Fuß / ÖPNV / Fahrrad.

## Do's and Don'ts

**Do**
- Bewegung über `transform`/`opacity` und die eigenen Eigenschaften `scale`/`translate` (Berührung, per Skript-Federn); `width` nur bei der Tab-Linse, `filter`/`backdrop-filter` nur kurz beim „Materialisieren“ von Sheets und Toasts. Federn mit leichtem Nachschwingen (`--spring`, ≈ 4 %), Ausblenden schneller als Einblenden (`--d-out` < `--d-base`).
- `prefers-reduced-motion`: nur kurze Überblendungen, Zustandswechsel bleiben sichtbar.
- Haptik (`Haptics.tap()`) bei Abhaken, Wischen, Umschaltern.
- Jede Geste hat eine Tipp-Alternative (Wischen-zum-Löschen ↔ Mülleimer, Ziehen ↔ Pfeile).
- Offline zuerst: jede Ansicht funktioniert ohne Netz; Cloud-Daten zeigen „zuletzt aktualisiert am …“.

**Don't**
- Keine zusätzliche Akzentfarbe: aktiv und primär ist Blau (dunkel `#0061fe`, hell `#0832a8`) – und nur für Hauptaktion und Zustände, nicht für Zahlen, Linien oder Diagramme. Keine Farbverläufe in Text. Kein `backdrop-filter` auf Listeneinträgen in langen Listen. Kein Glas auf Glas – Karten liegen auf dem Hintergrund, nicht aufeinander.
- Rot/Rosé nie allein als Information: immer Warn-Icon oder Text dazu.
- Kein `transition: all`, kein `outline: none` ohne `:focus-visible`-Ersatz.
- Keine Texte unter 11 px, keine Eingaben unter 16 px.
- Keine Modals für Dinge, die ein Sheet oder eine Inline-Aktion lösen.
- `--faint` nie für Text oder bedienbare Icons.
