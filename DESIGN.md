---
name: Gym Tracker
description: Training, Pausen-Timer, Ernährung und Fortschritt – „Ember Glass“: dunkle Glasflächen, eine warme Akzentfarbe, nah an iOS, gebaut für eine Hand im Gym.
colors:
  bg-dark: "#07080c"
  surface-dark: "#11141b"
  surface-2-dark: "#181c26"
  surface-3-dark: "#232836"
  border-dark: "#1f2431"
  border-strong-dark: "#363d50"
  text-dark: "#f6f7fa"
  text-2-dark: "#d5d9e2"
  muted-dark: "#9aa1b3"
  faint-dark: "#636a7d"
  accent-dark: "#ff7a3d"
  on-accent-dark: "#1c0c03"
  accent-ink-dark: "#ff8a50"
  danger-dark: "#ff7088"
  bg-light: "#f4f2ef"
  surface-light: "#ffffff"
  surface-2-light: "#f4f2ef"
  surface-3-light: "#e6e2dc"
  border-light: "#e6e2db"
  border-strong-light: "#c9c3b9"
  text-light: "#17130f"
  text-2-light: "#2c2620"
  muted-light: "#6a6358"
  faint-light: "#a8a196"
  accent-light: "#c2410c"
  on-accent-light: "#ffffff"
  accent-ink-light: "#9a3412"
  danger-light: "#bb1d42"
typography:
  large-title:
    fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.04em"
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
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.14em"
  eyebrow:
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.14em"
  numeral:
    fontSize: "40px"
    fontWeight: 800
    letterSpacing: "-0.05em"
  tab-label:
    fontSize: "10.5px"
    fontWeight: 600
rounded:
  xs: "4px"
  sm: "8px"
  input: "14px"
  card-sm: "22px"
  card: "28px"
  sheet: "36px"
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
    backgroundColor: "#141822"
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
    backgroundColor: "rgba(26, 30, 42, 0.5)"
    rounded: "{rounded.pill}"
    height: "62px"
---

# Gym Tracker – Designsystem

Quelle der Wahrheit sind die Tokens in `style.css` (`:root`). Diese Datei beschreibt, wie sie eingesetzt werden. Neue Bildschirme müssen sich so anfühlen, als hätte es sie immer gegeben.

## Overview

Eine iPhone-Web-App (PWA) für das Training im Gym: eine Hand, schwitzige Finger, grelles oder schummriges Licht, 60–120 Sekunden Satzpause. Daraus folgt alles. Die Gestaltung orientiert sich an der Formensprache moderner Transit-Apps (dunkle Glaskarten, kleine Versalien-Überschriften, große Ziffern, schwebende Tab-Leiste), mit eigener Farbe, eigenen Formen und eigenen Details:

- **Ember Glass: dunkles Glas, eine warme Akzentfarbe.** Kühles Fast-Schwarz (`#07080c`), Karten als Glasflächen mit Verlaufs-Kante, zwei weiche Leuchtflecken im Hintergrund und ein einziger Akzent: Glut-Orange. Der Akzent markiert nur, was gerade aktiv oder die Hauptaktion ist (Tab, Haupt-Knopf, Segment, laufendes Training, Zähler). Alles andere bleibt neutral. Dunkel ist Standard, Hell ist gleichwertig (warmes Off-White, dunkleres Orange).
- **Nah an iOS 26 („Liquid Glass“).** Große Titel, gruppierte Listen, Bottom Sheets, schwebende Glas-Tab-Leiste, Wischgesten. Keine Web-Konventionen, die sich auf dem iPhone fremd anfühlen.
- **Der Satz ist die wichtigste Interaktion.** Gewicht, Wiederholungen, Haken – groß, direkt erreichbar, mit Haptik.

Modus: **Operate** – Übersicht, Konsistenz und Tempo schlagen Ausdruck. Die Marke lebt in präzisen Details (Glas, Federn, Zahlen in Tabellenziffern).

## Colors

Zwei Themes über `data-theme="dark|light"` auf `<html>`; „System“ folgt `prefers-color-scheme`. Immer Tokens verwenden, nie Hex-Werte in Komponenten (einzige Ausnahme: der QR-Code ist immer schwarz auf weiß, damit ihn jede Kamera liest).

