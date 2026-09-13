# Translation Memory & Semantic Learning Architecture

## Purpose

Dokumen ini adalah panduan implementasi untuk mengubah proses translate Arab -> Indonesia dari model stateless menjadi sistem yang belajar dari:

- translation memory
- glossary
- similar examples
- nearby context
- editor corrections

Fokus dokumen ini adalah implementasi bertahap di repo `reader` yang ada sekarang, bukan desain ideal yang terlepas dari kondisi codebase.

## Related Docs

Dokumen turunan yang terkait dengan implementasi ini:

- [Translation Token Efficiency Strategy](./translation-token-efficiency.md)

Gunakan dokumen ini untuk keputusan yang berkaitan dengan:

- short-circuit exact TM tanpa panggil LLM
- ukuran prompt `mini`, `standard`, `full`
- kapan glossary, examples, context, dan feedback perlu dikirim
- strategi pengurangan token input dan output pada flow translate

## Important Context

Arsitektur repo saat ini berbeda dari asumsi awal dokumen lama.

Kondisi nyata repo saat ini:

- aplikasi utama adalah Electron + React
- database utama saat ini adalah MySQL
- logic translate utama ada di `electron/main.js`
- layer database utama ada di `electron/db.js`
- setting provider AI dan system prompt sudah ada
- penyimpanan hasil translate saat ini masih sederhana melalui `kitab_terjemahan`
- OCR result saat ini banyak berbasis file/folder, belum sepenuhnya menjadi corpus terstruktur di database

Artinya:

- phase awal harus memanfaatkan MySQL dan arsitektur yang sudah ada
- jangan langsung memaksa migrasi besar ke stack baru bila belum dibutuhkan
- vector search boleh datang belakangan setelah corpus dan identity data sudah rapi

## Current Baseline In Repo

Hal yang sudah tersedia dan bisa dipakai sebagai fondasi:

- provider AI dinamis melalui `api_settings`
- capability metadata pada provider
- system prompt storage dan binding
- generic translate dispatcher `translate-ai`
- penyimpanan hasil terjemahan melalui `getTranslation()` dan `saveTranslation()`
- data kitab dan folder sudah ada

Keterbatasan saat ini:

- translation retrieval masih exact match sederhana
- belum ada glossary table
- belum ada semantic retrieval
- belum ada context retrieval terstruktur
- belum ada feedback learning yang terpisah
- belum ada versioning
- belum ada confidence score

## Main Problem

Masalah utama yang ingin diselesaikan:

- terminologi tidak konsisten
- gaya terjemahan berubah-ubah
- kalimat yang sama bisa diterjemahkan berbeda
- koreksi editor tidak otomatis menjadi pengetahuan
- setiap request translate masih terlalu bergantung pada prompt saat itu saja

## Target Flow

```text
Translation Request
    ->
Pre Translation Engine
    ->
  1. Glossary Retrieval
  2. Translation Memory Search
  3. Similar Example Retrieval
  4. Nearby Context Retrieval
  5. Editor Feedback Retrieval
    ->
Prompt Builder
    ->
LLM Translation API
    ->
Human Review / Editor
    ->
Save Result + Feedback + Version + Learning Signals
```

## Core Principles

Prinsip ini wajib dijaga saat implementasi.

### 1. Backward Compatible First

Jangan merusak alur translate yang sudah berjalan.

Jika ada schema baru:

- tambahkan secara idempotent di `electron/db.js`
- pertahankan tabel lama selama masa transisi
- jangan langsung menghapus `kitab_terjemahan`

### 2. MySQL First For Early Phase

Phase awal harus selesai dulu dengan MySQL dan logic retrieval heuristik.

Tujuannya:

- cepat diimplementasikan
- resiko perubahan lebih kecil
- hasil manfaat bisa langsung dirasakan

Vector database atau `pgvector` masuk setelah corpus siap.

### 3. Provider Agnostic

Layer learning tidak boleh terikat ke OpenAI atau Gemini saja.

Yang dibangun harus bekerja di atas jalur generik:

- retrieval
- prompt builder
- feedback
- versioning
- confidence

Provider hanya menerima prompt yang sudah dirakit.

### 4. Never Overwrite Human Knowledge

Jika editor mengubah hasil AI:

- jangan overwrite tanpa jejak
- simpan versi baru
- simpan feedback pair AI vs editor
- perlakukan koreksi editor sebagai sinyal kualitas tinggi

### 5. Stable Identity Is Mandatory

Sebelum context retrieval dan feedback matang, setiap unit teks harus punya identity yang stabil.

Minimal harus bisa dibedakan berdasarkan:

- kitab
- folder
- file
- page
- paragraph atau segment

