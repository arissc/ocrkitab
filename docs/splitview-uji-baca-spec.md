# SplitView Uji Baca Spec

## Ringkasan

Dokumen ini menetapkan arah implementasi fitur `uji baca` di `reader`, khususnya pada halaman `SplitViewPage.jsx`.

Keputusan awal:

- Fitur `uji baca` tidak menjadi tab utama baru pada tahap awal.
- Fitur ditempatkan di dalam mode `study` sebagai subfitur atau subtab.
- Nama kerja yang direkomendasikan: `Uji Baca`.
- Tab utama tetap: `Reader`, `Study`, `OCR/Edit`.

Pendekatan ini menjaga `reader` tetap fokus sebagai aplikasi baca kitab, sementara latihan yang lebih terstruktur tetap bisa berkembang di domain `bahasaarab`.

## Latar Belakang

Struktur project saat ini menunjukkan pemisahan tanggung jawab yang cukup jelas:

- `bahasaarab` dipakai untuk latihan bahasa Arab.
- `reader` dipakai untuk membaca kitab, OCR, dan pendampingan telaah teks.

Di `SplitViewPage.jsx`, mode tampilan yang sudah ada adalah:

- `reader`: fokus baca
- `study`: fokus telaah
- `ocr`: fokus teknis OCR, translate, dan review

Selain itu, halaman ini sudah memiliki fondasi fitur suara seperti:

- voice command
- speech recognition / STT
- TTS
- status listening dan hasil tangkapan suara

Karena itu, `SplitViewPage` cocok untuk versi awal fitur `uji baca` berbasis halaman aktif.

## Keputusan UX

### Penempatan Fitur

Fitur `uji baca` ditempatkan di dalam `study mode`, bukan sebagai tab utama baru.

Alasan:

- `reader` harus tetap minim distraksi dan nyaman untuk baca murni.
- `ocr` adalah workspace teknis, bukan tempat evaluasi bacaan.
- `study` sudah menjadi mode transisi antara membaca, memahami teks, dan interaksi belajar.
- User yang ingin mengecek bacaan biasanya masih berada dalam konteks halaman kitab yang sedang ditelaah, bukan berpindah ke workflow teknis OCR.

### Bentuk UI Tahap Awal

Di dalam `study`, tambahkan submode ringan:

- `Makna`
- `Uji Baca`

Atau jika ingin lebih sederhana, tetap satu mode `study` tetapi ada panel toggle:

- `Panel Makna`
- `Panel Uji Baca`

Rekomendasi awal: gunakan subtab agar alur lebih jelas.

## Tujuan MVP

Versi awal fitur `uji baca` bertujuan untuk menjawab pertanyaan berikut:

- Apakah bacaan user mirip dengan teks Arab yang sedang dibuka?
- Bagian mana yang terlewat, salah, atau berbeda?
- Apakah user perlu mengulang segmen tertentu?

MVP tidak perlu langsung membuat sistem nilai kompleks.

## Scope MVP

### Yang Masuk

- Menampilkan teks target Arab dari halaman aktif.
- Tombol mulai dan stop rekam / dengar suara.
- Konversi suara ke teks Arab atau teks hasil STT yang mendekati.
- Membandingkan hasil bacaan user dengan teks target.
- Menampilkan hasil sederhana:
  - cocok
  - kurang cocok
  - kata terlewat
  - kata berbeda
- Tombol `Ulangi` untuk mencoba lagi pada halaman yang sama.

### Yang Belum Masuk

- Scoring detail per huruf atau per harakat.
- Riwayat latihan lintas halaman.
- Progress harian.
- Leaderboard atau gamifikasi.
- Sinkronisasi penuh dengan materi latihan di `bahasaarab`.
- Analisis tajwid tingkat lanjut.

## Alur Pengguna

1. User membuka kitab pada `SplitViewPage`.
2. User pindah ke mode `Study`.
3. User membuka subtab `Uji Baca`.
4. Sistem menampilkan teks target dari halaman aktif.
5. User menekan `Mulai Baca`.
6. Sistem merekam suara lalu mengubahnya menjadi teks.
7. Sistem membandingkan hasil STT dengan teks target.
8. Sistem menampilkan ringkasan:
   - cocok sebagian
   - ada bagian terlewat
   - ada kata yang berbeda
