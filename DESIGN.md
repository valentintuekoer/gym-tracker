---
name: Gym Tracker
description: Training, Pausen-Timer, Ernährung und Fortschritt – schwarz-weiß, nah an iOS, gebaut für eine Hand im Gym.
colors:
  bg-dark: "#000000"
  surface-dark: "#111111"
  surface-2-dark: "#1a1a1a"
  surface-3-dark: "#262626"
  border-dark: "#232323"
  border-strong-dark: "#3a3a3a"
  text-dark: "#ffffff"
  text-2-dark: "#d4d4d4"
  muted-dark: "#8f8f8f"
  faint-dark: "#5e5e5e"
  bg-light: "#f2f2f2"
  surface-light: "#ffffff"
  surface-2-light: "#f2f2f2"
  surface-3-light: "#e0e0e0"
  border-light: "#e4e4e4"
  border-strong-light: "#c4c4c4"
  text-light: "#000000"
  text-2-light: "#262626"
  muted-light: "#636363"
  faint-light: "#a8a8a8"
typography:
  large-title:
    fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
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
    letterSpacing: "0.04em"
  tab-label:
    fontSize: "11px"
    fontWeight: 600
rounded:
  xs: "4px"
  sm: "8px"
  input: "12px"
  card-sm: "16px"
  card: "20px"
  sheet: "30px"
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
    backgroundColor: "{colors.text-dark}"
    textColor: "{colors.bg-dark}"
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
    backgroundColor: "#161616"
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
---

# Gym Tracker – Designsystem

Quelle der Wahrheit sind die Tokens in `style.css` (`:root`). Diese Datei beschreibt, wie sie eingesetzt werden. Neue Bildschirme müssen sich so anfühlen, als hätte es sie immer gegeben.

## Overview

Eine iPhone-Web-App (PWA) für das Training im Gym: eine Hand, schwitzige Finger, grelles oder schummriges Licht, 60–120 Sekunden Satzpause. Daraus folgt alles:

- **Schwarz-Weiß, keine Akzentfarbe.** Betonung entsteht über Weiß vs. Grau, Gewicht und Größe – nie über Farbe. Standard ist Dunkel mit echtem OLED-Schwarz (`#000`), Hell ist gleichwertig.
- **Nah an iOS 26 („Liquid Glass“).** Große Titel, gruppierte Listen, Bottom Sheets, schwebende Glas-Tab-Leiste, Wischgesten. Keine Web-Konventionen, die sich auf dem iPhone fremd anfühlen.
- **Der Satz ist die wichtigste Interaktion.** Gewicht, Wiederholungen, Haken – groß, direkt erreichbar, mit Haptik.

Modus: **Operate** – Übersicht, Konsistenz und Tempo schlagen Ausdruck. Die Marke lebt in präzisen Details (Glas, Federn, Zahlen in Tabellenziffern).

## Colors

Zwei Themes über `data-theme="dark|light"` auf `<html>`; „System“ folgt `prefers-color-scheme`. Immer Tokens verwenden, nie Hex-Werte in Komponenten (einzige Ausnahme: der QR-Code ist immer schwarz auf weiß, damit ihn jede Kamera liest).

| Token | Rolle |
|---|---|
| `--bg` | Seitenhintergrund (OLED-Schwarz / Hellgrau) |
| `--surface`, `--surface-2`, `--surface-3` | Karten → vertiefte Flächen → Platzhalter/Tracks |
| `--text`, `--text-2` | Primärtext, ruhigerer Fließtext |
| `--muted` | Sekundärtext **und bedienbare Icons** (≥ 4,5:1 auf allen Flächen) |
| `--faint` | nur Deko (Chevrons, Trenner) – nie für Text oder Bedienelemente (< 3:1) |
| `--inv`, `--on-inv` | invertierte Fläche für Primäraktionen, aktive Zustände, „Du“ in Vergleichen |
| `--border`, `--border-strong` | Haarlinien, Umrandungen |
| `--glass-*` | Liquid-Glass-Füllungen, Kanten, Glanzlichter |

Vergleiche (Freunde, Makros): **Du = `--inv`**, **andere = `--muted`**. Makros unterscheiden sich zusätzlich durch Muster (voll / schraffiert / gepunktet) – Information nie nur über Helligkeit.

`@media (prefers-contrast: more)` hebt `--muted`, Linien und Glas-Deckkraft an (iOS: „Kontrast erhöhen“).

## Typography

Systemschrift (SF Pro auf Apple-Geräten), keine Webfonts – schnell, offline, nativ.

Die Stufen folgen den iOS-Textstilen: Large Title 34 · Title 20 · Headline 17 · Body 16 · Subheadline 15 · Sekundär 14 · Footnote 13 · Caption 12 · Tab-Beschriftung 11.

- **Große Titel** 34 px / 700 / −0,03em, schrumpfen beim Scrollen in die Kopfzeile.
- **Kartentitel** 17–20 px / 650. **Fließtext** 16 px (Eingaben immer ≥ 16 px, sonst zoomt iOS). **Sekundär** 13–14 px in `--muted`.
- Monospace nur für echte Codes/IDs (Nutzer-ID), nie als Stilmittel.
- **Minimum 11 px** für alles Lesbare (Tab-Beschriftungen eingeschlossen).
- Zahlen, Gewichte, Zeiten: `font-variant-numeric: tabular-nums`.
- Überschriften `text-wrap: balance`, Hinweise `text-wrap: pretty`.
- Abschnittsbeschriftungen in Versalien 13 px / 600 / +0,04em – sparsam, nur über Listengruppen.
- Deutsche Typografie: „…“ statt `...`, „Anführungszeichen“, geschützte Leerzeichen in Einheiten (`80 kg`).