Tanpa identity yang stabil, context retrieval dan feedback akan rapuh.

### 6. Prompt Budget Must Be Controlled

Jangan memasukkan terlalu banyak contoh ke prompt.

Prioritas isi prompt:

1. glossary penting
2. exact TM
3. top similar examples
4. nearby context seperlunya
5. feedback rules yang relevan

## Modules

## Module 1 - Translation Memory

### Goal

Menggunakan kembali terjemahan lama untuk teks yang sama atau hampir sama.

### Minimum Schema

Tabel baru yang disarankan:

`translation_memory`

Field minimum:

- `id`
- `source_text`
- `source_text_normalized`
- `target_text`
- `source_hash`
- `language_from`
- `language_to`
- `usage_count`
- `quality_score`
- `last_used_at`
- `created_at`
- `updated_at`

Catatan:

- `source_text_normalized` penting untuk exact match yang lebih stabil
- `source_hash` sebaiknya dibuat dari teks Arab yang sudah dinormalisasi
- `quality_score` opsional tapi berguna untuk ranking

### Retrieval Priority

Urutan pencarian:

1. exact match by normalized hash
2. exact normalized text match
3. similar sentence match
4. substring match

### Notes

- exact TM dengan kualitas tinggi harus menjadi prioritas tertinggi
- hasil TM jangan langsung selalu final; pada phase awal cukup dipakai sebagai input prompt
- nanti bisa ditingkatkan agar exact high-confidence langsung direuse tanpa panggil LLM

## Module 2 - Glossary

### Goal

Memaksa konsistensi terminologi.

### Minimum Schema

`translation_glossary`

Field minimum:

- `id`
- `arabic`
- `arabic_normalized`
- `translation`
- `category`
- `priority`
- `description`
- `is_active`
- `created_at`
- `updated_at`

### Rules

- glossary harus selalu ikut ke prompt bila ada term yang cocok
- term dengan `priority` lebih tinggi harus didahulukan
- bila ada benturan antar-term, pilih yang paling spesifik dan paling panjang lebih dulu

### Important Detail

Untuk bahasa Arab, matching jangan bergantung pada teks mentah saja.

Normalisasi minimal perlu mempertimbangkan:

- harakat
- variasi alif
- ta marbuthah
- ya/alif maqsurah
- whitespace berlebih
- tanda baca sederhana

## Module 3 - Similar Example Retrieval

### Goal

Mengambil contoh terjemahan lama yang mirip dengan teks saat ini agar gaya lebih konsisten.

### Important Clarification

Ini bukan document RAG.

Ini adalah retrieval contoh terjemahan:

- source Arabic lama
- target Indonesian lama
- dipakai sebagai contoh gaya dan pilihan istilah

### Phase Strategy

Implementasi dibagi dua tahap:

#### Tahap awal

Gunakan retrieval non-vector dulu:

- normalized text similarity
- token overlap
- substring overlap
- optional FULLTEXT MySQL bila cocok

#### Tahap lanjut

Tambahkan embedding dan vector search:

- `pgvector`
- Qdrant
- Chroma

Pilih salah satu setelah corpus stabil.

### Output For Prompt

Hanya kirim top contoh yang benar-benar relevan.

Disarankan:

- top 3 pada awal implementasi
- naik ke top 5 bila prompt budget masih aman

## Module 4 - Context Retrieval

### Goal

Menjaga kesinambungan narasi antar halaman atau paragraf.

### Dependency

Module ini baru kuat jika OCR result sudah diimpor ke database dengan struktur yang rapi.

### Recommended Data Shape

Minimal siapkan tabel unit teks, misalnya salah satu dari:

- `kitab_pages`
- `kitab_page_segments`
- `ocr_pages`
- `ocr_segments`

Field minimum yang perlu tersedia:

- `id`
- `id_kitab`
- `folder_path`
- `file_name`
- `page_number`
- `segment_order`
- `source_text`
- `source_text_normalized`
- `created_at`

### Retrieval Rule

Prioritas context:

1. previous segment
2. current segment
3. next segment

Jika segment belum ada, fallback:

1. previous page
2. current page
3. next page

## Module 5 - Editor Feedback Learning

### Goal

Setiap koreksi editor menjadi knowledge baru.

### Minimum Schema

`translation_feedback`

Field minimum:

- `id`
- `source_unit_id`
- `source_text`
- `ai_translation`
- `editor_translation`
- `editor_name`
- `feedback_type`
- `notes`
- `created_at`

### Use

Feedback dipakai untuk:

- rule prompt seperti "selalu pakai Syekh, jangan Guru"
- menaikkan kualitas TM entry bila versi editor disetujui
- dataset continuous learning

## Module 6 - Prompt Builder

