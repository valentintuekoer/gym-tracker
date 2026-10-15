---
name: Gym Tracker
description: Training, Pausen-Timer, Ernährung und Fortschritt – „Liquid Glass“: blauer Verlauf mit Farbflecken, Glas aus fünf Schichten, einfarbig, nah an iOS, gebaut für eine Hand im Gym.
colors:
  bg-dark: "#081120"
  bg-a-dark: "#060d1c"
  bg-b-dark: "#0b1626"
  orb-1-dark: "#1b6dff"
  orb-2-dark: "#0fb89a"
  orb-3-dark: "#e0762f"
  surface-dark: "#1e1e22"
  surface-2-dark: "#26262c"
  surface-3-dark: "#34343c"
  text-dark: "#ffffff"
  text-2-dark: "#f2f2f7"
  muted-dark: "#e0e4ee"
  faint-dark: "#7f8596"
  accent-dark: "#ffffff"
  on-accent-dark: "#0b1220"
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
    fontSize: "44px"
    fontWeight: 750
    lineHeight: 1.05
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
    letterSpacing: "0.06em"
  eyebrow:
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.06em"
  numeral:
    fontSize: "52px"
    fontWeight: 750
    letterSpacing: "-0.04em"
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
    backgroundColor: "rgba(28, 28, 32, 0.74)"
    rounded: "{rounded.pill}"
    height: "62px"
---

# Gym Tracker – Designsystem

Quelle der Wahrheit sind die Tokens in `style.css` (`:root`). Diese Datei beschreibt, wie sie eingesetzt werden. Neue Bildschirme müssen sich so anfühlen, als hätte es sie immer gegeben.

## Overview

Eine iPhone-Web-App (PWA) für das Training im Gym: eine Hand, schwitzige Finger, grelles oder schummriges Licht, 60–120 Sekunden Satzpause. Daraus folgt alles. Die Gestaltung ist die der Liquid-Glass-Demo (`liquid-glass/`): Material, Farbflecken, große Titel, große Ziffern, schwebende Tab-Leiste:

- **Liquid Glass, einfarbig.** Hintergrund: Verlauf (`--bg-a` → `--bg-b`) mit drei ruhigen Farbflecken (blau, türkis, orange – fest, ohne Bewegung). Darauf Glas aus fünf Schichten. Es gibt **keine Akzentfarbe**: aktiv und primär ist im dunklen Design **weiß**, im hellen **tiefblau** (`#0832a8`). Betonung entsteht über Gewicht, Größe und dieses Glas. Dunkel ist Standard, Hell gleichwertig. Die Vorlage ist die Demo unter `liquid-glass/` – die App soll genauso aussehen.
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
| `--inv`, `--on-inv` | **aktive/primäre Fläche** und Text darauf: dunkel weiß/Tiefblau-Schwarz, hell Tiefblau/Weiß. Haupt-Knopf, abgehakter Satz, aktives Chip, „Du“ in Vergleichen. Kontrast ≥ 5:1 |
| `--lg-text-active` | Farbe für aktive Texte/Icons (aktiver Tab, Ring, Fokus): dunkel weiß, hell `#0832a8` |
| `--danger`, `--on-danger` | zerstörerische Aktionen und Fehler (Rosé) – immer zusätzlich Warn-Icon oder Text, nie nur Farbe |
| `--bg-a`, `--bg-b`, `--orb-1/2/3`, `--stage` | Verlauf und drei Farbflecken (Mittelpunkt/Radius wie in der Demo); `--stage` ist der fertige Hintergrund für `body::before` und die Seitenübergänge |
| `--lg-*` | Glas-Material: Füllungen (`--lg-fill` Leisten, `--lg-card-fill` Karten, `--lg-pill-fill` Pillen), Glanz (`--lg-spec-*`), Lichtkante (`--lg-edge-*`), Randlicht (`--lg-rim-*`), vier Schatten (`--lg-shadow-a…d`) |
| `--border`, `--border-strong` | Haarlinien, Umrandungen |
| `--glass-*` | ältere Namen für dasselbe Material (Timer, Toast, Sheets) |

