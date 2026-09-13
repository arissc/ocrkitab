# Grok Bot: Direct Translate dari OCR di Database

## Purpose

Playbook ini supaya **Grok bot** bisa menerjemahkan kitab **langsung dari teks OCR yang sudah ada di MySQL**, tanpa:

- buka gambar scan
- jalankan OCR ulang
- baca file `.txt` di folder (kecuali sebagai fallback identitas halaman)

Sumber teks: tabel `source_units`.  
Tujuan simpan: tabel `kitab_terjemahan` (plus TM bila ada).

Gaya terjemahan harus sama dengan dispatcher `translate-ai` di `electron/main.js`: Arab klasik (turath) → Indonesia gaya kitab pesantren.

## Related Docs

- [Translation Memory & Semantic Learning Architecture](./improvement.md)
- [Translation Style Memory](./translation-style-memory.md)
- [Translation Token Efficiency Strategy](./translation-token-efficiency.md)
- [Vector Search & Document RAG](./vector-search-rag.md)
- [OCR Box Notes](./OCR_BOX_NOTES.md)

## Kapan Pakai Playbook Ini

Pakai bila user bilang kira-kira:

- translate dari OCR di DB
- jangan OCR lagi
- kerjakan halaman yang belum ada terjemahan
- kerjakan kitab X / `id_kitab` Y / file `001.txt`

Jangan pakai playbook ini untuk:

- re-OCR gambar
- chat tanya isi kitab (itu track RAG)
- hapus / wipe data lama

---

## Copy-Paste: System Prompt Grok Bot

Simpan teks di bawah sebagai system prompt agent (`agent_system_prompts`) atau custom instruction Grok.

```text
You are a translator bot for classical Arabic Islamic manuscripts (turath) in the reader app.

Your only job: translate OCR Arabic text that already exists in MySQL into Indonesian pesantren kitab style, then save the result.

Source of truth for Arabic: table source_units (column source_text).
Destination for Indonesian: table kitab_terjemahan (text_original + text_translate + file_name).
Database: reader_app on localhost. Character set utf8mb4.

Hard rules:
- Do not re-run OCR. Do not open page images unless the user explicitly asks to inspect a scan.
- Do not DELETE, DROP, TRUNCATE, or wipe existing rows.
- Translate only. Do not summarize, omit, add tafsir, or add commentary.
- Return Indonesian translation text only when producing the translation itself.
- Keep scholarly titles as titles (Habib, Imam, Sayyid, Syekh, al-‘Allāmah, Qadhi), not literal meanings.
- Translate honorific prayers into Indonesian meaning (رضي الله عنه → semoga Allah meridhainya), do not transliterate them.
- If Arabic is symbolic / sufi / metaphorical, keep the symbolism. Do not rationalize it.
- Indonesian should be natural but close to the Arabic wording. Avoid modern academic or Western philosophical terms.
- Preserve --- OUTSIDE BOX --- blocks: translate the notes, keep the markers.

Work unit: one OCR page (file_name, e.g. 001.txt), not one segment, unless the user asks for a single segment.

Identity contract:
- Always set kitab_terjemahan.file_name to the source_units.file_name.
- Prefer unit_type='page' source_text as text_original (exact OCR page).
- If only segments exist, concatenate source_text ordered by segment_order with blank lines between them, and still set file_name.
- Skip pages that already have a non-empty kitab_terjemahan row for the same id_kitab + file_name, unless the user asks to overwrite.
- Never overwrite a row that looks human-reviewed (manual_edit / approved / reviewed) unless the user explicitly asks.

Before translating a batch:
1. SELECT the kitab.
2. Count pending pages (OCR ada, terjemahan kosong).
3. Show the count and wait if the batch is large, unless the user already named the pages.

After each saved page, report: id_kitab, file_name, page_number, action (insert/skip), short status.
```

---

## Stack & Identitas Data

Aplikasi: Electron + React + MySQL (`reader_app`).

| Konsep | Tabel / kolom | Arti |
| --- | --- | --- |
| Kitab | `master_kitab.id`, `nama_kitab`, `folder_path` | Identitas kitab |
| OCR | `source_units.source_text` | Teks Arab hasil OCR yang sudah di-ingest |
| Halaman | `source_units.file_name`, `page_number` | `001.txt` → halaman 1 |
| Segmen | `source_units.unit_type='segment'`, `segment_order` | Potongan halaman untuk TM/RAG |
| Halaman utuh | `source_units.unit_type='page'` | Isi file OCR utuh, paling cocok untuk Split View |
| Terjemahan | `kitab_terjemahan.text_original`, `text_translate`, `file_name` | Pasangan Arab–Indonesia |
| Istilah | `translation_glossary` | Glossary match-only |
| Contoh lama | `translation_memory` | Reuse / few-shot |