### Goal

Semua input retrieval dirakit otomatis menjadi prompt yang konsisten dan ringkas.

### Required Sections

Urutan blok yang disarankan:

1. system rules
2. matched glossary
3. exact TM hit
4. similar examples
5. editor correction rules
6. nearby context
7. current source text

### Prompt Rules

- return hanya terjemahan Indonesia
- jangan meringkas
- jangan menambah komentar
- pertahankan makna
- ikuti glossary
- ikuti contoh relevan
- gunakan gaya kitab yang konsisten

### Important Constraint

Prompt builder harus menjadi layer terpisah secara konsep, walau implementasi awal masih berada di `electron/main.js`.

Tujuannya agar nanti mudah dipindah ke helper/module sendiri.

## Module 7 - Confidence Score

### Goal

Menandai hasil translate yang aman direuse dan yang perlu review.

### Suggested Factors

- glossary hit count
- exact TM found
- similar example score
- ada atau tidak editor-backed memory
- panjang teks dan kompleksitas
- optional provider confidence

### Simple First Version

Mulai dari rules-based score dulu.

Contoh kasar:

- 90-100: exact TM atau editor-backed memory
- 70-89: strong similar example + glossary support
- 40-69: partial support
- 0-39: entirely new

## Module 8 - Translation Versioning

### Goal

Jangan pernah kehilangan histori.

### Minimum Schema

`translation_versions`

Field minimum:

- `id`
- `source_unit_id`
- `version`
- `translation`
- `source`
- `provider`
- `model`
- `created_by`
- `created_at`

Nilai `source` minimum:

- `ai`
- `human`
- `imported`
- `edited`

### Rule

- versi baru ditambah, bukan overwrite
- current active translation bisa ditentukan lewat pointer atau latest approved version

## Module 9 - Continuous Learning

### Goal

Setiap hasil yang disetujui meningkatkan kualitas request berikutnya.

### Learning Signals

- approved translation -> masuk atau update TM
- editor correction -> masuk feedback
- reused memory -> naikkan `usage_count`
- semantic index -> update bila vector layer sudah ada

## Development Phases

## Phase 0 - Baseline Alignment

### Goal

Menyelaraskan target arsitektur dengan kondisi repo sekarang.

### Work

- petakan alur translate existing dari UI ke IPC ke DB
- identifikasi semua entrypoint yang pakai `getTranslation()` dan `saveTranslation()`
- tentukan identity unit teks yang akan dipakai jangka panjang
- tetapkan strategi normalisasi teks Arab

### Done When

- daftar file kunci sudah jelas
- naming schema baru disepakati
- strategi migrasi tidak bentrok dengan fitur existing

## Phase 1 - Translation Memory + Glossary + Prompt Builder

### Goal

Menghasilkan manfaat nyata tercepat tanpa perubahan arsitektur besar.

### Status

Partial - backend inti, UI glossary, visibilitas TM atau glossary di split view, dan metrik dasar sudah tersedia. Legacy alignment dan retrieval tuning masih menjadi pekerjaan lanjutan.

### Work

- [x] tambah schema `translation_memory`
- [x] tambah schema `translation_glossary`
- [x] buat helper normalisasi teks Arab
- [x] buat retrieval exact, similar, substring di MySQL
- [x] buat prompt builder yang menggabungkan glossary + TM
- [x] sambungkan ke `translate-ai`

### Completed Scope

- schema `translation_memory` sudah tersedia di MySQL
- schema `translation_glossary` sudah tersedia di MySQL
- helper normalisasi teks Arab sudah digunakan untuk proses lookup
- retrieval `exact`, `similar`, dan `substring` sudah aktif di backend
- `translate-ai` sudah membawa glossary dan TM hit ke prompt
- exact TM hit sudah dapat short-circuit tanpa memanggil AI
- hasil translate AI sudah disimpan kembali ke `translation_memory`
- `kitab_terjemahan` existing tetap dipertahankan dan masih digunakan
- UI CRUD untuk `translation_glossary` sudah tersedia di settings
- glossary awal untuk istilah kitab, gelar, dan istilah pesantren sudah bisa di-seed
- `SplitViewPage` sudah menampilkan glossary hit, TM hit, dan exact source
- metrik sederhana `exact_hit_rate` dan `tm_reuse_rate` sudah tersedia

### Next Scope

- samakan seluruh jalur translate lama agar memakai `translate-ai`
- review kualitas scoring retrieval agar hasil `similar` lebih relevan
- tambah aturan operasional untuk kurasi istilah dan ownership glossary

### Child Phases

- `Phase 1.1 - Glossary Operations`
  - UI CRUD glossary
  - seed glossary awal
  - aktivasi atau nonaktif istilah