Vergleiche (Freunde, Makros): **Du = `--inv`** (Akzent), **andere = `--muted`**. Makros unterscheiden sich zusätzlich durch Muster (voll / schraffiert / gepunktet) – Information nie nur über Helligkeit.

`@media (prefers-contrast: more)` hebt `--muted`, Linien und Glas-Deckkraft an (iOS: „Kontrast erhöhen“).

## Typography

Systemschrift (SF Pro auf Apple-Geräten), keine Webfonts – schnell, offline, nativ.

Die Stufen folgen den iOS-Textstilen: Large Title 34–44 · Title 20 · Headline 17 · Body 16 · Subheadline 15 · Sekundär 14 · Footnote 13 · Caption 12 · Tab-Beschriftung 11.

- **Große Titel** `clamp(34px, 9vw, 44px)` / 750 / −0,03em, schrumpfen beim Scrollen in die Kopfzeile. Darüber optional die **Eyebrow** (Datum o. Ä.): 13 px / 600 / +0,06em, Versalien, `--text-2`.
- **Große Ziffern** (Wochenzähler 52 px, Minuten am Trainingstag 30–40 px): 750 / −0,04em, `tabular-nums`; Kennzahlen 24 px / 700; kleine Versalien-Beschriftung 13 px / 600 / +0,04em in `--text-2`.
- **Kartentitel** 17–20 px / 650. **Fließtext** 16 px (Eingaben immer ≥ 16 px, sonst zoomt iOS). **Sekundär** 13–14 px in `--muted`.
- Monospace nur für echte Codes/IDs (Nutzer-ID), nie als Stilmittel.
- **Minimum 11 px** für alles Lesbare (Tab-Beschriftungen eingeschlossen).
- Zahlen, Gewichte, Zeiten: `font-variant-numeric: tabular-nums`.
- Überschriften `text-wrap: balance`, Hinweise `text-wrap: pretty`.
- Abschnittsbeschriftungen in Versalien 13 px / 600 / +0,06em, `--text-2` – sparsam, nur über Listengruppen.
- Deutsche Typografie: „…“ statt `...`, „Anführungszeichen“, geschützte Leerzeichen in Einheiten (`80 kg`).

## Layout

- **8-px-Raster** (`--s-1` … `--s-7`), 16 px Seitenrand, Inhalt max. 640 px breit (iPad/Desktop zentriert).
- **Safe Areas** über `env(safe-area-inset-*)`: nichts unter Dynamic Island, Statusleiste oder Home-Indikator.
- **Daumenzone:** Primäraktionen unten (Training starten, Beenden, Speichern), Navigation oben.
- **Tippflächen ≥ 44 × 44 px** – kleine Chips und Icons vergrößern ihre Fläche mit `::after`, statt größer zu werden.
- Listen sind gruppiert (`.card.flush` + `.row`) wie iOS-Einstellungen; Menüzeilen haben Icon-Kachel, Titel, Unterzeile, Wert, Chevron.

## Elevation & Depth

Alles, was auf dem Hintergrund liegt, ist **Glas** (Klasse `.lg-surface` in der Demo, in der App per Selektorliste in `style.css`) aus fünf Schichten von hinten nach vorn: (1) `backdrop-filter` (Unschärfe 40 px bzw. 32 px auf Karten, Sättigung 1,8, Helligkeit 1,04), (2) getönte Fläche (`--lg-fill` / `--lg-card-fill`), (3) **Glanz** (`::before`, Kuppel oben + Glanzpunkt oben links, liegt mit `z-index: −1` hinter dem Inhalt), (4) **Lichtkante** (`::after`, 1-px-Verlaufsrahmen per Maske), (5) Randlicht innen und vier gestaffelte Schatten außen. Listeneinträge (`.list-item`, `.ex-row`, `.body-tile`) bekommen dasselbe Aussehen **ohne** eigenen `backdrop-filter` (lange Listen). Sheets haben das Material ohne Pseudo-Elemente (die Karte scrollt).

