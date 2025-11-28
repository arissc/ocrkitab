import React, { useEffect, useState } from 'react'
import { Form, Button, InputGroup, ProgressBar, ListGroup } from 'react-bootstrap'

export default function OCRPage() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [inputFolder, setInputFolder] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [tesseractPath, setTesseractPath] = useState('')
  const [lang, setLang] = useState('ara')
  const [ocrEngine, setOcrEngine] = useState('tesseract')
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState({ index: 0, total: 0 })
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (api && api.getDefaults) {
      api.getDefaults().then(def => {
        setInputFolder(def.inputFolder)
        setOutputFolder(def.outputFolder)
        setTesseractPath(def.tesseractPath)
        setLang(def.lang)
        setOcrEngine(def.ocrEngine || 'tesseract')
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

    api && api.onOcrProgress && api.onOcrProgress((p) => {
      setProgress({ index: p.index, total: p.total })
      setLogs(prev => [{
        type: p.ok ? 'info' : 'error',
        text: `${p.ok ? 'OK' : 'ERR'}: ${p.file}${p.error ? ' - ' + p.error : ''}`
      }, ...prev])
    })
    api && api.onOcrComplete && api.onOcrComplete((p) => {
      setRunning(false)
      setLogs(prev => [{ type: 'info', text: `Selesai OCR. Total: ${p.total}` }, ...prev])
    })
  }, [])

  const pickInput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(inputFolder)
    if (dir) setInputFolder(dir)
  }
  const pickOutput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(outputFolder)
    if (dir) setOutputFolder(dir)
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
    let res
    if (ocrEngine === 'arabic_dl' && api.runOCRDL) {
      res = await api.runOCRDL({ inputFolder, outputFolder, lang })
    } else if (ocrEngine === 'easyocr' && api.runOCREasy) {
      res = await api.runOCREasy({ inputFolder, outputFolder, lang })
    } else if (api.runOCR) {
      res = await api.runOCR({ inputFolder, outputFolder, tesseractPath, lang })
    } else {
      res = { ok: false, error: 'API OCR tidak tersedia.' }
    }
    if (!res.ok) {
      setRunning(false)
      setLogs(prev => [{ type: 'error', text: `Gagal OCR: ${res.error}` }, ...prev])
    }
  }

  const pct = progress.total > 0 ? Math.round(progress.index * 100 / progress.total) : 0

  return (
    <>
      <Form>
        <Form.Group className="mb-3">
          <Form.Label>Folder input gambar (.jpg)</Form.Label>
          <InputGroup>
            <Form.Control value={inputFolder} onChange={e => setInputFolder(e.target.value)} />
            <Button variant="secondary" onClick={pickInput} disabled={!api}>Select Folder</Button>
          </InputGroup>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Folder output teks</Form.Label>
          <InputGroup>
            <Form.Control value={outputFolder} onChange={e => setOutputFolder(e.target.value)} />
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