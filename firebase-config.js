/* Firebase-Konfiguration für Konten & Cloud-Speicher
 *
 * Solange hier `null` steht, läuft die App ohne Konten (Daten nur auf dem Gerät).
 *
 * So bekommst du die Werte (Details in README.md):
 *   Firebase-Konsole → Projekteinstellungen (Zahnrad) → Allgemein → „Meine Apps“ → Web-App (</>)
 *   → Abschnitt „SDK-Einrichtung und -Konfiguration“ → „Konfiguration“ → das Objekt hier einfügen.
 *
 * Hinweis: Diese Werte sind nicht geheim und dürfen öffentlich (z. B. auf GitHub) liegen.
 * Geschützt werden die Daten durch die Firestore-Regeln (firestore.rules).
 */
window.GYM_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB1C_Irf9aMtpuBcLeQ-nJuEqG3Mx7uUis",
  authDomain: "gym-tracker-15439.firebaseapp.com",
  projectId: "gym-tracker-15439",
  storageBucket: "gym-tracker-15439.firebasestorage.app",
  messagingSenderId: "772272950544",
  appId: "1:772272950544:web:2c4b0af8dcacc41e642995",
  measurementId: "G-9B63QHL4JG"
};

/* Beispiel – so sieht es ausgefüllt aus:

window.GYM_FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "mein-gym-tracker.firebaseapp.com",
  projectId: "mein-gym-tracker",
  storageBucket: "mein-gym-tracker.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
};
*/