Kunci join halaman: **`file_name`**.

```text
source_units.file_name  ↔  kitab_terjemahan.file_name
contoh: 001.txt
```

Split View saat ini membuka file `.txt` lalu lookup terjemahan lewat `getTranslation()` dengan **exact match `text_original`**. Karena itu:

1. Jika ada `unit_type='page'`, pakai itu sebagai `text_original` — ini sama dengan isi file OCR.
2. Jika hanya ada segment, rekonstruksi halaman dari segment tetap **wajib isi `file_name`** agar Search bisa buka halaman. Exact match Split View mungkin gagal sampai lookup-by-`file_name` ditambah di app.

Jangan buat corpus ketiga dari folder gambar kalau `source_units` sudah terisi.

---

## Safety

Dilarang:

- `DELETE` / `DROP` / `TRUNCATE`
- hapus row terjemahan lama
- overwrite hasil `manual_edit`, `approved`, `reviewed`, `manual_ai_review`

Boleh:

- `SELECT`
- `INSERT` halaman yang belum ada terjemahan
- `UPDATE` hanya jika user eksplisit minta overwrite AI lama yang belum direview

`source_label` yang dipakai bot: `ai_grok`.

---

## Alur Kerja Bot

```text
User request (kitab / halaman)
    ->
SELECT master_kitab
    ->
SELECT OCR pages from source_units
    ->
LEFT JOIN kitab_terjemahan by id_kitab + file_name
    ->
Skip halaman yang sudah ada terjemahan
    ->
Untuk tiap halaman pending:
    1. Ambil teks OCR (page utuh, atau gabungan segment)
    2. Ambil glossary + TM + 1 halaman sebelum/sesudah
    3. Terjemahkan Arab -> Indonesia (gaya pesantren)
    4. INSERT kitab_terjemahan
    5. Optional: upsert translation_memory provider=ai_grok
    ->
Laporan ringkas
```

### Unit kerja default = 1 halaman

Jangan translate per-segment ke `kitab_terjemahan` kecuali user minta.

Alasan: Split View, Search, dan `file_name` semua beroperasi per halaman OCR (`001.txt`).

Segment hanya dipakai sebagai:

- sumber rekonstruksi jika `unit_type='page'` tidak ada
- konteks prev/next
- TM semantic

---

## SQL Operasional

Ganti `:id_kitab` / `:file_name` sesuai request.

### 1. Cari kitab

```sql
SELECT id, nama_kitab, pengarang, folder_path
FROM master_kitab
WHERE id = :id_kitab
   OR nama_kitab LIKE CONCAT('%', :nama, '%')
ORDER BY id;
```

### 2. Cek stok OCR vs terjemahan

```sql
SELECT
  mk.id AS id_kitab,
  mk.nama_kitab,
  COUNT(DISTINCT su.file_name) AS ocr_pages,
  COUNT(DISTINCT kt.file_name) AS translated_pages
FROM master_kitab mk
LEFT JOIN source_units su
  ON su.id_kitab = mk.id
 AND su.file_name IS NOT NULL
 AND su.file_name <> ''
LEFT JOIN kitab_terjemahan kt
  ON kt.id_kitab = mk.id
 AND kt.file_name = su.file_name
 AND kt.text_translate IS NOT NULL
 AND TRIM(kt.text_translate) <> ''
WHERE mk.id = :id_kitab
GROUP BY mk.id, mk.nama_kitab;
```

### 3. Daftar halaman yang belum diterjemahkan

```sql
SELECT
  su.id_kitab,
  su.file_name,
  su.page_number,
  su.folder_path,
  COUNT(*) AS segment_count,
  SUM(CHAR_LENGTH(su.source_text)) AS chars_ocr
FROM source_units su
LEFT JOIN kitab_terjemahan kt
  ON kt.id_kitab = su.id_kitab
 AND kt.file_name = su.file_name
 AND TRIM(COALESCE(kt.text_translate, '')) <> ''
WHERE su.id_kitab = :id_kitab
  AND su.file_name IS NOT NULL
  AND su.file_name <> ''
  AND kt.id IS NULL
GROUP BY su.id_kitab, su.file_name, su.page_number, su.folder_path
ORDER BY su.page_number ASC, su.file_name ASC;
```

### 4. Ambil teks OCR 1 halaman (utamakan page utuh)

```sql
SELECT id, unit_type, file_name, page_number, source_text
FROM source_units
WHERE id_kitab = :id_kitab
  AND file_name = :file_name
  AND unit_type = 'page'
LIMIT 1;
```

Jika kosong, rekonstruksi dari segment:

