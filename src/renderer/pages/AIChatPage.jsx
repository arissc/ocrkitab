import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Col, Form, ListGroup, Modal, Row, Spinner } from 'react-bootstrap'

export default function AIChatPage() {
  const api = typeof window !== 'undefined' ? window.api : undefined

  const [threads, setThreads] = useState([])
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [messages, setMessages] = useState([])

  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [systemPrompts, setSystemPrompts] = useState([])
  const [systemPromptId, setSystemPromptId] = useState('')

  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)

  const [input, setInput] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeVariant, setNoticeVariant] = useState('info')

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const [ctxMenu, setCtxMenu] = useState({ show: false, x: 0, y: 0, thread: null })
  const [renameModal, setRenameModal] = useState({ show: false, threadId: null, title: '', saving: false })

  const activeThread = useMemo(() => {
    return threads.find(t => Number(t.id) === Number(activeThreadId)) || null
  }, [threads, activeThreadId])

  const loadDefaults = async () => {
    if (!api || !api.getDefaults) return
    try {
      const def = await api.getDefaults()
      const prov = def?.translateAi === 'gemini' ? 'gemini' : 'openai'
      setProvider(prov)
      const m = prov === 'gemini' ? def?.geminiModel : def?.openAiModel
      if (typeof m === 'string' && m.trim()) setModel(m.trim())
    } catch (_) {}
  }

  const loadSystemPrompts = async () => {
    if (!api || !api.listAgentSystemPrompts) return
    try {
      const res = await api.listAgentSystemPrompts()
      if (res && res.ok) {
        setSystemPrompts(Array.isArray(res.data) ? res.data : [])
      }
    } catch (_) {}
  }

  const loadThreads = async (opts = {}) => {
    if (!api || !api.aiChatListThreads) {
      setNoticeVariant('warning')
      setNotice('AI Chat hanya tersedia di Electron.')
      return
    }
    setLoadingThreads(true)
    try {
      const res = await api.aiChatListThreads({ limit: opts.limit || 50 })
      if (res && res.ok) {
        const data = Array.isArray(res.data) ? res.data : []
        setThreads(data)
        if (!activeThreadId && data.length > 0) {
          setActiveThreadId(data[0].id)
        }
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal memuat daftar chat.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal memuat daftar chat.')
    } finally {
      setLoadingThreads(false)
    }
  }

  const loadMessages = async (threadId) => {
    if (!api || !api.aiChatListMessages) return
    const id = Number(threadId)
    if (!id) { setMessages([]); return }
    setLoadingMessages(true)
    try {
      const res = await api.aiChatListMessages(id)
      if (res && res.ok) {
        setMessages(Array.isArray(res.data) ? res.data : [])
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal memuat chat.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal memuat chat.')
    } finally {
      setLoadingMessages(false)
      setTimeout(() => {
        try {
          const el = listRef.current
          if (el) el.scrollTop = el.scrollHeight
        } catch (_) {}
      }, 50)
    }
  }

  const focusInput = () => {
    try {
      setTimeout(() => inputRef.current?.focus?.(), 0)
    } catch (_) {}
  }

  const createNewChat = async () => {
    if (!api || !api.aiChatCreateThread) return null
    try {
      const res = await api.aiChatCreateThread({ provider, model })
      if (res && res.ok && res.data && res.data.id) {
        setNotice('')
        await loadThreads()
        setActiveThreadId(res.data.id)
        await loadMessages(res.data.id)
        focusInput()
        return res.data
      }
      setNoticeVariant('danger')
      setNotice(res?.error || 'Gagal membuat chat baru.')
      return null
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal membuat chat baru.')
      return null
    }
  }

  const send = async () => {
    if (!api || !api.aiChatSend) return
    const text = String(input || '')
    if (!text.trim()) return
    setSending(true)
    setNotice('')
    try {
      let id = activeThreadId
      if (!id) {
        const created = await createNewChat()
        id = created?.id || null
      }
      const pid = systemPromptId ? Number(systemPromptId) : null
      const res = await api.aiChatSend({ threadId: id, content: text, provider, model, promptId: pid })
      if (res && res.ok) {
        setInput('')
        const nextThread = res.thread
        if (nextThread && nextThread.id) {
          setActiveThreadId(nextThread.id)
        }
        if (Array.isArray(res.messages)) setMessages(res.messages)
        await loadThreads()
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal mengirim pesan.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal mengirim pesan.')
    } finally {
      setSending(false)
      setTimeout(() => {
        try {
          const el = listRef.current
          if (el) el.scrollTop = el.scrollHeight
        } catch (_) {}
      }, 50)
    }
  }

  useEffect(() => {
    loadDefaults().then(() => loadThreads())
    loadSystemPrompts()
  }, [])

  useEffect(() => {
    if (activeThreadId) loadMessages(activeThreadId)
  }, [activeThreadId])

  useEffect(() => {
    const handleDown = (e) => {
      if (!ctxMenu.show) return
      const menu = e.target.closest('.ai-chat-ctx-menu')
      if (menu) return
      setCtxMenu({ show: false, x: 0, y: 0, thread: null })
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') setCtxMenu({ show: false, x: 0, y: 0, thread: null })
    }
    window.addEventListener('mousedown', handleDown)
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('mousedown', handleDown)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [ctxMenu.show])

  const openRename = (t) => {
    setCtxMenu({ show: false, x: 0, y: 0, thread: null })
    setRenameModal({ show: true, threadId: t?.id || null, title: String(t?.title || '').trim(), saving: false })
  }

  const doRename = async () => {
    if (!api || !api.aiChatRenameThread) return
    const id = renameModal.threadId
    const title = String(renameModal.title || '').trim()
    if (!id || !title) return
    setRenameModal((v) => ({ ...v, saving: true }))
    try {
      const res = await api.aiChatRenameThread({ threadId: id, title })
      if (res && res.ok) {
        setRenameModal({ show: false, threadId: null, title: '', saving: false })
        await loadThreads()
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal rename chat.')
        setRenameModal((v) => ({ ...v, saving: false }))
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal rename chat.')
      setRenameModal((v) => ({ ...v, saving: false }))
    }
  }

  const doDelete = async (t) => {
    if (!api || !api.aiChatDeleteThread) return
    const id = t?.id
    if (!id) return
    setCtxMenu({ show: false, x: 0, y: 0, thread: null })
    const ok = window.confirm(`Hapus chat “${t?.title || `Chat #${id}`}”?`)
    if (!ok) return
    try {
      const res = await api.aiChatDeleteThread(id)
      if (res && res.ok) {
        const nextActive = Number(activeThreadId) === Number(id) ? null : activeThreadId
        await loadThreads()
        if (nextActive) setActiveThreadId(nextActive)
        else {
          const after = await api.aiChatListThreads({ limit: 50 })
          if (after && after.ok && Array.isArray(after.data) && after.data.length > 0) {
            setActiveThreadId(after.data[0].id)
          } else {
            setActiveThreadId(null)
            setMessages([])
          }
        }
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal hapus chat.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal hapus chat.')
    }
  }

  const doClone = async (t) => {
    if (!api || !api.aiChatCloneThread) return
    const id = t?.id
    if (!id) return
    setCtxMenu({ show: false, x: 0, y: 0, thread: null })
    try {
      const res = await api.aiChatCloneThread({ threadId: id })
      if (res && res.ok && res.data && res.data.id) {
        await loadThreads()
        setActiveThreadId(res.data.id)
        await loadMessages(res.data.id)
        focusInput()
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal branch/copy chat.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal branch/copy chat.')
    }
  }

  const resizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = 220
    const next = Math.min(max, el.scrollHeight || 0)
    el.style.height = `${Math.max(42, next)}px`
    el.style.overflowY = (el.scrollHeight || 0) > max ? 'auto' : 'hidden'
  }

  useEffect(() => {
    resizeInput()
  }, [input])

  return (
    <div className="d-flex flex-column gap-3" style={{ height: '100%' }}>
      <div className="d-flex align-items-center justify-content-between">
        <div className="h5 mb-0">AI Chat</div>
        <div className="d-flex gap-2 align-items-center">
          <Form.Select size="sm" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ width: '170px' }}>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
          </Form.Select>
          <Form.Select
            size="sm"
            value={systemPromptId}
            onChange={(e) => setSystemPromptId(e.target.value)}
            style={{ width: '240px' }}
            title="System Prompt (opsional)"
          >
            <option value="">System Prompt: Default</option>
            {systemPrompts.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.label || p.slug || `Prompt #${p.id}`}
              </option>
            ))}
          </Form.Select>
          <Form.Control
            size="sm"
            placeholder="Model (opsional)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ width: '220px' }}
          />
          <Button variant="outline-secondary" size="sm" onClick={createNewChat} disabled={!api || sending}>
            <i className="bi bi-plus-lg me-2" /> Chat Baru
          </Button>
        </div>
      </div>

      {notice && <Alert variant={noticeVariant} className="mb-0">{notice}</Alert>}

      <Row className="g-3 flex-fill min-h-0">
        <Col md={3} className="d-flex flex-column min-h-0">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="text-muted small">Daftar Chat</div>
            {loadingThreads && <Spinner animation="border" size="sm" />}
          </div>
          <div className="border rounded flex-fill overflow-auto ai-chat-scroll">
            <ListGroup variant="flush">
              {threads.map((t) => (
                <ListGroup.Item
                  key={t.id}
                  action
                  active={Number(activeThreadId) === Number(t.id)}
                  onClick={() => setActiveThreadId(t.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setCtxMenu({ show: true, x: e.clientX, y: e.clientY, thread: t })
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="fw-semibold" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                      {t.title || `Chat #${t.id}`}
                    </div>
                    {Number(t.message_count || 0) > 0 && (
                      <Badge bg="secondary">{t.message_count}</Badge>
                    )}
                  </div>
                  <div className="text-muted small">
                    {(t.provider || 'openai')}{t.model ? ` • ${t.model}` : ''}
                  </div>
                </ListGroup.Item>
              ))}
              {threads.length === 0 && (
                <ListGroup.Item className="text-muted">
                  Belum ada chat. Klik “Chat Baru”.
                </ListGroup.Item>
              )}
            </ListGroup>
          </div>
        </Col>

        <Col md={9} className="d-flex flex-column min-h-0">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="text-muted small">
              {activeThread ? (activeThread.title || `Chat #${activeThread.id}`) : 'Belum ada chat dipilih'}
            </div>
            {loadingMessages && <Spinner animation="border" size="sm" />}
          </div>

          <div ref={listRef} className="border rounded p-3 flex-fill overflow-auto bg-body ai-chat-scroll" style={{ whiteSpace: 'pre-wrap' }}>
            {messages.length === 0 && (
              <div className="text-muted">
                Mulai dengan menulis pertanyaan. Untuk chat baru, judul akan otomatis dibuat dari tema jawaban pertama.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`d-flex ${m.role === 'user' ? 'justify-content-end' : 'justify-content-start'} mb-3`}>
                <div style={{ maxWidth: '78%' }}>
                  <div className={`d-flex ${m.role === 'user' ? 'justify-content-end' : 'justify-content-start'} mb-1`}>
                    <span className="text-muted small">{m.created_at ? String(m.created_at) : ''}</span>
                  </div>
                  <div
                    className={`border rounded-4 px-3 py-2 ai-chat-bubble ${m.role === 'user' ? 'ai-chat-bubble-user bg-primary text-white' : 'ai-chat-bubble-assistant bg-body-tertiary text-body'}`}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!sending) send()
            }}
          >
            <div className="d-flex gap-2 align-items-end">
              <Form.Control
                as="textarea"
                ref={inputRef}
                rows={1}
                placeholder="Tulis pesan..."
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  resizeInput()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (!sending) send()
                  }
                }}
                disabled={!api || sending}
                style={{ resize: 'none', overflowY: 'hidden', cursor: 'text' }}
              />
              <Button
                variant="primary"
                className="ai-chat-send-btn"
                onClick={send}
                disabled={!api || sending || !String(input || '').trim()}
                style={{ width: '42px', height: '42px', minWidth: '42px' }}
              >
                {sending ? <Spinner animation="border" size="sm" /> : <i className="bi bi-send-fill" />}
              </Button>
            </div>
          </Form>
        </Col>
      </Row>

      {ctxMenu.show && (
        <div
          className="ai-chat-ctx-menu"
          style={{
            position: 'fixed',
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 10000,
            backgroundColor: 'var(--bs-body-bg)',
            border: '1px solid var(--bs-border-color)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
            borderRadius: '0.75rem',
            padding: '0.5rem 0',
            minWidth: '220px'
          }}
        >
          <div className="px-3 py-1 text-muted small fw-semibold border-bottom mb-1">
            {ctxMenu.thread?.title || `Chat #${ctxMenu.thread?.id || ''}`}
          </div>
          <div className="px-3 py-2 dropdown-item" style={{ cursor: 'pointer' }} onClick={() => openRename(ctxMenu.thread)}>
            <i className="bi bi-pencil-square me-2" /> Rename
          </div>
          <div className="px-3 py-2 dropdown-item" style={{ cursor: 'pointer' }} onClick={() => doClone(ctxMenu.thread)}>
            <i className="bi bi-diagram-3 me-2" /> Branch (Copy)
          </div>
          <div className="px-3 py-2 dropdown-item text-danger" style={{ cursor: 'pointer' }} onClick={() => doDelete(ctxMenu.thread)}>
            <i className="bi bi-trash3 me-2" /> Hapus
          </div>
        </div>
      )}

      <Modal show={renameModal.show} onHide={() => setRenameModal({ show: false, threadId: null, title: '', saving: false })} centered>
        <Modal.Header closeButton>
          <Modal.Title>Rename Chat</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Judul</Form.Label>
            <Form.Control
              value={renameModal.title}
              onChange={(e) => setRenameModal((v) => ({ ...v, title: e.target.value }))}
              placeholder="Masukkan judul..."
              autoFocus
              disabled={renameModal.saving}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRenameModal({ show: false, threadId: null, title: '', saving: false })} disabled={renameModal.saving}>
            Batal
          </Button>
          <Button variant="primary" onClick={doRename} disabled={renameModal.saving || !String(renameModal.title || '').trim()}>
            {renameModal.saving ? (<><Spinner animation="border" size="sm" className="me-2" />Simpan</>) : 'Simpan'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
