/* Gym Tracker – Service Worker
 * - Cacht die App-Dateien, damit die App komplett offline läuft.
 * - Zeigt Benachrichtigungen für den Pausentimer (best effort: iOS pausiert
 *   Web-Apps im Hintergrund, Android/Desktop halten den Worker einige Minuten wach).
 */
'use strict';

// Bei jeder Änderung an den App-Dateien hochzählen, damit Nutzer die neue Version bekommen.
const CACHE = 'gym-tracker-v7';
const SDK_CACHE = 'gym-tracker-firebase-sdk';   // Firebase-Bibliothek (versionierte, unveränderliche URLs)
const SDK_PREFIX = 'https://www.gstatic.com/firebasejs/';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './cloud.js',
  './firebase-config.js',
  './manifest.json',
  './exercises.json',
  './vendor/zxing.min.js',
  './icons/icon.svg',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' → am Browser-Cache vorbei direkt vom Server laden (GitHub Pages cacht sonst bis zu 10 min)
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SDK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* "Stale while revalidate": Antwort sofort aus dem Cache (schnell & offline),
 * parallel wird die Datei im Hintergrund aktualisiert. Neue Versionen nach einem
 * Upload sind dadurch spätestens beim übernächsten Öffnen da. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Firebase-Bibliothek: einmal laden, danach aus dem Cache (damit Anmeldung/Abgleich auch nach Offline-Start klappt)
  if (req.url.startsWith(SDK_PREFIX)) {
    event.respondWith(caches.open(SDK_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Alles andere Fremde (z. B. Firebase-Server) nie cachen
  if (new URL(req.url).origin !== self.location.origin) return;

  // Seitenaufrufe (auch mit #/… oder ?…) bekommen immer die index.html
  const key = req.mode === 'navigate' ? './index.html' : req;

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});

/* ---------- Pausentimer-Benachrichtigung ---------- */

let pending = null; // { timeout, resolve }

function clearPending() {
  if (!pending) return;
  clearTimeout(pending.timeout);
  pending.resolve();
  pending = null;
}

async function showRestNotification(body) {
  // Ist die App sichtbar, übernimmt die Seite selbst (Ton + Banner).
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.some((c) => c.visibilityState === 'visible')) return;
  await self.registration.showNotification('Pause vorbei 💪', {
    body: body || 'Weiter geht’s mit dem nächsten Satz.',
    tag: 'rest-timer',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: [300, 150, 300, 150, 300],
  });
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'schedule-rest') {
    clearPending();
    const delay = Math.max(0, msg.endAt - Date.now());
    // waitUntil hält den Worker (so lange der Browser es erlaubt) am Leben.
    event.waitUntil(new Promise((resolve) => {
      pending = {
        resolve,
        timeout: setTimeout(() => {
          pending = null;
          showRestNotification(msg.body).finally(resolve);
        }, delay),
      };
    }));
  } else if (msg.type === 'cancel-rest') {
    clearPending();
  }
});

// Tipp auf die Benachrichtigung öffnet bzw. fokussiert die App.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./#/workout');
    })
  );
});
