# Gym Tracker

Gym-Tracking-Web-App (PWA) für das iPhone: Trainingstage, Sätze, Satzpausen-Timer, Verlauf mit Graph –
wahlweise **mit Konto** (Daten in der Cloud, auf allen Geräten) oder **ohne Konto** (nur auf dem Gerät).
Reines HTML/CSS/JavaScript, kein Build-Schritt.

| Datei | Inhalt |
|---|---|
| `index.html`, `style.css`, `app.js` | die App |
| `DESIGN.md` | Designsystem „Liquid Glass“ (Farben, Typografie, Abstände, Glas, Bewegung, Regeln) – Vorlage für neue Bildschirme |
| `cloud.js` | Anbindung an Firebase (Konto, „Mit Apple anmelden“, Cloud-Speicher) |
| `social.js` | Freunde: Benutzername, Profilfoto, Anfragen, geteilte Kennzahlen |
| `firebase-config.js` | **hier trägst du dein Firebase-Projekt ein** |
| `firestore.rules`, `storage.rules` | Sicherheitsregeln für Datenbank und Profilfotos |
| `firebase.json` | Regeln-Dateien + Emulator-Einstellungen (für `firebase deploy` / Tests) |
| `service-worker.js`, `manifest.json`, `icons/` | Offline-Fähigkeit und Home-Bildschirm-App |
| `vendor/` | ZXing (QR-Scanner für Freunde), qrcode-generator (QR-Code für Einladungen, MIT) |
| `tests/` | automatische Tests (`node --test tests/*.test.js`) |
| `tests/emulator/` | Tests gegen den Firebase-Emulator: Regeln, Freunde, App im Browser (siehe unten) |

---

## 1. Konten einrichten (Firebase, kostenlos, ca. 10 Minuten)

Ohne diesen Schritt funktioniert die App trotzdem – dann eben ohne Konto.

1. **Projekt anlegen:** <https://console.firebase.google.com> → mit Google-Konto anmelden →
   *Projekt hinzufügen* → Name z. B. `gym-tracker` → Google Analytics kannst du ausschalten → *Projekt erstellen*.
2. **Anmeldung per E-Mail aktivieren:** links *Build/Erstellen → Authentication* → *Jetzt starten* →
   Reiter *Anmeldemethode (Sign-in method)* → *E-Mail-Adresse/Passwort* → aktivieren → *Speichern*.
3. **Datenbank anlegen:** *Build/Erstellen → Firestore Database* → *Datenbank erstellen* →
   Standort z. B. `europe-west3 (Frankfurt)` → *Im Produktionsmodus starten* → *Erstellen*.
4. **Sicherheitsregeln setzen:** in Firestore den Reiter *Regeln* öffnen, alles ersetzen durch den Inhalt
   von [`firestore.rules`](firestore.rules) → *Veröffentlichen*.
   (Damit kann jeder Nutzer nur seine eigenen Daten lesen und schreiben.)
5. **Web-App registrieren:** Zahnrad oben links → *Projekteinstellungen* → unten bei *Meine Apps* auf `</>` (Web) →
   Name z. B. `Gym Tracker` → *App registrieren* (Firebase Hosting **nicht** nötig).
   Es erscheint ein Code-Block mit `const firebaseConfig = { apiKey: ..., ... }`.
6. **Konfiguration eintragen:** öffne `firebase-config.js` und ersetze
   `window.GYM_FIREBASE_CONFIG = null;` durch die Werte aus Schritt 5, z. B.:

   ```js
   window.GYM_FIREBASE_CONFIG = {
     apiKey: "AIzaSy...",
     authDomain: "gym-tracker-1234.firebaseapp.com",
     projectId: "gym-tracker-1234",
     storageBucket: "gym-tracker-1234.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456",
   };
   ```

   Diese Werte sind **kein Geheimnis** und dürfen öffentlich auf GitHub liegen – geschützt wird alles durch
   die Regeln aus Schritt 4.