Textfarben stehen auf Glas immer so, dass sie vor **jedem** Hintergrund lesbar sind (geprüft per Pixel, siehe unten). Fallbacks wie in der Demo: ohne `backdrop-filter`, mit „Transparenz reduzieren“ und „Kontrast erhöhen“ werden Flächen deckend, der Windows-Kontrastmodus zeigt Rahmen statt Glas.

- **Tab-Leiste, Kopfzeilen-Knöpfe, Pausentimer, Toasts, Sheets** sind Liquid Glass (Material unten): `backdrop-filter: blur() saturate()`, halbtransparente Füllung (`--glass-fill`), helle Oberkante (`--glass-hi`), weicher Schatten (`--glass-shadow`). Glas ist Funktion (Ebene über Inhalt), nie Deko auf Karten.
- Die aktive Tab-„Pille“ (`--lg-pill-fill`, Glanz, Randlicht) gleitet mit leichtem Dehnen zum Ziel; aktiver Text `--lg-text-active`.
- **Kompakte Tab-Leiste:** beim Herunterscrollen (> 24 px Strecke, ab 96 px) blenden die Beschriftungen aus und die Leiste schrumpft von 62 auf 54 px (`body.tabs-compact`); beim Hochscrollen (> 12 px) oder ganz oben kommt sie zurück. Das ist die einzige Animation von `height` – sie betrifft nur diese eine feste Leiste.

## Shapes

Radien: 4/8 für Kleinteile · Eingabe 14 · kleine Karte/Listeneintrag 20 · Karte 24 · Sheet 34 · Icon-Kachel 12 · Knopf/Chip/Segment/Avatar vollrund. Verschachtelte Flächen (Glas-Linse in der Tab-Leiste, Daumen im Segment) folgen der Regel **innerer Radius = äußerer Radius − Abstand**; daraus entstehen Einzelwerte wie 22/26/34 px – das ist gewollt, kein Drift. Die Mini-Vorschauen (Einführung, Design-Auswahl) sind Illustrationen und dürfen eigene Radien haben. Keine eckigen Elemente, keine farbigen Seitenränder. Icons: eigenes Linien-Set, 24er-Raster, Strich 1,8 (aktive Tabs 2,1), runde Enden – keine Emojis als Icons.

## Components

