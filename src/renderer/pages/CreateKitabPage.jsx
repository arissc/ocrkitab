import React, { useEffect, useState } from 'react'
import { Form, Button, Row, Col, Alert, InputGroup, ListGroup, Badge } from 'react-bootstrap'

const EMPTY_FORM = { nama_kitab: '', pengarang: '', keterangan: '', folder_pairs: [] }

const getDirName = (filePath) => {
  const value = String(filePath || '').trim().replace(/[\\/]+$/, '')
  if (!value) return ''
  const parts = value.split(/[\\/]/)
  if (parts.length <= 1) return value
  return parts.slice(0, -1).join('\\')
}

const getBaseName = (filePath) => {
  const value = String(filePath || '').trim().replace(/[\\/]+$/, '')
  if (!value) return ''
  const parts = value.split(/[\\/]/)
  const last = parts[parts.length - 1] || ''
  return last.replace(/\.[^.]+$/, '')
}

const joinPath = (...parts) => {
  return parts
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) return part.replace(/[\\/]+$/, '')
      return part.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
    })
    .join('\\')
}

export default function CreateKitabPage({ draft, onDraftChange, onBack, onCreated, onStartGenerateFlow }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [form, setForm] = useState(draft || EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setForm(draft || EMPTY_FORM)
  }, [draft])

  const updateForm = (updater) => {
    setForm(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...(updater || {}) }
      onDraftChange?.(next)
      return next
    })
  }

  const pickFolder = async () => {
    if (!api || !api.selectFolder) return
    const last = form.folder_pairs[form.folder_pairs.length - 1]?.folder_path
    const fp = await api.selectFolder(last || undefined)
    if (fp) updateForm(v => ({ ...v, folder_pairs: [...(v.folder_pairs || []), { folder_path: fp, image_folder_path: '' }] }))
  }

  const removeFolder = (fp) => {
    updateForm(v => ({ ...v, folder_pairs: (v.folder_pairs || []).filter(x => x.folder_path !== fp) }))
  }

  const setImageFolder = async (fp) => {
    if (!api || !api.selectFolder) return
    const img = await api.selectFolder()
    if (img) updateForm(v => ({
      ...v,
      folder_pairs: (v.folder_pairs || []).map(p => (p.folder_path === fp ? { ...p, image_folder_path: img } : p))
    }))
  }

  const handleGenerate = async () => {
    setError('')
    setNotice('')
    if (!api || !api.selectPdf) {
      setError('Flow generate hanya tersedia di Electron.')
      return
    }
    try {
      const pdfPath = await api.selectPdf()
      if (!pdfPath) return

      const pdfDir = getDirName(pdfPath)
      const pdfBase = getBaseName(pdfPath) || 'kitab-baru'
      const bookRoot = joinPath(pdfDir, pdfBase)
      const imageFolder = joinPath(bookRoot, 'images')
      const textFolder = joinPath(bookRoot, 'text')

      await api.ensureFolder?.(bookRoot)
      await api.ensureFolder?.(imageFolder)
      await api.ensureFolder?.(textFolder)

      const nextPair = { folder_path: textFolder, image_folder_path: imageFolder }
      const existingPairs = Array.isArray(form.folder_pairs) ? form.folder_pairs : []
      const pairIndex = existingPairs.findIndex(item => item.folder_path === textFolder)
      const nextPairs = pairIndex >= 0
        ? existingPairs.map((item, index) => (index === pairIndex ? nextPair : item))
        : [...existingPairs, nextPair]
      const nextDraft = {
        ...form,
        nama_kitab: form.nama_kitab || pdfBase,
        folder_pairs: nextPairs
      }

      setForm(nextDraft)
      onDraftChange?.(nextDraft)
      setNotice(`Flow generate siap untuk PDF: ${pdfPath.split('\\').pop() || pdfPath}`)
      onStartGenerateFlow?.({
        draft: nextDraft,
        pdfPath,
        outputFolder: imageFolder,
        textFolder
      })
    } catch (e) {
      setError(e.message || 'Gagal memulai flow generate.')
    }
  }

  const submit = async () => {
    setError('')
    setNotice('')
    if (!form.nama_kitab || !api || !api.createKitab) {
      setError('Nama kitab wajib dan harus dijalankan di Electron.')
      return
    }
    setSaving(true)
    const res = await api.createKitab({
      nama_kitab: form.nama_kitab,
      pengarang: form.pengarang,
      keterangan: form.keterangan,
      folder_pairs: form.folder_pairs || []
    })
    setSaving(false)
    if (res && res.ok) {
      setNotice('Kitab berhasil dibuat.')
      onCreated?.()
    } else {
      setError(res?.error || 'Gagal membuat kitab.')
    }
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center">
        <div className="h5 mb-0">Tambah Kitab</div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={onBack}>Kembali</Button>
        </div>
      </div>
      {!api && (
        <Alert variant="warning">Halaman ini hanya aktif di Electron untuk akses database.</Alert>
      )}
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
      <Form>
        <Row className="g-3">
          <Col md={6}>
            <Form.Label>Nama Kitab</Form.Label>
            <Form.Control
              value={form.nama_kitab}
              onChange={(e) => updateForm(v => ({ ...v, nama_kitab: e.target.value }))}
              placeholder="Contoh: Syarah Dalail"
            />
          </Col>
          <Col md={6}>
            <Form.Label>Pengarang</Form.Label>
            <Form.Control
              value={form.pengarang}
              onChange={(e) => updateForm(v => ({ ...v, pengarang: e.target.value }))}
              placeholder="Opsional"
            />
          </Col>
          <Col md={12}>
            <Form.Label>Keterangan</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={form.keterangan}
              onChange={(e) => updateForm(v => ({ ...v, keterangan: e.target.value }))}
              placeholder="Catatan atau deskripsi singkat"
            />
          </Col>
          <Col md={12}>
            <Form.Label>Folder Teks dan Folder Gambar</Form.Label>
            <div className="d-flex flex-column gap-2">
              <div className="d-flex gap-2 flex-wrap">
                <Button variant="outline-primary" onClick={pickFolder} disabled={!api}>Tambah Folder</Button>
                <Button variant="outline-success" onClick={handleGenerate} disabled={!api}>Generate</Button>
              </div>
              {(form.folder_pairs || []).length > 0 && (
                <ListGroup>
                  {(form.folder_pairs || []).map(p => (
                    <ListGroup.Item key={p.folder_path} className="d-flex justify-content-between align-items-center">
                      <div className="d-flex flex-column">
                        <div className="small" style={{ overflowWrap: 'anywhere' }}><strong>Teks:</strong> {p.folder_path}</div>
                        <div className="small" style={{ overflowWrap: 'anywhere' }}><strong>Gambar:</strong> {p.image_folder_path || '-'}</div>
                      </div>
                      <div className="d-flex gap-2">
                        <Button variant="outline-secondary" size="sm" onClick={() => setImageFolder(p.folder_path)}>Set Folder Gambar</Button>
                        <Button variant="outline-danger" size="sm" onClick={() => removeFolder(p.folder_path)}>
                          <i className="bi bi-x-lg" /> Hapus
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </div>
          </Col>
        </Row>
        <div className="d-flex justify-content-end mt-3 gap-2">
          <Button variant="outline-secondary" onClick={onBack}>Batal</Button>
          <Button variant="primary" onClick={submit} disabled={saving || !api || !form.nama_kitab}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
        </div>
      </Form>
    </div>
  )
}
