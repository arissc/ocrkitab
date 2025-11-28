import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { Form, Button, InputGroup, ListGroup, Modal } from 'react-bootstrap'

export default function GetTextPage() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [outputFolder, setOutputFolder] = useState('')
  const [logs, setLogs] = useState([])
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerText, setViewerText] = useState('')
  const [viewerPath, setViewerPath] = useState('')
  const [viewInfoShown, setViewInfoShown] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([]) // array of { start, end }
  const [currentMatch, setCurrentMatch] = useState(0)
  const [showSearch, setShowSearch] = useState(true)
  const viewerRef = useRef(null)
  const currentRef = useRef(null)
  const searchInputRef = useRef(null)

  useEffect(() => {
    if (api && api.getDefaults) {
      api.getDefaults().then(def => {
        setOutputFolder(def.outputFolder)
      })
    }
  }, [])

  const pickOutput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(outputFolder)
    if (dir) setOutputFolder(dir)
  }

  const joinText = async () => {
    if (!api || !api.joinText) {
      setLogs(prev => [{ type: 'error', text: 'Gabung teks hanya tersedia di Electron.' }, ...prev])
      return
    }
    const res = await api.joinText({ textFolder: outputFolder })
    if (res.ok) {
      setLogs(prev => [{ type: 'info', text: `Teks tergabung: ${res.output}` }, ...prev])
    } else {
      setLogs(prev => [{ type: 'error', text: `Gagal gabung: ${res.error}` }, ...prev])
    }
  }

  const viewMergedFile = async () => {
    if (!api || !api.readFile) {
      setLogs(prev => [{ type: 'error', text: 'View file hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!outputFolder) {
      setLogs(prev => [{ type: 'error', text: 'Folder output belum dipilih.' }, ...prev])
      return
    }
    const filePath = `${outputFolder}\\all_pages.txt`
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
      // Fallback: coba buka via explorer jika API tersedia
      if (api.openExplorer) {
        const openRes = await api.openExplorer(filePath)
        if (openRes && openRes.ok) {
          setLogs(prev => [{ type: 'info', text: 'Membuka di aplikasi eksternal sebagai fallback.' }, ...prev])
        }
      }
    }
  }

  // Build matches whenever query or text changes
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

  // Helper: scroll to current match element
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

  // Scroll when the current match changes or query updates
  useLayoutEffect(() => {
    scrollToCurrent()
  }, [currentMatch, viewerOpen, query])

  // Ctrl+F focuses the search input when modal is open
  useEffect(() => {
    if (!viewerOpen) return
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowSearch(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewerOpen])

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

  return (
    <>
      <Form>
        <Form.Group className="mb-3">
          <Form.Label>Folder output teks</Form.Label>
          <InputGroup>
            <Form.Control value={outputFolder} onChange={e => setOutputFolder(e.target.value)} />
            <Button variant="secondary" onClick={pickOutput} disabled={!api}>Select Folder</Button>
          </InputGroup>
        </Form.Group>
        <div className="d-flex gap-2 mb-3">
          <Button variant="success" disabled={!api || !outputFolder} onClick={joinText}>
            <i className="bi bi-file-richtext me-2" /> Gabung Teks
          </Button>
          <Button variant="outline-primary" disabled={!api || !outputFolder} onClick={viewMergedFile}>
            <i className="bi bi-eye me-2" /> View File
          </Button>
        </div>
      </Form>
      <ListGroup>
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