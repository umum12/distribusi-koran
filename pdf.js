/* pdf.js — format tanggal (WIB), pengolahan gambar, dan pembuatan PDF A4.
 *
 * PDF dibuat dengan pdf-lib (vendor/pdf-lib.min.js), sepenuhnya di perangkat.
 * Foto asli di IndexedDB TIDAK diubah: untuk PDF, salinan foto diperkecil (maks 1600 px)
 * dan dikoreksi orientasinya hanya di memori.
 */
'use strict';

/* ======================= Format tanggal Asia/Jakarta ======================= */
const Fmt = (() => {
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const pad = (n) => String(n).padStart(2, '0');

  // Asia/Jakarta = UTC+7 tetap (tanpa DST), jadi tidak bergantung pada data ICU perangkat.
  function parts(ts) {
    const d = new Date(ts + 7 * 3600 * 1000);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
    };
  }
  function dateLong(ts) {
    const p = parts(ts);
    return `${DAYS[p.dow]}, ${p.d} ${MONTHS[p.mo]} ${p.y}`;
  }
  function dateShort(ts) {
    const p = parts(ts);
    return `${p.d} ${MONTHS[p.mo]} ${p.y}`;
  }
  function time(ts, withSec) {
    const p = parts(ts);
    return `${pad(p.h)}:${pad(p.mi)}${withSec ? ':' + pad(p.s) : ''}`;
  }
  function dateTime(ts, withSec) {
    return `${dateLong(ts)} | ${time(ts, withSec)} WIB`;
  }
  function dmy(ts) {
    const p = parts(ts);
    return `${pad(p.d)}-${pad(p.mo + 1)}-${p.y}`;
  }
  function iso(ts) {
    const p = parts(ts);
    return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}`;
  }
  function dmyTime(ts) {
    return `${dmy(ts)} ${time(ts, true)}`;
  }
  function stamp(ts) {
    const p = parts(ts);
    return `${p.y}${pad(p.mo + 1)}${pad(p.d)}-${pad(p.h)}${pad(p.mi)}`;
  }
  function bytes(n) {
    if (!isFinite(n) || n < 0) return '-';
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  return { dateLong, dateShort, time, dateTime, dmy, dmyTime, iso, stamp, bytes };
})();

/* ============================= Pengolahan gambar ============================= */
const Img = (() => {
  async function decode(blob) {
    if (window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
      } catch (e) {
        /* coba cara lain */
      }
      try {
        const bmp = await createImageBitmap(blob);
        return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
      } catch (e) {
        /* coba <img> */
      }
    }
    const url = URL.createObjectURL(blob);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      if (!im.naturalWidth) throw new Error('IMG_EMPTY');
      return {
        src: im, width: im.naturalWidth, height: im.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  /* Menggambar ulang ke canvas (orientasi EXIF sudah diterapkan) lalu meng-encode. */
  async function render(blob, maxEdge, mime, quality, fillWhite) {
    const d = await decode(blob);
    try {
      const scale = Math.min(1, maxEdge / Math.max(d.width, d.height));
      const w = Math.max(1, Math.round(d.width * scale));
      const h = Math.max(1, Math.round(d.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (fillWhite || mime === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(d.src, 0, 0, w, h);
      const out = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('TOBLOB_FAILED'))), mime, quality)
      );
      c.width = c.height = 0;
      return { blob: out, width: w, height: h, origWidth: d.width, origHeight: d.height };
    } finally {
      d.close();
    }
  }

  /* Thumbnail kecil untuk daftar. Jika gagal, foto asli tetap disimpan tanpa thumbnail. */
  async function makeThumb(blob, maxEdge = 360) {
    try {
      const r = await render(blob, maxEdge, 'image/jpeg', 0.72, true);
      return { thumb: r.blob, width: r.origWidth, height: r.origHeight };
    } catch (e) {
      console.warn('Thumbnail gagal dibuat', e);
      return { thumb: null, width: null, height: null };
    }
  }

  return { decode, render, makeThumb };
})();

/* ================================ Pembuat PDF ================================ */
const PdfBuilder = (() => {
  // Semua ukuran dalam point (1 pt = 1/72 inci). A4 portrait.
  const PW = 595.28;
  const PH = 841.89;
  const M = 34; // margin kiri/kanan (~12 mm), aman untuk printer
  const GAP = 10;
  const HEADER_TOP = 28;
  const HEADER_H = 60;
  const LOGO = 44;
  const CONTENT_TOP = HEADER_TOP + HEADER_H + 12;
  const CONTENT_BOTTOM = PH - 50;
  const SMALL_EDGE_PT = 150; // foto yang sisi terpanjangnya < 150 pt (~5,3 cm) dianggap terlalu kecil

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const tick = () => new Promise((r) => setTimeout(r, 0));

  /* Pembagian merata; sisa ditempatkan di halaman-halaman awal. 10/3 -> [4,3,3] */
  function distribute(n, pages) {
    const base = Math.floor(n / pages);
    const rem = n % pages;
    return Array.from({ length: pages }, (_, i) => base + (i < rem ? 1 : 0));
  }

  function fontSpec(k) {
    if (k <= 2) return { cap: 13, ts: 10, lines: 2 };
    if (k <= 4) return { cap: 11.5, ts: 9, lines: 2 };
    if (k <= 6) return { cap: 10.5, ts: 8.5, lines: 2 };
    if (k <= 9) return { cap: 9.5, ts: 8, lines: 1 };
    return { cap: 8.5, ts: 7.5, lines: 1 };
  }
  const capHeight = (fs) => fs.lines * fs.cap * 1.2 + fs.ts * 1.2 + 8;

  const dimsOf = (p) => ({
    w: p.width > 0 ? p.width : 4,
    h: p.height > 0 ? p.height : 3,
  });

  /* Memilih jumlah kolom yang membuat total area foto (skala 'contain') paling besar. */
  function planPage(dims) {
    const k = dims.length;
    const fs = fontSpec(k);
    const capH = capHeight(fs);
    const areaW = PW - 2 * M;
    const areaH = CONTENT_BOTTOM - CONTENT_TOP;
    let best = null;
    const evaluate = (cols, force) => {
      const rows = Math.ceil(k / cols);
      const cellW = (areaW - (cols - 1) * GAP) / cols;
      const cellH = (areaH - (rows - 1) * GAP) / rows;
      let boxH = cellH - capH;
      if (!force && (boxH < 30 || cellW < 60)) return null;
      boxH = Math.max(boxH, 8);
      let total = 0;
      let minEdge = Infinity;
      dims.forEach((d) => {
        const s = Math.min(cellW / d.w, boxH / d.h);
        const fw = d.w * s;
        const fh = d.h * s;
        total += fw * fh;
        minEdge = Math.min(minEdge, Math.max(fw, fh));
      });
      return { cols, rows, cellW, cellH, boxH, total, minEdge, fs };
    };
    for (let cols = 1; cols <= Math.min(k, 6); cols++) {
      const c = evaluate(cols, false);
      if (c && (!best || c.total > best.total + 1)) best = c;
    }
    if (!best) best = evaluate(Math.min(k, Math.ceil(Math.sqrt(k))), true);
    return best;
  }

  /* Perkiraan untuk UI (tanpa membuat PDF). */
  function estimate(photos, pageCount) {
    const n = photos.length;
    if (!n) return null;
    pageCount = clamp(Math.round(pageCount) || 1, 1, n);
    const counts = distribute(n, pageCount);
    let idx = 0;
    let minEdge = Infinity;
    counts.forEach((c) => {
      const pl = planPage(photos.slice(idx, idx + c).map(dimsOf));
      idx += c;
      minEdge = Math.min(minEdge, pl.minEdge);
    });
    return {
      counts,
      pageCount,
      minEdgePt: minEdge,
      minEdgeCm: (minEdge / 72) * 2.54,
      warn: minEdge < SMALL_EDGE_PT,
    };
  }

  /* pdf-lib hanya mendukung WinAnsi pada font standar: karakter lain diganti '?'. */
  const encCache = new WeakMap();
  function safe(font, text) {
    let cache = encCache.get(font);
    if (!cache) {
      cache = new Map();
      encCache.set(font, cache);
    }
    const src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    let out = '';
    for (const ch of src) {
      let ok = cache.get(ch);
      if (ok === undefined) {
        try {
          font.encodeText(ch);
          ok = true;
        } catch (e) {
          ok = false;
        }
        cache.set(ch, ok);
      }
      out += ok ? ch : '?';
    }
    return out;
  }

  function wrap(text, font, size, maxW, maxLines) {
    const w = (t) => font.widthOfTextAtSize(t, size);
    const words = text.split(' ').filter(Boolean);
    const lines = [];
    let cur = '';
    const breakLong = (word) => {
      let part = '';
      for (const ch of word) {
        if (part && w(part + ch) > maxW) {
          lines.push(part);
          part = ch;
        } else part += ch;
      }
      return part;
    };
    for (const word of words) {
      const t = cur ? `${cur} ${word}` : word;
      if (w(t) <= maxW) {
        cur = t;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      cur = w(word) <= maxW ? word : breakLong(word);
    }
    if (cur) lines.push(cur);
    if (!lines.length) return [''];
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 1 && w(last + '...') > maxW) last = last.slice(0, -1).trimEnd();
      kept[maxLines - 1] = last + '...';
      return kept;
    }
    return lines;
  }

  function fitSize(text, font, size, maxW, min = 5.5) {
    let s = size;
    while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.25;
    return s;
  }

  /* ----------------------------- Pembuatan PDF ----------------------------- */
  async function build({ session, photos, pageCount, logoBlob, onProgress }) {
    if (!window.PDFLib) throw Object.assign(new Error('PDFLIB_MISSING'), { userMessage: 'Komponen PDF belum termuat. Muat ulang aplikasi lalu coba lagi.' });
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const report = onProgress || (() => {});
    const n = photos.length;
    if (!n) throw Object.assign(new Error('NO_PHOTOS'), { userMessage: 'Belum ada foto untuk dibuat PDF.' });
    pageCount = clamp(Math.round(pageCount) || 1, 1, n);

    const doc = await PDFDocument.create();
    const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontR = await doc.embedFont(StandardFonts.Helvetica);
    const createdAt = Date.now();
    const title = safe(fontB, session.reportTitle || 'LAPORAN');
    const petugas = safe(fontR, session.petugasName || '-');
    doc.setTitle(title);
    doc.setAuthor(petugas);
    doc.setSubject('Bukti distribusi koran');
    doc.setCreator('Aplikasi Distribusi Koran (PWA)');
    doc.setProducer('pdf-lib');
    doc.setCreationDate(new Date(createdAt));

    let logo = null;
    if (logoBlob) {
      try {
        const r = await Img.render(logoBlob, 256, 'image/png', undefined, false);
        logo = await doc.embedPng(new Uint8Array(await r.blob.arrayBuffer()));
      } catch (e) {
        console.warn('Logo tidak dapat dipakai di PDF', e);
      }
    }

    const blue = rgb(0.114, 0.306, 0.847);
    const ink = rgb(0.06, 0.09, 0.16);
    const gray = rgb(0.4, 0.45, 0.53);
    const lightGray = rgb(0.8, 0.84, 0.89);
    const pdfTimeText = safe(fontR, `PDF dibuat: ${Fmt.dateTime(createdAt, false)}`);

    const counts = distribute(n, pageCount);
    const totalPages = counts.length;
    const failed = [];
    let idx = 0;
    let done = 0;

    const topToY = (top, h = 0) => PH - top - h;

    function drawCentered(page, text, font, size, boxX, boxW, topY, color) {
      const w = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: boxX + (boxW - w) / 2, y: topToY(topY + size * 0.95), size, font, color });
    }

    function drawHeader(page) {
      const textX = M + (logo ? LOGO + 10 : 0);
      const availW = PW - M - textX;
      if (logo) {
        const s = Math.min(LOGO / logo.width, LOGO / logo.height);
        const lw = logo.width * s;
        const lh = logo.height * s;
        page.drawImage(logo, { x: M + (LOGO - lw) / 2, y: topToY(HEADER_TOP + (LOGO - lh) / 2, lh), width: lw, height: lh });
      }
      const tLines = wrap(title, fontB, 12.5, availW, 2);
      let y = HEADER_TOP;
      tLines.forEach((ln) => {
        page.drawText(ln, { x: textX, y: topToY(y + 12), size: 12.5, font: fontB, color: blue });
        y += 15;
      });
      const pLine = wrap(`Petugas: ${petugas}`, fontR, 10, availW, 1)[0];
      page.drawText(pLine, { x: textX, y: topToY(y + 10), size: 10, font: fontR, color: ink });
      y += 13;
      const tm = fitSize(pdfTimeText, fontR, 9, availW);
      page.drawText(pdfTimeText, { x: textX, y: topToY(y + 9), size: tm, font: fontR, color: gray });
      page.drawLine({
        start: { x: M, y: topToY(HEADER_TOP + HEADER_H) },
        end: { x: PW - M, y: topToY(HEADER_TOP + HEADER_H) },
        thickness: 1.2,
        color: blue,
      });
    }

    function drawFooter(page, num) {
      const note = 'Waktu pada setiap foto adalah waktu foto diterima oleh aplikasi saat dokumentasi.';
      const nw = fontR.widthOfTextAtSize(note, 7);
      page.drawText(note, { x: (PW - nw) / 2, y: 20, size: 7, font: fontR, color: gray });
      const label = `Halaman ${num} dari ${totalPages}`;
      const lw = fontR.widthOfTextAtSize(label, 9);
      page.drawText(label, { x: (PW - lw) / 2, y: 31, size: 9, font: fontR, color: ink });
    }

    for (let p = 0; p < totalPages; p++) {
      const slice = photos.slice(idx, idx + counts[p]);
      const plan = planPage(slice.map(dimsOf));
      const { cols, rows, cellW, cellH, boxH, fs } = plan;
      const page = doc.addPage([PW, PH]);
      drawHeader(page);

      for (let i = 0; i < slice.length; i++) {
        const ph = slice[i];
        const globalIndex = idx + i; // urutan foto aktif -> menentukan nomor AREA
        const row = Math.floor(i / cols);
        const col = i % cols;
        const inRow = row === rows - 1 ? slice.length - (rows - 1) * cols : cols;
        const offsetX = ((cols - inRow) * (cellW + GAP)) / 2;
        const cx = M + offsetX + col * (cellW + GAP);
        const cy = CONTENT_TOP + row * (cellH + GAP);

        let fw;
        let fh;
        try {
          const r = await Img.render(ph.blob, 1600, 'image/jpeg', 0.82, true);
          const jpg = await doc.embedJpg(new Uint8Array(await r.blob.arrayBuffer()));
          const s = Math.min(cellW / r.width, boxH / r.height);
          fw = r.width * s;
          fh = r.height * s;
          const px = cx + (cellW - fw) / 2;
          page.drawImage(jpg, { x: px, y: topToY(cy, fh), width: fw, height: fh });
          page.drawRectangle({ x: px, y: topToY(cy, fh), width: fw, height: fh, borderColor: lightGray, borderWidth: 0.6 });
        } catch (e) {
          console.warn('Foto tidak dapat diproses untuk PDF', e);
          failed.push(globalIndex + 1);
          fw = cellW;
          fh = Math.min(boxH, cellW * 0.75);
          page.drawRectangle({ x: cx, y: topToY(cy, fh), width: fw, height: fh, color: rgb(0.94, 0.95, 0.97), borderColor: lightGray, borderWidth: 0.6 });
          const msg = 'Foto tidak dapat dibaca';
          drawCentered(page, msg, fontR, 8, cx, fw, cy + fh / 2 - 4, gray);
        }

        // Keterangan (tebal) + waktu dokumentasi di bawahnya
        const captionRaw = session.captionMode === 'manual' ? ph.manualCaption : `AREA ${globalIndex + 1}`;
        const caption = safe(fontB, captionRaw || '-');
        const lines = wrap(caption, fontB, fs.cap, cellW, fs.lines);
        let ty = cy + fh + 5;
        lines.forEach((ln) => {
          drawCentered(page, ln, fontB, fs.cap, cx, cellW, ty, ink);
          ty += fs.cap * 1.2;
        });
        // Format panjang dulu; jika sel terlalu sempit pakai format lebih pendek agar tidak bertumpuk.
        const stampOptions = [
          Fmt.dateTime(ph.receivedAt, true),
          `${Fmt.dmyTime(ph.receivedAt)} WIB`,
          Fmt.dmyTime(ph.receivedAt),
        ].map((t) => safe(fontR, t));
        let stamp = stampOptions[stampOptions.length - 1];
        for (const opt of stampOptions) {
          if (fontR.widthOfTextAtSize(opt, Math.max(fs.ts * 0.8, 6)) <= cellW) {
            stamp = opt;
            break;
          }
        }
        const ss = fitSize(stamp, fontR, fs.ts, cellW, 4.5);
        drawCentered(page, stamp, fontR, ss, cx, cellW, ty + 1, gray);

        done++;
        report(done, n, 'Memproses foto');
        await tick(); // beri kesempatan UI memperbarui progress & membebaskan memori
      }

      drawFooter(page, p + 1);
      idx += counts[p];
    }

    report(n, n, 'Menyusun file PDF');
    await tick();
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      fileName: `Laporan_Distribusi_${Fmt.dmy(session.startedAt)}.pdf`,
      pages: totalPages,
      photos: n,
      failed,
    };
  }

  return { distribute, estimate, planPage, build, safe, wrap };
})();
