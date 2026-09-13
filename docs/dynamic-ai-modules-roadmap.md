# Roadmap Pengembangan Dynamic AI Modules

## Tujuan

Dokumen ini menjadi panduan implementasi agar modul AI di aplikasi bisa berkembang dari pola hardcoded menjadi pola dinamis, terutama untuk:

- dynamic provider list
- dynamic capability
- generic translate dispatcher

Target akhir:

- provider AI baru bisa ditambahkan dari data/config, bukan edit dropdown hardcoded di banyak file
- setiap provider punya deklarasi kemampuan yang jelas, misalnya `translate`, `chat`, `ocr`, `tts`, `stt`, `vision`
- modul `SplitView`, `AI Chat`, `Settings`, dan modul AI lain dapat membaca provider yang tersedia dari satu sumber data
- backend Electron memiliki dispatcher generik untuk translate, sehingga penambahan provider baru cukup menambah adapter/handler baru
- binding system prompt agent tidak lagi bergantung pada kategori statis seperti `translate_openai` dan `translate_gemini`

## Kondisi Saat Ini

### Frontend

- `src/renderer/pages/SettingsPage.jsx`
  - data API setting sudah bisa CRUD melalui `listApiSettings`, `saveApiSetting`, `deleteApiSetting`
  - form API masih sederhana: `name`, `provider`, `api_key`
  - kategori agent masih hardcoded dalam array `categories`
- `src/renderer/pages/SplitViewPage.jsx`
  - pilihan translate AI masih hardcoded: `gemini`, `openai`
  - label hasil translate masih hardcoded ke dua provider itu
  - pemilihan model juga masih bercabang khusus OpenAI vs Gemini
  - state default masih memakai `translateAi`, `openAiModel`, `geminiModel`

### Backend Electron

- `electron/preload.js`
  - expose IPC khusus provider seperti `translateGeminiCli` dan `translateOpenAiCli`
- `electron/main.js`
  - ada handler terpisah:
    - `translate-gemini-cli`
    - `translate-openai-cli`
  - `get-defaults` masih mengembalikan setting yang mengasumsikan provider tertentu

### Konsekuensi Arsitektur Saat Ini

- tambah provider baru butuh edit di banyak tempat sekaligus
- dropdown provider di UI tidak otomatis ikut bertambah
- satu provider tidak punya metadata capability yang bisa dibaca modul lain
- binding prompt agent harus dibuat per kategori hardcoded, bukan per capability/provider
- semakin banyak provider, semakin banyak `if/else` yang tersebar

## Prinsip Desain Baru

### 1. Satu sumber data provider

Semua modul membaca provider AI dari sumber data yang sama, idealnya tabel `api_settings` yang diperluas.

### 2. Capability-driven UI

UI tidak bertanya "ini OpenAI atau Gemini?", tetapi bertanya "provider mana yang mendukung translate?".

### 3. Generic dispatch

Frontend memanggil satu endpoint umum, misalnya `translate-ai`, lalu backend memilih adapter yang sesuai.

### 4. Provider adapter pattern

Setiap provider punya adapter dengan kontrak yang sama. Modul lain tidak perlu tahu detail API tiap vendor.

### 5. Backward-compatible migration

Provider lama seperti Gemini dan OpenAI tetap berjalan selama masa transisi.

## Target Data Model

### Opsi Minimum

Perluas tabel `api_settings` agar tidak hanya menyimpan nama provider dan API key.

Field yang disarankan:

- `id`
- `name`
- `provider`
- `api_key`
- `base_url` nullable
- `model_default` nullable
- `capabilities_json`
- `status` nullable, misalnya `active` atau `inactive`
- `priority_order` nullable
- `meta_json` nullable

Contoh isi `capabilities_json`:

```json
["translate", "chat", "tts"]
```

Contoh isi `meta_json`:

```json
{
  "supports_model_override": true,
  "supports_system_prompt": true,
  "supports_streaming": false
}
```

### Opsi Lebih Rapi

Pisahkan ke dua tabel:

- `api_settings`
- `api_capabilities`

Namun untuk migrasi awal, menyimpan capability dalam JSON di `api_settings` lebih cepat dan minim perubahan schema.

## Target Konsep Binding Agent

Saat ini binding memakai kategori statis seperti:

- `translate_openai`
- `translate_gemini`
- `ocr_openai`
- `ai_chat`
- `video_prompt`

Target pengganti:

- binding berbasis capability, misalnya `translate`, `chat`, `ocr`, `video_prompt`
- opsional: binding lebih spesifik per provider, misalnya:
  - `translate`
  - `translate:openai`
  - `translate:gemini`
  - `chat`
  - `chat:openai`

Aturan fallback yang disarankan:

1. cari binding paling spesifik, misalnya `translate:openai`
2. jika tidak ada, fallback ke `translate`
3. jika tidak ada, pakai prompt default bawaan aplikasi

## Phase Pengembangan

## Phase 0 - Audit dan Persiapan

Tujuan:

- memetakan semua hardcoded provider dan capability
- menentukan titik migrasi yang aman

Pekerjaan:

- audit semua pemakaian string hardcoded:
  - `gemini`
  - `openai`
  - `translate_openai`
  - `translate_gemini`
- audit semua handler provider-specific di `preload.js` dan `main.js`
- daftar modul yang akan membaca provider dinamis:
  - `SplitViewPage`
  - `AIChatPage`
  - `SettingsPage`
  - modul OCR/vision ke depan

Output:

- daftar lokasi hardcoded
- mapping fitur → provider existing
- daftar state/settings yang perlu dimigrasi

Definisi selesai:

- semua titik hardcoded terdokumentasi
- disepakati nama capability standar

## Phase 1 - Standardisasi Capability

Tujuan:

- memperkenalkan vocabulary capability yang konsisten

Capability minimum yang disarankan:

- `translate`
- `chat`
- `ocr`
- `vision`
- `tts`
- `stt`
- `video`

Pekerjaan:

- buat util capability standar di renderer dan backend
- tetapkan aturan penamaan lowercase snake_case atau lowercase plain string
- putuskan format final penyimpanan capability:
  - array JSON string
  - atau tabel relasi

Output:

- daftar capability baku
- helper parser capability

Definisi selesai:

- capability tidak lagi diinterpretasi bebas per halaman

## Phase 2 - Perluasan Data `api_settings`

Tujuan:

- membuat data provider cukup kaya untuk dipakai UI dinamis

Pekerjaan:

- update schema database atau migrasi tabel `api_settings`
- tambahkan field:
  - `model_default`
  - `capabilities_json`
  - `base_url`
  - `meta_json`
  - `priority_order`
- update CRUD:
  - `list-api-settings`
  - `save-api-setting`
  - `delete-api-setting`
- update `SettingsPage` form agar bisa edit capability dan default model

UI `SettingsPage` yang disarankan:

- `Nama`
- `Provider ID`
- `API Key`
- `Base URL` opsional
- `Default Model`
- checklist capability:
  - Translate
  - Chat
  - OCR
  - Vision
  - TTS
  - STT
- field metadata opsional

Output:

- data provider sudah bisa menyatakan dirinya mendukung fitur apa

Definisi selesai:

- minimal satu record OpenAI dan satu record Gemini sudah punya capability JSON valid

## Phase 3 - Dynamic Provider Registry di Frontend

Tujuan:

- menghilangkan dropdown provider hardcoded

Pekerjaan:

- buat hook/helper umum, misalnya:
  - `useAiProviders()`
  - `getProvidersByCapability(capability)`
- `SplitViewPage`
  - ambil provider yang punya capability `translate`
  - render dropdown translate dari hasil query
- `AIChatPage`
  - ambil provider yang punya capability `chat`
- `SettingsPage`
  - tambahkan tampilan ringkasan provider per capability

Perubahan state yang disarankan:

- ganti `translateAi` menjadi salah satu dari:
  - `translateProvider`
  - `translateProviderId`

Rekomendasi:

- gunakan `provider setting id` jika memungkinkan
- jika masih ingin cepat, gunakan `provider` string dulu

Alasan memilih `id`:

- bisa punya lebih dari satu konfigurasi untuk provider yang sama
- contoh:
  - `OpenAI Primary`
  - `OpenAI Backup`
  - `Gemini Personal`

Output:

- dropdown provider mengikuti data database

Definisi selesai:

- tambah provider translate baru di settings langsung muncul di dropdown `SplitView`

## Phase 4 - Generic Translate Dispatcher

Tujuan:

- mengganti handler `translate-gemini-cli` dan `translate-openai-cli` menjadi satu pintu generik

Kontrak IPC baru yang disarankan:

- `translate-ai`

Payload contoh:

```json
{
  "providerId": 12,
  "text": "....",
  "target": "id",
  "model": "gpt-4o-mini",
  "prompt": "....",
  "folderPath": "E:\\BOOK\\...",
  "filePath": "E:\\BOOK\\...\\001.txt",
  "fileName": "001.txt",
  "page": "001"
}
```

Response contoh:

```json
{
  "ok": true,
  "provider": "openai",
  "providerId": 12,
  "model": "gpt-4o-mini",
  "output": "hasil translate"
}
```

Struktur backend yang disarankan:

```text
electron/
  ai/
    registry.js
    providers/
      openai.js
      gemini.js
      deepseek.js
    prompts/
      resolvePrompt.js
```

