# Saran Pengembangan SplitViewPage

Dokumen ini berisi saran pengembangan untuk halaman `SplitViewPage.jsx` berdasarkan analisis dari dua sudut pandang pengguna: **Pembaca Buku/Kitab** dan **Frontend Designer**.

## 1. Perspektif Pembaca Buku / Kitab (Keterbacaan & Penggunaan)

Fokus utama bagi pembaca adalah kenyamanan mata dan kemudahan dalam menelaah teks asli beserta terjemahannya.

*   **Dukungan RTL dan Font Arab Khusus:** 
    Teks hasil OCR (berbahasa Arab) harus ditambahkan atribut `dir="rtl"` dan diselaraskan ke kanan (`text-align: right`). Gunakan tipografi khusus teks Arab (seperti *LPMQ*, *Traditional Arabic*, atau *Amiri*) agar harakat dan bentuk huruf saling terpisah dengan jelas dan mudah dibaca.
*   **Tata Letak Terjemahan yang Sejajar:** 
    Terjemahan tidak boleh diletakkan di bagian bawah yang mengharuskan *scroll* naik-turun. Buat teks Arab dan terjemahan saling bersebelahan, atau ciptakan mekanisme agar baris yang sedang dibaca selalu sejajar antara versi asli dan terjemahannya.
*   **Fitur Ukuran Teks (Zoom Teks):** 
    Tambahkan kontrol untuk memperbesar atau memperkecil ukuran *font* secara independen pada area teks Arab dan area terjemahan, tidak hanya *zoom* untuk gambar aslinya.
*   **Mode Membaca (Tema Layar):** 
    Tambahkan *Reading Mode* seperti *Dark Mode* atau *Sepia* (warna kertas kekuningan) untuk mengurangi kelelahan mata saat menelaah kitab dalam waktu yang lama.
*   **Highlight Pasangan Kalimat:** 
    Hindari render teks berupa satu blok besar (`pre-wrap`). Pecah menjadi segmen-segmen kalimat sehingga pengguna dapat mengklik suatu kalimat Arab dan kalimat terjemahan yang berpasangan dengannya akan otomatis tersorot (*highlighted*).

## 2. Perspektif Frontend Designer (Tata Letak & UI/UX)

Fokus utama desainer adalah hierarki visual, kebersihan antarmuka (*clutter-free*), dan efisiensi tata letak pada layar.

*   **Penyederhanaan Header Toolbar:** 
    Kelompokkan tombol-tombol aksi (OCR, Provider AI, Translate, History, Review) ke dalam satu *Toolbar* global yang terpusat di atas. Sembunyikan pengaturan *engine/provider* ke dalam *dropdown* (⚙️ Settings) agar tidak memicu *cognitive overload*.
*   **Mode Tampilan (View Modes):** 
    Daripada memaksakan 3 kolom (Triptych) yang akan membuat setiap bagian menjadi sempit, terapkan 3 mode tampilan (*View Modes*) yang merespons kebutuhan pengguna:
    *   **Reader Mode:** Mode default. Gambar kitab tampil dominan (full width / sangat besar). Teks OCR dan toolbar teknis disembunyikan. Cocok untuk membaca murni.
    *   **Study Mode:** Pembagian 50:50 antara Gambar Kitab dan Teks. Toolbar kompleks disembunyikan. Teks Arab dan Terjemahan ditampilkan secara berdampingan atau atas-bawah yang nyaman. Cocok untuk menelaah kitab sambil melihat terjemahan.
    *   **OCR/Edit Mode:** Mode teknis. Membuka panel 3 kolom atau grid penuh untuk membandingkan Gambar, Teks OCR asli, dan panel eksekusi (Translate, AI Prompt, Review Status).
*   **Isolasi Data Teknis:** 
    Pindahkan panel elemen `<details>` yang berisi log/data teknis analitik (seperti "Prompt ke AI", "Semantic Observability") ke dalam *Offcanvas* (laci yang bisa ditarik dari samping) atau *Modal*. Area baca harus dibersihkan dari *noise* data teknis.
*   **Konsistensi Penempatan Kontrol:** 
    Satukan tombol yang berkaitan. Contoh: letakkan tombol sinkronisasi seperti "Sync Segments" di dekat tombol kontrol teks lainnya, jangan diisolasi di bawah panel gambar.
*   **Manajemen Floating UI yang Rapi:** 
    Evaluasi posisi elemen *fixed* seperti panel *Voice Command* dan *Audio Player*. Pastikan elemen mengambang ini bisa di-*minimize* agar tidak menutupi teks penting saat pengguna melakukan *scroll*.

## 3. Sinergi Pengembangan (Kesimpulan Matching)

Untuk mengakomodasi kenyamanan pembaca sekaligus mempertahankan desain UI yang modern, pengembangan antarmuka harus menggunakan pendekatan **"Reader-Centric with Hidden Tools"** (Fokus pada Pembaca, dengan Alat yang Tersembunyi):

1.  **Fase Layouting:** Rombak struktur grid layar menjadi tiga panel sejajar (Gambar - Arab - Indonesia) untuk sinkronisasi baca yang maksimal, tanpa membuang ruang kosong di bagian bawah.
2.  **Fase Tipografi & Tema:** Terapkan standar web untuk multibahasa (RTL support, font loading, tema warna baca).
3.  **Fase Deklusterisasi UI:** Sembunyikan tombol-tombol pengembang/sistem (seperti log semantic dan pilihan model GPT/Gemini) ke dalam "Developer / Advanced Menu" terpisah. Tinggalkan hanya *action button* esensial di halaman utama baca.
