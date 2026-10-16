/* Gym Tracker – Mitglieder-Chat (Cloud Firestore)
 *
 * Wird von cloud.js mit dem Firebase-SDK aufgerufen (im Test mit dem npm-Paket gegen den Emulator).
 * Datenablage (Zugriff regeln firestore.rules):
 *   rooms/{raum}/messages/{id}  → Nachricht (kind 'text') oder Gym-Karte (kind 'gym')
 *       { uid, name, kind, createdAt, editedAt?,
 *         text                         bei 'text'
 *         when, workout, note, joined  bei 'gym'  (joined: { uid: benutzername } – wer mitkommt) }
 *   groups/{gid}                → Gruppe (kind 'group') oder Direktchat zweier Freunde (kind 'dm', gid = dm_<uidA>_<uidB>)
 *       { kind, name, owner, memberIds, memberNames { uid: Benutzername }, createdAt, lastAt?, lastText?, lastName?, lastUid? }
 *   groups/{gid}/messages/{id}  → Nachrichten und Gym-Karten der Gruppe (gleiches Format wie im Raum 'gym')
 *   chatState/{uid}             → { lastPostAt, lastCardAt }  Rate Limit (wird mit jeder Nachricht mitgeschrieben)
 *   reports/{uid}_{msgId}       → Meldung einer Nachricht (nur Administratoren lesen)
 * Der Raum 'gym' gibt es immer; weitere Räume legt ein Administrator als Dokument rooms/{raum} an.
 * Räume werden überall als Text angegeben: 'gym' (öffentlicher Raum) bzw. '@' + Gruppen-ID (Gruppe oder Direktchat).
 */

export const ROOM = 'gym';
export const PAGE = 30;
export const GROUP_MAX = 30;      // Mitglieder je Gruppe (die Regeln erlauben höchstens 30)
export const GROUP_NAME_MAX = 40;

/** Raum-Schlüssel einer Gruppe bzw. eines Direktchats */
export const groupRoom = (gid) => '@' + gid;
export const isGroupRoom = (room) => typeof room === 'string' && room.charAt(0) === '@';
export const roomGid = (room) => room.slice(1);
/** Direktchat zweier Personen: dieselbe ID von beiden Seiten (kleinere ID zuerst – die Regeln prüfen das) */
export const dmId = (a, b) => (a < b ? 'dm_' + a + '_' + b : 'dm_' + b + '_' + a);

