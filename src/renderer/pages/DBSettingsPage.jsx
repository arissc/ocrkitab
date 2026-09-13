import React, { useEffect, useState } from 'react'
import { Form, Button, Row, Col, Alert, InputGroup } from 'react-bootstrap'

export default function DBSettingsPage() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [cfg, setCfg] = useState({ host: '', user: '', password: '', database: '' })
  const [status, setStatus] = useState({ ok: false, error: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    if (!api || !api.getDbConfig) { setNotice('DB Settings hanya tersedia di Electron.'); return }
    const res = await api.getDbConfig()
    if (res && res.ok) {
      setCfg(res.config || cfg)
      setStatus(res.status || { ok: false })
    }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    if (!api || !api.saveDbConfig) return
    setSaving(true)
    const res = await api.saveDbConfig(cfg)
    setSaving(false)
    if (res && res.ok) {
      setStatus(res.status || { ok: false })
      setNotice('Konfigurasi database disimpan dan diinisialisasi ulang.')
    } else {
      setNotice(res?.error || 'Gagal menyimpan konfigurasi.')
    }
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="h5 mb-0">Database Settings</div>
      {notice && <Alert variant="info">{notice}</Alert>}
      <Alert variant={status.ok ? 'success' : 'warning'}>
        Status: {status.ok ? 'Connected' : `Not ready${status.error ? ' - ' + status.error : ''}`}
      </Alert>
      <Form>
        <Row className="g-3">
          <Col md={6}>
            <Form.Label>Host</Form.Label>
            <Form.Control value={cfg.host} onChange={(e) => setCfg(v => ({ ...v, host: e.target.value }))} />
          </Col>
          <Col md={6}>
            <Form.Label>User</Form.Label>
            <Form.Control value={cfg.user} onChange={(e) => setCfg(v => ({ ...v, user: e.target.value }))} />
          </Col>
          <Col md={6}>
            <Form.Label>Password</Form.Label>
            <InputGroup>
              <Form.Control type="password" value={cfg.password} onChange={(e) => setCfg(v => ({ ...v, password: e.target.value }))} />
            </InputGroup>
          </Col>
          <Col md={6}>
            <Form.Label>Database</Form.Label>
            <Form.Control value={cfg.database} onChange={(e) => setCfg(v => ({ ...v, database: e.target.value }))} />
          </Col>
        </Row>
        <div className="d-flex justify-content-end mt-3">
          <Button variant="primary" onClick={save} disabled={!api || saving}>Save & Reconnect</Button>
        </div>
      </Form>
    </div>
  )
}