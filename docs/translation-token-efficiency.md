# Translation Token Efficiency Strategy

## Purpose

Dokumen ini menjelaskan strategi penghematan token API untuk proses translasi Arab -> Indonesia di repo `reader`.

Dokumen ini adalah turunan dari:

- [Translation Memory & Semantic Learning Architecture](./improvement.md)

Fokus utama:

- mengurangi jumlah request ke LLM
- mengurangi ukuran prompt saat request memang perlu dikirim
- mengurangi output yang tidak perlu
- tetap menjaga kualitas dan konsistensi terjemahan

## Main Principle

Penghematan token terbesar tidak datang dari mempersingkat kalimat prompt saja.

Penghematan terbesar datang dari:

1. tidak memanggil LLM bila tidak perlu
2. hanya mengirim konteks yang relevan
3. memakai mode prompt sesuai tingkat kesulitan
4. memanfaatkan memory, glossary, dan feedback sebelum request dikirim

## Where Savings Come From

Urutan sumber penghematan paling besar:

1. exact TM short-circuit
2. cache hasil translasi final
3. glossary matched-only
4. similar examples dengan threshold ketat
5. context retrieval adaptif
6. feedback diringkas menjadi aturan singkat
7. prompt mode bertingkat

## Rule 1 - Skip LLM Whenever Safe

### Exact TM Short-Circuit

Jika `translation_memory` menemukan exact match berkualitas tinggi, jangan panggil API.

Langsung return hasil yang ada bila syarat minimal terpenuhi:

- source hash sama
- normalized source text sama
- memory entry berstatus approved atau kualitas tinggi
- tidak ada sinyal bahwa konteks khusus dibutuhkan

### Final Translation Cache

Jika unit teks yang sama pernah diterjemahkan dan belum berubah:

- return hasil final dari database
- jangan kirim request baru ke provider

Ini penting untuk kasus buka halaman yang sama berkali-kali atau refresh UI.

## Rule 2 - Send Only Matched Knowledge

### Glossary

Jangan pernah kirim seluruh glossary.

Kirim hanya:

- term yang benar-benar match pada source text
- urut berdasarkan `priority`
- utamakan longest match lebih dulu

Batasi jumlah item, misalnya:

- `mini`: maksimal 3
- `standard`: maksimal 8
- `full`: maksimal 12

### Feedback Rules

Jangan kirim seluruh histori koreksi editor.

Ubah ke format singkat seperti:

```text
Always translate الشيخ as Syekh.
Never use Guru for الشيخ.
```

Hanya kirim rule yang relevan dengan teks aktif.

### Similar Examples

Jangan kirim contoh yang similarity-nya lemah.

Aturan awal yang disarankan:

- kirim 0 contoh jika tidak ada kandidat kuat
- kirim 1 contoh untuk mode `mini`
- kirim maksimal 2 untuk mode `standard`
- kirim maksimal 3 untuk mode `full`

## Rule 3 - Use Prompt Modes

Prompt tidak boleh satu ukuran untuk semua kasus.

Gunakan tiga mode:

- `mini`
- `standard`
- `full`

## Mini Mode

Pakai bila:

- ada exact TM kuat
- teks pendek
- glossary match cukup jelas
- confidence tinggi

Isi prompt:

1. aturan sistem ringkas
2. matched glossary singkat
3. current text

Tujuan:

- biaya paling murah
- latency rendah
- cocok untuk kalimat sederhana atau frasa stabil

## Standard Mode

Pakai bila:

- tidak ada exact TM final
- ada glossary match
- ada 1-2 contoh mirip yang cukup kuat
- konteks tidak terlalu kompleks

Isi prompt:

1. aturan sistem
2. matched glossary
3. exact TM bila ada
4. 1-2 similar examples
5. current text

Tujuan:

- mode default untuk mayoritas request

## Full Mode

Pakai bila:

- teks ambigu atau panjang
- gaya naratif bergantung pada konteks
- confidence rendah
- ada kebutuhan context retrieval
- ada konflik istilah atau feedback yang perlu ditegaskan

Isi prompt:

1. aturan sistem
2. matched glossary
3. exact TM bila ada
4. top similar examples
5. feedback rules yang relevan
6. previous/current/next context seperlunya
7. current text

Tujuan:

- dipakai hanya untuk kasus yang benar-benar butuh

## Suggested Routing Logic

Gunakan routing sederhana dulu, berbasis rules.

### Route A - Return Without LLM

Kondisi:

- exact TM high confidence
- atau final translation cache tersedia

Aksi:

- return hasil langsung

