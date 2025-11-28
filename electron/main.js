import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { initMySql, getDbStatus, listKitabs, getTranslation, saveTranslation, findKitabByFolder, createKitab } from './db.js'

let mainWindow
let ocrState = { running: false, total: 0, completed: 0, lastFile: null }

// Settings persistence helpers
function getSettingsFile() {
  const userDir = app.getPath('userData')
  return path.join(userDir, 'settings.json')
}

function readSettings() {
  try {
    const file = getSettingsFile()
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8')
      return JSON.parse(raw)
    }
  } catch (_) {}
  return {}
}

function writeSettings(partial) {
  const file = getSettingsFile()
  const current = readSettings()
  const next = { ...current, ...partial }
  try {
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to write settings:', e)
  }
  return next
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(process.cwd(), 'electron', 'preload.js'),
      contextIsolation: true
    }
  })

  const startUrl = process.env.ELECTRON_START_URL
  if (startUrl) {
    mainWindow.loadURL(startUrl)
  } else {
    mainWindow.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  // Initialize MySQL connection and ensure schema
  initMySql()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('select-folder', async (_event, defaultPath) => {
  const options = {
    properties: ['openDirectory']
  }
  if (typeof defaultPath === 'string' && defaultPath.length > 0) {
    options.defaultPath = defaultPath
  }
  const result = await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('select-tesseract', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Executable', extensions: ['exe'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('select-magick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'ImageMagick', extensions: ['exe'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('select-pdftoppm', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Poppler pdftoppm', extensions: ['exe'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('open-explorer', async (_event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { ok: false, error: 'Folder tidak ditemukan.' }
  }
  try {
    const res = await shell.openPath(dirPath)
    if (!res) return { ok: true }
    // Fallback to explorer.exe if shell.openPath returns an error string
    await new Promise((resolve, reject) => {
      const proc = spawn('explorer.exe', [dirPath])
      proc.on('exit', code => (code === 0 ? resolve() : reject(new Error('explorer.exe exit ' + code))))
      proc.on('error', reject)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File tidak ditemukan.' }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return { ok: true, content }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// DB status for diagnostics
ipcMain.handle('db-status', async () => {
  return getDbStatus()
})

// Get translation for given original text under a kitab name
ipcMain.handle('get-translation', async (_event, payload) => {
  try {
    const { kitabName, originalText } = payload || {}
    if (!kitabName || !originalText) return { ok: false, error: 'kitabName and originalText required' }
    const data = await getTranslation(kitabName, originalText)
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Insert or update translation for given original text under a kitab name
ipcMain.handle('save-translation', async (_event, payload) => {
  try {
    const { kitabName, originalText, translatedText } = payload || {}
    if (!kitabName || !originalText) return { ok: false, error: 'kitabName and originalText required' }
    const res = await saveTranslation(kitabName, originalText, translatedText)
    return { ok: true, ...res }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// List all kitab from master_kitab
ipcMain.handle('list-kitabs', async () => {
  try {
    const status = getDbStatus()
    if (!status.ok) {
      await initMySql()
    }
    const rows = await listKitabs()
    return { ok: true, data: rows }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Find kitab by folder path
ipcMain.handle('find-kitab-by-folder', async (_event, folderPath) => {
  try {
    const data = await findKitabByFolder(folderPath)
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Create a new kitab
ipcMain.handle('create-kitab', async (_event, payload) => {
  try {
    const res = await createKitab(payload || {})
    return { ok: true, ...res }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// List .txt files in a directory
ipcMain.handle('list-txt-files', async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: 'Folder path required.' }
    if (!fs.existsSync(dirPath)) return { ok: false, error: 'Folder not found.' }
    // First pass: top-level .txt files only (fast)
    let files = []
    try {
      const dirents = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const d of dirents) {
        if (d.isFile() && d.name.toLowerCase().endsWith('.txt')) {
          files.push(path.join(dirPath, d.name))
        }
      }
    } catch (_) {}

    // If none found, do a limited recursive search to discover files in common subfolders
    if (files.length === 0) {
      const stack = [{ p: dirPath, depth: 0 }]
      const maxDepth = 3
      while (stack.length > 0) {
        const { p, depth } = stack.pop()
        let dirents
        try {
          dirents = fs.readdirSync(p, { withFileTypes: true })
        } catch (_) {
          continue
        }
        for (const d of dirents) {
          const fp = path.join(p, d.name)
          if (d.isDirectory()) {
            if (depth < maxDepth) stack.push({ p: fp, depth: depth + 1 })
          } else if (d.isFile() && d.name.toLowerCase().endsWith('.txt')) {
            files.push(fp)
          }
        }
        // Short-circuit if we already found some files
        if (files.length > 0) break
      }
    }
    return { ok: true, files }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// List image files in a directory
ipcMain.handle('list-image-files', async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: 'Folder path required.' }
    if (!fs.existsSync(dirPath)) return { ok: false, error: 'Folder not found.' }
    const files = listAllImages(dirPath)
    return { ok: true, files }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Translate text using OpenAI ChatGPT
ipcMain.handle('translate-chatgpt', async (_event, payload) => {
  const { apiKey, text, target = 'en', model = 'gpt-4o-mini' } = payload || {}
  if (!apiKey) return { ok: false, error: 'OpenAI API key is required.' }
  if (!text) return { ok: false, error: 'Input text is empty.' }
  try {
    const sysPrompt = 'You are a professional translator. Preserve meaning, line breaks, and basic formatting. Return plain text.'
    const userPrompt = `Translate the following text into ${target}. Keep original line breaks.\n\n${text}`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2
      })
    })
    const data = await resp.json()
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || resp.statusText
      return { ok: false, error: msg }
    }
    const out = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
    return { ok: true, output: out }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('get-settings', async () => {
  return readSettings()
})

ipcMain.handle('save-settings', async (_event, partial) => {
  const saved = writeSettings(partial || {})
  return { ok: true, settings: saved }
})

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function listJpgFiles(dir) {
  const files = fs.readdirSync(dir)
  return files
    .filter(f => /\.(jpe?g|png)$/i.test(f))
    .map(f => path.join(dir, f))
}

function baseNameNoExt(filePath) {
  return path.parse(filePath).name
}

function sortNumericByBaseName(files) {
  return files.sort((a, b) => {
    const na = parseInt(baseNameNoExt(a), 10)
    const nb = parseInt(baseNameNoExt(b), 10)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
}

ipcMain.handle('run-ocr', async (_event, payload) => {
  const { inputFolder, outputFolder, tesseractPath, lang } = payload
  if (!inputFolder || !outputFolder || !tesseractPath) {
    return { ok: false, error: 'Input, output, and tesseract path are required.' }
  }
  if (!fs.existsSync(inputFolder)) return { ok: false, error: 'Input folder not found.' }
  if (!fs.existsSync(tesseractPath)) return { ok: false, error: 'Tesseract path not found.' }
  ensureDir(outputFolder)

  const jpgFiles = sortNumericByBaseName(listJpgFiles(inputFolder))
  if (jpgFiles.length === 0) return { ok: false, error: 'No .jpg or .png files found in input folder.' }

  // Initialize global OCR state so navigation can restore progress
  ocrState = { running: true, total: jpgFiles.length, completed: 0, lastFile: null }
  let completed = 0
  for (const file of jpgFiles) {
    const outBase = path.join(outputFolder, baseNameNoExt(file))
    await new Promise((resolve, reject) => {
      // Use more robust defaults for complex Arabic pages
      const args = [
        file,
        outBase,
        '-l', lang || 'ara',
        '--psm', '6',           // Assume a single uniform block of text
        '--oem', '1',           // LSTM-only engine
        '-c', 'preserve_interword_spaces=1'
      ]
      const proc = spawn(tesseractPath, args, { shell: false })
      let err = ''
      proc.stderr.on('data', d => { err += d.toString() })
      proc.on('exit', code => {
        completed += 1
        ocrState = { running: true, total: jpgFiles.length, completed, lastFile: path.basename(file) }
        mainWindow.webContents.send('ocr-progress', {
          file: path.basename(file),
          index: completed,
          total: jpgFiles.length,
          ok: code === 0,
          error: code === 0 ? null : err || `Exit code ${code}`
        })
        code === 0 ? resolve() : reject(new Error(err || `tesseract exited with code ${code}`))
      })
    }).catch(err => {
      // Continue on error but report it
      mainWindow.webContents.send('ocr-progress', {
        file: path.basename(file),
        index: completed,
        total: jpgFiles.length,
        ok: false,
        error: err.message
      })
    })
  }

  mainWindow.webContents.send('ocr-complete', { total: jpgFiles.length })
  ocrState.running = false
  return { ok: true }
})

ipcMain.handle('join-text', async (_event, payload) => {
  const { textFolder } = payload
  if (!textFolder) return { ok: false, error: 'Text folder required.' }
  if (!fs.existsSync(textFolder)) return { ok: false, error: 'Text folder not found.' }

  const files = fs.readdirSync(textFolder).filter(f => f.toLowerCase().endsWith('.txt')).map(f => path.join(textFolder, f))
  if (files.length === 0) return { ok: false, error: 'No .txt files found.' }
  const sorted = sortNumericByBaseName(files)

  const outPath = path.join(textFolder, 'all_pages.txt')
  const headerStart = '***** MULAI GABUNGAN TEKS *****\n\n'
  const headerEnd = '\n***** SELESAI *****\n'
  let content = headerStart
  for (const f of sorted) {
    const base = baseNameNoExt(f)
    content += `[===== ${base} =====]\n`
    content += fs.readFileSync(f, 'utf-8')
    content += '\n\n'
  }
  content += headerEnd
  fs.writeFileSync(outPath, content, 'utf-8')
  return { ok: true, output: outPath }
})

function listGeneratedImages(dir, baseName) {
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir)
  return files
    .filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'))
    .filter(f => f.startsWith(baseName + '-') || f.startsWith(baseName + '_') || f.startsWith(baseName))
    .map(f => path.join(dir, f))
    .sort()
}

function listAllImages(dir) {
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir)
  return files
    .filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'))
    .map(f => path.join(dir, f))
}

function extractTrailingNumber(filePath) {
  const base = path.parse(filePath).name
  const m = base.match(/(\d+)$/)
  return m ? parseInt(m[1], 10) : NaN
}

function renameFilesToNumeric(files) {
  if (!files || files.length === 0) return []
  const dir = path.dirname(files[0])
  const sorted = [...files].sort((a, b) => {
    const na = extractTrailingNumber(a)
    const nb = extractTrailingNumber(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
  const result = []
  let n = 1
  for (const src of sorted) {
    const ext = path.extname(src).toLowerCase() || '.jpg'
    let candidate
    // Find next available number to avoid overwriting existing files
    while (true) {
      candidate = path.join(dir, String(n).padStart(3, '0') + ext)
      if (!fs.existsSync(candidate)) break
      n += 1
    }
    try {
      fs.renameSync(src, candidate)
      result.push(candidate)
      n += 1
    } catch (e) {
      // If rename fails, keep original path in the list
      result.push(src)
    }
  }
  return result
}

async function convertWithMagick(pdfPath, outputFolder, density = 200, quality = 90, magickPath) {
  const base = path.parse(pdfPath).name
  ensureDir(outputFolder)
  const outPattern = path.join(outputFolder, `${base}-%03d.jpg`)
  // Try provided path or command name
  const candidate = magickPath || 'magick'
  const gs = findGhostscriptExe()
  const extraPath = gs ? [path.dirname(gs)] : []
  let res = await spawnTool(candidate, ['-density', String(density), pdfPath, '-quality', String(quality), outPattern], { extraPath })
  if (res.code === 0) {
    const generated = listGeneratedImages(outputFolder, base)
    const renamed = renameFilesToNumeric(generated)
    return { ok: true, files: renamed }
  }
  // If ENOENT or failure, attempt to locate
  const loc = findMagickExe()
  if (loc) {
    res = await spawnTool(loc, ['-density', String(density), pdfPath, '-quality', String(quality), outPattern], { extraPath })
    if (res.code === 0) {
      const generated = listGeneratedImages(outputFolder, base)
      const renamed = renameFilesToNumeric(generated)
      return { ok: true, files: renamed }
    }
  }
  return { ok: false, error: res.err || 'magick not found' }
}

async function convertWithPdftoppm(pdfPath, outputFolder, density = 200, pdftoppmPath) {
  const base = path.parse(pdfPath).name
  ensureDir(outputFolder)
  const outBase = path.join(outputFolder, base)
  const candidate = pdftoppmPath || 'pdftoppm'
  let res = await spawnTool(candidate, ['-jpeg', '-r', String(density), pdfPath, outBase])
  if (res.code === 0) {
    const generated = listGeneratedImages(outputFolder, base)
    const renamed = renameFilesToNumeric(generated)
    return { ok: true, files: renamed }
  }
  // Attempt to locate
  const loc = findPdftoppmExe()
  if (loc) {
    res = await spawnTool(loc, ['-jpeg', '-r', String(density), pdfPath, outBase])
    if (res.code === 0) {
      const generated = listGeneratedImages(outputFolder, base)
      const renamed = renameFilesToNumeric(generated)
      return { ok: true, files: renamed }
    }
  }
  return { ok: false, error: res.err || 'pdftoppm not found' }
}

ipcMain.handle('convert-pdf', async (_event, payload) => {
  const { pdfPath, outputFolder, density = 200, quality = 90, magickPath, pdftoppmPath } = payload || {}
  if (!pdfPath || !outputFolder) return { ok: false, error: 'PDF path dan output folder diperlukan.' }
  if (!fs.existsSync(pdfPath)) return { ok: false, error: 'File PDF tidak ditemukan.' }
  ensureDir(outputFolder)

  // Try ImageMagick first, then pdftoppm
  let res = await convertWithMagick(pdfPath, outputFolder, density, quality, magickPath)
  if (!res.ok) {
    const fallback = await convertWithPdftoppm(pdfPath, outputFolder, density, pdftoppmPath)
    if (fallback.ok) return fallback
    return { ok: false, error: `Converter tidak ditemukan atau gagal berjalan. Coba install ImageMagick atau Poppler. Detail: magick: ${res.error}; pdftoppm: ${fallback.error}` }
  }
  return res
})

ipcMain.handle('get-defaults', () => {
  const s = readSettings()
  return {
    inputFolder: 'E:\\BOOK\\scanned_syarah_dalail\\1-50',
    outputFolder: 'E:\\BOOK\\scanned_syarah_dalail\\text',
    tesseractPath: s.tesseractPath || 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    lang: s.lang || 'ara',
    ocrEngine: s.ocrEngine || 'tesseract'
  }
})
function tryPaths(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function findMagickExe() {
  const s = readSettings()
  const envHome = process.env.MAGICK_HOME
  const candidates = []
  if (s.magickPath) candidates.push(s.magickPath)
  if (envHome) candidates.push(path.join(envHome, 'magick.exe'))
  candidates.push('C:\\Windows\\System32\\magick.exe')
  // Scan common install dirs
  const roots = ['C:\\Program Files', 'C:\\Program Files (x86)']
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const dirs = fs.readdirSync(root).filter(d => d.toLowerCase().startsWith('imagemagick'))
    dirs.sort().reverse()
    for (const d of dirs) {
      candidates.push(path.join(root, d, 'magick.exe'))
    }
  }
  return tryPaths(candidates)
}

function findPdftoppmExe() {
  const s = readSettings()
  const envHome = process.env.POPPLER_HOME
  const candidates = []
  if (s.pdftoppmPath) candidates.push(s.pdftoppmPath)
  if (envHome) candidates.push(path.join(envHome, 'bin', 'pdftoppm.exe'))
  candidates.push('C:\\ProgramData\\chocolatey\\bin\\pdftoppm.exe')
  // Scan common install dirs
  const roots = ['C:\\Program Files', 'C:\\Program Files (x86)']
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const dirs = fs.readdirSync(root).filter(d => d.toLowerCase().startsWith('poppler'))
    dirs.sort().reverse()
    for (const d of dirs) {
      candidates.push(path.join(root, d, 'bin', 'pdftoppm.exe'))
    }
  }
  return tryPaths(candidates)
}

function findGhostscriptExe() {
  const s = readSettings()
  const candidates = []
  if (s.ghostscriptPath) candidates.push(s.ghostscriptPath)
  const envGS = process.env.GHOSTSCRIPT_HOME || process.env.GS_HOME
  if (envGS) {
    candidates.push(path.join(envGS, 'bin', 'gswin64c.exe'))
    candidates.push(path.join(envGS, 'bin', 'gswin32c.exe'))
  }
  candidates.push('C:\\Windows\\System32\\gswin64c.exe')
  candidates.push('C:\\Windows\\System32\\gswin32c.exe')
  // Common installs under C:\Program Files\gs\gsX.YY.Z\bin
  const roots = ['C:\\Program Files', 'C:\\Program Files (x86)']
  for (const root of roots) {
    const gsRoot = path.join(root, 'gs')
    if (!fs.existsSync(gsRoot)) continue
    const dirs = fs.readdirSync(gsRoot).filter(d => d.toLowerCase().startsWith('gs'))
    dirs.sort().reverse()
    for (const d of dirs) {
      candidates.push(path.join(gsRoot, d, 'bin', 'gswin64c.exe'))
      candidates.push(path.join(gsRoot, d, 'bin', 'gswin32c.exe'))
    }
  }
  // Chocolatey common bin
  candidates.push('C:\\ProgramData\\chocolatey\\bin\\gswin64c.exe')
  candidates.push('C:\\ProgramData\\chocolatey\\bin\\gswin32c.exe')
  return tryPaths(candidates)
}

function spawnTool(cmd, args, options = {}) {
  return new Promise((resolve) => {
    try {
      const env = { ...process.env }
      if (options.extraPath && Array.isArray(options.extraPath) && options.extraPath.length > 0) {
        const extra = options.extraPath.filter(Boolean).join(';')
        env.PATH = env.PATH ? `${env.PATH};${extra}` : extra
      }
      const proc = spawn(cmd, args, { env })
      let err = ''
      proc.stderr.on('data', d => { err += d.toString() })
      proc.on('exit', code => {
        resolve({ code, err })
      })
      proc.on('error', e => resolve({ code: -1, err: e.message }))
    } catch (e) {
      resolve({ code: -1, err: e.message })
    }
  })
}

function findPythonExe() {
  const s = readSettings()
  const candidates = []
  if (s.pythonPath) candidates.push(s.pythonPath)
  // Prefer local venv inside the Arabic-Handwritten-OCR engine if present
  candidates.push(path.join(process.cwd(), 'engines', 'Arabic-Handwritten-OCR', '.venv', 'Scripts', 'python.exe'))
  candidates.push('python')
  candidates.push('py')
  return tryPaths(candidates) || 'python'
}

// Engine-aware Python discovery to avoid importing wrong site-packages
function findPythonExeForEngine(engine) {
  const s = readSettings()
  const candidates = []
  if (s.pythonPath) candidates.push(s.pythonPath)
  if (engine === 'arabic_dl') {
    candidates.push(path.join(process.cwd(), 'engines', 'Arabic-Handwritten-OCR', '.venv', 'Scripts', 'python.exe'))
  } else if (engine === 'easyocr') {
    candidates.push(path.join(process.cwd(), 'engines', 'EasyOCR', '.venv', 'Scripts', 'python.exe'))
  }
  // Removed PaddleOCR venv preference
  // Fallbacks: try other venvs then system
  candidates.push(path.join(process.cwd(), 'engines', 'Arabic-Handwritten-OCR', '.venv', 'Scripts', 'python.exe'))
  // Removed PaddleOCR venv fallback
  candidates.push('python')
  candidates.push('py')
  return tryPaths(candidates) || 'python'
}

ipcMain.handle('run-ocr-dl', async (_event, payload) => {
  const { inputFolder, outputFolder, lang } = payload || {}
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: 'Input and output folder are required.' }
  }
  if (!fs.existsSync(inputFolder)) return { ok: false, error: 'Input folder not found.' }
  ensureDir(outputFolder)

  const scriptPath = path.join(process.cwd(), 'engines', 'run_arabic_dl.py')
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'Arabic DL engine wrapper not found at engines/run_arabic_dl.py' }
  }

  const pythonExe = findPythonExeForEngine('arabic_dl')
  const args = [scriptPath, '--input', inputFolder, '--output', outputFolder, '--lang', lang || 'ara']
  const s = readSettings()
  if (s && s.tesseractPath) {
    args.push('--tesseract-path', s.tesseractPath)
  }
  let total = 0
  let completed = 0

  ocrState = { running: true, total: 0, completed: 0, lastFile: null }
  return await new Promise((resolve) => {
    const proc = spawn(pythonExe, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    let err = ''
    proc.stdout.on('data', (d) => {
      const line = d.toString().trim()
      if (line.startsWith('PROGRESS ')) {
        const parts = line.split(' ')
        const file = parts[1]
        completed = parseInt(parts[2], 10) || completed
        total = parseInt(parts[3], 10) || total
        ocrState = { running: true, total, completed, lastFile: file }
        mainWindow?.webContents?.send('ocr-progress', {
          file,
          index: completed,
          total,
          ok: true,
          error: null
        })
      } else if (line.startsWith('TOTAL ')) {
        total = parseInt(line.split(' ')[1], 10) || total
        ocrState.total = total
      }
    })
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('exit', (code) => {
      mainWindow?.webContents?.send('ocr-complete', { total })
      ocrState.running = false
      if (code === 0) {
        resolve({ ok: true, total })
      } else {
        resolve({ ok: false, error: err || `Arabic DL engine exited with code ${code}` })
      }
  })
  proc.on('error', (e) => {
    ocrState.running = false
    resolve({ ok: false, error: e.message })
  })
  })
})

// EasyOCR handler
// EasyOCR handler
ipcMain.handle('run-ocr-easy', async (_event, payload) => {
  const { inputFolder, outputFolder, lang } = payload || {}
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: 'Input and output folder are required.' }
  }
  if (!fs.existsSync(inputFolder)) return { ok: false, error: 'Input folder not found.' }
  ensureDir(outputFolder)

  const scriptPath = path.join(process.cwd(), 'engines', 'run_easyocr.py')
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'EasyOCR engine wrapper not found at engines/run_easyocr.py' }
  }

  const pythonExe = findPythonExeForEngine('easyocr')
  const args = [scriptPath, '--input', inputFolder, '--output', outputFolder, '--lang', lang || 'ara']
  let total = 0
  let completed = 0

  ocrState = { running: true, total: 0, completed: 0, lastFile: null }
  return await new Promise((resolve) => {
    const proc = spawn(pythonExe, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    let err = ''
    proc.stdout.on('data', (d) => {
      const line = d.toString().trim()
      if (line.startsWith('PROGRESS ')) {
        const parts = line.split(' ')
        const file = parts[1]
        completed = parseInt(parts[2], 10) || completed
        total = parseInt(parts[3], 10) || total
        ocrState = { running: true, total, completed, lastFile: file }
        mainWindow?.webContents?.send('ocr-progress', {
          file,
          index: completed,
          total,
          ok: true,
          error: null
        })
      } else if (line.startsWith('TOTAL ')) {
        total = parseInt(line.split(' ')[1], 10) || total
        ocrState.total = total
      }
    })
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('exit', (code) => {
      mainWindow?.webContents?.send('ocr-complete', { total })
      ocrState.running = false
      if (code === 0) {
        resolve({ ok: true, total })
      } else {
        resolve({ ok: false, error: err || `EasyOCR engine exited with code ${code}` })
      }
    })
    proc.on('error', (e) => {
      ocrState.running = false
      resolve({ ok: false, error: e.message })
    })
  })
})

// OCR status for restoring UI after navigation
ipcMain.handle('get-ocr-status', async () => {
  return { ...ocrState }
})
// Removed: PaddleOCR handler