- `Phase 1.2 - Prompt Visibility`
  - tampilkan TM hit dan glossary hit di UI
  - tampilkan source exact atau similar yang dipakai
- `Phase 1.3 - Retrieval Tuning`
  - review scoring retrieval `similar`
  - tambah metrik exact reuse dan TM reuse
- `Phase 1.4 - Legacy Alignment`
  - samakan jalur translate lama ke `translate-ai`

### Todo List

- [x] buat halaman atau panel CRUD untuk `translation_glossary`
- [x] siapkan seed glossary awal untuk istilah kitab, gelar, dan istilah pesantren
- [x] tampilkan TM hit, glossary hit, dan exact source di `SplitViewPage`
- [ ] rapikan seluruh flow translate lama agar memakai `translate-ai`
- [x] tambah logging atau metrik untuk `exact_hit_rate` dan `tm_reuse_rate`
- [ ] evaluasi ulang threshold dan ranking retrieval `similar`

### Gap To Close

- jalur translate lama belum seluruhnya memakai `translate-ai`
- belum ada aturan operasional untuk kurasi istilah dan ownership glossary
- scoring retrieval `similar` masih perlu dievaluasi ulang agar hasil lebih relevan

### Important Notes

- phase ini harus tetap memakai MySQL
- semantic vector belum wajib
- existing `kitab_terjemahan` tetap dipertahankan

### Done When

- translate request sudah bisa membawa glossary dan TM hit ke prompt
- istilah yang sama mulai konsisten
- exact repeated text memberi hasil yang konsisten

## Phase 2 - Structured Source Units + Context Retrieval

### Goal

Menyediakan pondasi data untuk context retrieval dan retrieval yang lebih akurat.

### Status

Partial - backend dan UI kini sudah berjalan segment-first dengan aturan segmentasi dasar per paragraf atau blok, sedangkan metadata OCR kaya dan tooling sync yang lebih cerdas masih menjadi pekerjaan lanjutan.

### Work

- [x] tentukan tabel source unit untuk page atau segment
- [x] import OCR result ke database
- [x] simpan page number dan segment order
- [x] buat helper prev/current/next context
- [x] sambungkan context ke prompt builder

### Completed Scope

- schema `source_units` sudah tersedia di MySQL
- identity unit stabil sudah dibuat dengan `unit_key`
- implementasi awal memakai source unit level `page` berdasarkan file OCR `.txt`
- import OCR result dari folder `.txt` ke database sudah tersedia di backend
- `page_number` dan `segment_order` sudah disimpan
- helper `prev/current/next` context sudah aktif di backend
- context source unit sudah ikut masuk ke prompt builder `translate-ai`
- `source_units` sudah dimasukkan ke daftar cloud sync table
- tombol atau action manual untuk import atau sync `source_units` sudah tersedia di `SplitViewPage`
- preview context `prev/current/next` sudah tampil di `SplitViewPage`
- status unit aktif `page` dan `segment_order` yang sedang dipakai sudah terlihat di UI
- import `source_units` aktif sekarang memakai unit level `segment`
- aturan segmentasi dasar per paragraf atau blok sudah diterapkan saat import OCR `.txt`
- retrieval context source unit sekarang memprioritaskan `segment` lebih dulu dan fallback ke `page` bila perlu
- prompt builder sekarang bisa membawa detail `segment` dan bundle segmen halaman aktif

### Next Scope

- hubungkan hasil OCR yang lebih kaya metadata bila engine OCR nanti menyediakan bounding atau block info
- tambah tooling re-import yang lebih kaya saat folder OCR berubah, misalnya diff atau selective sync
- rapikan migrasi atau cleanup data `page` lama bila folder belum pernah di-sync ulang

### Child Phases

- `Phase 2.1 - Source Unit Operations`
  - tombol import `source_units`
  - tooling re-import atau re-sync
- `Phase 2.2 - Context Visibility`
  - preview `prev/current/next` di `SplitViewPage`
  - status unit dan page yang sedang dipakai
- `Phase 2.3 - Segment Upgrade`
  - ubah unit dari `page` ke `segment`
  - definisikan aturan segmentasi per paragraf atau blok
- `Phase 2.4 - OCR Metadata Alignment`
  - sambungkan block atau bounding box bila OCR engine mendukung

### Todo List

- [x] tambah tombol atau action manual untuk import `source_units` dari UI
- [x] tampilkan preview `prev/current/next` pada `SplitViewPage`
- [x] buat aturan segmentasi teks Arab level paragraf atau blok
- [x] migrasikan `source_units` dari mode `page` ke mode `segment`
- [ ] tambah tooling re-import saat folder OCR berubah
- [ ] siapkan integrasi metadata OCR yang lebih kaya bila engine mendukung

