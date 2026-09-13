# Universe Reader (React + Electron)

Desktop app providing a UI for two workflows based on your existing scripts:

- OCR images to text using Tesseract (`img_text.ps1` behavior)
- Join generated text files into `all_pages.txt` (`gabung.bat` behavior)

## Prerequisites

- Windows
- Node.js 18+
- Tesseract OCR installed at `C:\\Program Files\\Tesseract-OCR\\tesseract.exe` (or browse to a custom path)

## Develop

```
npm install
npm run dev
```

This launches Vite at `http://localhost:5173` and opens Electron, loading the renderer.

## Build renderer and run Electron

```
npm run build
```

## Usage

- Select input image folder (expects `.jpg` files)
- Select output text folder
- Verify `tesseract.exe` path
- Choose language code (default `ara` for Arabic)
- Click "Mulai OCR" to process images into `.txt`
- Click "Gabung Teks" to sort by numeric base name and write `all_pages.txt`

## Notes

- Sorting follows numeric base name if possible; otherwise lexicographic.
- OCR progress is displayed per file.