Kontrak adapter provider:

```js
{
  id: 'openai',
  supports: ['translate', 'chat', 'tts'],
  translate: async (ctx) => {},
  chat: async (ctx) => {},
  tts: async (ctx) => {}
}
```

Flow dispatcher:

1. terima payload `translate-ai`
2. lookup `providerId` di `api_settings`
3. validasi provider aktif dan punya capability `translate`
4. resolve prompt agent
5. resolve model final
6. pilih adapter provider dari registry
7. panggil `adapter.translate(context)`
8. kembalikan response standar

Fallback transisi:

- pertahankan `translate-gemini-cli` dan `translate-openai-cli` sementara
- implementasikan keduanya sebagai wrapper yang memanggil dispatcher generik

Output:

- frontend cukup kenal satu endpoint translate

Definisi selesai:

- `SplitViewPage` tidak lagi memanggil IPC khusus vendor

## Phase 5 - Dynamic Agent Binding

Tujuan:

- menghilangkan kategori prompt agent hardcoded

Pekerjaan:

- ganti konsep kategori pada `SettingsPage`
- gunakan target binding yang lebih generik:
  - `translate`
  - `translate:provider`
  - `chat`
  - `ocr`
  - `video`
- ubah UI agar source pilihan binding berasal dari capability/provider yang ada

Contoh UI binding:

- Jenis fitur:
  - Translate
  - Chat
  - OCR
  - Video
- Provider:
  - Semua provider
  - OpenAI
  - Gemini
  - DeepSeek

Representasi binding:

```json
{
  "scope": "translate",
  "provider": "openai",
  "prompt_id": 3
}
```

Atau kalau masih ingin tetap satu kolom string:

```text
translate
translate:openai
chat
chat:gemini
ocr
```

Output:

- `SettingsPage` tidak perlu array kategori statis lagi

Definisi selesai:

- binding baru bisa mengikuti provider yang ditambah user

## Phase 6 - Dynamic Model Resolution

Tujuan:

- menghapus state model yang hardcoded per provider

Masalah saat ini:

- `openAiModel` dan `geminiModel` dipisah
- model input di UI hanya tahu dua provider

Target:

- model mengikuti provider yang dipilih
- sumber model:
  - model override dari UI
  - jika kosong, `api_settings.model_default`
  - jika kosong, fallback bawaan adapter

Pekerjaan:

- ubah state model di frontend menjadi generik, misalnya:
  - `translateModelOverride`
- tampilkan input model berdasarkan provider aktif, bukan berdasarkan if/else OpenAI vs Gemini
- bila nanti provider mendukung daftar model otomatis, sediakan endpoint:
  - `list-provider-models`

Output:

- tidak ada lagi state `openAiModel` dan `geminiModel` di modul translate utama

Definisi selesai:

- tambah provider baru tidak mengharuskan membuat state model baru

## Phase 7 - Rollout dan Pembersihan Legacy

Tujuan:

- menutup masa transisi dan mengurangi duplikasi

Pekerjaan:

- hapus hardcoded dropdown provider lama
- hapus wrapper lama jika sudah tidak dipakai:
  - `translateGeminiCli`
  - `translateOpenAiCli`
- rapikan `get-defaults` agar memakai setting/provider generic
- update dokumentasi pengguna dan dokumentasi developer

Definisi selesai:

- tidak ada jalur utama yang tergantung vendor-specific IPC

## Kontrak Teknis yang Disarankan

## 1. Bentuk Data Provider di Renderer

```ts
type ApiProviderSetting = {
  id: number
  name: string
  provider: string
  api_key: string
  base_url?: string
  model_default?: string
  capabilities: string[]
  status?: 'active' | 'inactive'
  priority_order?: number
  meta?: Record<string, unknown>
}
```

## 2. Helper Frontend

Helper minimum:

- `normalizeCapabilities(input): string[]`
- `isCapabilityEnabled(setting, capability): boolean`
- `filterProvidersByCapability(settings, capability): ApiProviderSetting[]`
- `getProviderLabel(setting): string`

## 3. Kontrak Context Dispatcher

```ts
type TranslateContext = {
  providerSetting: ApiProviderSetting
  text: string
  target: string
  model?: string
  prompt?: string
  folderPath?: string
  filePath?: string
  fileName?: string
  page?: string
}
```

## 4. Kontrak Result Dispatcher

```ts
type TranslateResult = {
  ok: boolean
  provider: string
  providerId: number
  model?: string
  output?: string
  error?: string
  raw?: unknown
}
```

## Strategi Migrasi

### Migrasi Data

Seed awal yang disarankan:

- OpenAI:
  - `provider: openai`
  - `capabilities: ["translate", "chat", "tts", "vision"]`
