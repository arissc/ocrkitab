# Translation Style Memory

## Tujuan

Dokumen ini merangkum usulan pengembangan `style memory` untuk proses translate Arab -> Indonesia di repo `reader`, khususnya agar:

- gaya terjemahan lebih konsisten antar halaman
- kitab baru tetap punya baseline gaya meskipun referensi kitab itu sendiri masih sedikit
- sistem bisa belajar bertahap dari hasil translate yang terus bertambah
- `global style` tidak statis, tetapi berkembang seiring bertambahnya konteks berkualitas

Dokumen ini dimaksudkan sebagai desain lanjutan di atas fondasi yang sudah ada sekarang:

- `translation_memory`
- `translation_glossary`
- `source unit context`
- `semantic retrieval`
- `translate-ai` generic dispatcher

## Kondisi Saat Ini

Flow translate saat ini sudah cukup kuat untuk konsistensi istilah dan reuse hasil lama.

Komponen yang sudah ada:

- `electron/main.js`
  - handler `translate-ai`
  - prompt builder
  - semantic retrieval context
- `electron/db.js`
  - `getTranslationAssistContext()`
  - `getSourceUnitContext()`
  - `translation_memory`
  - `saveTranslation()`
- `src/renderer/pages/SplitViewPage.jsx`
  - panel observability untuk TM, glossary, source context, dan prompt trace

Kelebihan flow sekarang:

- exact match bisa short-circuit tanpa panggil AI
- similar TM dan semantic examples sudah membantu konsistensi
- source unit `prev/current/next` sudah membantu konteks halaman
- hasil AI yang disimpan menjadi referensi untuk request berikutnya

Keterbatasan flow sekarang:

- belum ada ringkasan gaya per kitab yang eksplisit
- belum ada ringkasan gaya global sebagai fallback resmi
- konteks halaman sebelumnya lebih dominan berupa `source context`, belum berupa `approved translation style context`
- gaya masih sangat bergantung pada contoh yang kebetulan terambil di retrieval saat request itu berjalan

## Masalah Yang Ingin Diselesaikan

Target utama `style memory` bukan menggantikan translation memory, tetapi menutup gap berikut:

- kitab baru belum punya cukup TM internal
- kitab lama punya TM, tetapi gaya keseluruhan belum diringkas menjadi aturan yang stabil
- beberapa halaman bisa konsisten istilah, tetapi tidak konsisten ritme bahasa
- fallback ke prompt default masih terlalu umum

## Prinsip Desain

### 1. Style memory adalah layer tambahan

`style memory` harus menjadi pelengkap di atas:

- glossary
- exact TM
- similar TM
- source unit context
- semantic examples

Urutan prioritas yang disarankan:

1. exact translation memory
2. glossary penting
3. style profile kitab
4. style profile global
5. semantic examples
6. nearby source context

### 2. Jangan scan realtime setiap request

Scan besar seluruh database saat tombol translate ditekan akan mahal, lambat, dan sulit diprediksi.

Pendekatan yang lebih baik:

- scan dan rangkum secara offline atau on-demand
- simpan hasil ringkasan ke database
- saat runtime, ambil ringkasan itu sebagai prompt block yang ringan

### 3. Kualitas data lebih penting daripada jumlah

Jangan semua hasil translate dijadikan sumber gaya.

Prioritas sumber belajar:

- `approved`
- `reviewed`
- `manual_edit`
- `manual_ai_review`

Data yang sebaiknya dibatasi atau dikecualikan:

- `low_confidence`
- `rejected`
- output AI mentah yang belum pernah direview

### 4. Global style harus bisa berkembang

`global style` jangan dianggap satu prompt tetap yang ditulis sekali lalu selesai.

Targetnya:

- semakin banyak koreksi dan approval berkualitas, semakin matang gaya global
- tetap ada kontrol supaya global style tidak rusak oleh data noisy
- perubahan global style harus bisa diaudit dan direbuild

## Konsep Arsitektur

### Layer 1 - Terminology Memory

Fokus:

- istilah tetap
- nama tokoh
- gelar ulama
- lafaz doa
- istilah tasawuf, fiqih, nahwu, manaqib

Sumber:

- glossary manual
- entri yang sering muncul pada translation memory berkualitas tinggi

Output ke prompt:

- daftar istilah prioritas
- aturan transliterasi atau terjemahan yang harus konsisten

### Layer 2 - Style Profile

Fokus:

- sifat bahasa
- tingkat literalitas
- cara menyusun kalimat Indonesia
- cara memperlakukan metafora, doa, dan gelar
- nada bahasa pesantren yang diinginkan

Scope yang disarankan:

- `kitab`
- `author`
- `global`

Output ke prompt:

- ringkasan gaya 8-20 butir aturan singkat

### Layer 3 - Representative Samples

Fokus:

- contoh pasangan sumber-terjemahan terbaik yang paling representatif

Batas:

- maksimal 2-3 sample per request
- hanya dipakai jika runtime budget memungkinkan

Output ke prompt:

- few-shot mini examples

## Proposal Menu Di Settings

Tambahkan section baru di `SettingsPage.jsx`:

`Translation Style Memory`

Menu dan aksi yang disarankan:

- `Generate Global Style`
- `Generate Style Per Kitab`
- `Rebuild All Profiles`
- `Preview Profile`
- `Compare Profile Versions`
- `Use Global Style In Translate`
- `Use Kitab Style In Translate`
- `Use Representative Samples`

Filter sumber data:

- `Approved only`
- `Approved + Reviewed`
- `Exclude low confidence`
- `Minimum sample count`
- `Only from manual corrections`

Pengaturan strategi:

- `Global only`
- `Kitab first, fallback global`
- `Kitab -> author -> global`
- `Use style summary only`
- `Use style summary + samples`

## Schema Yang Disarankan

### Opsi Minimum

Tabel baru:

`translation_style_profiles`

Field minimum:

- `id`
- `scope_type`
- `scope_id`
- `scope_label`
- `profile_status`
- `source_filter_json`
- `sample_count`
- `approved_count`
- `reviewed_count`
- `low_confidence_excluded_count`
- `style_summary`
- `style_rules_json`
- `preferred_terms_json`
- `representative_examples_json`
- `profile_version`
- `created_at`
- `updated_at`

Nilai `scope_type`:

- `global`
- `kitab`
- `author`

### Opsi Lebih Lengkap

Tambahkan tabel histori:

`translation_style_profile_versions`

Tujuan:

- menyimpan versi profile lama
- memudahkan rollback
- memudahkan audit perubahan style

## Cara Generate Style Profile

### Input

Ambil translation yang lolos filter kualitas:

- status approval baik
- confidence cukup
- bukan noise
- cukup representatif untuk domain kitab

### Proses

1. kumpulkan kandidat
2. buang duplikasi kasar
3. ranking berdasarkan kualitas
4. ambil sample representatif
5. minta AI merangkum pola gaya dalam format terstruktur
6. simpan hasil profile ke DB

### Format Ringkasan Yang Disarankan

AI tidak perlu membuat esai panjang. Hasil terbaik justru format ringkas dan stabil.

Contoh blok `style_summary`:

```text
- Gunakan bahasa Indonesia religius yang natural, bukan akademik modern.
- Pertahankan kedekatan makna dengan susunan Arab, tetapi tetap enak dibaca.
- Gelar ulama dipertahankan sebagai gelar, bukan diterjemahkan literal.
- Doa setelah nama diterjemahkan ke makna Indonesia, bukan ditransliterasi.
- Istilah tasawuf dipertahankan nuansa simboliknya, jangan dirasionalisasi.
- Hindari penjelasan tambahan, tafsir, atau perluasan makna.
- Bila kalimat panjang, pecah seperlunya tanpa mengubah urutan logika.
```

Contoh `style_rules_json`:

```json
[
  "Gunakan bahasa terjemahan kitab gaya pesantren.",
  "Jangan memakai istilah akademik modern bila tidak tersurat.",
  "Pertahankan sifat simbolik pada ungkapan sufistik.",
  "Terjemahkan doa menjadi makna Indonesia, bukan transliterasi."
]
```

## Runtime Prompt Strategy

Saat `translate-ai` dipanggil, prompt builder dapat menambahkan blok baru:

1. `Kitab Style Profile`
2. jika tidak ada, `Author Style Profile`
3. jika tidak ada, `Global Style Profile`

Prompt block yang disarankan:

```text
Style profile yang harus diikuti:
- ...
- ...

Istilah prioritas:
- ...
- ...
```

