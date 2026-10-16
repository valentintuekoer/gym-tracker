// Integrationstests für Gruppen und Direktchats + Sicherheitsregeln gegen den Firebase-Emulator (Auth, Firestore).
// Ausführen (einmalig `npm install` in diesem Ordner):  npm test
// Nutzt dieselben chat.js/social.js wie die App und die echten firestore.rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { createSocial } from '../../social.js';
import { createChat, groupRoom, dmId } from '../../chat.js';

const PROJECT = 'demo-gym';
const FS = 'http://127.0.0.1:8080';
const apps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

async function user(name, profile = true) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: PROJECT + '.firebaseapp.com' }, name + Math.random());
  apps.push(app);
  const auth = A.getAuth(app);
  A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fs = F.getFirestore(app);
  F.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  const cred = await A.createUserWithEmailAndPassword(auth, name + '@test.de', 'geheim123');
  const social = createSocial({ F, fs, auth, storage: null });
  const chat = createChat({ F, fs, auth });
  if (profile) await social.saveProfile({ username: name, photo: null });
  return { uid: cred.user.uid, name, auth, fs, social, chat };
}

/** a und b werden bestätigte Freunde (Anfrage von b an a, a nimmt an). */
async function befriend(a, b) {
  await b.social.sendRequest(a.uid, { username: b.name, photo: null }, { username: a.name, photo: null });
  await a.social.acceptRequest(b.uid, false);
}

async function denied(p) {
  await assert.rejects(p, (e) => /permission|unauthorized/i.test(e.code || '') || /PERMISSION_DENIED/.test(e.message));
}

const say = (u, room, text) => u.chat.send(room, { id: u.chat.newId(room), name: u.name, text });
const groupDocRef = (u, gid) => F.doc(u.fs, 'groups', gid);
const getGroup = async (u, gid) => (await F.getDoc(groupDocRef(u, gid))).data();

/** Meine Gruppen (eine Abfrage) – wartet auf einen passenden Stand. */
function myGroups(u, pred) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { stop(); reject(new Error('Zeitüberschreitung')); }, 8000);
    const stop = u.chat.groups.watch((list, meta) => { if (!meta.fromCache && pred(list)) { clearTimeout(t); setTimeout(stop); resolve(list); } }, reject);
  });
}

function messages(u, room, pred) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { stop(); reject(new Error('Zeitüberschreitung')); }, 8000);
    const stop = u.chat.watch(room, 30, (list, meta) => { if (!meta.fromCache && pred(list)) { clearTimeout(t); setTimeout(stop); resolve(list); } }, reject);
  });
}

