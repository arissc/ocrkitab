import React, { useMemo, useState } from 'react'
import { Form, Button, InputGroup, Alert, ListGroup, Row, Col } from 'react-bootstrap'

export default function PdfSplitTrimPage() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [pdfPath, setPdfPath] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [ranges, setRanges] = useState([{ from: '1', to: '1', name: '' }])
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeVariant, setNoticeVariant] = useState('info')
  const [outputs, setOutputs] = useState([])

  const canRun = useMemo(() => {
    if (!api || !api.splitPdf) return false
    if (!pdfPath || !outputFolder) return false
    if (!Array.isArray(ranges) || ranges.length === 0) return false
    const parsed = ranges
      .map(r => ({
        from: parseInt(String(r.from || ''), 10),
        to: parseInt(String(r.to || ''), 10)
      }))
      .filter(r => Number.isFinite(r.from) && Number.isFinite(r.to))
    return parsed.length > 0
  }, [api, pdfPath, outputFolder, ranges])

  const pickPdf = async () => {
    if (!api || !api.selectPdf) { setNoticeVariant('warning'); setNotice('Not available in browser preview.'); return }
    const file = await api.selectPdf()
    if (file) setPdfPath(file)
  }

  const pickOutput = async () => {
    if (!api || !api.selectFolder) return
    const dir = await api.selectFolder(outputFolder)
    if (dir) setOutputFolder(dir)
  }

  const addRange = () => {
    setRanges(prev => [...prev, { from: '', to: '', name: '' }])
  }

  const removeRange = (idx) => {
    setRanges(prev => prev.filter((_, i) => i !== idx))
  }

  const updateRange = (idx, patch) => {
    setRanges(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const run = async () => {
    if (!api || !api.splitPdf) { setNoticeVariant('warning'); setNotice('PDF split is only available in Electron.'); return }
    if (!pdfPath || !outputFolder) { setNoticeVariant('warning'); setNotice('Pick a PDF and an output folder first.'); return }

    const cleaned = (ranges || [])
      .map((r) => {
        const from = parseInt(String(r.from || '').trim(), 10)
        const to = parseInt(String(r.to || '').trim(), 10)
        const name = String(r.name || '').trim()
        if (!Number.isFinite(from) || !Number.isFinite(to)) return null
        return { from, to, name }
      })
      .filter(Boolean)

    if (cleaned.length === 0) { setNoticeVariant('warning'); setNotice('Add at least one valid page range.'); return }

    setRunning(true)
    setNoticeVariant('info')
    setNotice('Splitting PDF…')
    setOutputs([])

    const res = await api.splitPdf({ pdfPath, outputFolder, ranges: cleaned })
    if (res?.ok) {
      setOutputs(res.outputs || [])
      setNoticeVariant('success')
      setNotice(`Done. Created ${(res.outputs || []).length} file(s).`)
    } else {
      setNoticeVariant('danger')
      setNotice(`Failed: ${res?.error || 'Unknown error'}`)
    }
    setRunning(false)
  }

  const openOutput = async () => {
    if (!api || !api.openExplorer || !outputFolder) return
    await api.openExplorer(outputFolder)
  }

  return (
    <>
      {notice && <Alert variant={noticeVariant} className="mb-3">{notice}</Alert>}

      <Form>
        <Form.Group className="mb-3">
          <Form.Label>Select PDF</Form.Label>
          <InputGroup>
            <Form.Control value={pdfPath} onChange={e => setPdfPath(e.target.value)} />
            <Button variant="secondary" onClick={pickPdf} disabled={!api}>Browse</Button>
          </InputGroup>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Output folder</Form.Label>
          <InputGroup>
            <Form.Control value={outputFolder} onChange={e => setOutputFolder(e.target.value)} />
            <Button variant="secondary" onClick={pickOutput} disabled={!api}>Select Folder</Button>
          </InputGroup>
        </Form.Group>

        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-semibold">Page ranges</div>
          <Button variant="outline-primary" size="sm" onClick={addRange}>Add Range</Button>
        </div>

        <ListGroup className="mb-3">
          {ranges.map((r, idx) => (
            <ListGroup.Item key={idx}>
              <Row className="g-2 align-items-end">
                <Col xs={12} md={3}>
                  <Form.Label className="small text-muted">From page</Form.Label>
                  <Form.Control value={r.from} onChange={(e) => updateRange(idx, { from: e.target.value })} inputMode="numeric" />
                </Col>
                <Col xs={12} md={3}>
                  <Form.Label className="small text-muted">To page</Form.Label>
                  <Form.Control value={r.to} onChange={(e) => updateRange(idx, { to: e.target.value })} inputMode="numeric" />
                </Col>
                <Col xs={12} md={4}>
                  <Form.Label className="small text-muted">Output name (optional)</Form.Label>
                  <Form.Control value={r.name} onChange={(e) => updateRange(idx, { name: e.target.value })} placeholder="e.g. bab-1" />
                </Col>
                <Col xs={12} md={2} className="d-flex">
                  <Button variant="outline-danger" className="w-100" onClick={() => removeRange(idx)} disabled={ranges.length <= 1}>
                    Remove
                  </Button>
                </Col>
              </Row>
            </ListGroup.Item>
          ))}
        </ListGroup>

        <div className="d-flex gap-2 mb-3">
          <Button variant="primary" onClick={run} disabled={!canRun || running}>
            {running ? 'Working…' : 'Split / Trim'}
          </Button>
          <Button variant="outline-secondary" onClick={openOutput} disabled={!api || !outputFolder}>
            Open Output Folder
          </Button>
        </div>

        {outputs.length > 0 && (
          <>
            <div className="text-muted small mb-2">Created files:</div>
            <ListGroup>
              {outputs.map((o, i) => (
                <ListGroup.Item key={i}>{o.outputPath || String(o)}</ListGroup.Item>
              ))}
            </ListGroup>
          </>
        )}
      </Form>
    </>
  )
}