### Gap To Close

- belum ada deteksi perubahan folder OCR untuk sinkronisasi ulang
- belum ada pemanfaatan metadata bounding atau block dari OCR engine
- cleanup data `page` lama masih bergantung pada re-sync folder terkait

### Done When

- satu unit teks punya identity stabil
- prompt bisa menyertakan konteks sekitar

## Phase 3 - Editor Feedback + Versioning + Confidence

### Goal

Memasukkan human review ke dalam learning loop.

### Status

Partial - backend versioning, feedback, confidence, panel histori versi, compare dasar, review status dasar, dan ranking booster retrieval berbasis feedback sudah tersedia, sedangkan enrichment confidence dan diff compare yang lebih kaya masih menjadi pekerjaan lanjutan.

### Work

- [x] tambah `translation_feedback`
- [x] tambah `translation_versions`
- [x] ubah save workflow agar tidak overwrite
- [x] hitung confidence score berbasis rule
- [x] tampilkan low confidence untuk review

### Completed Scope

- schema `translation_feedback` sudah tersedia di MySQL
- schema `translation_versions` sudah tersedia di MySQL
- save workflow sudah membuat histori versi dan tidak hanya overwrite
- confidence score berbasis rule sudah dihitung di backend
- low confidence sudah ditampilkan pada UI utama yang relevan
- `kitab_terjemahan` tetap dipakai sebagai current snapshot untuk kompatibilitas
- panel histori versi sudah tersedia di `SplitViewPage`
- compare dasar antara dua versi sudah tersedia di `SplitViewPage`
- status review `reviewed`, `approved`, dan `rejected` sudah bisa dicatat dari UI
- metadata actor atau flow dasar untuk save dan review sudah mulai tercatat pada feedback history
- retrieval TM sekarang memakai feedback sebagai ranking booster
- entry dengan status `approved` atau `reviewed` sekarang diprioritaskan pada TM exact, similar, dan substring retrieval
- semantic retrieval sekarang ikut membawa sinyal approval atau review ke ranking dan support context

### Next Scope

- tambah aturan confidence yang lebih kaya dari sekadar heuristik awal
- rapikan tampilan diff compare agar perubahan antar versi lebih jelas
- evaluasi bobot booster feedback agar tidak menutupi similarity yang memang lebih relevan

### Child Phases

- `Phase 3.1 - Review UI`
  - daftar versi
  - compare versi
  - metadata editor review
- `Phase 3.2 - Approval Workflow`
  - status `reviewed`, `approved`, `rejected`
  - filter approved untuk learning loop berikutnya
- `Phase 3.3 - Confidence Enrichment`
  - tambah rule confidence
  - gabungkan sinyal human review dan semantic reuse
- `Phase 3.4 - Retrieval Feedback Loop`
  - gunakan feedback sebagai ranking booster
  - prioritaskan approved entry

### Todo List

- [x] buat panel histori versi pada halaman translate atau split view
- [x] buat fitur compare antara versi aktif dan versi sebelumnya
- [x] tambah status review `reviewed`, `approved`, dan `rejected`
- [x] gunakan feedback editor sebagai sinyal ranking untuk TM dan semantic retrieval
- [ ] review ulang rule confidence agar false positive low confidence berkurang
- [x] siapkan audit trail siapa atau flow mana yang menyimpan koreksi

### Gap To Close

- confidence masih berbasis heuristik awal, belum memakai sinyal approval atau semantic quality
- compare masih side-by-side sederhana, belum diff per perubahan
- bobot ranking feedback masih heuristik awal dan belum dituning dengan evaluasi kualitas retrieval

### Done When

- edit manual tersimpan sebagai histori
- koreksi editor bisa dipakai lagi pada request berikutnya
- hasil berisiko rendah atau tinggi bisa dibedakan

## Phase 4 - Semantic Retrieval

### Goal

Menambah kualitas retrieval contoh yang mirip secara makna dan gaya.

### Status

Mostly complete - semantic retrieval untuk `translation_memory` dan `source_units` sudah berjalan, workflow reindex dan observability semantic hit sudah tersedia, sedangkan batching embedding dan hardening biaya provider masih menjadi pekerjaan lanjutan.

### Work

- [x] pilih vector stack final
- [x] buat pipeline embedding untuk source text
- [x] index TM atau source units yang relevan
- [x] ambil top similar examples
- [x] masukkan hanya contoh relevan ke prompt

### Completed Scope

