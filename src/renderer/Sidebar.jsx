import React from 'react'
import { Nav, Button } from 'react-bootstrap'

export default function Sidebar({ currentView, onNavigate, collapsed = false, onToggle }) {
  const kitabToolViews = ['kitab_tools', 'translate', 'ai_chat', 'pdf', 'pdf_split', 'ocr', 'gettext']
  const isKitabToolsActive = kitabToolViews.includes(currentView)

  return (
    <div
      className={`border-end ${collapsed ? 'p-2' : 'pe-3 p-3'} min-vh-100 d-flex flex-column app-sidebar`}
      aria-expanded={!collapsed}
      onClick={(e) => {
        const link = e.target.closest('.nav-link')
        if (link) return
        onToggle?.()
      }}
    >
      <div className="d-flex align-items-center mb-3" role="button" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <div className="fw-bold flex-grow-1">{collapsed ? '' : 'Apps & Pages'}</div>
        <Button variant="outline-secondary" size="sm" onClick={onToggle} aria-label="Toggle Sidebar">
          <i className={`bi ${collapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`} />
        </Button>
      </div>
      <Nav className="flex-column mb-3 sidebar-nav">
        <div className={`text-muted small ${collapsed ? 'mb-2' : 'mb-2 ps-2'}`}>{collapsed ? '' : 'Menu'}</div>
        <Nav.Link href="#" active={currentView === 'dashboard'} onClick={(e) => { e.preventDefault(); onNavigate('dashboard') }} style={{ cursor: 'pointer' }} aria-label="Dashboard">
          <i className={`bi bi-grid ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' Dashboard'}
        </Nav.Link>
        <Nav.Link href="#" active={currentView === 'search'} onClick={(e) => { e.preventDefault(); onNavigate('search') }} style={{ cursor: 'pointer' }} aria-label="Search">
          <i className={`bi bi-search ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' Search'}
        </Nav.Link>
        <Nav.Link href="#" active={isKitabToolsActive} onClick={(e) => { e.preventDefault(); onNavigate('kitab_tools') }} style={{ cursor: 'pointer' }} aria-label="Kitab Tools">
          <i className={`bi bi-grid-1x2 ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' Kitab Tools'}
        </Nav.Link>
        <Nav.Link href="#" active={currentView === 'settings'} onClick={(e) => { e.preventDefault(); onNavigate('settings') }} style={{ cursor: 'pointer' }} aria-label="Settings">
          <i className={`bi bi-gear ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' Settings'}
        </Nav.Link>
      </Nav>
    </div>
  )
}
