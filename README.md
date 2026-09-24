# Gym Tracker

Gym-Tracking-Web-App (PWA) für das iPhone: Trainingstage, Sätze, Satzpausen-Timer, Verlauf mit Graph –
wahlweise **mit Konto** (Daten in der Cloud, auf allen Geräten) oder **ohne Konto** (nur auf dem Gerät).
Reines HTML/CSS/JavaScript, kein Build-Schritt.

| Datei | Inhalt |
|---|---|
| `index.html`, `style.css`, `app.js` | die App |
| `cloud.js` | Anbindung an Firebase (Konto + Cloud-Speicher) |
| `firebase-config.js` | **hier trägst du dein Firebase-Projekt ein** |
| `firestore.rules` | Sicherheitsregeln für die Datenbank |
| `service-worker.js`, `manifest.json`, `icons/` | Offline-Fähigkeit und Home-Bildschirm-App |
| `tests/` | automatische Tests (`node --test tests/core.test.js tests/sync.test.js`) |

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
2. *Einstellungen → Konto → Nutzer-ID* antippen – die ID wird kopiert (z. B. `qqBl3gZsjYxl8Cn83ClIKkavnDL3`).
3. In [`firestore.rules`](firestore.rules) die Zeile
   `request.auth.uid in ['ADMIN-NUTZER-ID-HIER-EINTRAGEN']` suchen und den Platzhalter durch deine ID ersetzen,
   z. B. `request.auth.uid in ['qqBl3gZsjYxl8Cn83ClIKkavnDL3']`. Mehrere Admins: `['ID1', 'ID2']`.
4. Firebase-Konsole → *Firestore Database → Regeln* → alles durch die geänderte Datei ersetzen → *Veröffentlichen*.
5. App neu öffnen → *Einstellungen → Verwaltung → Nutzer verwalten*.

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
3. In den *Einstellungen*: *Benachrichtigungen erlauben* und einmal *Ton testen*.

Auf weiteren Geräten (iPad, Laptop …) einfach mit derselben E-Mail anmelden – die Daten werden abgeglichen.

---

## Wie Konto & Speicherung funktionieren

- Die App arbeitet immer zuerst lokal – auch **offline im Gym**. Änderungen werden automatisch hochgeladen,
  sobald eine Verbindung besteht (Status in *Einstellungen → Konto*).
- Gespeichert wird pro Nutzer: `users/{uid}` (Trainingstage, Einstellungen, laufendes Training – jeweils einzeln
  abgeglichen), `users/{uid}/sessions/{id}` (jede abgeschlossene Einheit) und `users/{uid}/body/{id}` (Körpermessungen).
- Für die Nutzerverwaltung: `profiles/{uid}` (E-Mail, zuletzt aktiv) und `blocked/{uid}` (gesperrte Konten).
- Wer zuerst ohne Konto trainiert hat, wird beim ersten Anmelden gefragt, ob die Daten ins Konto übernommen werden sollen.
- *Abmelden* entfernt die Daten vom Gerät (sie bleiben im Konto). *Konto löschen* entfernt Konto und alle Cloud-Daten endgültig.
- *Passwort vergessen?* auf der Anmeldeseite schickt eine E-Mail zum Zurücksetzen.
