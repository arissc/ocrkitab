import React, { useEffect, useState } from 'react'
import { Row, Col, Button, Alert } from 'react-bootstrap'

export default function SplitViewPage({ initialFolder = '', initialFile = '', onBack }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [folder, setFolder] = useState(initialFolder || '')
  const [file, setFile] = useState(initialFile || '')
  const [image, setImage] = useState('')
  const [text, setText] = useState('')
  const [translated, setTranslated] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setFolder(initialFolder || '')
    setFile(initialFile || '')
  }, [initialFolder, initialFile])

  useEffect(() => {
    const load = async () => {
      if (!api) { setNotice('Split view hanya tersedia di Electron.'); return }
      if (!folder || !file) { setNotice('Pilih file teks terlebih dahulu di Translate.'); return }
      try {
        const rf = await api.readFile(file)
        if (rf && rf.ok) {
          const original = rf.content || ''
          setText(original)
          const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
          try {
            const tr = await api.getTranslation({ kitabName, originalText: original })
            if (tr && tr.ok && tr.data) {
              setTranslated(tr.data.text_translate || '')
            } else {
              setTranslated('')
            }
          } catch (_) { setTranslated('') }
        }
        const li = await api.listImageFiles(folder)
        if (li && li.ok) {
          const imgs = li.files || []
          const pick = chooseMatchingImage(imgs, file)
          setImage(pick || imgs[0] || '')
        }
      } catch (e) {
        setNotice(e.message || 'Gagal memuat split view.')
      }
    }
    load()
  }, [api, folder, file])

  const chooseMatchingImage = (images, txtFile) => {
    if (!images || images.length === 0 || !txtFile) return ''
    const base = (txtFile.split('\\').pop() || '').replace(/\.[^.]+$/, '')
    const m = base.match(/(\d+)$/)
    const n = m ? parseInt(m[1], 10) : NaN
    if (!Number.isNaN(n)) {
      const byNum = images.find((p) => {
        const bn = (p.split('\\').pop() || '').replace(/\.[^.]+$/, '')
        const mm = bn.match(/(\d+)$/)
        const nn = mm ? parseInt(mm[1], 10) : NaN
        return !Number.isNaN(nn) && nn === n
      })
      if (byNum) return byNum
    }
    const byBase = images.find((p) => (p.split('\\').pop() || '').replace(/\.[^.]+$/, '') === base)
    return byBase || ''
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="h6 mb-0">Split View</div>
        <Button variant="outline-secondary" size="sm" onClick={onBack}><i className="bi bi-arrow-left me-2" /> Back</Button>
      </div>
      {notice && <Alert variant="warning" className="mb-3">{notice}</Alert>}
      <Row className="g-3">
        <Col md={6}>
          {image ? (
            <img src={`file://${image}`} alt="page" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '0.5rem' }} />
          ) : (
            <div className="text-muted">Tidak ada gambar ditemukan di folder ini.</div>
          )}
        </Col>
        <Col md={6}>
          <div className="p-3 border rounded-3" style={{ maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            {translated || text || <span className="text-muted">Tidak ada teks untuk ditampilkan.</span>}
          </div>
        </Col>
      </Row>
    </>
  )
}