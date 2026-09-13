# Vector Search & Document RAG

## Purpose

Dokumen ini adalah persiapan implementasi **document RAG** di repo `reader`.

Tujuan utamanya:

- menu **Search** bisa mencari makna, bukan hanya keyword `LIKE`
- **AI Chat** bisa menjawab dari corpus kitab, bukan hanya dari system prompt dan histori chat
- vector search menjadi fondasi retrieval, bukan pengganti data kitab yang sudah ada

Dokumen ini bukan desain ideal di luar repo. Implementasi harus bertahap di atas stack yang sudah berjalan: Electron + React + MySQL.

## Related Docs

- [Translation Memory & Semantic Learning Architecture](./improvement.md)
- [Translation Style Memory](./translation-style-memory.md)
- [Translation Token Efficiency Strategy](./translation-token-efficiency.md)

Gunakan dokumen-dokumen itu untuk retrieve **contoh terjemahan**. Gunakan dokumen ini untuk retrieve **isi kitab sebagai pengetahuan**.

## Progress Checklist

> **Untuk agent:** centang item dengan mengganti `[ ]` menjadi `[x]` setelah selesai diimplementasi dan diverifikasi di repo. Jangan centang hanya karena sudah didesain di dokumen. Update `Last verified` setiap kali mengubah checklist ini.

**Last verified:** 2026-09-10  
**Fase aktif:** Phase 2 (implementasi selesai; smoke parafrasa perlu MySQL jalan)  
**Safety:** dilarang `DELETE` / `DROP` / `TRUNCATE` / hapus row atau database yang sudah berisi. Phase 0 hanya SELECT. Phase berikutnya: `CREATE TABLE IF NOT EXISTS`, upsert by key, skip by hash — jangan wipe data lama.

### Ringkasan fase

| Fase | Status | Done when |
| --- | --- | --- |
| Foundation (reuse) | sebagian ada | embedding stack & Search keyword sudah jalan |
| Phase 0 — Corpus Identity | selesai | 1 kitab uji bisa di-trace chunk → halaman |
| Phase 1 — Schema + Indexer | selesai | kitab uji punya `rag_chunks` + vector |
| Phase 2 — Hybrid Search UI | selesai (kode) | parafrasa ketemu di menu Search |
| Phase 3 — AI Chat RAG | belum | chat jawab dengan sitasi kitab |
| Phase 4 — Quality + Cost | belum | reindex besar aman & terpantau |
| Phase 5 — Vector Store | ditunda | keputusan berdasarkan metrik nyata |

Legenda: `[x]` selesai · `[ ]` belum · `[-]` sengaja ditunda / out of scope fase ini

### Foundation — reuse dari repo (bukan RAG, tapi prasyarat)

- [x] Menu Search ada di sidebar (`SearchPage.jsx`)
- [x] IPC `search-global` + `searchGlobal()` keyword `LIKE`
- [x] Tabel `semantic_embeddings` + schema idempotent di `db.js`
- [x] Pipeline embedding OpenAI/Gemini (`embedTextWithProvider`)
- [x] Cosine similarity app-side (`computeCosineSimilarity`)
- [x] `source_units` + `splitArabicTextIntoSegments()`
- [x] Reindex semantic TM terpisah di Settings
- [x] Document RAG sudah menyentuh codebase (`rag_chunks`, `rag_chunk`, indexer; hybrid search masih Phase 2)

### Phase 0 — Corpus Identity

**Status:** `[x]` selesai (2026-09-04, SELECT-only di `reader_app`)  
**Done when:** 1 kitab uji bisa di-trace dari chunk ke file halaman.

