# Task Breakdown Implementasi OCR Box Notes

## Phase 0 - Alignment

- [x] Review dokumen konsep awal di [OCR_BOX_NOTES.md](file:///e:/personalapp/reader/docs/OCR_BOX_NOTES.md)
- [x] Sepakati scope V1: single main box, single `.txt`, fallback full page
- [ ] Putuskan jalur implementasi deteksi box:
  - helper Node + `magick`
  - atau helper Python khusus layout

## Phase 1 - UI dan Settings

- [x] Tambah kontrol `Layout OCR Mode` di [OCRPage.jsx](file:///e:/personalapp/reader/src/renderer/pages/OCRPage.jsx)
- [x] Tambah field opsional `boxPaddingPct`
- [x] Tambah field opsional `notePaddingPct`
- [x] Tambah opsi format outside:
  - `zoned`
  - `flat`
- [x] Simpan default ke settings melalui mekanisme `saveSettings`
- [x] Muat ulang nilai default melalui `getDefaults`

## Phase 2 - Kontrak IPC

- [x] Pastikan `preload.js` meneruskan payload layout tanpa filter
- [x] Update semua pemanggilan batch OCR agar mengirim parameter layout
- [x] Update `run-ocr-file` caller agar kontraknya konsisten dengan batch OCR

## Phase 3 - Helper Layout Backend

- [x] Buat helper terpisah, disarankan `electron/ocr-layout.js`
- [x] Implementasi normalisasi opsi layout
- [x] Implementasi pembacaan ukuran gambar
- [x] Implementasi deteksi main box
- [x] Implementasi builder region inside/outside
- [x] Implementasi crop region ke temp directory
- [x] Implementasi merge hasil OCR menjadi satu string output
- [x] Implementasi cleanup temp file

## Phase 4 - Integrasi Tesseract

- [x] Integrasikan helper layout ke handler `run-ocr`
- [x] Gunakan `psm 6` untuk inside region
- [x] Gunakan `psm 11` atau `12` untuk outside region
- [x] Pastikan fallback full page tetap memakai jalur existing
- [x] Tulis output final ke file target yang sama

## Phase 5 - Integrasi Engine Lain

- [ ] Integrasikan helper layout ke `run-ocr-easy`
- [ ] Integrasikan helper layout ke `run-ocr-kraken`
- [ ] Integrasikan helper layout ke `run-ocr-vision`
- [ ] Tentukan apakah `arabic_dl` ikut V1 atau ditunda ke V1.1
- [ ] Pastikan mode `box_notes` memproses crop region, bukan full page mentah

## Phase 6 - Re-OCR Single File

- [x] Integrasikan helper layout ke `run-ocr-file`
- [x] Pastikan hasil re-OCR sama formatnya dengan batch OCR
- [ ] Verifikasi Split View tetap bisa membaca file output hasil baru

## Phase 7 - Guardrails dan Logging

- [ ] Tambahkan log internal untuk hasil deteksi box
- [ ] Tambahkan log fallback saat box tidak terdeteksi
- [ ] Lewati outside region yang terlalu kecil atau kosong
- [ ] Tambahkan threshold minimum text sebelum menulis blok outside

## Phase 8 - QA

- [ ] Uji halaman dengan frame jelas
- [ ] Uji halaman tanpa frame
- [ ] Uji halaman frame tipis
- [ ] Uji halaman miring atau noisy
- [ ] Uji halaman dengan catatan hanya di satu sisi
- [ ] Uji batch campuran antara halaman ber-box dan tanpa box
- [ ] Uji re-OCR satu file dari Split View

## Phase 9 - Release Readiness

- [ ] Update dokumentasi pengguna bila layout mode sudah aktif
- [x] Catat limitasi V1 di docs
- [ ] Siapkan contoh input-output untuk validasi cepat
- [ ] Putuskan backlog V2:
  - multi-box
  - metadata bbox
  - visual preview
  - note ordering khusus Arabic