- vector stack awal sudah dipilih dengan pendekatan `MySQL + JSON vector + app-side cosine similarity`
- pipeline embedding untuk source text sudah tersedia
- semantic index untuk `translation_memory` sudah tersedia
- semantic index untuk `source_units` level `segment` sudah tersedia
- workflow manual `Reindex Semantic TM` sudah tersedia dari UI settings atau learning
- top similar examples sudah diambil dan difilter dengan threshold similarity
- semantic examples yang relevan sudah masuk ke prompt `translate-ai`
- observability semantic hit sudah tampil di UI beserta provider, model, rank, threshold, dan similarity score
- threshold semantic dan jumlah example sudah bisa dituning dari settings
- quality gate semantic sudah mengikuti approval formal atau fallback quality yang relevan
- semantic retrieval tetap menjadi pelengkap dan tidak menggantikan exact TM

### Next Scope

- optimalkan batching embedding agar indexing massal lebih efisien
- tambahkan guardrail biaya seperti batch size, rate limit, retry, dan fallback provider untuk job besar
- tambahkan ringkasan penggunaan provider embedding agar tuning biaya lebih mudah dipantau
- pertimbangkan observability job reindex yang lebih detail bila volume semantic asset makin besar

### Child Phases

- `Phase 4.1 - TM Semantic Operations`
  - workflow reindex semantic untuk `translation_memory`
  - filter kandidat berdasarkan quality atau approval
- `Phase 4.2 - Source Unit Semantic Retrieval`
  - index semantic untuk `source_units`
  - gabungkan context semantic dari source unit
- `Phase 4.3 - Semantic Observability`
  - tampilkan semantic hits di UI
  - tampilkan provider, model, dan similarity score
- `Phase 4.4 - Semantic Quality Tuning`
  - review threshold similarity
  - batching embedding dan optimasi biaya

### Function Scope

- `Phase 4.1 - TM Semantic Operations`
  - sediakan action manual `Reindex Semantic TM` dari UI settings atau learning
  - jalankan proses full reindex dan incremental reindex untuk `translation_memory`
  - skip entry kosong, duplikat, nonaktif, atau tidak lolos quality gate
  - simpan metadata semantic seperti provider, model, version, hash source, dan waktu embedding
  - catat hasil job seperti total scanned, indexed, skipped, failed, dan alasan skip
- `Phase 4.2 - Source Unit Semantic Retrieval`
  - buat pipeline embedding untuk `source_units` level `segment`
  - simpan index semantic tanpa mengganti retrieval context `prev/current/next` yang sudah ada
  - ambil top source unit yang mirip secara makna dari source aktif
  - gabungkan semantic hit source unit dengan context struktural agar prompt tetap stabil
  - jaga prioritas exact TM dan retrieval kontekstual agar semantic source unit hanya menjadi pelengkap
- `Phase 4.3 - Semantic Observability`
  - tampilkan daftar semantic hits yang benar-benar dipakai pada request translate
  - tampilkan tipe sumber hit seperti `translation_memory` atau `source_unit`
  - tampilkan provider, model, similarity score, rank, dan threshold yang lolos
  - tampilkan alasan hit dipilih atau dibuang bila terkena threshold atau dedup
  - sediakan ringkasan sederhana jumlah hit semantic yang masuk ke prompt
- `Phase 4.4 - Semantic Quality Tuning`
  - buat konfigurasi threshold similarity minimum dan jumlah maximum example per request
  - evaluasi hasil retrieval berdasarkan kualitas terjemahan, approval, dan reuse aktual
  - batching embedding untuk indexing massal agar biaya provider lebih efisien
  - pisahkan mode tuning antara `translation_memory` dan `source_units` bila karakter datanya berbeda
  - siapkan guardrail biaya seperti batch size, rate limit, retry, dan fallback provider bila perlu

### Delivery Notes

- mulai dari `translation_memory` karena dataset reuse-nya paling dekat dengan hasil terjemahan final
- lanjutkan ke `source_units` setelah identity segment dan sync OCR sudah stabil
- observability harus tampil di UI sebelum threshold dituning agresif agar perubahan retrieval bisa dijelaskan
- quality gate semantic sebaiknya mengikuti status review di Phase 3 dan learning workflow di Phase 5
- hindari memasukkan terlalu banyak semantic example ke prompt karena dapat menurunkan fokus konteks utama

### Todo List

- [x] buat workflow reindex semantic untuk seluruh `translation_memory`
- [x] tambahkan semantic index untuk `source_units`
- [x] tampilkan semantic hits, provider, model, dan similarity score di UI
- [x] tambah filter hanya untuk entry approved atau quality tinggi sebelum di-index
- [x] review threshold similarity dan jumlah example yang masuk prompt
- [ ] optimalkan batching embedding dan biaya panggilan provider

### Gap To Close

