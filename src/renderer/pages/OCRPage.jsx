import React, { useEffect, useState } from 'react'
import { Form, Button, InputGroup, ProgressBar, ListGroup } from 'react-bootstrap'

export default function OCRPage({ initialInputFolder = '', initialOutputFolder = '', flowMode = '', onBack }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [inputFolder, setInputFolder] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [tesseractPath, setTesseractPath] = useState('')
  const [lang, setLang] = useState('ara')
  const [ocrEngine, setOcrEngine] = useState('tesseract')
  const [layoutMode, setLayoutMode] = useState('full')
  const [boxPaddingPct, setBoxPaddingPct] = useState('0.01')
  const [notePaddingPct, setNotePaddingPct] = useState('0.01')
  const [outsideFormat, setOutsideFormat] = useState('flat')
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState({ index: 0, total: 0 })
  const [running, setRunning] = useState(false)
  const isGenerateFlow = flowMode === 'create_kitab_generate'

  const getParentFolder = (dir) => {
    const value = String(dir || '').trim()
    if (!value) return ''
    const normalized = value.replace(/[\\/]+$/, '')
    if (!normalized) return ''
    const parts = normalized.split(/[\\/]/)
    if (parts.length <= 1) return normalized
    const parent = parts.slice(0, -1).join('\\')
    return parent || normalized
  }

  const persistFolders = async (nextInputFolder, nextOutputFolder) => {
    if (!api || !api.saveSettings) return
    await api.saveSettings({
      inputFolder: nextInputFolder,
      outputFolder: nextOutputFolder
    })
  }

  const persistLayoutSettings = async (partial = {}) => {
    if (!api || !api.saveSettings) return
    await api.saveSettings(partial)
  }

  const normalizePctValue = (value, fallback = 0.01) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.max(0, Math.min(0.2, num))
  }

  useEffect(() => {
    let offProgress
    let offComplete

    if (api && api.getDefaults) {
      api.getDefaults().then(def => {
        setInputFolder(def.inputFolder)
        setOutputFolder(def.outputFolder)
        setTesseractPath(def.tesseractPath)
        setLang(def.lang)
        setOcrEngine(def.ocrEngine || 'tesseract')
        setLayoutMode(def.ocrLayoutMode || 'full')
        setBoxPaddingPct(String(def.ocrBoxPaddingPct ?? '0.01'))
        setNotePaddingPct(String(def.ocrNotePaddingPct ?? '0.01'))
        setOutsideFormat(def.ocrOutsideFormat || 'flat')
      })
    }

    // Restore running progress if a job is active when returning to this page
    if (api && api.getOcrStatus) {
      api.getOcrStatus().then(st => {
        if (st && st.running) {
          setRunning(true)
          setProgress({ index: st.completed || 0, total: st.total || 0 })
          if (st.lastFile) {
            setLogs(prev => [{ type: 'info', text: `Lanjut OCR: ${st.completed}/${st.total} (terakhir: ${st.lastFile})` }, ...prev])
          }
        }
      })
    }

    if (api && api.onOcrProgress) {
      offProgress = api.onOcrProgress((p) => {
      setProgress({ index: p.index, total: p.total })
      setLogs(prev => [{
        type: p.ok ? 'info' : 'error',
        text: `${p.ok ? 'OK' : 'ERR'}: ${p.file}${p.error ? ' - ' + p.error : ''}`
      }, ...prev])
      })
    }
    if (api && api.onOcrComplete) {
      offComplete = api.onOcrComplete((p) => {
      setRunning(false)
      setLogs(prev => [{ type: 'info', text: `Selesai OCR. Total: ${p.total}` }, ...prev])
      })
    }

    return () => {
      try { offProgress && offProgress() } catch (_) {}
      try { offComplete && offComplete() } catch (_) {}
    }
  }, [])

  useEffect(() => {
    const applyFlowFolders = async () => {
      const nextInputFolder = String(initialInputFolder || '').trim()
      const nextOutputFolder = String(initialOutputFolder || '').trim()
      if (!nextInputFolder && !nextOutputFolder) return
      setInputFolder(nextInputFolder)
      setOutputFolder(nextOutputFolder)
      try {
        if (api?.ensureFolder && nextInputFolder) await api.ensureFolder(nextInputFolder)
        if (api?.ensureFolder && nextOutputFolder) await api.ensureFolder(nextOutputFolder)
        await persistFolders(nextInputFolder, nextOutputFolder)
      } catch (_) {}
    }
    applyFlowFolders()
  }, [api, initialInputFolder, initialOutputFolder])

  const pickInput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(inputFolder)
    if (dir) {
      const nextOutputFolder = getParentFolder(dir)
      setInputFolder(dir)
      setOutputFolder(nextOutputFolder)
      await persistFolders(dir, nextOutputFolder)
    }
  }
  const pickOutput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(outputFolder)
    if (dir) {
      setOutputFolder(dir)
      await persistFolders(inputFolder, dir)
    }
  }
  const pickTesseract = async () => {
    if (!api || !api.selectTesseract) return
    const file = await api.selectTesseract()
    if (file) {
      setTesseractPath(file)
      if (api && api.saveSettings) {
        await api.saveSettings({ tesseractPath: file })
      }
    }
  }

  const startOCR = async () => {
    if (!api) {
      setLogs(prev => [{ type: 'error', text: 'Jalankan lewat Electron untuk OCR.' }, ...prev])
      return
    }
    setRunning(true)
    setLogs(prev => [{ type: 'info', text: `Mulai OCR (${ocrEngine})...` }, ...prev])
    setProgress({ index: 0, total: 0 })
    try {
      const layoutPayload = {
        layoutMode,
        boxPaddingPct: normalizePctValue(boxPaddingPct),
        notePaddingPct: normalizePctValue(notePaddingPct),
        outsideFormat
      }
      let res
      if (ocrEngine === 'arabic_dl') {
        if (!api.runOCRDL) throw new Error('API runOCRDL tidak tersedia.')
        res = await api.runOCRDL({ inputFolder, outputFolder, lang, ...layoutPayload })
      } else if (ocrEngine === 'easyocr') {
        if (!api.runOCREasy) throw new Error('API runOCREasy tidak tersedia.')
        res = await api.runOCREasy({ inputFolder, outputFolder, lang, ...layoutPayload })
      } else if (ocrEngine === 'kraken' || ocrEngine === 'kraken_arabic') {
        if (!api.runOCRKraken) throw new Error('API runOCRKraken tidak tersedia.')
        res = await api.runOCRKraken({ inputFolder, outputFolder, lang, ...layoutPayload })
      } else if (ocrEngine === 'google_vision') {
        if (!api.runOCRVision) throw new Error('API runOCRVision tidak tersedia.')
        res = await api.runOCRVision({ inputFolder, outputFolder, lang, ...layoutPayload })
      } else if (ocrEngine === 'unlimited_ocr') {
        if (!api.runOCRUnlimited) throw new Error('API runOCRUnlimited tidak tersedia.')
        res = await api.runOCRUnlimited({ inputFolder, outputFolder, lang, ...layoutPayload })
      } else {
        if (!api.runOCR) throw new Error('API runOCR tidak tersedia.')
        res = await api.runOCR({ inputFolder, outputFolder, tesseractPath, lang, ...layoutPayload })
      }
      if (!res || !res.ok) {
        setRunning(false)
        setLogs(prev => [{ type: 'error', text: `Gagal OCR: ${res?.error || 'Unknown error'}` }, ...prev])
      }
    } catch (e) {
      setRunning(false)
      setLogs(prev => [{ type: 'error', text: `Gagal OCR: ${e?.message || String(e)}` }, ...prev])
    }
  }

  const pct = progress.total > 0 ? Math.round(progress.index * 100 / progress.total) : 0

  return (
    <>
      {isGenerateFlow && (
        <div className="mb-3 d-flex flex-column gap-2">
          <div>
            <Button variant="outline-secondary" onClick={onBack}>
              <i className="bi bi-arrow-left me-1" /> Kembali ke Tambah Kitab
            </Button>
          </div>
          <div className="alert alert-secondary mb-0">
            Flow generate aktif. Folder gambar dan folder teks sudah diisi otomatis, dan folder yang belum ada akan dibuat saat Anda masuk ke halaman ini.
          </div>
        </div>
      )}
      <Form>
        <Form.Group className="mb-3">
          <Form.Label>Folder input gambar (.jpg)</Form.Label>
          <InputGroup>
            <Form.Control
              value={inputFolder}
              onChange={e => {
                const nextInputFolder = e.target.value
                setInputFolder(nextInputFolder)
                setOutputFolder(getParentFolder(nextInputFolder))
              }}
              onBlur={async e => {
                const nextInputFolder = e.target.value
                const nextOutputFolder = getParentFolder(nextInputFolder)
                setOutputFolder(nextOutputFolder)
                await persistFolders(nextInputFolder, nextOutputFolder)
              }}
            />
            <Button variant="secondary" onClick={pickInput} disabled={!api}>Select Folder</Button>
          </InputGroup>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Folder output teks</Form.Label>
          <InputGroup>
            <Form.Control
              value={outputFolder}
              onChange={e => setOutputFolder(e.target.value)}
              onBlur={async e => {
                const nextOutputFolder = e.target.value
                await persistFolders(inputFolder, nextOutputFolder)
              }}
            />
            <Button variant="secondary" onClick={pickOutput} disabled={!api}>Select Folder</Button>
          </InputGroup>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Path Tesseract</Form.Label>
          <InputGroup>
            <Form.Control value={tesseractPath} onChange={e => setTesseractPath(e.target.value)} onBlur={async () => { if (api && api.saveSettings) await api.saveSettings({ tesseractPath }) }} />
            <Button variant="secondary" onClick={pickTesseract} disabled={!api}>Browse</Button>
          </InputGroup>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Bahasa OCR (-l)</Form.Label>
          <Form.Control value={lang} onChange={e => setLang(e.target.value)} />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Engine OCR</Form.Label>
          <Form.Select value={ocrEngine} onChange={async e => { const v = e.target.value; setOcrEngine(v); if (api && api.saveSettings) await api.saveSettings({ ocrEngine: v }) }}>
            <option value="tesseract">Tesseract</option>
            <option value="arabic_dl">Arabic Deep Learning</option>
            <option value="easyocr">EasyOCR</option>
            <option value="kraken_arabic">Kraken (Arabic)</option>
            <option value="google_vision">Google Vision API</option>
            <option value="unlimited_ocr">Unlimited-OCR (Local)</option>
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Mode Layout OCR</Form.Label>
          <Form.Select
            value={layoutMode}
            onChange={async e => {
              const v = e.target.value
              setLayoutMode(v)
              await persistLayoutSettings({ ocrLayoutMode: v })
            }}
          >
            <option value="full">Full Page</option>
            <option value="box_notes">Inside Box + Mark Outside</option>
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Box Padding (%)</Form.Label>
          <Form.Control
            type="number"
            min="0"
            max="0.2"
            step="0.005"
            value={boxPaddingPct}
            onChange={e => setBoxPaddingPct(e.target.value)}
            onBlur={async e => {
              const v = String(normalizePctValue(e.target.value, 0.01))
              setBoxPaddingPct(v)
              await persistLayoutSettings({ ocrBoxPaddingPct: Number(v) })
            }}
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Note Padding (%)</Form.Label>
          <Form.Control
            type="number"
            min="0"
            max="0.2"
            step="0.005"
            value={notePaddingPct}
            onChange={e => setNotePaddingPct(e.target.value)}
            onBlur={async e => {
              const v = String(normalizePctValue(e.target.value, 0.01))
              setNotePaddingPct(v)
              await persistLayoutSettings({ ocrNotePaddingPct: Number(v) })
            }}
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Format Outside Box</Form.Label>
          <Form.Select
            value={outsideFormat}
            onChange={async e => {
              const v = e.target.value
              setOutsideFormat(v)
              await persistLayoutSettings({ ocrOutsideFormat: v })
            }}
          >
            <option value="flat">Append di akhir</option>
            <option value="zoned">Per Zona di akhir</option>
          </Form.Select>
        </Form.Group>

        <div className="d-flex gap-2 mb-3">
          <Button variant="primary" disabled={running || !api} onClick={startOCR}>Mulai OCR</Button>
        </div>
      </Form>

      <div className="mb-3">
        <ProgressBar now={pct} label={`${pct}%`} />
        <div className="mt-1 text-muted small">{progress.index} / {progress.total} ({pct}%)</div>
      </div>

      <ListGroup>
        {logs.map((l, i) => (
          <ListGroup.Item key={i} variant={l.type === 'error' ? 'danger' : 'success'}>{l.text}</ListGroup.Item>
        ))}
      </ListGroup>
    </>
  )
}
