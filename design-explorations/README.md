# Design-Richtungen · Liquid Glass auf Schwarz

Zehn Prototypen für denselben Inhalt (Training, Laufendes Training, Verlauf, Daily). Gemeinsam sind nur Schwarz als Grundfläche,
Liquid Glass für die schwebende Bedienebene und die Beispieldaten. Farbe, Glas-Stärke, Schrift, Layout, Kartenstil und Navigation
unterscheiden sich je Variante. **Es ist keine Richtung ausgewählt oder empfohlen; nichts davon ist in die App eingebaut.**

| Nr. | Name | Kurzidee |
|---|---|---|
| 01 | Obsidian | Ruhig und nahezu monochrom: Glas ist nur die Navigationsebene (Tab-Leiste, Knöpfe, Pausenleiste), der Inhalt besteht aus flachen dunklen Flächen mit Haarlinien und leichter Inter-Schrift. |
| 02 | Volt | Laut und sportlich: schmale Versalschrift, riesige Zahlen, Bento-Kacheln und eine einzige Signalfarbe (Limette). |
| 03 | Tiefsee | Fließend und klar: sehr transparentes Glas mit kräftiger Lichtbrechung vor türkisem Licht, runde Formen und ein Ring als Hauptmotiv. |
| 04 | Glut | Redaktionell und warm: Serifenschrift für Titel und Zahlen, nummerierte Einträge zwischen Haarlinien statt Karten. |
| 05 | Prisma | Präzise und optisch: ein feines Gitter als optische Bank, klares Glas mit starker Lichtbrechung und echten Farbsäumen, riesige leichte Zahlen und versetzte Glaspaneele. |
| 06 | Messwerk | Cockpit für Daten: Monospace-Zahlen, Tabellen, Sparklines und strenge Linien, dazu eckigeres Glas. |
| 07 | Quarz | Weich und sanft: milchiges Rosé-Glas mit viel Tönung und wenig Lichtbrechung, leichte Schrift, großzügige Abstände und runde Kiesel-Formen. |
| 08 | Zenit | Klar und kontraststark, nah am Systemlook: gruppierte Listen, kräftige Manrope-Schrift, extragroße Bedienelemente mit deutlichem Rand und Kobaltblau nur für die Hauptaktion. |
| 09 | Moos | Organisch und ruhig: gedämpftes Salbeigrün, feine Konturlinien wie auf einer Geländekarte und weiche Steinkarten. |
| 10 | Signal | Hart und eindeutig: Signalgelb auf tiefem Schwarz, fette Archivo, eckige Flächen und weiße Haarlinien statt Karten. |

Die Beschreibungen stehen in `variants.json`; je Variante gibt es ein Blatt unter `sheets/`.

## Ansehen

- `overview.png` / `overview.html` – alle zehn Varianten nebeneinander, je Reihe ein Screen (in der HTML-Version öffnet ein Klick den Prototyp).
- `sheets/NN-name.png` – ein Blatt je Variante: Name, Idee, vier Screens.
- `screens/NN-name/` – die vier Einzel-Screenshots (390 × 844 Punkte, doppelte Auflösung).
- `vNN-name/index.html` – der Prototyp selbst. Die Linsenbrechung des Glases nutzt `backdrop-filter: url(#svg)` und läuft nur in Chromium;
  in Safari und Firefox bleibt das Glas ohne Brechung (Unschärfe, Tönung, Rand und Glanz bleiben).
- `RESEARCH.md` – Zusammenfassung der Recherche (Apple HIG, WWDC25/26, technische Funktionsweise, Barrierefreiheit) mit Quellen.

## Glasstärke (ultraklar … voll getönt)

Apple bringt mit iOS 27 einen Regler für die Glasstärke. Die Prototypen haben dafür einen Regler von 0 (ultraklar: kaum Tönung, wenig Weichzeichnung)
bis 100 (voll getönt: deckende dunkle Fläche im Farbton der Variante); 50 ist der Stand der Variante, wie in den ersten Blättern.
Akzentfarbene Knöpfe bleiben Akzent. Apple nennt keine Zahlen, die Kurven sind Näherungen.

- `glass-strength/sheets/NN-name.png` – je Variante Training, Laufendes Training und eine Glasprobe in fünf Stufen (0, 25, 50, 75, 100).
- `glass-strength/overview.png` – Laufendes Training, je Reihe eine Stufe, alle zehn Varianten nebeneinander.
- `glass-strength/probe-overview.png` – Glasprobe auf buntem, kontrastreichem Grund: je Zeile eine Variante, je Spalte eine Stufe.
  In den App-Screens liegt hinter dem Glas fast nur Schwarz, dort sieht man die Stufen schwach; die Probe zeigt sie deutlich.
- Live wählen: `vNN-name/index.html?ui=1` blendet oben einen Regler ein; `?glass=0…100` setzt die Stärke direkt. Dasselbe gilt für `glass-strength/probe.html?v=v03-tiefsee&a=%2319d3c5`.

## Neu erzeugen

```sh
cd tests/emulator && npm install      # einmalig: installiert Playwright
node design-explorations/build/shoot.mjs            # alles
node design-explorations/build/shoot.mjs v03        # nur Varianten, deren Ordner so beginnt
SCALE=1 node design-explorations/build/shoot.mjs    # kleinere Bilder
node design-explorations/build/shoot-strength.mjs   # Glasstärke: Einzelbilder, Blätter, Übersichten (dauert gut zwei Minuten)
```

## Aufbau

- `shared/glass.js` + `shared/base.css` – das Glas-Material (Linse per SVG-Verschiebung, Weichzeichner, Tönung, Randlicht, Glanz).
  Der Weichzeichner ist bei 14 px gedeckelt, weil der Renderer der Screenshot-Umgebung darüber keinen Blur mehr liefert.
- `shared/charts.js`, `shared/icons.js` (Lucide), `shared/phone.js` (Statusleiste, Home-Indikator), `fonts/` – gemeinsame Bausteine.
- Jede Variante hat nur `index.html` (Inhalt) und `style.css` (alles Gestalterische).

Die Prototypen sind Bilder von Oberflächen, kein App-Code: Sie sind nicht mit `app.js` verbunden.