export function createChat({ F, fs, auth }) {
  const me = () => {
    const u = auth.currentUser;
    if (!u) throw Object.assign(new Error('not signed in'), { code: 'auth/requires-recent-login' });
    return u.uid;
  };
  const msgsCol = (room) => (isGroupRoom(room) ? F.collection(fs, 'groups', roomGid(room), 'messages') : F.collection(fs, 'rooms', room, 'messages'));
  const msgDoc = (room, id) => (isGroupRoom(room) ? F.doc(fs, 'groups', roomGid(room), 'messages', id) : F.doc(fs, 'rooms', room, 'messages', id));
  const groupDoc = (gid) => F.doc(fs, 'groups', gid);
  const stateDoc = (uid) => F.doc(fs, 'chatState', uid);

  /** Dokument → schlichtes Objekt. Serverzeit, die noch aussteht, wird geschätzt (eigene, gerade gesendete Nachricht). */
  function msgOf(d) {
    const x = d.data({ serverTimestamps: 'estimate' });
    const joined = x.joined && typeof x.joined === 'object' ? x.joined : {};
    return {
      id: d.id, uid: x.uid, name: x.name || '', kind: x.kind === 'gym' ? 'gym' : 'text',
      text: x.text || '', createdAt: x.createdAt ? x.createdAt.toMillis() : Date.now(),
      editedAt: x.editedAt ? x.editedAt.toMillis() : null,
      when: typeof x.when === 'number' ? x.when : null, workout: x.workout || '', note: x.note || '', joined,
      pending: d.metadata.hasPendingWrites,
      cursor: x.createdAt || null, // exakter Zeitstempel zum Nachladen älterer Seiten
    };
  }

  /** Gruppen-Dokument → schlichtes Objekt */
  function groupOf(d) {
    const x = d.data({ serverTimestamps: 'estimate' });
    return {
      id: d.id, room: groupRoom(d.id), kind: x.kind === 'dm' ? 'dm' : 'group', name: x.name || '', owner: x.owner || '',
      memberIds: Array.isArray(x.memberIds) ? x.memberIds : [],
      memberNames: x.memberNames && typeof x.memberNames === 'object' ? x.memberNames : {},
      createdAt: x.createdAt ? x.createdAt.toMillis() : 0,
      lastAt: x.lastAt ? x.lastAt.toMillis() : null, lastText: x.lastText || '', lastName: x.lastName || '', lastUid: x.lastUid || '',
      pending: d.metadata.hasPendingWrites,
    };
  }

  /** Gruppen-Dokument ändern: lesen, neue Felder berechnen, schreiben – alles in einer Transaktion. */
  async function mutateGroup(gid, change) {
    await F.runTransaction(fs, async (tx) => {
      const ref = groupDoc(gid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw Object.assign(new Error('not-found'), { code: 'not-found' });
      tx.update(ref, change(snap.data()));
    });
  }

  const queryNewest = (room, ...extra) => F.query(msgsCol(room), F.orderBy('createdAt', 'desc'), F.orderBy(F.documentId(), 'desc'), ...extra);

  /** Eine Nachricht (oder Karte) in einem Schritt zusammen mit dem Rate-Limit-Dokument schreiben. */
  async function post(room, id, data, card) {
    const uid = me();
    const batch = F.writeBatch(fs);
    batch.set(msgDoc(room, id), { ...data, uid, createdAt: F.serverTimestamp() });
    batch.set(stateDoc(uid), card ? { lastPostAt: F.serverTimestamp(), lastCardAt: F.serverTimestamp() } : { lastPostAt: F.serverTimestamp() }, { merge: true });
    // Gruppe: letzte Nachricht für die Chat-Liste (Vorschau, „ungelesen“)
    if (isGroupRoom(room)) {
      batch.update(groupDoc(roomGid(room)), {
        lastAt: F.serverTimestamp(), lastUid: uid, lastName: data.name,
        lastText: data.kind === 'gym' ? 'Gym-Besuch' : String(data.text || '').slice(0, 80),
      });
    }
    return batch.commit();
  }

  const api = {
    /** Alle Räume: der feste Raum 'gym' plus die vom Administrator angelegten (rooms/{raum}). */
    async rooms() {
      try {
        const snap = await F.getDocs(F.collection(fs, 'rooms'));
        return [ROOM].concat(snap.docs.map((d) => d.id).filter((r) => r !== ROOM));
      } catch (e) { return [ROOM]; }
    },

    /** Neue Nachrichten-ID (Firestore-Auto-ID) – damit „Erneut senden“ dieselbe Nachricht meint. */
    newId: (room) => F.doc(msgsCol(room || ROOM)).id,

    /**
     * Live: die neuesten `limit` Nachrichten (neueste zuerst). Meldet auch Zwischenstände,
     * deren Schreibvorgang noch aussteht (`pending`), und ob die Daten nur aus dem Zwischenspeicher stammen.
     */
    watch(room, limit, onData, onError) {
      return F.onSnapshot(queryNewest(room, F.limit(limit || PAGE)), { includeMetadataChanges: true }, (snap) => {
        onData(snap.docs.map(msgOf), { fromCache: snap.metadata.fromCache });
      }, onError);
    },

    /** Live: alle Gym-Karten, deren Start im Zeitfenster [from, to) liegt („Heute im Gym“). */
    watchPlans(room, from, to, onData, onError) {
      const q = F.query(msgsCol(room), F.where('when', '>=', from), F.where('when', '<', to), F.limit(50));
      return F.onSnapshot(q, { includeMetadataChanges: true }, (snap) => onData(snap.docs.map(msgOf)), onError);
    },

    /** Ältere Seite nach `before` (eine Nachricht aus der Liste) → { messages, done } */
    async older(room, before, n) {
      const size = n || PAGE;
      if (!before || !before.cursor) return { messages: [], done: true };
      const snap = await F.getDocs(queryNewest(room, F.startAfter(before.cursor, before.id), F.limit(size)));
      return { messages: snap.docs.map(msgOf), done: snap.size < size };
    },

    /** Textnachricht senden. Löst erst auf, wenn der Server sie angenommen hat. */
    send(room, { id, name, text }) {
      return post(room, id, { name, kind: 'text', text }, false);
    },

    /** Gym-Karte senden: { when (ms), workout, note } */
    sendCard(room, { id, name, when, workout, note }) {
      return post(room, id, { name, kind: 'gym', when, workout: workout || '', note: note || '', joined: {} }, true);
    },

    /**
     * Darf der Chat gelesen werden? Unterscheidet bei einem abgelehnten Senden, ob die Firestore-Regeln den Chat
     * grundsätzlich nicht zulassen (veraltet/nicht veröffentlicht) oder nur dieses eine Schreiben abgelehnt wurde.
     * → { read: true } | { read: false, code }
     */
    async probe(room) {
      try { await F.getDocs(F.query(msgsCol(room || ROOM), F.limit(1))); return { read: true }; }
      catch (e) { return { read: false, code: (e && e.code) || '' }; }
    },

    /** Wurde die Nachricht schon angenommen? (Nach einem Verbindungsabbruch, bevor „Erneut senden“ sie doppelt anlegt) */
    async exists(room, id) {
      try { return (await F.getDocFromServer(msgDoc(room, id))).exists(); } catch (e) { return false; }
    },

    editText: (room, id, text) => F.updateDoc(msgDoc(room, id), { text, editedAt: F.serverTimestamp() }),
    editCard: (room, id, { when, workout, note }) => F.updateDoc(msgDoc(room, id), { when, workout: workout || '', note: note || '', editedAt: F.serverTimestamp() }),
    remove: (room, id) => F.deleteDoc(msgDoc(room, id)),

    /** „Ich komme mit“ / „Doch nicht“ – trägt nur den eigenen Namen ein bzw. aus. */
    async join(room, id, name) { await F.updateDoc(msgDoc(room, id), 'joined.' + me(), name); },
    async leave(room, id) { await F.updateDoc(msgDoc(room, id), 'joined.' + me(), F.deleteField()); },

    /** Nachricht melden (eine Meldung je Melder und Nachricht). */
    async report(room, msg, reason) {
      const uid = me();
      await F.setDoc(F.doc(fs, 'reports', uid + '_' + msg.id), {
        room, msgId: msg.id, targetUid: msg.uid, targetName: msg.name || '',
        text: String(msg.kind === 'gym' ? [msg.workout, msg.note].filter(Boolean).join(' – ') || 'Gym-Karte' : msg.text || '').slice(0, 500),
        reason, reporter: uid, at: F.serverTimestamp(),
      });
    },

    /**
     * Konto löschen, Teil 1 (solange das Profil noch besteht): eigene Nachrichten und Karten löschen
     * und den eigenen Namen aus fremden Teilnehmerlisten entfernen. `rooms` = bekannte Räume.
     */
    async deleteMine(uid, roomList) {
      const id = uid || me();
      const rooms = roomList || await api.rooms();
      const SLICE = 50; // die Regeln erlauben höchstens 50 Dokumente pro Abfrage
      // Gruppen: eigene Gruppen löschen, aus fremden austreten (vorher die eigenen Nachrichten entfernen)
      const mine = await F.getDocs(F.query(F.collection(fs, 'groups'), F.where('memberIds', 'array-contains', id))).catch(() => null);
      const groupRooms = [];
      if (mine) {
        for (const g of mine.docs) {
          const gx = g.data();
          if (gx.owner === id) { await api.groups.remove(g.id).catch(() => {}); continue; }
          groupRooms.push(groupRoom(g.id));
        }
      }
      for (const room of rooms.concat(groupRooms)) {
        for (let round = 0; round < 40; round++) {
          const mine = await F.getDocs(F.query(msgsCol(room), F.where('uid', '==', id), F.limit(SLICE)));
          if (!mine.size) break;
          const batch = F.writeBatch(fs);
          mine.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          if (mine.size < SLICE) break;
        }
        for (let round = 0; round < 40; round++) {
          const joined = await F.getDocs(F.query(msgsCol(room), F.where('joined.' + id, '>=', ''), F.limit(SLICE)));
          if (!joined.size) break;
          for (const d of joined.docs) await F.updateDoc(d.ref, 'joined.' + id, F.deleteField()).catch(() => {});
          if (joined.size < SLICE) break;
        }
        if (isGroupRoom(room)) await api.groups.removeMember(roomGid(room), id).catch(() => {});
      }
    },

    /* ----- Gruppen & Direktchats ----- */
    groups: {
      /** Live: alle Gruppen und Direktchats, in denen ich Mitglied bin (eine Abfrage). */
      watch(onData, onError) {
        const q = F.query(F.collection(fs, 'groups'), F.where('memberIds', 'array-contains', me()));
        return F.onSnapshot(q, { includeMetadataChanges: true }, (snap) => onData(snap.docs.map(groupOf), { fromCache: snap.metadata.fromCache }), onError);
      },

      /** Neue Gruppe nur mit mir; Freunde kommen danach einzeln dazu (addMember – jeder Eintrag wird von den Regeln geprüft). */
      async create({ name, myName }) {
        const uid = me();
        const id = F.doc(F.collection(fs, 'groups')).id;
        await F.setDoc(groupDoc(id), {
          kind: 'group', name: String(name).trim().slice(0, GROUP_NAME_MAX), owner: uid,
          memberIds: [uid], memberNames: { [uid]: myName }, createdAt: F.serverTimestamp(),
        });
        return id;
      },

      /** Direktchat mit einer Freundin/einem Freund anlegen (existiert er schon, wird der Fehler ignoriert). */
      async createDm({ myName, peer }) {
        const uid = me();
        const id = dmId(uid, peer.uid);
        // Ersteller steht zuerst in der Liste (so verlangen es die Regeln); die ID ist von beiden Seiten gleich
        await F.setDoc(groupDoc(id), {
          kind: 'dm', name: '', owner: uid, memberIds: [uid, peer.uid], memberNames: { [uid]: myName, [peer.uid]: peer.name }, createdAt: F.serverTimestamp(),
        });
        return id;
      },

      // Änderungen an Mitgliedern/Name laufen als Transaktion (nur Server, kein lokaler Zwischenstand): Ein Dokument, das lokal
      // aus der Abfrage „meine Gruppen“ herausfällt, während ein Live-Listener läuft, bringt das Firestore-SDK sonst
      // gelegentlich durcheinander („INTERNAL ASSERTION FAILED … b815“).
      addMember: (gid, uid, name) => mutateGroup(gid, (d) => ({ memberIds: d.memberIds.concat([uid]), ['memberNames.' + uid]: name })),
      removeMember: (gid, uid) => mutateGroup(gid, (d) => ({ memberIds: d.memberIds.filter((x) => x !== uid), ['memberNames.' + uid]: F.deleteField() })),
      rename: (gid, name) => mutateGroup(gid, () => ({ name: String(name).trim().slice(0, GROUP_NAME_MAX) })),

      /** Gruppe löschen (Besitzer): erst alle Nachrichten (je 50 pro Abfrage), dann die Gruppe. */
      async remove(gid) {
        const col = msgsCol(groupRoom(gid));
        for (let round = 0; round < 200; round++) {
          const snap = await F.getDocs(F.query(col, F.limit(50)));
          if (!snap.size) break;
          const batch = F.writeBatch(fs);
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          if (snap.size < 50) break;
        }
        await F.runTransaction(fs, async (tx) => { tx.delete(groupDoc(gid)); });
      },
    },

    /** Teil 2 (nachdem das Profil gelöscht ist): Rate-Limit-Dokument entfernen. */
    async deleteState(uid) { await F.deleteDoc(stateDoc(uid || me())); },
  };
  return api;
}