- [x] Pilih 1 kitab uji (catat `id_kitab` / nama di bagian [Test Kitab](#test-kitab))
- [x] `source_units` terisi untuk kitab uji (segment level)
- [x] `kitab_terjemahan` punya `file_name` yang cukup buka Split View
- [x] Mapping `source_unit` ↔ `kitab_terjemahan` per halaman terdokumentasi
- [x] Verifikasi kontrak Search → Split View (SQL: `folder_path` + `file_name` terisi; smoke klik UI opsional)
- [x] Tidak mulai embedding corpus penuh sebelum checklist fase ini `[x]` semua

#### Mapping yang dipakai (kitab uji)

Kunci join: **`file_name`** (contoh `001.txt`).

| Dari | Ke | Catatan |
| --- | --- | --- |
| `source_units.file_name` | `kitab_terjemahan.file_name` | 1 halaman terjemahan ↔ N segment |
| `source_units.page_number` | nomor di nama file | contoh `001.txt` → page `1` |
| `master_kitab.folder_path` + `file_name` | Split View | sama dengan payload Search sekarang |

Temuan kitab `14` / tajul arus (baca 2026-09-04):

- `source_units`: 207 row, semua `unit_type=segment`, 0 missing `file_name` / `page_number`, 97 file unik, page 1–100
- `kitab_terjemahan`: 96 row, 0 missing `file_name`, 49 file unik
- semua 49 file terjemahan ada di `source_units` (shared 49)
- 110 segment punya pasangan terjemahan di file yang sama
- Search sample join mengembalikan `kitab_folder_path` + `file_name` siap buka Split View

### Phase 1 — Schema + Indexer RAG

**Status:** `[x]` selesai (2026-09-04)  
**Done when:** satu kitab uji punya chunk + vector; cosine manual konsisten.

**Schema & DB**

- [x] `ensureRagChunksSchema()` / tabel `rag_chunks` di `electron/db.js`
- [x] Query CRUD dasar: list, upsert, delete by kitab, get by id
- [x] `entity_type = 'rag_chunk'` di `semantic_embeddings` (tanpa mengubah TM/source_unit)
- [x] `metadata_json` chunk mengisi pointer Split View (`file_name`, `page_number`, `kitab_folder_path`)

**Indexer**

- [x] Modul `electron/rag/chunker.js` (atau `electron/rag.js` sementara)
- [x] Modul `electron/rag/indexer.js` — build chunk dari `source_units` + `kitab_terjemahan`
- [x] Incremental index by `text_hash` + `model_name` (skip jika tidak berubah)
- [x] IPC `rag-reindex-corpus` (atau nama setara)
- [x] Expose di `electron/preload.js`
- [x] Tombol **Reindex RAG Corpus** di Settings, terpisah dari Reindex Semantic TM
- [x] Job report: scanned / created / embedded / skipped / failed

**Verifikasi**

- [x] Index 1 kitab uji berhasil
- [x] Row `rag_chunks` + `semantic_embeddings` (`rag_chunk`) cocok jumlahnya
- [x] Cosine manual 1 query vs 1 chunk menghasilkan skor masuk akal

#### Hasil verifikasi kitab uji (2026-09-04)

| Metrik | Nilai |
| --- | --- |
| `id_kitab` | `14` (tajul arus) |
| Draft / active `rag_chunks` | `527` (dari 206 source_units + 96 terjemahan + bilingual pendek) |
| `semantic_embeddings` `rag_chunk` | `527` (model `text-embedding-3-small`) |
| Cosine self-query | `0.9583` (chunk_id=1, `001.txt`) |
| Metadata Split View | `file_name` + `page_number` + `kitab_folder_path` terisi |
| Safety | upsert only; soft-delete `inactive` pada mode full; tidak wipe corpus sumber |

Skript verifikasi: `node electron/rag/_verify-phase1.mjs 14`
### Phase 2 — Hybrid Search UI

**Status:** `[x]` selesai kode (2026-09-10); live smoke parafrasa menunggu MySQL  
**Done when:** query parafrasa menemukan halaman yang tidak ketemu keyword-only.

**Backend retrieval**

- [x] Modul `electron/rag/retrieve.js` — hybrid keyword + vector
- [x] Prefilter MySQL (`id_kitab`, `model_name`, `status`) sebelum cosine
- [x] Perluas `search-global` dengan `mode: 'keyword' | 'semantic' | 'hybrid'` (default `hybrid`)
- [x] Response item punya `match_type`, `similarity_score`, `chunk_id` bila semantic
- [x] Ranking gabungan (vector + keyword + boost kitab)
- [x] Threshold Search terpisah dari TM semantic (settings `ragSearch`)

**Frontend**

- [x] `SearchPage.jsx` kirim mode hybrid (atau toggle keyword / semantic / hybrid)
- [x] Badge hasil: `keyword` / `semantic` / `hybrid`
- [x] Tampilkan similarity score untuk hit semantic
- [x] Filter optional per kitab
- [x] Klik hasil tetap buka Split View (`origin: 'search'`)
- [ ] Hasil keyword lama tidak regresi (uji skenario 1 di [Test Kitab](#test-kitab) — butuh MySQL)

#### Hasil implementasi (2026-09-10)

| Item | Nilai |
| --- | --- |
| Retrieve | `electron/rag/retrieve.js` → `hybridSearch()` |
| DB helpers | `searchRagChunksByKeyword`, `listRagChunkEmbeddingCandidates`; `searchGlobal` + `idKitab` |
| Settings | `ragSearch.searchSimilarityThreshold` default `0.55` (Chat `0.70` siap Phase 3) |
| IPC | `search-global` terima string (legacy→hybrid) atau `{ keyword, mode, idKitab }` |
| UI | mode toggle + filter kitab + badge + skor cosine |
| Skript | `node electron/rag/_verify-phase2.mjs 14 "keutamaan bershalawat kepada nabi"` |
| Blokir verifikasi | service `mysql` Stopped / ECONNREFUSED saat agent run |
### Phase 3 — AI Chat RAG

**Status:** `[ ]` belum selesai  
**Done when:** pertanyaan isi kitab uji dijawab dengan cuplikan + sitasi yang bisa dibuka.

**Backend**

- [ ] Retrieve top-k chunk sebelum LLM di `ai-chat-send`
- [ ] Modul `electron/rag/prompt.js` — blok konteks terpisah dari TM semantic
- [ ] Threshold Chat lebih ketat dari Search
- [ ] Fallback eksplisit bila retrieval kosong (jangan mengarang)
- [ ] Optional `id_kitab` scope di thread atau payload chat

**Frontend**

- [ ] UI scope: semua kitab / satu kitab
- [ ] Tampilkan sitasi: nama kitab, file, halaman
- [ ] Link sitasi buka Split View atau kitab detail
- [ ] System prompt `ai_chat` selaras dengan aturan "jawab dari konteks saja"

**Verifikasi**

- [ ] Pertanyaan dalam corpus → jawaban + sitasi benar
- [ ] Pertanyaan di luar corpus → menolak / "tidak ditemukan"
- [ ] `translate-ai` tidak terpengaruh (semantic TM tetap sendiri)

### Phase 4 — Quality + Cost

**Status:** `[ ]` belum selesai  
**Done when:** reindex 1 kitab besar bisa dipantau, dihentikan, tanpa merusak index lama.

- [ ] Batch embedding (bukan 1 request per chunk tanpa batas)
- [ ] Rate limit + retry dengan backoff
- [ ] Progress indicator job reindex di UI
- [ ] Cancel / stop job aman (tidak corrupt index setengah jalan)
- [ ] `quality_score` pada chunk (noise OCR, panjang minimum)
- [ ] Quality gate: skip terjemahan `rejected` / `unqualified`
- [ ] Auto-index setelah save translation (opsional, bisa flag settings)
- [ ] Auto-index setelah source unit tersimpan (opsional)
- [ ] Ringkasan biaya / jumlah token embedding per job (jika feasible)

### Phase 5 — Vector Store Decision

**Status:** `[-]` ditunda sampai Phase 2–3 dipakai nyata

- [ ] Ukur latency Search hybrid (catat p50/p95)
- [ ] Ukur memory Node saat load `vector_json` skala nyata
- [ ] Dokumentasikan jumlah chunk aktif vs waktu query
- [ ] Bandingkan opsi: tetap MySQL vs Qdrant vs `pgvector`
- [ ] Keputusan migrasi hanya jika metrik membuktikan perlu
- [ ] [-] Migrasi vector store (hanya jika keputusan di atas ya)

### Agent handoff notes

Saat menyerahkan pekerjaan ke agent berikutnya, isi singkat di sini:

```text
Fase terakhir dikerjakan: Phase 2 (kode 2026-09-10; live DB verify tertunda — mysql Stopped)
Kitab uji: id=14, tajul arus — index Phase 1: 527 rag_chunks + embeddings
File utama disentuh: electron/rag/retrieve.js, electron/rag/_verify-phase2.mjs, electron/db.js, electron/main.js, electron/preload.js, src/renderer/pages/SearchPage.jsx, src/renderer/pages/SettingsPage.jsx, docs/vector-search-rag.md
Blokir / risiko: start MySQL lalu jalankan _verify-phase2.mjs; bilingual chunk boleh double-count di merge per file; default search-global string sekarang hybrid
Langkah berikutnya: (1) smoke Phase 2 dengan MySQL + parafrasa di Search UI (2) Phase 3 — AI Chat RAG
```

## Important Distinction

Semantic retrieval yang sudah ada **bukan document RAG**.

| Layer | Sudah ada | Untuk apa | Bukan untuk |
| --- | --- | --- | --- |
| Exact TM + similar TM | Ya | Konsistensi istilah dan reuse terjemahan | Cari pasal / jawaban di kitab |
| Semantic TM + source unit | Ya | Contoh gaya yang mirip untuk `translate-ai` | Q&A atau global search makna |
| Global Search | Ya, keyword `LIKE` | Cari teks persis / hampir persis | Pertanyaan semantik |
| AI Chat | Ya, chat biasa | Percakapan tanpa corpus | Jawab dari kitab dengan sitasi |

Jangan mencampur dua retrieval ini.

- retrieve TM untuk translate
- retrieve chunk kitab untuk Search dan RAG chat
- keduanya boleh memakai embedding yang sama, tetapi index, threshold, ranking, dan UI-nya terpisah

## Current Baseline In Repo

### Yang sudah bisa dipakai ulang

- menu Search di `src/renderer/Sidebar.jsx` -> `SearchPage.jsx`
- IPC `search-global` di `electron/main.js`
- query keyword di `searchGlobal()` pada `electron/db.js`
- tabel `semantic_embeddings`
- pipeline embedding OpenAI / Gemini lewat capability `embed`
- fungsi `embedTextWithProvider()` dan `computeCosineSimilarity()`
- `source_units` sudah tersegmentasi, termasuk splitter Arab di `splitArabicTextIntoSegments()`
- `kitab_terjemahan` menyimpan pasangan original + translate
- reindex semantic TM sudah ada di Settings

### Keterbatasan yang harus ditutup dulu

- Search hanya `LOWER(field) LIKE ?` pada `kitab_terjemahan` dan `master_kitab`
- cosine similarity dihitung di aplikasi, setelah load `vector_json` dari MySQL
- `semantic_embeddings.entity_type` baru dipakai untuk `translation_memory` dan `source_unit`
- `source_unit` semantic hanya di-index pada konteks translate, bukan corpus penuh
- AI Chat tidak pernah mengambil dokumen kitab
- belum ada chunk document khusus RAG, citation, hybrid rank, atau job index corpus

Artinya: fondasi embedding + corpus RAG Phase 1 sudah ada; Search hybrid Phase 2 sudah di kode (verifikasi live butuh MySQL).

## Target

```text
User Query  (Search atau AI Chat)
    ->
Query Understanding
    -> normalize Arab, deteksi bahasa, optional rewrite
    ->
Hybrid Retrieval
    1. Keyword / LIKE / FULLTEXT
    2. Vector search pada chunk kitab
    3. Optional exact TM / glossary hanya sebagai sinyal ranking
    ->
Rerank + Filter
    -> kitab, halaman, bahasa, threshold
    ->
Consumers
    A. Search UI: daftar hit + snippet + buka Split View
    B. RAG Chat: top chunks masuk prompt + sitasi
```

Hasil yang diharapkan:

1. Query "keutamaan shalawat" bisa menemukan halaman yang tidak mengandung kata persis itu.
2. Query Arab dan Indonesia bisa saling menemukan pasangan terjemahan.
3. Hasil Search bisa dibuka ke halaman kitab yang sama seperti sekarang.
4. AI Chat bisa menjawab dengan cuplikan sumber, nama kitab, dan file/halaman.

## Core Principles

### 1. Corpus first, vector second

Jangan index sebelum identitas dokumen rapi.

Setiap chunk wajib punya:

- `id_kitab`
- `file_name` / `page_number` bila ada
- `lang` (`ar` / `id` / `mixed`)
- `source_kind` (`original` / `translation` / `bilingual`)
- `text` dan `text_normalized`
- pointer untuk buka Split View

### 2. Hybrid always

Vector tidak menggantikan keyword.

Urutan ranking yang disarankan:

1. exact / near-exact keyword
2. vector similarity
3. kitab yang sedang dibaca atau dipilih user
4. halaman terdekat dari konteks aktif
5. kualitas teks (punya terjemahan, bukan OCR rusak)

### 3. Reuse embedding stack, isolate retrieval stack

Boleh reuse:

- provider `embed`
- tabel `semantic_embeddings`
- hash teks, model name, vector dim, vector norm

Jangan reuse:

- threshold TM
- ranking feedback approval TM
- prompt block "contoh semantic retrieval"
- job `Reindex Semantic TM` sebagai satu-satunya indexer RAG

### 4. Citation is mandatory for RAG chat

Jawaban AI tanpa pointer kitab/halaman dianggap gagal, meskipun teksnya bagus.

### 5. MySQL first, dedicated vector DB later

Phase awal tetap MySQL JSON vector + candidate prefilter.

Pindah ke `pgvector` / Qdrant / Chroma hanya jika:

- corpus chunk sudah stabil
- app-side cosine sudah terasa lambat
- perlu filter metadata di sisi index, bukan setelah load ke memory

## Corpus Model

Unit pengetahuan RAG adalah **chunk**, bukan 1 file halaman utuh dan bukan 1 TM row.

### Source of truth

Prioritas sumber chunk:

1. `source_units` level `segment` untuk teks Arab
2. `kitab_terjemahan` untuk teks Indonesia + pasangan bilingual
3. fallback file `.txt` OCR hanya jika unit belum masuk database

Jangan membuat corpus ketiga dari file folder kalau data yang sama sudah ada di `source_units`.

### Entity types baru

Tambah `entity_type` di `semantic_embeddings`, jangan menimpa yang lama:

- `rag_chunk` — chunk siap retrieve untuk Search dan Chat
- opsional nanti: `rag_kitab_summary`, `rag_glossary_note`

Entity lama tetap:

- `translation_memory`
- `source_unit`

### Chunk identity

Satu chunk mewakili satu sisi bahasa, atau satu pasangan bilingual yang kecil.

Contoh yang valid:

- Arab segment dari halaman 12
- terjemahan Indonesia dari halaman yang sama
- pasangan `text_original` + `text_translate` bila keduanya pendek

Contoh yang tidak valid:

- seluruh kitab
- gabungan 20 halaman
- TM example tanpa pointer halaman

## Chunking

Pakai splitter yang sudah ada sebagai baseline:

- `minChars = 180`
- `maxChars = 900`
- pecah per paragraf / tanda baca Arab
- merge potongan terlalu pendek

Aturan tambahan untuk RAG:

- 1 halaman boleh jadi beberapa chunk
- chunk tidak boleh merusak `source_units` yang dipakai translate
- simpan `chunk_index` berurutan di dalam halaman
- simpan overlap pendek 1 kalimat bila chunk dipotong di tengah pembahasan
- skip chunk kosong, hanya harakat, atau noise OCR terlalu pendek

Normalisasi:

- Arab: pakai `normalizeArabicText()` yang sudah ada
- Indonesia: lowercase, rapikan whitespace, jangan stem agresif di phase awal

## Index Design

### Phase awal: perluas `semantic_embeddings`

Cukup untuk prototype.

Field yang sudah ada dan wajib diisi:

- `entity_type = 'rag_chunk'`
- `entity_id` = id chunk
- `id_kitab`
- `source_lang` / `target_lang`
- `model_name`
- `text_hash`
- `vector_json`
- `vector_dim`
- `vector_norm`
- `metadata_json`

Isi `metadata_json` minimal:

```json
{
  "file_name": "page-012.txt",
  "page_number": 12,
  "chunk_index": 2,
  "source_kind": "original",
  "unit_type": "segment",
  "kitab_folder_path": "E:/kitab/...",
  "preview": "..."
}
```

### Tabel chunk terpisah, disarankan sejak Phase 1

Jangan memaksa seluruh payload RAG masuk `metadata_json`.

Usulan tabel:

```sql
CREATE TABLE IF NOT EXISTS rag_chunks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  id_kitab INT NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  lang VARCHAR(16) NOT NULL,
  source_unit_id BIGINT NULL,
  translation_id BIGINT NULL,
  file_name VARCHAR(1024) NULL,
  page_number INT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  text MEDIUMTEXT NOT NULL,
  text_normalized MEDIUMTEXT NOT NULL,
  token_count INT NOT NULL DEFAULT 0,
  quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_rag_chunk_identity (id_kitab, source_kind, lang, file_name, page_number, chunk_index),
  INDEX idx_rag_chunks_kitab_page (id_kitab, page_number, chunk_index),
  CONSTRAINT fk_rag_chunks_kitab
    FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Embedding tetap di `semantic_embeddings` dengan `entity_type = 'rag_chunk'`.

### Kapan pindah vector store

Tetap MySQL selama:

- jumlah chunk aktif masih ratusan sampai beberapa ribu
- Search masih bisa prefilter by `id_kitab` / keyword dulu

Siapkan migrasi jika:

- cosine di Node sudah load ratusan MB `vector_json`
- latency Search > 1–2 detik pada query biasa
- perlu ANN search lintas semua kitab sekaligus

Kandidat nanti: Qdrant atau `pgvector`. Jangan pilih sekarang.

## Retrieval Pipeline

### Query path

1. Terima keyword dari Search atau pertanyaan dari Chat.
2. Normalize query Arab dan Latin.
3. Embed query dengan model yang sama dengan index.
4. Ambil kandidat:
   - keyword hits dari `rag_chunks` / `kitab_terjemahan`
   - vector hits dari `semantic_embeddings` yang `entity_type = 'rag_chunk'`
5. Merge by `chunk_id`.
6. Rerank.
7. Potong `top_k`.

### Prefilter wajib di MySQL

Jangan load seluruh vector kitab.

Filter awal:

- `id_kitab` bila user sedang di satu kitab
- `model_name` harus sama dengan query embedding
- `status = 'active'`
- optional `lang`
- optional keyword token sebagai candidate gate

Baru kemudian cosine di aplikasi untuk kandidat terbatas, misalnya 200–500 row.

### Ranking score awal

```text
score =
  (0.60 * vector_similarity) +
  (0.25 * keyword_score) +
  (0.10 * same_kitab_boost) +
  (0.05 * has_translation_boost)
```

Threshold awal:

- Search: longgar, misalnya `0.55`, karena user ingin browsing
- RAG Chat: lebih ketat, misalnya `0.70`, karena masuk prompt

Angka ini boleh berubah. Yang tidak boleh berubah: Search dan Chat punya threshold terpisah dari TM semantic.

### Hybrid dengan Search lama

Jangan langsung mematikan `searchGlobal()`.

Phase 1 Search:

- tetap tampilkan hasil keyword
- sisipkan hasil vector sebagai grup `Semantic` atau badge `makna`

Phase 2 Search:

- satu daftar ter-merge
- keyword dan vector sudah di-rank bersama

## Consumers

### 1. Menu Search

File terkait:

- `src/renderer/pages/SearchPage.jsx`
- `electron/preload.js` -> `searchGlobal`
- `electron/db.js` -> `searchGlobal()`

Perilaku baru:

- input tetap satu kotak, termasuk voice STT yang sudah ada
- hasil punya `match_type`: `keyword` | `semantic` | `hybrid`
- snippet highlight tetap untuk keyword
- untuk semantic, tampilkan similarity dan alasan singkat, misalnya "mirip secara makna"
- klik hasil tetap buka Split View lewat `folder`, `file`, `origin: 'search'`

IPC baru yang disarankan:

- `search-rag` atau perluas `search-global` dengan `{ mode: 'keyword' | 'semantic' | 'hybrid' }`

Pilih perluas `search-global` agar UI lama tidak pecah.

### 2. AI Chat RAG

File terkait:

- `src/renderer/pages/AIChatPage.jsx`
- handler `ai-chat-send`

Perilaku baru:

- thread boleh punya `id_kitab` optional
- sebelum panggil LLM, retrieve top 4–8 chunk
- masukkan ke prompt sebagai konteks bersumber, bukan sebagai contoh terjemahan
- response UI menampilkan sitasi: nama kitab, file, halaman
- jika retrieval kosong, chat harus bilang sumber tidak ditemukan, bukan mengarang dari model saja

Prompt block RAG harus terpisah dari semantic TM:

```text
Konteks kitab yang relevan:
[1] {nama_kitab} / {file_name} p.{page}
{chunk_text}

Jawablah hanya dari konteks di atas. Jika tidak cukup, katakan tidak ditemukan.
```

### 3. Bukan consumer Phase 1

- `translate-ai` tetap memakai semantic TM yang lama
- Split View tidak perlu jadi search engine
- OCR page tidak menulis embedding langsung; index berjalan setelah teks masuk DB

## Suggested Files

Jangan campur semua logic RAG ke `translate-ai`.

Usulan pemisahan:

- `electron/rag/chunker.js` — pecah teks jadi chunk
- `electron/rag/indexer.js` — embed + upsert
- `electron/rag/retrieve.js` — hybrid search
- `electron/rag/prompt.js` — susun konteks chat
- `electron/db.js` — schema dan query saja
- `src/renderer/pages/SearchPage.jsx` — UI hasil hybrid
- Settings: panel `Reindex RAG Corpus`, terpisah dari `Reindex Semantic TM`

Jika file folder `electron/rag/` terlalu besar untuk awal, boleh mulai di `electron/rag.js` satu file, lalu pecah.

## Indexing Workflow

### Kapan index

- setelah save translation
- setelah source unit segment tersimpan
- lewat job manual `Reindex RAG Corpus` di Settings
- incremental by `text_hash`; jangan embed ulang bila hash dan model sama

### Quality gate

Jangan index:

- teks kosong
- chunk terlalu pendek
- entry TM `rejected` / `unqualified` bila sumbernya terjemahan
- OCR yang masih ditandai gagal, bila status itu sudah ada

Boleh index:

- original Arab dari `source_units`
- terjemahan yang sudah tersimpan
- pasangan bilingual pendek untuk retrieval silang bahasa

### Observability job

Catat per job:

- kitab scanned
- chunk created
- embedded
- skipped
- failed
- model name
- durasi
- perkiraan biaya bila mudah dihitung

Tanpa ini, index massal akan sulit dikontrol.

## Phase Plan

Detail checklist per fase ada di [Progress Checklist](#progress-checklist). Bagian ini merangkum goal dan urutan kerja saja.

### Phase 0 - Corpus Identity

Goal: setiap teks yang akan di-RAG bisa ditunjuk ulang ke kitab dan halaman.

Done when: 1 kitab uji bisa di-trace dari chunk ke file halaman.

### Phase 1 - Schema + Indexer RAG

Goal: ada chunk dan embedding khusus dokumen.

Done when: satu kitab uji punya chunk + vector, bisa dihitung cosine manual.

### Phase 2 - Hybrid Search UI

Goal: menu Search memakai vector tanpa membuang keyword.

Done when: query parafrasa menemukan halaman yang tidak ketemu di keyword-only.

### Phase 3 - AI Chat RAG

Goal: chat menjawab dari chunk kitab.

Done when: pertanyaan tentang isi kitab uji dijawab dengan cuplikan yang bisa dibuka.

### Phase 4 - Quality + Cost

Goal: index massal aman.

Done when: reindex 1 kitab besar bisa dipantau dan dihentikan tanpa merusak index lama.

### Phase 5 - Vector Store Decision

Goal: putuskan apakah MySQL masih cukup.

Hanya dikerjakan jika Phase 2–3 sudah dipakai nyata.

## Out Of Scope

Jangan dikerjakan di dokumen ini:

- mengganti semantic TM translate menjadi RAG
- full-text search Elasticsearch
- agent browsing folder PDF mentah tanpa OCR/DB
- multi-user cloud RAG
- fine-tune embedding model sendiri
- chat yang boleh mengarang tanpa sumber

## Test Kitab

Diisi Phase 0 (2026-09-04):

| Field | Nilai |
| --- | --- |
| `id_kitab` | `14` |
| Nama kitab | `tajul arus` |
| Folder path | `E:\BOOK\scanned_tajul_arus\8-50text` |
| Jumlah `source_units` | `207` (semua segment; 97 file unik) |
| Jumlah `kitab_terjemahan` | `96` (49 file unik; semua punya `file_name`) |
| Shared files su↔tr | `49` |
| Siap untuk index RAG | `[x]` ya (Phase 0) |
| `rag_chunks` aktif | `527` (Phase 1) |
| Embeddings `rag_chunk` | `527` / `text-embedding-3-small` (Phase 1) |

Kandidat cadangan (juga punya segment + terjemahan): `20` Al Ibriz, `17` Syarah al-Kharidah, `21` afdhol sholawat.

Pilih 1 kitab yang:

- sudah ada OCR
- sudah ada beberapa terjemahan
- `source_units` segment-nya terisi
- page/file mapping-nya benar

Skenario uji minimum:

- [ ] 1. Keyword persis: tetap ketemu, tidak lebih buruk dari Search sekarang (skript `_verify-phase2.mjs`; butuh MySQL)
- [x] 5a. Kontrak data Search → Split View: `folder_path` + `file_name` terisi (SQL, Phase 0)
- [ ] 2. Parafrasa Indonesia: ketemu halaman Arab/terjemahan terkait (hybrid Search; butuh MySQL)
- [ ] 3. Query Arab beda harakat: tetap ketemu karena normalisasi
- [ ] 4. Query di luar kitab (Chat): menolak mengarang
- [ ] 5. Klik hasil Search: buka halaman yang benar di Split View (smoke UI manual)

## Risks

- Mencampur TM vector dan RAG vector membuat Search penuh contoh terjemahan, bukan isi halaman.
- Embed seluruh halaman utuh membuat similarity kabur.
- App-side cosine tanpa prefilter akan lambat.
- Model embedding berbeda antara index dan query membuat hasil acak.
- Chat tanpa sitasi akan terasa pintar tetapi tidak bisa diverifikasi.

Mitigasi:

- `entity_type` terpisah
- chunk kecil
- filter `model_name` + `id_kitab`
- citation wajib
- Search hybrid, bukan vector-only

## Decision Log

Keputusan yang sudah diambil di dokumen ini:

1. Document RAG adalah track baru, bukan lanjutan UI semantic TM.
2. Menu Search adalah consumer pertama.
3. AI Chat adalah consumer kedua.
4. Stack awal tetap MySQL + JSON vector + cosine di aplikasi.
5. Chunk disimpan di `rag_chunks`, embedding di `semantic_embeddings`.
6. Keyword Search lama tidak dihapus.

Keputusan yang ditunda:

- vector database eksternal
- bilingual embedding khusus vs dual index `ar` + `id`
- reranker LLM
- summary per kitab sebagai parent document

## Done When

Persiapan ini dianggap siap diimplementasikan bila tim setuju bahwa:

- Search hybrid adalah langkah pertama yang terlihat user
- translate semantic tetap jalan sendiri
- schema `rag_chunks` + `entity_type = 'rag_chunk'` adalah kontrak awal
- Chat RAG tidak dikerjakan sebelum Search hybrid membuktikan retrieval-nya benar
