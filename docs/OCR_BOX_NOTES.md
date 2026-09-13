# OCR: Fokus Teks Dalam Box + Tandai Teks Luar Box

Dokumen ini menjelaskan desain pemrosesan OCR untuk halaman scan kitab yang memiliki **kotak (frame) teks utama** di tengah, sementara **keterangan tambahan** (syarah/hasyiyah/catatan pinggir) berada **di luar kotak**.

Target hasil OCR:
- OCR harus **fokus pada teks di dalam box** sebagai teks utama.
- Teks yang terdeteksi **di luar box tidak dipisah menjadi file lain**, tetapi **ditambahkan di bagian bawah** hasil OCR dengan penanda yang jelas bahwa itu berasal dari luar box.

Dokumen pengembangan lanjutan:
- [Development Pack OCR Box Notes](file:///e:/personalapp/reader/docs/ocr-box-notes/README.md)
- [Spec](file:///e:/personalapp/reader/docs/ocr-box-notes/spec.md)
- [Technical Design](file:///e:/personalapp/reader/docs/ocr-box-notes/technical-design.md)
- [API Contract](file:///e:/personalapp/reader/docs/ocr-box-notes/api-contract.md)
- [Tasks](file:///e:/personalapp/reader/docs/ocr-box-notes/tasks.md)
- [Checklist](file:///e:/personalapp/reader/docs/ocr-box-notes/checklist.md)
- [Test Cases](file:///e:/personalapp/reader/docs/ocr-box-notes/test-cases.md)

---

## 1) Terminologi

- **Page image**: file gambar input per halaman (jpg/png).
- **Main box**: kotak persegi panjang yang membungkus teks utama.
- **Inside box / main region**: area di dalam main box (dengan sedikit padding).
- **Outside box / note regions**: area di luar main box (margin kiri/kanan/atas/bawah).
- **Layout segmentation**: proses menemukan main box dan memisahkan inside vs outside sebelum OCR.

---

## 2) Output yang Diinginkan (Tidak Dipecah)

Untuk setiap halaman `XXXX.jpg`, output tetap satu file teks `XXXX.txt`.

Struktur konten:

1) **Isi OCR utama (inside box)** ditulis normal dari awal file.
2) Tambahkan pemisah yang konsisten.
3) Tambahkan teks **luar box** dalam bentuk baris-baris bertanda.

Contoh format yang disarankan:

```text
... (hasil OCR teks utama dari dalam box)

--- OUTSIDE BOX ---
[OUTSIDE:top] ...teks catatan bagian atas...
[OUTSIDE:right] ...teks catatan margin kanan...
[OUTSIDE:bottom] ...teks catatan bagian bawah...
[OUTSIDE:left] ...teks catatan margin kiri...
```

Catatan:
- Kalau sebuah region tidak ada isinya, region tersebut boleh tidak ditulis.
- Kalau tidak ingin per-zona, bisa juga disatukan:

```text
--- OUTSIDE BOX ---
[OUTSIDE] ...baris 1...
[OUTSIDE] ...baris 2...
```

---

## 3) Pipeline Besar

Ringkasnya, pipeline yang aman:

1) Baca gambar halaman.
2) Deteksi `main box` pada gambar asli (sebelum preprocess OCR yang agresif).
3) Crop:
   - `inside_box_image` (untuk teks utama)
   - `outside_box_images` (1 atau beberapa zona)
4) Preprocess ringan (opsional) pada hasil crop untuk meningkatkan OCR.
5) OCR terpisah:
   - OCR `inside_box_image` sebagai teks utama
   - OCR `outside_box_images` sebagai catatan luar box
6) Gabungkan menjadi satu output `.txt`:
   - teks utama terlebih dulu
   - lalu blok `--- OUTSIDE BOX ---` dan baris-baris bertanda

---

## 4) Deteksi Main Box (Layout Segmentation)

### 4.1 Syarat Praktis Main Box
Untuk scan kitab seperti contoh, main box biasanya:
- Bentuk persegi panjang, garis tegas (hitam), mengelilingi blok teks utama.
- Berada di tengah halaman.
- Luasnya besar tapi bukan border seluruh halaman.

### 4.2 Pendekatan yang Disarankan (Rule-Based, V1)
Pendekatan awal yang relatif stabil untuk V1:

1) Konversi grayscale.
2) Threshold (atau adaptive threshold) untuk menonjolkan garis.
3) Deteksi kontur / connected components.
4) Pilih kandidat persegi panjang terbesar yang memenuhi:
   - rasio lebar:tinggi masuk akal (tidak terlalu gepeng)
   - area cukup besar (mis. > 20% area halaman)
   - margin terhadap tepi halaman tidak terlalu kecil (bukan border luar)
5) Setelah bbox box didapat, tambahkan padding kecil ke dalam (inset/outset) agar:
   - tulisan yang menempel frame tidak kepotong
   - garis frame tidak ikut “mengganggu” OCR

### 4.3 Fallback
Jika main box tidak terdeteksi (scan terlalu buram atau frame hilang):
- Fallback ke OCR full page (seperti perilaku sekarang), tanpa blok OUTSIDE BOX.

---

## 5) Membentuk Region Luar Box

Jika main box ditemukan, definisikan region luar box berdasarkan bbox:
- `top`: area dari y=0 sampai y=boxTop
- `bottom`: area dari y=boxBottom sampai y=height
- `left`: area dari x=0 sampai x=boxLeft
- `right`: area dari x=boxRight sampai x=width

