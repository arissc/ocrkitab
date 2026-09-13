import React, { useEffect, useRef, useState } from 'react'
import { Form, Button, InputGroup, Alert, ListGroup } from 'react-bootstrap'

export default function PdfToImagePage({ initialPdfPath = '', initialOutputFolder = '', flowMode = '', onBack, onContinue }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [pdfPath, setPdfPath] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeVariant, setNoticeVariant] = useState('info')
  const [converting, setConverting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [magickPath, setMagickPath] = useState('')
  const [pdftoppmPath, setPdftoppmPath] = useState('')
  const autoRunKeyRef = useRef('')
  const isGenerateFlow = flowMode === 'create_kitab_generate'

  useEffect(() => {
    setPdfPath(initialPdfPath || '')
    setOutputFolder(initialOutputFolder || '')
    setLastFiles([])
    setProgress(null)
  }, [initialPdfPath, initialOutputFolder])

  const pickPdf = async () => {
    if (!api || !api.selectPdf) { setNotice('Fitur belum tersedia di browser.'); return }
    const file = await api.selectPdf()
    if (file) setPdfPath(file)
  }
  const pickOutput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(outputFolder)
    if (dir) setOutputFolder(dir)
  }
  const [lastFiles, setLastFiles] = useState([])
  useEffect(() => {
    if (!api) return
    let off1
    let off2
    if (api.onPdfConvertProgress) {
      off1 = api.onPdfConvertProgress((data) => {
        const total = Number(data?.total)
        const completed = Number(data?.completed)
        if (!Number.isSafeInteger(total) || total <= 0 || total > 100000) return
        if (!Number.isFinite(completed) || completed < 0 || completed > total) return
        setProgress({ total, completed })
      })
    }
    if (api.onPdfConvertComplete) {
      off2 = api.onPdfConvertComplete((data) => {
        const total = Number(data?.total)
        if (Number.isSafeInteger(total) && total > 0 && total <= 100000) {
          setProgress({ total, completed: total })
        }
        setNoticeVariant('success')
        setNotice('Selesai konversi.')
        setConverting(false)
      })
    }
    return () => {
      if (typeof off1 === 'function') off1()
      if (typeof off2 === 'function') off2()
    }
  }, [api])
  const convert = async ({ auto = false } = {}) => {
    if (!api || !api.convertPdf) { setNotice('Konversi hanya tersedia di Electron.'); return }
    if (!pdfPath || !outputFolder) { setNotice('Pilih file PDF dan folder output terlebih dahulu.'); return }
    setProgress(null)
    setConverting(true)
    setNoticeVariant('info')
    setNotice(auto ? 'Menyiapkan folder gambar untuk flow generate…' : 'Mengonversi halaman PDF ke gambar…')
    const res = await api.convertPdf({ pdfPath, outputFolder, density: 200, quality: 95, magickPath, pdftoppmPath })
    if (res.ok) {
      setLastFiles(res.files || [])
      setNoticeVariant('success')
      setNotice(`Berhasil mengonversi. Total gambar: ${(res.files || []).length}.`)
      setConverting(false)
      return true
    } else {
      setNoticeVariant('danger')
      setNotice(`Gagal konversi: ${res.error}`)
      setConverting(false)
      return false
    }
  }
  const browseMagick = async () => {
    if (!api || !api.selectMagick) return
    const p = await api.selectMagick()
    if (p) {
      setMagickPath(p)
      if (api.saveSettings) await api.saveSettings({ magickPath: p })
    }
  }
  const browsePdftoppm = async () => {
    if (!api || !api.selectPdftoppm) return
    const p = await api.selectPdftoppm()
    if (p) {
      setPdftoppmPath(p)
      if (api.saveSettings) await api.saveSettings({ pdftoppmPath: p })
    }
  }
  const openOutput = async () => {
    if (!api || !api.openExplorer || !outputFolder) return
    await api.openExplorer(outputFolder)
  }

  const handleContinue = async () => {
    if (converting) return
    let ready = lastFiles.length > 0
    if (!ready) {
      ready = await convert({ auto: true })
    }
    if (!ready) return
    onContinue?.({ pdfPath, outputFolder })
  }

  useEffect(() => {
    if (!isGenerateFlow || !api || !pdfPath || !outputFolder) return
    const nextKey = `${pdfPath}::${outputFolder}`
    if (autoRunKeyRef.current === nextKey) return
    autoRunKeyRef.current = nextKey
    convert({ auto: true })
  }, [isGenerateFlow, api, pdfPath, outputFolder])

  return (
    <>
      {notice && <Alert variant={noticeVariant} className="mb-3">{notice}</Alert>}
      {isGenerateFlow && (
        <Alert variant="secondary" className="mb-3">
          Flow generate aktif. PDF dan folder gambar sudah diisi otomatis, lalu sistem menyiapkan gambar sebelum lanjut ke OCR.
        </Alert>
      )}
      {progress && (
        <Alert variant="secondary" className="mb-3">
          Progress: {progress.completed} / {progress.total}
        </Alert>
      )}
      {onBack && (
        <div className="mb-3">
          <Button variant="outline-secondary" onClick={onBack}>
            <i className="bi bi-arrow-left me-1" /> Kembali
          </Button>
        </div>
      )}
      <Form>
        <Form.Group className="mb-3">
          <Form.Label>Pilih file PDF</Form.Label>
          <InputGroup>
            <Form.Control value={pdfPath} onChange={e => setPdfPath(e.target.value)} readOnly={isGenerateFlow} />
            {!isGenerateFlow && <Button variant="secondary" onClick={pickPdf} disabled={!api}>Browse</Button>}
          </InputGroup>
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Folder output gambar</Form.Label>
          <InputGroup>
            <Form.Control value={outputFolder} onChange={e => setOutputFolder(e.target.value)} readOnly={isGenerateFlow} />
            {!isGenerateFlow && <Button variant="secondary" onClick={pickOutput} disabled={!api}>Select Folder</Button>}
          </InputGroup>
      </Form.Group>
      {!isGenerateFlow && (
        <>
          <Form.Group className="mb-3">
            <Form.Label>Path ImageMagick (opsional)</Form.Label>
            <InputGroup>
              <Form.Control placeholder="magick.exe (otomatis jika di PATH)" value={magickPath} onChange={e => setMagickPath(e.target.value)} />
              <Button variant="secondary" onClick={browseMagick} disabled={!api}>Browse</Button>
            </InputGroup>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Path Poppler pdftoppm (opsional)</Form.Label>
            <InputGroup>
              <Form.Control placeholder="pdftoppm.exe (opsional)" value={pdftoppmPath} onChange={e => setPdftoppmPath(e.target.value)} />
              <Button variant="secondary" onClick={browsePdftoppm} disabled={!api}>Browse</Button>
            </InputGroup>
          </Form.Group>
        </>
      )}
      <div className="d-flex gap-2 mb-3">
        {isGenerateFlow ? (
          <Button variant="success" onClick={handleContinue} disabled={!api || converting || !pdfPath || !outputFolder}>
            {converting ? 'Menyiapkan...' : 'Continue'}
          </Button>
        ) : (
          <>
            <Button variant="primary" onClick={() => convert()} disabled={!api || !pdfPath || !outputFolder || converting}>Konversi</Button>
            <Button variant="outline-secondary" onClick={openOutput} disabled={!api || !outputFolder}>Buka Folder Output</Button>
          </>
        )}
      </div>
      {lastFiles.length > 0 && (
        <>
          <div className="text-muted small mb-2">Output files (contoh 10 pertama):</div>
          <ListGroup className="mb-3">
            {lastFiles.slice(0, 10).map((f, i) => (
              <ListGroup.Item key={i}>{f}</ListGroup.Item>
            ))}
          </ListGroup>
        </>
      )}
    </Form>
  </>
  )
}
