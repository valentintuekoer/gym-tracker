/* Gym Tracker – Freunde (Cloud Firestore + Cloud Storage)
 *
 * Wird von cloud.js mit dem Firebase-SDK aufgerufen (im Test mit dem npm-Paket gegen den Emulator).
 * Datenablage (Zugriff regeln firestore.rules und storage.rules):
 *   usernames/{name}            → { uid, username, photo }  eindeutiger Benutzername, für die Suche
 *   publicProfiles/{uid}        → { username, photo, stats, updatedAt }  nur für bestätigte Freunde lesbar
 *   users/{uid}/friends/{fid}   → { since }  Freundesliste (beide Seiten)
 *   requests/{from}_{to}        → offene Freundschaftsanfrage
 *   avatars/{uid}.jpg (Storage) → Profilfoto
 */

export function createSocial({ F, fs, auth, storage }) {
  const me = () => {
    const u = auth.currentUser;
    if (!u) throw Object.assign(new Error('not signed in'), { code: 'auth/requires-recent-login' });
    return u.uid;
  };
  const usernameDoc = (n) => F.doc(fs, 'usernames', n);
  const profileDoc = (uid) => F.doc(fs, 'publicProfiles', uid);
  const friendsCol = (uid) => F.collection(fs, 'users', uid, 'friends');
  const friendDoc = (uid, fid) => F.doc(fs, 'users', uid, 'friends', fid);
  const requestsCol = () => F.collection(fs, 'requests');
  const reqDoc = (from, to) => F.doc(fs, 'requests', from + '_' + to);
  const fail = (code) => Object.assign(new Error(code), { code });

  const personOf = (d) => ({ uid: d.uid, username: d.username || '', photo: d.photo || null });
  const reqOf = (id, d) => ({ id, from: d.from, to: d.to, fromName: d.fromName || '', fromPhoto: d.fromPhoto || null, toName: d.toName || '', toPhoto: d.toPhoto || null, at: d.at || null });

  async function commitAll(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const batch = F.writeBatch(fs);
      ops.slice(i, i + 400).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  const api = {
    /**
     * Eigenes Profil (null = noch keins angelegt) – immer vom Server: Der lokale Cache kann nach
     * offline geteilten Kennzahlen ein unvollständiges Dokument (ohne Benutzername) enthalten.
     */
    async getMyProfile() {
      const snap = await F.getDocFromServer(profileDoc(me()));
      return snap.exists() ? snap.data() : null;
    },

    /** true, wenn frei (oder schon der eigene) */
    async isUsernameFree(name) {
      const snap = await F.getDoc(usernameDoc(name));
      return !snap.exists() || snap.data().uid === me();
    },

    /**
     * Profil anlegen/ändern. Der Benutzername wird in derselben Transaktion reserviert,
     * ein alter Name wieder freigegeben. Belegt → Fehler mit code 'username-taken'.
     */
    async saveProfile({ username, photo, stats }) {
      const uid = me();
      const now = Date.now();
      await F.runTransaction(fs, async (tx) => {
        const cur = await tx.get(profileDoc(uid));
        const old = cur.exists() ? cur.data().username : null;
        const taken = await tx.get(usernameDoc(username));
        if (taken.exists() && taken.data().uid !== uid) throw fail('username-taken');
        let oldDoc = null;
        if (old && old !== username) oldDoc = await tx.get(usernameDoc(old));
        tx.set(usernameDoc(username), { uid, username, photo: photo || null, updatedAt: now });
        if (oldDoc && oldDoc.exists() && oldDoc.data().uid === uid) tx.delete(usernameDoc(old));
        const data = { username, photo: photo || null, updatedAt: now };
        if (stats) data.stats = stats;
        tx.set(profileDoc(uid), data, { merge: true });
      });
    },

    /** Nur die Kennzahlen aktualisieren. */
    publishStats: (stats) => F.setDoc(profileDoc(me()), { stats, updatedAt: Date.now() }, { merge: true }),

    /** Foto nach Cloud Storage hochladen → Download-Adresse. Wirft, wenn Storage nicht verfügbar ist. */
    async uploadPhoto(blob) {
      if (!storage) throw fail('storage/unavailable');
      const { S, st } = await storage();
      const ref = S.ref(st, 'avatars/' + me() + '.jpg');
      await S.uploadBytes(ref, blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
      // Gleiche Adresse nach einem neuen Foto → Versionsnummer anhängen, damit kein altes Bild aus dem Cache kommt
      return (await S.getDownloadURL(ref)) + '&v=' + Date.now();
    },

    async deletePhoto(uid) {
      if (!storage) return;
      try {
        const { S, st } = await storage();
        await S.deleteObject(S.ref(st, 'avatars/' + (uid || me()) + '.jpg'));
      } catch (e) { /* nicht vorhanden oder Storage nicht eingerichtet */ }
    },

    /** Benutzernamen, die mit `prefix` beginnen (max. 10). */
    async search(prefix) {
      const p = String(prefix || '');
      if (!p) return [];
      const q = F.query(F.collection(fs, 'usernames'),
        F.where(F.documentId(), '>=', p), F.where(F.documentId(), '<', p + ''), F.orderBy(F.documentId()), F.limit(10));
      const snap = await F.getDocs(q);
      return snap.docs.map((d) => personOf(d.data()));
    },

    /** Genau ein Benutzername → { uid, username, photo } oder null */
    async lookup(name) {
      const snap = await F.getDoc(usernameDoc(name));
      return snap.exists() ? personOf(snap.data()) : null;
    },

    /**
     * Live: Freundesliste, eingehende und ausgehende Anfragen. Gemeldet werden nur bestätigte
     * Server-Stände: keine leeren Zwischenstände aus dem Offline-Cache und keine eigenen, noch nicht
     * bestätigten Schreibvorgänge (sonst würde z. B. das Profil eines neuen Freundes gelesen, bevor
     * der Server die Freundschaft kennt).
     */
    watch(h, onError) {
      const uid = me();
      const opts = { includeMetadataChanges: true };
      const clean = (snap) => !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
      const u1 = F.onSnapshot(friendsCol(uid), opts, (s) => {
        if (clean(s)) h.friends(s.docs.map((d) => ({ uid: d.id, since: d.data().since || null })));
      }, onError);
      const u2 = F.onSnapshot(F.query(requestsCol(), F.where('to', '==', uid)), opts, (s) => {
        if (clean(s)) h.incoming(s.docs.map((d) => reqOf(d.id, d.data())));
      }, onError);
      const u3 = F.onSnapshot(F.query(requestsCol(), F.where('from', '==', uid)), opts, (s) => {
        if (clean(s)) h.outgoing(s.docs.map((d) => reqOf(d.id, d.data())));
      }, onError);
      return () => { u1(); u2(); u3(); };
    },

    /** Öffentliche Profile von Freunden: { uid: data | null (kein Zugriff/gelöscht) } – Netzwerkfehler werfen. */
    async getProfiles(uids) {
      const out = {};
      await Promise.all(uids.map(async (uid) => {
        try {
          const snap = await F.getDoc(profileDoc(uid));
          out[uid] = snap.exists() ? snap.data() : null;
        } catch (e) {
          if (e && e.code === 'permission-denied') out[uid] = null;
          else throw e;
        }
      }));
      return out;
    },

    sendRequest(to, mine, theirs) {
      const uid = me();
      if (to === uid) return Promise.reject(fail('self'));
      return F.setDoc(reqDoc(uid, to), {
        from: uid, to, fromName: mine.username, fromPhoto: mine.photo || null,
        toName: theirs.username, toPhoto: theirs.photo || null, at: Date.now(),
      });
    },
    cancelRequest: (to) => F.deleteDoc(reqDoc(me(), to)),
    declineRequest: (from) => F.deleteDoc(reqDoc(from, me())),

    /** Anfrage annehmen: beide Freundeslisten + Anfrage(n) in einem Schritt. */
    async acceptRequest(from, alsoOutgoing) {
      const uid = me();
      const since = Date.now();
      const batch = F.writeBatch(fs);
      batch.set(friendDoc(uid, from), { since });
      batch.set(friendDoc(from, uid), { since });
      batch.delete(reqDoc(from, uid));
      if (alsoOutgoing) batch.delete(reqDoc(uid, from));
      await batch.commit();
    },

    /** Freundschaft auf beiden Seiten beenden. */
    async removeFriend(fid) {
      const uid = me();
      const batch = F.writeBatch(fs);
      batch.delete(friendDoc(uid, fid));
      batch.delete(friendDoc(fid, uid));
      await batch.commit();
    },

    /**
     * Alles Soziale eines Kontos löschen: Profil, Benutzername, Foto, Freundschaften (beide Seiten)
     * und Anfragen. Für das eigene Konto oder – als Administrator – für ein fremdes.
     */
    async deleteAll(uid) {
      const id = uid || me();
      const [prof, friends, rin, rout] = await Promise.all([
        F.getDoc(profileDoc(id)),
        F.getDocs(friendsCol(id)),
        F.getDocs(F.query(requestsCol(), F.where('to', '==', id))),
        F.getDocs(F.query(requestsCol(), F.where('from', '==', id))),
      ]);
      const ops = [];
      for (const f of friends.docs) {
        ops.push((b) => b.delete(friendDoc(f.id, id)));
        ops.push((b) => b.delete(friendDoc(id, f.id)));
      }
      for (const r of rin.docs.concat(rout.docs)) ops.push((b) => b.delete(r.ref));
      const name = prof.exists() ? prof.data().username : null;
      if (name) {
        const u = await F.getDoc(usernameDoc(name));
        if (u.exists() && u.data().uid === id) ops.push((b) => b.delete(usernameDoc(name)));
      }
      ops.push((b) => b.delete(profileDoc(id)));
      await commitAll(ops);
      await api.deletePhoto(id);
    },
  };
  return api;
}