Jika runtime budget cukup:

```text
Contoh gaya representatif:
1. Sumber: ...
   Terjemahan: ...
2. Sumber: ...
   Terjemahan: ...
```

## Opsi Bagaimana Global Style Bisa Berkembang

Berikut beberapa opsi yang bisa dipilih. Tidak semuanya harus dipakai sekaligus.

### Opsi A - Static Curated Global Style

Cara kerja:

- generate sekali dari sample yang dipilih manual
- profile global relatif jarang berubah

Kelebihan:

- paling aman
- hasil stabil
- mudah diaudit

Kekurangan:

- lambat beradaptasi
- kurang belajar dari koreksi terbaru

Kapan cocok:

- saat fase awal implementasi
- saat ingin baseline yang aman dulu

### Opsi B - Rebuild On Demand

Cara kerja:

- global style di-regenerate ketika user klik tombol `Rebuild Global Style`
- tidak otomatis berubah setiap ada translation baru

Kelebihan:

- tetap aman
- user punya kontrol penuh
- cocok untuk dataset yang sedang tumbuh

Kekurangan:

- perubahan gaya tidak otomatis terasa

Kapan cocok:

- rekomendasi terbaik untuk phase pertama

### Opsi C - Incremental Rolling Update

Cara kerja:

- setiap ada sejumlah translation baru yang lolos filter, sistem menambahkannya ke pool
- profile global diperbarui bertahap dari ringkasan sebelumnya + sample baru

Kelebihan:

- style global hidup dan berkembang
- cepat menangkap pola baru

Kekurangan:

- ada risiko drift
- jika sample buruk lolos, profile bisa ikut bias

Kapan cocok:

- setelah filter kualitas dan review workflow sudah matang

### Opsi D - Weighted Global Style

Cara kerja:

- semua sample diberi bobot
- approval, manual correction, dan frequent reuse punya bobot lebih tinggi
- low confidence dan rejected berbobot nol atau negatif

Contoh sinyal bobot:

- `approved`: +5
- `reviewed`: +3
- `manual_edit`: +4
- `ai_result_accepted`: +2
- `low_confidence`: -3
- `rejected`: -5

Kelebihan:

- lebih adaptif tanpa terlalu liar
- kualitas sample lebih terjaga

Kekurangan:

- perlu desain ranking yang lebih rapi
- sedikit lebih rumit di backend

Kapan cocok:

- sangat baik untuk phase menengah

### Opsi E - Hybrid Summary + Rules Lock

Cara kerja:

- sebagian profile boleh berkembang otomatis
- sebagian aturan inti dikunci manual

Contoh aturan yang dikunci:

- gelar ulama
- pola terjemah doa
- larangan istilah akademik modern tertentu
- gaya dasar pesantren

Bagian yang berkembang otomatis:

- kecenderungan ritme kalimat
- diksi yang lebih sering dipilih editor
- variasi transisi antar kalimat

Kelebihan:

- fleksibel tapi tetap aman
- mencegah drift pada aturan yang sangat penting

Kekurangan:

- butuh pemisahan jelas antara `locked rules` dan `adaptive rules`

Kapan cocok:

- ini kandidat terbaik untuk target jangka panjang

### Opsi F - Clustered Global Style

Cara kerja:

- global style tidak tunggal
- sistem membentuk beberapa profile global per cluster:
  - manaqib
  - tasawuf
  - fiqih
  - biografi ulama
  - matan ringkas

Saat kitab baru datang:

- sistem pilih cluster yang paling mirip
- pakai profile cluster itu sebagai fallback sebelum profile kitab cukup matang

Kelebihan:

- fallback lebih relevan
- kitab baru tidak dipaksa memakai satu gaya global yang terlalu umum

Kekurangan:

- perlu klasifikasi cluster atau semantic grouping
- implementasi lebih berat

Kapan cocok:

- phase lanjutan setelah global style dasar stabil

## Rekomendasi Saya

Urutan implementasi yang saya sarankan:

### Phase 1 [Done]

- buat `Global Style Profile`
- generate manual dari sample berkualitas
- rebuild via Settings
- pakai sebagai fallback di prompt

Status implementasi:

- selesai
- sudah ada `global style profile`
- sudah ada `Preview/Rebuild` di Settings
- aktivasi versi masih manual
- runtime fallback sudah memakai `global style profile`

