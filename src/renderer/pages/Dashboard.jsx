import React, { useEffect, useState } from 'react'
import { Row, Col, Card, ListGroup, Button, Form, Alert, Spinner, Badge } from 'react-bootstrap'

const getFileName = (filePath) => {
  if (!filePath) return ''
  return String(filePath).split(/[/\\]/).pop() || ''
}

const getFolderTail = (folderPath) => {
  if (!folderPath) return ''
  const parts = String(folderPath).split(/[/\\]/).filter(Boolean)
  const tail = parts[parts.length - 1] || ''
  return tail ? `\\${tail}` : ''
}

const getPageLabel = (filePath) => {
  const fileName = getFileName(filePath)
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const match = baseName.match(/(\d+)(?!.*\d)/)
  return match ? `Hal. ${match[1]}` : fileName
}

export default function Dashboard({ onOpenTranslate, onOpenCreateKitab, onOpenKitabDetail, onOpenDirectSplit }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [kitabs, setKitabs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('card') // 'card' | 'list'
  const [lastOpened, setLastOpened] = useState(null)
  const [lastOpenedSessions, setLastOpenedSessions] = useState({})

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
    const loadLastSession = async () => {
      if (api) {
        try {
          const settings = await api.getSettings()
          if (settings && settings.lastOpenedSplit) {
            setLastOpened(settings.lastOpenedSplit)
          }
          setLastOpenedSessions(settings && settings.lastOpenedKitabSessions && typeof settings.lastOpenedKitabSessions === 'object'
            ? settings.lastOpenedKitabSessions
            : {})
        } catch (e) {
          console.error("Failed to load last opened split", e)
        }
      }
    }
    loadLastSession()
  }, [])

  const getKitabName = (folderPath) => {
    if (!folderPath || kitabs.length === 0) return null
    const found = kitabs.find(k => {
       if (k.folder_path === folderPath) return true
       if (Array.isArray(k.folders) && k.folders.includes(folderPath)) return true
       return false
    })
    return found ? found.nama_kitab : null
  }

  const lastKitabName = lastOpened ? getKitabName(lastOpened.folder) : null

  const getKitabLastSession = (kitab) => {
    if (!kitab) return null
    const folders = Array.isArray(kitab.folders) && kitab.folders.length > 0
      ? kitab.folders
      : (kitab.folder_path ? [kitab.folder_path] : [])
    const sessions = folders
      .map(fp => lastOpenedSessions[fp])
      .filter(s => s && s.file)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    return sessions[0] || null
  }

  const getSessionTimestamp = (session) => {
    if (!session) return 0
    const ts = Number(session.timestamp)
    return Number.isFinite(ts) ? ts : 0
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredKitabs = (normalizedSearchQuery
    ? kitabs.filter((kitab) => {
      const searchableFields = [
        kitab.nama_kitab,
        kitab.pengarang,
        kitab.keterangan
      ]
      return searchableFields.some(value => String(value || '').toLowerCase().includes(normalizedSearchQuery))
    })
    : [...kitabs]
  ).sort((a, b) => {
    const sessionA = getKitabLastSession(a)
    const sessionB = getKitabLastSession(b)
    const hasA = Boolean(sessionA)
    const hasB = Boolean(sessionB)
    // Kitab dengan last page selalu di atas yang belum pernah dibaca
    if (hasA !== hasB) return hasA ? -1 : 1
    const tsA = getSessionTimestamp(sessionA)
    const tsB = getSessionTimestamp(sessionB)
    if (tsA !== tsB) return tsB - tsA
    return String(a.nama_kitab || '').localeCompare(String(b.nama_kitab || ''))
  })

  const openKitabFromDashboard = (kitab) => {
    const session = getKitabLastSession(kitab)
    if (session && session.folder && session.file) {
      onOpenDirectSplit?.(session)
      return
    }
    onOpenKitabDetail?.(kitab.id)
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center">
        <div className="h5 mb-0">Dashboard</div>
        <div className="d-flex gap-2">
          <Button variant="success" size="sm" onClick={() => onOpenCreateKitab?.()}>
            <i className="bi bi-plus-lg me-1" /> Tambah Kitab
          </Button>
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

      <Form.Group controlId="dashboardSearch">
        <Form.Control
          type="search"
          placeholder="Cari judul kitab, pengarang, atau keterangan..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </Form.Group>

      {error && <Alert variant="danger">{error}</Alert>}
      {!error && kitabs.length === 0 && !loading && (
        <Alert variant="info">Belum ada data kitab di database.</Alert>
      )}
      {!error && kitabs.length > 0 && filteredKitabs.length === 0 && !loading && (
        <Alert variant="warning">Tidak ada kitab yang cocok dengan pencarian.</Alert>
      )}

      {lastOpened && (
        <Alert variant="info" className="d-flex justify-content-between align-items-center">
          <div>
            <strong>Lanjutkan Membaca:</strong> 
            <span className="ms-2">
              {lastKitabName ? <Badge bg="secondary" className="me-2">{lastKitabName}</Badge> : null}
              {lastOpened.file.split('\\').pop()}
            </span>
            <div className="text-muted small">Terakhir dibuka: {new Date(lastOpened.timestamp).toLocaleString()}</div>
          </div>
          <Button variant="info" size="sm" onClick={() => onOpenDirectSplit?.(lastOpened)}>
            Buka <i className="bi bi-arrow-right ms-1"></i>
          </Button>
        </Alert>
      )}

      {viewMode === 'card' && (
        <Row xs={1} md={2} lg={3} className="g-3">
          {filteredKitabs.map(k => (
            <Col key={k.id}>
              <Card className="h-100" role="button" style={{ cursor: 'pointer' }} onClick={() => openKitabFromDashboard(k)}>
                <Card.Body>
                  <Card.Title className="mb-1 d-flex flex-wrap align-items-center gap-2">
                    <Button
                      variant="link"
                      className="p-0 text-decoration-none fw-semibold text-start"
                      onClick={(e) => {
                        e.stopPropagation()
                        openKitabFromDashboard(k)
                      }}
                    >
                      {k.nama_kitab}
                    </Button>
                    {getKitabLastSession(k) ? (
                      <Badge bg="info" text="dark">{getPageLabel(getKitabLastSession(k).file)}</Badge>
                    ) : null}
                  </Card.Title>
                  <Card.Subtitle className="text-muted small mb-2">{k.pengarang || 'Tanpa pengarang'}</Card.Subtitle>
                  <Card.Text className="small" style={{ whiteSpace: 'pre-wrap' }}>{k.keterangan || '-'}</Card.Text>
                  {getKitabLastSession(k) && (
                    <div className="small text-muted">
                      Terakhir dibaca: {getFileName(getKitabLastSession(k).file)} {getFolderTail(getKitabLastSession(k).folder)} • {new Date(getKitabLastSession(k).timestamp).toLocaleString()}
                    </div>
                  )}
                </Card.Body>
                <Card.Footer className="text-muted small">
                  <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                    <span>{getKitabLastSession(k) ? 'Klik nama kitab untuk lanjut baca' : 'Klik nama kitab untuk buka detail'}</span>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenKitabDetail?.(k.id)
                      }}
                    >
                      Detail
                    </Button>
                  </div>
                  <div>Dibuat: {new Date(k.created_at).toLocaleString()}</div>
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <span>Folder:</span>
                    {Array.isArray(k.folders) && k.folders.length > 0 ? (
                      k.folders.map(fp => (
                        <Button key={fp} variant="outline-secondary" size="sm" onClick={(e) => { e.stopPropagation(); onOpenTranslate?.(fp) }}>
                          {fp}
                        </Button>
                      ))
                    ) : (
                      <span>{k.folder_path || 'Belum di-set'}</span>
                    )}
                  </div>
                </Card.Footer>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {viewMode === 'list' && (
        <ListGroup>
          {filteredKitabs.map(k => (
            <ListGroup.Item key={k.id} action onClick={() => openKitabFromDashboard(k)}>
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <Button
                      variant="link"
                      className="p-0 text-decoration-none fw-semibold text-start"
                      onClick={(e) => {
                        e.stopPropagation()
                        openKitabFromDashboard(k)
                      }}
                    >
                      {k.nama_kitab}
                    </Button>
                    {getKitabLastSession(k) ? (
                      <Badge bg="info" text="dark">{getPageLabel(getKitabLastSession(k).file)}</Badge>
                    ) : null}
                  </div>
                  <div className="text-muted small">{k.pengarang || 'Tanpa pengarang'} • {new Date(k.created_at).toLocaleString()}</div>
                  {k.keterangan && <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{k.keterangan}</div>}
                  {getKitabLastSession(k) && (
                    <div className="small text-muted mt-1">
                      Terakhir dibaca: {getFileName(getKitabLastSession(k).file)} {getFolderTail(getKitabLastSession(k).folder)} • {new Date(getKitabLastSession(k).timestamp).toLocaleString()}
                    </div>
                  )}
                  <div className="small d-flex flex-wrap gap-2 align-items-center">
                    <span>Folder:</span>
                    {Array.isArray(k.folders) && k.folders.length > 0 ? (
                      k.folders.map(fp => (
                        <Button key={fp} variant="outline-secondary" size="sm" onClick={(e) => { e.stopPropagation(); onOpenTranslate?.(fp) }}>
                          {fp}
                        </Button>
                      ))
                    ) : (
                      <span>{k.folder_path || 'Belum di-set'}</span>
                    )}
                  </div>
                </div>
                <div className="ms-3">
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenKitabDetail?.(k.id)
                    }}
                  >
                    Detail
                  </Button>
                </div>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  )
}