- **Knöpfe:** `primary` (`--inv` mit Glanz, eine pro Ansicht), `soft` (Glas-Pille), `ghost` (nur Text), `danger`/`danger-soft` (Rosé, immer mit Warn-Icon). „Mit Apple anmelden“ bleibt schwarz bzw. weiß (Apple-Richtlinie). Höhe 50 (lg 56, sm 44).
- **Chips:** 36 px, Glas-Pille; `dim` gestrichelt = „noch nicht gesetzt“; `on` = `--inv`. **Umriss-Pille** (`.chip-o`, 1,5-px-Umriss in `--text-2`, z. B. „zuletzt gestern“). **Läuft-Abzeichen** (`.live-badge` + `.live-dot`): Umriss-Pille mit atmendem Punkt.
- **Segmente:** Glas-Leiste mit gleitender Glas-Pille (`.seg-thumb`, Feder), gewählter Text `--lg-text-active`.
- **Startseite:** Eyebrow (Datum) + großer Titel, dann **Wochenkarte** (`.week-card`: Punkte, „Diese Woche: 2 von 3“, Serie), Mein Gym und die **Trainingstage** (`.day-card`: Name, Unterzeile, Übungen; läuft der Tag: Rahmen in `--lg-text-active` und „läuft gerade“ in der Unterzeile).
- **Listen-Einträge:** 64 px, Titel 17/600, Unterzeile 14 `--muted`, rechts Wert + Chevron (`--faint`).
- **Skeletons** (`.sk`) statt Spinner für alles, was aus der Cloud kommt; Schimmer nur per `transform`.
- **Leere Zustände:** kurze fette Zeile + ein Satz + eine Aktion.
- **Profilfoto (`.avatar`):** rund, 42/52/72/104 px; ohne Foto grauer Personen-Platzhalter (`.avatar-empty`).
- **Vergleichsbalken (`.cmp`):** Beschriftung „Du“/„@name“, Track `--surface-2`, Füllung per `scaleX`.
- **Toast:** unten über der Tab-Leiste, optional mit „Rückgängig“ (5 s).
- **Laufendes Training:** Die Seite steht fest (`body.wk-lock`) – kein vertikales Scrollen, nur seitliches Wischen zwischen den Übungskarten. Jede Karte füllt den freien Bereich bis zur Tab-Leiste bzw. zum Pausentimer; ist sie länger, scrollt nur sie (unten weich ausgeblendet). Nach dem Abhaken rollt die Karte zum nächsten offenen Satz. Weitere Aktionen (Übung hinzufügen, Plan bearbeiten, Verwerfen) im „⋯“-Menü der Kopfzeile neben „Beenden“.
- **Tab-Leiste:** vier Reiter – Training, Daily, Chat, Profil (Verlauf, Bibliothek und Kalorien-Tagebuch öffnen sich aus dem Profil; dabei bleibt der Reiter hervorgehoben, von dem man kam).
- **Daily (`#/daily`):** Streifen der letzten 7 Tage (`.dstrip`: Pillen, gewählter Tag in `--inv`, Punkt leer/halb/voll = Mealplan-Fortschritt), Karte **Gewicht** (Eingabe + „Speichern/Ändern“, Zeile „± seit …“, Diagramm), Karte **Mealplan** (`.meal-row`: runder Haken `--inv`, Name 17/650 – abgehakt durchgestrichen und gedämpft –, Uhrzeit · Beschreibung, Kalorien rechts; Fortschrittsbalken `.meter` und „3 / 5“). Bearbeiten auf `#/daily/plan` (Zeilen mit Hoch/Runter/Löschen), Neu/Ändern als Sheet.
- **Chat (`.chat`):** feststehende Seite (`body.chat-lock`) – nur die Nachrichtenliste scrollt, das Eingabefeld sitzt über der Tab-Leiste (mit Tastatur: Tab-Leiste und „Heute im Gym“ weg). Eigene Nachrichten rechts in der Akzentfläche (`--inv`), fremde links in `--surface-3` mit Avatar (32 px) und @Name; gruppiert innerhalb 5 min, Tagestrenner als Pille. Gym-Karte (`.plan`): 1,5-px-Umriss `--border-strong`, runder Kreis mit Hantel-Icon in `--inv`, Zeit als Titel, Teilnehmer als überlappende Avatare, ein Knopf „Ich komme mit“ (`primary`) bzw. „Ich komme doch nicht mit“ (`soft`). „Heute im Gym“ (`.chat-today`): Karte mit horizontal scrollenden Zeit-Kacheln. Fehlgeschlagene Nachrichten: gestrichelter Umriss, Warn-Icon, „Erneut senden“.
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
- Keine zusätzliche Akzentfarbe: aktiv ist weiß (dunkel) bzw. tiefblau (hell). Keine Farbverläufe in Text. Kein `backdrop-filter` auf Listeneinträgen in langen Listen. Kein Glas auf Glas – Karten liegen auf dem Hintergrund, nicht aufeinander.
- Rot/Rosé nie allein als Information: immer Warn-Icon oder Text dazu.
- Kein `transition: all`, kein `outline: none` ohne `:focus-visible`-Ersatz.
- Keine Texte unter 11 px (Ausnahme: Tab-Beschriftungen 10,5), keine Eingaben unter 16 px.
- Keine Modals für Dinge, die ein Sheet oder eine Inline-Aktion lösen.
- `--faint` nie für Text oder bedienbare Icons.