```sql
SELECT
  file_name,
  page_number,
  GROUP_CONCAT(source_text ORDER BY segment_order SEPARATOR '\n\n') AS source_text
FROM source_units
WHERE id_kitab = :id_kitab
  AND file_name = :file_name
  AND unit_type = 'segment'
GROUP BY file_name, page_number;
```

### 5. Konteks halaman sebelum / sesudah

```sql
SELECT file_name, page_number, unit_type, segment_order, source_text
FROM source_units
WHERE id_kitab = :id_kitab
  AND page_number IN (:page - 1, :page, :page + 1)
ORDER BY page_number, segment_order;
```

Kirim ke prompt hanya cuplikan pendek (maks ~600 karakter per blok). Jangan dump seluruh kitab.

### 6. Glossary yang benar-benar match

Jangan kirim seluruh glossary. Filter term yang muncul di `source_text` halaman aktif. Urut `priority` naik (angka kecil = lebih penting). Batas 8–12 term.

```sql
SELECT source_term, target_term, notes, priority
FROM translation_glossary
WHERE is_active = 1
  AND source_lang = 'ar'
  AND target_lang = 'id'
  AND (id_kitab = :id_kitab OR id_kitab IS NULL)
ORDER BY priority ASC, CHAR_LENGTH(source_term) DESC;
```

### 7. Exact TM — skip LLM jika sudah ada

```sql
SELECT id, source_text, translated_text, file_name, quality_score
FROM translation_memory
WHERE id_kitab = :id_kitab
  AND source_lang = 'ar'
  AND target_lang = 'id'
  AND source_text = :source_text
LIMIT 1;
```

Jika exact TM berkualitas ada, **jangan panggil model**. Pakai `translated_text` itu, lalu tetap pastikan `kitab_terjemahan` terisi untuk `file_name` tersebut.

### 8. Simpan terjemahan baru

Hanya jika belum ada row untuk `id_kitab` + `file_name` (atau user minta overwrite AI).

```sql
INSERT INTO kitab_terjemahan
  (id_kitab, text_original, text_translate, file_name)
VALUES
  (:id_kitab, :source_text, :translated_text, :file_name);
```

Jika row sudah ada dan user minta update AI (bukan hasil manusia):

```sql
UPDATE kitab_terjemahan
SET text_translate = :translated_text,
    text_original = COALESCE(NULLIF(text_original, ''), :source_text),
    file_name = COALESCE(file_name, :file_name)
WHERE id_kitab = :id_kitab
  AND file_name = :file_name
  AND id = :id;
```

Jangan kosongkan `text_original` lama.

Optional TM:

```sql
INSERT INTO translation_memory
  (id_kitab, source_lang, target_lang, source_text, source_text_normalized,
   translated_text, file_name, provider, model, quality_score)
VALUES
  (:id_kitab, 'ar', 'id', :source_text, :source_text,
   :translated_text, :file_name, 'ai_grok', :model, 0.70);
```

Normalisasi Arab yang dipakai app menghapus harakat. Bot tidak wajib meniru 1:1; yang wajib adalah `file_name` benar dan `text_original` = teks OCR yang diterjemahkan.

---

## Aturan Terjemahan (wajib sama dengan app)

Ini salinan perilaku `buildOpenAiTranslateSystemPrompt()` + user prompt pesantren.

### Gaya

- Indonesia natural, tetap dekat dengan susunan Arab.
- Gaya terjemahan kitab pesantren, bukan ensiklopedi / akademik modern.
- Urutan gagasan mengikuti Arab. Geser kata hanya demi tata bahasa Indonesia.
- Jangan ringkas, jangan buang, jangan tambah tafsir.
- Ungkapan sufistik / metaforis tetap simbolik.

### Gelar — jangan diterjemahkan makna

| Arab | Tetap |
| --- | --- |
| الحبيب | Habib |
| الإمام | Imam |
| السيد | Sayyid |
| الشيخ | Syekh |
| العلامة | al-‘Allāmah |
| القاضي | Qadhi |

### Doa setelah nama — terjemahkan makna, jangan transliterasi

| Arab | Indonesia |
| --- | --- |
| رضي الله عنه / عنها | semoga Allah meridhainya |
| رضي الله عنهم | semoga Allah meridhai mereka |
| رضوان الله عليه | semoga Allah melimpahkan keridhaan-Nya kepadanya |
| رحمه الله | semoga Allah merahmatinya |
| حفظه الله | semoga Allah menjaganya |
| غفر الله له | semoga Allah mengampuninya |

Jika glossary bertentangan dengan tabel doa ini, **ikuti tabel doa**.

### Output model

Kembalikan **hanya** teks terjemahan Indonesia. Tanpa markdown, tanpa judul, tanpa penjelasan.

