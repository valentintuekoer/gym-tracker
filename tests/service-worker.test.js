// Service Worker ohne Browser prüfen: Push-Nachrichten werden zu sichtbaren Mitteilungen, ein Tipp öffnet den Chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Objekte aus dem Worker-Kontext haben einen anderen Prototyp → vor dem Vergleich in schlichte Objekte umwandeln
const plain = (x) => JSON.parse(JSON.stringify(x));

/** service-worker.js in einer künstlichen Worker-Umgebung laden; liefert die Ereignis-Handler und die Aufzeichnungen. */
function load() {
  const handlers = {};
  const shown = [];
  const opened = [];
  const clientList = [];
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: { showNotification: async (title, opts) => { shown.push({ title, opts }); } },
    clients: {
      matchAll: async () => clientList,
      openWindow: async (url) => { opened.push(url); },
      claim: async () => {},
    },
    skipWaiting: async () => {},
  };
  const ctx = vm.createContext({ self, caches: {}, Request: class {}, URL, Promise, setTimeout, clearTimeout, Date, console, fetch: async () => ({}), Response: class {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8'), ctx);
  const fire = async (type, event) => {
    const waits = [];
    await handlers[type]({ ...event, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return { handlers, shown, opened, clientList, fire };
}

const pushEvent = (payload) => ({ data: { json: () => payload } });

test('Push vom Server (FCM: Daten unter „data“) ergibt eine sichtbare Mitteilung mit Chat-Ziel', async () => {
  const sw = load();
  await sw.fire('push', pushEvent({ from: '772272950544', data: { title: 'Push-Team', body: '@anna: Heute Beine', tag: 'chat-@g1', url: '#/chat/g/g1' } }));
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, 'Push-Team');
  assert.equal(sw.shown[0].opts.body, '@anna: Heute Beine');
  assert.equal(sw.shown[0].opts.tag, 'chat-@g1');        // ersetzt die vorige Meldung desselben Chats
  assert.equal(sw.shown[0].opts.renotify, true);
  assert.deepEqual(plain(sw.shown[0].opts.data), { url: '#/chat/g/g1' });
});

test('Push in anderer Form oder ohne Inhalt: es wird trotzdem eine Mitteilung gezeigt (iOS verlangt das)', async () => {
  const sw = load();
  await sw.fire('push', pushEvent({ title: 'Gym-Chat', body: '@ben: Hi', url: '#/chat/gym' }));   // ohne „data“-Umschlag
  assert.equal(sw.shown[0].title, 'Gym-Chat');
  assert.deepEqual(plain(sw.shown[0].opts.data), { url: '#/chat/gym' });
  await sw.fire('push', { data: null });                                                          // leer
  await sw.fire('push', { data: { json: () => { throw new Error('kein JSON'); } } });             // kaputt
  assert.equal(sw.shown.length, 3);
  assert.equal(sw.shown[1].title, 'Anchor');
  assert.equal(sw.shown[2].opts.tag, 'chat');
});

test('Tipp auf die Mitteilung: offene App bekommt das Ziel, sonst öffnet sich die App direkt im Chat', async () => {
  const sw = load();
  const closed = [];
  const note = (url) => ({ close: () => closed.push(1), data: url === undefined ? undefined : { url } });
  // App ist offen → Nachricht „open“ + Fokus
  const client = { focused: 0, sent: [], focus() { this.focused++; return Promise.resolve(); }, postMessage(m) { this.sent.push(m); } };
  sw.clientList.push(client);
  await sw.fire('notificationclick', { notification: note('#/chat/dm/abc') });
  assert.deepEqual(plain(client.sent), [{ type: 'open', hash: '#/chat/dm/abc' }]);
  assert.equal(client.focused, 1);
  // Pausentimer-Mitteilung (ohne Ziel): nur fokussieren, wie bisher
  await sw.fire('notificationclick', { notification: note(undefined) });
  assert.equal(client.sent.length, 1);
  assert.equal(client.focused, 2);
  // App geschlossen → Fenster mit Ziel öffnen
  sw.clientList.length = 0;
  await sw.fire('notificationclick', { notification: note('#/chat/gym') });
  await sw.fire('notificationclick', { notification: note(undefined) });
  assert.deepEqual(sw.opened, ['./#/chat/gym', './#/workout']);
  assert.equal(closed.length, 4);
});
