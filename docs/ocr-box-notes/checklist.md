# Checklist Pengembangan OCR Box Notes

## Produk

- [x] Mode baru bernama jelas dan mudah dipahami pengguna
- [x] Default tetap `Full Page`
- [ ] Copy UI menjelaskan bahwa teks luar box ditambahkan di bawah hasil OCR
- [ ] Tidak ada perubahan struktur output file

## UI

- [x] Dropdown atau selector layout tampil di halaman OCR
- [x] Nilai layout tersimpan ke settings
- [x] Nilai layout dimuat kembali saat halaman dibuka
- [x] Input padding memiliki default aman
- [x] Validasi input persentase mencegah nilai aneh

## Backend

- [ ] Semua handler OCR membaca `layoutMode`
- [x] Helper layout berada di file terpisah dari `main.js`
- [x] Deteksi box berjalan pada gambar asli atau preprocess khusus deteksi
- [x] Crop inside menghindari garis frame
- [x] Crop outside tidak memasukkan frame line sebanyak mungkin
- [x] Region kecil atau kosong di-skip
- [x] Temp files dibersihkan

## OCR Output

- [x] Main text ditulis lebih dulu
- [x] Pemisah `--- OUTSIDE BOX ---` hanya muncul jika ada isi outside
- [x] Zona outside berurutan `top -> right -> bottom -> left`
- [x] Format tag konsisten
- [x] Fallback full page tetap menghasilkan `.txt`

## Kompatibilitas

- [ ] Payload lama tetap berjalan
- [x] Re-OCR satu file tetap berfungsi
- [ ] Progress event UI tidak rusak
- [ ] Engine yang belum diprioritaskan tetap aman di mode `full`

## QA

- [ ] Ada sampel halaman dengan main box jelas
- [ ] Ada sampel halaman tanpa main box
- [ ] Ada sampel halaman dengan noise tinggi
- [ ] Ada sampel dengan note kanan dan kiri
- [ ] Hasil sudah dibandingkan dengan output full page lama

## Dokumentasi

- [x] Spesifikasi fitur tersedia
- [x] Desain teknis tersedia
- [x] Task breakdown tersedia
- [x] Test cases tersedia
- [x] Limitasi V1 terdokumentasi
