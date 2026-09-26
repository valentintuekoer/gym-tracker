# Gym Tracker

Gym-Tracking-Web-App (PWA) für das iPhone: Trainingstage, Sätze, Satzpausen-Timer, Verlauf mit Graph –
wahlweise **mit Konto** (Daten in der Cloud, auf allen Geräten) oder **ohne Konto** (nur auf dem Gerät).
Reines HTML/CSS/JavaScript, kein Build-Schritt.

| Datei | Inhalt |
|---|---|
| `index.html`, `style.css`, `app.js` | die App |
| `DESIGN.md` | Designsystem (Farben, Typografie, Abstände, Glas, Bewegung, Regeln) – Vorlage für neue Bildschirme |
| `cloud.js` | Anbindung an Firebase (Konto, „Mit Apple anmelden“, Cloud-Speicher) |
| `social.js` | Freunde: Benutzername, Profilfoto, Anfragen, geteilte Kennzahlen |
| `firebase-config.js` | **hier trägst du dein Firebase-Projekt ein** |
| `firestore.rules`, `storage.rules` | Sicherheitsregeln für Datenbank und Profilfotos |
| `firebase.json` | Regeln-Dateien + Emulator-Einstellungen (für `firebase deploy` / Tests) |
| `service-worker.js`, `manifest.json`, `icons/` | Offline-Fähigkeit und Home-Bildschirm-App |
| `vendor/` | ZXing (Barcode-/QR-Scanner), qrcode-generator (QR-Code für Einladungen, MIT) |
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

Die [`firestore.rules`](firestore.rules) enthalten jetzt auch die Regeln für Freunde (Benutzernamen, Profile nur für
bestätigte Freunde lesbar, Anfragen nur für Absender/Empfänger). **Einmal neu veröffentlichen:** Firestore → *Regeln* →
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
Nie geteilt: einzelne Sätze, Gewichte pro Satz, Notizen, Pläne, Ernährung, Körpermaße, E-Mail.
Benutzername und Foto sind zusätzlich für angemeldete Nutzer in der Suche sichtbar.
Ohne Internet zeigt die App die zuletzt geladenen Freundesdaten mit „zuletzt aktualisiert am …“.

Speicherorte: `usernames/{name}`, `publicProfiles/{uid}`, `users/{uid}/friends/{fid}`, `requests/{von}_{an}`, Storage `avatars/{uid}.jpg`.

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
- Mit dem Firebase-Emulator (Java nötig): `cd tests/emulator && npm install`, dann
  `npm test` (Sicherheitsregeln + Freunde-Funktionen mit mehreren Nutzern) und
  `npm run test:ui` (die echte App in Chromium: ohne Konto, Registrierung, Profilfoto, Anfragen, Vergleich,
  Rangliste, offline, Freund entfernen, Abmelden, Konto löschen). Einmalig vorher `npx playwright install chromium`.