- belum ada batching embedding untuk indexing massal
- belum ada guardrail biaya yang matang seperti batch size, retry policy, dan rate control per provider
- belum ada ringkasan observability penggunaan provider embedding di level job atau sesi

### Important Notes

- jangan implement vector layer sebelum source unit dan feedback belum rapi
- semantic retrieval adalah pelengkap, bukan pengganti exact TM

### Done When

- teks yang mirip tetapi tidak identik mulai menghasilkan gaya yang lebih konsisten

## Phase 5 - Continuous Learning + Export Dataset

### Goal

Membuat sistem terus membaik tanpa retrain terus-menerus, dan siap ekspor dataset bila datanya sudah cukup.

### Status

Mostly complete - workflow learning, preview kandidat, approval-gated filtering, exporter dataset, dan quality report dasar sudah tersedia, sedangkan progress detail job skala besar dan format export tambahan masih menjadi pekerjaan lanjutan.

### Work

- [x] update `usage_count` pada TM
- [x] refresh semantic index untuk approved entries
- [x] tambahkan exporter JSONL
- [x] siapkan filter hanya untuk data berkualitas baik

### Completed Scope

- `usage_count` pada TM sudah di-update saat exact reuse atau penggunaan relevan terjadi
- workflow `Refresh Semantic Index` sudah tersedia di Settings
- preview kandidat learning sudah menampilkan statistik candidate, approved, confirmed, confidence bucket, coverage kitab, source label, dan duplicate examples
- semantic refresh sudah memakai filter kandidat `approved`, `confirmed`, atau fallback `high_quality_manual`
- approval-gated learning formal sudah tersedia lewat opsi `Require explicit approval only`
- entry `rejected` atau `unqualified` sudah diblok dari refresh semantic dan export dataset
- exporter dataset JSONL sudah tersedia di Settings
- exporter dataset mendukung variant `flat` dan `chat`
- filter kualitas untuk export dan refresh semantic sudah tersedia dengan `min_confidence`
- metadata dataset export sudah menyertakan kitab, confidence, approval status, source label, dan waktu export
- export dataset bisa menghasilkan manifest metadata terpisah untuk audit internal
- deduplication exact source-target pair sudah tersedia sebelum export dataset
- quality report dasar dan coverage report sudah tersedia lewat preview learning dan manifest export

### Next Scope

- tambah batching dan progress indicator untuk refresh semantic index skala besar
- tambah exporter format lain seperti CSV, split train-eval, atau variasi dataset yang lebih spesifik
- tambah deduplication rule yang lebih ketat untuk near-duplicate, bukan hanya exact pair
- tambah resumable process atau progress detail untuk job refresh semantic skala besar
- tambah kontrol kualitas berbasis reviewer, actor review, atau audit trail yang lebih kaya

### Child Phases

- `Phase 5.1 - Learning Operations`
  - refresh semantic index dari UI
  - monitoring kandidat yang lolos filter
- `Phase 5.2 - Dataset Export`
  - export JSONL
  - struktur metadata untuk dataset internal
- `Phase 5.3 - Approval-Gated Learning`
  - filter `approved` yang formal
  - sinkronisasi dengan workflow review Phase 3
- `Phase 5.4 - Dataset Quality Control`
  - deduplication dataset
  - statistik kualitas dan coverage

### Function Scope

- `Phase 5.1 - Learning Operations`
  - sediakan action manual untuk `Refresh Semantic Index` dan `Reindex Semantic TM` dari UI settings atau learning
  - tampilkan ringkasan hasil job seperti kandidat, indexed, skipped, failed, provider, model, dan alasan skip
  - tampilkan status filter aktif seperti `approvedOnly`, fallback quality, `min_confidence`, dan limit kandidat
  - siapkan progress sederhana untuk job skala besar agar user tahu proses masih berjalan
  - catat hasil refresh agar bisa dipakai untuk evaluasi learning cycle berikutnya
- `Phase 5.2 - Dataset Export`
  - sediakan exporter `JSONL` yang konsisten untuk dataset internal dan eksperimen fine-tuning
  - simpan metadata seperti kitab, file, confidence, approval status, source label, dan waktu export
  - pastikan filter kualitas export sama dengan filter learning agar aset semantic dan dataset tetap sinkron
  - siapkan titik ekstensi untuk format export lain seperti `CSV`, variant `JSONL`, atau split train-eval
  - pastikan hasil export mudah ditinjau ulang sebelum dipakai keluar sistem
- `Phase 5.3 - Approval-Gated Learning`
  - ubah status `approved` menjadi sinyal eksplisit dari workflow review, bukan hanya fallback kualitas
  - sinkronkan sinyal learning dengan approval, confirm, reject, dan actor review dari Phase 3
  - pisahkan entry yang lolos karena review formal dan entry yang lolos karena fallback `high_quality_manual`
  - cegah entry rejected atau unqualified masuk ke refresh semantic dan export dataset
  - sediakan jalur audit agar alasan sebuah entry dianggap layak belajar tetap terlihat