9. User bisa menekan `Coba Lagi` atau pindah halaman.

## Rekomendasi Layout

Untuk MVP di `study mode`:

- Kiri: gambar kitab tetap terlihat.
- Kanan atas: teks target Arab.
- Kanan bawah: hasil bacaan user dan hasil evaluasi.

Jika ruang sempit:

- Kiri: gambar kitab.
- Kanan: subtab `Makna | Uji Baca`.

Saat subtab `Uji Baca` aktif:

- tampilkan teks target
- tampilkan tombol mic
- tampilkan hasil STT
- tampilkan hasil mismatch sederhana

## Logika Evaluasi Awal

Agar cepat dijalankan, evaluasi tahap awal cukup berbasis normalisasi teks:

- hapus spasi ganda
- samakan bentuk variasi karakter yang perlu dinormalisasi
- opsi awal: abaikan sebagian harakat
- bandingkan token per kata

Hasil evaluasi awal dapat dibagi menjadi:

- `match_high`
- `match_partial`
- `mismatch`

Data turunan yang bisa ditampilkan:

- kata target yang tidak terbaca
- kata hasil bacaan yang tidak ada di target
- persentase kemiripan kasar

## Rekomendasi Teknis Tahap 1

### State Baru di SplitViewPage

Perkiraan state yang dibutuhkan:

- `studySubMode`
- `readingTestActive`
- `readingTargetText`
- `readingTranscript`
- `readingComparison`
- `readingTestStatus`
- `readingTestError`

### Helper yang Disarankan

Pisahkan helper agar file tidak makin padat:

- `normalizeArabicForComparison(text)`
- `compareReadingTranscript(target, transcript)`
- `formatReadingFeedback(result)`

Jika logic berkembang, helper bisa dipindah ke file util terpisah.

### Reuse Fitur yang Sudah Ada

Manfaatkan fondasi yang sudah ada di `SplitViewPage`:

- state voice listening
- integrasi STT
- panel hasil teks suara
- kontrol start / stop

Yang perlu ditambah adalah:

- mode khusus untuk `uji baca`
- target text yang jelas
- hasil evaluasi yang fokus ke kecocokan bacaan, bukan command voice

## Batasan Desain

- Jangan menambah noise teknis ke `reader mode`.
- Jangan mencampur panel evaluasi bacaan ke `ocr mode`.
- Jangan jadikan fitur ini terlalu berat sebelum MVP terbukti berguna.
- Pastikan user selalu tahu bahwa ini adalah `cek bacaan cepat`, bukan penilaian tajwid final.

## Kapan Naik Menjadi Tab Utama

Fitur bisa dipromosikan menjadi tab utama baru jika nanti sudah memiliki beberapa ciri berikut:

- latihan per segmen
- skor dan histori
- repeat bagian salah
- progress per kitab atau per materi
- keterhubungan langsung dengan kurikulum di `bahasaarab`

Sebelum titik itu, penempatan di `study` masih paling aman dan paling rapi.

## Checklist Implementasi

- Tambahkan state `studySubMode` di `SplitViewPage`.
- Tambahkan UI subtab `Makna | Uji Baca` saat `viewMode === 'study'`.
- Ambil teks target dari `text` halaman aktif.
- Tambahkan panel rekam / stop untuk uji baca.
- Hubungkan hasil STT ke panel evaluasi bacaan.
- Implementasikan helper normalisasi teks Arab.
- Implementasikan perbandingan token sederhana.
- Tampilkan feedback ringkas yang mudah dipahami.
- Pastikan fallback jelas saat mic atau STT tidak tersedia.

## Definisi Selesai MVP

MVP dianggap selesai bila:

- user bisa membuka `Study > Uji Baca`
- user bisa menekan mic dan membaca
- sistem menghasilkan transcript
- sistem membandingkan transcript dengan teks target halaman aktif
- sistem menampilkan hasil kecocokan dasar yang bisa dipahami user

## Langkah Berikutnya

Setelah dokumen ini disetujui, implementasi bisa dilanjutkan dengan urutan:

1. Tambah subtab `Uji Baca` di `study mode`.
2. Buat helper perbandingan teks Arab sederhana.
3. Sambungkan hasil STT ke evaluator.
4. Rapikan panel hasil dan pesan feedback.