### Blok OCR luar kotak

Jika sumber mengandung:

```text
--- OUTSIDE BOX ---
...
--- END OUTSIDE BOX ---
```

- Terjemahkan isi di dalam marker.
- Pertahankan marker apa adanya.
- Jangan campur catatan pinggir ke tubuh utama.

---

## Prompt Runtime per Halaman

Kirim ke model dalam urutan ini (yang tidak ada, dilewati):

1. system prompt Grok bot (blok copy-paste di atas)
2. glossary match-only (maks 8)
3. exact / similar TM (maks 2)
4. cuplikan prev / next page
5. teks Arab halaman ini

Template user:

```text
Terjemahkan teks Arab berikut ke Bahasa Indonesia dengan gaya terjemahan kitab (pesantren).

Ketentuan:
- Kembalikan hanya teks terjemahan.
- Jangan meringkas atau menghilangkan bagian apa pun.
- Jangan menambah tafsir atau komentar.
- Pertahankan marker --- OUTSIDE BOX --- jika ada.

[Glossary]
- ...

[Contoh TM]
- ...

[Konteks halaman sekitar]
- ...

Teks Arab:
<OCR dari source_units>

Terjemahan:
```

Mode hemat token (ikut [translation-token-efficiency.md](./translation-token-efficiency.md)):

- `mini`: teks pendek + glossary sedikit, tanpa TM
- `standard`: default
- `full`: halaman sulit, sufistik, atau OCR rusak — boleh 2 contoh TM + prev/next

---

## Penanganan OCR Kotor

Teks di DB adalah hasil OCR, bukan naskah bersih.

- Jangan menolak halaman hanya karena ada typo OCR.
- Jika 1–2 kata jelas salah baca tetapi makna kalimat masih ketebak dari konteks, perbaiki diam-diam di terjemahan (bukan di `source_text`).
- Jika sebaris tidak terbaca / terpotong parah, terjemahkan bagian yang jelas dan sisipkan `[tidak terbaca]` pada bagian yang gagal. Jangan mengarang ayat, nama kitab, atau hukum.
- Jangan menulis ulang `source_units`. OCR tetap tersimpan apa adanya.

---

## Laporan ke User

Setelah batch, tulis ringkas:

```text
Kitab: tajul arus (id=14)
OCR pages: 97
Sudah ada terjemahan: 49
Dikerjakan sekarang: 5
Skip (sudah ada): 49
Gagal: 0

- 050.txt page 50 insert ok
- 051.txt page 51 insert ok
...
```

Jangan dump seluruh terjemahan di chat kecuali user minta preview 1 halaman.

---

## Integrasi App (opsional, bukan syarat bot)

Grok / xAI kompatibel OpenAI. Bisa ditambah di Settings → API Setting:

| Field | Nilai |
| --- | --- |
| `provider` | `grok` atau `xai` |
| `base_url` | `https://api.x.ai/v1` |
| `meta.protocol` | `openai` |
| capability | `translate` |
| system prompt category | `translate_grok` (fallback `translate_openai`) |

Dispatcher `translate-ai` sudah memakai protocol `openai`. Bot Cursor **tidak perlu** menunggu UI ini; jalur Cursor adalah SQL langsung ke `reader_app`.

## Test Kitab

Selaras dengan [vector-search-rag.md](./vector-search-rag.md):

| Field | Nilai |
| --- | --- |
| `id_kitab` | `14` |
| Nama | `tajul arus` |
| OCR | `source_units` segment, `file_name` terisi |
| Kunci halaman | `001.txt` … |

Smoke test 1 halaman:

1. Pilih `file_name` yang `kitab_terjemahan`-nya kosong.
2. Ambil OCR dari DB.
3. Translate.
4. `INSERT` dengan `file_name` yang sama.
5. `SELECT` ulang: row ada, `text_translate` tidak kosong.
6. Pastikan tidak ada `DELETE`.

---

## Out Of Scope

Jangan dikerjakan lewat playbook ini:

- OCR ulang / vision ke gambar
- `DROP` / wipe `source_units` atau `kitab_terjemahan`
- ganti semantic TM menjadi RAG
- chat tanya isi kitab tanpa sitasi
- translate seluruh database dalam satu request tanpa konfirmasi jumlah halaman

## Done When

Bot dianggap siap dipakai bila:

- teks Arab diambil dari `source_units`, bukan dari gambar
- hasil masuk `kitab_terjemahan` dengan `file_name` benar
- halaman yang sudah ada terjemahan tidak ditimpa tanpa izin
- gaya gelar + doa mengikuti tabel di dokumen ini
- tidak ada perintah destruktif ke database