- Gemini:
  - `provider: gemini`
  - `capabilities: ["translate", "chat", "stt", "vision"]`

### Migrasi Setting

Setting lama:

- `translateAi`
- `openAiModel`
- `geminiModel`

Transisi yang disarankan:

1. baca `translateAi` lama
2. cari provider setting pertama yang cocok
3. simpan ke field baru, misalnya `translateProviderId`
4. tetap baca fallback lama untuk kompatibilitas sementara

### Migrasi Agent Binding

Konversi yang disarankan:

- `translate_openai` -> `translate:openai`
- `translate_gemini` -> `translate:gemini`
- `ocr_openai` -> `ocr:openai`
- `ai_chat` -> `chat`
- `video_prompt` -> `video`

## Risiko dan Mitigasi

### Risiko 1 - Provider muncul di UI tapi belum punya adapter

Mitigasi:

- validasi capability saat simpan
- atau tandai provider `enabled_for_ui` dan `enabled_for_runtime`
- tampilkan badge status di settings

### Risiko 2 - Satu provider punya banyak akun/config

Mitigasi:

- gunakan `provider setting id` sebagai identitas pilihan utama

### Risiko 3 - Prompt agent tidak cocok untuk semua provider

Mitigasi:

- terapkan fallback bertingkat:
  - provider-specific
  - capability-level
  - built-in default

### Risiko 4 - Model antar provider tidak kompatibel

Mitigasi:

- model disimpan sebagai string bebas per provider
- validasi model dilakukan di adapter masing-masing

### Risiko 5 - Scope perubahan terlalu besar

Mitigasi:

- rollout bertahap dimulai dari `SplitView translate`
- modul lain mengikuti setelah dispatcher generik stabil

## Urutan Implementasi yang Paling Aman

Urutan yang disarankan:

1. standardisasi capability
2. perluas `api_settings`
3. buat helper provider dinamis di frontend
4. refactor `SplitViewPage` ke dropdown provider dinamis
5. buat `translate-ai` generic dispatcher
6. ubah agent binding ke model dinamis
7. baru ekspansi ke chat, OCR, TTS, STT

## Checklist Implementasi

### Database

- tambah field capability dan model default
- siapkan migrasi data lama
- update query CRUD `api_settings`

### Electron Main

- buat provider registry
- buat generic dispatcher `translate-ai`
- pertahankan wrapper lama untuk kompatibilitas sementara
- buat resolver binding prompt

### Preload

- expose API baru:
  - `translateAi`
  - opsional `listProviderModels`

### Renderer

- buat helper/filter provider by capability
- ubah dropdown `SplitViewPage` menjadi dinamis
- ubah label hasil translate jadi generik
- ubah input model jadi generik
- ubah `SettingsPage` API form agar bisa edit capability
- ubah `SettingsPage` agent binding agar tidak hardcoded

### Testing

- test provider tanpa capability `translate` tidak muncul di `SplitView`
- test provider dengan capability `translate` muncul di `SplitView`
- test fallback prompt capability-level berjalan
- test fallback prompt provider-specific berjalan
- test translate generik berhasil untuk OpenAI dan Gemini
- test setting lama masih terbaca saat migrasi

## Deliverable Per Phase

### Deliverable Phase 1-2

- schema/provider metadata siap
- UI settings untuk capability siap

### Deliverable Phase 3-4

- `SplitView` dinamis
- translate dispatcher generik berjalan

### Deliverable Phase 5-7

- agent binding dinamis
- legacy hardcoded dibersihkan

## Rekomendasi Implementasi Nyata di Project Ini

Untuk project saat ini, urutan paling efektif adalah:

1. perluas `api_settings` dulu
2. buat util frontend `filterProvidersByCapability`
3. refactor `SplitViewPage` agar pakai `translateProviderId`
4. tambah IPC `translate-ai`
5. ubah `translate-gemini-cli` dan `translate-openai-cli` menjadi wrapper
6. refactor `SettingsPage` agent category menjadi binding generik berbasis capability/provider

Dengan urutan ini, manfaat pertama sudah langsung terasa di `SplitViewPage`, tetapi refactor besar tetap terkontrol.

## Catatan Akhir

Jika ingin implementasi paling hemat risiko, jangan langsung membuat semua modul menjadi dinamis sekaligus.

Mulai dari jalur paling penting:

- `SettingsPage` sebagai sumber data provider
- `SplitViewPage` sebagai konsumen provider translate
- `electron/main.js` sebagai generic translate dispatcher

Setelah tiga titik ini stabil, modul lain seperti `AIChatPage`, `OCR`, `TTS`, dan `STT` akan jauh lebih mudah mengikuti pola yang sama.
