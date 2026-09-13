import React, { useEffect, useState, useRef } from 'react'
import { Button, Alert, ListGroup, Form, Row, Col, Accordion, Modal, ProgressBar } from 'react-bootstrap'

const getFileName = (filePath) => {
  if (!filePath) return ''
  return String(filePath).split(/[/\\]/).pop() || ''
}

const findLatestSessionForFolders = (settings, folders) => {
  if (!settings || !folders || folders.length === 0) return null
  const lastSessions = settings.lastOpenedKitabSessions && typeof settings.lastOpenedKitabSessions === 'object'
    ? settings.lastOpenedKitabSessions
    : {}
  const matches = folders
    .map(folderPath => lastSessions[folderPath])
    .filter(Boolean)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))

  if (matches.length > 0) return matches[0]

  const fallback = settings.lastOpenedSplit
  if (fallback && folders.includes(fallback.folder)) return fallback
  return null
}

export default function KitabDetailPage({ kitabId, onBack, onOpenTranslate, onOpenSplit }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [kitab, setKitab] = useState(null)
  const [pairs, setPairs] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ id: null, nama_kitab: '', pengarang: '', keterangan: '', folder_pairs: [] })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [panelFolder, setPanelFolder] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [lastSession, setLastSession] = useState(null)

  useEffect(() => {
    const load = async () => {
      setError('')
      setNotice('')
      setLastSession(null)
      try {
        if (!api || !kitabId) return
        const res = await (api.getKitabDetailById ? api.getKitabDetailById(kitabId) : Promise.resolve({ ok: false }))
        if (res && res.ok && res.data) {
          const d = res.data
          setKitab(d)
          const pd = Array.isArray(d.folders_detail) ? d.folders_detail : (Array.isArray(d.folders) ? d.folders.map(fp => ({ folder_path: fp, image_folder_path: '' })) : [])
          setPairs(pd)
          setForm({ id: d.id, nama_kitab: d.nama_kitab || '', pengarang: d.pengarang || '', keterangan: d.keterangan || '', folder_pairs: pd })
          if (api && api.getSettings) {
            try {
              const settings = await api.getSettings()
              const folderPaths = pd.map(item => item.folder_path).filter(Boolean)
              setLastSession(findLatestSessionForFolders(settings, folderPaths))
            } catch (_) {
              setLastSession(null)
            }
          }
        } else {
          setError(res?.error || 'Kitab tidak ditemukan.')
        }
      } catch (e) {
        setError(e.message || 'Gagal memuat detail kitab.')
      }
    }
    load()
  }, [kitabId])

  const addTextFolder = async () => {
    if (!api || !api.selectFolder) return
    const fp = await api.selectFolder()
    if (fp) {
      setPairs(v => [...v, { folder_path: fp, image_folder_path: '' }])
      setForm(v => ({ ...v, folder_pairs: [...(v.folder_pairs || []), { folder_path: fp, image_folder_path: '' }] }))
    }
  }

  const setImageFolder = async (fp) => {
    if (!api || !api.selectFolder) return
    const img = await api.selectFolder()
    if (img) {
      setPairs(v => v.map(p => (p.folder_path === fp ? { ...p, image_folder_path: img } : p)))
      setForm(v => ({ ...v, folder_pairs: (v.folder_pairs || []).map(p => (p.folder_path === fp ? { ...p, image_folder_path: img } : p)) }))
    }
  }

  const removePair = (fp) => {
    setPairs(v => v.filter(p => p.folder_path !== fp))
    setForm(v => ({ ...v, folder_pairs: (v.folder_pairs || []).filter(p => p.folder_path !== fp) }))
  }

  const save = async () => {
    setError('')
    setNotice('')
    try {
      if (!api || !form.id) return
      const res = await api.updateKitab(form)
      if (res && res.ok) {
        setNotice('Perubahan berhasil disimpan.')
        setEditing(false)
      } else {
        throw new Error(res?.error || 'Gagal menyimpan perubahan.')
      }
    } catch (e) {
      setError(e.message || 'Kesalahan saat menyimpan.')
    }
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center">
        <div className="h5 mb-0">Detail Kitab</div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={onBack}>Kembali</Button>
        </div>
      </div>
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
      {kitab && !editing && (
        <Alert variant="info">
          <div className="fw-semibold">{kitab.nama_kitab}</div>
          <div className="text-muted small">{kitab.pengarang || 'Tanpa pengarang'} • {new Date(kitab.created_at).toLocaleString()}</div>
          {kitab.keterangan && <div className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{kitab.keterangan}</div>}
          {lastSession && (
            <div className="mt-3 p-2 border rounded bg-body">
              <div className="small fw-semibold">Sesi terakhir</div>
              <div className="small text-muted">
                {getFileName(lastSession.file)} • {new Date(lastSession.timestamp).toLocaleString()}
              </div>
              <div className="mt-2">
                <Button variant="info" size="sm" onClick={() => onOpenSplit?.(lastSession)}>
                  Lanjutkan Bacaan
                </Button>
              </div>
            </div>
          )}
          <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
            <span className="small">Folder Teks:</span>
            {(pairs || []).map(p => (
              <Button key={p.folder_path} variant="outline-secondary" size="sm" onClick={() => setPanelFolder(p.folder_path)}>
                {p.folder_path}
              </Button>
            ))}
          </div>
          <div className="d-flex justify-content-end mt-2">
            <Button variant="outline-secondary" size="sm" onClick={() => setEditing(true)}>
              <i className="bi bi-pencil-square me-2" /> Edit
            </Button>
          </div>
        </Alert>
      )}

      {kitab && editing && (
        <Alert variant="secondary">
          <div className="fw-semibold mb-2">Edit Kitab</div>
          <Form>
            <Row className="g-2">
              <Col md={4}>
                <Form.Label>Nama Kitab</Form.Label>
                <Form.Control value={form.nama_kitab} onChange={e => setForm(v => ({ ...v, nama_kitab: e.target.value }))} />
              </Col>
              <Col md={4}>
                <Form.Label>Pengarang</Form.Label>
                <Form.Control value={form.pengarang} onChange={e => setForm(v => ({ ...v, pengarang: e.target.value }))} />
              </Col>
              <Col md={8} className="mt-2">
                <Form.Label>Keterangan</Form.Label>
                <Form.Control as="textarea" rows={3} value={form.keterangan} onChange={e => setForm(v => ({ ...v, keterangan: e.target.value }))} />
              </Col>
              <Col md={12} className="mt-2">
                <Form.Label>Folder Teks dan Gambar</Form.Label>
                <div className="d-flex flex-column gap-2">
                  <div>
                    <Button variant="outline-primary" size="sm" onClick={addTextFolder} disabled={!api}>Tambah Folder Teks</Button>
                  </div>
                  {(pairs || []).length > 0 && (
                    <ListGroup>
                      {(pairs || []).map(p => (
                        <ListGroup.Item key={p.folder_path} className="d-flex justify-content-between align-items-center">
                          <div className="d-flex flex-column">
                            <div className="small" style={{ overflowWrap: 'anywhere' }}><strong>Teks:</strong> {p.folder_path}</div>
                            <div className="small" style={{ overflowWrap: 'anywhere' }}><strong>Gambar:</strong> {p.image_folder_path || '-'}</div>
                          </div>
                          <div className="d-flex gap-2">
                            <Button variant="outline-secondary" size="sm" onClick={() => setImageFolder(p.folder_path)}>Set Folder Gambar</Button>
                            <Button variant="outline-danger" size="sm" onClick={() => removePair(p.folder_path)}>
                              <i className="bi bi-x-lg" /> Hapus
                            </Button>
                          </div>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  )}
                </div>
              </Col>
            </Row>
            <div className="d-flex justify-content-end mt-2 gap-2">
              <Button variant="outline-secondary" size="sm" onClick={() => setEditing(false)}>Batal</Button>
              <Button variant="primary" size="sm" onClick={save}>Simpan</Button>
              <Button variant="danger" size="sm" disabled={!form.id || deleting} onClick={async () => {
                try {
                  if (typeof window !== 'undefined') {
                    const ok = window.confirm('Hapus kitab ini beserta semua data terkait?')
                    if (!ok) return
                  }
                  setDeleting(true)
                  const res = await (api && api.deleteKitab ? api.deleteKitab(form.id) : Promise.resolve({ ok: false }))
                  if (res && res.ok) {
                    setNotice('Kitab terhapus.')
                    onBack?.()
                  } else {
                    throw new Error(res?.error || 'Gagal menghapus kitab')
                  }
                } catch (e) {
                  setError(e.message || 'Kesalahan saat menghapus.')
                } finally {
                  setDeleting(false)
                }
              }}>Hapus</Button>
            </div>
          </Form>
        </Alert>
      )}

      {panelFolder && (
        <FolderTranslatePanel
          folder={panelFolder}
          imageFolder={(pairs || []).find(p => p.folder_path === panelFolder)?.image_folder_path || ''}
          lastSessionFile={lastSession && lastSession.folder === panelFolder ? lastSession.file : ''}
          onOpenSplit={onOpenSplit}
        />
      )}
    </div>
  )
}

function FolderTranslatePanel({ folder, imageFolder, lastSessionFile = '', onOpenSplit }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [files, setFiles] = useState([])
  const [checkedPaths, setCheckedPaths] = useState([])
  const [selected, setSelected] = useState(null)
  const [original, setOriginal] = useState('')
  const [result, setResult] = useState('')
  const [dbTranslation, setDbTranslation] = useState('')
  const [localInput, setLocalInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState({ index: 0, total: 0 })
  const [ocrEngine, setOcrEngine] = useState('tesseract')
  const [ocrLayoutMode, setOcrLayoutMode] = useState('box_notes')
  const [ocrBoxPaddingPct, setOcrBoxPaddingPct] = useState(0.01)
  const [ocrNotePaddingPct, setOcrNotePaddingPct] = useState(0.01)
  const [ocrOutsideFormat, setOcrOutsideFormat] = useState('flat')
  const [openAiModel, setOpenAiModel] = useState('gpt-4o-mini')
  const [activeFile, setActiveFile] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerText, setViewerText] = useState('')
  const [viewerPath, setViewerPath] = useState('')
  const [viewInfoShown, setViewInfoShown] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [currentMatch, setCurrentMatch] = useState(0)
  const [showSearch, setShowSearch] = useState(true)
  const viewerRef = useRef(null)
  const currentRef = useRef(null)
  const searchInputRef = useRef(null)
  const activeFileRef = useRef('')
  const folderRef = useRef('')
  const ocrJobActiveRef = useRef(false)

  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile])

  useEffect(() => {
    folderRef.current = folder
  }, [folder])

  useEffect(() => {
    const load = async () => {
      await refreshFiles(folder)
    }
    if (api && folder) load()
  }, [folder, lastSessionFile])

  useEffect(() => {
    if (!api?.getDefaults) return
    api.getDefaults().then((def) => {
      if (!def) return
      if (def.ocrEngine) setOcrEngine(def.ocrEngine)
      setOcrLayoutMode(def.ocrLayoutMode || 'box_notes')
      if (def.ocrBoxPaddingPct != null) {
        const n = Number(def.ocrBoxPaddingPct)
        setOcrBoxPaddingPct(Number.isFinite(n) ? n : 0.01)
      }
      if (def.ocrNotePaddingPct != null) {
        const n = Number(def.ocrNotePaddingPct)
        setOcrNotePaddingPct(Number.isFinite(n) ? n : 0.01)
      }
      if (def.ocrOutsideFormat) setOcrOutsideFormat(def.ocrOutsideFormat)
      if (def.openAiModel) setOpenAiModel(def.openAiModel)
    }).catch(() => {})
  }, [api])

  const handleEngineChange = async (e) => {
    const val = e.target.value
    setOcrEngine(val)
    if (api?.saveSettings) await api.saveSettings({ ocrEngine: val })
  }

  const handleLayoutModeChange = async (e) => {
    const val = e.target.value
    setOcrLayoutMode(val)
    if (api?.saveSettings) await api.saveSettings({ ocrLayoutMode: val })
  }

  useEffect(() => {
    if (!api) return undefined
    let offProgress
    let offComplete
    if (api.onOcrProgress) {
      offProgress = api.onOcrProgress((p) => {
        if (!ocrJobActiveRef.current) return
        setOcrProgress({ index: p.index, total: p.total })
        setLogs((prev) => [{
          type: p.ok ? 'info' : 'error',
          text: `Re-OCR ${p.ok ? 'OK' : 'ERR'}: ${p.file}${p.error ? ' - ' + p.error : ''}`
        }, ...prev])
      })
    }
    if (api.onOcrComplete) {
      offComplete = api.onOcrComplete(async (p) => {
        if (!ocrJobActiveRef.current) return
        ocrJobActiveRef.current = false
        setOcrRunning(false)
        setLogs((prev) => [{ type: 'info', text: `Re-OCR selesai. Total: ${p.total}` }, ...prev])
        const dir = folderRef.current
        if (dir) {
          await refreshFiles(dir)
          const current = activeFileRef.current
          if (current) await openFileContent(current)
        }
      })
    }
    return () => {
      try { offProgress && offProgress() } catch (_) {}
      try { offComplete && offComplete() } catch (_) {}
    }
  }, [api])

  const refreshFiles = async (dir) => {
    if (!api || !api.listTxtFiles) {
      setLogs(prev => [{ type: 'error', text: 'List teks hanya tersedia di Electron.' }, ...prev])
      return
    }
    const res = await api.listTxtFiles(dir)
    if (res && res.ok) {
      const list = res.files || []
      const sorted = [...list].sort((a, b) => {
        const ra = a.replace(dir + '\\', '')
        const rb = b.replace(dir + '\\', '')
        const ba = ra.replace(/\.[^.]+$/, '')
        const bb = rb.replace(/\.[^.]+$/, '')
        const ma = ba.match(/(\d+)$/)
        const mb = bb.match(/(\d+)$/)
        const na = ma ? parseInt(ma[1], 10) : NaN
        const nb = mb ? parseInt(mb[1], 10) : NaN
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
        return ba.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
      })
      setFiles(sorted)
      setCheckedPaths(prev => prev.filter(p => sorted.includes(p)))
      if (sorted.length > 0) {
        const preferredFile = lastSessionFile && sorted.includes(lastSessionFile) ? lastSessionFile : sorted[0]
        setSelected(preferredFile)
        await openFileContent(preferredFile)
      }
    } else {
      setFiles([])
      setCheckedPaths([])
      setLogs(prev => [{ type: 'error', text: res?.error || 'Gagal membaca folder.' }, ...prev])
    }
  }

  const getPageFiles = (list = files) => (
    (list || []).filter((txtPath) => {
      const name = (txtPath.split(/[/\\]/).pop() || '').toLowerCase()
      return name && name !== 'all_pages.txt'
    })
  )

  const toggleCheckedPath = (path, e) => {
    e?.stopPropagation?.()
    setCheckedPaths((prev) => (
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    ))
  }

  const toggleSelectAllForOcr = () => {
    const pageFiles = getPageFiles()
    if (pageFiles.length === 0) return
    const allSelected = pageFiles.every((p) => checkedPaths.includes(p))
    setCheckedPaths(allSelected ? [] : pageFiles)
  }

  const openFileContent = async (filePath) => {
    if (!api) {
      setLogs(prev => [{ type: 'error', text: 'Buka file hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!filePath) return
    try {
      const fileRes = await api.readFile(filePath)
      if (!fileRes || !fileRes.ok) throw new Error(fileRes?.error || 'Gagal membaca file input.')
      const content = fileRes.content || ''
      setOriginal(content)
      setResult(content)
      setDbTranslation('')
      setLocalInput('')
      setActiveFile(filePath)
    } catch (e) {
      setLogs(prev => [{ type: 'error', text: e.message || 'Gagal membuka file.' }, ...prev])
    }
  }

  useEffect(() => {
    const loadDb = async () => {
      if (!api || !original || !activeFile) return
      try {
        const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
        const fileName = (activeFile || '').split('\\').pop() || ''
        const res = await api.getTranslation({ kitabName, folderPath: folder, fileName, originalText: original })
        if (res && res.ok) {
          const txt = res.data?.text_translate || ''
          setDbTranslation(txt)
          setLocalInput(txt)
          if (txt) setResult(txt)
        } else {
          setDbTranslation('')
          setLocalInput('')
        }
      } catch (e) {
        setLogs(prev => [{ type: 'error', text: e.message || 'Gagal mengambil terjemahan dari database.' }, ...prev])
      }
    }
    loadDb()
  }, [original, folder, activeFile])

  const joinText = async () => {
    if (!api || !api.joinText) {
      setLogs(prev => [{ type: 'error', text: 'Gabung teks hanya tersedia di Electron.' }, ...prev])
      return
    }
    const res = await api.joinText({ textFolder: folder })
    if (res && res.ok) {
      setLogs(prev => [{ type: 'info', text: `Teks tergabung: ${res.output}` }, ...prev])
      setViewerPath(res.output || `${folder}\\all_pages.txt`)
    } else {
      setLogs(prev => [{ type: 'error', text: `Gagal gabung: ${res?.error || 'Tidak diketahui'}` }, ...prev])
    }
  }

  const viewMergedFile = async () => {
    if (!api || !api.readFile) {
      setLogs(prev => [{ type: 'error', text: 'View file hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!folder) {
      setLogs(prev => [{ type: 'error', text: 'Folder belum dipilih.' }, ...prev])
      return
    }
    const filePath = `${folder}\\all_pages.txt`
    try {
      const res = await api.readFile(filePath)
      if (res && res.ok) {
        setViewerText(res.content || '')
        setViewerPath(filePath)
        setViewerOpen(true)
        if (!viewInfoShown) {
          setLogs(prev => [{ type: 'info', text: `Menampilkan file: ${filePath}` }, ...prev])
          setViewInfoShown(true)
        }
      } else {
        const err = (res && res.error) || 'File tidak ditemukan atau gagal dibuka.'
        setLogs(prev => [{ type: 'error', text: err }, ...prev])
      }
    } catch (e) {
      const errMsg = e?.message || 'IPC read-file gagal dipanggil.'
      setLogs(prev => [{ type: 'error', text: errMsg }, ...prev])
    }
  }

  const resolveImageFolder = async (textFolder) => {
    if (!api || !textFolder) return ''
    if (imageFolder) {
      try {
        const li = await api.listImageFiles(imageFolder)
        if (li?.ok && li.files?.length) return imageFolder
      } catch (_) {}
    }
    const parent = String(textFolder).replace(/[\\/]+$/, '').split(/[/\\]/).slice(0, -1).join('\\')
    const candidates = [parent ? `${parent}\\images` : '', textFolder].filter(Boolean)
    for (const dir of candidates) {
      try {
        const li = await api.listImageFiles(dir)
        if (li?.ok && li.files?.length) return dir
      } catch (_) {}
    }
    return imageFolder || ''
  }

  const chooseMatchingImage = (images, txtFile) => {
    if (!images || images.length === 0 || !txtFile) return ''
    const base = (txtFile.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '')
    const m = base.match(/(\d+)$/)
    const n = m ? parseInt(m[1], 10) : NaN
    if (!Number.isNaN(n)) {
      const byNum = images.find((p) => {
        const bn = (p.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '')
        const mm = bn.match(/(\d+)$/)
        const nn = mm ? parseInt(mm[1], 10) : NaN
        return !Number.isNaN(nn) && nn === n
      })
      if (byNum) return byNum
    }
    const byBase = images.find((p) => (p.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '') === base)
    return byBase || ''
  }

  const runSelectedOcrFiles = async (targets, layoutPayload, defaults) => {
    let done = 0
    let failed = 0
    for (const t of targets) {
      const res = ocrEngine === 'openai'
        ? await api.runOcrOpenAi({
          imagePath: t.imagePath,
          txtPath: t.txtPath,
          model: openAiModel || defaults.openAiModel || 'gpt-4o-mini',
          ...layoutPayload
        })
        : await api.runOcrFile({
          imagePath: t.imagePath,
          txtPath: t.txtPath,
          engine: ocrEngine,
          ...layoutPayload
        })
      done += 1
      if (!res?.ok) failed += 1
      setOcrProgress({ index: done, total: targets.length })
      setLogs(prev => [{
        type: res?.ok ? 'info' : 'error',
        text: `Re-OCR ${res?.ok ? 'OK' : 'ERR'}: ${(t.txtPath.split(/[/\\]/).pop() || t.txtPath)}${res?.error ? ' - ' + res.error : ''}`
      }, ...prev])
    }
    ocrJobActiveRef.current = false
    setOcrRunning(false)
    setLogs(prev => [{ type: 'info', text: `Re-OCR selesai. Total: ${targets.length}${failed ? `, gagal: ${failed}` : ''}` }, ...prev])
    await refreshFiles(folder)
    if (activeFileRef.current) await openFileContent(activeFileRef.current)
  }

  const reOcrFolder = async () => {
    if (!api) {
      setLogs(prev => [{ type: 'error', text: 'Re-OCR hanya tersedia di Electron.' }, ...prev])
      return
    }
    if (!folder || ocrRunning) return

    const imgDir = await resolveImageFolder(folder)
    if (!imgDir) {
      setLogs(prev => [{ type: 'error', text: 'Folder gambar tidak ditemukan. Pair folder gambar di detail kitab terlebih dahulu.' }, ...prev])
      return
    }

    const li = await api.listImageFiles(imgDir)
    const images = li?.ok ? (li.files || []) : []
    if (!images.length) {
      setLogs(prev => [{ type: 'error', text: `Tidak ada gambar di folder: ${imgDir}` }, ...prev])
      return
    }

    const allPageFiles = getPageFiles(files.length > 0 ? files : ((await api.listTxtFiles(folder))?.files || []))
    const selectedPageFiles = allPageFiles.filter((p) => checkedPaths.includes(p))
    const useSelectedOnly = selectedPageFiles.length > 0
    const sourceFiles = useSelectedOnly ? selectedPageFiles : allPageFiles
    const targets = sourceFiles
      .map((txtPath) => ({ txtPath, imagePath: chooseMatchingImage(images, txtPath) }))
      .filter((t) => t.imagePath)

    if (targets.length === 0) {
      setLogs(prev => [{ type: 'error', text: useSelectedOnly
        ? 'File yang dipilih tidak punya pasangan gambar.'
        : 'Tidak ada pasangan gambar untuk file .txt di folder ini.' }, ...prev])
      return
    }

    const layoutLabel = ocrLayoutMode === 'box_notes' ? 'Inside Box + Outside' : 'Full Page'
    const scopeLabel = useSelectedOnly
      ? `${targets.length} file terpilih`
      : `semua file (${targets.length} pasangan)`
    const ok = window.confirm(
      `Re-OCR ${scopeLabel}?\n\nGambar: ${imgDir}\nTeks: ${folder}\nEngine: ${ocrEngine}\nLayout: ${layoutLabel}\n\nFile .txt hasil OCR akan ditimpa.`
    )
    if (!ok) return

    ocrJobActiveRef.current = true
    setOcrRunning(true)
    setOcrProgress({ index: 0, total: targets.length })
    setLogs(prev => [{ type: 'info', text: `Mulai Re-OCR (${ocrEngine}, ${layoutLabel}) — ${scopeLabel}...` }, ...prev])

    try {
      let defaults = {}
      try { defaults = (await api.getDefaults?.()) || {} } catch (_) {}
      const lang = defaults.lang || 'ara'
      const tesseractPath = defaults.tesseractPath || ''
      const layoutPayload = {
        layoutMode: ocrLayoutMode,
        boxPaddingPct: ocrBoxPaddingPct,
        notePaddingPct: ocrNotePaddingPct,
        outsideFormat: ocrLayoutMode === 'box_notes' ? 'flat' : ocrOutsideFormat
      }

      if (useSelectedOnly || ocrEngine === 'openai') {
        await runSelectedOcrFiles(targets, layoutPayload, defaults)
        return
      }

      let res
      if (ocrEngine === 'arabic_dl') {
        res = await api.runOCRDL({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'easyocr') {
        res = await api.runOCREasy({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'kraken' || ocrEngine === 'kraken_arabic') {
        res = await api.runOCRKraken({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'google_vision') {
        res = await api.runOCRVision({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else if (ocrEngine === 'unlimited_ocr') {
        res = await api.runOCRUnlimited({ inputFolder: imgDir, outputFolder: folder, lang, ...layoutPayload })
      } else {
        res = await api.runOCR({ inputFolder: imgDir, outputFolder: folder, tesseractPath, lang, ...layoutPayload })
      }

      if (!res || !res.ok) {
        ocrJobActiveRef.current = false
        setOcrRunning(false)
        setLogs(prev => [{ type: 'error', text: `Gagal Re-OCR: ${res?.error || 'Unknown error'}` }, ...prev])
      } else if (ocrJobActiveRef.current) {
        ocrJobActiveRef.current = false
        setOcrRunning(false)
        setLogs(prev => [{ type: 'info', text: 'Re-OCR selesai.' }, ...prev])
        await refreshFiles(folder)
        if (activeFileRef.current) await openFileContent(activeFileRef.current)
      }
    } catch (e) {
      ocrJobActiveRef.current = false
      setOcrRunning(false)
      setLogs(prev => [{ type: 'error', text: `Gagal Re-OCR: ${e?.message || String(e)}` }, ...prev])
    }
  }

  useEffect(() => {
    if (!query) { setMatches([]); setCurrentMatch(0); return }
    try {
      const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(esc, 'gi')
      const pos = []
      let m
      while ((m = re.exec(viewerText)) !== null) {
        pos.push({ start: m.index, end: m.index + m[0].length })
      }
      setMatches(pos)
      setCurrentMatch(pos.length ? 0 : 0)
    } catch (_) {
      setMatches([])
    }
  }, [query, viewerText])

  const scrollToCurrent = () => {
    if (!viewerOpen) return
    const container = viewerRef.current
    let el = currentRef.current
    if (!el && container) {
      el = container.querySelector(`#match-${currentMatch}`)
    }
    if (el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (_) {}
      try { el.focus() } catch (_) {}
    }
  }

  useEffect(() => {
    scrollToCurrent()
  }, [currentMatch, viewerOpen, query])

  const goNext = () => {
    if (matches.length === 0) return
    setCurrentMatch(i => (i + 1) % matches.length)
    if (matches.length === 1) setTimeout(scrollToCurrent, 0)
  }
  const goPrev = () => {
    if (matches.length === 0) return
    setCurrentMatch(i => (i - 1 + matches.length) % matches.length)
    if (matches.length === 1) setTimeout(scrollToCurrent, 0)
  }

  const renderHighlighted = () => {
    if (!query || matches.length === 0) return (<div className="mb-0">{viewerText}</div>)
    const nodes = []
    let last = 0
    matches.forEach((m, idx) => {
      if (last < m.start) nodes.push(<span key={`t-${idx}`}>{viewerText.slice(last, m.start)}</span>)
      const isCurrent = idx === currentMatch
      nodes.push(
        <mark id={`match-${idx}`} key={`m-${idx}`} ref={isCurrent ? currentRef : null} className={isCurrent ? 'match-current' : ''} tabIndex={isCurrent ? -1 : undefined}>
          {viewerText.slice(m.start, m.end)}
        </mark>
      )
      last = m.end
    })
    if (last < viewerText.length) nodes.push(<span key={`t-end`}>{viewerText.slice(last)}</span>)
    return (<div className="mb-0">{nodes}</div>)
  }

  return (
    <div className="mt-3">
      <Form className="mb-3">
        <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
          <Button variant="success" size="sm" disabled={!api || !folder || ocrRunning} onClick={joinText}>
            <i className="bi bi-file-richtext me-2" /> Gabung Teks
          </Button>
          <Button variant="outline-primary" size="sm" disabled={!api || !folder || ocrRunning} onClick={viewMergedFile}>
            <i className="bi bi-eye me-2" /> View File
          </Button>
          <Button variant="outline-warning" size="sm" disabled={!activeFile || ocrRunning} onClick={() => { onOpenSplit?.({ folder, file: activeFile, imageFolder }) }}>
            Split View
          </Button>
        </div>
        <div className="d-flex flex-wrap align-items-end gap-3">
          <div>
            <div className="text-muted small mb-1">OCR Engine</div>
            <Form.Select size="sm" style={{ width: '180px' }} value={ocrEngine} onChange={handleEngineChange} disabled={ocrRunning}>
              <option value="tesseract">Tesseract</option>
              <option value="arabic_dl">Arabic DL</option>
              <option value="kraken_arabic">Kraken (Arabic)</option>
              <option value="easyocr">EasyOCR</option>
              <option value="google_vision">Google Vision</option>
              <option value="unlimited_ocr">Unlimited-OCR</option>
              <option value="openai">OpenAI</option>
            </Form.Select>
          </div>
          <div>
            <div className="text-muted small mb-1">Layout OCR</div>
            <Form.Select size="sm" style={{ width: '220px' }} value={ocrLayoutMode} onChange={handleLayoutModeChange} disabled={ocrRunning}>
              <option value="box_notes">Inside Box + Outside di akhir</option>
              <option value="full">Full Page</option>
            </Form.Select>
          </div>
          <Button variant="outline-primary" size="sm" className="px-3" disabled={!api || !folder || ocrRunning} onClick={reOcrFolder}>
            <i className="bi bi-card-text me-1" /> Re-OCR
            {checkedPaths.length > 0 ? ` (${checkedPaths.length})` : ' (all)'}
          </Button>
        </div>
        {ocrRunning && (
          <div className="mt-2">
            <ProgressBar
              now={ocrProgress.total > 0 ? Math.round(ocrProgress.index * 100 / ocrProgress.total) : 0}
              label={ocrProgress.total > 0 ? `${Math.round(ocrProgress.index * 100 / ocrProgress.total)}%` : ''}
            />
            <div className="mt-1 text-muted small">
              Re-OCR: {ocrProgress.index} / {ocrProgress.total}
            </div>
          </div>
        )}
      </Form>

      <Row className="g-3">
        <Col md={4}>
          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
            <Form.Check
              type="checkbox"
              id="reocr-select-all-detail"
              label="Pilih semua (Re-OCR)"
              checked={getPageFiles().length > 0 && getPageFiles().every((p) => checkedPaths.includes(p))}
              disabled={ocrRunning || getPageFiles().length === 0}
              onChange={toggleSelectAllForOcr}
            />
            <span className="text-muted small">
              {checkedPaths.length > 0 ? `${checkedPaths.length} dipilih` : 'Tanpa pilihan = all'}
            </span>
          </div>
          <ListGroup style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {files.length === 0 && (
              <ListGroup.Item className="text-muted">Tidak ada file .txt</ListGroup.Item>
            )}
            {files.map((p, i) => {
              const name = p.replace(folder + '\\', '')
              const isAllPages = (name || '').toLowerCase() === 'all_pages.txt'
              const isChecked = checkedPaths.includes(p)
              return (
                <ListGroup.Item
                  key={i}
                  action
                  active={selected === p}
                  onClick={() => { setSelected(p); openFileContent(p) }}
                  className="d-flex align-items-center gap-2"
                >
                  {!isAllPages && (
                    <Form.Check
                      type="checkbox"
                      checked={isChecked}
                      disabled={ocrRunning}
                      onChange={(e) => toggleCheckedPath(p, e)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Pilih ${name} untuk Re-OCR`}
                    />
                  )}
                  <span className="text-truncate" style={{ maxWidth: '100%' }}>{name}</span>
                </ListGroup.Item>
              )
            })}
          </ListGroup>
        </Col>
        <Col md={8}>
          <Accordion defaultActiveKey="active">
            <Accordion.Item eventKey="active">
              <Accordion.Header>
                Aktif: {activeFile ? activeFile.replace(folder + '\\', '') : '-'}
              </Accordion.Header>
              <Accordion.Body>
                <div className="mb-3">
                  <div className="text-muted small mb-2">Teks Asli</div>
                  <div className="p-3 border rounded-3 mb-3" style={{ maxHeight: '30vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                    {original || <span className="text-muted">Pilih file untuk melihat teks asli.</span>}
                  </div>

                  <div className="text-muted small mb-2">Terjemahan (Database)</div>
                  <Form>
                    <Form.Control
                      as="textarea"
                      rows={8}
                      value={localInput}
                      onChange={e => setLocalInput(e.target.value)}
                      placeholder={dbTranslation ? '' : 'Belum ada terjemahan di database. Tulis terjemahan di sini...'}
                      style={{ whiteSpace: 'pre-wrap' }}
                    />
                    <div className="d-flex justify-content-end mt-2">
                      <Button
                        variant="success"
                        size="sm"
                        disabled={!api || !activeFile || saving}
                        onClick={async () => {
                          try {
                            setSaving(true)
                            const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
                            const fileName = (activeFile || '').split('\\').pop() || ''
                            const res = await api.saveTranslation({ kitabName, folderPath: folder, fileName, originalText: original, translatedText: localInput })
                            if (res && res.ok) {
                              setDbTranslation(localInput)
                              setResult(localInput)
                              setLogs(prev => [{ type: 'success', text: `Terjemahan berhasil disimpan (${res.action}).` }, ...prev])
                            } else {
                              throw new Error(res?.error || 'Gagal menyimpan terjemahan.')
                            }
                          } catch (e) {
                            setLogs(prev => [{ type: 'error', text: e.message || 'Kesalahan saat menyimpan.' }, ...prev])
                          } finally {
                            setSaving(false)
                          }
                        }}
                      >
                        Simpan
                      </Button>
                    </div>
                  </Form>
                </div>


              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
        </Col>
      </Row>

      <ListGroup className="mt-3">
        {logs.map((l, i) => (
          <ListGroup.Item key={i} variant={l.type === 'error' ? 'danger' : 'success'}>{l.text}</ListGroup.Item>
        ))}
      </ListGroup>

      <Modal show={viewerOpen} onHide={() => setViewerOpen(false)} size="lg">
        <Modal.Header closeButton className="align-items-center">
          <div className="modal-title-wrap flex-grow-1 me-2">
            <Modal.Title className="modal-title-truncate">Preview: {viewerPath || 'all_pages.txt'}</Modal.Title>
          </div>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
            <Form.Control
              className="flex-grow-1"
              ref={searchInputRef}
              size="sm"
              placeholder="Find (Ctrl+F)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goNext(); } else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); goPrev(); } }}
            />
            <div className="text-muted small">{matches.length ? `${currentMatch + 1}/${matches.length}` : '0/0'}</div>
            <Button variant="outline-secondary" size="sm" onClick={goPrev} disabled={matches.length === 0}><i className="bi bi-chevron-up" /></Button>
            <Button variant="outline-secondary" size="sm" onClick={goNext} disabled={matches.length === 0}><i className="bi bi-chevron-down" /></Button>
          </div>
          <div ref={viewerRef} className="viewer" style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {renderHighlighted()}
          </div>
        </Modal.Body>
      </Modal>
    </div>
  )
}
