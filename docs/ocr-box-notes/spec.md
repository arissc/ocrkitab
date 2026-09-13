# Spesifikasi Fitur OCR Box Notes

## Ringkasan

Fitur ini menambahkan mode OCR baru untuk halaman kitab yang memiliki kotak teks utama di tengah dan catatan tambahan di luar kotak. Sistem harus memprioritaskan teks di dalam kotak sebagai hasil utama, lalu menambahkan teks luar kotak di bagian bawah file yang sama dengan penanda yang jelas.

## Tujuan

1. Mengurangi noise OCR dari margin ketika halaman memiliki frame teks utama.
2. Tetap menyimpan informasi catatan luar box tanpa membuat file terpisah.
3. Menjaga flow pengguna sekarang tetap sederhana dengan satu output `.txt` per halaman.

## Masalah Saat Ini

- OCR berjalan pada seluruh halaman tanpa pemahaman layout.
- Catatan pinggir, syarah, dan teks margin sering bercampur dengan isi utama.
- Pengguna tidak punya cara untuk memilih OCR yang fokus ke blok utama tanpa membuang catatan luar.

## Scope V1

1. Tambah opsi layout OCR di UI:
   - `Full Page`
   - `Inside Box + Mark Outside`
2. Kirim parameter layout mode dari UI ke backend.
3. Jika layout mode `box_notes` aktif:
   - deteksi main box
   - bentuk region inside dan outside
   - lakukan OCR terpisah
   - gabungkan ke satu file `.txt`
4. Jika box gagal dideteksi:
   - fallback ke OCR full page
   - tidak error
5. Format output luar box ditulis setelah pemisah `--- OUTSIDE BOX ---`.

## Di Luar Scope V1

- Multi-box layout.
- Visual overlay box detection di UI.
- Penyimpanan metadata bounding box ke database.
- Editor khusus untuk note per zona.
- Auto-learning atau ML-based layout detector.

## Aktor

1. Operator OCR kitab yang memproses folder gambar menjadi folder teks.
2. Pengguna Split View yang melakukan re-OCR per halaman melalui backend yang sama.

## User Stories

1. Sebagai operator OCR, saya ingin mode yang fokus ke teks dalam box agar hasil utama lebih bersih.
2. Sebagai operator OCR, saya tetap ingin catatan luar box tersimpan di file yang sama agar konteks halaman tidak hilang.
3. Sebagai pengguna re-OCR, saya ingin fallback otomatis saat box tidak terdeteksi agar proses tidak terhenti.

## Alur Pengguna

1. Pengguna membuka halaman OCR.
2. Pengguna memilih engine OCR seperti biasa.
3. Pengguna memilih mode layout OCR.
4. Pengguna menjalankan OCR folder.
5. Sistem memproses setiap halaman dan menyimpan satu file `.txt` per halaman.
6. Jika box ditemukan, output berisi teks utama lalu blok `OUTSIDE BOX`.
7. Jika box tidak ditemukan, output sama seperti OCR biasa.

## Acceptance Criteria

### Fungsional

1. Mode default tetap `Full Page`.
2. Saat mode `Inside Box + Mark Outside` dipilih, payload backend memuat parameter layout mode.
3. Saat box terdeteksi:
   - isi utama diambil dari crop inside box
   - note luar box ditambahkan di bawah hasil utama
   - region kosong tidak wajib ditulis
4. Saat box tidak terdeteksi:
   - OCR tetap menghasilkan file `.txt`
   - proses batch tetap lanjut ke file berikutnya
5. Format output konsisten di seluruh engine yang didukung.

### Kualitas

1. Tidak ada perubahan nama file output.
2. Mode baru tidak memutus alur OCR lama.
3. Kesalahan per halaman tetap dilaporkan melalui progress log yang ada.

## Definisi Output

Contoh minimal:

```text
isi utama...

--- OUTSIDE BOX ---
[OUTSIDE:right] catatan kanan...
[OUTSIDE:left] catatan kiri...
```

## Constraint Teknis

1. UI saat ini memakai IPC bridge Electron yang sudah stabil, jadi perubahan harus kompatibel dengan channel yang ada.
2. Backend batch OCR saat ini tersebar di beberapa handler engine di `electron/main.js`.
3. Repo belum memiliki dependency image-processing native di `package.json`, jadi V1 lebih aman jika memanfaatkan `magick` helper yang sudah dipakai preprocessing atau helper Python kecil yang terisolasi.

## Keputusan Scope V1

1. Satu parameter baru untuk layout mode diterapkan lintas handler OCR.
2. Tesseract mendapat tuning `psm` terpisah untuk inside dan outside.
3. Engine lain mengikuti strategi crop-first tanpa harus punya tuning parameter khusus.
4. Re-OCR per halaman mengikuti kontrak yang sama agar tidak terjadi perilaku berbeda antara batch OCR dan single-page OCR.