7. **Deine Web-Adresse freigeben** (nachdem du die App gehostet hast, siehe unten):
   *Authentication → Einstellungen (Settings) → Autorisierte Domains → Domain hinzufügen* →
   z. B. `deinname.github.io` oder `dein-name.netlify.app`.

Der kostenlose „Spark“-Tarif reicht für private Nutzung bei Weitem (u. a. 50 000 Lese- und 20 000
Schreibvorgänge pro Tag).

### 1b. Freunde: Profilfotos in Cloud Storage (optional)

Benutzername, Freunde, Vergleich und Rangliste brauchen nur Firestore (Schritt 1). Für Profilfotos gibt es zwei Wege:

- **Ohne Cloud Storage (kostenlos, nichts zu tun):** Das Foto wird auf dem iPhone auf 256 × 256 Pixel verkleinert
  (~15–25 KB) und direkt im Profil in Firestore gespeichert. Das passiert automatisch, wenn Storage nicht eingerichtet ist.
- **Mit Cloud Storage (bessere Qualität, 512 × 512):** Firebase verlangt für neue Storage-Buckets inzwischen den
  **Blaze-Tarif** (mit Zahlungsmittel; die kostenlosen Kontingente – 5 GB Speicher, 1 GB Download/Tag – gelten weiter,
  für ein paar Profilfotos fallen praktisch keine Kosten an. Tipp: in der Google-Cloud-Konsole ein Budget-Limit/Benachrichtigung setzen).
  1. *Build/Erstellen → Storage* → *Jetzt starten* → gleicher Standort wie Firestore → *Im Produktionsmodus starten*.
  2. Reiter *Regeln* → alles ersetzen durch den Inhalt von [`storage.rules`](storage.rules) → *Veröffentlichen*.
  3. In `firebase-config.js` muss `storageBucket` eingetragen sein (steht schon drin).

### 1c. „Mit Apple anmelden“ (optional, braucht ein Apple-Developer-Konto)

Ohne diese Einrichtung erscheint beim Tippen auf „Mit Apple anmelden“ ein Hinweis – E-Mail + Passwort funktioniert immer.

