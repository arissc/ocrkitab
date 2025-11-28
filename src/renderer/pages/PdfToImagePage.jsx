import React, { useState } from 'react'
import { Form, Button, InputGroup, Alert, ListGroup } from 'react-bootstrap'

export default function PdfToImagePage() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [pdfPath, setPdfPath] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [notice, setNotice] = useState('')
  const [magickPath, setMagickPath] = useState('')
  const [pdftoppmPath, setPdftoppmPath] = useState('')

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
  const convert = async () => {
    if (!api || !api.convertPdf) { setNotice('Konversi hanya tersedia di Electron.'); return }
    if (!pdfPath || !outputFolder) { setNotice('Pilih file PDF dan folder output terlebih dahulu.'); return }
    setNotice('Mengonversi halaman PDF ke gambar…')
    const res = await api.convertPdf({ pdfPath, outputFolder, density: 200, quality: 95, magickPath, pdftoppmPath })
    if (res.ok) {
      setLastFiles(res.files || [])
      setNotice(`Berhasil mengonversi. Total gambar: ${(res.files || []).length}.`) 
    } else {
      setNotice(`Gagal konversi: ${res.error}`)
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

  return (
    <>
      {notice && <Alert variant="info" className="mb-3">{notice}</Alert>}
      <Form>
        <Form.Group className="mb-3">
          <Form.Label>Pilih file PDF</Form.Label>
          <InputGroup>
            <Form.Control value={pdfPath} onChange={e => setPdfPath(e.target.value)} />
            <Button variant="secondary" onClick={pickPdf} disabled={!api}>Browse</Button>
          </InputGroup>
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Folder output gambar</Form.Label>
          <InputGroup>
            <Form.Control value={outputFolder} onChange={e => setOutputFolder(e.target.value)} />
            <Button variant="secondary" onClick={pickOutput} disabled={!api}>Select Folder</Button>
          </InputGroup>
      </Form.Group>
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
      <div className="d-flex gap-2 mb-3">
          <Button variant="primary" onClick={convert} disabled={!api || !pdfPath || !outputFolder}>Konversi</Button>
          <Button variant="outline-secondary" onClick={openOutput} disabled={!api || !outputFolder}>Buka Folder Output</Button>
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