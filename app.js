/* app.js — navigasi dan seluruh alur aplikasi (UI).
 * Rute (hash): #/home  #/prepare  #/session/<id>  #/recap/<id>  #/archive  #/settings
 */
'use strict';

(function () {
  /* ============================ Utilitas dasar ============================ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const DAY = 86400000;
  const userMsg = (message) => {
    const e = new Error(message);
    e.userMessage = message;
    return e;
  };

  const ICON = {
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 7.5 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.5L15 4zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.1c-.8 0-1.5.3-2 .8l-7.1-4.2a3 3 0 0 0 0-1.4L16 7.2A3 3 0 1 0 15 5c0 .2 0 .4.1.7L8 9.9a3 3 0 1 0 0 4.2l7.1 4.2c-.1.2-.1.5-.1.7a3 3 0 1 0 3-2.9z"/></svg>',
    news: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1zm2 3v2h8V8zm0 4v2h8v-2zm0 4v1h8v-1z"/></svg>',
  };

  const ctx = { urls: [], sessionId: null, session: null, photos: [], pdf: null, pendingScroll: null, filtered: [] };
  const arch = {
    tab: 'sesi', q: '', date: '', status: 'all', select: false, selected: new Set(),
    pq: '', pdate: '', shown: 48, photos: null,
  };
  let renderSeq = 0;
  let deferredInstall = null;

  function objUrl(blob) {
    const u = URL.createObjectURL(blob);
    ctx.urls.push(u);
    return u;
  }
  function releaseUrls() {
    ctx.urls.forEach((u) => URL.revokeObjectURL(u));
    ctx.urls = [];
  }

  /* Pesan error ramah — detail teknis hanya ke console. */
  function friendly(e, fallback = 'Terjadi kesalahan. Silakan coba lagi.') {
    console.error(e);
    if (e && e.userMessage) return e.userMessage;
    const n = (e && e.name) || '';
    const m = String((e && e.message) || '');
    if (n === 'QuotaExceededError' || /quota/i.test(m)) {
      return 'Penyimpanan perangkat penuh. Lakukan backup, lalu hapus data yang tidak diperlukan atau kosongkan ruang di perangkat.';
    }
    if (m === 'NO_IDB' || m === 'IDB_BLOCKED') {
      return 'Penyimpanan lokal tidak dapat dibuka. Tutup tab/aplikasi lain milik situs ini lalu muat ulang.';
    }
    if (n === 'RangeError' || /memory|allocation/i.test(m)) {
      return 'Memori (RAM) perangkat tidak cukup. Tutup aplikasi lain lalu coba lagi.';
    }
    return fallback;
  }

  /* ================================ Toast ================================ */
  function toast(msg, kind = 'info', ms = 3200, action = null) {
    const root = $('#toast-root');
    while (root.children.length >= 3) root.firstChild.remove();
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', 'status');
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.onclick = () => {
        el.remove();
        action.onClick();
      };
      el.appendChild(b);
    }
    root.appendChild(el);
    if (ms > 0) setTimeout(() => el.remove(), ms);
    return el;
  }

  /* ================================ Modal ================================ */
  function showModal({ title, bodyHTML = '', buttons, validate, collect, locked = false, onOpen }) {
    buttons = buttons || [{ label: 'OK', value: 'ok', cls: 'btn-primary' }];
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="modal-body">${bodyHTML}</div><p class="modal-error" hidden></p><div class="modal-actions"></div></div>`;
      const actions = $('.modal-actions', wrap);
      const errEl = $('.modal-error', wrap);
      const close = (action) => {
        const data = collect ? collect(wrap) : null;
        wrap.remove();
        if (!$('.viewer')) document.body.classList.remove('modal-open');
        resolve({ action, data });
      };
      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${b.cls || 'btn-ghost'}`;
        btn.textContent = b.label;
        btn.onclick = () => {
          if (validate && b.value !== 'cancel' && b.validate !== false) {
            const err = validate(wrap, b.value);
            if (err) {
              errEl.textContent = err;
              errEl.hidden = false;
              return;
            }
          }
          close(b.value);
        };
        actions.appendChild(btn);
      });
      if (!locked) wrap.addEventListener('click', (e) => { if (e.target === wrap) close('cancel'); });
      $('#modal-root').appendChild(wrap);
      document.body.classList.add('modal-open');
      if (onOpen) onOpen(wrap);
    });
  }

  /* `message` adalah HTML tepercaya: escape nilai dinamis dengan esc() di pemanggil. */
  async function confirmDialog({ title, message, confirmText = 'Ya', cancelText = 'Batal', danger = false, typeWord = null }) {
    const typed = typeWord
      ? `<p class="muted small">Ketik <b>${esc(typeWord)}</b> untuk melanjutkan:</p><input class="input" id="typeConfirm" autocomplete="off" autocapitalize="characters">`
      : '';
    const r = await showModal({
      title,
      bodyHTML: `<p>${message}</p>${typed}`,
      buttons: [
        { label: cancelText, value: 'cancel', cls: 'btn-ghost' },
        { label: confirmText, value: 'ok', cls: danger ? 'btn-danger' : 'btn-primary' },
      ],
      validate: typeWord
        ? (el) => ($('#typeConfirm', el).value.trim().toUpperCase() === typeWord ? null : `Ketik "${typeWord}" dengan benar.`)
        : null,
    });
    return r.action === 'ok';
  }

  async function infoDialog(title, html, okLabel = 'Tutup') {
    await showModal({ title, bodyHTML: html, buttons: [{ label: okLabel, value: 'ok', cls: 'btn-primary' }] });
  }

  async function askCaption({ blob = null, initial = '', title = 'Keterangan foto', cancelLabel = 'Batal', locked = false } = {}) {
    const url = blob ? URL.createObjectURL(blob) : null;
    try {
      const r = await showModal({
        title,
        locked,
        bodyHTML:
          (url ? `<img class="cap-preview" src="${url}" alt="Pratinjau foto">` : '') +
          `<label class="label" for="capInput">Keterangan (wajib diisi)</label>` +
          `<input id="capInput" class="input" type="text" maxlength="120" autocomplete="off" autocapitalize="sentences" placeholder="Contoh: Lobi Gedung A lantai 2" value="${esc(initial)}">`,
        buttons: [
          { label: cancelLabel, value: 'cancel', cls: 'btn-ghost' },
          { label: 'Simpan', value: 'save', cls: 'btn-primary' },
        ],
        validate: (el) => ($('#capInput', el).value.trim() ? null : 'Keterangan tidak boleh kosong.'),
        collect: (el) => $('#capInput', el).value.trim(),
        onOpen: (el) => {
          const input = $('#capInput', el);
          setTimeout(() => input.focus(), 60);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              $('.btn-primary', el).click();
            }
          });
        },
      });
      return r.action === 'save' ? r.data : null;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  /* ============================ Overlay proses ============================ */
  const busy = {
    el: $('#busy'),
    show(text) {
      $('#busy-text').textContent = text || 'Memproses…';
      $('#busy-sub').textContent = '';
      $('#busy-bar').style.width = '0%';
      this.el.hidden = false;
      document.body.classList.add('modal-open');
    },
    set(text, done, total) {
      if (text) $('#busy-text').textContent = text;
      if (total) {
        const pct = clamp((done / total) * 100, 0, 100);
        $('#busy-bar').style.width = `${pct}%`;
        $('#busy-sub').textContent = total === 100 ? `${Math.round(pct)}%` : `${done} dari ${total}`;
      }
    },
    hide() {
      this.el.hidden = true;
      if (!$('.viewer') && !$('.modal-backdrop')) document.body.classList.remove('modal-open');
    },
  };

  /* ============================ Info penyimpanan ============================ */
  const StorageInfo = {
    async get() {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      try {
        const e = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
        return { usage: e.usage || 0, quota: e.quota || 0, persisted };
      } catch (err) {
        return null;
      }
    },
    async persist() {
      if (!navigator.storage || !navigator.storage.persist) return null;
      try {
        return await navigator.storage.persist();
      } catch (e) {
        return null;
      }
    },
  };

  async function fillStorage(el, withPersist) {
    if (!el) return;
    const info = await StorageInfo.get();
    if (!el.isConnected) return;
    if (!info) {
      el.innerHTML = '<span class="muted small">Informasi kapasitas tidak tersedia di browser ini.</span>';
      return;
    }
    const pct = info.quota ? Math.min(100, (info.usage / info.quota) * 100) : 0;
    let html = `<div class="progress ${pct >= 80 ? 'high' : ''}"><div style="width:${pct.toFixed(1)}%"></div></div>`;
    html += `<div class="small muted">Terpakai ${esc(Fmt.bytes(info.usage))} dari sekitar ${esc(Fmt.bytes(info.quota))} (${pct.toFixed(1)}%)</div>`;
    if (pct >= 80) html += '<div class="hint warn">Penyimpanan hampir penuh. Segera lakukan backup, lalu hapus data yang tidak diperlukan.</div>';
    if (info.persisted === false) {
      html += '<div class="small muted">Penyimpanan belum bersifat persisten: browser dapat menghapus data jika ruang perangkat sangat sempit.</div>';
      if (withPersist) html += '<button class="btn btn-ghost btn-block" data-action="persist">Minta penyimpanan persisten</button>';
    } else if (info.persisted === true) {
      html += '<div class="small muted">Penyimpanan persisten aktif.</div>';
    }
    el.innerHTML = html;
  }

  async function tryPersist() {
    await StorageInfo.persist();
  }

  /* ================================ Router ================================ */
  const routes = {};
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, arg] = h.split('/');
    return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null };
  }
  function go(h) {
    if (location.hash === h) render();
    else location.hash = h;
  }
  function redirect(h) {
    if (location.hash === h) render();
    else location.replace(h);
  }
  function setNav(name) {
    const map = { home: 'home', prepare: 'start', session: 'start', archive: 'archive', recap: 'archive', settings: 'settings' };
    const on = map[name] || 'home';
    document.querySelectorAll('#nav a').forEach((a) => {
      const active = a.dataset.nav === on;
      a.classList.toggle('on', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  async function render(opts = {}) {
    const tok = ++renderSeq;
    const { name, arg } = parseHash();
    const y = opts.keepScroll ? window.scrollY : 0;
    releaseUrls();
    closeViewer();
    ctx.sessionId = null;
    ctx.pdf = null;
    setNav(name);
    const fn = routes[name] || routes.home;
    const commit = (html) => {
      if (tok !== renderSeq) return false;
      view.innerHTML = html;
      return true;
    };
    try {
      await fn(commit, arg);
      if (tok === renderSeq) {
        window.scrollTo(0, y);
        if (ctx.pendingScroll) {
          const t = $(ctx.pendingScroll);
          ctx.pendingScroll = null;
          if (t) t.scrollIntoView({ block: 'start' });
        }
      }
    } catch (e) {
      if (tok === renderSeq) {
        view.innerHTML = `<div class="container"><div class="hint err">${esc(friendly(e, 'Halaman tidak dapat ditampilkan.'))}</div><a class="btn btn-primary" href="#/home">Ke Beranda</a></div>`;
      }
    }
  }
  const refresh = () => render({ keepScroll: true });

  /* ============================ Label & helper ============================ */
  // Mode otomatis: AREA dihitung dari urutan foto aktif (tidak pernah disimpan).
  const labelFor = (session, i, photo) => (session.captionMode === 'manual' ? photo.manualCaption || '-' : `AREA ${i + 1}`);
  const modeText = (s) => (s.captionMode === 'manual' ? 'Manual' : 'Otomatis');
  const defaultPages = (n) => clamp(Math.ceil(n / 6), 1, Math.max(n, 1));

  /* ================================ BERANDA ================================ */
  routes.home = async function (commit) {
    const [counts, active, st] = await Promise.all([DB.counts(), DB.getActiveSession(), DB.getSettings()]);
    const logo = st.logoBlob ? `<img src="${objUrl(st.logoBlob)}" alt="Logo">` : ICON.news;
    const needBackup = counts.photos > 0 && (!st.lastBackupAt || Date.now() - st.lastBackupAt > 7 * DAY);
    const resume = active
      ? `<div class="card card-accent"><div><b>Sesi belum selesai</b><div class="muted small">${active.photoCount} foto · mulai ${esc(Fmt.time(active.startedAt))} WIB · ${esc(Fmt.dateShort(active.startedAt))}</div></div><a class="btn btn-primary" href="#/session/${esc(active.id)}">Lanjutkan Sesi</a></div>`
      : '';
    const backupNote = needBackup
      ? `<div class="card warn"><b>Disarankan backup</b><div class="small">${st.lastBackupAt ? `Backup terakhir: ${esc(Fmt.dateShort(st.lastBackupAt))}.` : 'Data belum pernah dibackup.'} Data hanya ada di perangkat ini dan dapat hilang jika data browser dihapus atau perangkat rusak/hilang.</div><a class="btn btn-ghost" href="#/settings">Buka Backup</a></div>`
      : '';
    if (
      !commit(`
      <header class="hero"><div class="hero-logo">${logo}</div><h1>Distribusi Koran</h1><p>Dokumentasi bukti distribusi</p></header>
      <section class="container">
        ${resume}
        <a class="btn btn-primary btn-xl btn-block" href="#/prepare">${ICON.camera}<span>${active ? 'Lanjutkan Distribusi' : 'Mulai Distribusi'}</span></a>
        <div class="stats"><div class="stat"><b>${counts.sessions}</b><span>Sesi dokumentasi</span></div><div class="stat"><b>${counts.photos}</b><span>Foto tersimpan</span></div></div>
        ${backupNote}
        <div class="card"><h3>Penyimpanan lokal</h3><div id="home-storage" class="muted small">Memeriksa…</div></div>
        <div class="row-btns"><a class="btn btn-ghost" href="#/archive">Arsip</a><a class="btn btn-ghost" href="#/settings">Pengaturan</a></div>
      </section>`)
    ) return;
    fillStorage($('#home-storage'), false);
  };

  /* ============================= PERSIAPAN SESI ============================= */
  routes.prepare = async function (commit) {
    const active = await DB.getActiveSession();
    if (active) {
      toast('Melanjutkan sesi yang belum selesai.');
      return redirect(`#/session/${active.id}`);
    }
    const st = await DB.getSettings();
    const autoHint = (on) =>
      on
        ? 'Tidak perlu mengisi keterangan. Foto langsung disimpan. Nomor AREA 1, 2, 3, … dibuat saat PDF dibuat, berdasarkan urutan foto yang masih tersimpan.'
        : 'Setiap foto wajib diberi keterangan (misalnya nama lokasi). Keterangan dapat diedit sebelum PDF dibuat.';
    commit(`
      <header class="topbar"><h1>Persiapan Sesi</h1></header>
      <section class="container">
        <div class="card">
          <span class="label">Nama petugas</span>
          <div class="readonly">${esc(st.petugasName)}</div>
          <a class="link" href="#/settings">Ubah di Pengaturan</a>
        </div>
        <label class="card check">
          <input type="checkbox" id="autoCaption" data-change="modeHint" ${st.lastAutoCaption ? 'checked' : ''}>
          <span><strong>Gunakan keterangan otomatis saat render PDF</strong><small>Paling cepat untuk banyak lokasi.</small></span>
        </label>
        <div id="modeHint" class="hint">${esc(autoHint(!!st.lastAutoCaption))}</div>
        <button class="btn btn-primary btn-xl btn-block" data-action="startSession">Mulai Sesi</button>
      </section>`);
    ctx.autoHint = autoHint;
  };

  /* ============================== SESI DISTRIBUSI ============================== */
  routes.session = async function (commit, id) {
    const s = id ? await DB.getSession(id) : null;
    if (!s) return redirect('#/home');
    if (s.endedAt) return redirect(`#/recap/${s.id}`);
    ctx.sessionId = s.id;
    ctx.session = s;
    const manual = s.captionMode === 'manual';
    if (
      !commit(`
      <header class="topbar"><h1>Sesi Distribusi</h1><span class="badge">Keterangan ${manual ? 'manual' : 'otomatis'}</span></header>
      <section class="container">
        <div class="card">
          <div><b id="sess-count" style="font-size:24px">0</b> foto tersimpan</div>
          <div class="muted small">${esc(s.petugasName)} · mulai ${esc(Fmt.time(s.startedAt))} WIB</div>
          ${manual ? '' : '<div class="small muted">Nomor AREA dibuat otomatis saat PDF dibuat.</div>'}
        </div>
        <label for="camInput" id="camBtn" class="btn btn-primary btn-xl btn-block" role="button">${ICON.camera}<span>Ambil Foto</span></label>
        <p id="save-status" class="muted center" hidden>Menyimpan foto…</p>
        <button class="btn btn-ghost btn-block" data-action="finishSession">Selesaikan Sesi</button>
        <div id="grid" class="grid"></div>
        <details class="small muted"><summary>Kamera tidak terbuka?</summary>
          <p style="margin-top:6px">Periksa izin Kamera untuk Chrome/aplikasi ini di Pengaturan Android, pastikan ada aplikasi kamera, lalu coba lagi. Jika foto tidak muncul setelah kembali dari kamera, ambil foto sekali lagi.</p></details>
      </section>`)
    ) return;
    await refreshSession();
  };

  function tileHTML(p, i, manual) {
    const img = p.thumb ? `<img src="${objUrl(p.thumb)}" alt="" loading="lazy">` : `<span class="tile-ph">${ICON.image}</span>`;
    return `<button class="tile" data-action="viewSessionPhoto" data-i="${i}" aria-label="Foto ${i + 1}">${img}<span class="tile-num">${i + 1}</span>${manual ? `<span class="tile-cap">${esc(p.manualCaption)}</span>` : ''}</button>`;
  }

  async function refreshSession() {
    const sid = ctx.sessionId;
    if (!sid) return;
    const [photos, session] = await Promise.all([DB.getPhotos(sid), DB.getSession(sid)]);
    if (ctx.sessionId !== sid || !session) return;
    ctx.photos = photos;
    ctx.session = session;
    releaseUrls();
    const manual = session.captionMode === 'manual';
    const countEl = $('#sess-count');
    const grid = $('#grid');
    if (!countEl || !grid) return;
    countEl.textContent = photos.length;
    grid.innerHTML = photos.length
      ? photos.map((p, i) => tileHTML(p, i, manual)).join('')
      : '<div class="empty" style="grid-column:1/-1">Belum ada foto.<br>Tekan <b>Ambil Foto</b> untuk memulai.</div>';
  }

  function setSaving(on) {
    const st = $('#save-status');
    const btn = $('#camBtn');
    if (st) st.hidden = !on;
    if (btn) btn.classList.toggle('disabled', on);
  }

  let captureQueue = Promise.resolve();
  function onCameraChange(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const sid = ctx.sessionId;
    if (!sid) return;
    if (!files.length) {
      toast('Tidak ada foto yang diterima dari kamera. Silakan coba lagi.', 'error', 4500);
      return;
    }
    files.forEach((f) => {
      const receivedAt = Date.now(); // waktu file diterima oleh PWA
      captureQueue = captureQueue
        .then(() => handleFile(sid, f, receivedAt))
        .catch((err) => toast(friendly(err, 'Foto gagal disimpan. Silakan ambil ulang.'), 'error', 6000));
    });
  }

  async function handleFile(sid, file, receivedAt) {
    const session = await DB.getSession(sid);
    if (!session || session.endedAt) throw userMsgSessionGone();
    if (!file || !file.size) throw userMsg('File foto kosong atau gagal diterima dari kamera. Silakan ambil foto ulang.');
    if (file.type && !/^image\//i.test(file.type)) throw userMsg('File yang diterima bukan foto. Silakan ambil foto ulang.');
    if (file.size > 40 * 1024 * 1024) throw userMsg('Ukuran foto terlalu besar (maksimal 40 MB). Turunkan resolusi kamera lalu ambil ulang.');

    let caption = '';
    if (session.captionMode === 'manual') {
      caption = await askCaption({ blob: file, cancelLabel: 'Buang Foto', locked: true });
      if (caption === null) {
        toast('Foto dibuang.');
        return;
      }
    }
    setSaving(true);
    try {
      const th = await Img.makeThumb(file);
      await DB.addPhoto(sid, { blob: file, thumb: th.thumb, width: th.width, height: th.height, receivedAt, manualCaption: caption });
      const fresh = await DB.getSession(sid);
      toast(`Foto ke-${fresh ? fresh.photoCount : '?'} tersimpan`, 'success', 1800);
    } finally {
      setSaving(false);
    }
    if (ctx.sessionId === sid) await refreshSession();
  }
  const userMsgSessionGone = () => userMsg('Sesi sudah selesai atau tidak ditemukan.');

  /* ================================ REKAP SESI ================================ */
  routes.recap = async function (commit, id) {
    const s = id ? await DB.getSession(id) : null;
    if (!s) return redirect('#/archive');
    if (!s.endedAt) return redirect(`#/session/${s.id}`);
    const photos = await DB.getPhotos(s.id);
    ctx.session = s;
    ctx.photos = photos;
    const manual = s.captionMode === 'manual';
    const n = photos.length;
    const rows = photos
      .map((p, i) => {
        const label = labelFor(s, i, p);
        const img = p.thumb ? `<img src="${objUrl(p.thumb)}" alt="">` : ICON.image;
        return `<div class="row">
          <button class="thumb" data-action="viewRecapPhoto" data-i="${i}" aria-label="Lihat foto ${i + 1}">${img}</button>
          <div class="row-main"><b class="${manual ? '' : 'calc'}">${i + 1}. ${esc(label)}</b><small>${esc(Fmt.dateTime(p.receivedAt, true))}</small></div>
          <div class="row-actions">
            ${manual ? `<button class="icon-btn" data-action="editCaption" data-id="${esc(p.id)}" aria-label="Edit keterangan">${ICON.edit}</button>` : ''}
            <button class="icon-btn danger" data-action="deletePhoto" data-id="${esc(p.id)}" aria-label="Hapus foto">${ICON.trash}</button>
          </div></div>`;
      })
      .join('');
    const pages = s.pdfPages && s.pdfPages <= n ? s.pdfPages : defaultPages(n);
    const pdfStatus = s.pdfGeneratedAt ? `PDF dibuat ${esc(Fmt.dateTime(s.pdfGeneratedAt, false))}` : 'PDF belum dibuat atau perlu dibuat ulang';
    if (
      !commit(`
      <header class="topbar"><h1>Rekap Sesi</h1><span class="badge">${s.archived ? 'Diarsipkan' : 'Aktif'}</span></header>
      <section class="container">
        <div class="card">
          <h3>${esc(Fmt.dateLong(s.startedAt))}</h3>
          <div class="small">Petugas: <b>${esc(s.petugasName)}</b></div>
          <div class="small">Waktu: ${esc(Fmt.time(s.startedAt))} – ${esc(Fmt.time(s.endedAt))} WIB</div>
          <div class="small">Mode keterangan: <b>${modeText(s)}</b> · Total foto: <b>${n}</b></div>
          <div class="small muted">${pdfStatus}</div>
          <div class="small muted">Waktu pada foto adalah waktu foto diterima aplikasi, bukan waktu shutter yang terverifikasi.${manual ? '' : ' Nomor AREA dihitung ulang setiap PDF dibuat, berdasarkan foto yang masih ada.'}</div>
        </div>

        <div class="card" id="pdf-card">
          <h3>Buat PDF</h3>
          ${
            n
              ? `<p class="small muted">A4 portrait. Foto dibagi merata ke halaman; sisa foto masuk ke halaman-halaman awal.</p>
          <span class="label">Jumlah halaman (1 – ${n})</span>
          <div class="stepper">
            <button class="btn" data-action="pagesMinus" aria-label="Kurangi halaman">−</button>
            <input id="pages" class="input" type="number" inputmode="numeric" min="1" max="${n}" value="${pages}" data-input="pages" data-change="pagesFix">
            <button class="btn" data-action="pagesPlus" aria-label="Tambah halaman">+</button>
          </div>
          <div id="pdf-estimate" class="hint"></div>
          <button class="btn btn-primary btn-block" data-action="makePdf">Buat PDF</button>
          <div id="pdf-result" class="card" style="border:0;padding:0"></div>`
              : '<div class="hint warn">Sesi ini tidak memiliki foto, jadi PDF belum dapat dibuat.</div>'
          }
        </div>

        <h3>Daftar foto (${n})</h3>
        <div class="rows">${rows || '<div class="empty">Belum ada foto.</div>'}</div>

        <div class="row-btns">
          <button class="btn btn-primary" data-action="toggleArchive" data-id="${esc(s.id)}" data-back="1">${s.archived ? 'Kembalikan dari Arsip' : 'Simpan ke Arsip'}</button>
          <button class="btn btn-danger-outline" data-action="delSession" data-id="${esc(s.id)}" data-back="1">Hapus Sesi</button>
        </div>
      </section>`)
    ) return;
    if (n) paintEstimate();
  };

  function paintEstimate() {
    const el = $('#pdf-estimate');
    const inp = $('#pages');
    if (!el || !inp) return;
    const n = ctx.photos.length;
    const pages = clamp(parseInt(inp.value, 10) || 1, 1, n);
    const est = PdfBuilder.estimate(ctx.photos, pages);
    const c = est.counts;
    const dist = c.length <= 12 ? c.join(', ') : `${c[0]} – ${c[c.length - 1]}`;
    el.className = `hint${est.warn ? ' warn' : ''}`;
    el.innerHTML =
      `${pages} halaman · foto per halaman: <b>${esc(dist)}</b>` +
      (est.warn
        ? `<br>⚠ Foto akan tampil kecil (sisi terpanjang sekitar ${est.minEdgeCm.toFixed(1)} cm) dan bisa sulit dibaca saat dicetak. Pilih jumlah halaman lebih banyak jika perlu.`
        : '');
  }

  function paintPdfResult() {
    const el = $('#pdf-result');
    if (!el) return;
    const r = ctx.pdf;
    if (!r) {
      el.innerHTML = '';
      return;
    }
    const url = objUrl(r.blob);
    el.innerHTML = `
      <div class="hint ok"><b>PDF berhasil dibuat</b><br>${esc(r.fileName)}<br>${r.pages} halaman · ${r.photos} foto · ${esc(Fmt.bytes(r.blob.size))}</div>
      ${r.failed.length ? `<div class="hint warn">Foto nomor ${esc(r.failed.join(', '))} tidak dapat dibaca dan ditandai kosong di PDF.</div>` : ''}
      <div class="row-btns">
        <a class="btn btn-primary" href="${url}" download="${esc(r.fileName)}">${ICON.download} Download PDF</a>
        <button class="btn btn-ghost" data-action="sharePdf">${ICON.share} Bagikan PDF</button>
      </div>
      <p class="small muted">Foto asli tetap tersimpan di aplikasi.</p>`;
  }

  /* ================================== ARSIP ================================== */
  routes.archive = async function (commit) {
    if (!commit('<header class="topbar"><h1>Arsip</h1></header><section class="container"><div class="tabs" id="arch-tabs"></div><div id="arch-filters" class="filters"></div><div id="arch-list" class="rows"></div></section>')) return;
    if (arch.tab === 'foto') await loadArchivePhotos();
    paintArchiveTabs();
    paintArchiveFilters();
    await paintArchiveList();
  };

  function paintArchiveTabs() {
    $('#arch-tabs').innerHTML = `<button class="tab ${arch.tab === 'sesi' ? 'on' : ''}" data-action="archTab" data-tab="sesi">Sesi</button><button class="tab ${arch.tab === 'foto' ? 'on' : ''}" data-action="archTab" data-tab="foto">Foto</button>`;
  }

  function paintArchiveFilters() {
    const el = $('#arch-filters');
    if (arch.tab === 'sesi') {
      el.innerHTML = `
        <input class="input" type="search" placeholder="Cari nama petugas" value="${esc(arch.q)}" data-input="archQ" aria-label="Cari petugas">
        <div class="field-row">
          <input class="input" type="date" value="${esc(arch.date)}" data-input="archDate" aria-label="Filter tanggal">
          <select class="input" data-input="archStatus" aria-label="Filter status">
            <option value="all" ${arch.status === 'all' ? 'selected' : ''}>Semua status</option>
            <option value="active" ${arch.status === 'active' ? 'selected' : ''}>Tidak diarsipkan</option>
            <option value="archived" ${arch.status === 'archived' ? 'selected' : ''}>Diarsipkan</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="toggleSelect">${arch.select ? 'Selesai memilih' : 'Pilih beberapa sesi'}</button>`;
    } else {
      el.innerHTML = `
        <input class="input" type="search" placeholder="Cari keterangan, AREA, atau petugas" value="${esc(arch.pq)}" data-input="archPQ" aria-label="Cari foto">
        <input class="input" type="date" value="${esc(arch.pdate)}" data-input="archPDate" aria-label="Filter tanggal foto">
        <p class="small muted">Label AREA pada mode otomatis dihitung dari urutan foto aktif di sesinya.</p>`;
    }
  }

  function filteredSessions() {
    const q = arch.q.trim().toLowerCase();
    return ctx.sessions.filter((s) => {
      if (q && !s.petugasName.toLowerCase().includes(q)) return false;
      if (arch.date && Fmt.iso(s.startedAt) !== arch.date) return false;
      if (arch.status === 'active' && s.archived) return false;
      if (arch.status === 'archived' && !s.archived) return false;
      return true;
    });
  }

  function sessionCardHTML(s) {
    const status = !s.endedAt ? '<span class="pill warn">Sedang berlangsung</span>' : s.archived ? '<span class="pill gray">Diarsipkan</span>' : '<span class="pill">Aktif</span>';
    const pdf = s.endedAt ? (s.pdfGeneratedAt ? '<span class="pill ok">PDF sudah dibuat</span>' : '<span class="pill gray">PDF belum dibuat</span>') : '';
    const time = `${Fmt.time(s.startedAt)}${s.endedAt ? ' – ' + Fmt.time(s.endedAt) : ''} WIB`;
    const body = `<div class="head"><b>${esc(Fmt.dateLong(s.startedAt))}</b>${status}</div>
      <div class="muted small">${esc(s.petugasName)}</div>
      <div class="small">${s.photoCount} foto · ${esc(time)} · Mode ${modeText(s)}</div>
      <div>${pdf}</div>`;
    if (arch.select) {
      return `<label class="card sel"><input type="checkbox" data-change="selSession" data-id="${esc(s.id)}" ${arch.selected.has(s.id) ? 'checked' : ''}><div class="sess-card">${body}</div></label>`;
    }
    const open = s.endedAt ? `#/recap/${s.id}` : `#/session/${s.id}`;
    return `<div class="card sess-card">${body}<div class="row-btns">
      <a class="btn btn-sm btn-primary" href="${esc(open)}">Buka</a>
      ${s.endedAt ? `<button class="btn btn-sm" data-action="openPdf" data-id="${esc(s.id)}">Buat ulang PDF</button><button class="btn btn-sm" data-action="toggleArchive" data-id="${esc(s.id)}">${s.archived ? 'Kembalikan' : 'Arsipkan'}</button>` : ''}
      <button class="btn btn-sm btn-danger-outline" data-action="delSession" data-id="${esc(s.id)}">Hapus</button></div></div>`;
  }

  async function loadArchivePhotos() {
    const [photos, sessions] = await Promise.all([DB.getAllPhotos(), DB.listSessions()]);
    const sMap = new Map(sessions.map((s) => [s.id, s]));
    const by = new Map();
    photos
      .sort((a, b) => a.sequence - b.sequence)
      .forEach((p) => {
        if (!by.has(p.sessionId)) by.set(p.sessionId, []);
        by.get(p.sessionId).push(p);
      });
    const items = [];
    by.forEach((list, sid) => {
      const s = sMap.get(sid);
      if (!s) return;
      list.forEach((p, i) => items.push({ photo: p, session: s, label: labelFor(s, i, p) }));
    });
    items.sort((a, b) => b.photo.receivedAt - a.photo.receivedAt);
    arch.photos = items;
  }

  async function paintArchiveList() {
    const el = $('#arch-list');
    if (!el) return;
    if (arch.tab === 'sesi') {
      ctx.sessions = await DB.listSessions();
      const list = filteredSessions();
      let html = list.length ? list.map(sessionCardHTML).join('') : '<div class="empty">Belum ada sesi yang cocok.</div>';
      if (arch.select) {
        html += `<div class="bulkbar"><span>${arch.selected.size} dipilih</span><button class="btn btn-danger btn-sm" data-action="delSelected" ${arch.selected.size ? '' : 'disabled'}>Hapus terpilih</button></div>`;
      }
      releaseUrls();
      el.innerHTML = html;
    } else {
      if (!arch.photos) await loadArchivePhotos();
      const q = arch.pq.trim().toLowerCase();
      const items = arch.photos.filter((it) => {
        if (arch.pdate && Fmt.iso(it.photo.receivedAt) !== arch.pdate) return false;
        if (q && !`${it.label} ${it.session.petugasName}`.toLowerCase().includes(q)) return false;
        return true;
      });
      ctx.filtered = items;
      releaseUrls();
      const shown = items.slice(0, arch.shown);
      let html = '';
      if (!items.length) html = '<div class="empty">Belum ada foto yang cocok.</div>';
      else {
        html = `<div class="small muted">${items.length} foto</div><div class="grid">${shown
          .map((it, i) => {
            const img = it.photo.thumb ? `<img src="${objUrl(it.photo.thumb)}" alt="" loading="lazy">` : `<span class="tile-ph">${ICON.image}</span>`;
            return `<button class="tile" data-action="viewArchivePhoto" data-i="${i}" aria-label="Foto ${esc(it.label)}">${img}<span class="tile-cap">${esc(it.label)}<br>${esc(Fmt.dateShort(it.photo.receivedAt))}</span></button>`;
          })
          .join('')}</div>`;
        if (items.length > shown.length) html += '<button class="btn btn-ghost btn-block" data-action="moreArchive">Tampilkan lebih banyak</button>';
      }
      el.className = '';
      el.innerHTML = html;
      return;
    }
    el.className = 'rows';
  }

  /* ================================ PENGATURAN ================================ */
  routes.settings = async function (commit) {
    const [st, counts] = await Promise.all([DB.getSettings(), DB.counts()]);
    const logo = st.logoBlob ? `<img class="logo-prev" src="${objUrl(st.logoBlob)}" alt="Logo saat ini">` : `<div class="logo-prev logo-ph">${ICON.news}</div>`;
    if (
      !commit(`
      <header class="topbar"><h1>Pengaturan</h1></header>
      <section class="container">
        <div class="card">
          <h3>Identitas laporan</h3>
          <div style="display:flex;gap:14px;align-items:center">${logo}
            <div class="row-btns" style="flex:1">
              <label for="logoInput" class="btn btn-ghost btn-sm" role="button">${st.logoBlob ? 'Ganti logo' : 'Upload logo'}</label>
              ${st.logoBlob ? '<button class="btn btn-danger-outline btn-sm" data-action="removeLogo">Hapus logo</button>' : ''}
            </div>
          </div>
          <label class="label" for="set-name">Nama petugas</label>
          <input id="set-name" class="input" maxlength="60" value="${esc(st.petugasName)}" autocomplete="off">
          <label class="label" for="set-title">Judul PDF</label>
          <input id="set-title" class="input" maxlength="90" value="${esc(st.reportTitle)}" autocomplete="off">
          <button class="btn btn-primary" data-action="saveIdentity">Simpan Pengaturan</button>
          <p class="small muted">Perubahan berlaku untuk sesi baru. Sesi lama tetap memakai nama dan judul saat sesi dimulai.</p>
        </div>

        <div class="card">
          <h3>Penyimpanan</h3>
          <div id="set-storage" class="muted small">Memeriksa…</div>
          <p class="small muted">${counts.sessions} sesi · ${counts.photos} foto. Data hanya tersimpan di perangkat ini dan dapat hilang jika data situs/browser dihapus, perangkat rusak, atau hilang. Lakukan backup secara berkala.</p>
        </div>

        <div class="card">
          <h3>Backup &amp; Restore</h3>
          <p class="small muted">${st.lastBackupAt ? `Backup terakhir: ${esc(Fmt.dateTime(st.lastBackupAt, false))}` : 'Belum pernah backup.'}</p>
          <button class="btn btn-primary" data-action="doBackup">Backup Sekarang (ZIP)</button>
          <label for="restoreInput" class="btn btn-ghost" role="button">Restore dari Backup</label>
          <p class="small muted">Restore menggabungkan data berdasarkan ID: sesi yang sudah ada di perangkat ini tidak ditimpa.</p>
        </div>

        ${deferredInstall ? '<div class="card"><h3>Pasang aplikasi</h3><p class="small muted">Pasang ke layar utama agar terbuka seperti aplikasi biasa.</p><button class="btn btn-primary" data-action="installApp">Pasang Aplikasi</button></div>' : ''}

        <div class="card danger">
          <h3>Kelola data</h3>
          <p class="small">Mengarsipkan sesi tidak menghapus data. Tombol di bawah menghapus <b>permanen</b>.</p>
          <button class="btn btn-danger-outline" data-action="clearDistribution">Hapus seluruh data distribusi</button>
          <button class="btn btn-danger-outline" data-action="resetAll">Reset seluruh data aplikasi</button>
        </div>

        <div class="card">
          <h3>Tentang</h3>
          <p class="small muted">Foto diambil lewat kamera bawaan Android. Waktu yang tercatat adalah waktu foto diterima oleh aplikasi, bukan waktu shutter yang terverifikasi. Semua data dan PDF diproses di perangkat; tidak ada yang diunggah ke server.</p>
        </div>
      </section>`)
    ) return;
    fillStorage($('#set-storage'), true);
  };

  /* ===================== Viewer foto layar penuh ===================== */
  let viewer = null;
  function openViewer(items, index, opts = {}) {
    closeViewer();
    const el = document.createElement('div');
    el.className = 'viewer';
    el.id = 'viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
    document.body.classList.add('modal-open');
    viewer = { el, items, index, opts, url: null };
    paintViewer();
  }
  function closeViewer() {
    if (!viewer) return;
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    viewer.el.remove();
    viewer = null;
    if (!$('.modal-backdrop')) document.body.classList.remove('modal-open');
  }
  function paintViewer() {
    const v = viewer;
    if (!v) return;
    const it = v.items[v.index];
    if (v.url) URL.revokeObjectURL(v.url);
    v.url = URL.createObjectURL(it.photo.blob);
    const manual = it.session.captionMode === 'manual';
    v.el.innerHTML = `
      <div class="viewer-top"><button class="icon-btn" data-v="close" aria-label="Tutup">✕</button><span>${v.index + 1} / ${v.items.length}</span><span style="width:42px"></span></div>
      <div class="viewer-img"><img src="${v.url}" alt="Foto ${v.index + 1}">
        <div class="viewer-nav">
          <button data-v="prev" aria-label="Sebelumnya" ${v.index === 0 ? 'disabled' : ''}>‹</button>
          <button data-v="next" aria-label="Berikutnya" ${v.index === v.items.length - 1 ? 'disabled' : ''}>›</button>
        </div></div>
      <div class="viewer-info">
        <b>${esc(it.label)}</b>
        ${manual ? '' : '<span class="small muted">Nomor AREA dihitung otomatis saat PDF dibuat.</span>'}
        <span>${esc(Fmt.dateTime(it.photo.receivedAt, true))}</span>
        <span class="small muted">${esc(it.session.petugasName)} · sesi ${esc(Fmt.dateShort(it.session.startedAt))}</span>
        <div class="viewer-actions">
          ${manual ? `<button class="btn btn-ghost" data-v="edit">${ICON.edit} Edit keterangan</button>` : ''}
          ${v.opts.showOpenSession ? '<button class="btn btn-ghost" data-v="open">Buka sesi</button>' : ''}
          <button class="btn btn-danger-outline" data-v="del">${ICON.trash} Hapus</button>
        </div>
      </div>`;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('#viewer [data-v]');
    if (!b || !viewer) return;
    const v = viewer;
    const act = b.dataset.v;
    const it = v.items[v.index];
    try {
      if (act === 'close') closeViewer();
      else if (act === 'prev' && v.index > 0) {
        v.index--;
        paintViewer();
      } else if (act === 'next' && v.index < v.items.length - 1) {
        v.index++;
        paintViewer();
      } else if (act === 'edit') {
        const c = await askCaption({ blob: it.photo.thumb, initial: it.photo.manualCaption, title: 'Edit keterangan' });
        if (c === null || viewer !== v) return;
        await DB.updatePhotoCaption(it.photo.id, c);
        it.photo.manualCaption = c;
        it.label = c;
        paintViewer();
        if (v.opts.onChange) v.opts.onChange();
      } else if (act === 'del') {
        const manual = it.session.captionMode === 'manual';
        const ok = await confirmDialog({
          title: 'Hapus foto ini?',
          message: `Foto <b>${esc(it.label)}</b> akan dihapus permanen dan tidak ikut masuk PDF.${manual ? '' : ' Nomor AREA foto lain akan dihitung ulang saat PDF dibuat.'}`,
          confirmText: 'Hapus',
          danger: true,
        });
        if (!ok) return;
        await DB.deletePhoto(it.photo.id);
        closeViewer();
        toast('Foto dihapus.');
        if (v.opts.onChange) v.opts.onChange();
      } else if (act === 'open') {
        closeViewer();
        go(it.session.endedAt ? `#/recap/${it.session.id}` : `#/session/${it.session.id}`);
      }
    } catch (err) {
      toast(friendly(err), 'error', 5000);
    }
  });

  /* ================================ Aksi UI ================================ */
  const actions = {};
  const inputs = {};
  const changes = {};

  actions.startSession = async () => {
    const auto = $('#autoCaption').checked;
    const st = await DB.getSettings();
    const s = await DB.createSession({ petugasName: st.petugasName, reportTitle: st.reportTitle, captionMode: auto ? 'auto' : 'manual' });
    await DB.setSettings({ lastAutoCaption: auto });
    tryPersist();
    go(`#/session/${s.id}`);
  };
  changes.modeHint = (el) => {
    const h = $('#modeHint');
    if (h && ctx.autoHint) h.textContent = ctx.autoHint(el.checked);
  };

  actions.viewSessionPhoto = ({ i }) => {
    const items = ctx.photos.map((p, k) => ({ photo: p, session: ctx.session, label: labelFor(ctx.session, k, p) }));
    openViewer(items, +i, { onChange: refreshSession });
  };

  actions.finishSession = async () => {
    const s = ctx.session;
    const n = ctx.photos.length;
    if (!s) return;
    if (!n) {
      const ok = await confirmDialog({
        title: 'Sesi masih kosong',
        message: 'Belum ada foto di sesi ini. Batalkan dan hapus sesi kosong ini?',
        confirmText: 'Hapus sesi kosong',
        cancelText: 'Lanjutkan sesi',
        danger: true,
      });
      if (!ok) return;
      await DB.deleteSessions([s.id]);
      toast('Sesi kosong dihapus.');
      return go('#/home');
    }
    const ok = await confirmDialog({
      title: 'Selesaikan sesi?',
      message: `Sesi berisi <b>${n}</b> foto. Setelah selesai, Anda dapat memeriksa rekap dan membuat PDF.`,
      confirmText: 'Selesaikan',
    });
    if (!ok) return;
    await DB.updateSession(s.id, { endedAt: Date.now() });
    go(`#/recap/${s.id}`);
  };

  /* --- Rekap --- */
  actions.viewRecapPhoto = ({ i }) => {
    const items = ctx.photos.map((p, k) => ({ photo: p, session: ctx.session, label: labelFor(ctx.session, k, p) }));
    openViewer(items, +i, { onChange: refresh });
  };
  actions.editCaption = async ({ id }) => {
    const p = ctx.photos.find((x) => x.id === id);
    if (!p) return;
    const c = await askCaption({ blob: p.thumb, initial: p.manualCaption, title: 'Edit keterangan' });
    if (c === null) return;
    await DB.updatePhotoCaption(id, c);
    toast('Keterangan disimpan.', 'success', 1800);
    refresh();
  };
  actions.deletePhoto = async ({ id }) => {
    const idx = ctx.photos.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const manual = ctx.session.captionMode === 'manual';
    const ok = await confirmDialog({
      title: 'Hapus foto ini?',
      message: `Foto <b>${esc(labelFor(ctx.session, idx, ctx.photos[idx]))}</b> akan dihapus permanen dan tidak ikut masuk PDF.${manual ? '' : ' Nomor AREA foto lain akan dihitung ulang saat PDF dibuat.'}`,
      confirmText: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    await DB.deletePhoto(id);
    toast('Foto dihapus.');
    refresh();
  };
  const fixPages = () => {
    const inp = $('#pages');
    if (!inp) return;
    inp.value = clamp(parseInt(inp.value, 10) || 1, 1, Math.max(ctx.photos.length, 1));
    paintEstimate();
  };
  actions.pagesMinus = () => {
    const inp = $('#pages');
    inp.value = (parseInt(inp.value, 10) || 1) - 1;
    fixPages();
  };
  actions.pagesPlus = () => {
    const inp = $('#pages');
    inp.value = (parseInt(inp.value, 10) || 1) + 1;
    fixPages();
  };
  inputs.pages = () => paintEstimate();
  changes.pagesFix = fixPages;

  actions.makePdf = async () => {
    const s = ctx.session;
    const n = ctx.photos.length;
    if (!n) return toast('Belum ada foto.', 'error');
    fixPages();
    const pages = clamp(parseInt($('#pages').value, 10) || 1, 1, n);
    busy.show('Membuat PDF…');
    try {
      const settings = await DB.getSettings();
      const res = await PdfBuilder.build({
        session: s,
        photos: ctx.photos,
        pageCount: pages,
        logoBlob: settings.logoBlob || null,
        onProgress: (d, t, label) => busy.set(label, d, t),
      });
      ctx.pdf = res;
      ctx.session = await DB.updateSession(s.id, { pdfGeneratedAt: Date.now(), pdfPages: res.pages });
      paintPdfResult();
      const r = $('#pdf-result');
      if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {
      toast(friendly(e, 'PDF gagal dibuat. Coba kurangi jumlah foto per halaman atau tutup aplikasi lain, lalu ulangi.'), 'error', 7000);
    } finally {
      busy.hide();
    }
  };

  actions.sharePdf = async () => {
    const r = ctx.pdf;
    if (!r) return;
    const file = new File([r.blob], r.fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: r.fileName });
        toast('Menu bagikan ditutup. Pastikan PDF sudah terkirim di aplikasi tujuan.', 'info', 5000);
      } catch (e) {
        if (e && e.name === 'AbortError') toast('Berbagi dibatalkan. PDF tetap tersedia.');
        else {
          console.error(e);
          toast('Menu bagikan tidak dapat dibuka. Gunakan Download PDF lalu kirim manual.', 'error', 6000);
        }
      }
    } else {
      await infoDialog(
        'Berbagi file belum didukung',
        '<p>Browser atau perangkat ini belum mendukung berbagi file langsung.</p><p>Tekan <b>Download PDF</b>, lalu kirim lewat WhatsApp secara manual: buka chat → ikon lampiran → <b>Dokumen</b> → pilih file PDF dari folder Unduhan.</p>'
      );
    }
  };

  actions.toggleArchive = async ({ id }) => {
    const s = await DB.getSession(id);
    if (!s) return;
    await DB.updateSession(id, { archived: !s.archived });
    toast(s.archived ? 'Sesi dikembalikan dari arsip.' : 'Sesi disimpan ke arsip. Foto dan data tetap utuh.', 'success');
    refresh();
  };

  actions.delSession = async ({ id, back }) => {
    const s = await DB.getSession(id);
    if (!s) return;
    const ok = await confirmDialog({
      title: 'Hapus sesi ini?',
      message: `Sesi <b>${esc(Fmt.dateLong(s.startedAt))}</b> beserta <b>${s.photoCount}</b> foto akan dihapus <b>permanen</b>. Ini berbeda dari mengarsipkan, dan tidak bisa dibatalkan.`,
      confirmText: 'Hapus permanen',
      danger: true,
    });
    if (!ok) return;
    await DB.deleteSessions([id]);
    arch.selected.delete(id);
    arch.photos = null;
    toast('Sesi dihapus.');
    if (back) go('#/archive');
    else refresh();
  };

  actions.openPdf = ({ id }) => {
    ctx.pendingScroll = '#pdf-card';
    go(`#/recap/${id}`);
  };

  /* --- Arsip --- */
  actions.archTab = async ({ tab }) => {
    arch.tab = tab;
    if (tab === 'foto') {
      arch.shown = 48;
      await loadArchivePhotos();
    }
    paintArchiveTabs();
    paintArchiveFilters();
    await paintArchiveList();
  };
  inputs.archQ = (el) => { arch.q = el.value; paintArchiveList(); };
  inputs.archDate = (el) => { arch.date = el.value; paintArchiveList(); };
  inputs.archStatus = (el) => { arch.status = el.value; paintArchiveList(); };
  inputs.archPQ = (el) => { arch.pq = el.value; arch.shown = 48; paintArchiveList(); };
  inputs.archPDate = (el) => { arch.pdate = el.value; arch.shown = 48; paintArchiveList(); };
  actions.toggleSelect = () => {
    arch.select = !arch.select;
    arch.selected.clear();
    paintArchiveFilters();
    paintArchiveList();
  };
  changes.selSession = (el) => {
    if (el.checked) arch.selected.add(el.dataset.id);
    else arch.selected.delete(el.dataset.id);
    const bar = $('.bulkbar');
    if (bar) {
      $('span', bar).textContent = `${arch.selected.size} dipilih`;
      $('button', bar).disabled = !arch.selected.size;
    }
  };
  actions.delSelected = async () => {
    const ids = [...arch.selected];
    if (!ids.length) return;
    const sess = ctx.sessions.filter((s) => arch.selected.has(s.id));
    const photos = sess.reduce((a, s) => a + s.photoCount, 0);
    const ok = await confirmDialog({
      title: 'Hapus sesi terpilih?',
      message: `<b>${ids.length}</b> sesi beserta <b>${photos}</b> foto akan dihapus <b>permanen</b>. Tindakan ini tidak bisa dibatalkan.`,
      confirmText: 'Hapus permanen',
      danger: true,
    });
    if (!ok) return;
    await DB.deleteSessions(ids);
    arch.selected.clear();
    arch.select = false;
    arch.photos = null;
    toast(`${ids.length} sesi dihapus.`);
    paintArchiveFilters();
    await paintArchiveList();
  };
  actions.viewArchivePhoto = ({ i }) => {
    const items = ctx.filtered;
    openViewer(items, +i, {
      showOpenSession: true,
      onChange: async () => {
        await loadArchivePhotos();
        await paintArchiveList();
      },
    });
  };
  actions.moreArchive = async () => {
    arch.shown += 48;
    await paintArchiveList();
  };

  /* --- Pengaturan --- */
  actions.saveIdentity = async () => {
    const name = $('#set-name').value.trim();
    const title = $('#set-title').value.trim();
    if (!name || !title) return toast('Nama petugas dan judul PDF tidak boleh kosong.', 'error');
    await DB.setSettings({ petugasName: name, reportTitle: title });
    toast('Pengaturan disimpan. Berlaku untuk sesi baru.', 'success');
  };
  actions.removeLogo = async () => {
    const ok = await confirmDialog({ title: 'Hapus logo?', message: 'Logo tidak akan tampil di PDF berikutnya.', confirmText: 'Hapus', danger: true });
    if (!ok) return;
    await DB.deleteSetting('logoBlob');
    toast('Logo dihapus.');
    refresh();
  };
  actions.persist = async () => {
    const r = await StorageInfo.persist();
    if (r === true) toast('Penyimpanan persisten aktif.', 'success');
    else if (r === false) toast('Browser belum mengizinkan penyimpanan persisten. Tetap lakukan backup berkala.', 'info', 5500);
    else toast('Fitur ini tidak tersedia di browser ini.');
    refresh();
  };
  actions.installApp = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try {
      await deferredInstall.userChoice;
    } catch (e) { /* diabaikan */ }
    deferredInstall = null;
    refresh();
  };

  actions.doBackup = async () => {
    const sum = await Backup.summary();
    if (!sum.sessions && !sum.photos) return toast('Belum ada data distribusi untuk dibackup.', 'info');
    const ok = await confirmDialog({
      title: 'Backup data',
      message: `Akan dicadangkan <b>${sum.sessions}</b> sesi dan <b>${sum.photos}</b> foto asli (sekitar ${esc(Fmt.bytes(sum.bytes))}). Data di perangkat tidak dihapus.`,
      confirmText: 'Mulai Backup',
    });
    if (!ok) return;
    busy.show('Menyiapkan backup…');
    let res;
    try {
      res = await Backup.create((pct, label) => busy.set(label, pct, 100));
    } catch (e) {
      busy.hide();
      return infoDialog('Backup gagal', `<div class="hint err">${esc(friendly(e, 'Backup gagal dibuat.'))}</div>`);
    }
    busy.hide();
    const url = objUrl(res.blob);
    await showModal({
      title: 'File backup siap',
      bodyHTML: `<p><b>${esc(res.fileName)}</b><br>${res.sessions} sesi · ${res.photos} foto · ${esc(Fmt.bytes(res.blob.size))}</p>
        <a id="dlBackup" class="btn btn-primary btn-block" href="${url}" download="${esc(res.fileName)}">${ICON.download} Unduh Backup</a>
        <p class="small muted">Backup baru tersimpan di perangkat setelah Anda menekan Unduh. Simpan juga salinannya di tempat lain (mis. kirim ke diri sendiri atau Google Drive).</p>`,
      buttons: [{ label: 'Selesai', value: 'ok', cls: 'btn-ghost' }],
      onOpen: (el) => {
        $('#dlBackup', el).addEventListener('click', () => {
          DB.setSettings({ lastBackupAt: Date.now() });
        });
      },
    });
    refresh();
  };

  async function doRestore(file) {
    busy.show('Memeriksa file backup…');
    let insp;
    try {
      insp = await Backup.inspect(file);
    } catch (e) {
      busy.hide();
      return infoDialog('File backup tidak dapat dipakai', `<div class="hint err">${esc(friendly(e, 'File backup tidak valid.'))}</div>`);
    }
    busy.hide();
    const st = await DB.getSettings();
    const hasCustom = st.petugasName !== DB.DEFAULTS.petugasName || st.reportTitle !== DB.DEFAULTS.reportTitle || !!st.logoBlob;
    const nothingNew = !insp.newSessions.length;
    const body = `
      <table>
        <tr><td>Sesi di file backup</td><td>${insp.sessions.length}</td></tr>
        <tr><td>Sesi baru (akan dipulihkan)</td><td>${insp.newSessions.length}</td></tr>
        <tr><td>Sesi sudah ada (dilewati)</td><td>${insp.skippedSessions}</td></tr>
        <tr><td>Foto yang akan dipulihkan</td><td>${insp.newPhotos.length}</td></tr>
      </table>
      <p class="small muted">Data yang sudah ada di perangkat tidak ditimpa dan tidak digandakan. ${insp.orphans ? `${insp.orphans} foto tanpa sesi di backup akan dilewati.` : ''}</p>
      <label class="check"><input type="checkbox" id="rsSettings" ${hasCustom ? '' : 'checked'}><span>Pulihkan juga pengaturan identitas<small>Mengganti nama petugas, judul PDF, dan logo saat ini dengan isi backup.</small></span></label>
      ${nothingNew ? '<div class="hint">Semua sesi di backup ini sudah ada di perangkat. Tidak ada foto yang perlu dipulihkan.</div>' : ''}`;
    const r = await showModal({
      title: 'Restore dari backup',
      bodyHTML: body,
      buttons: [
        { label: 'Batal', value: 'cancel', cls: 'btn-ghost' },
        { label: 'Mulai Restore', value: 'go', cls: 'btn-primary' },
      ],
      collect: (el) => ({ settings: $('#rsSettings', el).checked }),
    });
    if (r.action !== 'go') return;
    if (nothingNew && !r.data.settings) return toast('Tidak ada data baru untuk dipulihkan.');
    busy.show('Memulihkan data…');
    try {
      const res = await Backup.restore(insp, { restoreSettings: r.data.settings }, (pct, label) => busy.set(label, pct, 100));
      busy.hide();
      arch.photos = null;
      await infoDialog(
        'Restore selesai',
        `<div class="hint ok"><b>Berhasil dan terverifikasi.</b><br>${res.sessions} sesi dan ${res.photos} foto dipulihkan. ${res.skippedSessions} sesi dilewati karena sudah ada.${res.settingsRestored ? '<br>Pengaturan identitas dipulihkan.' : ''}</div>${res.settingsError ? '<div class="hint warn">Foto dan sesi berhasil, tetapi pengaturan identitas gagal dipulihkan.</div>' : ''}`
      );
    } catch (e) {
      busy.hide();
      await infoDialog('Restore gagal', `<div class="hint err">${esc(friendly(e, 'Restore gagal.'))}</div>`);
    }
    refresh();
  }

  actions.clearDistribution = async () => {
    const c = await DB.counts();
    if (!c.sessions && !c.photos) return toast('Tidak ada data distribusi.');
    const ok = await confirmDialog({
      title: 'Hapus seluruh data distribusi?',
      message: `<b>${c.sessions}</b> sesi dan <b>${c.photos}</b> foto akan dihapus <b>permanen</b>. Identitas, logo, dan pengaturan tetap ada. Disarankan backup dulu.`,
      confirmText: 'Hapus semua',
      danger: true,
      typeWord: 'HAPUS',
    });
    if (!ok) return;
    await DB.clearDistribution();
    arch.photos = null;
    arch.selected.clear();
    toast('Seluruh data distribusi dihapus.');
    refresh();
  };
  actions.resetAll = async () => {
    const c = await DB.counts();
    const ok = await confirmDialog({
      title: 'Reset seluruh aplikasi?',
      message: `Menghapus <b>${c.sessions}</b> sesi, <b>${c.photos}</b> foto, <b>beserta identitas, logo, dan semua pengaturan</b>. Tidak bisa dibatalkan. Disarankan backup dulu.`,
      confirmText: 'Reset aplikasi',
      danger: true,
      typeWord: 'RESET',
    });
    if (!ok) return;
    await DB.resetAll();
    arch.photos = null;
    arch.selected.clear();
    toast('Aplikasi direset.');
    go('#/home');
  };

  /* ============================ Pasang event global ============================ */
  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve()
      .then(() => fn(el.dataset, el, e))
      .catch((err) => toast(friendly(err), 'error', 5500));
  });
  view.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el);
  });
  view.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
  });

  $('#camInput').addEventListener('change', onCameraChange);

  $('#logoInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.type && !/^image\//i.test(f.type)) return toast('File logo harus berupa gambar.', 'error');
    busy.show('Memproses logo…');
    try {
      const r = await Img.render(f, 256, 'image/png');
      await DB.setSettings({ logoBlob: r.blob });
      toast('Logo disimpan.', 'success');
      refresh();
    } catch (err) {
      toast(friendly(err, 'Logo tidak dapat dibaca. Gunakan gambar JPG atau PNG.'), 'error', 5000);
    } finally {
      busy.hide();
    }
  });

  $('#restoreInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) {
      try {
        await doRestore(f);
      } catch (err) {
        busy.hide();
        toast(friendly(err), 'error', 6000);
      }
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (parseHash().name === 'settings') refresh();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
  });
  window.addEventListener('hashchange', () => render());

  /* ================================= Mulai ================================= */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Versi baru aplikasi sudah siap.', 'info', 0, { label: 'Muat ulang', onClick: () => location.reload() });
    });
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker gagal didaftarkan', err);
      toast('Mode offline belum aktif. Buka aplikasi lewat alamat HTTPS.', 'info', 5000);
    });
  }

  async function init() {
    try {
      await DB.open();
      await DB.reconcile();
    } catch (e) {
      console.error(e);
      $('#nav').hidden = true;
      view.innerHTML =
        '<div class="container"><div class="hint err"><b>Penyimpanan lokal tidak dapat dibuka.</b><br>Pastikan tidak memakai mode penyamaran/privat dan ruang penyimpanan perangkat tidak penuh, lalu muat ulang halaman.</div><button class="btn btn-primary" onclick="location.reload()">Muat ulang</button></div>';
      return;
    }
    render();
    registerSW();
  }
  init();
})();
