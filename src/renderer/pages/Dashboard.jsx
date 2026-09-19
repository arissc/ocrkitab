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

const FOLDER_LIST_MAX_HEIGHT = 160
const KITAB_PER_PAGE = 12

function getPaginationItems(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages = new Set([1, total, current, current - 1, current + 1])
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b)
  const items = []
  sorted.forEach((p, idx) => {
    if (idx > 0 && p - sorted[idx - 1] > 1) items.push(`ellipsis-${p}`)
    items.push(p)
  })
  return items
}

function Pagination({ currentPage, totalPages, onChange }) {
  if (totalPages <= 1) return null
  return (
    <nav aria-label="Navigasi halaman kitab">
      <ul className="pagination pagination-sm mb-0 flex-wrap">
        <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onChange(currentPage - 1)}>Sebelumnya</button>
        </li>
        {getPaginationItems(currentPage, totalPages).map(item => (
          typeof item === 'number' ? (
            <li key={item} className={`page-item ${item === currentPage ? 'active' : ''}`}>
              <button type="button" className="page-link" onClick={() => onChange(item)}>{item}</button>
            </li>
          ) : (
            <li key={item} className="page-item disabled">
              <span className="page-link">...</span>
            </li>
          )
        ))}
        <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onChange(currentPage + 1)}>Berikutnya</button>
        </li>
      </ul>
    </nav>
  )
}

