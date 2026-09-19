import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { Form, Button, InputGroup, ListGroup, Row, Col, Alert, Accordion, Modal, ProgressBar } from 'react-bootstrap'

const normalizeFsPath = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '')

const chooseMatchingImage = (images, txtFile) => {
  if (!images || images.length === 0 || !txtFile) return ''
  const base = (txtFile.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '')
  const m = base.match(/(\d+)$/)
  const n = m ? parseInt(m[1], 10) : NaN
  if (!Number.isNaN(n)) {
    const byNum = images.find((p) => {
      const bn = (p.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '')
      const mm = bn.match(/(\d+)$/)
      const nn = mm ? parseInt(mm[1], 10) : NaN
      return !Number.isNaN(nn) && nn === n
    })
    if (byNum) return byNum
  }
  const byBase = images.find((p) => (p.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '') === base)
  return byBase || ''
}

export default function TranslatePage({ initialFolder = '', initialFile = '', onOpenSplit }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [folder, setFolder] = useState('')
  const [imageFolder, setImageFolder] = useState('')
  const [files, setFiles] = useState([])
  const [checkedPaths, setCheckedPaths] = useState([])
  const [selected, setSelected] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [target, setTarget] = useState('en')
  const [result, setResult] = useState('')
  const [original, setOriginal] = useState('')
  const [dbTranslation, setDbTranslation] = useState('')
  const [dbMeta, setDbMeta] = useState(null)
  const [localInput, setLocalInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState({ index: 0, total: 0 })
  const [ocrEngine, setOcrEngine] = useState('tesseract')
  const [ocrLayoutMode, setOcrLayoutMode] = useState('box_notes')
  const [ocrBoxPaddingPct, setOcrBoxPaddingPct] = useState(0.01)
  const [ocrNotePaddingPct, setOcrNotePaddingPct] = useState(0.01)
  const [ocrOutsideFormat, setOcrOutsideFormat] = useState('flat')
  const [openAiModel, setOpenAiModel] = useState('gpt-4o-mini')
  const [activeFile, setActiveFile] = useState('')
  const [showLocal, setShowLocal] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showCreateKitab, setShowCreateKitab] = useState(false)
  const [newKitab, setNewKitab] = useState({ nama_kitab: '', pengarang: '', keterangan: '', folder_path: '' })
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerText, setViewerText] = useState('')
  const [viewerPath, setViewerPath] = useState('')
  const [viewInfoShown, setViewInfoShown] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [currentMatch, setCurrentMatch] = useState(0)
  const [showSearch, setShowSearch] = useState(true)
  const viewerRef = useRef(null)
  const currentRef = useRef(null)
  const searchInputRef = useRef(null)
  const activeFileRef = useRef('')
  const folderRef = useRef('')
  const ocrJobActiveRef = useRef(false)

  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile])

  useEffect(() => {
    folderRef.current = folder
  }, [folder])

  useEffect(() => {
    // Default blank; only use initialFolder if provided
    const nextFolder = initialFolder || ''
    setFolder(nextFolder)
    if (api && nextFolder) {
      checkKitabForFolder(nextFolder)
    }
  }, [initialFolder])

  useEffect(() => {
    if (!api?.getDefaults) return
    api.getDefaults().then((def) => {
      if (!def) return
      if (def.ocrEngine) setOcrEngine(def.ocrEngine)
      setOcrLayoutMode(def.ocrLayoutMode || 'box_notes')
      if (def.ocrBoxPaddingPct != null) {
        const n = Number(def.ocrBoxPaddingPct)
        setOcrBoxPaddingPct(Number.isFinite(n) ? n : 0.01)
      }
      if (def.ocrNotePaddingPct != null) {
        const n = Number(def.ocrNotePaddingPct)
        setOcrNotePaddingPct(Number.isFinite(n) ? n : 0.01)
      }
      if (def.ocrOutsideFormat) setOcrOutsideFormat(def.ocrOutsideFormat)
      if (def.openAiModel) setOpenAiModel(def.openAiModel)
    }).catch(() => {})
  }, [api])

  const handleEngineChange = async (e) => {
    const val = e.target.value
    setOcrEngine(val)
    if (api?.saveSettings) await api.saveSettings({ ocrEngine: val })
  }

  const handleLayoutModeChange = async (e) => {
    const val = e.target.value
    setOcrLayoutMode(val)
    if (api?.saveSettings) await api.saveSettings({ ocrLayoutMode: val })
  }

  useEffect(() => {
    if (!api) return undefined
    let offProgress
    let offComplete
    if (api.onOcrProgress) {
      offProgress = api.onOcrProgress((p) => {
        if (!ocrJobActiveRef.current) return
        setOcrProgress({ index: p.index, total: p.total })
        setLogs((prev) => [{
          type: p.ok ? 'info' : 'error',
          text: `Re-OCR ${p.ok ? 'OK' : 'ERR'}: ${p.file}${p.error ? ' - ' + p.error : ''}`
        }, ...prev])
      })
    }
    if (api.onOcrComplete) {
      offComplete = api.onOcrComplete(async (p) => {
        if (!ocrJobActiveRef.current) return
        ocrJobActiveRef.current = false
        setOcrRunning(false)
        setLogs((prev) => [{ type: 'info', text: `Re-OCR selesai. Total: ${p.total}` }, ...prev])
        const dir = folderRef.current
        if (dir) {
          await refreshFiles(dir)
          const current = activeFileRef.current
          if (current) await openFileContent(current)
        }
      })
    }
    return () => {
      try { offProgress && offProgress() } catch (_) {}
      try { offComplete && offComplete() } catch (_) {}
    }
  }, [api])

  const resolveImageFolder = async (textFolder) => {
    if (!api || !textFolder) return ''
    const normText = normalizeFsPath(textFolder).toLowerCase()

    try {
      if (api.getKitabDetailByFolder) {
        const res = await api.getKitabDetailByFolder(textFolder)
        const details = res?.ok ? (res.data?.folders_detail || []) : []
        const exact = details.find((p) => normalizeFsPath(p.folder_path).toLowerCase() === normText)
        if (exact?.image_folder_path) return exact.image_folder_path
        const loose = details.find((p) => {
          const fp = normalizeFsPath(p.folder_path).toLowerCase()
          return fp && (normText.startsWith(fp + '\\') || fp.startsWith(normText))
        })
        if (loose?.image_folder_path) return loose.image_folder_path
      }
    } catch (_) {}

    const parent = normalizeFsPath(textFolder).split('\\').slice(0, -1).join('\\')
    const candidates = [
      parent ? `${parent}\\images` : '',
      textFolder
    ].filter(Boolean)

    for (const dir of candidates) {
      try {
        const li = await api.listImageFiles(dir)
        if (li?.ok && Array.isArray(li.files) && li.files.length > 0) return dir
      } catch (_) {}
    }
    return ''
  }

  const pickFolder = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(folder)
    if (dir) {
      setFolder(dir)
      await checkKitabForFolder(dir)
    }
  }

  const refreshFiles = async (dir) => {
    if (!api || !api.listTxtFiles) {
      setLogs(prev => [{ type: 'error', text: 'List teks hanya tersedia di Electron.' }, ...prev])
      return
    }
    const res = await api.listTxtFiles(dir)
    if (res && res.ok) {
      const list = res.files || []
      const sorted = [...list].sort((a, b) => {
        const ra = a.replace(dir + '\\', '')
        const rb = b.replace(dir + '\\', '')
        const ba = ra.replace(/\.[^.]+$/, '')
        const bb = rb.replace(/\.[^.]+$/, '')
        const ma = ba.match(/(\d+)$/)
        const mb = bb.match(/(\d+)$/)
        const na = ma ? parseInt(ma[1], 10) : NaN
        const nb = mb ? parseInt(mb[1], 10) : NaN
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
        return ba.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
      })
      setFiles(sorted)
      setCheckedPaths(prev => prev.filter(p => sorted.includes(p)))
      if (sorted.length > 0) {
        const preferredFile = initialFile && sorted.includes(initialFile) ? initialFile : sorted[0]
        setSelected(preferredFile)
        await openFileContent(preferredFile)
      }
    } else {
      setFiles([])
      setCheckedPaths([])
      setLogs(prev => [{ type: 'error', text: res?.error || 'Gagal membaca folder.' }, ...prev])
    }
  }

  const getPageFiles = (list = files) => (
    (list || []).filter((txtPath) => {
      const name = (txtPath.split(/[/\\]/).pop() || '').toLowerCase()
      return name && name !== 'all_pages.txt'
    })
  )

  const toggleCheckedPath = (path, e) => {
    e?.stopPropagation?.()
    setCheckedPaths((prev) => (
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    ))
  }

  const toggleSelectAllForOcr = () => {
    const pageFiles = getPageFiles()
    if (pageFiles.length === 0) return
    const allSelected = pageFiles.every((p) => checkedPaths.includes(p))
    setCheckedPaths(allSelected ? [] : pageFiles)
  }

  const openFileContent = async (filePath) => {
    if (!api) {
      setLogs(prev => [{ type: 'error', text: 'Buka file hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!filePath) return
    try {
      const fileRes = await api.readFile(filePath)
      if (!fileRes || !fileRes.ok) throw new Error(fileRes?.error || 'Gagal membaca file input.')
      const content = fileRes.content || ''
      setOriginal(content)
      setResult(content)
      setDbTranslation('')
      setDbMeta(null)
      setLocalInput('')
      setActiveFile(filePath)
    } catch (e) {
      setLogs(prev => [{ type: 'error', text: e.message || 'Gagal membuka file.' }, ...prev])
    }
  }

  const joinText = async () => {
    if (!api || !api.joinText) {
      setLogs(prev => [{ type: 'error', text: 'Gabung teks hanya tersedia di Electron.' }, ...prev])
      return
    }
    const res = await api.joinText({ textFolder: folder })
    if (res && res.ok) {
      setLogs(prev => [{ type: 'info', text: `Teks tergabung: ${res.output}` }, ...prev])
      setViewerPath(res.output || `${folder}\\all_pages.txt`)
    } else {
      setLogs(prev => [{ type: 'error', text: `Gagal gabung: ${res?.error || 'Tidak diketahui'}` }, ...prev])
    }
  }

  const viewMergedFile = async () => {
    if (!api || !api.readFile) {
      setLogs(prev => [{ type: 'error', text: 'View file hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!folder) {
      setLogs(prev => [{ type: 'error', text: 'Folder belum dipilih.' }, ...prev])
      return
    }
    const filePath = `${folder}\\all_pages.txt`
    try {
      const res = await api.readFile(filePath)
      if (res && res.ok) {
        setViewerText(res.content || '')
        setViewerPath(filePath)
        setViewerOpen(true)
        if (!viewInfoShown) {
          setLogs(prev => [{ type: 'info', text: `Menampilkan file: ${filePath}` }, ...prev])
          setViewInfoShown(true)
        }
      } else {
        const err = (res && res.error) || 'File tidak ditemukan atau gagal dibuka.'
        setLogs(prev => [{ type: 'error', text: err }, ...prev])
      }
    } catch (e) {
      const errMsg = e?.message || 'IPC read-file gagal dipanggil.'
      setLogs(prev => [{ type: 'error', text: errMsg }, ...prev])
    }
  }

  const runSelectedOcrFiles = async (targets, layoutPayload, defaults) => {
    let done = 0
    let failed = 0
    for (const t of targets) {
      const res = ocrEngine === 'openai'
        ? await api.runOcrOpenAi({
          imagePath: t.imagePath,
          txtPath: t.txtPath,
          model: openAiModel || defaults.openAiModel || 'gpt-4o-mini',
          ...layoutPayload
        })
        : await api.runOcrFile({
          imagePath: t.imagePath,
          txtPath: t.txtPath,
          engine: ocrEngine,
          ...layoutPayload
        })
      done += 1
      if (!res?.ok) failed += 1
      setOcrProgress({ index: done, total: targets.length })
      setLogs(prev => [{
        type: res?.ok ? 'info' : 'error',
        text: `Re-OCR ${res?.ok ? 'OK' : 'ERR'}: ${(t.txtPath.split(/[/\\]/).pop() || t.txtPath)}${res?.error ? ' - ' + res.error : ''}`
      }, ...prev])
    }
    ocrJobActiveRef.current = false
    setOcrRunning(false)
    setLogs(prev => [{ type: 'info', text: `Re-OCR selesai. Total: ${targets.length}${failed ? `, gagal: ${failed}` : ''}` }, ...prev])
    await refreshFiles(folder)
    if (activeFileRef.current) await openFileContent(activeFileRef.current)
  }

  const reOcrFolder = async () => {
    if (!api) {
      setLogs(prev => [{ type: 'error', text: 'Re-OCR hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!folder) {
      setLogs(prev => [{ type: 'error', text: 'Folder teks belum dipilih.' }, ...prev])
      return
    }
    if (ocrRunning) return

    let imgDir = imageFolder || await resolveImageFolder(folder)
    if (!imgDir) {
      setLogs(prev => [{ type: 'error', text: 'Folder gambar tidak ditemukan. Pair folder gambar di detail kitab, atau letakkan gambar di sibling folder images / folder teks yang sama.' }, ...prev])
      return
    }
    setImageFolder(imgDir)

    const li = await api.listImageFiles(imgDir)
    const images = li?.ok ? (li.files || []) : []
    if (!images.length) {
      setLogs(prev => [{ type: 'error', text: `Tidak ada gambar di folder: ${imgDir}` }, ...prev])
      return
    }

    const allPageFiles = getPageFiles(files.length > 0 ? files : ((await api.listTxtFiles(folder))?.files || []))
    const selectedPageFiles = allPageFiles.filter((p) => checkedPaths.includes(p))
    const useSelectedOnly = selectedPageFiles.length > 0
    const sourceFiles = useSelectedOnly ? selectedPageFiles : allPageFiles
    const targets = sourceFiles
      .map((txtPath) => ({ txtPath, imagePath: chooseMatchingImage(images, txtPath) }))
      .filter((t) => t.imagePath)

    if (targets.length === 0) {
      setLogs(prev => [{ type: 'error', text: useSelectedOnly
        ? 'File yang dipilih tidak punya pasangan gambar.'
        : 'Tidak ada pasangan gambar untuk file .txt di folder ini.' }, ...prev])
      return
    }

    const layoutLabel = ocrLayoutMode === 'box_notes' ? 'Inside Box + Outside' : 'Full Page'
    const scopeLabel = useSelectedOnly
      ? `${targets.length} file terpilih`
      : `semua file (${targets.length} pasangan)`
    const ok = window.confirm(
      `Re-OCR ${scopeLabel}?\n\nGambar: ${imgDir}\nTeks: ${folder}\nEngine: ${ocrEngine}\nLayout: ${layoutLabel}\n\nFile .txt hasil OCR akan ditimpa.`
    )
    if (!ok) return

    ocrJobActiveRef.current = true
    setOcrRunning(true)
    setOcrProgress({ index: 0, total: targets.length })
    setLogs(prev => [{ type: 'info', text: `Mulai Re-OCR (${ocrEngine}, ${layoutLabel}) — ${scopeLabel}...` }, ...prev])

    try {
      let defaults = {}
      try { defaults = (await api.getDefaults?.()) || {} } catch (_) {}
      const lang = defaults.lang || 'ara'
      const tesseractPath = defaults.tesseractPath || ''
      const layoutPayload = {
        layoutMode: ocrLayoutMode,
        boxPaddingPct: ocrBoxPaddingPct,
        notePaddingPct: ocrNotePaddingPct,
        outsideFormat: ocrLayoutMode === 'box_notes' ? 'flat' : ocrOutsideFormat
      }

      // File terpilih / OpenAI → per-file. Tanpa pilihan → batch all folder.
      if (useSelectedOnly || ocrEngine === 'openai') {
        await runSelectedOcrFiles(targets, layoutPayload, defaults)
        return
      }

      let res
      if (ocrEngine === 'arabic_dl') {
        res = await api.runOCRDL({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'easyocr') {
        res = await api.runOCREasy({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'kraken' || ocrEngine === 'kraken_arabic') {
        res = await api.runOCRKraken({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'google_vision') {
        res = await api.runOCRVision({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'unlimited_ocr') {
        res = await api.runOCRUnlimited({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else {
        res = await api.runOCR({ inputFolder: imgDir, outputFolder: folder, tesseractPath, lang, ...layoutPayload })
      }

      if (!res || !res.ok) {
        ocrJobActiveRef.current = false
        setOcrRunning(false)
        setLogs(prev => [{ type: 'error', text: `Gagal Re-OCR: ${res?.error || 'Unknown error'}` }, ...prev])
      } else if (ocrJobActiveRef.current) {
        // Fallback jika event ocr-complete terlewat
        ocrJobActiveRef.current = false
        setOcrRunning(false)
        setLogs(prev => [{ type: 'info', text: 'Re-OCR selesai.' }, ...prev])
        await refreshFiles(folder)
        if (activeFileRef.current) await openFileContent(activeFileRef.current)
      }
    } catch (e) {
      ocrJobActiveRef.current = false
      setOcrRunning(false)
      setLogs(prev => [{ type: 'error', text: `Gagal Re-OCR: ${e?.message || String(e)}` }, ...prev])
    }
  }

  useEffect(() => {
    if (!query) { setMatches([]); setCurrentMatch(0); return }
    try {
      const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(esc, 'gi')
      const pos = []
      let m
      while ((m = re.exec(viewerText)) !== null) {
        pos.push({ start: m.index, end: m.index + m[0].length })
      }
      setMatches(pos)
      setCurrentMatch(pos.length ? 0 : 0)
    } catch (_) {
      setMatches([])
    }
  }, [query, viewerText])

  const scrollToCurrent = () => {
    if (!viewerOpen) return
    const container = viewerRef.current
    let el = currentRef.current
    if (!el && container) {
      el = container.querySelector(`#match-${currentMatch}`)
    }
    if (el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (_) {}
      try { el.focus() } catch (_) {}
    }
  }

  useLayoutEffect(() => {
    scrollToCurrent()
  }, [currentMatch, viewerOpen, query])

  const goNext = () => {
    if (matches.length === 0) return
    setCurrentMatch(i => (i + 1) % matches.length)
    if (matches.length === 1) setTimeout(scrollToCurrent, 0)
  }
  const goPrev = () => {
    if (matches.length === 0) return
    setCurrentMatch(i => (i - 1 + matches.length) % matches.length)
    if (matches.length === 1) setTimeout(scrollToCurrent, 0)
  }

  const renderHighlighted = () => {
    if (!query || matches.length === 0) return (<div className="mb-0">{viewerText}</div>)
    const nodes = []
    let last = 0
    matches.forEach((m, idx) => {
      if (last < m.start) nodes.push(<span key={`t-${idx}`}>{viewerText.slice(last, m.start)}</span>)
      const isCurrent = idx === currentMatch
      nodes.push(
        <mark id={`match-${idx}`} key={`m-${idx}`} ref={isCurrent ? currentRef : null} className={isCurrent ? 'match-current' : ''} tabIndex={isCurrent ? -1 : undefined}>
          {viewerText.slice(m.start, m.end)}
        </mark>
      )
      last = m.end
    })
    if (last < viewerText.length) nodes.push(<span key={`t-end`}>{viewerText.slice(last)}</span>)
    return (<div className="mb-0">{nodes}</div>)
  }

  // Load DB translation when Local Translate panel opens
  useEffect(() => {
    const loadDb = async () => {
      if (!api || !showLocal || !original) return
      try {
        const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
        const res = await api.getTranslation({ kitabName, originalText: original })
        if (res && res.ok) {
          const txt = res.data?.text_translate || ''
          setDbTranslation(txt)
          setDbMeta(res.data || null)
          setLocalInput(txt)
        } else {
          setDbTranslation('')
          setDbMeta(null)
          setLocalInput('')
        }
      } catch (e) {
        setLogs(prev => [{ type: 'error', text: e.message || 'Gagal mengambil terjemahan dari database.' }, ...prev])
      }
    }
    loadDb()
  }, [showLocal, original, folder])

  // Ensure kitab state and always load files for selected folder
  const checkKitabForFolder = async (dir) => {
    try {
      const res = await api.findKitabByFolder(dir)
      const resolvedImage = await resolveImageFolder(dir)
      setImageFolder(resolvedImage || '')
      await refreshFiles(dir)
      if (res && res.ok && res.data) {
        setShowCreateKitab(false)
      } else {
        const base = (dir || '').split('\\').filter(Boolean).pop() || 'kitab-baru'
        setNewKitab({ nama_kitab: base, pengarang: '', keterangan: '', folder_path: dir })
        setShowCreateKitab(true)
      }
    } catch (e) {
      const resolvedImage = await resolveImageFolder(dir)
      setImageFolder(resolvedImage || '')
      await refreshFiles(dir)
      const base = (dir || '').split('\\').filter(Boolean).pop() || 'kitab-baru'
      setNewKitab({ nama_kitab: base, pengarang: '', keterangan: '', folder_path: dir })
      setShowCreateKitab(true)
      setLogs(prev => [{ type: 'error', text: e.message || 'Gagal memeriksa kitab untuk folder.' }, ...prev])
    }
  }

  return (
    <>
      {/* Folder selector: always visible at the top */}
      <Form className="mb-3">
        <Row>
          <Col md={4} className="mb-3">
            <Form.Label>Folder teks (.txt)</Form.Label>
            <InputGroup>
              <Form.Control value={folder} onChange={e => setFolder(e.target.value)} />
              <Button variant="secondary" onClick={pickFolder} disabled={!api}>Select Folder</Button>
            </InputGroup>
          </Col>
        </Row>
        <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
          <Button variant="success" size="sm" disabled={!api || !folder || ocrRunning} onClick={joinText}>
            <i className="bi bi-file-richtext me-2" /> Gabung Teks
          </Button>
          <Button variant="outline-primary" size="sm" disabled={!api || !folder || ocrRunning} onClick={viewMergedFile}>
            <i className="bi bi-eye me-2" /> View File
          </Button>
          {imageFolder ? (
            <span className="text-muted small">Gambar: {imageFolder}</span>
          ) : null}
        </div>
        <div className="d-flex flex-wrap align-items-end gap-3">
          <div>
            <div className="text-muted small mb-1">OCR Engine</div>
            <Form.Select size="sm" style={{ width: '180px' }} value={ocrEngine} onChange={handleEngineChange} disabled={ocrRunning}>
              <option value="tesseract">Tesseract</option>
              <option value="arabic_dl">Arabic DL</option>
              <option value="kraken_arabic">Kraken (Arabic)</option>
              <option value="easyocr">EasyOCR</option>
              <option value="google_vision">Google Vision</option>
              <option value="unlimited_ocr">Unlimited-OCR</option>
              <option value="openai">OpenAI</option>
            </Form.Select>
          </div>
          <div>
            <div className="text-muted small mb-1">Layout OCR</div>
            <Form.Select size="sm" style={{ width: '220px' }} value={ocrLayoutMode} onChange={handleLayoutModeChange} disabled={ocrRunning}>
              <option value="box_notes">Inside Box + Outside di akhir</option>
              <option value="full">Full Page</option>
            </Form.Select>
          </div>
          <Button variant="outline-primary" size="sm" className="px-3" disabled={!api || !folder || ocrRunning} onClick={reOcrFolder}>
            <i className="bi bi-card-text me-1" /> Re-OCR
            {checkedPaths.length > 0 ? ` (${checkedPaths.length})` : ' (all)'}
          </Button>
        </div>
        {ocrRunning && (
          <div className="mt-2">
            <ProgressBar
              now={ocrProgress.total > 0 ? Math.round(ocrProgress.index * 100 / ocrProgress.total) : 0}
              label={ocrProgress.total > 0 ? `${Math.round(ocrProgress.index * 100 / ocrProgress.total)}%` : ''}
            />
            <div className="mt-1 text-muted small">
              Re-OCR: {ocrProgress.index} / {ocrProgress.total}
            </div>
          </div>
        )}
      </Form>

      {showCreateKitab && (
        <Alert variant="warning" className="mb-3">
          <div className="fw-bold mb-2">Kitab belum terdaftar untuk folder ini. Tambahkan kitab baru:</div>
          <Form>
            <Row className="g-2">
              <Col md={4}>
                <Form.Label>Nama Kitab</Form.Label>
                <Form.Control value={newKitab.nama_kitab} onChange={e => setNewKitab(v => ({ ...v, nama_kitab: e.target.value }))} />
              </Col>
              <Col md={4}>
                <Form.Label>Pengarang</Form.Label>
                <Form.Control value={newKitab.pengarang} onChange={e => setNewKitab(v => ({ ...v, pengarang: e.target.value }))} />
              </Col>
              <Col md={8} className="mt-2">
                <Form.Label>Keterangan</Form.Label>
                <Form.Control as="textarea" rows={2} value={newKitab.keterangan} onChange={e => setNewKitab(v => ({ ...v, keterangan: e.target.value }))} />
              </Col>
              <Col md={8} className="mt-2">
                <Form.Label>Folder Path</Form.Label>
                <Form.Control value={newKitab.folder_path} readOnly />
              </Col>
            </Row>
            <div className="d-flex justify-content-end mt-2">
              <Button
                variant="success"
                size="sm"
                disabled={!api || !newKitab.nama_kitab || !newKitab.folder_path}
                onClick={async () => {
                  try {
                    const res = await api.createKitab(newKitab)
                    if (res && res.ok) {
                      setShowCreateKitab(false)
                      setLogs(prev => [{ type: 'success', text: 'Kitab berhasil dibuat.' }, ...prev])
                      await refreshFiles(newKitab.folder_path)
                    } else {
                      throw new Error(res?.error || 'Gagal membuat kitab.')
                    }
                  } catch (e) {
                    setLogs(prev => [{ type: 'error', text: e.message || 'Kesalahan saat membuat kitab.' }, ...prev])
                  }
                }}
              >Simpan Kitab</Button>
            </div>
          </Form>
        </Alert>
      )}

      <Row className="g-3">
        <Col md={4}>
          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
            <Form.Check
              type="checkbox"
              id="reocr-select-all"
              label="Pilih semua (Re-OCR)"
              checked={getPageFiles().length > 0 && getPageFiles().every((p) => checkedPaths.includes(p))}
              disabled={ocrRunning || getPageFiles().length === 0}
              onChange={toggleSelectAllForOcr}
            />
            <span className="text-muted small">
              {checkedPaths.length > 0 ? `${checkedPaths.length} dipilih` : 'Tanpa pilihan = all'}
            </span>
          </div>
          <ListGroup style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {files.length === 0 && (
              <ListGroup.Item className="text-muted">Tidak ada file .txt</ListGroup.Item>
            )}
            {files.map((p, i) => {
              const name = p.replace(folder + '\\', '')
              const isAllPages = (name || '').toLowerCase() === 'all_pages.txt'
              const isChecked = checkedPaths.includes(p)
              return (
                <ListGroup.Item
                  key={i}
                  action
                  active={selected === p}
                  onClick={() => { setSelected(p); openFileContent(p) }}
                  className="d-flex align-items-center gap-2"
                >
                  {!isAllPages && (
                    <Form.Check
                      type="checkbox"
                      checked={isChecked}
                      disabled={ocrRunning}
                      onChange={(e) => toggleCheckedPath(p, e)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Pilih ${name} untuk Re-OCR`}
                    />
                  )}
                  <span className="text-truncate" style={{ maxWidth: '100%' }}>{name}</span>
                </ListGroup.Item>
              )
            })}
          </ListGroup>
        </Col>
        <Col md={8}>
          <Accordion defaultActiveKey="active">
            <Accordion.Item eventKey="active">
              <Accordion.Header>
                Aktif: {activeFile ? activeFile.replace(folder + '\\', '') : '-'}
              </Accordion.Header>
              <Accordion.Body>
                <div className="d-flex gap-2 mb-3">
                  <Button variant="outline-secondary" size="sm" onClick={() => { setShowLocal(s => !s); if (!showLocal) setShowAI(false) }}>
                    Local Translate
                  </Button>
                  <Button variant="outline-primary" size="sm" onClick={() => { setShowAI(s => !s); if (!showAI) setShowLocal(false) }}>
                    AI Translate
                  </Button>
                  <Button variant="outline-warning" size="sm" disabled={!activeFile} onClick={() => { onOpenSplit?.({ folder, file: activeFile, imageFolder }); }}>
                    Split View
                  </Button>

                </div>

                {showLocal && (
                  <div className="mb-3">
                    <div className="text-muted small mb-2">Teks Asli</div>
                    <div className="p-3 border rounded-3 mb-3" style={{ maxHeight: '30vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                      {original || <span className="text-muted">Pilih file untuk melihat teks asli.</span>}
                    </div>

                    <div className="text-muted small mb-2">Terjemahan (Database)</div>
                    {dbMeta?.low_confidence ? (
                      <Alert variant="warning" className="py-2">
                        Low confidence pada terjemahan tersimpan.
                        {dbMeta?.latest_version?.version_number ? ` Versi: ${dbMeta.latest_version.version_number}.` : ''}
                        {Array.isArray(dbMeta?.confidence_reasons) && dbMeta.confidence_reasons.length > 0
                          ? ` Alasan: ${dbMeta.confidence_reasons.join(', ')}.`
                          : ''}
                      </Alert>
                    ) : null}
                    <Form>
                      <Form.Control
                        as="textarea"
                        rows={8}
                        value={localInput}
                        onChange={e => setLocalInput(e.target.value)}
                        placeholder={dbTranslation ? '' : 'Belum ada terjemahan di database. Tulis terjemahan di sini...'}
                        style={{ whiteSpace: 'pre-wrap' }}
                      />
                      <div className="d-flex justify-content-end mt-2">
                        <Button
                          variant="success"
                          size="sm"
                          disabled={!api || !activeFile || saving || showCreateKitab}
                          onClick={async () => {
                            try {
                              setSaving(true)
                              const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
                              const fileName = (activeFile || '').split('\\').pop() || ''
                              const res = await api.saveTranslation({
                                kitabName,
                                folderPath: folder,
                                fileName,
                                originalText: original,
                                translatedText: localInput,
                                sourceLabel: 'manual_edit',
                                feedbackLabel: 'local_translation_saved'
                              })
                              if (res && res.ok) {
                                setDbTranslation(localInput)
                                setDbMeta({
                                  text_translate: localInput,
                                  confidence_score: res.confidence_score,
                                  low_confidence: res.low_confidence,
                                  confidence_reasons: res.confidence_reasons || [],
                                  latest_version: res.version_id ? { id: res.version_id, version_number: res.version_number } : null
                                })
                                setResult(localInput)
                                setLogs(prev => [{ type: 'success', text: `Terjemahan berhasil disimpan (${res.action}).` }, ...prev])
                              } else {
                                throw new Error(res?.error || 'Gagal menyimpan terjemahan.')
                              }
                            } catch (e) {
                              setLogs(prev => [{ type: 'error', text: e.message || 'Kesalahan saat menyimpan.' }, ...prev])
                            } finally {
                              setSaving(false)
                            }
                          }}
                        >
                          Simpan
                        </Button>
                      </div>
                    </Form>
                  </div>
                )}

                {showAI && (
                  <div className="mb-3">
                    <Form className="mb-3">
                      <Row>
                        <Col md={4} className="mb-3">
                          <Form.Label>OpenAI API Key</Form.Label>
                          <Form.Control type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
                        </Col>
                        <Col md={2} className="mb-3">
                          <Form.Label>Model</Form.Label>
                          <Form.Control value={model} onChange={e => setModel(e.target.value)} />
                        </Col>
                        <Col md={2} className="mb-3">
                          <Form.Label>Bahasa Target</Form.Label>
                          <Form.Control value={target} onChange={e => setTarget(e.target.value)} />
                        </Col>
                      </Row>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!api || !activeFile || !apiKey || running}
                        onClick={async () => {
                          try {
                            setRunning(true)
                            const fileRes = await api.readFile(activeFile)
                            if (!fileRes || !fileRes.ok) throw new Error(fileRes?.error || 'Gagal membaca file input.')
                            const text = fileRes.content || ''
                            const res = await api.translateChatGPT({ apiKey, text, target, model })
                            if (res && res.ok) {
                              setResult(res.output || '')
                            } else {
                              throw new Error(res?.error || 'Gagal memproses terjemahan.')
                            }
                          } catch (e) {
                            setLogs(prev => [{ type: 'error', text: e.message || 'Kesalahan tidak diketahui.' }, ...prev])
                          } finally {
                            setRunning(false)
                          }
                        }}
                      >
                        <i className="bi bi-translate me-2" /> Terjemahkan (ChatGPT)
                      </Button>
                    </Form>
                  </div>
                )}

                {!showLocal && !showAI && (
                  <div className="p-3 border rounded-3" style={{ maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                    {result ? result : <span className="text-muted">Hasil terjemahan akan muncul di sini.</span>}
                  </div>
                )}
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
        </Col>
      </Row>

      <ListGroup className="mt-3">
        {logs.map((l, i) => (
          <ListGroup.Item key={i} variant={l.type === 'error' ? 'danger' : 'success'}>{l.text}</ListGroup.Item>
        ))}
      </ListGroup>

      <Modal show={viewerOpen} onHide={() => setViewerOpen(false)} size="lg">
        <Modal.Header closeButton className="align-items-center">
          <div className="modal-title-wrap flex-grow-1 me-2">
            <Modal.Title className="modal-title-truncate">Preview: {viewerPath || 'all_pages.txt'}</Modal.Title>
          </div>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
            {showSearch && (
              <Form.Control
                className="flex-grow-1"
                ref={searchInputRef}
                size="sm"
                placeholder="Find (Ctrl+F)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goNext(); } else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); goPrev(); } }}
              />
            )}
            <div className="text-muted small">{matches.length ? `${currentMatch + 1}/${matches.length}` : '0/0'}</div>
            <Button variant="outline-secondary" size="sm" onClick={goPrev} disabled={matches.length === 0}><i className="bi bi-chevron-up" /></Button>
            <Button variant="outline-secondary" size="sm" onClick={goNext} disabled={matches.length === 0}><i className="bi bi-chevron-down" /></Button>
            <Button variant="outline-secondary" size="sm" onClick={() => setShowSearch(s => !s)} title={showSearch ? 'Hide Find' : 'Show Find'}>
              <i className="bi bi-search" />
            </Button>
          </div>
          <div ref={viewerRef} className="viewer" style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {renderHighlighted()}
          </div>
        </Modal.Body>
      </Modal>
    </>
  )
}