| Token | Rolle |
|---|---|
| `--bg` | Seitenhintergrund (kühles Fast-Schwarz / warmes Off-White) |
| `--surface`, `--surface-2`, `--surface-3` | Karten → vertiefte Flächen → Platzhalter/Tracks |
| `--text`, `--text-2` | Primärtext, ruhigerer Fließtext |
| `--muted` | Sekundärtext **und bedienbare Icons** (≥ 4,5:1 auf allen Flächen) |
| `--faint` | nur Deko (Chevrons, Trenner) – nie für Text oder Bedienelemente (< 3:1) |
| `--inv`, `--on-inv` | **Akzentfläche** (Glut-Orange) und Text darauf: Haupt-Knopf, aktiver Zustand, abgehakter Satz, „Du“ in Vergleichen. Kontrast Text auf Fläche ≥ 5:1 |
| `--accent-ink` | Akzent als **Text/Icon** auf Hintergrund (Eyebrow, aktiver Tab, `accent`-Text); im hellen Theme dunkler als `--inv`, damit 4,5:1 erreicht wird |
| `--accent-soft`, `--accent-line`, `--accent-glow` | getönte Fläche, Akzent-Kante, Leuchten (Segment, aktiver Tab, Chips, Wochen-Punkte) |
| `--danger`, `--on-danger` | zerstörerische Aktionen und Fehler (Rosé) – immer zusätzlich Warn-Icon oder Text, nie nur Farbe |
| `--card-fill`, `--card-fill-press`, `--card-edge` | Karten: Verlaufs-Füllung und Verlaufs-Kante (heller oben links, Glut unten rechts) |
| `--glow-a`, `--glow-b` | die beiden Hintergrund-Leuchtflecken (`body::before`, fest) |
| `--tone-*` (ember, amber, green, teal, blue, violet, rose, slate) | Farbtöne für Icon-Kacheln in Menüzeilen (`.row-ic.t-*`) – nur zur Orientierung, jede Zeile hat Text |
| `--border`, `--border-strong` | Haarlinien, Umrandungen |
| `--glass-*` | Liquid-Glass-Füllungen, Kanten, Glanzlichter |

Vergleiche (Freunde, Makros): **Du = `--inv`** (Akzent), **andere = `--muted`**. Makros unterscheiden sich zusätzlich durch Muster (voll / schraffiert / gepunktet) – Information nie nur über Helligkeit.

`@media (prefers-contrast: more)` hebt `--muted`, Linien und Glas-Deckkraft an (iOS: „Kontrast erhöhen“).

## Typography

Systemschrift (SF Pro auf Apple-Geräten), keine Webfonts – schnell, offline, nativ.

Die Stufen folgen den iOS-Textstilen: Large Title 38 · Title 20 · Headline 17 · Body 16 · Subheadline 15 · Sekundär 14 · Footnote 13 · Caption 12 · Tab-Beschriftung 10,5.

- **Große Titel** 38 px / 800 / −0,04em, schrumpfen beim Scrollen in die Kopfzeile. Darüber optional die **Eyebrow** (Datum o. Ä.): 12 px / 700 / +0,14em, Versalien, `--accent-ink`.
- **Große Ziffern** (Minuten am Trainingstag, Wochenzähler): 30–40 px / 800 / −0,05em, `tabular-nums`, mit kleiner Versalien-Einheit darunter (11 px / 700 / +0,14em, `--muted`).
- **Kartentitel** 17–20 px / 650. **Fließtext** 16 px (Eingaben immer ≥ 16 px, sonst zoomt iOS). **Sekundär** 13–14 px in `--muted`.
- Monospace nur für echte Codes/IDs (Nutzer-ID), nie als Stilmittel.
- **Minimum 10,5 px** für alles Lesbare (nur Tab-Beschriftungen, sonst 11 px).
- Zahlen, Gewichte, Zeiten: `font-variant-numeric: tabular-nums`.
- Überschriften `text-wrap: balance`, Hinweise `text-wrap: pretty`.
- Abschnittsbeschriftungen in Versalien 12 px / 700 / +0,14em, `--muted` – sparsam, nur über Listengruppen.
- Deutsche Typografie: „…“ statt `...`, „Anführungszeichen“, geschützte Leerzeichen in Einheiten (`80 kg`).

## Layout

- **8-px-Raster** (`--s-1` … `--s-7`), 16 px Seitenrand, Inhalt max. 640 px breit (iPad/Desktop zentriert).
- **Safe Areas** über `env(safe-area-inset-*)`: nichts unter Dynamic Island, Statusleiste oder Home-Indikator.
- **Daumenzone:** Primäraktionen unten (Training starten, Beenden, Speichern), Navigation oben.
- **Tippflächen ≥ 44 × 44 px** – kleine Chips und Icons vergrößern ihre Fläche mit `::after`, statt größer zu werden.
- Listen sind gruppiert (`.card.flush` + `.row`) wie iOS-Einstellungen; Menüzeilen haben Icon-Kachel, Titel, Unterzeile, Wert, Chevron.

## Elevation & Depth

