# Test Cases OCR Box Notes

## Cara Pakai

Untuk setiap test case:

1. Jalankan OCR dalam mode `Full Page`
2. Jalankan OCR dalam mode `Inside Box + Mark Outside`
3. Bandingkan hasil teks utama, blok outside, dan stabilitas proses

## TC-01 Halaman dengan Main Box Jelas

Input:

- Halaman kitab dengan frame tegas di tengah
- Ada catatan di margin kanan dan kiri

Ekspektasi:

- Box terdeteksi
- Isi utama lebih bersih daripada mode full page
- Note kanan dan kiri masuk ke blok outside
- Output tetap satu file `.txt`

## TC-02 Halaman Tanpa Main Box

Input:

- Halaman kitab biasa tanpa frame

Ekspektasi:

- Sistem fallback ke full page
- Tidak muncul error fatal
- File `.txt` tetap terbentuk
- Blok `OUTSIDE BOX` tidak wajib muncul

## TC-03 Frame Tipis

Input:

- Halaman dengan garis frame tipis dan kontras rendah

Ekspektasi:

- Jika box masih terdeteksi, crop inside tidak memakan garis frame
- Jika box gagal terdeteksi, fallback berjalan normal
- Tidak ada crash atau batch stop

## TC-04 Halaman Miring

Input:

- Scan sedikit skew

Ekspektasi:

- Deteksi box tetap masuk akal atau fallback aman
- Isi utama tidak lebih buruk secara signifikan dari full page

## TC-05 Note Hanya di Atas

Input:

- Catatan hanya di area top margin

Ekspektasi:

- Hanya `[OUTSIDE:top]` yang muncul
- Zona lain boleh tidak ditulis

## TC-06 Note Hanya di Kanan

Input:

- Catatan hanya di margin kanan

Ekspektasi:

- Hanya `[OUTSIDE:right]` yang muncul
- Main text tetap berasal dari inside box

## TC-07 Margin Kosong

Input:

- Halaman ber-box tanpa note di luar

Ekspektasi:

- Main text tetap benar
- Blok `--- OUTSIDE BOX ---` tidak ditulis

## TC-08 Batch Campuran

Input:

- Satu folder berisi campuran:
  - halaman ber-box
  - halaman tanpa box
  - halaman noisy

Ekspektasi:

- Batch selesai penuh
- Tiap halaman memakai jalur yang sesuai
- Progress UI tetap akurat

## TC-09 Re-OCR Single File

Input:

- Jalankan re-OCR dari Split View untuk satu halaman ber-box

Ekspektasi:

- Format output sama seperti batch OCR
- File target diperbarui dengan benar
- Split View tetap bisa menampilkan hasil baru

## TC-10 Perbandingan Hasil

Tujuan:

- Menilai apakah mode baru benar-benar meningkatkan kualitas

Metrik manual yang disarankan:

1. Jumlah noise margin yang masuk ke teks utama
2. Kelengkapan note luar box
3. Konsistensi struktur output
4. Keberhasilan fallback

## Exit Criteria QA

- Tidak ada crash pada batch OCR
- Fallback full page lolos
- Minimal 3 sampel halaman ber-box menunjukkan perbaikan kualitas teks utama
- Format output konsisten di batch dan single-file
