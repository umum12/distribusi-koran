/* db.js — IndexedDB dan seluruh operasi data lokal.
 *
 * Store:
 *   sessions : id, startedAt, endedAt, petugasName, reportTitle, captionMode, archived, photoCount, ...
 *   photos   : id, sessionId, sequence, receivedAt, manualCaption, blob, thumb, mimeType, size, width, height
 *   settings : { key, value }  (petugasName, reportTitle, logoBlob, ...)
 *
 * Nomor AREA otomatis TIDAK disimpan di sini. Nomor itu dihitung saat tampilan/PDF dibuat.
 */
'use strict';

const DB = (() => {
  const NAME = 'distribusi-koran';
  const VERSION = 1;
  const MAXKEY = Number.MAX_SAFE_INTEGER;

  const DEFAULTS = {
    petugasName: 'PETUGAS DISTRIBUSI',
    reportTitle: 'LAPORAN BUKTI DISTRIBUSI KORAN',
    lastAutoCaption: true,
    lastBackupAt: null,
  };

  let dbPromise = null;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('NO_IDB'));
      let req;
      try {
        req = indexedDB.open(NAME, VERSION);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains('photos')) {
          const p = db.createObjectStore('photos', { keyPath: 'id' });
          p.createIndex('sessionId', 'sessionId');
          p.createIndex('session_seq', ['sessionId', 'sequence']);
          p.createIndex('receivedAt', 'receivedAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB_BLOCKED'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  const r2p = (rq) =>
    new Promise((res, rej) => {
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });

  /* Menjalankan fn di dalam satu transaksi. Promise selesai setelah transaksi COMMIT.
   * Jika fn melempar error, transaksi dibatalkan (tidak ada perubahan setengah jalan). */
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result;
      let t;
      try {
        t = db.transaction(stores, mode);
      } catch (e) {
        return reject(e);
      }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('TX_ABORT'));
      (async () => {
        try {
          result = await fn(t);
        } catch (e) {
          try {
            t.abort();
          } catch (_) {
            /* sudah selesai */
          }
          reject(e);
        }
      })();
    });
  }

  const seqRange = (sid) => IDBKeyRange.bound([sid, 0], [sid, MAXKEY]);

  /* ---------- Pengaturan ---------- */
  async function getSettings() {
    const rows = await tx(['settings'], 'readonly', (t) => r2p(t.objectStore('settings').getAll()));
    const s = { ...DEFAULTS };
    rows.forEach((r) => {
      s[r.key] = r.value;
    });
    return s;
  }

  async function setSettings(obj) {
    await tx(['settings'], 'readwrite', async (t) => {
      const st = t.objectStore('settings');
      Object.entries(obj).forEach(([k, v]) => {
        if (v !== undefined) st.put({ key: k, value: v });
      });
    });
  }

  async function deleteSetting(key) {
    await tx(['settings'], 'readwrite', async (t) => {
      t.objectStore('settings').delete(key);
    });
  }

  /* ---------- Sesi ---------- */
  async function createSession({ petugasName, reportTitle, captionMode }) {
    const now = Date.now();
    const s = {
      id: uid(),
      createdAt: now,
      startedAt: now,
      endedAt: null,
      petugasName,
      reportTitle,
      captionMode: captionMode === 'manual' ? 'manual' : 'auto',
      archived: false,
      photoCount: 0,
      pdfGeneratedAt: null,
      pdfPages: null,
    };
    await tx(['sessions'], 'readwrite', async (t) => {
      t.objectStore('sessions').put(s);
    });
    return s;
  }

  function getSession(id) {
    return tx(['sessions'], 'readonly', (t) => r2p(t.objectStore('sessions').get(id)));
  }

  async function updateSession(id, patch) {
    return tx(['sessions'], 'readwrite', async (t) => {
      const st = t.objectStore('sessions');
      const cur = await r2p(st.get(id));
      if (!cur) throw new Error('SESSION_NOT_FOUND');
      const next = { ...cur, ...patch };
      st.put(next);
      return next;
    });
  }

  async function listSessions() {
    const all = await tx(['sessions'], 'readonly', (t) => r2p(t.objectStore('sessions').getAll()));
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async function getActiveSession() {
    const all = await listSessions();
    return all.find((s) => !s.endedAt) || null;
  }

  /* ---------- Foto ---------- */
  async function addPhoto(sessionId, data) {
    return tx(['photos', 'sessions'], 'readwrite', async (t) => {
      const ps = t.objectStore('photos');
      const ss = t.objectStore('sessions');
      const sess = await r2p(ss.get(sessionId));
      if (!sess) throw new Error('SESSION_NOT_FOUND');
      const last = await new Promise((res, rej) => {
        const rq = ps.index('session_seq').openCursor(seqRange(sessionId), 'prev');
        rq.onsuccess = () => res(rq.result ? rq.result.value.sequence : 0);
        rq.onerror = () => rej(rq.error);
      });
      const photo = {
        id: uid(),
        sessionId,
        sequence: last + 1,
        receivedAt: data.receivedAt,
        manualCaption: data.manualCaption || '',
        blob: data.blob,
        thumb: data.thumb || null,
        mimeType: data.blob.type || data.mimeType || '',
        size: data.blob.size,
        width: data.width || null,
        height: data.height || null,
      };
      ps.put(photo);
      const cnt = await r2p(ps.index('sessionId').count(sessionId));
      sess.photoCount = cnt;
      sess.pdfGeneratedAt = null;
      ss.put(sess);
      return photo;
    });
  }

  function getPhotos(sessionId) {
    return tx(['photos'], 'readonly', (t) =>
      r2p(t.objectStore('photos').index('session_seq').getAll(seqRange(sessionId)))
    );
  }

  function getPhoto(id) {
    return tx(['photos'], 'readonly', (t) => r2p(t.objectStore('photos').get(id)));
  }

  function getAllPhotos() {
    return tx(['photos'], 'readonly', (t) => r2p(t.objectStore('photos').getAll()));
  }

  async function updatePhotoCaption(id, caption) {
    return tx(['photos', 'sessions'], 'readwrite', async (t) => {
      const ps = t.objectStore('photos');
      const ss = t.objectStore('sessions');
      const p = await r2p(ps.get(id));
      if (!p) throw new Error('PHOTO_NOT_FOUND');
      p.manualCaption = caption;
      ps.put(p);
      const sess = await r2p(ss.get(p.sessionId));
      if (sess) {
        sess.pdfGeneratedAt = null;
        ss.put(sess);
      }
      return p;
    });
  }

  async function deletePhoto(id) {
    return tx(['photos', 'sessions'], 'readwrite', async (t) => {
      const ps = t.objectStore('photos');
      const ss = t.objectStore('sessions');
      const p = await r2p(ps.get(id));
      if (!p) return null;
      ps.delete(id);
      const cnt = await r2p(ps.index('sessionId').count(p.sessionId));
      const sess = await r2p(ss.get(p.sessionId));
      if (sess) {
        sess.photoCount = cnt;
        sess.pdfGeneratedAt = null;
        ss.put(sess);
      }
      return p.sessionId;
    });
  }

  /* Menghapus sesi beserta seluruh fotonya dalam satu transaksi. */
  async function deleteSessions(ids) {
    return tx(['photos', 'sessions'], 'readwrite', async (t) => {
      const ps = t.objectStore('photos');
      const ss = t.objectStore('sessions');
      const idx = ps.index('sessionId');
      let photos = 0;
      for (const id of ids) {
        const keys = await r2p(idx.getAllKeys(id));
        keys.forEach((k) => ps.delete(k));
        photos += keys.length;
        ss.delete(id);
      }
      return { sessions: ids.length, photos };
    });
  }

  async function clearDistribution() {
    await tx(['photos', 'sessions'], 'readwrite', async (t) => {
      t.objectStore('photos').clear();
      t.objectStore('sessions').clear();
    });
  }

  async function resetAll() {
    await tx(['photos', 'sessions', 'settings'], 'readwrite', async (t) => {
      t.objectStore('photos').clear();
      t.objectStore('sessions').clear();
      t.objectStore('settings').clear();
    });
  }

  async function counts() {
    return tx(['photos', 'sessions'], 'readonly', async (t) => ({
      sessions: await r2p(t.objectStore('sessions').count()),
      photos: await r2p(t.objectStore('photos').count()),
    }));
  }

  /* Menyamakan photoCount tiap sesi dengan jumlah foto sebenarnya. Tidak menghapus data apa pun. */
  async function reconcile() {
    try {
      await tx(['photos', 'sessions'], 'readwrite', async (t) => {
        const counts = new Map();
        await new Promise((res, rej) => {
          const rq = t.objectStore('photos').index('sessionId').openKeyCursor();
          rq.onsuccess = () => {
            const c = rq.result;
            if (c) {
              counts.set(c.key, (counts.get(c.key) || 0) + 1);
              c.continue();
            } else res();
          };
          rq.onerror = () => rej(rq.error);
        });
        const ss = t.objectStore('sessions');
        const all = await r2p(ss.getAll());
        for (const s of all) {
          const n = counts.get(s.id) || 0;
          if (s.photoCount !== n) {
            s.photoCount = n;
            ss.put(s);
          }
        }
      });
    } catch (e) {
      console.warn('reconcile gagal', e);
    }
  }

  /* ---------- Dukungan restore ---------- */
  function getSessionIds() {
    return tx(['sessions'], 'readonly', (t) => r2p(t.objectStore('sessions').getAllKeys()));
  }

  function getPhotoIds() {
    return tx(['photos'], 'readonly', (t) => r2p(t.objectStore('photos').getAllKeys()));
  }

  async function putSession(s) {
    await tx(['sessions'], 'readwrite', async (t) => {
      t.objectStore('sessions').put(s);
    });
  }

  async function putPhotos(list) {
    await tx(['photos'], 'readwrite', async (t) => {
      const st = t.objectStore('photos');
      list.forEach((p) => st.put(p));
    });
  }

  async function removeByIds({ sessions = [], photos = [] }) {
    await tx(['photos', 'sessions'], 'readwrite', async (t) => {
      const ps = t.objectStore('photos');
      const ss = t.objectStore('sessions');
      photos.forEach((id) => ps.delete(id));
      sessions.forEach((id) => ss.delete(id));
    });
  }

  async function recount(sessionIds) {
    await tx(['photos', 'sessions'], 'readwrite', async (t) => {
      const ps = t.objectStore('photos');
      const ss = t.objectStore('sessions');
      for (const id of sessionIds) {
        const s = await r2p(ss.get(id));
        if (!s) continue;
        s.photoCount = await r2p(ps.index('sessionId').count(id));
        ss.put(s);
      }
    });
  }

  return {
    DEFAULTS,
    open,
    uid,
    getSettings,
    setSettings,
    deleteSetting,
    createSession,
    getSession,
    updateSession,
    listSessions,
    getActiveSession,
    addPhoto,
    getPhotos,
    getPhoto,
    getAllPhotos,
    updatePhotoCaption,
    deletePhoto,
    deleteSessions,
    clearDistribution,
    resetAll,
    counts,
    reconcile,
    getSessionIds,
    getPhotoIds,
    putSession,
    putPhotos,
    removeByIds,
    recount,
  };
})();