### Route B - Mini

Kondisi:

- source text pendek
- glossary hit ada
- tidak ada konflik
- confidence dasar tinggi

Aksi:

- kirim prompt `mini`

### Route C - Standard

Kondisi:

- tidak ada exact final hit
- ada bantuan retrieval yang cukup
- teks masih moderat

Aksi:

- kirim prompt `standard`

### Route D - Full

Kondisi:

- teks baru
- similarity rendah
- konteks penting
- atau confidence rendah

Aksi:

- kirim prompt `full`

## Suggested Confidence Inputs For Routing

Gunakan sinyal ini untuk menentukan mode:

- exact TM found
- glossary hit count
- feedback rule hit
- similar example score
- text length
- ada/tidaknya context dependency
- source unit pernah diedit editor atau tidak

Contoh interpretasi awal:

- `90+`: skip LLM atau `mini`
- `70-89`: `standard`
- `0-69`: `full`

## Prompt Design Rules

### Keep System Prompt Stable

Usahakan bagian aturan sistem tidak sering berubah.

Manfaat:

- lebih mudah diuji
- lebih mudah di-cache
- lebih konsisten antar-request

### Keep Dynamic Sections Short

Section dinamis harus ringkas dan deterministik.

Format yang disarankan:

```text
Glossary:
- الشيخ => Syekh
- رضي الله عنه => semoga Allah meridhainya

Example:
Arabic: ...
Translation: ...
```

Hindari paragraf penjelasan panjang yang bisa diganti daftar singkat.

### Ask For Translation Only

Selalu minta output sesingkat mungkin:

- return hanya teks terjemahan
- tanpa markdown
- tanpa penjelasan
- tanpa catatan tambahan

### Cap Output Length When Possible

Untuk teks pendek, instruksikan model agar tidak menambah kalimat di luar sumber.

Tujuannya bukan memotong makna, tetapi menghindari elaborasi yang tidak diminta.

## Retrieval Budget Rules

### Glossary Budget

- kirim hanya match
- deduplicate term
- longest match wins
- skip item dengan prioritas rendah bila prompt sudah padat

### Similar Example Budget

- wajib threshold similarity minimum
- ranking human-approved di atas AI-only
- jangan kirim contoh yang hampir tidak relevan

### Context Budget

Context jangan always-on.

Kirim hanya bila:

- ada indikasi pronoun ambiguity
- ada lanjutan narasi
- ada kalimat yang secara struktur menggantung
- source unit berasal dari rangkaian paragraf yang berhubungan kuat

Jika tidak ada sinyal itu, skip context.

## Data Design For Token Savings

Struktur data yang baik akan menghemat token secara langsung.

### Save Normalized Text

Simpan:

- `source_text`
- `source_text_normalized`
- `source_hash`

Tujuannya agar exact TM lebih sering hit.

### Save Quality Signals

Simpan sinyal seperti:

- approved by human
- usage_count
- last_used_at
- confidence score

Tujuannya agar hanya knowledge terbaik yang naik ke prompt.

### Distill Feedback

Selain menyimpan raw feedback, siapkan bentuk rule yang lebih pendek untuk prompt.

Contoh:

- raw feedback untuk histori
- distilled rule untuk prompt builder

## Anti-Patterns

Hindari pola berikut:

- kirim seluruh glossary kitab ke setiap request
- kirim semua previous corrections
- kirim context prev/next untuk semua teks
- kirim terlalu banyak example dengan relevance rendah
- memanggil LLM ulang untuk exact text yang sama
- memakai mode prompt besar sebagai default

## Recommended Implementation Order

Urutan implementasi hemat token yang paling aman:

1. exact TM short-circuit
2. matched-only glossary injection
3. prompt mode `mini/standard/full`
4. feedback distilled rules
5. adaptive context retrieval
6. semantic retrieval dengan threshold ketat

## Integration Notes For Repo

Secara praktis di repo ini:

- retrieval decision bisa dimulai di `electron/main.js`
- helper ranking dan prompt mode sebaiknya dipisah dari handler utama
- schema pendukung ditambah di `electron/db.js`
- UI tidak perlu tahu detail token strategy, cukup menerima hasil dan confidence

## Done Criteria

Strategi ini dianggap mulai berhasil bila:

- jumlah request translate ke provider turun untuk teks berulang
- prompt rata-rata lebih pendek pada kasus mudah
- biaya translate turun tanpa penurunan kualitas yang signifikan
- exact repeated text semakin sering tidak memanggil LLM
- kasus yang benar-benar kompleks tetap mendapat prompt yang cukup kaya
