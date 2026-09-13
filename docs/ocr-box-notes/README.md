# OCR Box Notes Development Pack

Dokumen di folder ini melengkapi konsep awal pada [OCR_BOX_NOTES.md](file:///e:/personalapp/reader/docs/OCR_BOX_NOTES.md) agar modul `Inside Box + Mark Outside` bisa langsung masuk ke tahap pengembangan.

## Isi Dokumen

1. [spec.md](file:///e:/personalapp/reader/docs/ocr-box-notes/spec.md)
   Ringkasan kebutuhan produk, scope, acceptance criteria, dan non-goals.
2. [technical-design.md](file:///e:/personalapp/reader/docs/ocr-box-notes/technical-design.md)
   Desain backend, layout segmentation, strategi crop, fallback, dan catatan dependency.
3. [api-contract.md](file:///e:/personalapp/reader/docs/ocr-box-notes/api-contract.md)
   Kontrak payload UI, preload, IPC, setting, dan format output file.
4. [tasks.md](file:///e:/personalapp/reader/docs/ocr-box-notes/tasks.md)
   Breakdown implementasi per tahap dengan urutan kerja yang masuk akal.
5. [checklist.md](file:///e:/personalapp/reader/docs/ocr-box-notes/checklist.md)
   Checklist delivery untuk development, QA, dan release readiness.
6. [test-cases.md](file:///e:/personalapp/reader/docs/ocr-box-notes/test-cases.md)
   Skenario uji manual dan target verifikasi hasil OCR.

## Referensi Kode Saat Ini

- UI OCR: [src/renderer/pages/OCRPage.jsx](file:///e:/personalapp/reader/src/renderer/pages/OCRPage.jsx)
- IPC bridge: [electron/preload.js](file:///e:/personalapp/reader/electron/preload.js)
- Backend OCR utama: [electron/main.js](file:///e:/personalapp/reader/electron/main.js)

## Asumsi V1

- Struktur output tetap satu file `.txt` per halaman.
- Mode baru dikenalkan sebagai opsi layout, bukan engine OCR baru.
- V1 mengikuti payload IPC yang sudah ada dan menambah parameter baru tanpa memutus kompatibilitas.
- V1 sebaiknya memakai utilitas yang sudah tersedia lebih dulu, terutama preprocessing berbasis `magick` di backend, sebelum menambah dependency native baru.
