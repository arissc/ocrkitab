import React, { useState } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles.css'
import { Container, Alert, Row, Col, Navbar, Form, Button, Card } from 'react-bootstrap'
import Sidebar from './Sidebar'
import PdfToImagePage from './pages/PdfToImagePage'
import PdfSplitTrimPage from './pages/PdfSplitTrimPage'
import OCRPage from './pages/OCRPage'
import GetTextPage from './pages/GetTextPage'
import TranslatePage from './pages/TranslatePage'
import KitabDetailPage from './pages/KitabDetailPage'
import Dashboard from './pages/Dashboard'
import CreateKitabPage from './pages/CreateKitabPage'
import SplitViewPage from './pages/SplitViewPage'
import SearchPage from './pages/SearchPage'
import SettingsPage from './pages/SettingsPage'
import AIChatPage from './pages/AIChatPage'

const DEFAULT_CREATE_KITAB_DRAFT = {
  nama_kitab: '',
  pengarang: '',
  keterangan: '',
  folder_pairs: []
}

const KITAB_TOOLS = [
  {
    view: 'translate',
    title: 'Kitab Reader',
    icon: 'bi bi-translate',
    description: 'Buka kitab reader dan lanjutkan proses baca atau terjemah.'
  },
  {
    view: 'ai_chat',
    title: 'AI Chat',
    icon: 'bi bi-chat-dots',
    description: 'Akses percakapan AI untuk bantu kerja teks dan kitab.'
  },
  {
    view: 'pdf',
    title: 'PDF to Image',
    icon: 'bi bi-file-earmark-image',
    description: 'Ubah file PDF menjadi gambar untuk proses berikutnya.'
  },
  {
    view: 'pdf_split',
    title: 'PDF Split / Trim',
    icon: 'bi bi-scissors',
    description: 'Pisah atau potong halaman PDF sesuai kebutuhan.'
  },
  {
    view: 'ocr',
    title: 'OCR',
    icon: 'bi bi-filetype-txt',
    description: 'Ekstrak teks dari gambar atau hasil scan.'
  },
  {
    view: 'gettext',
    title: 'Get Text',
    icon: 'bi bi-journal-text',
    description: 'Ambil dan rapikan teks dari sumber yang tersedia.'
  }
]

