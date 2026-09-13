import React, { useEffect, useState, useRef } from 'react'
import { Row, Col, Button, Alert, Form, Modal } from 'react-bootstrap'

const getSystemVoices = () => {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) {
      resolve(voices)
      return
    }
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', handler)
    setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler)
        resolve(window.speechSynthesis.getVoices())
    }, 1000)
  })
}

const isArabicText = (text) => {
  if (!text) return false
  // Memeriksa apakah teks mengandung karakter Arab
  const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
  return arabicRegex.test(String(text))
}

const normalizeArabicForComparison = (text) => {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const compareReadingTranscript = (targetText, transcriptText) => {
  const targetNormalized = normalizeArabicForComparison(targetText)
  const transcriptNormalized = normalizeArabicForComparison(transcriptText)
  const targetTokens = targetNormalized ? targetNormalized.split(' ') : []
  const transcriptTokens = transcriptNormalized ? transcriptNormalized.split(' ') : []

  if (!targetTokens.length) {
    return {
      status: 'mismatch',
      similarity: 0,
      matchedCount: 0,
      targetCount: 0,
      transcriptCount: transcriptTokens.length,
      missingWords: [],
      unexpectedWords: transcriptTokens,
      feedback: 'Teks target belum tersedia untuk dibandingkan.'
    }
  }

  if (!transcriptTokens.length) {
    return {
      status: 'mismatch',
      similarity: 0,
      matchedCount: 0,
      targetCount: targetTokens.length,
      transcriptCount: 0,
      missingWords: targetTokens,
      unexpectedWords: [],
      feedback: 'Belum ada hasil bacaan yang bisa dibandingkan.'
    }
  }

  const targetCounts = new Map()
  const transcriptCounts = new Map()
  for (const token of targetTokens) targetCounts.set(token, (targetCounts.get(token) || 0) + 1)
  for (const token of transcriptTokens) transcriptCounts.set(token, (transcriptCounts.get(token) || 0) + 1)

  let matchedCount = 0
  const missingWords = []
  const unexpectedWords = []

  for (const [token, count] of targetCounts.entries()) {
    const transcriptCount = transcriptCounts.get(token) || 0
    const matched = Math.min(count, transcriptCount)
    matchedCount += matched
    for (let i = 0; i < count - matched; i += 1) missingWords.push(token)
  }

  for (const [token, count] of transcriptCounts.entries()) {
    const targetCount = targetCounts.get(token) || 0
    const matched = Math.min(count, targetCount)
    for (let i = 0; i < count - matched; i += 1) unexpectedWords.push(token)
  }

  const denominator = Math.max(targetTokens.length, transcriptTokens.length, 1)
  const similarity = matchedCount / denominator
  let status = 'mismatch'
  if (similarity >= 0.85 && missingWords.length <= 1 && unexpectedWords.length <= 1) status = 'match_high'
  else if (similarity >= 0.45) status = 'match_partial'

  const feedback = status === 'match_high'
    ? 'Bacaan sudah cukup sesuai dengan teks target.'
    : status === 'match_partial'
      ? 'Bacaan cukup mendekati, tetapi masih ada bagian yang perlu diperbaiki.'
      : 'Bacaan masih cukup jauh dari teks target.'

  return {
    status,
    similarity,
    matchedCount,
    targetCount: targetTokens.length,
    transcriptCount: transcriptTokens.length,
    missingWords,
    unexpectedWords,
    feedback
  }
}

const getSavedSplitSession = (settings, folderPath) => {
  if (!settings || !folderPath) return null
  const sessionMap = settings.lastOpenedKitabSessions && typeof settings.lastOpenedKitabSessions === 'object'
    ? settings.lastOpenedKitabSessions
    : {}
  if (sessionMap[folderPath]) return sessionMap[folderPath]
  if (settings.lastOpenedSplit && settings.lastOpenedSplit.folder === folderPath) return settings.lastOpenedSplit
  return null
}

export default function SplitViewPage({ initialFolder = '', initialFile = '', initialImageFolder = '', onBack }) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [folder, setFolder] = useState(initialFolder || '')
  const [file, setFile] = useState(initialFile || '')
  const [imageFolder, setImageFolder] = useState(initialImageFolder || '')
  const [image, setImage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [filesList, setFilesList] = useState([])
  const [text, setText] = useState('')
  const [translated, setTranslated] = useState('')
  const [translatedMeta, setTranslatedMeta] = useState(null)
  const [aiConfidence, setAiConfidence] = useState(null)
  const [assistContext, setAssistContext] = useState(null)
  const [assistLoading, setAssistLoading] = useState(false)
  const [sourceUnitContext, setSourceUnitContext] = useState(null)
  const [sourceUnitLoading, setSourceUnitLoading] = useState(false)
  const [sourceUnitSyncing, setSourceUnitSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeVariant, setNoticeVariant] = useState('warning')
  const [cliResult, setCliResult] = useState('')
  const [cliContext, setCliContext] = useState(null)
  const [cliRunning, setCliRunning] = useState(false)
  const [translateStatus, setTranslateStatus] = useState(null)
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false)
  const [translatePromptModal, setTranslatePromptModal] = useState({ show: false, prompt: '' })
  const [translateEditModal, setTranslateEditModal] = useState({ show: false, value: '', source: 'cli' })
  const [translateEditSaving, setTranslateEditSaving] = useState(false)
  const [reviewActor, setReviewActor] = useState('editor')
  
  // New view mode state: 'reader' (Image focus), 'study' (Image + Translation), 'ocr' (All tools)
  const [viewMode, setViewMode] = useState('reader')
  const [studySubMode, setStudySubMode] = useState('makna')
  const [sectionVisibility, setSectionVisibility] = useState({
    image: true,
    ocrText: true,
    translation: true,
    tools: true
  })
  const [versionHistoryModal, setVersionHistoryModal] = useState({ show: false, loading: false })
  const [versionHistory, setVersionHistory] = useState([])
  const [feedbackHistory, setFeedbackHistory] = useState([])
  const [compareVersionIds, setCompareVersionIds] = useState({ left: '', right: '' })
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrEngine, setOcrEngine] = useState('tesseract')
  const [ocrLayoutMode, setOcrLayoutMode] = useState('full')
  const [ocrBoxPaddingPct, setOcrBoxPaddingPct] = useState(0.01)
  const [ocrNotePaddingPct, setOcrNotePaddingPct] = useState(0.01)
  const [ocrOutsideFormat, setOcrOutsideFormat] = useState('flat')
  const [translateAi, setTranslateAi] = useState('gemini')
  const [translateProviders, setTranslateProviders] = useState([])
  const [translateProviderId, setTranslateProviderId] = useState(null)
  const [openAiModel, setOpenAiModel] = useState('gpt-4o-mini')
  const [geminiModel, setGeminiModel] = useState('gemini-1.5-flash-latest')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0 })
  const offsetStart = useRef({ x: 0, y: 0 })
  const imgWrapRef = useRef(null)
  const translateProviderInitRef = useRef(false)
  
  const [ctxMenu, setCtxMenu] = useState({ show: false, x: 0, y: 0, text: '' })
  const [wordModal, setWordModal] = useState({ show: false, text: '', translation: '', loading: false, provider: 'gemini' })
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [textAudioGenerating, setTextAudioGenerating] = useState(false)
  const [textAudioProviderMenuOpen, setTextAudioProviderMenuOpen] = useState(false)
  const [textAudioProvider, setTextAudioProvider] = useState('openai')
  const [savedTextAudioUrl, setSavedTextAudioUrl] = useState('')
  const [savedTextAudioPath, setSavedTextAudioPath] = useState('')
  const [savedTextAudioManifest, setSavedTextAudioManifest] = useState(null)
  const [textAudioTimeline, setTextAudioTimeline] = useState([])
  const [activeTextAudioChunkIndex, setActiveTextAudioChunkIndex] = useState(-1)
  const [systemTtsRange, setSystemTtsRange] = useState(null)
  const [textAudioMode, setTextAudioMode] = useState('')
  const audioRef = useRef(null)
  const voicePromptAudioRef = useRef(null)
  const voiceTtsCacheRef = useRef(new Map())

  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [voicePurpose, setVoicePurpose] = useState('command')
  const recognitionRef = useRef(null)
  const voiceSilenceTimerRef = useRef(null)
  const micStreamRef = useRef(null)
  const voiceStopRequestedRef = useRef(false)
  const voiceModeRef = useRef('idle')
  const voicePurposeRef = useRef('command')
  const mediaRecorderRef = useRef(null)
  const mediaChunksRef = useRef([])
  const voiceLevelTimerRef = useRef(null)
  const voiceAudioCtxRef = useRef(null)
  const voiceAnalyserRef = useRef(null)
  const [readingTargetText, setReadingTargetText] = useState('')
  const [readingTranscript, setReadingTranscript] = useState('')
  const [readingComparison, setReadingComparison] = useState(null)
  const [readingTestStatus, setReadingTestStatus] = useState('idle')
  const [readingTestError, setReadingTestError] = useState('')
  
  // New state for submenu visibility
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [audioPaused, setAudioPaused] = useState(false)
  
  const [kitabInfo, setKitabInfo] = useState(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!api || !folder) {
        setKitabInfo(null)
        return
      }
      try {
        const res = await api.findKitabByFolder(folder)
        if (cancelled) return
        if (res && res.ok && res.data) setKitabInfo(res.data)
        else setKitabInfo(null)
      } catch (_) {
        if (!cancelled) setKitabInfo(null)
      }
    }
    run()
    return () => { cancelled = true }
  }, [api, folder])

  useEffect(() => {
    setReadingTargetText(text || '')
    setReadingTranscript('')
    setReadingComparison(null)
    setReadingTestStatus('idle')
    setReadingTestError('')
  }, [text, file])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!api || !api.getSavedTtsAudio || !folder || !file) {
        if (!cancelled) {
          setSavedTextAudioUrl('')
          setSavedTextAudioPath('')
        }
        return
      }
      try {
        const res = await api.getSavedTtsAudio({ folderPath: folder, filePath: file })
        if (cancelled) return
        if (res && res.ok && res.exists) {
          setSavedTextAudioUrl(res.audioUrl || '')
          setSavedTextAudioPath(res.audioPath || '')
          setSavedTextAudioManifest(res.manifest || null)
        } else {
          setSavedTextAudioUrl('')
          setSavedTextAudioPath('')
          setSavedTextAudioManifest(null)
        }
      } catch (_) {
        if (!cancelled) {
          setSavedTextAudioUrl('')
          setSavedTextAudioPath('')
          setSavedTextAudioManifest(null)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [api, folder, file])

  useEffect(() => {
    setFolder(initialFolder || '')
    setFile(initialFile || '')
    setImageFolder(initialImageFolder || '')
  }, [initialFolder, initialFile, initialImageFolder])

  // Save last opened split view state
  useEffect(() => {
    if (!folder || !file || !api || !api.saveSettings) return

    let cancelled = false
    const saveLastSession = async () => {
      const session = {
        folder,
        file,
        imageFolder,
        timestamp: Date.now()
      }
      try {
        let currentSettings = {}
        if (api.getSettings) {
          currentSettings = await api.getSettings()
        }
        if (cancelled) return
        const currentSessions = currentSettings && currentSettings.lastOpenedKitabSessions && typeof currentSettings.lastOpenedKitabSessions === 'object'
          ? currentSettings.lastOpenedKitabSessions
          : {}
        await api.saveSettings({
          lastOpenedSplit: session,
          lastOpenedKitabSessions: {
            ...currentSessions,
            [folder]: session
          }
        })
      } catch (e) {
        console.error('Failed to save last opened split state', e)
      }
    }

    saveLastSession()
    return () => { cancelled = true }
  }, [folder, file, imageFolder, api])

  useEffect(() => {
    if (api) {
      api.getDefaults().then(defaults => {
        if (defaults && defaults.ocrEngine) {
          setOcrEngine(defaults.ocrEngine)
        }
        const nextLayoutMode = defaults && defaults.ocrLayoutMode ? defaults.ocrLayoutMode : 'box_notes'
        setOcrLayoutMode(nextLayoutMode)
        if (defaults && defaults.ocrBoxPaddingPct != null) {
          const nextBoxPadding = Number(defaults.ocrBoxPaddingPct)
          setOcrBoxPaddingPct(Number.isFinite(nextBoxPadding) ? nextBoxPadding : 0.01)
        }
        if (defaults && defaults.ocrNotePaddingPct != null) {
          const nextNotePadding = Number(defaults.ocrNotePaddingPct)
          setOcrNotePaddingPct(Number.isFinite(nextNotePadding) ? nextNotePadding : 0.01)
        }
        if (defaults && defaults.ocrOutsideFormat) {
          setOcrOutsideFormat(defaults.ocrOutsideFormat)
        }
        if (defaults && defaults.translateAi) {
          setTranslateAi(defaults.translateAi)
        }
        if (defaults && defaults.translateProviderId) {
          setTranslateProviderId(Number(defaults.translateProviderId) || null)
        }
        if (defaults && defaults.openAiModel) {
          setOpenAiModel(defaults.openAiModel)
        }
        if (defaults && defaults.geminiModel) {
          setGeminiModel(defaults.geminiModel)
        }
      })
      // Load dynamic translate providers
      api.filterProvidersByCapability('translate').then(res => {
        if (res && res.ok && res.data) {
          setTranslateProviders(res.data)
        }
      }).catch(() => {})
    }
  }, [api])

  useEffect(() => {
    if (!api) return
    if (translateProviderInitRef.current) return
    if (!Array.isArray(translateProviders) || translateProviders.length === 0) return

    const byId = translateProviderId
      ? translateProviders.find(p => Number(p.id) === Number(translateProviderId))
      : null
    if (byId) {
      setTranslateAi(byId.provider)
      translateProviderInitRef.current = true
      return
    }

    const byProvider = translateProviders.find(p => p.provider === translateAi)
    const pick = byProvider || translateProviders[0]
    if (pick) {
      setTranslateAi(pick.provider)
      setTranslateProviderId(pick.id)
      api.saveSettings({ translateAi: pick.provider, translateProviderId: pick.id }).catch(() => {})
      translateProviderInitRef.current = true
    }
  }, [api, translateProviders, translateProviderId, translateAi])

  useEffect(() => {
    setCliResult('')
    setCliContext(null)
    setTranslated('')
    setTranslatedMeta(null)
    setAiConfidence(null)
    setText('')
    const load = async () => {
      if (!api) { setNotice('Split view hanya tersedia di Electron.'); setNoticeVariant('warning'); return }
      if (!folder) { setNotice('Pilih kitab/folder terlebih dahulu.'); setNoticeVariant('warning'); return }
      
      // Auto-select file if missing
      let currentFile = file
      if (!currentFile) {
         try {
           let preferredSession = null
           if (api.getSettings) {
             const settings = await api.getSettings()
             preferredSession = getSavedSplitSession(settings, folder)
           }
           const lf = await api.listTxtFiles(folder)
           if (lf && lf.ok && lf.files && lf.files.length > 0) {
              const list = lf.files
              const sorted = [...list].sort((a, b) => {
                const ra = a.replace(folder + '\\', '')
                const rb = b.replace(folder + '\\', '')
                const ba = ra.replace(/\.[^.]+$/, '')
                const bb = rb.replace(/\.[^.]+$/, '')
                const ma = ba.match(/(\d+)$/)
                const mb = bb.match(/(\d+)$/)
                const na = ma ? parseInt(ma[1], 10) : NaN
                const nb = mb ? parseInt(mb[1], 10) : NaN
                if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
                return ba.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
              })
              const preferredFile = preferredSession && preferredSession.file && sorted.includes(preferredSession.file)
                ? preferredSession.file
                : sorted[0]
              currentFile = preferredFile
              setFile(currentFile)
              // The effect will re-run with the new file, so we stop here
              return
           } else {
              setNotice('Tidak ada file teks di folder kitab ini.')
              setNoticeVariant('warning')
              return
           }
         } catch (e) {
            console.error(e)
            setNotice('Gagal memuat daftar file.')
            return
         }
      }

      if (!currentFile) { setNotice('Pilih file teks terlebih dahulu di Translate.'); setNoticeVariant('warning'); return }

      try {
        // Load list of txt files to enable prev/next navigation
        try {
          const lf = await api.listTxtFiles(folder)
          if (lf && lf.ok) {
            const list = lf.files || []
            const sorted = [...list].sort((a, b) => {
              const ra = a.replace(folder + '\\', '')
              const rb = b.replace(folder + '\\', '')
              const ba = ra.replace(/\.[^.]+$/, '')
              const bb = rb.replace(/\.[^.]+$/, '')
              const ma = ba.match(/(\d+)$/)
              const mb = bb.match(/(\d+)$/)
              const na = ma ? parseInt(ma[1], 10) : NaN
              const nb = mb ? parseInt(mb[1], 10) : NaN
              if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
              return ba.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
            })
            setFilesList(sorted)
          } else {
            setFilesList([])
          }
        } catch (_) { setFilesList([]) }

        const rf = await api.readFile(file)
        if (rf && rf.ok) {
          const original = rf.content || ''
          setText(original)
          await loadAssistContext(original)
          await loadSourceUnitContext(original)
          const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
          try {
            const fileName = (file || '').split('\\').pop() || ''
            const tr = await api.getTranslation({ kitabName, folderPath: folder, fileName, originalText: original })
            if (tr && tr.ok && tr.data) {
              setTranslated(tr.data.text_translate || '')
              setTranslatedMeta(tr.data || null)
            } else {
          setAssistContext(null)
          setSourceUnitContext(null)
              setTranslated('')
              setTranslatedMeta(null)
            }
          } catch (_) { setTranslated(''); setTranslatedMeta(null) }
        }
        const li = await api.listImageFiles(imageFolder || folder)
        if (li && li.ok) {
          const imgs = li.files || []
          const pick = chooseMatchingImage(imgs, file)
          setImage(pick || imgs[0] || '')
          setScale(1)
          setOffset({ x: 0, y: 0 })
        }
      } catch (e) {
        setNotice(e.message || 'Gagal memuat split view.')
        setNoticeVariant('danger')
      }
    }
    load()
  }, [api, folder, file])

  useEffect(() => {
    const loadImg = async () => {
      if (!api || !image) { setImageUrl(''); return }
      try {
        const r = await api.readImageDataUrl(image)
        if (r && r.ok) setImageUrl(r.dataUrl || '')
        else setImageUrl('')
      } catch (_) {
        setImageUrl('')
      }
    }
    loadImg()
  }, [api, image])

  useEffect(() => {
    if (!imageUrl) return
    // Re-anchor the image whenever its container context changes.
    setOffset({ x: 0, y: 0 })
  }, [imageUrl, viewMode, sectionVisibility.image])

  useEffect(() => {
    if (!api) return undefined

    let disposed = false
    let unsubscribeStatus = null
    let unsubscribeComplete = null

    const stageToStep = {
      preparing: 0,
      checking_database: 0,
      loading_reference: 1,
      loading_context: 1,
      semantic_search: 1,
      preparing_ai: 2,
      init: 2,
      building_prompt: 2,
      try: 2,
      calling_ai: 2,
      attempt: 2,
      reuse_exact: 2,
      saving_memory: 3
    }

    const stepTitles = [
      'Cek database',
      'Siapkan referensi dan konteks',
      'Terjemahkan atau pakai hasil lama',
      'Simpan hasil untuk pemakaian berikutnya'
    ]

    const buildStatusState = (payload = {}) => {
      const running = !!payload.running
      const stage = String(payload.stage || '').trim()
      const activeStep = Object.prototype.hasOwnProperty.call(stageToStep, stage) ? stageToStep[stage] : -1
      const steps = stepTitles.map((title, index) => ({
          key: `step-${index}`,
          title,
          done: activeStep > index,
          active: activeStep === index
        }))

      return {
        running,
        provider: payload.provider || null,
        model: payload.model || null,
        stage,
        stageLabel: payload.stageLabel || '',
        stageDetail: payload.stageDetail || '',
        attempt: Number(payload.attempt || 0),
        queueLength: Number(payload.queueLength || 0),
        steps
      }
    }

    const syncInitialStatus = async () => {
      if (!api.getTranslateStatus) return
      try {
        const status = await api.getTranslateStatus()
        if (disposed) return
        if (status?.running) setTranslateStatus(buildStatusState(status))
        else setTranslateStatus(null)
      } catch (_) {}
    }

    syncInitialStatus()

    if (api.onTranslateStatus) {
      unsubscribeStatus = api.onTranslateStatus((payload) => {
        if (disposed) return
        if (payload?.running) setTranslateStatus(buildStatusState(payload))
        else setTranslateStatus(null)
      })
    }

    if (api.onTranslateComplete) {
      unsubscribeComplete = api.onTranslateComplete((payload) => {
        if (disposed) return
        if (payload?.ok && payload?.reused) {
          setTranslateStatus({
            running: false,
            provider: payload.provider || 'translation-memory',
            model: payload.model || null,
            stage: 'reuse_exact',
            stageLabel: 'Terjemahan langsung ditemukan di database',
            stageDetail: 'AI tidak dipanggil karena sistem sudah menemukan hasil yang cocok.',
            attempt: 0,
            queueLength: 0,
            steps: []
          })
          window.setTimeout(() => {
            if (!disposed) setTranslateStatus(null)
          }, 3500)
          return
        }
        setTranslateStatus(null)
      })
    }

    return () => {
      disposed = true
      if (typeof unsubscribeStatus === 'function') unsubscribeStatus()
      if (typeof unsubscribeComplete === 'function') unsubscribeComplete()
    }
  }, [api])

  const onWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const next = Math.max(0.2, Math.min(6, scale + delta))
    setScale(next)
  }

  const onMouseDown = (e) => {
    if (!imageUrl) return
    setPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY }
    offsetStart.current = { ...offset }
  }
  const onMouseMove = (e) => {
    if (!panning) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    setOffset({ x: offsetStart.current.x + dx, y: offsetStart.current.y + dy })
  }
  const stopPan = () => setPanning(false)

  const zoomIn = () => setScale(s => Math.min(6, s + 0.2))
  const zoomOut = () => setScale(s => Math.max(0.2, s - 0.2))
  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }) }

  const copyOriginal = async () => {
    try {
      const t = text || ''
      if (!t) { setNotice('Tidak ada teks untuk disalin.'); setNoticeVariant('warning'); return }
      let ok = false
      if (api && api.copyToClipboard) {
        try { ok = !!api.copyToClipboard(t) } catch (_) { ok = false }
      }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(t); ok = true } catch (_) { ok = false }
      }
      if (!ok) {
        const ta = document.createElement('textarea')
        ta.value = t
        ta.style.position = 'fixed'
        ta.style.top = '0'
        ta.style.left = '0'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); ok = true } catch (_) { ok = false }
        document.body.removeChild(ta)
      }
      if (ok) {
        setNoticeVariant('success')
        setNotice('Teks asli disalin ke clipboard.')
        setTimeout(() => setNotice(''), 2000)
      } else {
        setNoticeVariant('danger')
        setNotice('Gagal menyalin teks.')
      }
    } catch (_) {
      setNoticeVariant('danger')
      setNotice('Gagal menyalin teks.')
    }
  }

  const getTranslateProviderConfig = (providerOverride) => {
    const provider = String(providerOverride || translateAi || '').trim()
    if (!provider) return null
    const byId = translateProviderId
      ? translateProviders.find(p => Number(p.id) === Number(translateProviderId))
      : null
    if (byId && String(byId.provider || '').trim() === provider) return byId
    return translateProviders.find(p => p.provider === provider) || null
  }

  const renderTranslateProcessAlert = () => {
    if (!translateStatus && !cliRunning) return null

    const status = translateStatus || {
      running: true,
      provider: null,
      model: null,
      stageLabel: 'Sedang memproses terjemahan',
      stageDetail: 'Mohon tunggu sebentar, sistem sedang bekerja.',
      queueLength: 0,
      steps: []
    }

    const providerLabel = (() => {
      if (status.provider === 'translation-memory') return 'Database internal'
      if (status.provider === 'openai') return 'OpenAI'
      if (status.provider === 'gemini') return 'Gemini'
      return status.provider || '-'
    })()

    return (
      <Alert variant={status.provider === 'translation-memory' && !status.running ? 'success' : 'info'} className="mb-3">
        <div className="d-flex align-items-start gap-3">
          <div className={`spinner-border spinner-border-sm flex-shrink-0 mt-1 ${status.running ? '' : 'd-none'}`} role="status" />
          <div className="flex-grow-1">
            <div className="fw-semibold mb-1">{status.stageLabel || 'Sedang memproses terjemahan'}</div>
            <div className="small mb-2">{status.stageDetail || 'Mohon tunggu sebentar, sistem sedang bekerja.'}</div>
            <div className="small text-muted d-flex flex-wrap gap-3">
              <span>Provider: {providerLabel}</span>
              {status.model ? <span>Model: {status.model}</span> : null}
              {status.attempt > 0 ? <span>Percobaan: {status.attempt}</span> : null}
              {status.queueLength > 0 ? <span>Antrian: {status.queueLength}</span> : null}
            </div>
            {Array.isArray(status.steps) && status.steps.length > 0 ? (
              <div className="mt-3 d-flex flex-column gap-2">
                {status.steps.map((step) => (
                  <div
                    key={step.key}
                    className={`d-flex align-items-center gap-2 px-2 py-1 rounded-2 ${
                      step.active ? 'bg-primary text-white' : step.done ? 'bg-success-subtle' : 'bg-light'
                    }`}
                  >
                    <span style={{ width: 18, textAlign: 'center' }}>
                      {step.done ? '✓' : step.active ? '•' : '○'}
                    </span>
                    <span>{step.title}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Alert>
    )
  }

  const runGeminiTranslate = async (modelOverride, promptOverride) => {
    if (!api || !text) return
    setCliRunning(true)
    setCliContext(null)
    setNotice('')
    try {
      const model = modelOverride || geminiModel || 'gemini-1.5-flash-latest'
      const prompt = typeof promptOverride === 'string' ? promptOverride : ''
      const fileName = (file || '').split('\\').filter(Boolean).pop() || ''
      const page = (fileName.match(/\d+/) || [])[0] || ''
      const providerConfig = getTranslateProviderConfig('gemini')
      const r = api.translateAi
        ? await api.translateAi({ provider: 'gemini', providerId: providerConfig?.id || null, text, target: 'id', model, prompt, folderPath: folder, filePath: file, fileName, page })
        : await api.translateGeminiCli({ text, target: 'id', model, prompt, folderPath: folder, filePath: file, fileName, page })
      if (r && r.ok) {
        setCliResult(r.output || '')
        setCliContext(r.context || null)
        setAiConfidence(r.confidence || null)
        if (!r.output) { setNoticeVariant('warning'); setNotice('Tidak ada keluaran dari Gemini.') }
        else if (r.confidence?.low_confidence) {
          setNoticeVariant('warning')
          setNotice('Hasil AI terdeteksi low confidence. Review sebelum simpan ke database.')
        }
      } else {
        setCliContext(r?.context || null)
        setNoticeVariant('danger')
        setNotice(r?.error || 'Gagal menerjemahkan.')
      }
    } catch (e) {
      setCliContext(null)
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal menerjemahkan.')
    } finally {
      setCliRunning(false)
    }
  }

  const runOpenAiTranslate = async (modelOverride, promptOverride) => {
    if (!api || !text) return
    setCliRunning(true)
    setCliContext(null)
    setNotice('')
    try {
      const model = modelOverride || openAiModel || 'gpt-4o-mini'
      const prompt = typeof promptOverride === 'string' ? promptOverride : ''
      const fileName = (file || '').split('\\').filter(Boolean).pop() || ''
      const page = (fileName.match(/\d+/) || [])[0] || ''
      const providerConfig = getTranslateProviderConfig('openai')
      const r = api.translateAi
        ? await api.translateAi({ provider: 'openai', providerId: providerConfig?.id || null, text, target: 'id', model, prompt, folderPath: folder, filePath: file, fileName, page })
        : await api.translateOpenAiCli({ text, target: 'id', model, prompt, folderPath: folder, filePath: file, fileName, page })
      if (r && r.ok) {
        setCliResult(r.output || '')
        setCliContext(r.context || null)
        setAiConfidence(r.confidence || null)
        if (!r.output) { setNoticeVariant('warning'); setNotice('Tidak ada keluaran dari OpenAI.') }
        else if (r.confidence?.low_confidence) {
          setNoticeVariant('warning')
          setNotice('Hasil AI terdeteksi low confidence. Review sebelum simpan ke database.')
        }
      } else {
        setCliContext(r?.context || null)
        setNoticeVariant('danger')
        setNotice(r?.error || 'Gagal menerjemahkan.')
      }
    } catch (e) {
      setCliContext(null)
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal menerjemahkan.')
    } finally {
      setCliRunning(false)
    }
  }

  const runTranslate = async (opts = {}) => {
    const provider = opts.provider || translateAi
    const prompt = typeof opts.prompt === 'string' ? opts.prompt : ''
    // Find provider config from dynamic list
    const providerConfig = getTranslateProviderConfig(provider)
    const model = opts.model || (providerConfig?.model_default || (provider === 'openai' ? openAiModel : geminiModel))
    if (provider === 'openai') return runOpenAiTranslate(model, prompt)
    if (provider === 'gemini') return runGeminiTranslate(model, prompt)
    // Future: generic dispatch
    setNotice(`Provider ${provider} belum didukung untuk translate.`)
    setNoticeVariant('warning')
  }

  const openTranslatePrompt = () => {
    setTranslateMenuOpen(false)
    setTranslatePromptModal({ show: true, prompt: '' })
  }

  const runTranslateWithPrompt = async () => {
    const p = String(translatePromptModal.prompt || '').trim()
    setTranslatePromptModal({ show: false, prompt: p })
    if (!p) return runTranslate()
    return runTranslate({ prompt: p })
  }

  const openTranslateEditor = (source) => {
    const src = source === 'translated' ? 'translated' : 'cli'
    const initial = src === 'translated' ? translated : cliResult
    setTranslateEditModal({ show: true, value: String(initial || ''), source: src })
  }

  const applyTranslateEdit = () => {
    const v = String(translateEditModal.value || '')
    if (translateEditModal.source === 'translated') {
      setTranslated(v)
    } else {
      setCliResult(v)
    }
    setTranslateEditModal(prev => ({ ...prev, show: false }))
  }

  const saveEditedTranslation = async () => {
    if (!api || !text || !folder) return
    setTranslateEditSaving(true)
    setNotice('')
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const fileName = (file || '').split('\\').pop() || ''
      const edited = String(translateEditModal.value || '')
      const res = await api.saveTranslation({
        kitabName,
        folderPath: folder,
        fileName,
        originalText: text,
        translatedText: edited,
        sourceLabel: 'manual_edit',
        feedbackLabel: 'editor_update',
        actorName: reviewActor,
        sourceFlow: 'split_view'
      })
      if (res && res.ok) {
        setTranslated(edited)
        setTranslatedMeta({
          text_translate: edited,
          confidence_score: res.confidence_score,
          low_confidence: res.low_confidence,
          confidence_reasons: res.confidence_reasons || [],
          latest_version: res.version_id ? { id: res.version_id, version_number: res.version_number } : null
        })
        setNoticeVariant('success')
        setNotice(`Terjemahan berhasil disimpan (${res.action}).`)
        await refreshCurrentAssistContext()
        await refreshCurrentSourceUnitContext()
        setTimeout(() => setNotice(''), 2000)
        setTranslateEditModal(prev => ({ ...prev, show: false }))
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal menyimpan terjemahan.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal menyimpan terjemahan.')
    } finally {
      setTranslateEditSaving(false)
    }
  }

  const saveCliResult = async () => {
    if (!api || !text || !folder || !cliResult) return
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const fileName = (file || '').split('\\').pop() || ''
      const res = await api.saveTranslation({
        kitabName,
        folderPath: folder,
        fileName,
        originalText: text,
        translatedText: cliResult,
        sourceLabel: aiConfidence ? 'manual_ai_review' : 'manual',
        feedbackLabel: aiConfidence ? 'ai_result_accepted' : 'translation_saved',
        actorName: reviewActor,
        sourceFlow: 'split_view'
      })
      if (res && res.ok) {
        setTranslated(cliResult)
        setTranslatedMeta({
          text_translate: cliResult,
          confidence_score: res.confidence_score,
          low_confidence: res.low_confidence,
          confidence_reasons: res.confidence_reasons || [],
          latest_version: res.version_id ? { id: res.version_id, version_number: res.version_number } : null
        })
        setCliResult('')
        setAiConfidence(null)
        setNoticeVariant('success')
        setNotice(`Terjemahan berhasil disimpan (${res.action}).`)
        await refreshCurrentAssistContext()
        await refreshCurrentSourceUnitContext()
        setTimeout(() => setNotice(''), 2000)
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal menyimpan terjemahan.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal menyimpan terjemahan.')
    }
  }

  const chooseMatchingImage = (images, txtFile) => {
    if (!images || images.length === 0 || !txtFile) return ''
    const base = (txtFile.split('\\').pop() || '').replace(/\.[^.]+$/, '')
    const m = base.match(/(\d+)$/)
    const n = m ? parseInt(m[1], 10) : NaN
    if (!Number.isNaN(n)) {
      const byNum = images.find((p) => {
        const bn = (p.split('\\').pop() || '').replace(/\.[^.]+$/, '')
        const mm = bn.match(/(\d+)$/)
        const nn = mm ? parseInt(mm[1], 10) : NaN
        return !Number.isNaN(nn) && nn === n
      })
      if (byNum) return byNum
    }
    const byBase = images.find((p) => (p.split('\\').pop() || '').replace(/\.[^.]+$/, '') === base)
    return byBase || ''
  }

  const loadVersionHistory = async () => {
    if (!api || !api.listTranslationVersions || !api.listTranslationFeedbackHistory || !folder || !text) return
    setVersionHistoryModal({ show: true, loading: true })
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const [versionsRes, feedbackRes] = await Promise.all([
        api.listTranslationVersions({ kitabName, folderPath: folder, originalText: text }),
        api.listTranslationFeedbackHistory({ kitabName, folderPath: folder, originalText: text })
      ])
      const versions = versionsRes?.ok ? (versionsRes.data?.versions || []) : []
      const feedback = feedbackRes?.ok ? (feedbackRes.data?.items || []) : []
      setVersionHistory(versions)
      setFeedbackHistory(feedback)
      setCompareVersionIds({
        left: versions[0]?.id ? String(versions[0].id) : '',
        right: versions[1]?.id ? String(versions[1].id) : (versions[0]?.id ? String(versions[0].id) : '')
      })
    } catch (_) {
      setVersionHistory([])
      setFeedbackHistory([])
      setCompareVersionIds({ left: '', right: '' })
    } finally {
      setVersionHistoryModal({ show: true, loading: false })
    }
  }

  const submitReviewStatus = async (reviewStatus) => {
    if (!api || !api.submitTranslationReview || !folder || !text || !translatedMeta?.latest_version?.id) return
    setReviewSubmitting(true)
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const res = await api.submitTranslationReview({
        kitabName,
        folderPath: folder,
        originalText: text,
        versionId: translatedMeta.latest_version.id,
        reviewStatus,
        actorName: reviewActor,
        sourceFlow: 'split_view'
      })
      if (res && res.ok) {
        setNoticeVariant('success')
        setNotice(`Status review disimpan: ${reviewStatus}.`)
        setTimeout(() => setNotice(''), 2000)
        await loadVersionHistory()
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal menyimpan status review.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal menyimpan status review.')
    } finally {
      setReviewSubmitting(false)
    }
  }

  const loadAssistContext = async (sourceText) => {
    if (!api || !api.getTranslationAssistContext || !folder) {
      setAssistContext(null)
      return
    }
    const originalText = String(sourceText || '').trim()
    if (!originalText) {
      setAssistContext(null)
      return
    }
    setAssistLoading(true)
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const res = await api.getTranslationAssistContext({
        kitabName,
        folderPath: folder,
        fileName: (file || '').split('\\').pop() || '',
        originalText,
        sourceLang: 'ar',
        targetLang: 'id'
      })
      if (res && res.ok) setAssistContext(res.data || null)
      else setAssistContext(null)
    } catch (_) {
      setAssistContext(null)
    } finally {
      setAssistLoading(false)
    }
  }

  const refreshCurrentAssistContext = async () => loadAssistContext(text)

  const loadSourceUnitContext = async (sourceText) => {
    if (!api || !api.getSourceUnitContext || !folder) {
      setSourceUnitContext(null)
      return
    }
    const originalText = String(sourceText || '').trim()
    const fileName = (file || '').split('\\').pop() || ''
    if (!originalText && !fileName) {
      setSourceUnitContext(null)
      return
    }
    setSourceUnitLoading(true)
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const pageNumber = (fileName.match(/\d+/) || [])[0] || ''
      const res = await api.getSourceUnitContext({
        kitabName,
        folderPath: folder,
        fileName,
        filePath: file,
        originalText,
        pageNumber,
        preferredUnitType: 'segment'
      })
      if (res && res.ok) setSourceUnitContext(res.data || null)
      else setSourceUnitContext(null)
    } catch (_) {
      setSourceUnitContext(null)
    } finally {
      setSourceUnitLoading(false)
    }
  }

  const syncSourceUnits = async () => {
    if (!api || !api.importSourceUnits || !folder) return
    setSourceUnitSyncing(true)
    try {
      const kitabName = (folder || '').split('\\').filter(Boolean).pop() || 'default'
      const res = await api.importSourceUnits({ kitabName, folderPath: folder, unitType: 'segment' })
      if (res && res.ok && res.data?.ok) {
        setNoticeVariant('success')
        setNotice(`Source units tersinkron. ${res.data.imported || 0}/${res.data.total || 0} file diproses.`)
        await loadSourceUnitContext(text)
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || res?.data?.reason || 'Gagal import source units.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal import source units.')
    } finally {
      setSourceUnitSyncing(false)
    }
  }

  const refreshCurrentSourceUnitContext = async () => loadSourceUnitContext(text)

  const toFileUrl = (p) => {
    if (!p) return ''
    const fwd = p.replace(/\\/g, '/')
    if (/^file:/i.test(fwd)) return fwd
    return 'file:///' + encodeURI(fwd)
  }

  const curIndex = filesList.findIndex(p => p === file)
  const canPrev = curIndex > 0
  const canNext = curIndex >= 0 && curIndex < filesList.length - 1
  const goPrev = () => {
    if (!canPrev) return
    const nextFile = filesList[curIndex - 1]
    if (nextFile) setFile(nextFile)
  }
  const goNext = () => {
    if (!canNext) return
    const nextFile = filesList[curIndex + 1]
    if (nextFile) setFile(nextFile)
  }

  const copyImage = async () => {
    if (!api || !imageUrl) return
    const res = await api.copyImageToClipboard(imageUrl)
    if (res && res.ok) {
      setNoticeVariant('success')
      setNotice('Gambar berhasil disalin ke clipboard.')
      setTimeout(() => setNotice(''), 2000)
    } else {
      setNoticeVariant('danger')
      setNotice(res?.error || 'Gagal menyalin gambar.')
    }
  }

  const reOcr = async (engineOverride) => {
    if (!api || !image || !file) return
    setNotice('')
    setOcrRunning(true)
    try {
      const engine = (typeof engineOverride === 'string' && engineOverride) ? engineOverride : ocrEngine
      const layoutPayload = {
        layoutMode: ocrLayoutMode,
        boxPaddingPct: ocrBoxPaddingPct,
        notePaddingPct: ocrNotePaddingPct,
        outsideFormat: ocrLayoutMode === 'box_notes' ? 'flat' : ocrOutsideFormat
      }
      const res = engine === 'openai'
        ? await api.runOcrOpenAi({ imagePath: image, txtPath: file, model: openAiModel, ...layoutPayload })
        : await api.runOcrFile({ imagePath: image, txtPath: file, engine, ...layoutPayload })
      if (res && res.ok) {
        setText(res.text || '')
        await loadAssistContext(res.text || '')
        await loadSourceUnitContext(res.text || '')
        setNoticeVariant('success')
        if (ocrLayoutMode === 'box_notes' && res.fallbackReason === 'engine-does-not-support-box-notes') {
          setNotice('Re-OCR selesai. Engine ini saat ini berjalan full page; mode box layout belum didukung.')
        } else if (ocrLayoutMode === 'box_notes' && !res.layoutDetected) {
          setNotice(`Re-OCR selesai, tapi box utama tidak terdeteksi. Fallback ke full page OCR. ${res.fallbackReason ? `(${res.fallbackReason})` : ''}`.trim())
        } else if (ocrLayoutMode === 'box_notes' && Array.isArray(res.outsideZones) && res.outsideZones.length === 0) {
          setNotice('Re-OCR selesai. Box utama terdeteksi, tapi belum ada teks outside box yang berhasil diekstrak.')
        } else if (ocrLayoutMode === 'box_notes' && Array.isArray(res.outsideZones)) {
          setNotice(`Re-OCR berhasil. Outside box terambil dari zona: ${res.outsideZones.join(', ')}.`)
        } else {
          setNotice('Re-OCR berhasil.')
        }
        setTimeout(() => setNotice(''), 4000)
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal Re-OCR.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e.message || 'Gagal Re-OCR.')
    } finally {
      setOcrRunning(false)
    }
  }

  const handleEngineChange = async (e) => {
    const val = e.target.value
    setOcrEngine(val)
    if (api) {
      await api.saveSettings({ ocrEngine: val })
    }
  }

  const handleLayoutModeChange = async (e) => {
    const val = e.target.value
    setOcrLayoutMode(val)
    if (api) {
      await api.saveSettings({ ocrLayoutMode: val })
    }
  }

  const handleTranslateAiChange = async (e) => {
    const raw = e.target.value
    if (translateProviders.length > 0) {
      const id = Number(raw)
      const picked = translateProviders.find(p => Number(p.id) === id)
      if (!picked) return
      setTranslateProviderId(picked.id)
      setTranslateAi(picked.provider)
      if (api) {
        await api.saveSettings({ translateAi: picked.provider, translateProviderId: picked.id })
      }
      return
    }
    const val = String(raw || '').trim()
    setTranslateProviderId(null)
    setTranslateAi(val)
    if (api) {
      await api.saveSettings({ translateAi: val, translateProviderId: null })
    }
  }

  const handleOpenAiModelChange = async (e) => {
    const val = e.target.value
    setOpenAiModel(val)
    if (api) {
      await api.saveSettings({ openAiModel: val })
    }
  }

  const handleGeminiModelChange = async (e) => {
    const val = e.target.value
    setGeminiModel(val)
    if (api) {
      await api.saveSettings({ geminiModel: val })
    }
  }

  const playVoiceBeep = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const ctx = new AudioContext()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = 880
      g.gain.value = 0.08
      o.connect(g)
      g.connect(ctx.destination)
      o.start()
      setTimeout(() => {
        try { o.stop() } catch (_) {}
        try { ctx.close() } catch (_) {}
      }, 140)
    } catch (_) {}
  }

  const playOpenAiTts = async (textToSay) => {
    const t = String(textToSay || '').trim()
    if (!t) return false
    if (!api || !api.ttsOpenAi) return false

    try {
      const cache = voiceTtsCacheRef.current
      const cached = cache && cache.get ? cache.get(t) : null
      const audioData = cached || (await (async () => {
        const r = await api.ttsOpenAi({ text: t })
        if (r && r.ok && r.audioData) {
          cache && cache.set && cache.set(t, r.audioData)
          return r.audioData
        }
        return ''
      })())

      if (!audioData) return false

      if (voicePromptAudioRef.current) {
        try { voicePromptAudioRef.current.pause() } catch (_) {}
        voicePromptAudioRef.current = null
      }

      await new Promise((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          resolve()
        }
        const a = new Audio(audioData)
        voicePromptAudioRef.current = a
        a.onended = finish
        a.onerror = finish
        try { a.play() } catch (_) { finish(); return }
        setTimeout(finish, 4000)
      })
      return true
    } catch (_) {
      return false
    }
  }

  const playVoicePrompt = async () => {
    try {
      const ok = await playOpenAiTts('hai butuh bantuan apa')
      if (ok) return
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return
      const u = new SpeechSynthesisUtterance('hai butuh bantuan apa')
      u.lang = 'id-ID'
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : []
      const idVoice = voices.find(v => String(v.lang || '').toLowerCase().startsWith('id'))
      if (idVoice) u.voice = idVoice
      await new Promise((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          resolve()
        }
        u.onend = finish
        u.onerror = finish
        try { window.speechSynthesis.cancel() } catch (_) {}
        try { window.speechSynthesis.speak(u) } catch (_) { finish(); return }
        setTimeout(finish, 2500)
      })
    } catch (_) {}
  }

  const processVoiceCommand = async (spokenRaw) => {
    const spoken = String(spokenRaw || '').trim()
    if (!spoken) return
    setVoiceText(spoken)

    const norm = spoken
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!norm) return

    if (/\b(stop|berhenti|batal)\b/.test(norm)) {
      stopVoice()
      return
    }

    const wantsTranslate = /\b(translate|terjemah|terjemahkan)\b/.test(norm)
    const wantsOcr = /\b(ocr|reocr|re-ocr)\b/.test(norm) || /\b(ocr ulang|ulang ocr)\b/.test(norm)

    if (wantsOcr) {
      let engine = null
      if (/\b(tesseract)\b/.test(norm)) engine = 'tesseract'
      else if (/\b(easyocr)\b/.test(norm) || /\b(easy ocr)\b/.test(norm)) engine = 'easyocr'
      else if (/\b(arabic)\b/.test(norm) || /\b(arab)\b/.test(norm)) engine = 'arabic_dl'
      else if (/\b(kraken)\b/.test(norm)) engine = 'kraken_arabic'
      else if (/\b(unlimited)\b/.test(norm) || /\b(unlimited ocr)\b/.test(norm)) engine = 'unlimited_ocr'

      const chosenEngine = engine || ocrEngine
      if (engine && engine !== ocrEngine) {
        setOcrEngine(engine)
        api && api.saveSettings && api.saveSettings({ ocrEngine: engine }).catch(() => {})
      }
      stopVoice()
      if (ocrRunning || !imageUrl) {
        setNoticeVariant('warning')
        setNotice('Tidak bisa Re-OCR sekarang.')
        return
      }
      await reOcr(chosenEngine)
      return
    }

    if (wantsTranslate) {
      let provider = null
      if (/\b(openai|gpt)\b/.test(norm)) provider = 'openai'
      else if (/\b(gemini)\b/.test(norm) || /\b(google)\b/.test(norm)) provider = 'gemini'

      const chosenProvider = provider || translateAi
      if (provider && provider !== translateAi) {
        setTranslateAi(provider)
        if (translateProviders.length > 0) {
          const picked = translateProviders.find(p => p.provider === provider)
          if (picked) {
            setTranslateProviderId(picked.id)
            api && api.saveSettings && api.saveSettings({ translateAi: provider, translateProviderId: picked.id }).catch(() => {})
          } else {
            api && api.saveSettings && api.saveSettings({ translateAi: provider, translateProviderId: null }).catch(() => {})
          }
        } else {
          api && api.saveSettings && api.saveSettings({ translateAi: provider, translateProviderId: null }).catch(() => {})
        }
      }
      stopVoice()
      if (cliRunning || !text) {
        setNoticeVariant('warning')
        setNotice('Tidak bisa Translate sekarang.')
        return
      }
      await runTranslate({ provider: chosenProvider })
    }
  }

  const handleReadingTestTranscript = (spokenRaw) => {
    const spoken = String(spokenRaw || '').trim()
    if (!spoken) {
      setReadingTestStatus('error')
      setReadingTestError('Tidak ada transcript yang bisa dibandingkan.')
      return
    }
    const targetText = readingTargetText || text || ''
    setVoiceText(spoken)
    setReadingTranscript(spoken)
    setReadingComparison(compareReadingTranscript(targetText, spoken))
    setReadingTestStatus('done')
    setReadingTestError('')
  }

  const routeVoiceTranscript = async (spokenRaw) => {
    if (voicePurposeRef.current === 'reading-test') {
      handleReadingTestTranscript(spokenRaw)
      return
    }
    await processVoiceCommand(spokenRaw)
  }

  const markReadingTestError = (message) => {
    if (voicePurposeRef.current !== 'reading-test') return
    setReadingTestStatus('error')
    setReadingTestError(message || 'Uji baca gagal diproses.')
  }

  const stopVoice = () => {
    voiceStopRequestedRef.current = true
    voiceModeRef.current = 'idle'
    if (voicePurposeRef.current === 'reading-test') {
      setReadingTestStatus((prev) => (prev === 'listening' ? 'idle' : prev))
    }
    try {
      if (voicePromptAudioRef.current) {
        voicePromptAudioRef.current.pause()
        voicePromptAudioRef.current = null
      }
    } catch (_) {}
    try {
      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current)
      voiceSilenceTimerRef.current = null
      recognitionRef.current?.stop?.()
    } catch (_) {}
    try {
      if (voiceLevelTimerRef.current) clearInterval(voiceLevelTimerRef.current)
    } catch (_) {}
    voiceLevelTimerRef.current = null
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch (_) {}
    mediaRecorderRef.current = null
    mediaChunksRef.current = []
    try {
      voiceAudioCtxRef.current?.close?.()
    } catch (_) {}
    voiceAudioCtxRef.current = null
    voiceAnalyserRef.current = null
    try {
      if (micStreamRef.current) {
        for (const t of micStreamRef.current.getTracks()) t.stop()
      }
    } catch (_) {}
    micStreamRef.current = null
    setVoiceListening(false)
  }

  const startGeminiStt = async () => {
    voiceModeRef.current = 'gemini'
    if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current)
    voiceSilenceTimerRef.current = null
    if (!api || !api.sttGemini) {
      setNoticeVariant('danger')
      setNotice('STT Gemini tidak tersedia.')
      markReadingTestError('STT Gemini tidak tersedia.')
      stopVoice()
      return
    }
    if (!micStreamRef.current) {
      setNoticeVariant('danger')
      setNotice('Microphone tidak siap.')
      markReadingTestError('Microphone tidak siap.')
      stopVoice()
      return
    }

    const mr = (() => {
      const stream = micStreamRef.current
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          return new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        }
      } catch (_) {}
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) {
          return new MediaRecorder(stream, { mimeType: 'audio/webm' })
        }
      } catch (_) {}
      return new MediaRecorder(stream)
    })()

    mediaRecorderRef.current = mr
    mediaChunksRef.current = []

    mr.ondataavailable = (e) => {
      if (e && e.data && e.data.size > 0) mediaChunksRef.current.push(e.data)
    }
    mr.onerror = () => {
      setNoticeVariant('danger')
      setNotice('Gagal merekam audio untuk STT.')
      markReadingTestError('Gagal merekam audio untuk STT.')
      stopVoice()
    }
    mr.onstop = async () => {
      if (voiceStopRequestedRef.current) return
      try {
        const blob = new Blob(mediaChunksRef.current, { type: mr.mimeType || 'audio/webm' })
        mediaChunksRef.current = []
        if (!blob || blob.size === 0) {
          setNoticeVariant('warning')
          setNotice('Tidak ada audio terekam.')
          markReadingTestError('Tidak ada audio yang berhasil direkam.')
          stopVoice()
          return
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result)
          fr.onerror = () => reject(new Error('FileReader error'))
          fr.readAsDataURL(blob)
        })
        const base64 = String(dataUrl || '').split(',')[1] || ''
        if (!base64) {
          setNoticeVariant('danger')
          setNotice('Gagal memproses audio.')
          markReadingTestError('Gagal memproses audio rekaman.')
          stopVoice()
          return
        }

        const r = await api.sttGemini({ audioData: base64, mimeType: blob.type || 'audio/webm' })
        if (r && r.ok && r.text) {
          await routeVoiceTranscript(r.text)
        } else {
          setNoticeVariant('danger')
          setNotice(r?.error || 'STT gagal.')
          markReadingTestError(r?.error || 'STT gagal.')
          playOpenAiTts('stt failed').catch(() => {})
          stopVoice()
        }
      } catch (e) {
        setNoticeVariant('danger')
        setNotice(e?.message || 'STT error.')
        markReadingTestError(e?.message || 'STT error.')
        playOpenAiTts('stt failed').catch(() => {})
        stopVoice()
      }
      stopVoice()
    }

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (AudioContext) {
        const ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(micStreamRef.current)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        src.connect(analyser)
        voiceAudioCtxRef.current = ctx
        voiceAnalyserRef.current = analyser
      }
    } catch (_) {}

    let silenceMs = 0
    let startedAt = Date.now()
    voiceLevelTimerRef.current = setInterval(() => {
      try {
        const analyser = voiceAnalyserRef.current
        if (!analyser) return
        const data = new Uint8Array(analyser.fftSize)
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        const silent = rms < 0.02
        if (silent) silenceMs += 200
        else silenceMs = 0
        if (Date.now() - startedAt > 800 && silenceMs >= 3000) {
          try { mr.stop() } catch (_) {}
        }
      } catch (_) {}
    }, 200)

    try {
      mr.start(250)
    } catch (_) {
      setNoticeVariant('danger')
      setNotice('MediaRecorder gagal start.')
      markReadingTestError('MediaRecorder gagal start.')
      stopVoice()
    }
  }

  const startVoice = async ({ purpose = 'command', speechLang = 'id-ID', withPrompt = true } = {}) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    voicePurposeRef.current = purpose
    setVoicePurpose(purpose)
    voiceStopRequestedRef.current = false

    setVoiceText('')
    if (purpose === 'reading-test') {
      setReadingTestStatus('listening')
      setReadingTestError('')
    }
    setVoiceListening(true)
    if (withPrompt) await playVoicePrompt()

    if (!micStreamRef.current && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e) {
        setNoticeVariant('danger')
        setNotice(e?.message || 'Izin microphone ditolak / tidak tersedia.')
        markReadingTestError(e?.message || 'Izin microphone ditolak / tidak tersedia.')
        stopVoice()
        return
      }
    }

    if (!SpeechRecognition) {
      voiceModeRef.current = 'gemini'
      await startGeminiStt()
      return
    }
    voiceModeRef.current = 'speech'

    try {
      recognitionRef.current?.stop?.()
    } catch (_) {}

    const rec = new SpeechRecognition()
    recognitionRef.current = rec
    rec.lang = speechLang
    rec.interimResults = true
    rec.continuous = true

    const resetSilenceTimer = () => {
      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current)
      voiceSilenceTimerRef.current = setTimeout(() => {
        stopVoice()
      }, 3000)
    }

    rec.onstart = () => {
      resetSilenceTimer()
    }
    rec.onerror = (e) => {
      const err = e && e.error ? String(e.error) : 'unknown'
      if (err !== 'aborted' && err !== 'network') {
        setNoticeVariant(err === 'not-allowed' || err === 'service-not-allowed' ? 'danger' : 'warning')
        setNotice(`Voice error: ${err}`)
        markReadingTestError(`Voice error: ${err}`)
      }
      if (err === 'network') {
        voiceModeRef.current = 'gemini'
        try {
          rec.stop()
        } catch (_) {}
        startGeminiStt()
        return
      }
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        if (err === 'audio-capture') markReadingTestError('Perangkat microphone tidak tersedia.')
        stopVoice()
      }
    }
    rec.onend = () => {
      if (voiceModeRef.current !== 'speech') return
      if (voiceStopRequestedRef.current) return
      try {
        rec.start()
      } catch (_) {
        setVoiceListening(false)
      }
    }
    rec.onresult = async (event) => {
      if (voiceStopRequestedRef.current) return
      resetSilenceTimer()
      let interim = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const t = (res && res[0] && res[0].transcript) ? String(res[0].transcript) : ''
        if (res.isFinal) finalText += t
        else interim += t
      }
      const spoken = (finalText || interim || '').trim()
      if (!spoken) return
      if (!finalText) return
      await routeVoiceTranscript(finalText)
    }

    try {
      rec.start()
    } catch (_) {
      stopVoice()
    }
  }

  const startReadingTest = async () => {
    const targetText = String(readingTargetText || text || '').trim()
    if (!targetText) {
      setReadingTestStatus('error')
      setReadingTestError('Teks target belum tersedia untuk uji baca.')
      return
    }
    setReadingTranscript('')
    setReadingComparison(null)
    setReadingTestError('')
    await startVoice({ purpose: 'reading-test', speechLang: 'ar-SA', withPrompt: false })
  }

  const resetReadingTest = () => {
    if (voiceListening && voicePurposeRef.current === 'reading-test') stopVoice()
    setReadingTranscript('')
    setReadingComparison(null)
    setReadingTestStatus('idle')
    setReadingTestError('')
  }

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop?.() } catch (_) {}
      try {
        if (micStreamRef.current) {
          for (const t of micStreamRef.current.getTracks()) t.stop()
        }
      } catch (_) {}
      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current)
    }
  }, [])

  const handleContextMenu = (e) => {
    e.preventDefault()
    const selection = window.getSelection().toString().trim()
    if (!selection) return
    setCtxMenu({ show: true, x: e.pageX, y: e.pageY, text: selection })
    setShowSubMenu(false) // Reset submenu on new right click
  }

  const runWordAnalysis = async (textToTranslate, providerToUse) => {
    setWordModal(prev => ({ ...prev, loading: true, translation: '' }))
    try {
      const res = await api.translateWordAnalysis({ text: textToTranslate, provider: providerToUse })
      if (res && res.ok) {
        setWordModal(prev => ({ ...prev, translation: res.output, loading: false }))
      } else {
        setWordModal(prev => ({ ...prev, translation: 'Error: ' + (res?.error || 'Unknown error'), loading: false }))
      }
    } catch (e) {
      setWordModal(prev => ({ ...prev, translation: 'Error: ' + e.message, loading: false }))
    }
  }

  const handleTranslateSelection = (provider) => {
    setCtxMenu({ ...ctxMenu, show: false })
    setShowSubMenu(false)
    const prov = provider || translateAi || 'gemini'
    setWordModal({ show: true, text: ctxMenu.text, translation: '', loading: true, provider: prov })
    runWordAnalysis(ctxMenu.text, prov)
  }

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.speechSynthesis.cancel()
    setAudioPaused(false)
    setTextAudioMode('')
    setTextAudioTimeline([])
    setActiveTextAudioChunkIndex(-1)
    setSystemTtsRange(null)
    setAudioPlaying(false)
  }

  const buildEstimatedAudioTimeline = (manifest, durationSec) => {
    const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : []
    const duration = Number(durationSec)
    if (!chunks.length || !Number.isFinite(duration) || duration <= 0) return []
    const totalChars = chunks.reduce((sum, chunk) => sum + Math.max(1, Number(chunk?.charCount || 0)), 0)
    let cursorSec = 0
    return chunks.map((chunk, index) => {
      const weight = Math.max(1, Number(chunk?.charCount || 0)) / Math.max(1, totalChars)
      const endSec = index === chunks.length - 1 ? duration : (cursorSec + (duration * weight))
      const next = {
        ...chunk,
        startSec: cursorSec,
        endSec
      }
      cursorSec = endSec
      return next
    })
  }

  const getSpeechBoundaryRange = (sourceText, charIndex, charLength) => {
    const raw = String(sourceText || '')
    const start = Math.max(0, Math.min(raw.length, Number(charIndex || 0)))
    if (!raw) return null
    let end = start + Math.max(0, Number(charLength || 0))
    if (end <= start) {
      end = start
      while (end < raw.length && !/\s/.test(raw[end])) end += 1
      if (end === start) end = Math.min(raw.length, start + 1)
    }
    return { start, end }
  }

  const playAudioFromUrl = (url, options = {}) => {
    const source = String(url || '').trim()
    if (!source) return false
    stopAudio()
    try {
      setAudioPlaying(true)
      setAudioPaused(false)
      setTextAudioMode(options.mode || 'saved')
      const a = new Audio(source)
      a.onplay = () => {
        setAudioPaused(false)
      }
      a.onpause = () => {
        if (audioRef.current === a && !a.ended) setAudioPaused(true)
      }
      a.onloadedmetadata = () => {
        const timeline = buildEstimatedAudioTimeline(options.manifest, a.duration)
        setTextAudioTimeline(timeline)
        setActiveTextAudioChunkIndex(timeline.length > 0 ? 0 : -1)
      }
      a.ontimeupdate = () => {
        const timeline = buildEstimatedAudioTimeline(options.manifest, a.duration)
        if (!timeline.length) return
        setTextAudioTimeline(timeline)
        const currentSec = Number(a.currentTime || 0)
        const activeIndex = timeline.findIndex((item) => currentSec >= item.startSec && currentSec < item.endSec)
        setActiveTextAudioChunkIndex(activeIndex >= 0 ? activeIndex : (timeline.length - 1))
      }
      a.onended = () => {
        if (audioRef.current === a) audioRef.current = null
        setAudioPaused(false)
        setTextAudioMode('')
        setTextAudioTimeline([])
        setActiveTextAudioChunkIndex(-1)
        setAudioPlaying(false)
      }
      a.onerror = () => {
        if (audioRef.current === a) audioRef.current = null
        setAudioPaused(false)
        setTextAudioMode('')
        setTextAudioTimeline([])
        setActiveTextAudioChunkIndex(-1)
        setAudioPlaying(false)
        setNoticeVariant('danger')
        setNotice('Gagal memutar audio tersimpan.')
      }
      audioRef.current = a
      a.play().catch(() => {
        if (audioRef.current === a) audioRef.current = null
        setAudioPlaying(false)
        setNoticeVariant('danger')
        setNotice('Browser gagal memutar audio.')
      })
      return true
    } catch (_) {
      setAudioPlaying(false)
      return false
    }
  }

  const playSystemTextAudio = () => {
    if (!text) return
    stopAudio()
    setAudioPlaying(true)
    setAudioPaused(false)
    setTextAudioMode('system')
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ar-SA'
    const voices = window.speechSynthesis?.getVoices ? window.speechSynthesis.getVoices() : []
    const arVoice = voices.find(v => String(v.lang || '').toLowerCase().startsWith('ar'))
    if (arVoice) u.voice = arVoice
    u.onboundary = (event) => {
      const range = getSpeechBoundaryRange(text, event?.charIndex, event?.charLength)
      setSystemTtsRange(range)
    }
    u.onend = () => {
      setAudioPaused(false)
      setTextAudioMode('')
      setSystemTtsRange(null)
      setAudioPlaying(false)
    }
    u.onerror = () => {
      setAudioPaused(false)
      setTextAudioMode('')
      setSystemTtsRange(null)
      setAudioPlaying(false)
      setNoticeVariant('danger')
      setNotice('Gagal menjalankan System TTS.')
    }
    try {
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch (_) {
      setTextAudioMode('')
      setSystemTtsRange(null)
      setAudioPaused(false)
      setAudioPlaying(false)
    }
  }

  const pauseAudio = () => {
    if (!audioRef.current) return
    try {
      audioRef.current.pause()
      setAudioPaused(true)
    } catch (_) {}
  }

  const resumeAudio = () => {
    if (!audioRef.current) return
    try {
      audioRef.current.play().then(() => {
        setAudioPaused(false)
      }).catch(() => {
        setNoticeVariant('danger')
        setNotice('Gagal melanjutkan audio.')
      })
    } catch (_) {}
  }

  const generateSavedTextAudio = async (provider = 'openai') => {
    if (!text) return
    if (provider === 'system') {
      setTextAudioProvider('system')
      playSystemTextAudio()
      return
    }
    if (!api || !api.ttsOpenAi || !folder || !file) return
    setTextAudioProvider(provider)
    setTextAudioGenerating(true)
    setNotice('')
    try {
      const res = await api.ttsOpenAi({
        text,
        folderPath: folder,
        filePath: file,
        saveToFile: true
      })
      if (res && res.ok && res.audioUrl) {
        setSavedTextAudioUrl(res.audioUrl || '')
        setSavedTextAudioPath(res.audioPath || '')
        setSavedTextAudioManifest(res.manifest || null)
        setNoticeVariant('success')
        setNotice(`Audio bacaan tersimpan di folder kitab: ${res.audioPath || 'audio'}`)
        setTimeout(() => setNotice(''), 4000)
        playAudioFromUrl(res.audioUrl, { mode: 'saved-openai', manifest: res.manifest || null })
      } else {
        setNoticeVariant('danger')
        setNotice(res?.error || 'Gagal membuat audio bacaan.')
      }
    } catch (e) {
      setNoticeVariant('danger')
      setNotice(e?.message || 'Gagal membuat audio bacaan.')
    } finally {
      setTextAudioGenerating(false)
    }
  }

  const playSavedTextAudio = () => {
    if (!savedTextAudioUrl) {
      setNoticeVariant('warning')
      setNotice('Audio bacaan belum tersedia. Klik Baca untuk membuat audio.')
      return
    }
    const ok = playAudioFromUrl(savedTextAudioUrl, { mode: 'saved-openai', manifest: savedTextAudioManifest })
    if (!ok) {
      setNoticeVariant('danger')
      setNotice('Gagal memutar audio tersimpan.')
    }
  }

  const renderHighlightedText = (sourceText, emptyLabel = 'Tidak ada teks untuk ditampilkan.') => {
    const raw = String(sourceText || '')
    if (!raw) return <span className="text-muted">{emptyLabel}</span>

    let activeRange = null
    if (textAudioMode === 'system' && systemTtsRange && text) {
      activeRange = systemTtsRange
    } else if ((textAudioMode === 'saved-openai' || textAudioMode === 'saved') && activeTextAudioChunkIndex >= 0 && textAudioTimeline.length > 0) {
      const chunk = textAudioTimeline[activeTextAudioChunkIndex]
      if (chunk) activeRange = { start: chunk.startChar, end: chunk.endChar }
    }

    if (!activeRange || activeRange.end <= activeRange.start) return raw
    const start = Math.max(0, Math.min(raw.length, activeRange.start))
    const end = Math.max(start, Math.min(raw.length, activeRange.end))
    const before = raw.slice(0, start)
    const active = raw.slice(start, end)
    const after = raw.slice(end)
    return (
      <React.Fragment>
        {before}
        <span style={{ backgroundColor: 'rgba(255, 193, 7, 0.28)', borderRadius: '0.35rem', boxShadow: 'inset 0 -1px 0 rgba(255, 193, 7, 0.45)' }}>
          {active}
        </span>
        {after}
      </React.Fragment>
    )
  }

  const renderTextAudioActions = () => (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <div style={{ position: 'relative' }}>
        <div className="btn-group btn-group-sm">
          <Button
            variant="link"
            size="sm"
            className="p-0 text-decoration-none"
            disabled={!text || textAudioGenerating}
            onClick={() => generateSavedTextAudio(textAudioProvider)}
          >
            <i className="bi bi-volume-up me-1" />
            {textAudioGenerating ? 'Membuat audio...' : 'Baca'}
          </Button>
          <Button
            variant="link"
            size="sm"
            className="p-0 text-decoration-none dropdown-toggle dropdown-toggle-split"
            disabled={!text || textAudioGenerating}
            onClick={() => setTextAudioProviderMenuOpen(v => !v)}
          >
            <span className="visually-hidden">Toggle TTS Provider</span>
          </Button>
        </div>
        {textAudioProviderMenuOpen && (
          <div
            className="dropdown-menu show"
            style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="dropdown-item"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setTextAudioProvider('openai')
                setTextAudioProviderMenuOpen(false)
                generateSavedTextAudio('openai')
              }}
            >
              <i className="bi bi-soundwave me-2 text-primary" /> OpenAI TTS + Simpan MP3
            </div>
            <div
              className="dropdown-item"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setTextAudioProvider('system')
                setTextAudioProviderMenuOpen(false)
                generateSavedTextAudio('system')
              }}
            >
              <i className="bi bi-speaker me-2 text-primary" /> System / Browser TTS
            </div>
          </div>
        )}
      </div>
      <Button
        variant="link"
        size="sm"
        className="p-0 text-decoration-none"
        disabled={!savedTextAudioUrl}
        onClick={playSavedTextAudio}
      >
        <i className="bi bi-play-circle me-1" /> Putar
      </Button>
      {savedTextAudioPath ? <span className="text-muted small">MP3 siap</span> : null}
    </div>
  )

  const handleTts = async (provider) => {
    setCtxMenu({ ...ctxMenu, show: false })
    stopAudio()
    
    if (!ctxMenu.text) return
    
    if (provider === 'system') {
      setAudioPlaying(true)
      const u = new SpeechSynthesisUtterance(ctxMenu.text)
      u.lang = 'ar-SA' 
      u.onend = () => setAudioPlaying(false)
      u.onerror = () => setAudioPlaying(false)
      window.speechSynthesis.speak(u)
      return
    }

    if (provider === 'openai') {
       setAudioPlaying(true)
       try {
         const res = await api.ttsOpenAi({ text: ctxMenu.text })
         if (res && res.ok && res.audioData) {
           const a = new Audio(res.audioData)
           a.onended = () => setAudioPlaying(false)
           a.onerror = () => setAudioPlaying(false)
           audioRef.current = a
           a.play()
         } else {
           setNotice(res?.error || 'TTS Error')
           setNoticeVariant('danger')
           setAudioPlaying(false)
         }
       } catch (e) {
         setNotice(e.message)
         setNoticeVariant('danger')
         setAudioPlaying(false)
       }
    }
  }

  const handleWordProviderChange = (e) => {
    const newProv = e.target.value
    setWordModal(prev => ({ ...prev, provider: newProv }))
    runWordAnalysis(wordModal.text, newProv)
  }

  useEffect(() => {
    const closeMenu = () => {
      setCtxMenu(prev => ({ ...prev, show: false }))
      setTranslateMenuOpen(false)
      setTextAudioProviderMenuOpen(false)
    }
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  const exactHit = assistContext?.tmHits?.exact || null
  const similarHits = Array.isArray(assistContext?.tmHits?.similar) ? assistContext.tmHits.similar : []
  const substringHits = Array.isArray(assistContext?.tmHits?.substring) ? assistContext.tmHits.substring : []
  const glossaryHits = Array.isArray(assistContext?.glossaryHits) ? assistContext.glossaryHits : []
  const semanticContext = cliContext?.semantic || null
  const promptTrace = cliContext?.promptTrace || null
  const semanticTmHits = Array.isArray(semanticContext?.tmHits) ? semanticContext.tmHits : []
  const semanticSourceUnitHits = Array.isArray(semanticContext?.sourceUnitHits) ? semanticContext.sourceUnitHits : []
  const sourceCurrent = sourceUnitContext?.current || null
  const sourcePrev = sourceUnitContext?.prev || null
  const sourceNext = sourceUnitContext?.next || null
  const sourcePageSegments = Array.isArray(sourceUnitContext?.current_page_segments) ? sourceUnitContext.current_page_segments : []
  const compareLeft = versionHistory.find(item => String(item.id) === String(compareVersionIds.left)) || null
  const compareRight = versionHistory.find(item => String(item.id) === String(compareVersionIds.right)) || null
  const visibleOcrPanels = ['image', 'ocrText', 'translation'].filter((key) => sectionVisibility[key])

  const toggleSectionVisibility = (key) => {
    setSectionVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSourceUnitCard = (label, item) => (
    <div className="border rounded-2 p-2">
      <div className="fw-semibold mb-1">{label}</div>
      {item ? (
        <>
          <div className="text-muted small mb-1">
            Type: {item.unit_type || '-'} | Page: {item.page_number ?? '-'} | Segment: {item.segment_order ?? '-'} | File: {item.file_name || '-'}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {String(item.source_text || '').trim() ? item.source_text : '-'}
          </div>
        </>
      ) : (
        <div className="text-muted small">Belum ada context untuk bagian ini.</div>
      )}
    </div>
  )

  return (
    <>
      {notice && <Alert variant={noticeVariant} className="mb-3">{notice}</Alert>}
      {translatedMeta?.low_confidence ? (
        <Alert variant="warning" className="mb-3">
          Low confidence pada terjemahan tersimpan.
          {translatedMeta?.latest_version?.version_number ? ` Versi saat ini: ${translatedMeta.latest_version.version_number}.` : ''}
          {Array.isArray(translatedMeta?.confidence_reasons) && translatedMeta.confidence_reasons.length > 0
            ? ` Alasan: ${translatedMeta.confidence_reasons.join(', ')}.`
            : ''}
        </Alert>
      ) : null}
      {aiConfidence?.low_confidence && cliResult ? (
        <Alert variant="warning" className="mb-3">
          Hasil AI terdeteksi low confidence.
          {Array.isArray(aiConfidence?.confidence_reasons) && aiConfidence.confidence_reasons.length > 0
            ? ` Alasan: ${aiConfidence.confidence_reasons.join(', ')}.`
            : ''}
        </Alert>
      ) : null}
      {(kitabInfo?.nama_kitab || folder) && (
        <div className="mb-3 border-bottom pb-2 d-flex justify-content-between align-items-end">
          <div>
            <h5 className="mb-0">{kitabInfo?.nama_kitab || (folder || '').split('\\').filter(Boolean).pop()}</h5>
            {kitabInfo?.pengarang && <small className="text-muted">{kitabInfo.pengarang}</small>}
          </div>
          <div className="btn-group">
            <Button variant={viewMode === 'reader' ? 'primary' : 'outline-secondary'} size="sm" onClick={() => setViewMode('reader')}>
              <i className="bi bi-book me-1" /> Reader
            </Button>
            <Button variant={viewMode === 'study' ? 'primary' : 'outline-secondary'} size="sm" onClick={() => setViewMode('study')}>
              <i className="bi bi-book-half me-1" /> Study
            </Button>
            <Button variant={viewMode === 'ocr' ? 'primary' : 'outline-secondary'} size="sm" onClick={() => setViewMode('ocr')}>
              <i className="bi bi-braces-asterisk me-1" /> OCR/Edit
            </Button>
          </div>
        </div>
      )}
      {viewMode === 'ocr' ? (
        <>
          <div className="d-flex justify-content-between align-items-center gap-3 mb-2 flex-wrap">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Button variant="outline-secondary" size="sm" onClick={onBack}><i className="bi bi-arrow-left me-2" /> Back</Button>
              <Button variant="outline-secondary" size="sm" disabled={!canPrev} onClick={goPrev}><i className="bi bi-chevron-left" /> Prev</Button>
              <Button variant="outline-secondary" size="sm" disabled={!canNext} onClick={goNext}>Next <i className="bi bi-chevron-right" /></Button>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Button variant={sectionVisibility.image ? 'primary' : 'outline-secondary'} size="sm" onClick={() => toggleSectionVisibility('image')}>
                <i className={`bi ${sectionVisibility.image ? 'bi-eye-slash' : 'bi-eye'} me-1`} />
                {sectionVisibility.image ? 'Hide Image' : 'Show Image'}
              </Button>
              <Button variant={sectionVisibility.ocrText ? 'primary' : 'outline-secondary'} size="sm" onClick={() => toggleSectionVisibility('ocrText')}>
                <i className={`bi ${sectionVisibility.ocrText ? 'bi-eye-slash' : 'bi-eye'} me-1`} />
                {sectionVisibility.ocrText ? 'Hide OCR' : 'Show OCR'}
              </Button>
              <Button variant={sectionVisibility.translation ? 'primary' : 'outline-secondary'} size="sm" onClick={() => toggleSectionVisibility('translation')}>
                <i className={`bi ${sectionVisibility.translation ? 'bi-eye-slash' : 'bi-eye'} me-1`} />
                {sectionVisibility.translation ? 'Hide Translate' : 'Show Translate'}
              </Button>
            </div>
          </div>

          <div className="d-flex gap-3 align-items-start flex-nowrap">
            {sectionVisibility.image && (
              <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="fw-semibold small text-muted">Image View</span>
                  <div className="d-flex align-items-center gap-2">
                    <div className="text-muted small">{Math.round(scale * 100)}%</div>
                    <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={copyImage} disabled={!imageUrl}>
                      Copy
                    </Button>
                  </div>
                </div>
                <div
                  ref={imgWrapRef}
                  onWheel={onWheel}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={stopPan}
                  onMouseLeave={stopPan}
                  style={{
                    height: '60vh',
                    overflow: 'hidden',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(0,0,0,.125)',
                    cursor: panning ? 'grabbing' : 'grab',
                    position: 'relative',
                    backgroundColor: '#f8f9fa'
                  }}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="page"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                        transformOrigin: 'center center',
                        userSelect: 'none',
                        maxWidth: '100%',
                        maxHeight: '100%',
                        display: 'block'
                      }}
                    />
                  ) : (
                    <div className="text-muted p-3">Tidak ada gambar ditemukan di folder ini.</div>
                  )}
                </div>
                <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
                  <div className="h6 mb-0">Split View: {file ? (file.split('\\').pop() || '') : '-'}</div>
                  <Button variant="outline-secondary" size="sm" onClick={zoomOut}>-</Button>
                  <Button variant="outline-secondary" size="sm" onClick={zoomIn}>+</Button>
                  <Button variant="outline-secondary" size="sm" onClick={resetView}>Reset</Button>
                  <Button variant="outline-primary" size="sm" onClick={syncSourceUnits} disabled={!folder || sourceUnitSyncing}>
                    {sourceUnitSyncing ? 'Syncing...' : 'Sync Segments'}
                  </Button>
                </div>
              </div>
            )}

            {sectionVisibility.ocrText && (
              <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="fw-semibold small text-muted">Teks OCR</span>
                  <div className="d-flex align-items-center gap-3 flex-wrap">
                    {renderTextAudioActions()}
                    <Button variant="link" size="sm" className="p-0 text-decoration-none" disabled={!text} onClick={copyOriginal}>
                      Copy
                    </Button>
                  </div>
                </div>
                <div
                  className="p-3 border rounded-3 bg-body"
                  style={{
                    height: '60vh',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: 'var(--bs-body-color)',
                    direction: isArabicText(text) ? 'rtl' : 'ltr',
                    textAlign: isArabicText(text) ? 'right' : 'left',
                    fontFamily: isArabicText(text) ? '"Traditional Arabic", "LPMQ", "Amiri", serif' : 'inherit',
                    fontSize: isArabicText(text) ? '1.25rem' : 'inherit',
                    lineHeight: isArabicText(text) ? '2' : 'inherit'
                  }}
                  onContextMenu={handleContextMenu}
                  spellCheck={false}
                >
                  {renderHighlightedText(text)}
                </div>
              </div>
            )}

            {sectionVisibility.translation && (
              <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="fw-semibold small text-muted">Terjemahan Database</span>
                  <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => openTranslateEditor('translated')}>
                    Edit
                  </Button>
                </div>
                <div
                  className="p-3 border rounded-3 bg-body"
                  style={{
                    height: '60vh',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: 'var(--bs-body-color)'
                  }}
                >
                  {translated || <span className="text-muted">Tidak ada terjemahan untuk ditampilkan.</span>}
                </div>
              </div>
            )}
          </div>

          {!visibleOcrPanels.length ? (
            <div className="mt-3 border rounded-3 bg-body-tertiary p-4 text-center text-muted">
              Semua panel disembunyikan. Gunakan tombol di atas untuk menampilkan panel kembali.
            </div>
          ) : null}
        </>
      ) : (
      <Row className="g-3">
        {/* Kolom Gambar - Lebar dinamis berdasarkan viewMode */}
        <Col
          md={viewMode === 'reader' ? 12 : 6}
        >
          <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
            <Button variant="outline-secondary" size="sm" onClick={onBack}><i className="bi bi-arrow-left me-2" /> Back</Button>
            <Button variant="outline-secondary" size="sm" disabled={!canPrev} onClick={goPrev}><i className="bi bi-chevron-left" /> Prev</Button>
            <Button variant="outline-secondary" size="sm" disabled={!canNext} onClick={goNext}>Next <i className="bi bi-chevron-right" /></Button>
          </div>
          {viewMode === 'ocr' && !sectionVisibility.image ? (
            <div className="border rounded-3 bg-body-tertiary p-3 d-flex flex-column align-items-start gap-2">
              <div className="fw-semibold small">Image View</div>
              <Button variant="outline-secondary" size="sm" onClick={() => toggleSectionVisibility('image')}>
                <i className="bi bi-eye me-1" /> Show
              </Button>
            </div>
          ) : (
            <>
              {viewMode === 'ocr' && (
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="fw-semibold small text-muted">Image View</span>
                  <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => toggleSectionVisibility('image')}>
                    <i className="bi bi-eye-slash me-1" /> Hide
                  </Button>
                </div>
              )}
              <div
                  ref={imgWrapRef}
                  onWheel={onWheel}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={stopPan}
                  onMouseLeave={stopPan}
                  style={{
                    height: '60vh',
                    overflow: 'hidden',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(0,0,0,.125)',
                    cursor: panning ? 'grabbing' : 'grab',
                    position: 'relative',
                    backgroundColor: '#f8f9fa'
                  }}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="page"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                        transformOrigin: 'center center',
                        userSelect: 'none',
                        maxWidth: '100%',
                        maxHeight: '100%',
                        display: 'block'
                      }}
                    />
                  ) : (
                    <div className="text-muted p-3">Tidak ada gambar ditemukan di folder ini.</div>
                  )}
                </div>
              <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
                <div className="h6 mb-0">Split View: {file ? (file.split('\\').pop() || '') : '-'}</div>
                <Button variant="outline-secondary" size="sm" onClick={zoomOut}>-</Button>
                <Button variant="outline-secondary" size="sm" onClick={zoomIn}>+</Button>
                <Button variant="outline-secondary" size="sm" onClick={resetView}>Reset</Button>
                <div className="text-muted small">{Math.round(scale * 100)}%</div>
                <Button variant="outline-secondary" size="sm" onClick={copyImage} disabled={!imageUrl} title="Salin Gambar"><i className="bi bi-card-image" /></Button>
                <Button variant="outline-primary" size="sm" onClick={syncSourceUnits} disabled={!folder || sourceUnitSyncing}>
                  {sourceUnitSyncing ? 'Syncing...' : 'Sync Segments'}
                </Button>
              </div>
            </>
          )}
          </Col>
          
        {viewMode === 'study' && (
          <Col md={6}>
            <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
              <div className="btn-group btn-group-sm">
                <Button
                  variant={studySubMode === 'makna' ? 'primary' : 'outline-secondary'}
                  size="sm"
                  onClick={() => setStudySubMode('makna')}
                >
                  <i className="bi bi-translate me-1" /> Makna
                </Button>
                <Button
                  variant={studySubMode === 'uji-baca' ? 'primary' : 'outline-secondary'}
                  size="sm"
                  onClick={() => setStudySubMode('uji-baca')}
                >
                  <i className="bi bi-mic me-1" /> Uji Baca
                </Button>
              </div>
              {studySubMode === 'makna' ? (
                <div className="d-flex align-items-center gap-3 flex-wrap">
                  {renderTextAudioActions()}
                  <Button variant="link" size="sm" className="p-0 text-decoration-none" disabled={!text} onClick={copyOriginal}>
                    <i className="bi bi-clipboard" /> Copy
                  </Button>
                </div>
              ) : (
                <div className="text-muted small">Cek bacaan cepat berdasarkan halaman aktif.</div>
              )}
            </div>

            {studySubMode === 'makna' ? (
              <>
                <div className="fw-semibold small text-muted mb-1">Teks Asli (OCR)</div>
                <div
                  className="p-3 border rounded-3 bg-body"
                  style={{
                    height: '60vh',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: 'var(--bs-body-color)',
                    direction: isArabicText(text) ? 'rtl' : 'ltr',
                    textAlign: isArabicText(text) ? 'right' : 'left',
                    fontFamily: isArabicText(text) ? '"Traditional Arabic", "LPMQ", "Amiri", serif' : 'inherit',
                    fontSize: isArabicText(text) ? '1.25rem' : 'inherit',
                    lineHeight: isArabicText(text) ? '2' : 'inherit'
                  }}
                  onContextMenu={handleContextMenu}
                  spellCheck={false}
                >
                  {renderHighlightedText(text)}
                </div>
              </>
            ) : (
              <div className="border rounded-3 bg-body p-3 d-flex flex-column gap-3" style={{ minHeight: '60vh' }}>
                <div>
                  <div className="fw-semibold small text-muted mb-1">Teks Target</div>
                  <div
                    className="p-3 border rounded-3 bg-body-tertiary"
                    style={{
                      minHeight: '16vh',
                      maxHeight: '22vh',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      direction: isArabicText(readingTargetText) ? 'rtl' : 'ltr',
                      textAlign: isArabicText(readingTargetText) ? 'right' : 'left',
                      fontFamily: isArabicText(readingTargetText) ? '"Traditional Arabic", "LPMQ", "Amiri", serif' : 'inherit',
                      fontSize: isArabicText(readingTargetText) ? '1.25rem' : 'inherit',
                      lineHeight: isArabicText(readingTargetText) ? '2' : 'inherit'
                    }}
                  >
                    {readingTargetText || <span className="text-muted">Tidak ada teks target pada halaman ini.</span>}
                  </div>
                </div>

                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <Button
                    variant={voiceListening && voicePurpose === 'reading-test' ? 'danger' : 'primary'}
                    size="sm"
                    disabled={!readingTargetText}
                    onClick={() => ((voiceListening && voicePurpose === 'reading-test') ? stopVoice() : startReadingTest())}
                  >
                    <i className={`bi ${voiceListening && voicePurpose === 'reading-test' ? 'bi-mic-mute-fill' : 'bi-mic-fill'} me-1`} />
                    {voiceListening && voicePurpose === 'reading-test' ? 'Stop Uji Baca' : 'Mulai Baca'}
                  </Button>
                  <Button variant="outline-secondary" size="sm" onClick={resetReadingTest} disabled={!readingTranscript && !readingComparison && !readingTestError}>
                    <i className="bi bi-arrow-counterclockwise me-1" /> Ulangi
                  </Button>
                  <div className="text-muted small">
                    {readingTestStatus === 'listening'
                      ? 'Sedang mendengarkan bacaan...'
                      : readingTestStatus === 'done'
                        ? 'Transcript selesai diproses.'
                        : 'Baca halaman aktif lalu cek kecocokannya.'}
                  </div>
                </div>

                {readingTestError ? (
                  <Alert variant="warning" className="mb-0">
                    {readingTestError}
                  </Alert>
                ) : null}

                <div>
                  <div className="fw-semibold small text-muted mb-1">Hasil Transcript</div>
                  <div
                    className="p-3 border rounded-3 bg-body-tertiary"
                    style={{
                      minHeight: '12vh',
                      whiteSpace: 'pre-wrap',
                      direction: isArabicText(readingTranscript) ? 'rtl' : 'ltr',
                      textAlign: isArabicText(readingTranscript) ? 'right' : 'left',
                      fontFamily: isArabicText(readingTranscript) ? '"Traditional Arabic", "LPMQ", "Amiri", serif' : 'inherit',
                      fontSize: isArabicText(readingTranscript) ? '1.2rem' : 'inherit',
                      lineHeight: isArabicText(readingTranscript) ? '2' : 'inherit'
                    }}
                  >
                    {readingTranscript || <span className="text-muted">Belum ada transcript.</span>}
                  </div>
                </div>

                <div>
                  <div className="fw-semibold small text-muted mb-1">Evaluasi Kecocokan</div>
                  {readingComparison ? (
                    <div className="p-3 border rounded-3 bg-body-tertiary d-flex flex-column gap-2">
                      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                        <span className={`badge text-bg-${readingComparison.status === 'match_high' ? 'success' : readingComparison.status === 'match_partial' ? 'warning' : 'danger'}`}>
                          {readingComparison.status === 'match_high'
                            ? 'Cocok'
                            : readingComparison.status === 'match_partial'
                              ? 'Cocok Sebagian'
                              : 'Perlu Ulang'}
                        </span>
                        <div className="text-muted small">
                          Kemiripan kasar: {Math.round((readingComparison.similarity || 0) * 100)}%
                        </div>
                      </div>
                      <div>{readingComparison.feedback}</div>
                      <div className="text-muted small">
                        Kata cocok: {readingComparison.matchedCount} dari target {readingComparison.targetCount}
                      </div>
                      <div>
                        <div className="fw-semibold small mb-1">Kata target yang belum terbaca</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {readingComparison.missingWords.length > 0 ? readingComparison.missingWords.join(' | ') : <span className="text-muted">Tidak ada.</span>}
                        </div>
                      </div>
                      <div>
                        <div className="fw-semibold small mb-1">Kata yang terbaca tetapi tidak ada di target</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {readingComparison.unexpectedWords.length > 0 ? readingComparison.unexpectedWords.join(' | ') : <span className="text-muted">Tidak ada.</span>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 border rounded-3 bg-body-tertiary text-muted">
                      Hasil evaluasi akan muncul setelah transcript bacaan tersedia.
                    </div>
                  )}
                </div>
              </div>
            )}
          </Col>
        )}

      </Row>
      )}

      {viewMode === 'ocr' && (
        <Row className="g-3 mt-1">
          <Col md={12}>
            {sectionVisibility.tools ? (
              <div className="border rounded-3 bg-body-tertiary p-3">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                  <div className="fw-semibold">Workspace OCR/Edit</div>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <Button variant="outline-secondary" size="sm" disabled={!text} onClick={copyOriginal}>
                      <i className="bi bi-clipboard me-1" /> Copy OCR
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={copyImage} disabled={!imageUrl}>
                      <i className="bi bi-card-image me-1" /> Copy Image
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={loadVersionHistory} disabled={!text}>
                      <i className="bi bi-clock-history me-1" /> History
                    </Button>
                    <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => toggleSectionVisibility('tools')}>
                      <i className="bi bi-eye-slash me-1" /> Hide
                    </Button>
                  </div>
                </div>

                <div className="d-flex flex-wrap align-items-end gap-3 mb-3">
                  <div>
                    <div className="text-muted small mb-1">OCR Engine</div>
                    <Form.Select size="sm" style={{ width: '180px' }} value={ocrEngine} onChange={handleEngineChange}>
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
                    <Form.Select size="sm" style={{ width: '220px' }} value={ocrLayoutMode} onChange={handleLayoutModeChange}>
                      <option value="box_notes">Inside Box + Outside di akhir</option>
                      <option value="full">Full Page</option>
                    </Form.Select>
                  </div>
                  <Button variant="outline-primary" size="sm" className="px-3" disabled={ocrRunning || !imageUrl} onClick={reOcr}>
                    <i className="bi bi-card-text me-1" /> Re-OCR
                  </Button>
                  <div>
                    <div className="text-muted small mb-1">Translate Provider</div>
                    <Form.Select
                      size="sm"
                      style={{ width: '200px' }}
                      value={translateProviders.length > 0 ? String(getTranslateProviderConfig()?.id || '') : translateAi}
                      onChange={handleTranslateAiChange}
                    >
                      {translateProviders.length > 0 ? (
                        translateProviders.map(p => (
                          <option key={p.id} value={String(p.id)}>{p.name} ({p.provider})</option>
                        ))
                      ) : (
                        <>
                          <option value="gemini">Gemini</option>
                          <option value="openai">OpenAI</option>
                        </>
                      )}
                    </Form.Select>
                  </div>
                  <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                    <div className="text-muted small mb-1">Translate Action</div>
                    <div className="btn-group">
                      <Button variant="primary" size="sm" disabled={!text || cliRunning} onClick={() => { setTranslateMenuOpen(false); runTranslate() }}>
                        <i className="bi bi-stars me-1" /> Translate
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className="dropdown-toggle dropdown-toggle-split"
                        disabled={!text || cliRunning}
                        onClick={() => setTranslateMenuOpen(v => !v)}
                      >
                        <span className="visually-hidden">Toggle Dropdown</span>
                      </Button>
                    </div>
                    {translateMenuOpen && (
                      <div
                        className="dropdown-menu show"
                        style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="dropdown-item" style={{ cursor: 'pointer' }} onClick={() => { setTranslateMenuOpen(false); runTranslate() }}>
                          <i className="bi bi-play-fill me-2 text-primary" /> Auto Translate
                        </div>
                        <div className="dropdown-item" style={{ cursor: 'pointer' }} onClick={openTranslatePrompt}>
                          <i className="bi bi-chat-text-fill me-2 text-primary" /> With prompt...
                        </div>
                      </div>
                    )}
                  </div>
                  <Button variant="outline-secondary" size="sm" onClick={() => openTranslateEditor('translated')}>
                    Open Editor
                  </Button>
                </div>

                <div className="d-flex flex-wrap align-items-end gap-3">
                  <div>
                    <div className="text-muted small mb-1">Review Actor</div>
                    <Form.Control
                      size="sm"
                      style={{ width: '180px' }}
                      value={reviewActor}
                      onChange={(e) => setReviewActor(e.target.value)}
                      placeholder="Actor name"
                    />
                  </div>
                  <div>
                    <div className="text-muted small mb-1">Review Status</div>
                    <div className="btn-group">
                      <Button variant="outline-info" size="sm" onClick={() => submitReviewStatus('reviewed')} disabled={!translatedMeta?.latest_version?.id || reviewSubmitting}>Reviewed</Button>
                      <Button variant="outline-success" size="sm" onClick={() => submitReviewStatus('approved')} disabled={!translatedMeta?.latest_version?.id || reviewSubmitting}>Approved</Button>
                      <Button variant="outline-danger" size="sm" onClick={() => submitReviewStatus('rejected')} disabled={!translatedMeta?.latest_version?.id || reviewSubmitting}>Rejected</Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border rounded-3 bg-body-tertiary p-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div className="fw-semibold">Workspace OCR/Edit</div>
                <Button variant="outline-secondary" size="sm" onClick={() => toggleSectionVisibility('tools')}>
                  <i className="bi bi-eye me-1" /> Show Tools
                </Button>
              </div>
            )}
          </Col>
        </Row>
      )}

      {/* Row Bawah Khusus Terjemahan untuk Study Mode */}
      {viewMode === 'study' && studySubMode === 'makna' && (
        <Row className="g-3 mt-1">
          <Col md={6}></Col>
          <Col md={6}>
            <div className="d-flex justify-content-between align-items-center mb-1">
               <span className="fw-semibold small text-muted">Terjemahan Indonesia</span>
            </div>
            <div
              className="p-3 border rounded-3 bg-body-secondary"
              style={{ height: '30vh', overflowY: 'auto', whiteSpace: 'pre-wrap', color: 'var(--bs-body-color)' }}
            >
              {translated || <span className="text-muted">Tidak ada terjemahan untuk ditampilkan.</span>}
            </div>
          </Col>
        </Row>
      )}

      {/* Container Logging & Technical Tools (Disembunyikan di Reader Mode) */}
      {viewMode !== 'reader' && (
        <Row className="g-3 mt-1">
          <Col md={12}>
          {renderTranslateProcessAlert()}
          {ocrRunning && (
            <div className="mb-2 p-3 border rounded-3 d-flex align-items-center gap-2 bg-primary text-white">
              <div className="spinner-border spinner-border-sm text-warning" role="status" />
              <span>Sedang melakukan OCR ulang...</span>
            </div>
          )}
          {cliRunning && !translateStatus?.running && (
            <div className="mb-2 p-3 border rounded-3 d-flex align-items-center gap-2 bg-primary text-white">
              <div className="spinner-border spinner-border-sm text-primary" role="status" />
              <span>Sedang memproses terjemahan...</span>
            </div>
          )}
          {cliResult && !cliRunning && (
            <div className="mb-2">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">Hasil {(() => {
                  const p = getTranslateProviderConfig()
                  return p ? p.name : (translateAi === 'openai' ? 'OpenAI' : 'Gemini')
                })()}</div>
                <div className="d-flex align-items-center gap-2">
                  <Button variant="outline-secondary" size="sm" onClick={() => openTranslateEditor('cli')}>Open Editor</Button>
                  <Button variant="success" size="sm" onClick={saveCliResult}>Simpan ke Database</Button>
                </div>
              </div>
              <div className="p-3 border rounded-3 bg-body" style={{ whiteSpace: 'pre-wrap', color: 'var(--bs-body-color)' }}>{cliResult}</div>
            </div>
          )}
          
          {/* Tampilan Edit Terjemahan Khusus OCR Mode (Hanya Tombol Edit, karena text sudah di kolom atas) */}
          {viewMode === 'ocr' && (
            <div className="d-flex justify-content-end mb-2 mt-2">
              <Button variant="outline-secondary" size="sm" onClick={() => openTranslateEditor('translated')}>Open Full Editor Terjemahan</Button>
            </div>
          )}

          <details className="mt-3 border rounded-3 p-3 bg-light-subtle">
            <summary className="d-flex justify-content-between align-items-center" style={{ cursor: 'pointer', userSelect: 'none' }}>
              <span className="fw-semibold">Panel Bantuan Translate</span>
              <span className="text-muted small">
                Source Unit {sourceCurrent ? '1' : '0'} | Glossary {glossaryHits.length} | Similar {similarHits.length} | Substring {substringHits.length} | Semantic TM {semanticTmHits.length} | Semantic SU {semanticSourceUnitHits.length}
              </span>
            </summary>
            <div className="mt-3 d-flex flex-column gap-3">
              <details className="border rounded-3 p-3 bg-body" open={false}>
                <summary className="d-flex justify-content-between align-items-center" style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <span className="fw-semibold">Source Unit Context</span>
                  <span className="text-muted small">
                    {sourceUnitLoading
                      ? 'Memuat context...'
                      : sourceCurrent
                        ? `${sourceCurrent.unit_type || 'segment'} | Page ${sourceCurrent.page_number ?? '-'} | Segment ${sourceCurrent.segment_order ?? '-'}`
                        : 'Belum ada unit aktif'}
                  </span>
                </summary>
                <div className="mt-3 d-flex flex-column gap-2" style={{ maxHeight: '32vh', overflowY: 'auto' }}>
                  {renderSourceUnitCard('Prev', sourcePrev)}
                  {renderSourceUnitCard('Current', sourceCurrent)}
                  {renderSourceUnitCard('Next', sourceNext)}
                  {sourcePageSegments.length > 0 ? (
                    <div className="border rounded-2 p-2">
                      <div className="fw-semibold mb-2">Current Page Segments</div>
                      <div className="d-flex flex-column gap-2">
                        {sourcePageSegments.map((item) => (
                          <div key={item.id} className="border rounded-2 p-2">
                            <div className="text-muted small mb-1">
                              Segment: {item.segment_order ?? '-'} | Page: {item.page_number ?? '-'} | Type: {item.unit_type || '-'}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{item.source_text || '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>

              <details className="border rounded-3 p-3 bg-body" open={false}>
                <summary className="d-flex justify-content-between align-items-center" style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <span className="fw-semibold">Prompt Support Context</span>
                  <span className="text-muted small">
                    {assistLoading ? 'Memuat...' : `Glossary ${glossaryHits.length} | Similar ${similarHits.length} | Substring ${substringHits.length}`}
                  </span>
                </summary>
                <div className="mt-3 d-flex flex-column gap-3" style={{ maxHeight: '34vh', overflowY: 'auto' }}>
                  {exactHit ? (
                    <div>
                      <div className="fw-semibold text-success mb-1">Exact TM Hit</div>
                      <div className="text-muted small mb-1">
                        Sumber: {exactHit.source_table || exactHit.source_table === '' ? exactHit.source_table : 'translation_memory'} | Match: {exactHit.match_type || 'exact'}
                      </div>
                      <div className="border rounded-2 p-2 mb-2" style={{ direction: 'rtl', textAlign: 'right', whiteSpace: 'pre-wrap' }}>
                        {exactHit.text_original || '-'}
                      </div>
                      <div className="border rounded-2 p-2" style={{ whiteSpace: 'pre-wrap' }}>
                        {exactHit.text_translate || '-'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted small">Belum ada exact TM hit untuk halaman ini.</div>
                  )}

                  <div>
                    <div className="fw-semibold mb-1">Glossary Hits</div>
                    {glossaryHits.length > 0 ? (
                      <div className="d-flex flex-column gap-2">
                        {glossaryHits.map((item) => (
                          <div key={item.id} className="border rounded-2 p-2">
                            <div className="d-flex justify-content-between align-items-start gap-2">
                              <div style={{ direction: 'rtl', textAlign: 'right' }}>{item.source_term}</div>
                              <div className="text-muted small">P{item.priority}</div>
                            </div>
                            <div>{item.target_term}</div>
                            {item.notes ? <div className="text-muted small mt-1">{item.notes}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted small">Tidak ada glossary hit.</div>
                    )}
                  </div>

                  <div>
                    <div className="fw-semibold mb-1">TM Similar</div>
                    {similarHits.length > 0 ? (
                      <div className="d-flex flex-column gap-2">
                        {similarHits.map((item) => (
                          <div key={item.id} className="border rounded-2 p-2">
                            <div className="text-muted small mb-1">{item.match_type || 'similar'} | {item.source_table || 'translation_memory'}</div>
                            <div className="mb-2" style={{ direction: 'rtl', textAlign: 'right', whiteSpace: 'pre-wrap' }}>{item.text_original}</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{item.text_translate}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted small">Tidak ada similar hit.</div>
                    )}
                  </div>

                  <div>
                    <div className="fw-semibold mb-1">TM Substring</div>
                    {substringHits.length > 0 ? (
                      <div className="d-flex flex-column gap-2">
                        {substringHits.map((item) => (
                          <div key={item.id} className="border rounded-2 p-2">
                            <div className="text-muted small mb-1">{item.match_type || 'substring'} | {item.source_table || 'translation_memory'}</div>
                            <div className="mb-2" style={{ direction: 'rtl', textAlign: 'right', whiteSpace: 'pre-wrap' }}>{item.text_original}</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{item.text_translate}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted small">Tidak ada substring hit.</div>
                    )}
                  </div>
                </div>
              </details>

              <details className="border rounded-3 p-3 bg-body" open={false}>
                <summary className="d-flex justify-content-between align-items-center" style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <span className="fw-semibold">Prompt ke AI</span>
                  <span className="text-muted small">
                    {cliRunning
                      ? 'Menyusun prompt...'
                      : promptTrace?.aiCalled
                        ? `${promptTrace.protocol || '-'} | ${promptTrace.model || '-'}`
                        : promptTrace?.skipReason
                          ? 'AI tidak dipanggil'
                          : 'Belum ada prompt'}
                  </span>
                </summary>
                <div className="mt-3 d-flex flex-column gap-3" style={{ maxHeight: '34vh', overflowY: 'auto' }}>
                  {promptTrace ? (
                    promptTrace.aiCalled ? (
                      <>
                        <div className="border rounded-2 p-2">
                          <div className="fw-semibold mb-1">Ringkasan</div>
                          <div className="text-muted small d-flex flex-column gap-1">
                            <div>Provider: {promptTrace.provider || '-'}</div>
                            <div>Protocol: {promptTrace.protocol || '-'}</div>
                            <div>Model: {promptTrace.model || '-'}</div>
                          </div>
                        </div>

                        <div>
                          <div className="fw-semibold mb-1">System Prompt</div>
                          <div className="border rounded-2 p-2" style={{ whiteSpace: 'pre-wrap' }}>
                            {promptTrace.systemPrompt || '-'}
                          </div>
                        </div>

                        <div>
                          <div className="fw-semibold mb-1">User Prompt</div>
                          <div className="border rounded-2 p-2" style={{ whiteSpace: 'pre-wrap' }}>
                            {promptTrace.userPrompt || '-'}
                          </div>
                        </div>

                        <div>
                          <div className="fw-semibold mb-1">Raw Request Payload</div>
                          <div className="border rounded-2 p-2 bg-light" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {promptTrace.requestPayload || '-'}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-muted small">
                        {promptTrace.skipReason || 'AI tidak dipanggil untuk request ini.'}
                      </div>
                    )
                  ) : (
                    <div className="text-muted small">
                      Klik tombol Translate untuk melihat prompt final yang dikirim ke AI.
                    </div>
                  )}
                </div>
              </details>

              <details className="border rounded-3 p-3 bg-body" open={false}>
                <summary className="d-flex justify-content-between align-items-center" style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <span className="fw-semibold">Semantic Observability</span>
                  <span className="text-muted small">
                    {cliRunning
                      ? 'Menunggu hasil translate...'
                      : semanticContext?.enabled
                        ? `TM ${semanticTmHits.length} | Source Unit ${semanticSourceUnitHits.length}`
                        : 'Belum ada semantic hit'}
                  </span>
                </summary>
                <div className="mt-3 d-flex flex-column gap-3" style={{ maxHeight: '34vh', overflowY: 'auto' }}>
                  {semanticContext?.enabled ? (
                    <>
                      <div className="border rounded-2 p-2">
                        <div className="fw-semibold mb-1">Ringkasan</div>
                        <div className="text-muted small d-flex flex-column gap-1">
                          <div>Provider: {semanticContext.provider || '-'}</div>
                          <div>Model: {semanticContext.model || '-'}</div>
                          <div>Indexed: {semanticContext.indexedCount || 0} | Hits: {semanticContext.exampleCount || 0}</div>
                          <div>TM Indexed: {semanticContext.tmIndexedCount || 0} | TM Hits: {semanticContext.tmExampleCount || 0} | Threshold: {semanticContext.tmThreshold ?? '-'}</div>
                          <div>Source Unit Indexed: {semanticContext.sourceUnitIndexedCount || 0} | Source Unit Hits: {semanticContext.sourceUnitCount || 0} | Threshold: {semanticContext.sourceUnitThreshold ?? '-'}</div>
                        </div>
                      </div>

                      <div>
                        <div className="fw-semibold mb-1">Semantic TM Hits</div>
                        {semanticTmHits.length > 0 ? (
                          <div className="d-flex flex-column gap-2">
                            {semanticTmHits.map((item, index) => (
                              <div key={`semantic-tm-${index}`} className="border rounded-2 p-2">
                                <div className="text-muted small mb-1">
                                  Rank: {item.rank || index + 1} | Similarity: {item.similarity_score != null ? Number(item.similarity_score).toFixed(3) : '-'} | Threshold: {item.threshold ?? '-'} | Status: {item.approval_status || 'unreviewed'}
                                </div>
                                <div className="text-muted small mb-2">
                                  File: {item.file_name || '-'} | Provider asal: {item.provider || '-'} | Model asal: {item.model || '-'}
                                </div>
                                <div className="mb-2" style={{ direction: 'rtl', textAlign: 'right', whiteSpace: 'pre-wrap' }}>{item.text_original || '-'}</div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{item.text_translate || '-'}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted small">Tidak ada semantic TM hit yang masuk ke prompt.</div>
                        )}
                      </div>

                      <div>
                        <div className="fw-semibold mb-1">Semantic Source Unit Hits</div>
                        {semanticSourceUnitHits.length > 0 ? (
                          <div className="d-flex flex-column gap-2">
                            {semanticSourceUnitHits.map((item, index) => (
                              <div key={`semantic-su-${index}`} className="border rounded-2 p-2">
                                <div className="text-muted small mb-1">
                                  Rank: {item.rank || index + 1} | Similarity: {item.similarity_score != null ? Number(item.similarity_score).toFixed(3) : '-'} | Threshold: {item.threshold ?? '-'}
                                </div>
                                <div className="text-muted small mb-2">
                                  Type: {item.unit_type || '-'} | Page: {item.page_number ?? '-'} | Segment: {item.segment_order ?? '-'} | File: {item.file_name || '-'}
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{item.source_text || '-'}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted small">Tidak ada semantic source unit hit yang masuk ke prompt.</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted small">
                      Jalankan translate AI untuk melihat semantic hits, provider embed, model, dan similarity score yang benar-benar dipakai.
                    </div>
                  )}
                </div>
              </details>
            </div>
          </details>
        </Col>
      </Row>
      )}

      {/* Context Menu */}
      {ctxMenu.show && (
        <div 
          style={{ 
            position: 'fixed', 
            top: ctxMenu.y, 
            left: ctxMenu.x, 
            zIndex: 9999, 
            backgroundColor: 'var(--bs-body-bg)', 
            border: '1px solid var(--bs-border-color)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            borderRadius: '0.5rem',
            padding: '0.5rem 0',
            minWidth: '220px'
          }}
          onMouseLeave={() => setShowSubMenu(false)}
        >
          <div className="px-3 py-1 text-muted small fw-bold border-bottom mb-1">Reader Menu</div>
          
          {/* Main Translate Item with Hover for Submenu */}
          <div 
            className="px-3 py-1 dropdown-item d-flex justify-content-between align-items-center" 
            style={{ cursor: 'pointer', position: 'relative' }}
            onMouseEnter={() => setShowSubMenu(true)}
            onClick={() => handleTranslateSelection('gemini')}
          >
            <span>
              <i className="bi bi-translate me-2"></i>
              Translate
            </span>
            <i className="bi bi-chevron-right small"></i>
            
            {/* Submenu */}
            {showSubMenu && (
              <div 
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '100%',
                  marginLeft: '2px',
                  zIndex: 10000,
                  backgroundColor: 'var(--bs-body-bg)',
                  border: '1px solid var(--bs-border-color)',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                  borderRadius: '0.375rem',
                  padding: '0.5rem 0',
                  minWidth: '150px'
                }}
              >
                <div 
                  className="px-3 py-1 dropdown-item"
                  onClick={(e) => { e.stopPropagation(); handleTranslateSelection('gemini') }}
                >
                  <i className="bi bi-google me-2"></i> Gemini
                </div>
                <div 
                  className="px-3 py-1 dropdown-item"
                  onClick={(e) => { e.stopPropagation(); handleTranslateSelection('openai') }}
                >
                  <i className="bi bi-robot me-2"></i> OpenAI
                </div>
              </div>
            )}
          </div>

          <hr className="dropdown-divider" />
          <div className="px-3 py-1 text-muted small">Read Aloud</div>
          <div 
            className="px-3 py-1 dropdown-item" 
            style={{ cursor: 'pointer' }}
            onClick={() => handleTts('openai')}
          >
            <i className="bi bi-soundwave me-2"></i> OpenAI TTS
          </div>
          <div 
            className="px-3 py-1 dropdown-item" 
            style={{ cursor: 'pointer' }}
            onClick={() => handleTts('system')}
          >
            <i className="bi bi-speaker me-2"></i> System / Gemini
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', bottom: audioPlaying ? 80 : 20, right: 20, zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        {voiceOpen && (
          <div style={{ width: 260, background: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 12 }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold">Voice Command</div>
              <Button variant="link" className="p-0" onClick={() => setVoiceOpen(false)}><i className="bi bi-x-lg" /></Button>
            </div>
            <div className="mb-2">
              <div className="text-muted small mb-1">OCR Engine</div>
              <Form.Select size="sm" value={ocrEngine} onChange={handleEngineChange}>
                <option value="tesseract">Tesseract</option>
                <option value="arabic_dl">Arabic DL</option>
                <option value="kraken_arabic">Kraken (Arabic)</option>
                <option value="easyocr">EasyOCR</option>
                <option value="google_vision">Google Vision</option>
                <option value="unlimited_ocr">Unlimited-OCR</option>
              </Form.Select>
            </div>
            <div className="mb-2">
              <div className="text-muted small mb-1">Translate Provider</div>
              <Form.Select size="sm" value={translateProviders.length > 0 ? String(getTranslateProviderConfig()?.id || '') : translateAi} onChange={handleTranslateAiChange}>
                {translateProviders.length > 0 ? (
                  translateProviders.map(p => (
                    <option key={p.id} value={String(p.id)}>{p.name} ({p.provider})</option>
                  ))
                ) : (
                  <>
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI</option>
                  </>
                )}
              </Form.Select>
            </div>
            <div className="mb-2">
              <div className="text-muted small mb-1">Model</div>
              {(() => {
                const providerConfig = getTranslateProviderConfig()
                if (providerConfig?.model_default) {
                  return <Form.Control size="sm" value={providerConfig.model_default} readOnly className="bg-light" />
                }
                if (translateAi === 'openai') {
                  return <Form.Control size="sm" value={openAiModel} onChange={handleOpenAiModelChange} />
                }
                return <Form.Control size="sm" value={geminiModel} onChange={handleGeminiModelChange} />
              })()}
            </div>
            <div className="text-muted small">Command: "re ocr" / "translate"</div>
          </div>
        )}

        {(voiceListening || voiceText) && (
          <div style={{ maxWidth: 320, background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 12px', borderRadius: 12 }}>
            <div className="d-flex align-items-center gap-2">
              {voiceListening ? <div className="spinner-grow spinner-grow-sm text-danger" /> : null}
              <div className="small">
                {voicePurpose === 'reading-test' ? 'Uji Baca' : 'Voice'}
                {' '}
                {voiceListening ? 'Listening…' : 'Heard:'}
                {' '}
                {voiceText || '-'}
              </div>
            </div>
          </div>
        )}

        <div className="d-flex align-items-center gap-2">
          <Button
            variant={voiceListening ? 'danger' : 'primary'}
            size="sm"
            onClick={() => (voiceListening ? stopVoice() : startVoice())}
          >
            <i className={`bi ${voiceListening ? 'bi-mic-mute-fill' : 'bi-mic-fill'} me-2`} />
            {voiceListening ? 'Stop' : 'Voice'}
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={() => setVoiceOpen(v => !v)}>
            <i className="bi bi-sliders" />
          </Button>
        </div>
      </div>

      {audioPlaying && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 10000, background: '#333', color: '#fff', padding: '10px 20px', borderRadius: '50px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          {audioPaused ? (
            <i className="bi bi-pause-circle-fill" style={{ fontSize: '1rem' }}></i>
          ) : (
            <div className="spinner-grow spinner-grow-sm text-light" role="status"></div>
          )}
          <span>{audioPaused ? 'Audio dijeda' : 'Sedang membacakan...'}</span>
          {audioRef.current ? (
            <Button
              variant="outline-light"
              size="sm"
              className="rounded-pill px-3"
              onClick={() => (audioPaused ? resumeAudio() : pauseAudio())}
            >
              <i className={`bi ${audioPaused ? 'bi-play-fill' : 'bi-pause-fill'} me-1`} />
              {audioPaused ? 'Resume' : 'Pause'}
            </Button>
          ) : null}
          <Button variant="outline-light" size="sm" className="rounded-pill px-3" onClick={stopAudio}>
            <i className="bi bi-stop-fill me-1" />
            Stop
          </Button>
        </div>
      )}

      {/* Word Translation Modal */}
      <Modal show={wordModal.show} onHide={() => setWordModal(prev => ({ ...prev, show: false }))} backdrop="static" keyboard={false} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Terjemahan & Analisis Kata</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <label className="fw-bold small text-muted">Teks Asli:</label>
            <div className="p-2 border rounded bg-light text-dark" style={{ direction: 'rtl', fontSize: '1.1em' }}>{wordModal.text}</div>
          </div>
          <div className="mb-3">
            <label className="fw-bold small text-muted">Model AI:</label>
            <Form.Select size="sm" value={wordModal.provider} onChange={handleWordProviderChange} style={{ width: '200px' }}>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI (GPT)</option>
            </Form.Select>
          </div>
          <div>
            <label className="fw-bold small text-muted">Analisis Nahwu & Terjemahan:</label>
            {wordModal.loading ? (
              <div className="d-flex align-items-center gap-2 mt-2 text-primary">
                <div className="spinner-border spinner-border-sm" />
                <span>Menganalisis...</span>
              </div>
            ) : (
              <div className="p-3 border rounded mt-1 bg-white text-dark" style={{ minHeight: '100px', whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto' }}>
                {wordModal.translation}
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setWordModal(prev => ({ ...prev, show: false }))}>Tutup</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={translatePromptModal.show} onHide={() => setTranslatePromptModal(prev => ({ ...prev, show: false }))} centered>
        <Modal.Header closeButton>
          <Modal.Title>Translate with prompt</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-2 text-muted small">Tambahkan instruksi (opsional) untuk proses translate.</div>
          <Form.Control
            as="textarea"
            rows={5}
            value={translatePromptModal.prompt}
            onChange={(e) => setTranslatePromptModal(prev => ({ ...prev, prompt: e.target.value }))}
            placeholder="Contoh: gunakan bahasa lebih sederhana, jelaskan istilah, dll"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setTranslatePromptModal(prev => ({ ...prev, show: false }))}>Batal</Button>
          <Button variant="primary" disabled={!text || cliRunning} onClick={runTranslateWithPrompt}>Translate</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={translateEditModal.show} onHide={() => setTranslateEditModal(prev => ({ ...prev, show: false }))} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Editor Terjemahan</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            as="textarea"
            rows={14}
            value={translateEditModal.value}
            onChange={(e) => setTranslateEditModal(prev => ({ ...prev, value: e.target.value }))}
            spellCheck={false}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setTranslateEditModal(prev => ({ ...prev, show: false }))}>Batal</Button>
          {translateEditModal.source === 'translated' ? (
            <Button variant="success" disabled={translateEditSaving || !api} onClick={saveEditedTranslation}>Simpan ke Database</Button>
          ) : null}
          <Button variant="primary" onClick={applyTranslateEdit}>Terapkan</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={versionHistoryModal.show} onHide={() => setVersionHistoryModal({ show: false, loading: false })} size="xl">
        <Modal.Header closeButton>
          <Modal.Title>Riwayat Versi Terjemahan</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {versionHistoryModal.loading ? (
            <div className="text-muted">Memuat riwayat versi...</div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Compare Versi</div>
                <div className="d-flex gap-2 flex-wrap mb-3">
                  <Form.Select value={compareVersionIds.left} onChange={(e) => setCompareVersionIds(v => ({ ...v, left: e.target.value }))}>
                    {versionHistory.map((item) => (
                      <option key={`left-${item.id}`} value={String(item.id)}>
                        V{item.version_number} | {item.source_label} | {String(item.created_at || '').slice(0, 19)}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Select value={compareVersionIds.right} onChange={(e) => setCompareVersionIds(v => ({ ...v, right: e.target.value }))}>
                    {versionHistory.map((item) => (
                      <option key={`right-${item.id}`} value={String(item.id)}>
                        V{item.version_number} | {item.source_label} | {String(item.created_at || '').slice(0, 19)}
                      </option>
                    ))}
                  </Form.Select>
                </div>
                <Row className="g-3">
                  <Col md={6}>
                    <div className="border rounded-2 p-2 h-100">
                      <div className="fw-semibold mb-1">{compareLeft ? `Versi ${compareLeft.version_number}` : 'Versi kiri'}</div>
                      <div className="text-muted small mb-2">
                        {compareLeft ? `${compareLeft.source_label} | confidence ${compareLeft.confidence_score ?? '-'} | ${String(compareLeft.created_at || '').slice(0, 19)}` : '-'}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', maxHeight: '30vh', overflowY: 'auto' }}>{compareLeft?.translated_text || '-'}</div>
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="border rounded-2 p-2 h-100">
                      <div className="fw-semibold mb-1">{compareRight ? `Versi ${compareRight.version_number}` : 'Versi kanan'}</div>
                      <div className="text-muted small mb-2">
                        {compareRight ? `${compareRight.source_label} | confidence ${compareRight.confidence_score ?? '-'} | ${String(compareRight.created_at || '').slice(0, 19)}` : '-'}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', maxHeight: '30vh', overflowY: 'auto' }}>{compareRight?.translated_text || '-'}</div>
                    </div>
                  </Col>
                </Row>
              </div>

              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Daftar Versi</div>
                <div className="d-flex flex-column gap-2">
                  {versionHistory.map((item) => (
                    <div key={item.id} className="border rounded-2 p-2">
                      <div className="fw-semibold">Versi {item.version_number}</div>
                      <div className="text-muted small">
                        {item.source_label} | confidence {item.confidence_score ?? '-'} | low {item.low_confidence ? 'yes' : 'no'} | {String(item.created_at || '').slice(0, 19)}
                      </div>
                      {Array.isArray(item.confidence_reasons) && item.confidence_reasons.length > 0 ? (
                        <div className="text-muted small mt-1">Reason: {item.confidence_reasons.join(', ')}</div>
                      ) : null}
                    </div>
                  ))}
                  {versionHistory.length === 0 ? <div className="text-muted">Belum ada histori versi.</div> : null}
                </div>
              </div>

              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Metadata Review</div>
                <div className="d-flex flex-column gap-2">
                  {feedbackHistory.map((item) => (
                    <div key={item.id} className="border rounded-2 p-2">
                      <div className="fw-semibold">
                        {item.feedback_label || item.feedback_type || 'feedback'}
                        {item.version_number ? ` | v${item.version_number}` : ''}
                      </div>
                      <div className="text-muted small">
                        {String(item.created_at || '').slice(0, 19)}
                        {item.payload?.actor_name ? ` | actor: ${item.payload.actor_name}` : ''}
                        {item.payload?.source_flow ? ` | flow: ${item.payload.source_flow}` : ''}
                      </div>
                      {item.notes ? <div className="mt-1">{item.notes}</div> : null}
                    </div>
                  ))}
                  {feedbackHistory.length === 0 ? <div className="text-muted">Belum ada event review.</div> : null}
                </div>
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>
    </>
  )
}