Strategi:

- `Opsi B - Rebuild On Demand`

Alasan:

- paling aman
- paling mudah diimplementasikan
- cukup kuat untuk kitab baru tanpa referensi

### Phase 2 [Done]

- tambah `Kitab Style Profile`
- runtime order:
  - kitab
  - global

Status implementasi:

- selesai
- sudah ada `kitab style profile`
- Settings sudah bisa `Preview/Rebuild` per kitab
- aktivasi versi kitab tetap manual
- runtime sudah prioritas `kitab -> global`

### Phase 3 [Done]

- tambah bobot kualitas dan representative samples

Strategi:

- `Opsi D - Weighted Global Style`

Status implementasi:

- selesai
- profile draft sekarang memakai ranking `quality-weighted`
- representative samples sudah tersimpan di metadata profile
- representative samples bisa ikut ke prompt secara opsional dari Settings
- Settings sudah punya kontrol untuk weighting dan jumlah sample prompt

### Phase 4 [Done]

- pisahkan `locked rules` dan `adaptive rules`
- mulai siapkan `clustered global style`

Strategi:

- `Opsi E`
- lalu `Opsi F`

Status implementasi:

- selesai
- draft profile sekarang memisahkan `locked rules` dan `adaptive rules`
- Settings sudah punya kontrol manual untuk `locked rules`
- runtime fallback sekarang bisa `kitab -> global_cluster -> global`
- Settings sudah bisa preview dan rebuild `cluster style profile`
- pemilihan cluster masih heuristic ringan / manual default, belum clustering penuh otomatis

## Desain Fallback Yang Disarankan

Untuk request translate:

1. exact TM
2. kitab style profile
3. author style profile
4. clustered global style
5. global style default

Jika belum ada profile kitab:

- pakai global style
- tetap simpan hasil review ke corpus kitab itu
- setelah sample cukup, generate profile kitab

## Safeguards

Supaya global style tidak rusak seiring bertambahnya data:

- jangan update otomatis bila sample baru di bawah threshold minimum
- exclude `rejected`
- exclude `low_confidence` kecuali di-override manual
- simpan versi profile
- tampilkan preview sebelum profile baru dijadikan aktif
- sediakan tombol rollback ke versi sebelumnya

## Keputusan Default Phase 1

Untuk implementasi awal, pilihan aman yang dipakai adalah:

1. `global profile` dibangun lewat `manual rebuild`, bukan adaptif realtime
2. sumber profile global hanya dari sample `approved`
3. prompt runtime memakai `style summary` saja, bukan representative samples
4. fallback awal cukup `global`, belum masuk `author/cluster`
5. profile baru tidak aktif otomatis; user harus review lalu aktivasi manual

## Rekomendasi Final

Jika target utamanya adalah kitab baru tanpa referensi, pendekatan terbaik adalah:

- buat `global style` lebih dulu
- global style dibangun dari sample `approved` berkualitas tinggi
- user punya menu `Preview/Generate/Rebuild` di Settings
- profile global dipakai sebagai fallback resmi saat kitab belum punya cukup konteks
- setelah konteks kitab bertambah, sistem beralih perlahan ke `kitab style profile`

Dengan pendekatan ini, sistem:

- tetap aman di awal
- bisa berkembang bertahap
- tidak terlalu mahal saat runtime
- lebih mudah diaudit dan diperbaiki

## Kandidat File Yang Akan Tersentuh Saat Implementasi

Jika desain ini disetujui, area kode yang kemungkinan perlu diubah:

- `src/renderer/pages/SettingsPage.jsx`
- `electron/main.js`
- `electron/db.js`
- `electron/preload.js`
- opsional: `src/renderer/pages/SplitViewPage.jsx` untuk observability tambahan

## Catatan Penutup

Ide membuat menu di Settings untuk scan sample database dan menyimpulkan gaya adalah arah yang tepat, asalkan implementasinya dibuat sebagai:

- profile yang diringkas
- tersimpan
- versioned
- bisa di-preview
- bisa di-rebuild
- dipakai sebagai fallback prompt yang ringan

Bukan sebagai:

- scan besar tiap request
- prompt mentah berisi terlalu banyak contoh
- global style tunggal yang tidak bisa dikontrol
