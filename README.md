# Dokumentasi Bukti Distribusi Koran (PWA)

Aplikasi PWA untuk petugas distribusi koran: ambil foto bukti di tiap lokasi, lalu susun otomatis menjadi PDF A4 yang siap dibagikan lewat WhatsApp. 100% lokal di perangkat: tanpa server, tanpa login, tanpa unggah ke cloud.

- Teknologi: HTML, CSS, JavaScript vanilla, IndexedDB, PWA (service worker), pdf-lib, JSZip
- Target: Chrome di Android (HTTPS lewat GitHub Pages)

## Catatan penting: pdf-lib menggantikan jsPDF

Blueprint menyebut jsPDF. Saat implementasi, jsPDF tidak tersedia dan paket tidak bisa diunduh, sehingga pembuatan PDF memakai **pdf-lib 1.17.1** (MIT) yang disimpan lokal di `vendor/pdf-lib.min.js`. Fitur PDF sesuai blueprint tetap terpenuhi. Seluruh logika PDF ada di `pdf.js` (bagian `PdfBuilder.build`), sehingga bisa diganti ke jsPDF nanti tanpa menyentuh file lain.

Batasan akibat font standar PDF: karakter di luar set Latin (misalnya emoji) pada keterangan manual ditampilkan sebagai `?` di PDF. Teks Indonesia biasa, tanda baca, dan tanda kutip tampil normal.

## Struktur file

```
index.html  style.css  app.js  db.js  pdf.js  backup.js
manifest.json  sw.js  icon-192.png  icon-512.png
vendor/pdf-lib.min.js  vendor/jszip.min.js  vendor/LICENSES.txt
```

## Deployment ke GitHub Pages

1. Buat repositori baru di GitHub (publik, misalnya `distribusi-koran`).
2. Unggah **isi** folder ini (bukan folder pembungkusnya) ke cabang `main`, sehingga `index.html` berada di akar repositori.
3. Buka **Settings → Pages**, pada *Build and deployment* pilih **Deploy from a branch**, cabang `main`, folder `/ (root)`, lalu **Save**.
4. Tunggu 1–2 menit. Alamat aplikasi: `https://<username>.github.io/distribusi-koran/`.
5. Buka alamat itu di Chrome Android sekali dengan koneksi internet agar semua file tersimpan untuk mode offline.

Semua path dalam aplikasi bersifat relatif, jadi berjalan di sub-folder GitHub Pages tanpa pengaturan tambahan.

**Memperbarui aplikasi:** ubah file, naikkan `CACHE_VERSION` di `sw.js` (misalnya `v1.0.1`), lalu unggah ulang. Pengguna akan melihat pesan "Versi baru siap" dan menekan **Muat ulang**. Pembaruan hanya menyentuh cache file; data foto di IndexedDB tidak terhapus.

## Instalasi di Android

1. Buka alamat aplikasi di **Chrome**.
2. Ketuk menu ⋮ → **Instal aplikasi** (atau **Tambahkan ke layar utama**). Alternatif: Pengaturan di dalam aplikasi → **Pasang Aplikasi** jika tombolnya muncul.
3. Buka aplikasi dari ikon di layar utama.
4. Izinkan akses Kamera bila diminta. Sebaiknya juga buka **Pengaturan → Penyimpanan** dan, bila tersedia, ketuk **Minta penyimpanan persisten**.

## Cara memakai

1. **Mulai Distribusi** → pilih mode keterangan → **Mulai Sesi**.
2. Tekan **Ambil Foto** di tiap lokasi. Mode otomatis langsung tersimpan; mode manual meminta keterangan tiap foto.
3. **Selesaikan Sesi** → periksa rekap (lihat, edit keterangan, hapus foto).
4. Pilih jumlah halaman → **Buat PDF** → **Bagikan PDF** (pilih WhatsApp) atau **Download PDF**.
5. Lakukan **Backup** secara berkala di Pengaturan, karena data hanya ada di perangkat.

## Keputusan desain yang perlu diketahui