Praktik yang biasanya membantu:
- Tambahkan margin/padding kecil (mis. 1–2% ukuran gambar) agar teks margin tidak kepotong.
- Hindari memasukkan garis frame box ke region note (agar tidak mengacaukan OCR).

Urutan penulisan notes ke output:
- Default yang mudah dibaca: `top -> right -> bottom -> left`
- Jika nanti dibutuhkan: urutan bisa disesuaikan (misalnya khusus Arabic: right/left dulu).

---

## 6) OCR Settings yang Disarankan

Karena inside box dan outside box punya karakter layout berbeda, setelan OCR idealnya beda.

### 6.1 Tesseract
Inside box (blok teks utama):
- `--psm 6` (single uniform block of text) atau `--psm 4` tergantung kualitas scan.
- `preserve_interword_spaces=1` tetap dipakai.

Outside box (catatan pinggir biasanya sparse / tidak serapi blok utama):
- `--psm 11` atau `--psm 12` (sparse text).

### 6.2 EasyOCR / Kraken / Google Vision
Semua engine ini akan lebih “patuh” kalau kita sudah crop region-nya.
- Jadi kunci utama tetap: crop inside/outside dulu.

---

## 7) Integrasi ke Aplikasi (Lokasi Perubahan)

Referensi implementasi sekarang:
- UI OCR: [OCRPage.jsx](file:///e:/personalapp/reader/src/renderer/pages/OCRPage.jsx)
- Backend OCR handler & preprocess: [main.js](file:///e:/personalapp/reader/electron/main.js)

Rencana integrasi minimal:

1) Tambah opsi mode OCR di UI:
   - `Full Page` (default, perilaku sekarang)
   - `Inside Box + Mark Outside` (mode baru)
2) Kirim parameter tambahan ke backend, misalnya:
   - `layoutMode: "full" | "box_notes"`
   - opsional: `boxPaddingPct`, `notePaddingPct`
3) Di backend:
   - saat `layoutMode === "box_notes"`, jalankan deteksi box, crop, OCR terpisah, lalu gabungkan output menjadi satu `.txt`.

---

## 8) Gabung Hasil (Detail)

### 8.1 Gabung Minimal
```text
{MAIN_TEXT}

--- OUTSIDE BOX ---
{NOTES_TEXT}
```

### 8.2 Gabung Bertanda Per Zona
```text
{MAIN_TEXT}

--- OUTSIDE BOX ---
[OUTSIDE:top] {text...}
[OUTSIDE:right] {text...}
[OUTSIDE:bottom] {text...}
[OUTSIDE:left] {text...}
```

Jika sebuah zona menghasilkan multi-line, boleh tetap multi-line, tapi setiap baris diawali penanda yang sama:
```text
[OUTSIDE:right] baris 1...
[OUTSIDE:right] baris 2...
```

---

## 9) Kriteria Sukses (Acceptance)

- Jika halaman punya box jelas:
  - Teks utama dihasilkan dari area dalam box dan kualitasnya meningkat (lebih sedikit “noise” margin).
  - Teks margin tetap ikut terekam, tetapi muncul setelah pemisah dengan penanda `[OUTSIDE:*]`.
- Jika halaman tidak punya box:
  - OCR tetap jalan (fallback full page) dan tidak error.
- Tidak ada perubahan ke struktur file output (tetap `XXXX.txt` per halaman).

---

## 10) Catatan Risiko & Mitigasi

- Frame box tipis bisa hilang saat preprocess OCR agresif (OTSU/despeckle).
  - Mitigasi: deteksi box dilakukan pada gambar asli atau preprocess khusus deteksi box.
- Scan miring / banyak noise:
  - Mitigasi: coba deskew sebelum deteksi contour box, atau gunakan adaptive threshold.
- Halaman dengan lebih dari satu box / layout kompleks:
  - V1 fokus hanya main box terbesar (paling tengah).
  - V2 bisa dikembangkan untuk multi-box.

---

## 11) Phase Pengembangan

### Phase 0 - Alignment
- Review desain dan scope V1
- Sepakati output tetap satu file `.txt`
- Tetapkan kontrak payload UI ke backend

### Phase 1 - UI dan Settings
- Tambah `Layout OCR Mode`
- Tambah `boxPaddingPct`
- Tambah `notePaddingPct`
- Tambah `outsideFormat`
- Simpan default ke settings

### Phase 2 - Kontrak IPC
- Kirim parameter layout dari batch OCR
- Kirim parameter layout dari re-OCR single file
- Pertahankan kompatibilitas payload lama

### Phase 3 - Helper Layout Backend
- Buat helper `ocr-layout.js`
- Implementasi deteksi box
- Implementasi crop inside dan outside
- Implementasi merge hasil OCR

### Phase 4 - Integrasi Engine
- Integrasi Tesseract lebih dulu
- Lanjutkan ke EasyOCR, Kraken, Google Vision, dan engine lain

### Phase 5 - QA dan Release
- Uji halaman ber-box dan tanpa box
- Uji fallback
- Dokumentasikan limitasi V1

Status detail progress ada di:
- [tasks.md](file:///e:/personalapp/reader/docs/ocr-box-notes/tasks.md)
- [checklist.md](file:///e:/personalapp/reader/docs/ocr-box-notes/checklist.md)
