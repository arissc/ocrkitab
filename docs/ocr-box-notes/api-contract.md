# Kontrak UI, IPC, dan Output

## Tujuan

Dokumen ini mendefinisikan kontrak perubahan agar mode layout baru tetap kompatibel dengan flow OCR yang sudah ada.

## UI State di OCRPage

Tambahan state yang disarankan di [OCRPage.jsx](file:///e:/personalapp/reader/src/renderer/pages/OCRPage.jsx):

```js
const [layoutMode, setLayoutMode] = useState('full')
const [boxPaddingPct, setBoxPaddingPct] = useState(0.01)
const [notePaddingPct, setNotePaddingPct] = useState(0.01)
const [outsideFormat, setOutsideFormat] = useState('zoned')
```

## Payload Batch OCR

### Sebelum

```json
{
  "inputFolder": "E:\\img",
  "outputFolder": "E:\\txt",
  "tesseractPath": "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
  "lang": "ara"
}
```

### Sesudah

```json
{
  "inputFolder": "E:\\img",
  "outputFolder": "E:\\txt",
  "tesseractPath": "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
  "lang": "ara",
  "layoutMode": "full",
  "boxPaddingPct": 0.01,
  "notePaddingPct": 0.01,
  "outsideFormat": "zoned"
}
```

## Payload Single File Re-OCR

Payload `run-ocr-file` yang disarankan:

```json
{
  "imagePath": "E:\\img\\0001.jpg",
  "txtPath": "E:\\txt\\0001.txt",
  "engine": "tesseract",
  "layoutMode": "box_notes",
  "boxPaddingPct": 0.01,
  "notePaddingPct": 0.01,
  "outsideFormat": "zoned"
}
```

## Kontrak Preload

[preload.js](file:///e:/personalapp/reader/electron/preload.js) tidak perlu channel baru jika hanya meneruskan payload yang lebih kaya.

Yang penting:

1. `runOCR`
2. `runOCRDL`
3. `runOCREasy`
4. `runOCRKraken`
5. `runOCRVision`

semuanya menerima field layout tambahan dan tidak memfilter field tersebut.

## Default Backend

Backend harus mengisi default saat field tidak dikirim:

```js
const layoutMode = payload?.layoutMode || 'full'
const boxPaddingPct = normalizePct(payload?.boxPaddingPct, 0.01)
const notePaddingPct = normalizePct(payload?.notePaddingPct, 0.01)
const outsideFormat = payload?.outsideFormat || 'zoned'
```

## Format Output File

### Mode `full`

Isi file sama seperti sekarang:

```text
{FULL_PAGE_OCR_TEXT}
```

### Mode `box_notes` dengan box terdeteksi

```text
{MAIN_TEXT}

--- OUTSIDE BOX ---
[OUTSIDE:top] ...
[OUTSIDE:right] ...
[OUTSIDE:bottom] ...
[OUTSIDE:left] ...
```

### Mode `box_notes` tetapi box tidak terdeteksi

Fallback:

```text
{FULL_PAGE_OCR_TEXT}
```

## Aturan Output

1. Tetap satu file `.txt` per halaman.
2. Region outside kosong tidak wajib ditulis.
3. Blok `--- OUTSIDE BOX ---` hanya ditulis jika minimal satu region menghasilkan teks.
4. Jika `outsideFormat === "flat"`, semua baris outside boleh memakai tag `[OUTSIDE]`.

## Kontrak Logging Progress

Event progress saat ini tidak perlu diubah strukturnya:

```json
{
  "file": "0001.jpg",
  "index": 1,
  "total": 20,
  "ok": true,
  "error": null
}
```

Tetapi log internal backend sebaiknya punya metadata tambahan untuk debugging layout, tanpa harus mengubah event UI.

## Kontrak Settings

Field baru yang disarankan di settings:

```json
{
  "ocrLayoutMode": "full",
  "ocrBoxPaddingPct": 0.01,
  "ocrNotePaddingPct": 0.01,
  "ocrOutsideFormat": "zoned"
}
```

## Kompatibilitas Mundur

1. Semua payload lama tetap valid.
2. Semua engine yang belum mendukung layout-aware OCR tetap harus bisa memakai mode `full`.
3. Jika `layoutMode` dikirim tetapi helper layout gagal diinisialisasi, backend harus fallback ke full page dan mengembalikan error hanya jika OCR inti benar-benar gagal.