function FolderLinkList({ folders, fallback, onOpenFolder, extraClassName = '' }) {
  const [expanded, setExpanded] = useState(false)
  const list = Array.isArray(folders) ? folders : []
  const hasFolders = list.length > 0
  const collapsible = list.length > 1

  return (
    <div className={extraClassName}>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <span>Folder:</span>
        {hasFolders ? (
          <>
            <Button
              variant="outline-secondary"
              size="sm"
              className="text-truncate"
              style={{ maxWidth: '100%' }}
              title={list[0]}
              onClick={(e) => { e.stopPropagation(); onOpenFolder?.(list[0]) }}
            >
              {list[0]}
            </Button>
            {collapsible && (
              <Button
                variant="outline-secondary"
                size="sm"
                title={expanded ? 'Sembunyikan folder lain' : `Tampilkan ${list.length - 1} folder lain`}
                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
              >
                <i className={`bi bi-chevron-${expanded ? 'up' : 'down'} me-1`} />
                {expanded ? 'Sembunyikan' : `+${list.length - 1} lainnya`}
              </Button>
            )}
          </>
        ) : (
          <span className="text-truncate">{fallback || 'Belum di-set'}</span>
        )}
      </div>
      {hasFolders && collapsible && expanded && (
        <div
          className="d-flex flex-column gap-2 mt-2 overflow-auto"
          style={{ maxHeight: FOLDER_LIST_MAX_HEIGHT }}
        >
          {list.slice(1).map(fp => (
            <Button
              key={fp}
              variant="outline-secondary"
              size="sm"
              className="text-truncate text-start"
              title={fp}
              onClick={(e) => { e.stopPropagation(); onOpenFolder?.(fp) }}
            >
              {fp}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ onOpenTranslate, onOpenCreateKitab, onOpenKitabDetail, onOpenDirectSplit }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [kitabs, setKitabs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('card') // 'card' | 'list'
  const [page, setPage] = useState(1)
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

  const findKitabByFolderPath = (folderPath, kitabId = null) => {
    if (!kitabs.length) return null
    if (kitabId) {
      const byId = kitabs.find(k => k.id === kitabId)
      if (byId) return byId
    }
    if (!folderPath) return null
    return kitabs.find(k => {
      if (k.folder_path === folderPath) return true
      if (Array.isArray(k.folders) && k.folders.includes(folderPath)) return true
      return false
    }) || null
  }

  const getKitabName = (folderPath) => {
    const found = findKitabByFolderPath(folderPath)
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

  const totalPages = Math.max(1, Math.ceil(filteredKitabs.length / KITAB_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pagedKitabs = filteredKitabs.slice((currentPage - 1) * KITAB_PER_PAGE, currentPage * KITAB_PER_PAGE)

  useEffect(() => {
    setPage(1)
  }, [normalizedSearchQuery, viewMode])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const changePage = (nextPage) => {
    const target = Math.min(Math.max(1, nextPage), totalPages)
    if (target === currentPage) return
    setPage(target)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openSplitWithKitab = (session, kitabId = null) => {
    if (!session || !session.folder || !session.file) return
    const resolved = findKitabByFolderPath(session.folder, kitabId || session.kitabId)
    onOpenDirectSplit?.({
      ...session,
      kitabId: resolved?.id || kitabId || session.kitabId || null
    })
  }

  const openKitabFromDashboard = (kitab) => {
    const session = getKitabLastSession(kitab)
    if (session && session.folder && session.file) {
      openSplitWithKitab(session, kitab.id)
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

      {filteredKitabs.length > 0 && (
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div className="small text-muted">
            Menampilkan {pagedKitabs.length} dari {filteredKitabs.length} kitab
            {totalPages > 1 ? ` • Halaman ${currentPage} / ${totalPages}` : ''}
          </div>
          <Pagination currentPage={currentPage} totalPages={totalPages} onChange={changePage} />
        </div>
      )}

      {lastOpened && (
        <Alert variant="info" className="d-flex justify-content-between align-items-center">
          <div>
            <strong>Lanjutkan Membaca:</strong> 
            <span className="ms-2">
              {lastKitabName ? <Badge bg="secondary" className="me-2">{lastKitabName}</Badge> : null}
              {lastOpened.marked ? <Badge bg="warning" text="dark" className="me-2">Ditandai</Badge> : null}
              {lastOpened.file.split('\\').pop()}
            </span>
            <div className="text-muted small">Terakhir dibuka: {new Date(lastOpened.timestamp).toLocaleString()}</div>
          </div>
          <Button variant="info" size="sm" onClick={() => openSplitWithKitab(lastOpened, lastOpened.kitabId)}>
            Buka <i className="bi bi-arrow-right ms-1"></i>
          </Button>
        </Alert>
      )}

      {viewMode === 'card' && (
        <Row xs={1} md={2} lg={3} className="g-3">
          {pagedKitabs.map(k => (
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
                      <>
                        <Badge bg="info" text="dark">{getPageLabel(getKitabLastSession(k).file)}</Badge>
                        {getKitabLastSession(k).marked ? <Badge bg="warning" text="dark">Ditandai</Badge> : null}
                      </>
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
                  <FolderLinkList
                    folders={k.folders}
                    fallback={k.folder_path}
                    onOpenFolder={onOpenTranslate}
                  />
                </Card.Footer>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {viewMode === 'list' && (
        <ListGroup>
          {pagedKitabs.map(k => (
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
                      <>
                        <Badge bg="info" text="dark">{getPageLabel(getKitabLastSession(k).file)}</Badge>
                        {getKitabLastSession(k).marked ? <Badge bg="warning" text="dark">Ditandai</Badge> : null}
                      </>
                    ) : null}
                  </div>
                  <div className="text-muted small">{k.pengarang || 'Tanpa pengarang'} • {new Date(k.created_at).toLocaleString()}</div>
                  {k.keterangan && <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{k.keterangan}</div>}
                  {getKitabLastSession(k) && (
                    <div className="small text-muted mt-1">
                      Terakhir dibaca: {getFileName(getKitabLastSession(k).file)} {getFolderTail(getKitabLastSession(k).folder)} • {new Date(getKitabLastSession(k).timestamp).toLocaleString()}
                    </div>
                  )}
                  <FolderLinkList
                    extraClassName="small"
                    folders={k.folders}
                    fallback={k.folder_path}
                    onOpenFolder={onOpenTranslate}
                  />
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

      {filteredKitabs.length > 0 && (
        <div className="d-flex justify-content-end">
          <Pagination currentPage={currentPage} totalPages={totalPages} onChange={changePage} />
        </div>
      )}
    </div>
  )
}
