# Desain Teknis OCR Box Notes

## Kondisi Implementasi Saat Ini

1. UI batch OCR berada di [OCRPage.jsx](file:///e:/personalapp/reader/src/renderer/pages/OCRPage.jsx).
2. IPC bridge di [preload.js](file:///e:/personalapp/reader/electron/preload.js) hanya meneruskan payload ke backend.
3. Backend OCR ada di [main.js](file:///e:/personalapp/reader/electron/main.js) dengan handler terpisah untuk:
   - `run-ocr` (Tesseract)
   - `run-ocr-easy`
   - `run-ocr-kraken`
   - `run-ocr-vision`
   - `run-ocr-file` untuk re-OCR satu file
4. Preprocessing OCR sudah memanfaatkan `magick` melalui `preprocessImageForOcr()` dan `prepareOcrSingleImage()`.

## Prinsip Desain V1

1. Layout mode adalah lapisan di atas engine OCR, bukan engine baru.
2. Deteksi box dilakukan sebelum preprocessing OCR agresif yang bisa menghilangkan garis frame.
3. OCR inside dan outside boleh memakai gambar crop yang dipreprocess terpisah.
4. Jika layout detection gagal, sistem kembali ke jalur full page tanpa melempar error fatal.

## Arsitektur Perubahan

### 1. Parameter Baru

Tambahkan parameter payload:

```json
{
  "layoutMode": "full" | "box_notes",
  "boxPaddingPct": 0.01,
  "notePaddingPct": 0.01,
  "outsideFormat": "zoned"
}
```

Nilai default backend:

- `layoutMode = "full"`
- `boxPaddingPct = 0.01`
- `notePaddingPct = 0.01`
- `outsideFormat = "zoned"`

### 2. Modul Helper Baru yang Disarankan

V1 sebaiknya memecah logika layout ke helper terpisah agar `main.js` tidak makin padat.

Saran file:

- `electron/ocr-layout.js`

Isi utama:

1. `detectMainBox(imagePath, options)`
2. `buildLayoutRegions(imageSize, boxRect, options)`
3. `cropLayoutRegions(imagePath, regions, options)`
4. `mergeOcrText(mainText, outsideByZone, options)`
5. `runLayoutAwareOcr(...)` sebagai orkestrator reusable untuk batch dan single-file

## Strategi Deteksi Main Box

### Input

- Gambar asli halaman, sebelum `despeckle`, `auto-threshold`, atau deskew agresif.

### Pendekatan V1

Rule-based rectangle detection:

1. Baca ukuran gambar.
2. Buat versi grayscale / threshold ringan khusus deteksi garis.
3. Cari kandidat persegi panjang besar.
4. Pilih kandidat terbaik berdasarkan skor.

### Heuristik Skor Kandidat

Sebuah box layak dipilih jika:

1. Berada cukup dekat pusat halaman.
2. Luas lebih besar dari ambang minimum, misalnya `>= 20%` area halaman.
3. Tidak menempel ke border halaman luar.
4. Rasio aspek masuk akal untuk blok teks kitab.
5. Memiliki edge rectangle yang relatif utuh.

Skor kandidat bisa menggabungkan:

- area ratio
- center distance
- border exclusion penalty
- rectangularity score

### Fallback

Jika tidak ada kandidat yang lolos threshold:

- `detected = false`
- backend langsung menjalankan flow OCR full page yang sudah ada

## Strategi Crop Region

Jika `boxRect` ditemukan:

1. `inside`
   - gunakan inset kecil agar garis frame tidak ikut terbaca OCR
2. `top`
   - area dari atas halaman sampai sebelum `boxTop`
3. `right`
   - area dari `boxRight` sampai sisi kanan halaman
4. `bottom`
   - area dari `boxBottom` sampai bawah halaman
5. `left`
   - area dari kiri halaman sampai sebelum `boxLeft`

Catatan:

- Region outside perlu menghindari frame line.
- Region yang dimensinya terlalu kecil sebaiknya di-skip.
- Crop harus dilakukan berdasarkan koordinat final yang sudah di-clamp ke ukuran gambar.

## Opsi Implementasi Crop dan Detect

### Opsi A - Reuse `magick` + helper shell

Kelebihan:

- Memanfaatkan tool yang sudah dipakai backend.
- Tidak perlu menambah dependency npm native.

Kekurangan:

- Deteksi rectangle lewat shell/ImageMagick lebih sulit dirawat.

### Opsi B - Helper Python kecil khusus layout

Kelebihan:

- Lebih fleksibel untuk threshold, contour, dan scoring.
- Bisa dipakai ulang untuk batch dan single-file.

Kekurangan:

- Menambah dependensi Python package bila memakai OpenCV atau Pillow.

### Keputusan yang Disarankan

Untuk V1:

1. Gunakan helper Python kecil jika environment OCR sudah bergantung pada Python untuk beberapa engine.
2. Jika ingin dependency minimum, mulai dari crop orchestration di Node dan deteksi via tool sederhana yang tersedia.
3. Tetapkan satu jalur resmi dulu. Jangan campur banyak metode deteksi di tahap awal.

## Orkestrasi OCR per Engine

### Tesseract

Inside:

- `--psm 6`
- `preserve_interword_spaces=1`

Outside:

- `--psm 11` atau `--psm 12`

### EasyOCR / Kraken / Google Vision / Arabic DL

Prinsip:

- engine tetap dipanggil seperti biasa
- yang berubah adalah input gambar hasil crop per region

Artinya, untuk engine non-Tesseract, V1 tidak perlu tuning besar selama region crop sudah benar.

## Desain Alur Backend

### Batch OCR

1. Handler menerima payload OCR.
2. Jika `layoutMode !== "box_notes"`, jalur lama dipakai tanpa perubahan berarti.
3. Jika `layoutMode === "box_notes"`:
   - deteksi box
   - bentuk crop inside/outside
   - preprocess hasil crop bila perlu
   - OCR inside
   - OCR each outside zone
   - gabungkan teks
   - tulis ke file output target

### Single File Re-OCR

`run-ocr-file` harus memakai helper yang sama agar:

1. hasil batch dan re-OCR konsisten
2. Split View tidak menunjukkan output berbeda untuk file yang sama

## Format Merge Text

Aturan merge:

1. Trim trailing whitespace berlebihan.
2. Tulis main text lebih dulu.
3. Tambah satu blok `--- OUTSIDE BOX ---` hanya jika ada outside text non-kosong.
4. Gunakan urutan zona:
   - `top`
   - `right`
   - `bottom`
   - `left`

Pseudo-merge:

```text
{mainText}

--- OUTSIDE BOX ---
[OUTSIDE:top] ...
[OUTSIDE:right] ...
[OUTSIDE:bottom] ...
[OUTSIDE:left] ...
```

## Logging dan Observability

Minimal metadata yang perlu di-log ke console atau debug log:

1. file name
2. layout mode
3. main box detected atau fallback
4. koordinat box terpilih
5. zona outside yang diproses

Tujuannya agar hasil buruk bisa ditelusuri tanpa inspeksi manual terlalu lama.

## Dampak ke Settings

Saran simpan default baru di settings:

- `ocrLayoutMode`
- `ocrBoxPaddingPct`
- `ocrNotePaddingPct`
- `ocrOutsideFormat`

Semua bersifat opsional dan harus punya fallback aman di backend.

## Risiko Implementasi

1. `main.js` sudah besar, sehingga logika baru berisiko menambah kompleksitas jika tidak diekstrak ke helper.
2. Box tipis bisa hilang bila deteksi dilakukan setelah preprocess agresif.
3. Engine berbasis folder batch perlu strategi penamaan crop agar tidak bentrok.
4. OCR region luar box bisa menghasilkan noise tinggi pada halaman kosong margin.

## Mitigasi

1. Ekstrak helper layout ke file terpisah.
2. Tambahkan threshold minimum text length untuk memutuskan apakah outside zone ditulis.
3. Simpan crop ke temp dir per halaman lalu bersihkan setelah selesai.
4. Batasi scope V1 ke main box tunggal terbesar.
