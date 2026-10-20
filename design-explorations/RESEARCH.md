# Recherche: Liquid Glass (Kurzfassung)

Diese Zusammenfassung bewertet nichts und empfiehlt keine Richtung. Sie hält fest, was Apple und andere Quellen sagen, damit
die zehn Varianten darauf aufbauen können.

**Quellenlage:** Apples Dokumentation (HIG, „Adopting Liquid Glass“, „Applying Liquid Glass to custom views“) und die
Vortragstexte von WWDC25 (219, 356) und WWDC26 (102) habe ich im Original gelesen. Dribbble, Mobbin, Behance, Medium und die
meisten Fachblogs waren aus der Arbeitsumgebung nicht erreichbar. Dazu liegen nur Suchergebnisse mit Titeln und Zusammenfassungen vor,
keine Bilder. Aussagen aus Drittquellen sind unten als solche gekennzeichnet.

## 1. Was Liquid Glass ist (Apple)

- **Eine eigene Ebene:** Liquid Glass bildet „eine eigene funktionale Ebene für Bedienelemente und Navigation“, die über dem Inhalt
  schwebt. Der Inhalt scrollt darunter durch. ([HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials))
- **Lichtbrechung (Lensing):** Das Hauptmerkmal ist, wie das Material Licht „biegt, formt und bündelt“, statt es nur zu streuen. So
  entsteht Abgrenzung zum Hintergrund, obwohl das Glas leicht und durchsichtig wirkt. Objekte erscheinen und verschwinden, indem
  die Lichtbrechung moduliert wird, nicht durch Ausblenden. ([WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/))
- **Glanzlichter und Schatten:** Lichtquellen erzeugen Glanzlichter, die der Geometrie und der Bewegung folgen. Der Schatten wird
  dunkler, wenn das Glas über Text liegt, und heller über hellem, einfarbigem Grund. ([WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/))
- **Anpassung:** Tönung und Dynamikumfang passen sich dem an, was dahinter liegt. Kleine Elemente (Tab-Leiste, Toolbar) können
  zwischen hell und dunkel wechseln, große (Menüs, Seitenleisten) wechseln nicht. Größeres Glas wirkt dicker, mit tieferen
  Schatten und stärkerer Brechung. ([WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/))
- **Berührung:** Das Glas „leuchtet von innen“, beginnend unter dem Finger, und biegt sich fließend. Bedienelemente wie Regler und
  Schalter werden erst bei Berührung zu Glas. ([WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/), [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials))
- **Form:** Kapseln und konzentrische Radien. Eine Kapsel hat den halben Höhen-Radius, ein innerer Radius ist der äußere minus
  der Abstand. ([WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/))

## 2. Regeln aus Apples Richtlinien

- **Nicht im Inhalt:** „Don’t use Liquid Glass in the content layer.“ Für Hintergründe und Inhalt gelten die Standard-Materialien.
  Ausnahme: kurzzeitig interaktive Elemente wie Regler und Schalter.
- **Sparsam:** Eigene Glas-Effekte nur für die wichtigsten Funktionselemente. Kein Glas auf Glas stapeln. Elemente auf Glas
  bekommen Füllung, Transparenz oder Vibrancy statt eines zweiten Glases.
- **Zwei Varianten, nie mischen:** *Regular* (weichzeichnend, passt Helligkeit an, lesbar über allem) und *Clear* (dauerhaft sehr
  transparent). Clear nur über medienreichem Grund, wenn eine Abdunklung dem Inhalt nicht schadet und der Inhalt darauf kräftig
  und hell ist. Über hellem Grund empfiehlt Apple eine dunkle Ebene mit etwa 35 % Deckkraft.
- **Farbe:** Glas hat von sich aus keine Farbe, es nimmt sie vom Inhalt dahinter. Getönt wird nur, was hervorgehoben werden soll
  (Hauptaktion), und zwar der Hintergrund, nicht Symbol oder Text. „Wenn alles getönt ist, fällt nichts mehr auf.“ Farbe gehört
  eher in die Inhaltsebene. Bei farbigem Inhalt: einfarbige Leisten oder ein deutlich abgesetzter Akzent.
