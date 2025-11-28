import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { Form, Button, InputGroup, ListGroup, Row, Col, Alert, Accordion, Modal } from 'react-bootstrap'

export default function TranslatePage({ initialFolder = '' }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [folder, setFolder] = useState('')
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [target, setTarget] = useState('en')
  const [result, setResult] = useState('')
  const [original, setOriginal] = useState('')
  const [dbTranslation, setDbTranslation] = useState('')
  const [localInput, setLocalInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
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

  useEffect(() => {
    // Default blank; only use initialFolder if provided
    const nextFolder = initialFolder || ''
    setFolder(nextFolder)
    if (api && nextFolder) {
      checkKitabForFolder(nextFolder)
    }
  }, [initialFolder])

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
      if (sorted.length > 0) {
        const first = sorted[0]
        setSelected(first)
        await openFileContent(first)
      }
    } else {
      setFiles([])
      setLogs(prev => [{ type: 'error', text: res?.error || 'Gagal membaca folder.' }, ...prev])
    }
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
          setLocalInput(txt)
        } else {
          setDbTranslation('')
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
      await refreshFiles(dir)
      if (res && res.ok && res.data) {
        setShowCreateKitab(false)
      } else {
        const base = (dir || '').split('\\').filter(Boolean).pop() || 'kitab-baru'
        setNewKitab({ nama_kitab: base, pengarang: '', keterangan: '', folder_path: dir })
        setShowCreateKitab(true)
      }
    } catch (e) {
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
        <div className="d-flex gap-2">
          <Button variant="success" size="sm" disabled={!api || !folder} onClick={joinText}>
            <i className="bi bi-file-richtext me-2" /> Gabung Teks
          </Button>
          <Button variant="outline-primary" size="sm" disabled={!api || !folder} onClick={viewMergedFile}>
            <i className="bi bi-eye me-2" /> View File
          </Button>
        </div>
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
          <ListGroup style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {files.length === 0 && (
              <ListGroup.Item className="text-muted">Tidak ada file .txt</ListGroup.Item>
            )}
            {files.map((p, i) => {
              const name = p.replace(folder + '\\', '')
              return (
                <ListGroup.Item
                  key={i}
                  action
                  active={selected === p}
                  onClick={() => { setSelected(p); openFileContent(p) }}
                >
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
                  <Button variant="outline-warning" size="sm" disabled={!activeFile} onClick={() => { onOpenSplit?.({ folder, file: activeFile }); }}>
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
                              const res = await api.saveTranslation({ kitabName, originalText: original, translatedText: localInput })
                              if (res && res.ok) {
                                setDbTranslation(localInput)
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