test.before(resetEmulators);
test.after(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

test('Gruppe anlegen: nur ich als Mitglied, Freunde kommen einzeln dazu; Fremde nicht', async () => {
  const anna = await user('gaanna');
  const ben = await user('gaben');
  const cleo = await user('gacleo');
  const fremd = await user('gafremd');
  await befriend(anna, ben);
  await befriend(anna, cleo);
  const gid = await anna.chat.groups.create({ name: 'Push-Gruppe', myName: anna.name });
  let g = await getGroup(anna, gid);
  assert.deepEqual(g.memberIds, [anna.uid]);
  assert.equal(g.kind, 'group');
  assert.equal(g.name, 'Push-Gruppe');
  assert.equal(g.owner, anna.uid);

  await anna.chat.groups.addMember(gid, ben.uid, ben.name);
  await anna.chat.groups.addMember(gid, cleo.uid, cleo.name);
  g = await getGroup(anna, gid);
  assert.deepEqual(g.memberIds, [anna.uid, ben.uid, cleo.uid]);
  assert.deepEqual(g.memberNames, { [anna.uid]: 'gaanna', [ben.uid]: 'gaben', [cleo.uid]: 'gacleo' });

  // Keine Freunde → nicht einladbar (auch nicht mit erfundenem Namen)
  await denied(anna.chat.groups.addMember(gid, fremd.uid, fremd.name));
  // Falscher Name für einen Freund
  const dora = await user('gadora');
  await befriend(anna, dora);
  await denied(anna.chat.groups.addMember(gid, dora.uid, 'anderer-name'));
  await anna.chat.groups.addMember(gid, dora.uid, dora.name);
  // Mitglieder dürfen niemanden einladen, auch keine Freunde
  const emil = await user('gaemil');
  await befriend(ben, emil);
  await denied(ben.chat.groups.addMember(gid, emil.uid, emil.name));
  // Gruppen mit fremden Mitgliedern von Anfang an gehen nicht
  await denied(F.setDoc(F.doc(F.collection(anna.fs, 'groups')), {
    kind: 'group', name: 'X', owner: anna.uid, memberIds: [anna.uid, fremd.uid], memberNames: { [anna.uid]: anna.name, [fremd.uid]: fremd.name }, createdAt: F.serverTimestamp(),
  }));
  // Besitzer nicht vortäuschen, Name leer oder zu lang
  await denied(F.setDoc(F.doc(F.collection(ben.fs, 'groups')), {
    kind: 'group', name: 'Y', owner: anna.uid, memberIds: [anna.uid], memberNames: { [anna.uid]: anna.name }, createdAt: F.serverTimestamp(),
  }));
  await denied(anna.chat.groups.create({ name: '   ', myName: anna.name }));
  await denied(F.setDoc(F.doc(F.collection(anna.fs, 'groups')), {
    kind: 'group', name: 'x'.repeat(41), owner: anna.uid, memberIds: [anna.uid], memberNames: { [anna.uid]: anna.name }, createdAt: F.serverTimestamp(),
  }));
  // Fremde sehen die Gruppe nicht – weder einzeln noch in der Abfrage
  await denied(F.getDoc(groupDocRef(fremd, gid)));
  await denied(F.getDocs(F.query(F.collection(fremd.fs, 'groups'), F.where('memberIds', 'array-contains', anna.uid))));
});

test('Meine Gruppen: eine Abfrage zeigt Name, Mitglieder und letzte Nachricht – nur den Mitgliedern', async () => {
  const anna = await user('gbanna');
  const ben = await user('gbben');
  const cleo = await user('gbcleo');
  await befriend(anna, ben);
  const gid = await anna.chat.groups.create({ name: 'Beine', myName: anna.name });
  await anna.chat.groups.addMember(gid, ben.uid, ben.name);
  const room = groupRoom(gid);

  const mineB = await myGroups(ben, (l) => l.some((g) => g.id === gid));
  const g = mineB.find((x) => x.id === gid);
  assert.equal(g.name, 'Beine');
  assert.equal(g.room, room);
  assert.deepEqual(g.memberIds, [anna.uid, ben.uid]);
  assert.equal(g.memberNames[anna.uid], 'gbanna');
  assert.deepEqual((await myGroups(cleo, () => true)).filter((x) => x.id === gid), []); // Nicht-Mitglied sieht sie nicht

  // Nachricht senden → letzte Nachricht steht im Gruppen-Dokument (für die Liste)
  await say(anna, room, 'Heute Beine um 18 Uhr?');
  const after = await myGroups(ben, (l) => l.some((x) => x.id === gid && x.lastText));
  const g2 = after.find((x) => x.id === gid);
  assert.equal(g2.lastText, 'Heute Beine um 18 Uhr?');
  assert.equal(g2.lastName, 'gbanna');
  assert.equal(g2.lastUid, anna.uid);
  assert.ok(Math.abs(g2.lastAt - Date.now()) < 60000);
  // „letzte Nachricht“ lässt sich nicht fälschen
  await denied(F.updateDoc(groupDocRef(ben, gid), { lastAt: F.serverTimestamp(), lastUid: anna.uid, lastName: 'gbanna', lastText: 'gefälscht' }));
  await denied(F.updateDoc(groupDocRef(ben, gid), { lastAt: F.Timestamp.fromMillis(Date.now() - 86400000), lastUid: ben.uid, lastName: 'gbben', lastText: 'alte Zeit' }));
  await denied(F.updateDoc(groupDocRef(ben, gid), { lastAt: F.serverTimestamp(), lastUid: ben.uid, lastName: 'gbben', lastText: 'x'.repeat(81) }));
  await denied(F.updateDoc(groupDocRef(ben, gid), { owner: ben.uid }));
  await denied(F.updateDoc(groupDocRef(ben, gid), { name: 'Umbenannt von Ben' }));
});

test('Nachrichten und Gym-Karten in der Gruppe: nur Mitglieder lesen und schreiben, gemeinsames Rate Limit', async () => {
  const anna = await user('gcanna');
  const ben = await user('gcben');
  const cleo = await user('gccleo');
  await befriend(anna, ben);
  const gid = await anna.chat.groups.create({ name: 'Zu zweit', myName: anna.name });
  await anna.chat.groups.addMember(gid, ben.uid, ben.name);
  const room = groupRoom(gid);

  await say(anna, room, 'Hallo Gruppe');
  const list = await messages(ben, room, (l) => l.some((m) => m.text === 'Hallo Gruppe'));
  assert.equal(list.find((m) => m.text === 'Hallo Gruppe').name, 'gcanna');
  await sleep(2100);
  await say(ben, room, 'Hi Anna');
  // Karte in der Gruppe, Teilnehmer eintragen
  await sleep(2100);
  const cardId = anna.chat.newId(room);
  await anna.chat.sendCard(room, { id: cardId, name: anna.name, when: Date.now() + 3600000, workout: 'legs', note: 'Kniebeugen' });
  await ben.chat.join(room, cardId, ben.name);
  const withJoin = await messages(anna, room, (l) => l.some((m) => m.id === cardId && m.joined[ben.uid]));
  assert.equal(withJoin.find((m) => m.id === cardId).joined[ben.uid], 'gcben');
  // „Heute im Gym“ der Gruppe
  const plans = await new Promise((resolve, reject) => {
    const stop = ben.chat.watchPlans(room, Date.now() - 60000, Date.now() + 86400000, (l) => { stop(); resolve(l); }, reject);
  });
  assert.equal(plans.length, 1);

  // Nicht-Mitglied: weder lesen noch schreiben, auch nicht mit Profil
  await denied(F.getDocs(F.query(F.collection(cleo.fs, 'groups', gid, 'messages'), F.limit(5))));
  assert.deepEqual(await cleo.chat.probe(room), { read: false, code: 'permission-denied' });
  await denied(say(cleo, room, 'Darf ich?'));
  // Rate Limit gilt über alle Räume: direkt danach im Raum „gym“ → abgelehnt
  await sleep(2100);
  await say(anna, room, 'eins');
  await denied(say(anna, 'gym', 'zwei sofort'));
  // Nachrichten anderer lassen sich nicht ändern; eigene schon
  const mine = (await messages(ben, room, (l) => l.some((m) => m.text === 'Hi Anna'))).find((m) => m.text === 'Hi Anna');
  await denied(anna.chat.editText(room, mine.id, 'manipuliert'));
  await ben.chat.editText(room, mine.id, 'Hi Anna!');
  // Der Besitzer darf aufräumen, Mitglieder nur Eigenes
  await denied(ben.chat.remove(room, withJoin.find((m) => m.id === cardId).id));
  await anna.chat.remove(room, mine.id);
});

test('Gruppe verlassen, Mitglied entfernen, umbenennen, löschen', async () => {
  const anna = await user('gdanna');
  const ben = await user('gdben');
  const cleo = await user('gdcleo');
  await befriend(anna, ben);
  await befriend(anna, cleo);
  const gid = await anna.chat.groups.create({ name: 'Alt', myName: anna.name });
  await anna.chat.groups.addMember(gid, ben.uid, ben.name);
  await anna.chat.groups.addMember(gid, cleo.uid, cleo.name);
  const room = groupRoom(gid);
  await say(ben, room, 'bin dabei');

  await anna.chat.groups.rename(gid, 'Neu');
  assert.equal((await getGroup(anna, gid)).name, 'Neu');

  // Ben geht selbst; danach liest/schreibt er nichts mehr, seine alte Nachricht darf er löschen
  await ben.chat.groups.removeMember(gid, ben.uid);
  let g = await getGroup(anna, gid);
  assert.deepEqual(g.memberIds, [anna.uid, cleo.uid]);
  assert.equal(g.memberNames[ben.uid], undefined);
  await denied(F.getDoc(groupDocRef(ben, gid)));
  await sleep(2100);
  await denied(say(ben, room, 'noch da?'));
  // Cleo kann Anna nicht entfernen und niemand außer dem Besitzer andere
  await denied(cleo.chat.groups.removeMember(gid, anna.uid));
  // Der Besitzer kann nicht gehen (er löscht die Gruppe)
  await denied(anna.chat.groups.removeMember(gid, anna.uid));
  // Besitzer entfernt Cleo
  await anna.chat.groups.removeMember(gid, cleo.uid);
  g = await getGroup(anna, gid);
  assert.deepEqual(g.memberIds, [anna.uid]);
  // Wieder einladen geht (er ist Freund)
  await anna.chat.groups.addMember(gid, cleo.uid, cleo.name);
  // Löschen: nur der Besitzer; Nachrichten verschwinden mit
  await denied(cleo.chat.groups.remove(gid));
  await anna.chat.groups.remove(gid);
  assert.deepEqual((await myGroups(anna, () => true)).filter((x) => x.id === gid), []);
  assert.deepEqual(await myGroups(cleo, () => true).then((l) => l.filter((x) => x.id === gid)), []);
});

test('Direktchat: nur mit einer Freundin/einem Freund, feste ID, beide lesen und schreiben', async () => {
  const anna = await user('gmanna');
  const ben = await user('gmben');
  const cleo = await user('gmcleo');
  await befriend(anna, ben);
  // Cleo ist kein Freund von Anna
  await denied(anna.chat.groups.createDm({ myName: anna.name, peer: { uid: cleo.uid, name: cleo.name } }));
  // Falscher Name für den Freund
  await denied(anna.chat.groups.createDm({ myName: anna.name, peer: { uid: ben.uid, name: 'falsch' } }));
  const id = await anna.chat.groups.createDm({ myName: anna.name, peer: { uid: ben.uid, name: ben.name } });
  assert.equal(id, dmId(anna.uid, ben.uid));
  assert.equal(id, dmId(ben.uid, anna.uid)); // von beiden Seiten dieselbe ID
  const g = await getGroup(ben, id);
  assert.equal(g.kind, 'dm');
  assert.deepEqual(new Set(g.memberIds), new Set([anna.uid, ben.uid]));
  assert.equal(g.name, '');
  // erscheint in der Liste beider
  assert.ok((await myGroups(ben, (l) => l.some((x) => x.id === id))).some((x) => x.kind === 'dm'));
  const room = groupRoom(id);
  await say(ben, room, 'Hey, Training?');
  const list = await messages(anna, room, (l) => l.some((m) => m.text === 'Hey, Training?'));
  assert.equal(list[0].name, 'gmben');
  // Dritte kommen nicht rein; in einen Direktchat lädt auch der Besitzer niemanden ein
  await denied(F.getDoc(groupDocRef(cleo, id)));
  await denied(say(cleo, room, 'mitlesen'));
  await befriend(anna, cleo);
  await denied(anna.chat.groups.addMember(id, cleo.uid, cleo.name));
  // Falsche ID für ein Paar (nicht dm_<kleinere>_<größere>)
  const wrong = 'dm_' + [anna.uid, cleo.uid].sort().reverse().join('_');
  await denied(F.setDoc(groupDocRef(anna, wrong), { kind: 'dm', name: '', owner: anna.uid, memberIds: [anna.uid, cleo.uid], memberNames: { [anna.uid]: anna.name, [cleo.uid]: cleo.name }, createdAt: F.serverTimestamp() }));
  // Ein Direktchat existiert schon: erneutes Anlegen wird abgelehnt, ist aber harmlos (App öffnet ihn einfach)
  await denied(anna.chat.groups.createDm({ myName: anna.name, peer: { uid: ben.uid, name: ben.name } }));
});

test('Gesperrte Nutzer und Meldungen: Gruppen-Nachrichten melden, Sperre gilt auch hier', async () => {
  const anna = await user('geanna');
  const ben = await user('geben');
  await befriend(anna, ben);
  const gid = await anna.chat.groups.create({ name: 'Meldung', myName: anna.name });
  await anna.chat.groups.addMember(gid, ben.uid, ben.name);
  const room = groupRoom(gid);
  const id = ben.chat.newId(room);
  await ben.chat.send(room, { id, name: ben.name, text: 'unpassend' });
  const msg = (await messages(anna, room, (l) => l.some((m) => m.id === id))).find((m) => m.id === id);
  // Raum-Schlüssel '@<id>' passt in die Meldung (bis 70 Zeichen), auch ein Direktchat-Schlüssel
  await anna.chat.report(room, msg, 'abuse');
  await denied(anna.chat.report(room, msg, 'spam')); // je Melder und Nachricht nur eine Meldung
  await denied(F.getDoc(F.doc(anna.fs, 'reports', anna.uid + '_' + id))); // lesen dürfen nur Administratoren
  assert.ok(('@' + dmId(anna.uid, ben.uid)).length <= 70);
  // Gesperrte Konten (Administrator trägt blocked/{uid} ein) können in Gruppen nichts mehr schreiben
  // → hier ohne Administrator: ein Konto kann sich nicht selbst entsperren oder sperren
  await denied(F.setDoc(F.doc(ben.fs, 'blocked', ben.uid), { email: 'x', at: Date.now() }));
});

test('Konto löschen: eigene Gruppen verschwinden, aus fremden Gruppen wird man entfernt, Nachrichten weg', async () => {
  const anna = await user('gfanna');
  const ben = await user('gfben');
  const cleo = await user('gfcleo');
  await befriend(anna, ben);
  await befriend(cleo, ben);
  // Annas Gruppe mit Ben; Cleos Gruppe mit Ben
  const annas = await anna.chat.groups.create({ name: 'Annas', myName: anna.name });
  await anna.chat.groups.addMember(annas, ben.uid, ben.name);
  const cleos = await cleo.chat.groups.create({ name: 'Cleos', myName: cleo.name });
  await cleo.chat.groups.addMember(cleos, ben.uid, ben.name);
  await say(ben, groupRoom(annas), 'Ben in Annas');
  await sleep(2100);
  await say(ben, groupRoom(cleos), 'Ben in Cleos');
  await sleep(2100);
  await say(cleo, groupRoom(cleos), 'Cleo in Cleos');

  // Ben löscht sein Konto (Teil 1 – wie die App, solange das Profil noch besteht)
  await ben.chat.deleteMine(ben.uid);
  // aus beiden Gruppen entfernt, Nachrichten gelöscht
  assert.deepEqual((await getGroup(anna, annas)).memberIds, [anna.uid]);
  assert.deepEqual((await getGroup(cleo, cleos)).memberIds, [cleo.uid]);
  const left = await messages(cleo, groupRoom(cleos), (l) => l.length >= 1);
  assert.deepEqual(left.map((m) => m.text), ['Cleo in Cleos']);

  // Cleo (Besitzerin) löscht ihr Konto: ihre Gruppe ist weg
  await cleo.chat.deleteMine(cleo.uid);
  assert.deepEqual((await myGroups(cleo, () => true)).filter((x) => x.id === cleos), []);
});
