import React, { useEffect, useState, useRef } from 'react'
import { Form, InputGroup, ListGroup, Badge, Button, Spinner, Alert, Row, Col } from 'react-bootstrap'

const MATCH_BADGE = {
  keyword: { bg: 'secondary', label: 'keyword' },
  semantic: { bg: 'info', label: 'semantic' },
  hybrid: { bg: 'success', label: 'hybrid' }
}

function resultKey(item, index) {
  if (item.chunk_id != null) return `chunk-${item.chunk_id}`
  if (item.translation_id != null) return `tr-${item.translation_id}`
  return `row-${item.kitab_id || 'x'}-${item.file_name || index}`
}

export default function SearchPage({ onOpenSplit }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mode, setMode] = useState('hybrid')
  const [idKitab, setIdKitab] = useState('')
  const [kitabs, setKitabs] = useState([])
  const [searchMeta, setSearchMeta] = useState(null)
  const [searchError, setSearchError] = useState('')
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const silenceTimerRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const animationFrameRef = useRef(null)

  useEffect(() => {
    if (!api || !api.listKitabs) return
    api.listKitabs()
      .then((res) => {
        const rows = res && res.ok ? res.data || [] : Array.isArray(res) ? res : []
        setKitabs(rows)
      })
      .catch(() => {})
  }, [api])

  const playBeep = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      osc.start()
      osc.stop(ctx.currentTime + 0.2)
    } catch (e) {
      console.error('Beep failed', e)
    }
  }

  const handleSearch = async (e, overrideKeyword) => {
    e?.preventDefault()
    const k = overrideKeyword !== undefined ? overrideKeyword : keyword
    if (!k || !k.trim()) return
    if (!api) {
      console.warn('API not available')
      return
    }
    setLoading(true)
    setSearched(true)
    setSearchError('')
    setSearchMeta(null)
    if (overrideKeyword !== undefined) {
      setKeyword(overrideKeyword)
    }
    try {
      const payload = {
        keyword: k,
        mode,
        idKitab: idKitab ? Number(idKitab) : null
      }
      const res = await api.searchGlobal(payload)
      if (res && res.ok) {
        setResults(res.data || [])
        setSearchMeta(res.meta || { mode: res.mode || mode })
        if (res.meta?.embedError) {
          setSearchError(`Embedding: ${res.meta.embedError}`)
        }
      } else {
        setResults([])
        setSearchError(res?.error || 'Search gagal')
        console.error(res?.error)
      }
    } catch (err) {
      console.error(err)
      setResults([])
      setSearchError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const startRecording = async () => {
    if (typeof window === 'undefined' || !navigator.mediaDevices) {
       alert('Browser does not support audio recording')
       return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      playBeep()
      
      // Setup Silence Detection
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (AudioContext) {
        const audioCtx = new AudioContext()
        audioContextRef.current = audioCtx
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.3 // Make it more responsive
        analyserRef.current = analyser
        const source = audioCtx.createMediaStreamSource(stream)
        sourceRef.current = source
        source.connect(analyser)
        
        let lastSpeechTime = Date.now()
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        
        const checkSilence = () => {
          if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return
          
          analyser.getByteFrequencyData(dataArray)
          
          // Calculate average volume
          let sum = 0
          for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i]
          }
          const average = sum / bufferLength
          
          // Threshold for speech (adjustable)
          if (average > 10) { // Speech detected
             lastSpeechTime = Date.now()
          }
          
          // Check if silence exceeded 3 seconds
          if (Date.now() - lastSpeechTime > 3000) {
             stopRecording()
          } else {
             animationFrameRef.current = requestAnimationFrame(checkSilence)
          }
        }
        
        checkSilence()
      }

      mediaRecorderRef.current = new MediaRecorder(stream)
      audioChunksRef.current = []
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }
      
      mediaRecorderRef.current.onstop = async () => {
        // Cleanup AudioContext
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        if (sourceRef.current) sourceRef.current.disconnect()
        if (audioContextRef.current) audioContextRef.current.close()
        
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.readAsDataURL(blob)
        reader.onloadend = async () => {
           const base64data = reader.result
           const base64 = base64data.split(',')[1]
           // Force mimeType to audio/webm if not present, though it should be
           const mimeType = 'audio/webm'
           
           setLoading(true)
           try {
             if (api && api.sttGemini) {
                const res = await api.sttGemini({ audioData: base64, mimeType })
                if (res && res.ok) {
                   const text = res.text
                   if (text) {
                      handleSearch(null, text)
                   } else {
                      // alert('No speech detected.')
                   }
                } else {
                   alert('STT Failed: ' + (res?.error || 'Unknown error'))
                }
             } else {
                alert('STT API not available')
             }
           } catch (err) {
             alert('Error: ' + err.message)
           } finally {
             setLoading(false)
           }
        }
        stream.getTracks().forEach(t => t.stop())
      }
      
      mediaRecorderRef.current.start()
      setRecording(true)
    } catch (err) {
      console.error(err)
      alert('Failed to start recording: ' + err.message)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }

  const toggleRecording = () => {
    if (recording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  const highlight = (text, k) => {
    if (!text) return ''
    if (!k) return text.substring(0, 100)
    const lowerText = text.toLowerCase()
    const lowerK = k.toLowerCase()
    const idx = lowerText.indexOf(lowerK)
    
    if (idx === -1) {
      // If keyword not found (maybe matched in other field), show beginning
      return text.length > 150 ? text.substring(0, 150) + '...' : text
    }
    
    const start = Math.max(0, idx - 60)
    const end = Math.min(text.length, idx + k.length + 60)
    const prefix = start > 0 ? '...' : ''
    const suffix = end < text.length ? '...' : ''
    const snippet = text.substring(start, end)
    
    // Split by keyword for highlighting
    // Escape special chars in keyword for regex
    const escapedK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = snippet.split(new RegExp(`(${escapedK})`, 'gi'))
    
    return (
      <span>
        {prefix}
        {parts.map((part, i) => 
          part.toLowerCase() === lowerK ? <mark key={i} className="p-0 bg-warning text-dark fw-bold">{part}</mark> : part
        )}
        {suffix}
      </span>
    )
  }

  const openResult = (item) => {
    if (!item.kitab_folder_path || !item.file_name) return
    onOpenSplit({ folder: item.kitab_folder_path, file: item.file_name, origin: 'search' })
  }

  return (
    <div className="d-flex flex-column h-100">
      <div className="mb-4">
        <div className="h4 mb-3">Global Search</div>
        <Form onSubmit={handleSearch}>
          <InputGroup size="lg">
            <Form.Control 
              placeholder="Search translation, topic, or original text..." 
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              autoFocus
            />
            <Button 
              variant={recording ? "danger" : "outline-secondary"} 
              type="button" 
              onClick={toggleRecording}
              title="Voice Search (Gemini)"
            >
              {recording ? <><Spinner animation="grow" size="sm" className="me-1"/> Stop</> : <i className="bi bi-mic" />}
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? <Spinner size="sm" animation="border" /> : <i className="bi bi-search" />} Search
            </Button>
          </InputGroup>
          <Row className="g-2 mt-2 align-items-end">
            <Col xs={12} md={4}>
              <Form.Label className="small text-muted mb-1">Mode</Form.Label>
              <Form.Select size="sm" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="hybrid">Hybrid (keyword + makna)</option>
                <option value="keyword">Keyword only</option>
                <option value="semantic">Semantic only</option>
              </Form.Select>
            </Col>
            <Col xs={12} md={5}>
              <Form.Label className="small text-muted mb-1">Filter kitab (opsional)</Form.Label>
              <Form.Select size="sm" value={idKitab} onChange={(e) => setIdKitab(e.target.value)}>
                <option value="">Semua kitab</option>
                {kitabs.map((k) => (
                  <option key={k.id} value={k.id}>{k.nama_kitab} (id={k.id})</option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12} md={3} className="small text-muted pb-1">
              {searchMeta?.model ? <>Model: {searchMeta.model}</> : null}
              {searchMeta?.vectorHitCount != null ? <> · vector: {searchMeta.vectorHitCount}</> : null}
            </Col>
          </Row>
        </Form>
      </div>

      <div className="flex-grow-1 overflow-auto">
        {searchError && (
          <Alert variant="warning" className="py-2">{searchError}</Alert>
        )}
        {searched && results.length === 0 && !loading && (
          <Alert variant="info">No results found for "{keyword}"</Alert>
        )}
        
        {results.length > 0 && (
          <ListGroup variant="flush">
            {results.map((item, index) => {
              const badge = MATCH_BADGE[item.match_type] || MATCH_BADGE.keyword
              const canOpen = !!(item.kitab_folder_path && item.file_name)
              return (
              <ListGroup.Item 
                key={resultKey(item, index)} 
                action={canOpen}
                onClick={() => canOpen && openResult(item)} 
                className="border-bottom py-3"
              >
                <div className="d-flex justify-content-between align-items-center mb-1 gap-2">
                  <div className="fw-bold text-primary">{item.nama_kitab}</div>
                  <div className="d-flex align-items-center gap-1 flex-shrink-0">
                    <Badge bg={badge.bg} className="fw-normal text-uppercase">
                      {badge.label}
                    </Badge>
                    {item.similarity_score != null ? (
                      <Badge bg="light" text="dark" className="fw-normal" title="Cosine similarity">
                        {(Number(item.similarity_score) * 100).toFixed(1)}%
                      </Badge>
                    ) : null}
                    <Badge bg="secondary" className="fw-normal text-truncate" style={{ maxWidth: '160px' }}>
                      {item.file_name ? item.file_name.split(/[/\\]/).pop() : 'Unknown file'}
                      {item.page_number != null ? ` · p.${item.page_number}` : ''}
                    </Badge>
                  </div>
                </div>
                {item.match_type === 'semantic' || item.match_type === 'hybrid' ? (
                  <div className="text-muted small mb-1">Mirip secara makna{item.chunk_id != null ? ` · chunk #${item.chunk_id}` : ''}</div>
                ) : null}
                {item.text_original && (
                  <div className="text-muted small mb-2" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                    {highlight(item.text_original, keyword)}
                  </div>
                )}
                {item.text_translate && (
                  <div className="text-body small">
                    {highlight(item.text_translate, keyword)}
                  </div>
                )}
                {!item.text_original && !item.text_translate && item.preview ? (
                  <div className="text-body small">{highlight(item.preview, keyword)}</div>
                ) : null}
              </ListGroup.Item>
              )
            })}
          </ListGroup>
        )}
      </div>
    </div>
  )
}
