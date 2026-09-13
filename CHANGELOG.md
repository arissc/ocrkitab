# CHANGELOG

## [Unreleased]

### Added
- Extended `api_settings` schema with metadata fields for dynamic provider management
- Added `base_url`, `model_default`, `capabilities_json`, `status`, `priority_order`, `meta_json` columns
- Added migration-safe schema extension for existing databases
- Added capability options UI in SettingsPage for managing provider capabilities
- Added status and priority order fields in API settings form
- Added `filterProvidersByCapability` helper in `electron/db.js` for filtering providers by capability
- Added IPC handler `filter-providers-by-capability` in `main.js`
- Added `filterProvidersByCapability` method in `preload.js` for renderer access
- Added `getApiSettingById` in `electron/db.js` for resolving provider config by id
- Added IPC handler `translate-ai` as a generic translate dispatcher (Gemini/OpenAI protocol)
- Added `translateAi` method in `preload.js` for renderer access
- Added dynamic translate provider dropdown in `SplitViewPage` using `api_settings` data
- Added fallback to hardcoded Gemini/OpenAI when no dynamic providers available
- Added provider name display in translation results header
- Redirected Chromium disk cache to a temp directory to avoid Windows cache permission errors

### Changed
- Updated `SplitViewPage` to fetch translate providers dynamically via `filterProvidersByCapability('translate')`
- Updated `SplitViewPage` to prefer generic `translate-ai` dispatcher (fallback to legacy vendor-specific IPC)
- Modified `runTranslate` to use `model_default` from provider config when available
- Updated model input field in settings modal to show read-only `model_default` when provider has it configured
- Changed translation result header to display provider name from dynamic config

## 2026-05-30 - v0.1.0

- Phase mulai: perluas `api_settings` untuk pondasi modul AI dinamis.
- Menambah kolom metadata provider pada `api_settings`: `base_url`, `model_default`, `capabilities_json`, `status`, `priority_order`, dan `meta_json`.
- Menambah migrasi schema aman di `electron/db.js` agar database lama otomatis ditambah kolom baru saat diakses.
- Memperluas `listApiSettings`, `upsertApiSetting`, dan `getApiSettingByName` agar membaca dan menyimpan metadata provider dinamis.
- Menambahkan normalisasi data capability, status, priority, dan metadata JSON di layer database.
- Memperluas UI `SettingsPage` untuk mengelola `base_url`, `default model`, `status`, `priority`, `capability`, dan `metadata JSON`.
- Memperbarui tampilan daftar API di `SettingsPage` agar menampilkan ringkasan status, model, dan capability.