Tiefe entsteht durch Flächenstufen (`--bg` → Karte → vertiefte Fläche) und die **Verlaufs-Kante** der Karten: `border: 1px solid transparent` + `background: var(--card-fill) padding-box, var(--card-edge) border-box` (die Füllung ist deckend, damit die Kante nicht durchscheint). Pressed-Zustände müssen beide Ebenen neu setzen (`--card-fill-press`). Große Karten haben einen weichen Schatten (`--card-shadow`), Listeneinträge keinen. Der Hintergrund trägt zwei feste Leuchtflecken (`body::before`; `body` selbst ist durchsichtig, `html` hält die Grundfarbe). Schatten sonst nur für schwebende Ebenen:

- **Tab-Leiste, Kopfzeilen-Knöpfe, Pausentimer, Toasts, Sheets** sind Liquid Glass (Material unten): `backdrop-filter: blur() saturate()`, halbtransparente Füllung (`--glass-fill`), helle Oberkante (`--glass-hi`), weicher Schatten (`--glass-shadow`). Glas ist Funktion (Ebene über Inhalt), nie Deko auf Karten.
- Die aktive Tab-„Linse“ (getönt mit `--accent-soft` und Akzent-Kante) gleitet mit leichtem Dehnen zum Ziel.
- **Kompakte Tab-Leiste:** beim Herunterscrollen (> 24 px Strecke, ab 96 px) blenden die Beschriftungen aus und die Leiste schrumpft von 62 auf 54 px (`body.tabs-compact`); beim Hochscrollen (> 12 px) oder ganz oben kommt sie zurück. Das ist die einzige Animation von `height` – sie betrifft nur diese eine feste Leiste.

## Shapes

Radien: 4/8 für Kleinteile · Eingabe 14 · kleine Karte/Listeneintrag 22 · Karte 28 · Sheet 36 · Icon-Kachel 12 · Knopf/Chip/Segment/Avatar vollrund. Verschachtelte Flächen (Glas-Linse in der Tab-Leiste, Daumen im Segment) folgen der Regel **innerer Radius = äußerer Radius − Abstand**; daraus entstehen Einzelwerte wie 22/26/34 px – das ist gewollt, kein Drift. Die Mini-Vorschauen (Einführung, Design-Auswahl) sind Illustrationen und dürfen eigene Radien haben. Keine eckigen Elemente, keine farbigen Seitenränder. Icons: eigenes Linien-Set, 24er-Raster, Strich 1,8 (aktive Tabs 2,1), runde Enden – keine Emojis als Icons.

## Components

