import React from 'react'
import { Nav, Button } from 'react-bootstrap'

export default function Sidebar({ currentView, onNavigate, collapsed = false, onToggle }) {
  

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
        <Nav.Link href="#" active={currentView === 'translate'} onClick={(e) => { e.preventDefault(); onNavigate('translate') }} style={{ cursor: 'pointer' }} aria-label="Translate">
          <i className={`bi bi-translate ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' Kitab Reader'}
        </Nav.Link>

        <div className={`text-muted small ${collapsed ? 'mt-3 mb-2' : 'mt-3 mb-2 ps-2'}`}>{collapsed ? '' : 'Tools'}</div>
        <Nav.Link href="#" active={currentView === 'pdf'} onClick={(e) => { e.preventDefault(); onNavigate('pdf') }} style={{ cursor: 'pointer' }} aria-label="PDF to Image">
          <i className={`bi bi-file-earmark-image ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' PDF to Image'}
        </Nav.Link>
        <Nav.Link href="#" active={currentView === 'ocr'} onClick={(e) => { e.preventDefault(); onNavigate('ocr') }} style={{ cursor: 'pointer' }} aria-label="OCR">
          <i className={`bi bi-filetype-txt ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' OCR'}
        </Nav.Link>
        <Nav.Link href="#" active={currentView === 'gettext'} onClick={(e) => { e.preventDefault(); onNavigate('gettext') }} style={{ cursor: 'pointer' }} aria-label="Get Text">
          <i className={`bi bi-journal-text ${collapsed ? '' : 'me-2'}`} />{collapsed ? '' : ' Get Text'}
        </Nav.Link>
      </Nav>
    </div>
  )
}