import React, { useState } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles.css'
import { Container, Alert, Row, Col, Navbar, Form } from 'react-bootstrap'
import Sidebar from './Sidebar'
import PdfToImagePage from './pages/PdfToImagePage'
import OCRPage from './pages/OCRPage'
import GetTextPage from './pages/GetTextPage'
import TranslatePage from './pages/TranslatePage'
import Dashboard from './pages/Dashboard'
import SplitViewPage from './pages/SplitViewPage'

export default function App() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [view, setView] = useState('dashboard') // 'dashboard' | 'pdf' | 'ocr' | 'gettext' | 'translate'
  const [selectedFolder, setSelectedFolder] = useState('')
  const [splitData, setSplitData] = useState({ folder: '', file: '' })
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

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-bs-theme', theme)
      try { localStorage.setItem('theme', theme) } catch {}
    }
  }, [theme])

  React.useEffect(() => {
    try { localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? 'true' : 'false') } catch {}
  }, [sidebarCollapsed])

  return (
    <Container fluid className="py-3 d-flex flex-column vh-100">
      <Navbar bg="body" className="mb-3 border-bottom">
        <Container fluid>
          <Navbar.Brand className="fw-semibold">OCR Desktop App</Navbar.Brand>
          <Form.Check
            type="switch"
            id="themeSwitch"
            label={theme === 'dark' ? 'Dark' : 'Light'}
            checked={theme === 'dark'}
            onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
        </Container>
      </Navbar>
      {!api && (
        <Alert variant="warning" className="mb-3">Preview di browser: beberapa fitur nonaktif. Buka via Electron.</Alert>
      )}
      <Row className="flex-fill min-h-0">
        <Col xs={sidebarCollapsed ? 1 : 3} md={sidebarCollapsed ? 1 : 3} lg={sidebarCollapsed ? 1 : 3} className={`mb-3 mb-md-0 app-sidebar rounded-3 border sticky-sidebar ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
          <Sidebar currentView={view} onNavigate={setView} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
        </Col>
        <Col xs={sidebarCollapsed ? 11 : 9} md={sidebarCollapsed ? 11 : 9} lg={sidebarCollapsed ? 11 : 9} className="d-flex flex-column">
          <div className="app-content p-3 rounded-3 border flex-grow-1 overflow-auto">
            {view === 'dashboard' && (
              <Dashboard
                onOpenTranslate={(folderPath) => {
                  if (folderPath) setSelectedFolder(folderPath)
                  setView('translate')
                }}
              />
            )}
            {view === 'pdf' && <PdfToImagePage />}
            {view === 'ocr' && <OCRPage />}
            {view === 'gettext' && <GetTextPage />}
            {view === 'translate' && (
              <TranslatePage
                initialFolder={selectedFolder}
                onOpenSplit={(payload) => {
                  const p = payload || {}
                  setSplitData({ folder: p.folder || '', file: p.file || '' })
                  setView('split')
                }}
              />
            )}
            {view === 'split' && (
              <SplitViewPage initialFolder={splitData.folder} initialFile={splitData.file} onBack={() => setView('translate')} />
            )}
          </div>
        </Col>
      </Row>
    </Container>
  )
}