## Layout

- **8-px-Raster** (`--s-1` … `--s-7`), 16 px Seitenrand, Inhalt max. 640 px breit (iPad/Desktop zentriert).
- **Safe Areas** über `env(safe-area-inset-*)`: nichts unter Dynamic Island, Statusleiste oder Home-Indikator.
- **Daumenzone:** Primäraktionen unten (Training starten, Beenden, Speichern), Navigation oben.
- **Tippflächen ≥ 44 × 44 px** – kleine Chips und Icons vergrößern ihre Fläche mit `::after`, statt größer zu werden.
- Listen sind gruppiert (`.card.flush` + `.row`) wie iOS-Einstellungen; Menüzeilen haben Icon-Kachel, Titel, Unterzeile, Wert, Chevron.

## Elevation & Depth

Tiefe entsteht durch Flächenstufen (`--bg` → `--surface` → `--surface-2`), nicht durch Schatten. Schatten nur für schwebende Ebenen:

- **Tab-Leiste, Kopfzeilen-Knöpfe, Pausentimer, Toasts, Sheets** sind Liquid Glass: `backdrop-filter: blur() saturate()`, halbtransparente Füllung (`--glass-fill`), helle Oberkante (`--glass-hi`), weicher Schatten (`--glass-shadow`). Glas ist Funktion (Ebene über Inhalt), nie Deko auf Karten.
- Die aktive Tab-„Linse“ gleitet mit leichtem Dehnen zum Ziel.

## Shapes

Radien: 4/8 für Kleinteile · Eingabe 12 · kleine Karte/Listeneintrag 16 · Karte 20 · Sheet 30 · Knopf/Chip/Segment/Avatar vollrund. Verschachtelte Flächen (Glas-Linse in der Tab-Leiste, Daumen im Segment) folgen der Regel **innerer Radius = äußerer Radius − Abstand**; daraus entstehen Einzelwerte wie 22/26/34 px – das ist gewollt, kein Drift. Die Mini-Vorschauen (Einführung, Design-Auswahl) sind Illustrationen und dürfen eigene Radien haben. Keine eckigen Elemente, keine farbigen Seitenränder. Icons: eigenes Linien-Set, 24er-Raster, Strich 1,8 (aktive Tabs 2,1), runde Enden – keine Emojis als Icons.

## Components

- **Knöpfe:** `primary` (invertiert, eine pro Ansicht), `soft` (Fläche), `ghost` (nur Text), `danger`/`danger-soft` – zerstörerisch wird mit Warn-Icon markiert, nicht mit Rot. Höhe 50 (lg 56, sm 44).
- **Chips:** 36 px, Umriss; `dim` gestrichelt = „noch nicht gesetzt“; `on` invertiert.
- **Segmente:** Pille mit gleitendem „Daumen“ (Feder).
- **Sheets & Dialoge:** immer als Bottom Sheet mit Griff; folgen dem Finger, Wischen nach unten schließt; Buttons unten, Abbrechen als `ghost`.
- **Listen-Einträge:** 64 px, Titel 17/600, Unterzeile 14 `--muted`, rechts Wert + Chevron (`--faint`).
- **Skeletons** (`.sk`) statt Spinner für alles, was aus der Cloud kommt; Schimmer nur per `transform`.
- **Leere Zustände:** kurze fette Zeile + ein Satz + eine Aktion.
- **Profilfoto (`.avatar`):** rund, 42/52/72/104 px; ohne Foto grauer Personen-Platzhalter (`.avatar-empty`).
- **Vergleichsbalken (`.cmp`):** Beschriftung „Du“/„@name“, Track `--surface-2`, Füllung per `scaleX`.
- **Toast:** unten über der Tab-Leiste, optional mit „Rückgängig“ (5 s).

## Do's and Don'ts

**Do**
- Bewegung nur über `transform`/`opacity`; Federn mit leichtem Nachschwingen (`--spring`, ≈ 4 %), Ausblenden schneller als Einblenden (`--d-out` < `--d-base`).
- `prefers-reduced-motion`: nur kurze Überblendungen, Zustandswechsel bleiben sichtbar.
- Haptik (`Haptics.tap()`) bei Abhaken, Wischen, Umschaltern.
- Jede Geste hat eine Tipp-Alternative (Wischen-zum-Löschen ↔ Mülleimer, Ziehen ↔ Pfeile).
- Offline zuerst: jede Ansicht funktioniert ohne Netz; Cloud-Daten zeigen „zuletzt aktualisiert am …“.

**Don't**
- Keine Akzentfarben, keine Farbverläufe in Text, kein Glas auf Inhaltskarten.
- Kein `transition: all`, kein `outline: none` ohne `:focus-visible`-Ersatz.
- Keine Texte unter 11 px, keine Eingaben unter 16 px.
- Keine Modals für Dinge, die ein Sheet oder eine Inline-Aktion lösen.
- `--faint` nie für Text oder bedienbare Icons.