- `Phase 5.4 - Dataset Quality Control`
  - tambahkan deduplication rule untuk pasangan source-target, hash normalized text, dan near-duplicate yang terlalu mirip
  - tampilkan statistik learning asset seperti candidate, approved, confirmed, exported, duplicate, dan rejected
  - ukur coverage per kitab, file, atau sumber agar dataset tidak berat sebelah
  - siapkan quality report sederhana sebelum export untuk membantu review manual
  - jaga agar dataset export tetap bersih, terukur, dan bisa direproduksi

### Delivery Notes

- pertahankan workflow `Refresh Semantic Index` dan `Export Dataset JSONL` yang sudah ada sebagai baseline operasional
- tambahkan statistik dan progress lebih dulu sebelum memperbesar skala refresh atau export agar debugging lebih mudah
- approval formal harus mengikuti vocabulary review yang sama dengan Phase 3 supaya filter learning tidak ambigu
- deduplication dataset sebaiknya dilakukan sebelum menambah format export lain agar kualitas aset tetap stabil
- batching embedding dan kontrol biaya dari Phase 4 perlu dipakai ulang di Phase 5 saat refresh semantic skala besar

### Todo List

- [x] tambah approval workflow formal agar filter `approved` benar-benar eksplisit
- [x] tampilkan statistik candidate, approved, confirmed, dan exported rows di UI Learning
- [ ] tambah progress detail untuk refresh semantic index skala besar
- [x] tambah deduplication rule pada exporter JSONL
- [ ] tambah opsi export format lain bila dataset makin besar
- [x] sinkronkan filter learning dengan approval workflow dari Phase 3

### Gap To Close

- belum ada progress detail atau resumable process untuk refresh semantic skala besar
- exporter masih fokus ke JSONL, belum ada variasi format lain
- deduplication baru mencakup exact source-target pair, belum near-duplicate atau aturan coverage yang lebih ketat
- belum ada kontrol kualitas berbasis reviewer, actor review, atau audit trail yang lebih matang

### Done When

- approved translations menjadi aset yang terus bertambah
- dataset internal bisa diekspor dengan struktur bersih

## What AI Agent Must Pay Attention To

Bagian ini penting untuk agent yang nanti mengerjakan implementasi.

### Architecture Guardrails

- jangan hardcode provider tertentu dalam layer learning
- jangan merusak IPC existing tanpa alasan kuat
- utamakan helper reusable daripada logika tempel di banyak tempat
- bila perlu refactor, lakukan bertahap

### Database Guardrails

- semua migrasi harus idempotent
- jangan overwrite data lama tanpa versi
- tambahkan index untuk kolom retrieval penting
- pikirkan ukuran `MEDIUMTEXT` atau `LONGTEXT` dengan hati-hati

### Retrieval Guardrails

- bedakan exact TM, similar examples, glossary, dan context
- jangan campur semuanya jadi satu ranking yang tidak jelas
- prioritas exact TM harus lebih tinggi dari semantic example
- feedback editor harus dianggap sinyal lebih kuat daripada output AI mentah

### Prompt Guardrails

- jaga agar prompt tidak terlalu panjang
- jangan masukkan contoh yang tidak relevan
- section prompt harus deterministik agar mudah diuji
- hasil akhir tetap harus return translation only
- untuk strategi detail penghematan token, rujuk `translation-token-efficiency.md`

### Data Quality Guardrails

- normalisasi Arab wajib konsisten di semua modul
- source text kosong atau noise OCR harus bisa difilter
- context retrieval tidak boleh salah page atau salah segment
- feedback tanpa identity sumber yang jelas jangan dipromosikan menjadi memory berkualitas tinggi

## Recommended Implementation Order In Code

Urutan kerja yang paling aman di repo ini:

1. `electron/db.js`
2. helper normalisasi dan retrieval
3. `electron/main.js` prompt builder + translate integration
4. `electron/preload.js` bila perlu expose API baru
5. `src/renderer/pages/SplitViewPage.jsx` untuk feedback, confidence, atau workflow edit
6. modul import OCR ke DB untuk source units

## Expected Benefits

- terminologi lebih konsisten
- hasil translate tidak terlalu berubah untuk kalimat yang sama
- sistem belajar dari koreksi editor
- prompt lebih kaya tetapi tetap terkontrol
- kualitas meningkat bertahap tanpa harus fine-tuning sejak awal
- repo berkembang dengan jalur implementasi yang jelas dan aman