- **Timestamp** adalah waktu foto diterima aplikasi, bukan waktu shutter yang terverifikasi (sesuai blueprint). Pembacaan EXIF tidak diimplementasikan.
- **Nomor AREA** (mode otomatis) tidak pernah disimpan; dihitung ulang tiap PDF dibuat dari urutan foto yang masih ada.
- **PDF**: salinan foto diperkecil (maks 1600 px) hanya untuk PDF dan orientasi EXIF dikoreksi. Foto asli di IndexedDB dan di backup tidak diubah.
- **Satu sesi aktif** dalam satu waktu. Jika ada sesi yang belum diselesaikan, **Mulai Distribusi** melanjutkan sesi itu (aman bila aplikasi tertutup atau dimuat ulang).
- **Restore** menggabungkan berdasarkan ID: sesi yang sudah ada di perangkat dilewati, tidak ditimpa. Pengaturan identitas hanya diganti jika kotaknya dicentang. Jika gagal di tengah jalan, data yang sempat ditulis dibatalkan.
- **Penghapusan massal** (hapus semua data / reset aplikasi) meminta pengguna mengetik `HAPUS` / `RESET`.
- Pemilihan kamera lewat `capture="environment"` hanyalah petunjuk ke browser. Pada sebagian perangkat, Android bisa menutup halaman saat kamera terbuka; jika foto tidak muncul setelah kembali, ambil ulang (sesi dan foto sebelumnya aman).

## Skenario pengujian manual (di HP Android)

**A. Mode otomatis**
1. Mulai sesi dengan kotak *keterangan otomatis* dicentang. Ambil 5 foto tanpa mengisi apa pun. Pastikan kamera belakang terbuka dan jumlah foto bertambah.
2. Selesaikan sesi, hapus foto ke-2 (konfirmasi muncul).
3. Buat PDF 2 halaman. Pastikan label **AREA 1–4 berurutan tanpa nomor terlewat**, pembagian foto 2 + 2, foto tidak terpotong, dan tanggal/waktu foto tampil di bawah keterangan.

**B. Mode manual**
1. Mulai sesi dengan kotak dikosongkan. Ambil foto, coba simpan dengan keterangan kosong → harus ditolak.
2. Isi keterangan, ambil 2 foto lagi. Di rekap, edit satu keterangan, hapus satu foto: keterangan foto lain tidak berubah.
3. Buat PDF: keterangan manual tampil tebal; keterangan sangat panjang dipotong dua baris dengan `...`.

**C. Pembagian halaman**
Uji sesi dengan 1, 2, 3, 24, dan 50 foto. Contoh: 10 foto/3 halaman = 4,3,3; 24/5 = 5,5,5,5,4; 24/24 = 1 per halaman. Untuk 50 foto di 1 halaman harus muncul peringatan "foto akan tampil kecil" dan pilihan pengguna tidak diubah diam-diam.

**D. Berbagi PDF**
Tekan **Bagikan PDF**, pilih WhatsApp, kirim ke diri sendiri. Batalkan Share Sheet sekali: aplikasi tidak boleh menganggapnya kegagalan. Uji juga **Download PDF** (file ada di Unduhan).

**E. Arsip**
Arsipkan sesi lalu kembalikan (foto tetap utuh). Uji pencarian petugas, filter tanggal, tab **Foto** (lihat, hapus), pilih beberapa sesi lalu hapus, dan **Buat ulang PDF**.

**F. Backup & Restore**
1. Backup, lalu unduh ZIP; pastikan data di aplikasi tidak berkurang.
2. Di Chrome lain/profil bersih (atau setelah *Hapus seluruh data distribusi*), restore ZIP tadi. Cek ringkasan, konfirmasi, lalu pastikan jumlah sesi dan foto sama persis serta PDF bisa dibuat.
3. Restore ZIP yang sama sekali lagi: semua sesi "sudah ada (dilewati)", tidak ada duplikat. Coba juga file bukan-ZIP: harus muncul pesan ramah.

**G. Offline & pembaruan**
1. Setelah pernah dibuka online, aktifkan mode pesawat, buka aplikasi dari ikon: ambil foto, rekap, arsip, dan buat PDF tetap berfungsi.
2. Naikkan `CACHE_VERSION`, unggah ulang, buka aplikasi online: tombol **Muat ulang** muncul, dan semua data foto masih ada.

**H. Ketahanan**
Tutup paksa aplikasi di tengah sesi lalu buka lagi: sesi dan foto tetap ada dan bisa dilanjutkan. Dengan penyimpanan hampir penuh, pesan "Penyimpanan perangkat penuh" muncul dan tidak ada foto yang dihapus otomatis.