function KitabToolsPanel({ onNavigate }) {
  return (
    <div>
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 mb-4">
        <div>
          <h3 className="mb-1">Kitab Tools</h3>
          <div className="text-muted">Semua menu tool dipindahkan ke panel ini tanpa menghapus halaman yang sudah ada.</div>
        </div>
      </div>
      <Row className="g-3">
        {KITAB_TOOLS.map((tool) => (
          <Col key={tool.view} xs={12} md={6} xl={4}>
            <Card className="h-100 border-0 shadow-sm tool-panel-card" role="button" onClick={() => onNavigate(tool.view)}>
              <Card.Body className="d-flex flex-column gap-3">
                <div className="d-flex align-items-start gap-3">
                  <div className="tool-panel-icon">
                    <i className={tool.icon} />
                  </div>
                  <div>
                    <Card.Title className="mb-1">{tool.title}</Card.Title>
                    <Card.Text className="text-muted mb-0">{tool.description}</Card.Text>
                  </div>
                </div>
                <div className="mt-auto">
                  <Button variant="outline-primary" size="sm" onClick={(e) => { e.stopPropagation(); onNavigate(tool.view) }}>
                    Open Menu
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}

export default function App() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [view, setView] = useState('dashboard') // 'dashboard' | 'pdf' | 'ocr' | 'gettext' | 'translate' | 'settings' | 'create_kitab' | 'kitab_detail'
  const [selectedFolder, setSelectedFolder] = useState('')
  const [selectedKitabId, setSelectedKitabId] = useState(null)
  const [selectedKitabFolder, setSelectedKitabFolder] = useState('')
  const [selectedKitabFile, setSelectedKitabFile] = useState('')
  const [createKitabDraft, setCreateKitabDraft] = useState(DEFAULT_CREATE_KITAB_DRAFT)
  const [pdfGenerateFlow, setPdfGenerateFlow] = useState({ pdfPath: '', outputFolder: '', textFolder: '' })
  const [ocrGenerateFlow, setOcrGenerateFlow] = useState({ inputFolder: '', outputFolder: '' })
  const [splitData, setSplitData] = useState({ folder: '', file: '', imageFolder: '', origin: 'translate', originKitabId: null })
  const [splitFullView, setSplitFullView] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('sidebarCollapsed')
      return v === 'true'
    }
    return false
  })
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'light'
    }
    return 'light'
  })
  const [globalStatus, setGlobalStatus] = useState({ ocr: { running: false, index: 0, total: 0, lastFile: null }, translate: { running: false, provider: null, model: null, attempt: 0 } })

  const openSplitView = async (payload = {}, origin = 'translate', kitabId = null) => {
    const folder = payload.folder || ''
    const file = payload.file || ''
    const imageFolder = payload.imageFolder || ''
    let nextKitabId = payload.kitabId || payload.originKitabId || kitabId || null
    if (!nextKitabId && folder && origin !== 'search' && api?.findKitabByFolder) {
      try {
        const res = await api.findKitabByFolder(folder)
        if (res?.ok && res.data?.id) nextKitabId = res.data.id
      } catch (_) {}
    }
    if (nextKitabId) setSelectedKitabId(nextKitabId)
    if (folder) {
      setSelectedFolder(folder)
      setSelectedKitabFolder(folder)
    }
    if (file) setSelectedKitabFile(file)
    const nextOrigin = origin === 'dashboard' && nextKitabId ? 'kitab_detail' : origin
    setSplitData({
      folder,
      file,
      imageFolder,
      origin: nextOrigin,
      originKitabId: nextKitabId
    })
    setView('split')
  }

  const restoreKitabContext = ({ folder = '', file = '', kitabId = null } = {}) => {
    if (kitabId) setSelectedKitabId(kitabId)
    if (folder) {
      setSelectedFolder(folder)
      setSelectedKitabFolder(folder)
    }
    if (file) setSelectedKitabFile(file)
  }

  const goBackFromSplit = async (current = {}) => {
    const payload = current && typeof current === 'object' && !current.nativeEvent ? current : {}
    const origin = payload.origin || splitData.origin
    const folder = payload.folder || splitData.folder || ''
    const file = payload.file || splitData.file || ''
    const imageFolder = payload.imageFolder || splitData.imageFolder || ''
    let kitabId = payload.kitabId || payload.originKitabId || splitData.originKitabId || null

    setSplitData({
      folder,
      file,
      imageFolder,
      origin,
      originKitabId: kitabId
    })

    if (origin === 'search') {
      restoreKitabContext({ folder, file, kitabId })
      setView('search')
      return
    }

    if (!kitabId && folder && api?.findKitabByFolder) {
      try {
        const res = await api.findKitabByFolder(folder)
        if (res?.ok && res.data?.id) kitabId = res.data.id
      } catch (_) {}
    }

    if (kitabId) {
      restoreKitabContext({ folder, file, kitabId })
      setSplitData((prev) => ({ ...prev, originKitabId: kitabId, origin: origin === 'search' ? origin : 'kitab_detail' }))
      setView('kitab_detail')
      return
    }

    if (folder) {
      restoreKitabContext({ folder, file })
      setView('translate')
      return
    }

    setView(origin === 'dashboard' ? 'dashboard' : 'translate')
  }

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-bs-theme', theme)
      try { localStorage.setItem('theme', theme) } catch {}
    }
  }, [theme])

  React.useEffect(() => {
    try { localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? 'true' : 'false') } catch {}
  }, [sidebarCollapsed])

  React.useEffect(() => {
    if (view !== 'split') setSplitFullView(false)
  }, [view])

  React.useEffect(() => {
    if (!api) return
    api.getOcrStatus && api.getOcrStatus().then(st => {
      if (st && st.running) {
        setGlobalStatus(s => ({ ...s, ocr: { running: true, index: st.completed || 0, total: st.total || 0, lastFile: st.lastFile || null } }))
      }
    })
    api.getTranslateStatus && api.getTranslateStatus().then(st => {
      if (!st) return
      setGlobalStatus(s => ({ ...s, translate: { running: !!st.running, provider: st.provider || null, model: st.model || null, attempt: st.attempt || 0, fileName: st.fileName || null, page: st.page || null, queueLength: st.queueLength || 0 } }))
    })
    const off1 = api.onOcrProgress?.((p) => {
      setGlobalStatus(s => ({ ...s, ocr: { running: true, index: p.index || 0, total: p.total || 0, lastFile: p.file || null } }))
    })
    const off2 = api.onOcrComplete?.((_p) => {
      setGlobalStatus(s => ({ ...s, ocr: { running: false, index: 0, total: 0, lastFile: null } }))
    })
    const off3 = api.onTranslateStatus?.((t) => {
      setGlobalStatus(s => ({
        ...s,
        translate: {
          running: !!t.running,
          provider: t.provider || null,
          model: t.model || null,
          attempt: t.attempt || 0,
          fileName: t.fileName || null,
          page: t.page || null,
          queueLength: t.queueLength || 0
        }
      }))
    })
    return () => {
      off1 && off1()
      off2 && off2()
      off3 && off3()
    }
  }, [])

  const openNewWindow = async () => {
    try {
      await api?.openNewWindow?.()
    } catch (_) {}
  }

  return (
    <Container fluid className={`${splitFullView ? 'p-0' : 'py-3'} d-flex flex-column vh-100 bg-body-tertiary`}>
      {!splitFullView && (
        <Navbar bg="body-tertiary" className="mb-3 border-bottom">
          <Container fluid>
            <Navbar.Brand className="fw-semibold">Universe Reader</Navbar.Brand>
            {(globalStatus.ocr.running || globalStatus.translate.running) && (
              <div className="d-flex align-items-center gap-2">
                {globalStatus.ocr.running && (
                  <span className="badge text-bg-warning">
                    <span className="me-2"><i className="bi bi-activity" /></span>
                    OCR {globalStatus.ocr.index}/{globalStatus.ocr.total} {globalStatus.ocr.lastFile ? `(${globalStatus.ocr.lastFile})` : ''}
                  </span>
                )}
                {globalStatus.translate.running && (
                  <span className="badge text-bg-info">
                    <span className="me-2"><i className="bi bi-stars" /></span>
                    Translating {globalStatus.translate.provider}{globalStatus.translate.model ? ` • ${globalStatus.translate.model}` : ''}{globalStatus.translate.attempt ? ` • try ${globalStatus.translate.attempt}` : ''}{globalStatus.translate.fileName ? ` • ${globalStatus.translate.fileName}${globalStatus.translate.page ? ' (p' + globalStatus.translate.page + ')' : ''}` : ''}{globalStatus.translate.queueLength ? ` • queue ${globalStatus.translate.queueLength}` : ''}
                  </span>
                )}
              </div>
            )}
            <div className="d-flex align-items-center gap-2">
              <Button variant="outline-secondary" size="sm" disabled={!api?.openNewWindow} onClick={openNewWindow}>
                <i className="bi bi-window-plus me-1" /> Open in new window
              </Button>
              <Form.Check
                type="switch"
                id="themeSwitch"
                label={theme === 'dark' ? 'Dark' : 'Light'}
                checked={theme === 'dark'}
                onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              />
            </div>
          </Container>
        </Navbar>
      )}
      {!splitFullView && !api && (
        <Alert variant="warning" className="mb-3">Preview di browser: beberapa fitur nonaktif. Buka via Electron.</Alert>
      )}
      <Row className={`flex-fill min-h-0 ${splitFullView ? 'g-0' : ''}`}>
        {!splitFullView && (
          <Col xs={sidebarCollapsed ? 1 : 3} md={sidebarCollapsed ? 1 : 3} lg={sidebarCollapsed ? 1 : 3} className={`mb-3 mb-md-0 app-sidebar rounded-3 border sticky-sidebar ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
            <Sidebar currentView={view} onNavigate={setView} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
          </Col>
        )}
        <Col
          xs={splitFullView ? 12 : (sidebarCollapsed ? 11 : 9)}
          md={splitFullView ? 12 : (sidebarCollapsed ? 11 : 9)}
          lg={splitFullView ? 12 : (sidebarCollapsed ? 11 : 9)}
          className={`d-flex flex-column ${splitFullView ? 'h-100' : ''}`}
        >
          <div className={`app-content flex-grow-1 ${splitFullView ? 'p-3 border-0 rounded-0 overflow-hidden d-flex flex-column' : 'p-3 rounded-3 border overflow-auto'}`}>
            {view === 'dashboard' && (
              <Dashboard
                onOpenTranslate={(folderPath) => {
                  if (folderPath) setSelectedFolder(folderPath)
                  setView('translate')
                }}
                onOpenCreateKitab={() => {
                  setCreateKitabDraft(DEFAULT_CREATE_KITAB_DRAFT)
                  setPdfGenerateFlow({ pdfPath: '', outputFolder: '', textFolder: '' })
                  setOcrGenerateFlow({ inputFolder: '', outputFolder: '' })
                  setView('create_kitab')
                }}
                onOpenKitabDetail={(id) => { setSelectedKitabId(id); setSelectedKitabFolder(''); setSelectedKitabFile(''); setView('kitab_detail') }}
                onOpenDirectSplit={(data) => {
                  if (data && data.folder && data.file) {
                    openSplitView(data, 'dashboard', data.kitabId || data.originKitabId || null)
                  }
                }}
              />
            )}
            {view === 'kitab_tools' && <KitabToolsPanel onNavigate={setView} />}
            {view === 'pdf' && <PdfToImagePage />}
            {view === 'pdf_generate' && (
              <PdfToImagePage
                initialPdfPath={pdfGenerateFlow.pdfPath}
                initialOutputFolder={pdfGenerateFlow.outputFolder}
                flowMode="create_kitab_generate"
                onBack={() => setView('create_kitab')}
                onContinue={() => {
                  setOcrGenerateFlow({
                    inputFolder: pdfGenerateFlow.outputFolder,
                    outputFolder: pdfGenerateFlow.textFolder
                  })
                  setView('ocr_generate')
                }}
              />
            )}
            {view === 'pdf_split' && <PdfSplitTrimPage />}
            {view === 'ocr' && <OCRPage />}
            {view === 'ocr_generate' && (
              <OCRPage
                initialInputFolder={ocrGenerateFlow.inputFolder}
                initialOutputFolder={ocrGenerateFlow.outputFolder}
                flowMode="create_kitab_generate"
                onBack={() => setView('create_kitab')}
              />
            )}
            {view === 'gettext' && <GetTextPage />}
            {view === 'ai_chat' && <AIChatPage />}
            {view === 'translate' && (
              <TranslatePage
                initialFolder={selectedFolder}
                initialFile={selectedKitabFile}
                onOpenSplit={(payload) => {
                  openSplitView(payload || {}, 'translate')
                }}
              />
            )}
            {view === 'split' && (
              <SplitViewPage 
                initialFolder={splitData.folder} 
                initialFile={splitData.file} 
                initialImageFolder={splitData.imageFolder}
                originKitabId={splitData.originKitabId}
                onBack={goBackFromSplit}
                onFullViewChange={setSplitFullView}
              />
            )}
            {view === 'settings' && <SettingsPage />}
            {view === 'create_kitab' && (
              <CreateKitabPage
                draft={createKitabDraft}
                onDraftChange={setCreateKitabDraft}
                onBack={() => setView('dashboard')}
                onCreated={() => {
                  setCreateKitabDraft(DEFAULT_CREATE_KITAB_DRAFT)
                  setPdfGenerateFlow({ pdfPath: '', outputFolder: '', textFolder: '' })
                  setOcrGenerateFlow({ inputFolder: '', outputFolder: '' })
                  setView('dashboard')
                }}
                onStartGenerateFlow={(payload) => {
                  const nextDraft = payload?.draft || createKitabDraft
                  setCreateKitabDraft(nextDraft)
                  setPdfGenerateFlow({
                    pdfPath: payload?.pdfPath || '',
                    outputFolder: payload?.outputFolder || '',
                    textFolder: payload?.textFolder || ''
                  })
                  setView('pdf_generate')
                }}
              />
            )}
            {view === 'kitab_detail' && (
              <KitabDetailPage
                kitabId={selectedKitabId}
                initialFolder={selectedKitabFolder}
                initialFile={selectedKitabFile}
                onBack={() => setView('dashboard')}
                onOpenTranslate={(fp) => { setSelectedFolder(fp); setView('translate') }}
                onOpenSplit={(payload) => {
                  openSplitView(payload || {}, 'kitab_detail', selectedKitabId)
                }}
              />
            )}
            {view === 'search' && (
              <SearchPage
                onOpenSplit={(payload) => {
                  openSplitView(payload || {}, 'search', payload?.kitabId || null)
                }}
              />
            )}
          </div>
          {!splitFullView && (globalStatus.ocr.running || globalStatus.translate.running) && (
            <div className="position-fixed bottom-0 end-0 m-3" style={{ zIndex: 1040 }}>
              <Alert variant={globalStatus.ocr.running ? 'warning' : 'info'} className="shadow">
                <div className="d-flex align-items-center gap-2">
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  <div className="small">
                    {globalStatus.ocr.running
                      ? `OCR sedang berjalan ${globalStatus.ocr.index}/${globalStatus.ocr.total}${globalStatus.ocr.lastFile ? ' • ' + globalStatus.ocr.lastFile : ''}`
                      : `Translating ${globalStatus.translate.provider}${globalStatus.translate.model ? ' • ' + globalStatus.translate.model : ''}${globalStatus.translate.attempt ? ' • try ' + globalStatus.translate.attempt : ''}${globalStatus.translate.fileName ? ' • ' + globalStatus.translate.fileName + (globalStatus.translate.page ? ' (p' + globalStatus.translate.page + ')' : '') : ''}${globalStatus.translate.queueLength ? ' • queue ' + globalStatus.translate.queueLength : ''}`}
                  </div>
                </div>
              </Alert>
            </div>
          )}
        </Col>
      </Row>
    </Container>
  )
}