1. **Apple Developer** (<https://developer.apple.com/account>, kostenpflichtige Mitgliedschaft 99 €/Jahr):
   - *Certificates, IDs & Profiles → Identifiers → +* → **App IDs** → z. B. `de.deinname.gym` mit Häkchen bei *Sign In with Apple*.
   - Nochmal *+* → **Services IDs** → z. B. `de.deinname.gym.web` → *Sign In with Apple* aktivieren → *Configure*:
     Primary App ID = die App-ID von oben; **Domains:** `DEIN-PROJEKT.firebaseapp.com`;
     **Return URL:** `https://DEIN-PROJEKT.firebaseapp.com/__/auth/handler` (steht auch in der Firebase-Konsole, s. u.).
   - *Keys → +* → *Sign In with Apple* aktivieren → Key herunterladen (`.p8`), **Key ID** und deine **Team ID** notieren.
2. **Firebase-Konsole:** *Authentication → Anmeldemethode → Neuer Anbieter → Apple* → aktivieren →
   Services ID, Team ID, Key ID und den Inhalt der `.p8`-Datei eintragen → *Speichern*.
3. Deine App-Domain muss unter *Authentication → Einstellungen → Autorisierte Domains* stehen (Schritt 1.7).

### 1d. Sicherheitsregeln (wichtig nach diesem Update)

Die [`firestore.rules`](firestore.rules) enthalten die Regeln für Freunde (Benutzernamen, Profile nur für
bestätigte Freunde lesbar, Anfragen nur für Absender/Empfänger) und für den **Chat** (Nachrichten, Gym-Karten,
Rate Limit, Meldungen). **Nach jedem Update mit neuen Regeln neu veröffentlichen:** Firestore → *Regeln* →
alles ersetzen → Administrator-ID wieder eintragen (siehe unten) → *Veröffentlichen*.
Alternativ mit der Firebase-CLI: `firebase deploy --only firestore:rules,storage`.

---

## 2. Kostenlos hosten

**GitHub Pages**
1. Auf <https://github.com> ein neues, öffentliches Repository anlegen (z. B. `gym`).
2. *uploading an existing file* → alle Dateien und Ordner dieses Projekts hineinziehen → *Commit changes*.
3. *Settings → Pages → Source: Deploy from a branch → Branch `main`, Ordner `/ (root)` → Save*.
4. Nach ca. 1 Minute: `https://DEINNAME.github.io/gym/` – diese Domain (`DEINNAME.github.io`) in Firebase freigeben (Schritt 1.7).

**Netlify (ohne Git)**
1. <https://app.netlify.com/drop> öffnen, kostenlos anmelden.
2. Den ganzen Projektordner auf die Seite ziehen → du bekommst `https://…netlify.app`.
3. Diese Domain in Firebase freigeben (Schritt 1.7). Für Updates den Ordner erneut hochladen.

Nach einem Update lädt die App die neue Version im Hintergrund – spätestens beim zweiten Öffnen ist sie aktiv.

---

## Administrator einrichten (Nutzerverwaltung)

Als Administrator siehst du alle Konten und kannst sie **sperren, entsperren, ihre Daten löschen oder das Konto
entfernen**. Wer Administrator ist, steht in den Sicherheitsregeln – die prüft der Server, nicht die App.

1. In der App mit **deinem** Konto anmelden (bzw. registrieren).
2. *Profil → Einstellungen → Konto → Nutzer-ID* antippen – die ID wird kopiert (z. B. `qqBl3gZsjYxl8Cn83ClIKkavnDL3`).
3. In [`firestore.rules`](firestore.rules) die Zeile
   `request.auth.uid in ['ADMIN-NUTZER-ID-HIER-EINTRAGEN']` suchen und den Platzhalter durch deine ID ersetzen,
   z. B. `request.auth.uid in ['qqBl3gZsjYxl8Cn83ClIKkavnDL3']`. Mehrere Admins: `['ID1', 'ID2']`.
4. Firebase-Konsole → *Firestore Database → Regeln* → alles durch die geänderte Datei ersetzen → *Veröffentlichen*.
5. App neu öffnen → *Profil → Einstellungen → Nutzerverwaltung*.

Gut zu wissen:
- Nutzer erscheinen in der Liste, sobald sie die App (in dieser Version) einmal geöffnet haben.
- **Sperren** wirkt sofort: Der Nutzer wird abgemeldet, sieht den Grund und kommt nicht mehr an seine Daten.
- **Konto entfernen** löscht alle Daten und sperrt dauerhaft. Das Login selbst (E-Mail + Passwort) kann eine
  Web-App ohne eigenen Server nicht löschen – das geht kostenlos in der Firebase-Konsole unter
  *Authentication → Nutzer* (dort kannst du Konten auch deaktivieren).

---

## 3. Auf dem iPhone installieren

1. Adresse in **Safari** öffnen → *Teilen* → *Zum Home-Bildschirm* → *Hinzufügen*.
2. App über das neue Icon starten → **Konto erstellen** (oder *Ohne Konto fortfahren*).
3. *Profil → Einstellungen*: *Benachrichtigungen erlauben* und einmal *Ton testen*.

Auf weiteren Geräten (iPad, Laptop …) einfach mit demselben Konto anmelden – die Daten werden abgeglichen.

Gut zu wissen auf dem iPhone:
- **Home-Bildschirm-App und Safari haben getrennte Speicher.** Wer die App im Browser ausprobiert und danach vom
  Home-Bildschirm startet, muss sich dort neu anmelden (bzw. ohne Konto neu anfangen).
- **Profilfoto:** „Kamera“ öffnet direkt die Frontkamera, „Foto wählen“ die Mediathek (iOS fragt beim ersten Mal nach
  der Berechtigung). HEIC-Fotos wandelt iOS automatisch um; die App verkleinert vor dem Hochladen.
- **QR-Code scannen:** entweder in der App (*Freund hinzufügen → Scannen*, braucht Kamerazugriff) oder mit der
  normalen iPhone-Kamera – der Link öffnet dann Safari; wer die App als Home-Bildschirm-App nutzt, kann stattdessen
  den Link kopieren und in der App unter *Freund hinzufügen* nach dem Benutzernamen suchen.
- **„Mit Apple anmelden“** öffnet ein kleines Anmeldefenster. Falls es blockiert wird, noch einmal tippen.

## Freunde & Vergleich

*Profil*-Reiter → Benutzername + Foto festlegen → *Freund hinzufügen* (Suche nach Benutzernamen, Einladungslink oder
QR-Code) → der Freund nimmt unter *Anfragen* an → Freund antippen = Vergleich, außerdem *Rangliste*.

Was geteilt wird (nur mit bestätigten Freunden): Benutzername, Foto, Einheiten pro Tag, Wochen-Serie, Gesamtzahl,
Volumen pro Tag sowie – abschaltbar – Rekorde bei Übungen aus der Bibliothek (über die feste Übungs-ID vergleichbar).
Nie geteilt: einzelne Sätze, Gewichte pro Satz, Notizen, Pläne, Mealplan, Körpermaße, E-Mail.
Benutzername und Foto sind zusätzlich für angemeldete Nutzer in der Suche sichtbar.
Ohne Internet zeigt die App die zuletzt geladenen Freundesdaten mit „zuletzt aktualisiert am …“.

Speicherorte: `usernames/{name}`, `publicProfiles/{uid}`, `users/{uid}/friends/{fid}`, `requests/{von}_{an}`, Storage `avatars/{uid}.jpg`.

## Erscheinungsbild „Liquid Glass“

Dunkel (Standard): tiefes Schwarz mit feinem Raster, darauf klares Liquid Glass aus fünf Schichten (Glanz, Lichtkante,
Schatten; Unschärfe und Tönung folgen dem Regler, Vorgabe „ultraklar“), Akzent Blau `#0061fe` nur für Hauptaktion und Zustände,
Nunito als Fließtextschrift (lokal eingebunden, läuft offline), Überschriften in der Systemschrift, kompakte Karten mit
24 px Radius und eine Tab-Leiste nur mit Symbolen. Hell: blauer Verlauf mit drei Farbflecken wie in der [Liquid-Glass-Demo](#liquid-glass-demo),
tiefblauer Akzent. Die Auswahl stammt aus dem Design-Builder; es ist nur das Aussehen – Inhalte und Aufbau der Bildschirme sind
unverändert. Die schwebende Tab-Leiste lässt sich mit dem Finger über die Reiter ziehen. Wie in iOS 27 reagiert Glas auf
Berührung (es hebt sich, federt, leuchtet unter dem Finger auf und breitet das Licht auf nahes Glas aus), Sheets und Dialoge wachsen aus
dem gedrückten Knopf, und unter Einstellungen → Darstellung gibt es den Regler „Klar ↔ Getönt“ (Quellen und Näherungen:
[`DESIGN.md`](DESIGN.md#liquid-glass-wie-in-ios-27)). Farben, Radien und Regeln
stehen in [`DESIGN.md`](DESIGN.md); alle Werte sind Tokens am Anfang von `style.css` (Dunkel und Hell getrennt, Textkontrast
≥ 4,5:1 per Pixel gegen den echten Hintergrund geprüft, bei Reglerstellung 0, 50 und 100). Neue Bildschirme prüfst du mit `node scripts/screenshots.mjs` (Bilder, hell + dunkel)
und `node scripts/contrast-pixels.mjs` (Textkontrast jedes sichtbaren Textes gegen den echten Hintergrund).

## Liquid-Glass-Demo

Eigenständige Demo für ein Glas-Material im Apple-Stil mit schwebender Tab-Leiste, Feder-Physik („Liquid Stretch“) und
Richtungs-Übergängen – als Web Components ohne Framework. Ohne Einfluss auf die App.
Öffnen: [`liquid-glass/liquid-glass-demo.html`](liquid-glass/liquid-glass-demo.html) (eine Datei, Doppelklick genügt) bzw.
nach dem Veröffentlichen `…/liquid-glass/index.html`. Doku: [`liquid-glass/README.md`](liquid-glass/README.md).

## Daily: Gewicht & Mealplan

Die Tab-Leiste hat vier Reiter: **Training**, **Daily**, **Chat**, **Profil**. *Verlauf* und *Bibliothek* haben keinen
eigenen Reiter mehr, sondern öffnen sich im **Profil**. Ein Kalorien-Tagebuch gibt es nicht mehr (der Mealplan in *Daily* ersetzt es);
Daten, die du früher dort eingetragen hast, werden nicht mehr angezeigt und nicht mehr abgeglichen – ältere Backups lassen sich weiterhin importieren.

*Daily* gilt für jeden Tag:

- **Gewicht** eintragen (Komma oder Punkt, 20–500 kg). Es ist dieselbe Messung wie unter *Profil → Verlauf → Körper*:
  am selben Tag ändert ein neuer Wert die Messung, statt eine zweite anzulegen. Darunter „± seit …“ und der Verlauf der letzten 30 Messungen.
- **Mealplan**: einmal anlegen (Name, Uhrzeit, Beschreibung, Kalorien – alles außer dem Namen optional; bis zu 20 Mahlzeiten,
  Reihenfolge änderbar, auf Wunsch mit einem Beispielplan als Start). Jeden Tag hakst du die Mahlzeiten ab – Fortschritt
  („3 / 5“, Kalorien) und Streifen der letzten 7 Tage zeigen, wie viel geschafft ist. Über den Streifen kannst du
  einen der letzten 6 Tage nachtragen.
- Mealplan und Abhak-Verlauf liegen bei den Einstellungen und werden wie diese mit dem Konto abgeglichen – ohne neue
  Cloud-Felder, die Firestore-Regeln bleiben unverändert. Sie werden nie mit Freunden geteilt.

## Mitglieder-Chat

Der Reiter **Chat** (nur mit Konto und Profil) ist eine Liste: oben der **Gym-Chat** (ein gemeinsamer Raum für alle Mitglieder, um sich
fürs Training zu verabreden), darunter deine **Gruppen** und deine **Kontakte** (= bestätigte Freunde).

- **Gruppen:** oben rechts **+** („Neue Gruppe“): Name (bis 40 Zeichen) und Freunde auswählen. Es lassen sich nur Freunde einladen
  (die Regeln prüfen es); bis zu 30 Mitglieder. Die Gruppe hat dieselben Funktionen wie der Gym-Chat – Nachrichten, „Ich gehe ins Gym“-Karten,
  „Heute im Gym“ der Gruppe. Über das Personen-Symbol in der Kopfzeile: Mitglieder ansehen, als Besitzer **hinzufügen / entfernen /
  umbenennen / löschen**, als Mitglied **verlassen**. In der Liste zeigen ein Punkt und fette Schrift Ungelesenes, darunter die letzte Nachricht.
- **Kontakte:** jeder Freund steht in der Liste – antippen öffnet eine **Direktnachricht** (entsteht beim ersten Senden).
- **Profilbilder ohne Foto:** der **große Anfangsbuchstabe** auf einem Farbhintergrund (die Farbe ergibt sich aus dem Namen, immer dieselbe pro Person).

- **Nachrichten** in Echtzeit; eigene rechts, fremde links mit Name und Foto, Uhrzeit in **Wiener Zeit, 24 h**.
- **„Ich gehe ins Gym“**: Datum, Uhrzeit, optional Push / Pull / Legs / Oberkörper / Unterkörper / Ganzkörper / Cardio / Sonstiges
  und eine Notiz → hervorgehobene Karte. Andere tippen **„Ich komme mit“**; die Teilnehmer stehen auf der Karte.
- Oben **„Heute im Gym“**: alle geplanten Besuche des Tages auf einen Blick (antippen = Details).
- Eigene Nachrichten und Karten bearbeiten bzw. löschen (Nachricht antippen). Bei fremden: **Melden** oder **Blockieren**
  (Liste unter *Einstellungen → Chat*, dort wieder entsperren).
- Verlauf wird gespeichert und beim Hochscrollen seitenweise nachgeladen. Neue Nachrichten scrollen automatisch mit;
  liest du weiter oben, erscheint „Neue Nachrichten“. Ungelesenes zeigt ein Punkt am Reiter.
- Fehler sichtbar: offline oder fehlgeschlagen → „Nicht gesendet“ mit **Erneut senden** / **Verwerfen**.
- Hinweis bei neuen Gym-Karten (*Einstellungen → Chat*, abschaltbar): als Meldung in der App bzw., wenn die App im Hintergrund
  noch läuft und Benachrichtigungen erlaubt sind, als Mitteilung. **Echte Push-Nachrichten bei geschlossener App gibt es nicht** –
  dafür braucht es einen Server-Dienst (Firebase Cloud Messaging mit Cloud Functions, kostenpflichtiger Blaze-Tarif).

**Einrichtung:** nur die neuen [`firestore.rules`](firestore.rules) veröffentlichen (siehe 1d) – **für Gruppen und Direktnachrichten erneut**
(neue Regeln für `groups`). Bis dahin zeigt die Chat-Liste bei den Gruppen „noch nicht freigeschaltet“ mit dem Knopf „So schaltest du sie frei“.
Keine Umgebungsvariablen, keine Migration, keine zusätzlichen Indizes.

**Zeigt der Chat „permission-denied“** (oder „Nicht gesendet – keine Berechtigung“)? Dann kennt Firebase die Chat-Regeln noch nicht.
Die App erklärt es selbst: Im Chat auf **„So schaltest du ihn frei“** (bzw. bei einer fehlgeschlagenen Nachricht auf **„Was tun?“**)
tippen → **„Regeln kopieren“** (deine Nutzer-ID steht dann schon als Administrator drin) → **„Firebase-Regeln öffnen“**, den Text dort
ersetzen und **Veröffentlichen** → zurück in die App → **„Erneut versuchen“**. Veröffentlichen kann nur der Besitzer des Firebase-Projekts.

**Schutz vor Missbrauch (erzwingen die Sicherheitsregeln, nicht nur die App):** nur Mitglieder mit Profil lesen und schreiben;
der Absendername kommt aus dem Profil (keine Fremdnamen); Text höchstens 500 Zeichen, Notiz 120; eine Nachricht alle 2 s,
eine Gym-Karte pro Minute; Start höchstens 1 h in der Vergangenheit und 60 Tage voraus; bearbeiten/löschen nur der Autor;
Mitkommen trägt nur den eigenen Namen ein. Gesperrte Konten (Nutzerverwaltung) können nicht mehr lesen oder schreiben.

**Moderation:** Meldungen landen in Firestore unter `reports` (nur Administratoren lesbar): Firebase-Konsole → Firestore → `reports`.
Dort steht, wer was gemeldet hat; die Nachricht löschst du unter `rooms/gym/messages/<id>`, den Nutzer sperrst du in der Nutzerverwaltung.

**Datenmodell Gruppen:** `groups/{id}` mit `kind` (`group` | `dm`), `name`, `owner`, `memberIds`, `memberNames`, `lastAt/lastText/lastName/lastUid`
und `groups/{id}/messages/{id}` (gleiches Format wie `rooms/gym/messages`). Ein Direktchat hat die feste ID `dm_<kleinere uid>_<größere uid>`.
Die Regeln erzwingen: Mitglieder lesen/schreiben; nur der Besitzer lädt ein (je einen Freund, der ihn selbst als Freund hat, mit dem echten
Benutzernamen); Mitglieder dürfen gehen, der Besitzer nicht (er löscht die Gruppe); „letzte Nachricht“ lässt sich nicht fälschen.
Das Rate Limit (2 s / Karte 1 min) gilt über alle Räume zusammen.

**Weitere Räume (z. B. pro Standort):** Der Raum `gym` gibt es immer. Für einen weiteren in der Firebase-Konsole unter `rooms`
ein Dokument mit dem Raumnamen als ID anlegen (a–z, 0–9, Bindestrich, z. B. `wien-mitte`) – die Regeln und Datenstruktur
(`rooms/{raum}/messages`) sind darauf vorbereitet. Die Oberfläche zeigt diese Admin-Räume bisher nicht (nur `gym`, Gruppen und Direktchats).

**Datenschutz:** Nachrichten und Karten sehen alle Mitglieder mit Profil (Benutzername und Foto, keine E-Mail, keine Trainingsdaten).
Beim Löschen des Kontos werden eigene Nachrichten, Karten und Teilnahmen entfernt.

## Musik läuft weiter

Die App pausiert deine Musik (Spotify, Apple Musik, Podcasts …) nicht: Der Signalton am Ende der Pause wird als
„Mischton“ abgespielt (iOS 16.4 oder neuer) und der Audiokanal erst geöffnet, wenn tatsächlich eine Pause läuft.
Der Ton folgt dabei dem Lautlos-Schalter. Nur die Option *Ton trotz Lautlos-Schalter* (Einstellungen) kann Musik
kurz unterbrechen – sie ist standardmäßig aus.

## Aufwärmsätze

Im Training unter jeder Übung: *Aufwärmen* → Arbeitsgewicht eingeben (ist meist schon vorausgefüllt) → die App
schlägt steigende Sätze vor: leere Stange × 10 (bei Langhantel-Übungen, abschaltbar), dann ca. 40 % × 5,
60 % × 3 und 80 % × 2 – gerundet auf deinen Gewichtsschritt. *Einfügen* setzt sie als **A1, A2 …** vor die
Arbeitssätze; *Leeren Aufwärmsatz hinzufügen* geht auch. Aufwärmsätze zählen nicht zu Sätzen, Volumen, Rekorden,
dem Steigerungsvorschlag oder der Freunde-Statistik und haben nur 1 min Pause. Gespeichert werden nur abgehakte;
beim nächsten Training stehen sie mit den Werten vom letzten Mal wieder da.

## Mein Gym & Route

*Training*-Reiter → *Mein Gym festlegen* (auch unter *Einstellungen → Training*): Name, Adresse und/oder
„Aktuellen Standort verwenden“ (am besten einmal im Gym tippen). Danach öffnet *Route* die Karten-App
(Apple Karten oder Google Maps, wählbar) mit der schnellsten Verbindung ab deinem Standort – Auto, zu Fuß,
öffentliche Verkehrsmittel oder Fahrrad, inklusive aktueller Verkehrslage. Die Route berechnet die Karten-App;
die App selbst braucht dafür keinen Kartendienst und keinen API-Schlüssel. Das Gym wird nur in deinen eigenen
Daten gespeichert und nie mit Freunden geteilt.

---

## Wie Konto & Speicherung funktionieren

- Die App arbeitet immer zuerst lokal – auch **offline im Gym**. Änderungen werden automatisch hochgeladen,
  sobald eine Verbindung besteht (Status in *Profil → Einstellungen → Konto*).
- Gespeichert wird pro Nutzer: `users/{uid}` (Trainingstage, Einstellungen, laufendes Training – jeweils einzeln
  abgeglichen), `users/{uid}/sessions/{id}` (jede abgeschlossene Einheit) und `users/{uid}/body/{id}` (Körpermessungen).
- Für die Nutzerverwaltung: `profiles/{uid}` (E-Mail, zuletzt aktiv) und `blocked/{uid}` (gesperrte Konten).
- Wer zuerst ohne Konto trainiert hat, wird beim ersten Anmelden gefragt, ob die Daten ins Konto übernommen werden sollen.
- *Abmelden*: Die Trainingsdaten bleiben auf dem Gerät (als Daten „ohne Konto“) und im Konto; nur die
  zwischengespeicherten Freundesdaten werden vom Gerät entfernt. Meldest du dich wieder mit demselben Konto an,
  wird ohne Rückfrage weiter abgeglichen.
- *Konto löschen* (Einstellungen → Konto) entfernt Konto, Profil, Benutzername, Foto, Freundschaften, Anfragen,
  geteilte Kennzahlen und alle Cloud-Daten endgültig. Die Trainingsdaten auf dem Gerät bleiben erhalten.
- Export/Import (Einstellungen → Datensicherung) funktioniert immer, mit und ohne Konto.
- *Passwort vergessen?* auf der Anmeldeseite schickt eine E-Mail zum Zurücksetzen.

## Tests

- Logik (ohne Browser, ohne Firebase): `node --test tests/*.test.js`
- Liquid-Glass-Demo (eigenständig, siehe [`liquid-glass/`](liquid-glass/README.md)): `node --test tests/liquid-glass.test.mjs`
  (Logik, auch Regler-Tokens der App) und `node --test tests/liquid-glass.ui.mjs` (Chromium)
- Liquid Glass der App wie in iOS 27 (Berührung, Tab-Linse, Wischen, Sheet-Morph, Regler; Chromium, ohne Emulator):
  `node --test tests/glass-touch.ui.mjs`
- Mit dem Firebase-Emulator (Java nötig): `cd tests/emulator && npm install`, dann
  `npm test` (Sicherheitsregeln + Freunde-, Chat- und Gruppen-Funktionen mit mehreren Nutzern) und
  `npm run test:ui` (die echte App in Chromium: ohne Konto, Registrierung, Profilfoto, Anfragen, Vergleich,
  Rangliste, offline, Freund entfernen, Abmelden, Konto löschen sowie der Chat und die Gruppen/Direktnachrichten mit zwei Geräten: Echtzeit,
  Gym-Karte, mitkommen, Fehler mit Erneut-Senden, melden/blockieren, Nachladen, Wiener Zeit).
  Screenshots des Chats: `CHAT_SHOTS=/pfad npm run test:ui`. Einmalig vorher `npx playwright install chromium`.
  Dazu gehören auch die Anmeldeseite (Fehlermeldungen, „Passwort vergessen?“) und ein Layout-Test mit extrem langen Namen und Notizen.
- Von Hand ausprobieren mit **Playwright MCP** (steht in `.mcp.json`, startet headless): Emulatoren mit
  `cd tests/emulator && npx firebase emulators:start --project demo-gym --config ../../firebase.json` starten, die App von einem
  kleinen Webserver ausliefern und `firebase-config.js` auf den Emulator zeigen lassen (`useEmulator: true`, siehe `tests/emulator/ui.test.mjs`).
  Das Firebase-SDK lädt die App von `gstatic.com`; ist das gesperrt, im Browser per `page.route` auf `tests/emulator/node_modules/firebase` umleiten.
  In einer Umgebung als root braucht Chromium `--no-sandbox`, und Playwright MCP sucht standardmäßig Chrome unter `/opt/google/chrome/chrome`.