- **Tab-Leiste:** Sie schwebt unten, Inhalt scheint hindurch. Wenige Tabs, kein Überlauf, Beschriftungen beibehalten, Tabs nie
  ausblenden oder deaktivieren. Sie kann beim Scrollen schrumpfen. Ein Such-Tab oder ein „prominenter“ Tab kann abgesetzt am
  hinteren Ende stehen. ([HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [WWDC26 269](https://developer.apple.com/videos/play/wwdc2026/269/))
- **Sheets:** Größerer Eckenradius, halbe Sheets sind vom Rand abgesetzt, damit Inhalt durchscheint. Beim Aufziehen auf volle Höhe
  werden sie deckender.
- **Rand und Lesbarkeit:** Scroll-Edge-Effekt: Inhalt unter Leisten wird weichgezeichnet und ausgeblendet. Keine eigenen
  Hintergründe auf Navigationselementen. Elemente nicht überlagern oder drängeln.
  ([Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass))

## 3. Technik

- **SwiftUI:** `glassEffect(_:in:)` (Standard: Regular in einer Kapsel), Varianten `.regular`, `.clear`, `.identity`, dazu
  `.tint(…)` und `.interactive()`. Mehrere Glas-Elemente gehören in einen `GlassEffectContainer`: bessere Leistung und die Formen
  verschmelzen, wenn sie nah beieinander liegen (der Abstand steuert, wann). `glassEffectUnion` und `glassEffectID` für
  Zusammenfassen und Morphing. ([Applying Liquid Glass to custom views](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views))
- **Web (HTML/CSS) nachbauen:** `backdrop-filter` mit Weichzeichnen und Sättigung allein ergibt nur Milchglas. Für die Lichtbrechung
  braucht es einen SVG-Filter mit `feDisplacementMap` und einer vorberechneten Verschiebungskarte (Randbereich gewölbt, Mitte
  neutral), zusätzlich ein Glanzlicht am Rand. Dieser Weg funktioniert nur in Chromium. Safari und Firefox ignorieren den
  `url()`-Teil, es bleibt dann das Weichzeichnen. `backdrop-filter` wirkt nur innerhalb des Elements, Apples Version bricht auch
  Inhalt außerhalb der Ränder. (Drittquellen: [Ekino](https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d), [LogRocket](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/), nur über die Suche gesehen.)
  Die Prototypen hier nutzen genau diesen Weg und eignen sich deshalb nur für die Ansicht in Chromium.

## 4. Typische Fehler und Barrierefreiheit

- **Lesbarkeit:** Kritiker nennen Benachrichtigungen und Text über hellem, kontrastreichem Grund, wo Verzerrung und Streulicht
  die Schrift schwächen. ([UX Collective](https://uxdesign.cc/liquid-glass-is-beautiful-but-is-the-chemistry-missing-00b4f79ff529), [Infinum](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/), nur über die Suche gesehen.)
- **Glas auf Glas, Glas im Inhalt, zu viele getönte Elemente:** die drei am häufigsten genannten Fehler (Apple, siehe oben; ebenso
  [Donny Wals](https://www.donnywals.com/designing-custom-ui-with-liquid-glass-on-ios-26/): Glas auf alle Listenzeilen wirke überladen).
- **Einstellungen:** Das System reagiert auf *Transparenz reduzieren* (Glas wird milchiger und deckender), *Kontrast erhöhen*
  (Ränder und stärkere Umrisse) und *Bewegung reduzieren*. Eigene Elemente brauchen eigene Rückfalllösungen. Apple verlangt
  Farben mit Hell-/Dunkel-Variante und einer Variante für erhöhten Kontrast und rät, Kontrast nach WCAG oder APCA zu prüfen.
  ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility))
- **Apples Nachbesserung (iOS 27, WWDC26):** Das Glas „diffundiert komplexen Inhalt dahinter besser“, bekommt einen
  abgedunkelten Rand mit helleren Glanzlichtern und einen Regler von „ultraklar“ bis „voll getönt“.
  Die Umgebungsvariable „show borders“ gibt es jetzt auch auf macOS. ([WWDC26 102](https://developer.apple.com/videos/play/wwdc2026/102/), [MacRumors](https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/), nur über die Suche gesehen.)

## 5. Dunkle Beispiele und Inspiration

- **Apple selbst** (laut Entwicklerleitfäden als Referenz empfohlen): Notizen, Wetter, Health, Fitness, Apple TV.
- **Drittanbieter:** Gentler Streak (Fitness, Daten stets sichtbar, Profil-Badge oben rechts, Aktivitätspfade im selben
  Glas-Finish) und The Outsiders (datenreiches Training). Apple zeigt außerdem eine Galerie umgestalteter Apps (u. a. Sky Guide,
  OmniFocus 4, Photoroom). ([iThinkDiff](https://www.ithinkdiff.com/entler-streak-ios-26-update-liquid-glass/), [BGR](https://bgr.com/1969287/best-ios-26-apps-updated-liquid-glass-design/), [9to5Mac](https://9to5mac.com/2025/11/06/apple-spotlights-third-party-apps-adopting-liquid-glass-in-ios-26-and-more/), nur über die Suche gesehen.)
- **Galerien:** Auf [Dribbble](https://dribbble.com/search/dark-fitness-app) und [Behance](https://www.behance.net/search/projects/liquidglass) gibt es viele dunkle Fitness-Dashboards
  und Nachbauten, die meisten sind Glas-Optik im Sinne von Glassmorphism und nicht Apples Material. [Mobbin](https://mobbin.com/explore/mobile/app-categories/health-fitness)
  führt echte Fitness-Apps. Bilder konnte ich nicht ansehen.

## 6. Folgen für die Prototypen

- Die Prototypen sind HTML/CSS mit `backdrop-filter` und SVG-Verschiebung. SwiftUI wäre näher am Original, ist hier aber nicht
  renderbar.
- Die Glas-Intensität reicht von „nur die Navigation ist Glas“ bis „auch Inhaltskacheln sind Glas“. Das weicht bewusst von Apples
  Regel „nicht im Inhalt“ ab, damit der Vergleich das ganze Spektrum zeigt. Regular und Clear werden innerhalb einer Variante nicht gemischt.
- Das Projekt-Designsystem (`DESIGN.md`) sieht für die App einen farblosen Akzent vor. Die Varianten haben unterschiedliche
  Akzentfarben, weil das der Auftrag war. Beibehalten wurden: echte Beispieldaten der App, `tabular-nums`, Tippflächen ab 44 px,
  Textkontrast ab 4,5 : 1 und ein festes Raster.
