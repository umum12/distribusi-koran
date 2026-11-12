/* backup.js — Backup & Restore ZIP (JSZip, vendor/jszip.min.js).
 *
 * Struktur ZIP:
 *   manifest.json            versi format, tanggal, jumlah sesi/foto
 *   data/settings.json       pengaturan identitas
 *   data/logo.png            logo (jika ada)
 *   data/sessions.json       semua sesi
 *   data/photos.json         metadata foto + path file
 *   photos/photo_001.jpg ... foto ASLI (bukan thumbnail)
 *
 * Strategi restore: GABUNGKAN berdasarkan ID unik.
 *   - Sesi yang ID-nya sudah ada di perangkat dilewati (tidak ditimpa) beserta fotonya.
 *   - Sesi baru dipulihkan lengkap. Jika gagal di tengah jalan, semua yang sempat ditulis dibatalkan.
 *   - Pengaturan identitas hanya diganti jika pengguna memilihnya secara eksplisit.
 */
'use strict';

const Backup = (() => {
  const APP_ID = 'distribusi-koran-pwa';
  const FORMAT_VERSION = 1;

  const userErr = (message, cause) => {
    const e = new Error(message);
    e.userMessage = message;
    e.cause = cause;
    return e;
  };

  const EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/heic': 'heic', 'image/heif': 'heif',
  };
  const extFor = (mime) => EXT[String(mime || '').toLowerCase()] || 'jpg';

  function mapStorageError(e, fallback) {
    const n = (e && e.name) || '';
    const m = String((e && e.message) || '');
    if (n === 'QuotaExceededError' || /quota/i.test(m)) {
      return userErr('Ruang penyimpanan perangkat tidak cukup. Kosongkan ruang lalu coba lagi.', e);
    }
    if (n === 'RangeError' || /memory|allocation/i.test(m)) {
      return userErr('Memori (RAM) perangkat tidak cukup untuk proses ini. Tutup aplikasi lain lalu coba lagi.', e);
    }
    return userErr(fallback, e);
  }

  async function summary() {
    const [sessions, photos] = await Promise.all([DB.listSessions(), DB.getAllPhotos()]);
    return {
      sessions: sessions.length,
      photos: photos.length,
      bytes: photos.reduce((a, p) => a + (p.size || (p.blob && p.blob.size) || 0), 0),
    };
  }

  /* ------------------------------- BACKUP ------------------------------- */
  async function create(onProgress = () => {}) {
    try {
      onProgress(0, 'Membaca data…');
      const [sessions, photos, settings] = await Promise.all([DB.listSessions(), DB.getAllPhotos(), DB.getSettings()]);
      photos.sort((a, b) => a.receivedAt - b.receivedAt || a.sequence - b.sequence);

      const zip = new JSZip();
      const width = Math.max(3, String(photos.length).length);
      const photoMeta = photos.map((p, i) => {
        const file = `photos/photo_${String(i + 1).padStart(width, '0')}.${extFor(p.mimeType)}`;
        zip.file(file, p.blob, { binary: true, compression: 'STORE' });
        return {
          id: p.id, sessionId: p.sessionId, sequence: p.sequence, receivedAt: p.receivedAt,
          manualCaption: p.manualCaption || '', mimeType: p.mimeType || '', size: p.size || p.blob.size,
          width: p.width || null, height: p.height || null, file,
        };
      });

      const settingsOut = {
        petugasName: settings.petugasName,
        reportTitle: settings.reportTitle,
        lastAutoCaption: !!settings.lastAutoCaption,
        hasLogo: false,
        logoFile: null,
      };
      if (settings.logoBlob) {
        const file = 'data/logo.png'; // logo selalu disimpan aplikasi sebagai PNG
        zip.file(file, settings.logoBlob, { binary: true, compression: 'STORE' });
        settingsOut.hasLogo = true;
        settingsOut.logoFile = file;
      }

      const createdAt = Date.now();
      const manifest = {
        app: APP_ID,
        formatVersion: FORMAT_VERSION,
        createdAt,
        createdAtText: Fmt.dateTime(createdAt, true),
        sessionCount: sessions.length,
        photoCount: photos.length,
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      zip.file('data/settings.json', JSON.stringify(settingsOut, null, 2));
      zip.file('data/sessions.json', JSON.stringify(sessions, null, 2));
      zip.file('data/photos.json', JSON.stringify(photoMeta, null, 2));

      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE', streamFiles: true },
        (m) => onProgress(Math.round(m.percent), 'Membuat file ZIP…')
      );
      if (!blob || !blob.size) throw new Error('EMPTY_ZIP');
      return {
        blob,
        fileName: `backup-distribusi_${Fmt.stamp(createdAt)}.zip`,
        sessions: sessions.length,
        photos: photos.length,
      };
    } catch (e) {
      if (e && e.userMessage) throw e;
      throw mapStorageError(e, 'Backup gagal dibuat. Silakan coba lagi.');
    }
  }

  /* ------------------------------- RESTORE ------------------------------ */
  async function inspect(file) {
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      throw userErr('File ini bukan backup yang valid (ZIP rusak atau tidak dapat dibuka).', e);
    }
    const readJson = async (path) => {
      const f = zip.file(path);
      if (!f) throw userErr(`File backup tidak lengkap: ${path} tidak ditemukan.`);
      try {
        return JSON.parse(await f.async('string'));
      } catch (e) {
        throw userErr(`File backup rusak: ${path} tidak dapat dibaca.`, e);
      }
    };

    const manifest = await readJson('manifest.json');
    if (!manifest || manifest.app !== APP_ID) {
      throw userErr('Format backup tidak dikenal. File ini bukan backup aplikasi Distribusi Koran.');
    }
    if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > FORMAT_VERSION) {
      throw userErr('Versi backup lebih baru daripada aplikasi ini. Perbarui aplikasi lalu coba lagi.');
    }
    const sessionsRaw = await readJson('data/sessions.json');
    const photosRaw = await readJson('data/photos.json');
    const settings = await readJson('data/settings.json');
    if (!Array.isArray(sessionsRaw) || !Array.isArray(photosRaw)) {
      throw userErr('File backup rusak: struktur data tidak sesuai.');
    }
    if (manifest.sessionCount !== sessionsRaw.length || manifest.photoCount !== photosRaw.length) {
      throw userErr('File backup rusak: jumlah data tidak cocok dengan manifest.');
    }

    // Buang duplikat ID di dalam backup itu sendiri
    const uniq = (arr) => {
      const seen = new Set();
      return arr.filter((x) => x && typeof x.id === 'string' && !seen.has(x.id) && seen.add(x.id));
    };
    const sessions = uniq(sessionsRaw);
    const photos = uniq(photosRaw);
    if (sessions.some((s) => typeof s.startedAt !== 'number')) {
      throw userErr('File backup rusak: ada sesi tanpa waktu mulai.');
    }
    let missing = 0;
    photos.forEach((p) => {
      if (typeof p.sessionId !== 'string' || typeof p.receivedAt !== 'number' || !p.file || !zip.file(p.file)) missing++;
    });
    if (missing) throw userErr(`File backup rusak: ${missing} foto tidak ditemukan di dalam ZIP.`);

    const [localSessionIds, localPhotoIds] = await Promise.all([DB.getSessionIds(), DB.getPhotoIds()]);
    const localS = new Set(localSessionIds);
    const localP = new Set(localPhotoIds);
    const backupSessionIds = new Set(sessions.map((s) => s.id));
    const newSessions = sessions.filter((s) => !localS.has(s.id));
    const newSessionIds = new Set(newSessions.map((s) => s.id));
    const orphans = photos.filter((p) => !backupSessionIds.has(p.sessionId)).length;
    const newPhotos = photos
      .filter((p) => newSessionIds.has(p.sessionId) && !localP.has(p.id))
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : a.sequence - b.sequence));

    return {
      zip, manifest, settings, sessions, photos, newSessions, newPhotos,
      skippedSessions: sessions.length - newSessions.length,
      orphans,
      needBytes: newPhotos.reduce((a, p) => a + (p.size || 0), 0),
    };
  }

  const cleanSession = (s) => ({
    id: s.id,
    createdAt: s.createdAt || s.startedAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt || null,
    petugasName: String(s.petugasName || DB.DEFAULTS.petugasName),
    reportTitle: String(s.reportTitle || DB.DEFAULTS.reportTitle),
    captionMode: s.captionMode === 'manual' ? 'manual' : 'auto',
    archived: !!s.archived,
    photoCount: 0, // dihitung ulang setelah foto masuk
    pdfGeneratedAt: s.pdfGeneratedAt || null,
    pdfPages: s.pdfPages || null,
  });

  async function restore(insp, { restoreSettings = false } = {}, onProgress = () => {}) {
    const { zip, newSessions, newPhotos } = insp;

    // Periksa ruang penyimpanan sebelum menulis apa pun
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (est && est.quota) {
          const free = est.quota - (est.usage || 0);
          const need = insp.needBytes * 1.15 + 5 * 1024 * 1024;
          if (free < need) {
            throw userErr(
              `Ruang penyimpanan tidak cukup. Dibutuhkan sekitar ${Fmt.bytes(need)}, tersedia sekitar ${Fmt.bytes(free)}. Tidak ada data yang diubah.`
            );
          }
        }
      } catch (e) {
        if (e && e.userMessage) throw e;
      }
    }

    const added = { sessions: [], photos: [] };
    try {
      onProgress(0, 'Memulihkan sesi…');
      for (const s of newSessions) {
        await DB.putSession(cleanSession(s));
        added.sessions.push(s.id);
      }

      const total = newPhotos.length;
      let done = 0;
      let batch = [];
      let batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await DB.putPhotos(batch);
        batch.forEach((r) => added.photos.push(r.id));
        batch = [];
        batchBytes = 0;
      };

      for (const p of newPhotos) {
        const raw = await zip.file(p.file).async('blob');
        const blob = new Blob([raw], { type: p.mimeType || raw.type || 'image/jpeg' });
        const th = await Img.makeThumb(blob);
        batch.push({
          id: p.id,
          sessionId: p.sessionId,
          sequence: p.sequence,
          receivedAt: p.receivedAt,
          manualCaption: p.manualCaption || '',
          blob,
          thumb: th.thumb,
          mimeType: blob.type,
          size: blob.size,
          width: th.width || p.width || null,
          height: th.height || p.height || null,
        });
        batchBytes += blob.size;
        done++;
        onProgress(Math.round((done / Math.max(total, 1)) * 100), `Memulihkan foto ${done} dari ${total}…`);
        if (batch.length >= 8 || batchBytes > 20 * 1024 * 1024) await flush();
      }
      await flush();
      await DB.recount(newSessions.map((s) => s.id));

      // Verifikasi
      onProgress(100, 'Memverifikasi…');
      const [sIds, pIds] = await Promise.all([DB.getSessionIds(), DB.getPhotoIds()]);
      const sSet = new Set(sIds);
      const pSet = new Set(pIds);
      const missS = newSessions.filter((s) => !sSet.has(s.id)).length;
      const missP = newPhotos.filter((p) => !pSet.has(p.id)).length;
      if (missS || missP) throw new Error('VERIFY_FAILED');
    } catch (e) {
      let rolledBack = true;
      try {
        await DB.removeByIds(added);
      } catch (_) {
        rolledBack = false;
      }
      const base = mapStorageError(e, 'Restore gagal.').userMessage;
      throw userErr(
        rolledBack
          ? `${base} Data yang sempat dipulihkan sudah dibatalkan, data Anda tetap seperti semula.`
          : `${base} Pembatalan otomatis juga gagal: sebagian data hasil restore mungkin tertinggal. Periksa menu Arsip.`,
        e
      );
    }

    // Pengaturan (opsional, hanya jika dipilih pengguna). Kegagalan di sini tidak membatalkan foto.
    let settingsRestored = false;
    let settingsError = false;
    if (restoreSettings && insp.settings) {
      try {
        const st = insp.settings;
        const patch = {};
        if (typeof st.petugasName === 'string' && st.petugasName.trim()) patch.petugasName = st.petugasName.trim();
        if (typeof st.reportTitle === 'string' && st.reportTitle.trim()) patch.reportTitle = st.reportTitle.trim();
        if (typeof st.lastAutoCaption === 'boolean') patch.lastAutoCaption = st.lastAutoCaption;
        await DB.setSettings(patch);
        if (st.hasLogo && st.logoFile && zip.file(st.logoFile)) {
          const raw = await zip.file(st.logoFile).async('blob');
          await DB.setSettings({ logoBlob: new Blob([raw], { type: 'image/png' }) });
        } else if (!st.hasLogo) {
          await DB.deleteSetting('logoBlob');
        }
        settingsRestored = true;
      } catch (e) {
        console.warn('Pengaturan gagal dipulihkan', e);
        settingsError = true;
      }
    }

    return {
      sessions: newSessions.length,
      photos: newPhotos.length,
      skippedSessions: insp.skippedSessions,
      orphans: insp.orphans,
      settingsRestored,
      settingsError,
      verified: true,
    };
  }

  return { summary, create, inspect, restore };
})();