- **Knöpfe:** `primary` (Akzent mit Glanz und Leuchten, eine pro Ansicht), `soft` (Glas), `ghost` (nur Text), `danger`/`danger-soft` (Rosé, immer mit Warn-Icon). „Mit Apple anmelden“ bleibt schwarz bzw. weiß (Apple-Richtlinie). Höhe 50 (lg 56, sm 44).
- **Chips:** 36 px, Glas mit Kante; `dim` gestrichelt = „noch nicht gesetzt“; `on` = getönt mit Akzent-Kante und `--accent-ink`-Text. **Live-Abzeichen** (`.live-badge` + `.live-dot`): grüner, ruhig atmender Punkt + Versalien-Text für „läuft gerade“.
- **Segmente:** Glas-Pille mit gleitendem, akzent-getöntem „Daumen“ (Feder), gewählter Text in `--text`.
- **Trainingstag-Karte (`.day-card`):** Name 26/800, Unterzeile, Übungen in 2 Zeilen; rechts große Minuten-Zahl (`Core.estimateMinutes`) mit „MIN“, danach „⋯“. Läuft der Tag: Akzent-Kante, Leuchten und Live-Abzeichen. **Wochenkarte:** große Zahl „2/3“, Text, Punkte (aktiv = Akzent mit Leuchten).
- **Menüzeilen:** Icon-Kachel 36 px mit getönter Fläche und Kante im `--tone-*` der Zeile (z. B. Training = ember, Ernährung = green), Trennlinie beginnt nach der Kachel.
- **Sheets & Dialoge:** immer als Bottom Sheet mit Griff; folgen dem Finger, Wischen nach unten schließt; Buttons unten, Abbrechen als `ghost`.
- **Listen-Einträge:** 64 px, Titel 17/600, Unterzeile 14 `--muted`, rechts Wert + Chevron (`--faint`).
- **Skeletons** (`.sk`) statt Spinner für alles, was aus der Cloud kommt; Schimmer nur per `transform`.
- **Leere Zustände:** kurze fette Zeile + ein Satz + eine Aktion.
- **Profilfoto (`.avatar`):** rund, 42/52/72/104 px; ohne Foto grauer Personen-Platzhalter (`.avatar-empty`).
- **Vergleichsbalken (`.cmp`):** Beschriftung „Du“/„@name“, Track `--surface-2`, Füllung per `scaleX`.
- **Toast:** unten über der Tab-Leiste, optional mit „Rückgängig“ (5 s).
- **Laufendes Training:** Die Seite steht fest (`body.wk-lock`) – kein vertikales Scrollen, nur seitliches Wischen zwischen den Übungskarten. Jede Karte füllt den freien Bereich bis zur Tab-Leiste bzw. zum Pausentimer; ist sie länger, scrollt nur sie (unten weich ausgeblendet). Nach dem Abhaken rollt die Karte zum nächsten offenen Satz. Weitere Aktionen (Übung hinzufügen, Plan bearbeiten, Verwerfen) im „⋯“-Menü der Kopfzeile neben „Beenden“.
- **Chat (`.chat`):** feststehende Seite (`body.chat-lock`) – nur die Nachrichtenliste scrollt, das Eingabefeld sitzt über der Tab-Leiste (mit Tastatur: Tab-Leiste und „Heute im Gym“ weg). Eigene Nachrichten rechts in der Akzentfläche (`--inv`), fremde links in `--surface-3` mit Avatar (32 px) und @Name; gruppiert innerhalb 5 min, Tagestrenner als Pille. Gym-Karte (`.plan`): 1,5-px-Umriss `--border-strong`, runder Kreis mit Hantel-Icon in `--inv`, Zeit als Titel, Teilnehmer als überlappende Avatare, ein Knopf „Ich komme mit“ (`primary`) bzw. „Ich komme doch nicht mit“ (`soft`). „Heute im Gym“ (`.chat-today`): Karte mit horizontal scrollenden Zeit-Kacheln. Fehlgeschlagene Nachrichten: gestrichelter Umriss, Warn-Icon, „Erneut senden“. Sechs Reiter: unter 360 px zeigt nur der aktive seine Beschriftung.
- **Aufwärmsätze (`.set.warm`):** gleiche Zeile wie ein Arbeitssatz, Nummer „A“/„A1…“ statt Zahl; übersprungene (offen, obwohl schon ein Arbeitssatz abgehakt ist) werden wie erledigte gedimmt (`.passed`). Im Verlauf: „A“ + kleines Label „Aufwärmen“, gedämpfte Farbe, kein 1RM. Unter jeder Übungskarte zwei gleich breite Knöpfe „+ Satz“ / „Aufwärmen“ (`.set-adds`).
- **Mein Gym (`.gym-card`):** Karte auf der Startseite unter dem Wochenziel – links Pin-Kreis + Name/Adresse (je eine Zeile, Ellipse), rechts „Route“ als `primary sm`. Noch nicht festgelegt: gestrichelter Umriss (`.gym-empty`) mit Chevron. „Route“ öffnet ein Sheet mit Auto / Zu Fuß / ÖPNV / Fahrrad.

## Do's and Don'ts

**Do**
- Bewegung nur über `transform`/`opacity`; Federn mit leichtem Nachschwingen (`--spring`, ≈ 4 %), Ausblenden schneller als Einblenden (`--d-out` < `--d-base`).
- `prefers-reduced-motion`: nur kurze Überblendungen, Zustandswechsel bleiben sichtbar.
- Haptik (`Haptics.tap()`) bei Abhaken, Wischen, Umschaltern.
- Jede Geste hat eine Tipp-Alternative (Wischen-zum-Löschen ↔ Mülleimer, Ziehen ↔ Pfeile).
- Offline zuerst: jede Ansicht funktioniert ohne Netz; Cloud-Daten zeigen „zuletzt aktualisiert am …“.

**Don't**
- Genau **eine** Akzentfarbe, nur für aktiv/Hauptaktion – nicht für Dekoration, nicht als Fließtext-Farbe (dafür `--accent-ink` und nur für Eyebrows, aktive Reiter und Hervorhebungen). Keine Farbverläufe in Text. Kein Backdrop-Blur auf Inhaltskarten (deren Glas-Anmutung kommt aus Füllung + Kante).
- Rot/Rosé nie allein als Information: immer Warn-Icon oder Text dazu.
- Kein `transition: all`, kein `outline: none` ohne `:focus-visible`-Ersatz.
- Keine Texte unter 11 px (Ausnahme: Tab-Beschriftungen 10,5), keine Eingaben unter 16 px.
- Keine Modals für Dinge, die ein Sheet oder eine Inline-Aktion lösen.
- `--faint` nie für Text oder bedienbare Icons.
