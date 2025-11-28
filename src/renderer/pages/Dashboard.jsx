import React, { useEffect, useState } from 'react'
import { Row, Col, Card, ListGroup, Button, Form, Alert, Spinner } from 'react-bootstrap'

export default function Dashboard({ onOpenTranslate }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [kitabs, setKitabs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState('card') // 'card' | 'list'

  const fetchKitabs = async () => {
    if (!api || !api.listKitabs) {
      setError('Database IPC tidak tersedia. Buka via Electron.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api.listKitabs()
      if (res && res.ok) {
        setKitabs(res.data || [])
      } else {
        throw new Error(res?.error || 'Gagal memuat daftar kitab')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKitabs()
  }, [])

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center">
        <div className="h5 mb-0">Dashboard</div>
        <div className="d-flex gap-2">
          <Button variant={viewMode === 'card' ? 'primary' : 'outline-primary'} size="sm" onClick={() => setViewMode('card')}>
            <i className="bi bi-grid-3x3-gap me-1" /> Card View
          </Button>
          <Button variant={viewMode === 'list' ? 'primary' : 'outline-primary'} size="sm" onClick={() => setViewMode('list')}>
            <i className="bi bi-list-ul me-1" /> List View
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={fetchKitabs} disabled={loading}>
            {loading ? (<><Spinner animation="border" size="sm" className="me-1" /> Loading...</>) : (<><i className="bi bi-arrow-clockwise me-1" /> Refresh</>)}
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {!error && kitabs.length === 0 && !loading && (
        <Alert variant="info">Belum ada data kitab di database.</Alert>
      )}

      {viewMode === 'card' && (
        <Row xs={1} md={2} lg={3} className="g-3">
          {kitabs.map(k => (
            <Col key={k.id}>
              <Card className="h-100" role="button" onClick={() => { if (k.folder_path) onOpenTranslate?.(k.folder_path) }}>
                <Card.Body>
                  <Card.Title className="mb-1">{k.nama_kitab}</Card.Title>
                  <Card.Subtitle className="text-muted small mb-2">{k.pengarang || 'Tanpa pengarang'}</Card.Subtitle>
                  <Card.Text className="small" style={{ whiteSpace: 'pre-wrap' }}>{k.keterangan || '-'}</Card.Text>
                </Card.Body>
                <Card.Footer className="text-muted small">
                  <div>Dibuat: {new Date(k.created_at).toLocaleString()}</div>
                  <div>Folder: {k.folder_path || 'Belum di-set'}</div>
                </Card.Footer>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {viewMode === 'list' && (
        <ListGroup>
          {kitabs.map(k => (
            <ListGroup.Item key={k.id} action onClick={() => { if (k.folder_path) onOpenTranslate?.(k.folder_path) }}>
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <div className="fw-semibold">{k.nama_kitab}</div>
                  <div className="text-muted small">{k.pengarang || 'Tanpa pengarang'} • {new Date(k.created_at).toLocaleString()}</div>
                  {k.keterangan && <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{k.keterangan}</div>}
                  <div className="small">Folder: {k.folder_path || 'Belum di-set'}</div>
                </div>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  )
}