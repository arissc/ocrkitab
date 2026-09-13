import React, { useEffect, useState } from 'react'
import { Row, Col, ListGroup, Button, Form, Alert, InputGroup, Badge, Table } from 'react-bootstrap'
import DBSettingsPage from './DBSettingsPage'

const capabilityOptions = [
  { id: 'translate', label: 'Translate' },
  { id: 'embed', label: 'Embed' },
  { id: 'chat', label: 'Chat' },
  { id: 'ocr', label: 'OCR' },
  { id: 'vision', label: 'Vision' },
  { id: 'tts', label: 'TTS' },
  { id: 'stt', label: 'STT' }
]

const createApiForm = () => ({
  id: null,
  name: '',
  provider: '',
  api_key: '',
  base_url: '',
  model_default: '',
  capabilities: [],
  status: 'active',
  priority_order: '',
  meta_json: ''
})

const mapApiToForm = (item) => ({
  id: item?.id || null,
  name: item?.name || '',
  provider: item?.provider || '',
  api_key: item?.api_key || '',
  base_url: item?.base_url || '',
  model_default: item?.model_default || '',
  capabilities: Array.isArray(item?.capabilities) ? item.capabilities : [],
  status: item?.status || 'active',
  priority_order: item?.priority_order == null ? '' : String(item.priority_order),
  meta_json: item?.meta_json || ''
})

const createGlossaryForm = () => ({
  id: null,
  id_kitab: '',
  source_lang: 'ar',
  target_lang: 'id',
  source_term: '',
  target_term: '',
  notes: '',
  priority: '100',
  is_active: true
})

const mapGlossaryToForm = (item) => ({
  id: item?.id || null,
  id_kitab: item?.id_kitab == null ? '' : String(item.id_kitab),
  source_lang: item?.source_lang || 'ar',
  target_lang: item?.target_lang || 'id',
  source_term: item?.source_term || '',
  target_term: item?.target_term || '',
  notes: item?.notes || '',
  priority: item?.priority == null ? '100' : String(item.priority),
  is_active: Number(item?.is_active || 0) === 1
})

const createStyleMemoryCfg = () => ({
  useGlobalStyleInTranslate: true,
  approvedOnly: true,
  requireExplicitApproval: true,
  includeHighQualityFallback: false,
  useQualityWeighting: true,
  includeRepresentativeSamples: false,
  representativeSampleCount: '2',
  lockedRulesText: [
    'Gelar ulama dipertahankan sebagai gelar, bukan diterjemahkan literal.',
    'Doa setelah nama diterjemahkan ke makna Indonesia secara wajar.',
    'Hindari istilah akademik modern yang tidak tersurat jelas dalam sumber.',
    'Pertahankan gaya dasar terjemahan kitab pesantren.'
  ].join('\n'),
  enableClusterFallback: false,
  clusterStrategy: 'auto',
  defaultClusterKey: '',
  minConfidence: '0.85',
  limit: '500',
  minSamples: '8'
})

const styleClusterOptions = [
  { key: 'manaqib', label: 'Manaqib' },
  { key: 'tasawuf', label: 'Tasawuf' },
  { key: 'fiqih', label: 'Fiqih' },
  { key: 'biografi_ulama', label: 'Biografi Ulama' },
  { key: 'matan_ringkas', label: 'Matan Ringkas' }
]

const formatRate = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

export default function SettingsPage() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const [active, setActive] = useState('db')

  const [apiList, setApiList] = useState([])
  const [form, setForm] = useState(createApiForm())
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [variant, setVariant] = useState('info')

  const [kitabList, setKitabList] = useState([])
  const [glossaryList, setGlossaryList] = useState([])
  const [glossaryForm, setGlossaryForm] = useState(createGlossaryForm())
  const [glossaryQuery, setGlossaryQuery] = useState('')
  const [glossaryStatusFilter, setGlossaryStatusFilter] = useState('all')
  const [glossaryKitabFilter, setGlossaryKitabFilter] = useState('')
  const [glossarySaving, setGlossarySaving] = useState(false)
  const [glossarySeeding, setGlossarySeeding] = useState(false)
  const [glossaryNotice, setGlossaryNotice] = useState('')
  const [glossaryVariant, setGlossaryVariant] = useState('info')
  const [glossaryMetrics, setGlossaryMetrics] = useState(null)

  const [agentList, setAgentList] = useState([])
  const [agentForm, setAgentForm] = useState({ id: null, slug: '', label: '', system_prompt: '' })
  const [agentBindings, setAgentBindings] = useState([])
  const [agentCategory, setAgentCategory] = useState('translate_openai')
  const [agentSaving, setAgentSaving] = useState(false)
  const [agentNotice, setAgentNotice] = useState('')
  const [agentVariant, setAgentVariant] = useState('info')

  const [keepImagePath, setKeepImagePath] = useState('')
  const [keepImageUrl, setKeepImageUrl] = useState('')
  const [keepRunning, setKeepRunning] = useState(false)
  const [keepNotice, setKeepNotice] = useState('')
  const [keepVariant, setKeepVariant] = useState('info')
  const [driveClientId, setDriveClientId] = useState('')
  const [driveClientSecret, setDriveClientSecret] = useState('')
  const [driveAuthorized, setDriveAuthorized] = useState(false)
  const [driveLink, setDriveLink] = useState('')
  const [driveFileId, setDriveFileId] = useState('')

  const [cloudCfg, setCloudCfg] = useState({ host: '', port: '3306', user: '', password: '', database: '' })
  const [cloudMode, setCloudMode] = useState('replace')
  const [cloudTables, setCloudTables] = useState([
    'master_kitab',
    'kitab_folders',
    'kitab_terjemahan',
    'translation_versions',
    'translation_feedback',
    'semantic_embeddings',
    'source_units',
    'translation_memory',
    'translation_glossary',
    'translation_style_profiles',
    'api_settings',
    'agent_system_prompts',
    'agent_prompt_bindings',
    'ai_chat_threads',
    'ai_chat_messages'
  ])
  const [cloudSelected, setCloudSelected] = useState(new Set(cloudTables))
  const [cloudRunning, setCloudRunning] = useState(false)
  const [cloudNotice, setCloudNotice] = useState('')
  const [cloudVariant, setCloudVariant] = useState('info')
  const [cloudResult, setCloudResult] = useState(null)

  const [learningCfg, setLearningCfg] = useState({
    approvedOnly: true,
    requireExplicitApproval: false,
    includeHighQualityFallback: true,
    minConfidence: '0.80',
    limit: '5000'
  })
  const [learningExportCfg, setLearningExportCfg] = useState({
    exportVariant: 'flat',
    includeManifest: true,
    deduplicateExact: true
  })
  const [tmSemanticCfg, setTmSemanticCfg] = useState({
    mode: 'incremental',
    approvedOnly: true,
    includeHighQualityFallback: true,
    minQualityScore: '0.80',
    limit: '5000'
  })
  const [ragCorpusCfg, setRagCorpusCfg] = useState({
    idKitab: '14',
    mode: 'incremental',
    limit: '5000',
    includeOriginal: true,
    includeTranslation: true
  })
  const [semanticTuningCfg, setSemanticTuningCfg] = useState({
    tmSimilarityThreshold: '0.68',
    sourceUnitSimilarityThreshold: '0.72',
    maxTmExamples: '4',
    maxSourceUnitExamples: '3'
  })
  const [ragSearchCfg, setRagSearchCfg] = useState({
    searchSimilarityThreshold: '0.55',
    chatSimilarityThreshold: '0.70',
    candidateLimit: '400',
    topK: '50'
  })
  const [ragSearchSaving, setRagSearchSaving] = useState(false)
  const [learningRunning, setLearningRunning] = useState(false)
  const [learningNotice, setLearningNotice] = useState('')
  const [learningVariant, setLearningVariant] = useState('info')
  const [learningResult, setLearningResult] = useState(null)
  const [learningPreview, setLearningPreview] = useState(null)
  const [learningPreviewLoading, setLearningPreviewLoading] = useState(false)
  const [tmSemanticRunning, setTmSemanticRunning] = useState(false)
  const [tmSemanticNotice, setTmSemanticNotice] = useState('')
  const [tmSemanticVariant, setTmSemanticVariant] = useState('info')
  const [tmSemanticResult, setTmSemanticResult] = useState(null)
  const [ragCorpusRunning, setRagCorpusRunning] = useState(false)
  const [ragCorpusNotice, setRagCorpusNotice] = useState('')
  const [ragCorpusVariant, setRagCorpusVariant] = useState('info')
  const [ragCorpusResult, setRagCorpusResult] = useState(null)
  const [semanticTuningSaving, setSemanticTuningSaving] = useState(false)

  const [styleMemoryCfg, setStyleMemoryCfg] = useState(createStyleMemoryCfg())
  const [styleProfileList, setStyleProfileList] = useState([])
  const [styleProfilePreview, setStyleProfilePreview] = useState(null)
  const [selectedStyleKitabId, setSelectedStyleKitabId] = useState('')
  const [kitabStyleProfileList, setKitabStyleProfileList] = useState([])
  const [kitabStyleProfilePreview, setKitabStyleProfilePreview] = useState(null)
  const [selectedStyleClusterKey, setSelectedStyleClusterKey] = useState('')
  const [clusterStyleProfileList, setClusterStyleProfileList] = useState([])
  const [clusterStyleProfilePreview, setClusterStyleProfilePreview] = useState(null)
  const [styleProfileRunning, setStyleProfileRunning] = useState(false)
  const [styleProfileNotice, setStyleProfileNotice] = useState('')
  const [styleProfileVariant, setStyleProfileVariant] = useState('info')

  const loadApiList = async () => {
    if (!api || !api.listApiSettings) return
    const res = await api.listApiSettings()
    if (res && res.ok) {
      setApiList(res.data || [])
    } else {
      setApiList([])
    }
  }

  const loadKitabList = async () => {
    if (!api || !api.listKitabs) return
    const res = await api.listKitabs()
    if (res && res.ok) setKitabList(res.data || [])
    else setKitabList([])
  }

  const loadGlossaryList = async () => {
    if (!api || !api.listTranslationGlossary) return
    const onlyActive = glossaryStatusFilter === 'active' ? true : glossaryStatusFilter === 'inactive' ? false : null
    const res = await api.listTranslationGlossary({
      query: glossaryQuery,
      idKitab: glossaryKitabFilter || undefined,
      onlyActive,
      sourceLang: 'ar',
      targetLang: 'id',
      limit: 500
    })
    if (res && res.ok) setGlossaryList(res.data || [])
    else setGlossaryList([])
  }

  const loadGlossaryMetrics = async () => {
    if (!api || !api.getTranslationRuntimeMetrics) return
    const res = await api.getTranslationRuntimeMetrics({ days: 30 })
    if (res && res.ok) setGlossaryMetrics(res.data || null)
    else setGlossaryMetrics(null)
  }

  const loadAgentList = async () => {
    if (!api || !api.listAgentSystemPrompts) return
    const res = await api.listAgentSystemPrompts()
    if (res && res.ok) {
      setAgentList(res.data || [])
    } else {
      setAgentList([])
    }
  }

  const loadAgentBindings = async () => {
    if (!api || !api.listAgentPromptBindings) return
    const res = await api.listAgentPromptBindings()
    if (res && res.ok) {
      setAgentBindings(res.data || [])
    } else {
      setAgentBindings([])
    }
  }

  const loadStyleProfiles = async () => {
    if (!api || !api.listTranslationStyleProfiles) return
    const res = await api.listTranslationStyleProfiles({
      scopeType: 'global',
      scopeKey: null,
      sourceLang: 'ar',
      targetLang: 'id',
      limit: 20
    })
    if (res && res.ok) setStyleProfileList(res.data || [])
    else setStyleProfileList([])
  }

  const loadKitabStyleProfiles = async (nextKitabId = selectedStyleKitabId) => {
    if (!api || !api.listTranslationStyleProfiles) return
    if (!nextKitabId) {
      setKitabStyleProfileList([])
      return
    }
    const res = await api.listTranslationStyleProfiles({
      scopeType: 'kitab',
      scopeKey: String(nextKitabId),
      sourceLang: 'ar',
      targetLang: 'id',
      limit: 20
    })
    if (res && res.ok) setKitabStyleProfileList(res.data || [])
    else setKitabStyleProfileList([])
  }

  const loadClusterStyleProfiles = async (nextClusterKey = selectedStyleClusterKey) => {
    if (!api || !api.listTranslationStyleProfiles) return
    if (!nextClusterKey) {
      setClusterStyleProfileList([])
      return
    }
    const res = await api.listTranslationStyleProfiles({
      scopeType: 'global_cluster',
      scopeKey: String(nextClusterKey),
      sourceLang: 'ar',
      targetLang: 'id',
      limit: 20
    })
    if (res && res.ok) setClusterStyleProfileList(res.data || [])
    else setClusterStyleProfileList([])
  }

  useEffect(() => {
    if (active === 'api') loadApiList()
    if (active === 'glossary') {
      loadKitabList()
      loadGlossaryList()
      loadGlossaryMetrics()
    }
    if (active === 'agent') {
      loadAgentList()
      loadAgentBindings()
    }
    if (active === 'keep') {
      if (!api || !api.getSettings || !api.driveAuthStatus) return
      Promise.all([api.getSettings(), api.driveAuthStatus()]).then(([st, auth]) => {
        const d = st && st.driveOAuth ? st.driveOAuth : {}
        setDriveClientId(d && d.clientId ? String(d.clientId) : '')
        setDriveClientSecret(d && d.clientSecret ? String(d.clientSecret) : '')
        setDriveAuthorized(!!(auth && auth.ok && auth.authorized))
      }).catch(() => {})
    }
    if (active === 'cloud') {
      if (!api || !api.getSettings) return
      api.getSettings().then((st) => {
        const c = st && st.cloudDb ? st.cloudDb : {}
        setCloudCfg({
          host: c && c.host ? String(c.host) : '',
          port: (c && (c.port || c.port === 0)) ? String(c.port) : '3306',
          user: c && c.user ? String(c.user) : '',
          password: c && c.password ? String(c.password) : '',
          database: c && c.database ? String(c.database) : ''
        })
      }).catch(() => {})
    }
    if (active === 'learning') {
      if (!api || !api.getSettings) return
      api.getSettings().then((st) => {
        const tuning = st && st.semanticTuning ? st.semanticTuning : {}
        setSemanticTuningCfg({
          tmSimilarityThreshold: tuning && tuning.tmSimilarityThreshold != null ? String(tuning.tmSimilarityThreshold) : '0.68',
          sourceUnitSimilarityThreshold: tuning && tuning.sourceUnitSimilarityThreshold != null ? String(tuning.sourceUnitSimilarityThreshold) : '0.72',
          maxTmExamples: tuning && tuning.maxTmExamples != null ? String(tuning.maxTmExamples) : '4',
          maxSourceUnitExamples: tuning && tuning.maxSourceUnitExamples != null ? String(tuning.maxSourceUnitExamples) : '3'
        })
        const rag = st && st.ragSearch ? st.ragSearch : {}
        setRagSearchCfg({
          searchSimilarityThreshold: rag.searchSimilarityThreshold != null ? String(rag.searchSimilarityThreshold) : '0.55',
          chatSimilarityThreshold: rag.chatSimilarityThreshold != null ? String(rag.chatSimilarityThreshold) : '0.70',
          candidateLimit: rag.candidateLimit != null ? String(rag.candidateLimit) : '400',
          topK: rag.topK != null ? String(rag.topK) : '50'
        })
      }).catch(() => {})
      loadLearningPreview()
    }
    if (active === 'style-memory') {
      if (!api || !api.getSettings) return
      api.getSettings().then((st) => {
        const cfg = st && st.translationStyleMemory ? st.translationStyleMemory : {}
        setStyleMemoryCfg({
          useGlobalStyleInTranslate: typeof cfg.useGlobalStyleInTranslate === 'boolean' ? cfg.useGlobalStyleInTranslate : true,
          approvedOnly: typeof cfg.approvedOnly === 'boolean' ? cfg.approvedOnly : true,
          requireExplicitApproval: typeof cfg.requireExplicitApproval === 'boolean' ? cfg.requireExplicitApproval : true,
          includeHighQualityFallback: typeof cfg.includeHighQualityFallback === 'boolean' ? cfg.includeHighQualityFallback : false,
          useQualityWeighting: typeof cfg.useQualityWeighting === 'boolean' ? cfg.useQualityWeighting : true,
          includeRepresentativeSamples: typeof cfg.includeRepresentativeSamples === 'boolean' ? cfg.includeRepresentativeSamples : false,
          representativeSampleCount: cfg.representativeSampleCount != null ? String(cfg.representativeSampleCount) : '2',
          lockedRulesText: typeof cfg.lockedRulesText === 'string' ? cfg.lockedRulesText : createStyleMemoryCfg().lockedRulesText,
          enableClusterFallback: typeof cfg.enableClusterFallback === 'boolean' ? cfg.enableClusterFallback : false,
          clusterStrategy: cfg.clusterStrategy === 'manual' ? 'manual' : 'auto',
          defaultClusterKey: typeof cfg.defaultClusterKey === 'string' ? cfg.defaultClusterKey : '',
          minConfidence: cfg.minConfidence != null ? String(cfg.minConfidence) : '0.85',
          limit: cfg.limit != null ? String(cfg.limit) : '500',
          minSamples: cfg.minSamples != null ? String(cfg.minSamples) : '8'
        })
      }).catch(() => {})
      loadKitabList()
      loadStyleProfiles()
      loadKitabStyleProfiles('')
      loadClusterStyleProfiles('')
    }
  }, [active])

  useEffect(() => {
    if (active === 'glossary') loadGlossaryList()
  }, [active, glossaryQuery, glossaryStatusFilter, glossaryKitabFilter])

  useEffect(() => {
    if (active === 'style-memory') loadKitabStyleProfiles(selectedStyleKitabId)
  }, [active, selectedStyleKitabId])

  useEffect(() => {
    if (active === 'style-memory') loadClusterStyleProfiles(selectedStyleClusterKey)
  }, [active, selectedStyleClusterKey])

  const newApi = () => {
    setForm(createApiForm())
  }

  const newGlossary = () => {
    setGlossaryForm(createGlossaryForm())
  }

  const toggleApiCapability = (capability) => {
    setForm((prev) => {
      const current = new Set(Array.isArray(prev.capabilities) ? prev.capabilities : [])
      if (current.has(capability)) current.delete(capability)
      else current.add(capability)
      return { ...prev, capabilities: capabilityOptions.map((it) => it.id).filter((id) => current.has(id)) }
    })
  }

  const saveApi = async () => {
    if (!api || !api.saveApiSetting) return
    setSaving(true)
    const res = await api.saveApiSetting(form)
    setSaving(false)
    if (res && res.ok) {
      setVariant('success')
      setNotice(`API setting disimpan (${res.action}).`)
      await loadApiList()
      if (res.id) setForm(f => ({ ...f, id: res.id }))
    } else {
      setVariant('danger')
      setNotice(res?.error || 'Gagal menyimpan API setting.')
    }
  }

  const deleteApi = async () => {
    if (!api || !api.deleteApiSetting || !form.id) return
    const res = await api.deleteApiSetting(form.id)
    if (res && res.ok) {
      setVariant('success')
      setNotice('API setting dihapus.')
      await loadApiList()
      newApi()
    } else {
      setVariant('danger')
      setNotice(res?.error || 'Gagal menghapus API setting.')
    }
  }

  const saveGlossary = async () => {
    if (!api || !api.saveTranslationGlossary) return
    setGlossarySaving(true)
    try {
      const payload = {
        ...glossaryForm,
        id_kitab: glossaryForm.id_kitab || null,
        priority: Number(glossaryForm.priority || 100),
        isActive: !!glossaryForm.is_active
      }
      const res = await api.saveTranslationGlossary(payload)
      if (res && res.ok) {
        setGlossaryVariant('success')
        setGlossaryNotice(`Glossary disimpan (${res.action}).`)
        await loadGlossaryList()
        if (res.id) setGlossaryForm(v => ({ ...v, id: res.id }))
      } else {
        setGlossaryVariant('danger')
        setGlossaryNotice(res?.error || 'Gagal menyimpan glossary.')
      }
    } finally {
      setGlossarySaving(false)
    }
  }

  const deleteGlossary = async () => {
    if (!api || !api.deleteTranslationGlossary || !glossaryForm.id) return
    const res = await api.deleteTranslationGlossary(glossaryForm.id)
    if (res && res.ok) {
      setGlossaryVariant('success')
      setGlossaryNotice('Glossary dihapus.')
      await loadGlossaryList()
      newGlossary()
    } else {
      setGlossaryVariant('danger')
      setGlossaryNotice(res?.error || 'Gagal menghapus glossary.')
    }
  }

  const seedGlossary = async () => {
    if (!api || !api.seedTranslationGlossary) return
    setGlossarySeeding(true)
    try {
      const payload = glossaryForm.id_kitab ? { idKitab: Number(glossaryForm.id_kitab) } : {}
      const res = await api.seedTranslationGlossary(payload)
      if (res && res.ok) {
        setGlossaryVariant('success')
        setGlossaryNotice(`Seed glossary selesai. Insert: ${res.inserted || 0}, update: ${res.updated || 0}, scope: ${res.scope}.`)
        await loadGlossaryList()
      } else {
        setGlossaryVariant('danger')
        setGlossaryNotice(res?.error || 'Gagal menjalankan seed glossary.')
      }
    } finally {
      setGlossarySeeding(false)
    }
  }

  const newAgentPrompt = () => {
    setAgentForm({ id: null, slug: '', label: '', system_prompt: '' })
  }

  const saveAgentPrompt = async () => {
    if (!api || !api.saveAgentSystemPrompt) return
    setAgentSaving(true)
    try {
      const res = await api.saveAgentSystemPrompt(agentForm)
      if (res && res.ok) {
        setAgentVariant('success')
        setAgentNotice(`System prompt disimpan (${res.action}).`)
        await loadAgentList()
        await loadAgentBindings()
        if (res.id) setAgentForm(f => ({ ...f, id: res.id }))
      } else {
        setAgentVariant('danger')
        setAgentNotice(res?.error || 'Gagal menyimpan system prompt.')
      }
    } finally {
      setAgentSaving(false)
    }
  }

  const deleteAgentPrompt = async () => {
    if (!api || !api.deleteAgentSystemPrompt || !agentForm.id) return
    const res = await api.deleteAgentSystemPrompt(agentForm.id)
    if (res && res.ok) {
      setAgentVariant('success')
      setAgentNotice('System prompt dihapus.')
      await loadAgentList()
      await loadAgentBindings()
      newAgentPrompt()
    } else {
      setAgentVariant('danger')
      setAgentNotice(res?.error || 'Gagal menghapus system prompt.')
    }
  }

  const setActiveAgentPrompt = async () => {
    if (!api || !api.setAgentPromptBinding) return
    if (!agentForm.id) {
      setAgentVariant('warning')
      setAgentNotice('Pilih system prompt dulu.')
      return
    }
    const res = await api.setAgentPromptBinding({ category: agentCategory, prompt_id: agentForm.id })
    if (res && res.ok) {
      setAgentVariant('success')
      setAgentNotice(`Aktif: ${agentCategory} → #${agentForm.id}`)
      await loadAgentBindings()
    } else {
      setAgentVariant('danger')
      setAgentNotice(res?.error || 'Gagal set prompt aktif.')
    }
  }

  const pickKeepImage = async () => {
    if (!api || !api.selectImage) return
    const file = await api.selectImage()
    if (!file) return
    setKeepImagePath(file)
    setDriveLink('')
    setDriveFileId('')
    setKeepNotice('')
    try {
      const r = await api.readImageDataUrl(file)
      setKeepImageUrl(r && r.ok ? (r.dataUrl || '') : '')
    } catch (_) {
      setKeepImageUrl('')
    }
  }

  const saveDriveConfig = async () => {
    if (!api || !api.getSettings || !api.saveSettings) return
    const st = await api.getSettings()
    const cur = st && st.driveOAuth ? st.driveOAuth : {}
    const next = { ...cur, clientId: String(driveClientId || '').trim(), clientSecret: String(driveClientSecret || '').trim() }
    const res = await api.saveSettings({ driveOAuth: next })
    if (res && res.ok) {
      setKeepVariant('success')
      setKeepNotice('Drive config disimpan.')
    } else {
      setKeepVariant('danger')
      setKeepNotice(res?.error || 'Gagal menyimpan Drive config.')
    }
  }

  const driveLogin = async () => {
    if (!api || !api.driveAuth || !api.driveAuthStatus) return
    setKeepRunning(true)
    setKeepNotice('')
    try {
      const res = await api.driveAuth()
      if (res && res.ok) {
        const st = await api.driveAuthStatus()
        setDriveAuthorized(!!(st && st.ok && st.authorized))
        setKeepVariant('success')
        setKeepNotice('Login Google Drive berhasil.')
      } else {
        setKeepVariant('danger')
        setKeepNotice(res?.error || 'Login Google Drive gagal.')
      }
    } catch (e) {
      setKeepVariant('danger')
      setKeepNotice(e.message || 'Login Google Drive gagal.')
    } finally {
      setKeepRunning(false)
    }
  }

  const openKeep = async () => {
    if (!api || !api.openKeepWindow) return
    const res = await api.openKeepWindow()
    if (res && res.ok) {
      setKeepVariant('info')
      setKeepNotice('Jendela Google Keep dibuka.')
    } else {
      setKeepVariant('danger')
      setKeepNotice(res?.error || 'Gagal membuka Google Keep.')
    }
  }

  const uploadToDrive = async () => {
    if (!api || !api.driveUpload) return
    if (!keepImagePath) {
      setKeepVariant('warning')
      setKeepNotice('Pilih gambar dulu.')
      return
    }
    setKeepRunning(true)
    setKeepNotice('')
    try {
      const res = await api.driveUpload({ filePath: keepImagePath })
      if (res && res.ok) {
        setKeepVariant('success')
        setKeepNotice('Upload ke Google Drive berhasil.')
        setDriveLink(res.link || '')
        setDriveFileId(res.fileId || '')
        setDriveAuthorized(true)
      } else {
        setKeepVariant('danger')
        setKeepNotice(res?.error || 'Upload Google Drive gagal.')
      }
    } catch (e) {
      setKeepVariant('danger')
      setKeepNotice(e.message || 'Upload Google Drive gagal.')
    } finally {
      setKeepRunning(false)
    }
  }

  const createKeepNote = async () => {
    if (!api || !api.keepCreateNote) return
    if (!driveLink) {
      setKeepVariant('warning')
      setKeepNotice('Link Drive belum ada.')
      return
    }
    setKeepRunning(true)
    setKeepNotice('')
    try {
      const text = `Link gambar (Drive):\n${driveLink}`
      const res = await api.keepCreateNote({ text })
      if (res && res.ok) {
        setKeepVariant('success')
        setKeepNotice('Link disiapkan di Keep.')
      } else {
        setKeepVariant('danger')
        setKeepNotice(res?.error || 'Gagal membuat note di Keep.')
      }
    } catch (e) {
      setKeepVariant('danger')
      setKeepNotice(e.message || 'Gagal membuat note di Keep.')
    } finally {
      setKeepRunning(false)
    }
  }

  const saveCloudConfig = async () => {
    if (!api || !api.saveSettings) return
    setCloudNotice('')
    try {
      const next = {
        host: String(cloudCfg.host || '').trim(),
        port: String(cloudCfg.port || '').trim(),
        user: String(cloudCfg.user || '').trim(),
        password: String(cloudCfg.password || ''),
        database: String(cloudCfg.database || '').trim()
      }
      const res = await api.saveSettings({ cloudDb: next })
      if (res && res.ok) {
        setCloudVariant('success')
        setCloudNotice('Cloud DB config disimpan.')
      } else {
        setCloudVariant('danger')
        setCloudNotice(res?.error || 'Gagal menyimpan Cloud DB config.')
      }
    } catch (e) {
      setCloudVariant('danger')
      setCloudNotice(e.message || 'Gagal menyimpan Cloud DB config.')
    }
  }

  const testCloudConnection = async () => {
    if (!api || !api.cloudDbTest) return
    setCloudNotice('')
    setCloudRunning(true)
    try {
      const cfg = {
        host: String(cloudCfg.host || '').trim(),
        port: String(cloudCfg.port || '').trim(),
        user: String(cloudCfg.user || '').trim(),
        password: String(cloudCfg.password || ''),
        database: String(cloudCfg.database || '').trim()
      }
      const res = await api.cloudDbTest({ config: cfg })
      if (res && res.ok) {
        setCloudVariant('success')
        setCloudNotice('Koneksi Cloud DB OK.')
      } else {
        setCloudVariant('danger')
        setCloudNotice(res?.error || 'Koneksi Cloud DB gagal.')
      }
    } catch (e) {
      setCloudVariant('danger')
      setCloudNotice(e.message || 'Koneksi Cloud DB gagal.')
    } finally {
      setCloudRunning(false)
    }
  }

  const syncCloudDb = async () => {
    if (!api || !api.cloudDbSync) return
    setCloudNotice('')
    setCloudResult(null)
    setCloudRunning(true)
    try {
      const cfg = {
        host: String(cloudCfg.host || '').trim(),
        port: String(cloudCfg.port || '').trim(),
        user: String(cloudCfg.user || '').trim(),
        password: String(cloudCfg.password || ''),
        database: String(cloudCfg.database || '').trim()
      }
      const tables = Array.from(cloudSelected || []).filter(Boolean)
      const res = await api.cloudDbSync({ mode: cloudMode, tables, config: cfg })
      if (res && res.ok) {
        setCloudVariant('success')
        setCloudNotice(`Sync selesai (${res.mode}).`)
        setCloudResult(res)
      } else {
        setCloudVariant('danger')
        setCloudNotice(res?.error || 'Sync gagal.')
      }
    } catch (e) {
      setCloudVariant('danger')
      setCloudNotice(e.message || 'Sync gagal.')
    } finally {
      setCloudRunning(false)
    }
  }

  const toggleCloudTable = (t) => {
    setCloudSelected((prev) => {
      const next = new Set(prev || [])
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const buildLearningPayload = () => ({
    approvedOnly: !!learningCfg.approvedOnly,
    requireExplicitApproval: !!learningCfg.requireExplicitApproval,
    includeHighQualityFallback: !!learningCfg.includeHighQualityFallback,
    minConfidence: Number(learningCfg.minConfidence || 0.8),
    limit: Number(learningCfg.limit || 5000)
  })

  const buildLearningExportPayload = () => ({
    ...buildLearningPayload(),
    exportVariant: String(learningExportCfg.exportVariant || 'flat'),
    includeManifest: !!learningExportCfg.includeManifest,
    deduplicateExact: !!learningExportCfg.deduplicateExact
  })

  const loadLearningPreview = async () => {
    if (!api || !api.learningPreviewCandidates) return
    setLearningPreviewLoading(true)
    try {
      const res = await api.learningPreviewCandidates(buildLearningPayload())
      if (res && res.ok) setLearningPreview(res)
      else setLearningPreview(null)
    } catch (_) {
      setLearningPreview(null)
    } finally {
      setLearningPreviewLoading(false)
    }
  }

  const buildTmSemanticPayload = () => ({
    mode: String(tmSemanticCfg.mode || 'incremental'),
    approvedOnly: !!tmSemanticCfg.approvedOnly,
    includeHighQualityFallback: !!tmSemanticCfg.includeHighQualityFallback,
    minQualityScore: Number(tmSemanticCfg.minQualityScore || 0.8),
    limit: Number(tmSemanticCfg.limit || 5000)
  })

  const saveSemanticTuningConfig = async () => {
    if (!api || !api.saveSettings) return
    setSemanticTuningSaving(true)
    setTmSemanticNotice('')
    try {
      const next = {
        tmSimilarityThreshold: Number(semanticTuningCfg.tmSimilarityThreshold || 0.68),
        sourceUnitSimilarityThreshold: Number(semanticTuningCfg.sourceUnitSimilarityThreshold || 0.72),
        maxTmExamples: Number(semanticTuningCfg.maxTmExamples || 4),
        maxSourceUnitExamples: Number(semanticTuningCfg.maxSourceUnitExamples || 3)
      }
      const res = await api.saveSettings({ semanticTuning: next })
      if (res && res.ok) {
        setTmSemanticVariant('success')
        setTmSemanticNotice('Semantic tuning disimpan.')
      } else {
        setTmSemanticVariant('danger')
        setTmSemanticNotice(res?.error || 'Gagal menyimpan semantic tuning.')
      }
    } catch (e) {
      setTmSemanticVariant('danger')
      setTmSemanticNotice(e.message || 'Gagal menyimpan semantic tuning.')
    } finally {
      setSemanticTuningSaving(false)
    }
  }

  const saveRagSearchConfig = async () => {
    if (!api || !api.saveSettings) return
    setRagSearchSaving(true)
    setRagCorpusNotice('')
    try {
      const next = {
        searchSimilarityThreshold: Number(ragSearchCfg.searchSimilarityThreshold || 0.55),
        chatSimilarityThreshold: Number(ragSearchCfg.chatSimilarityThreshold || 0.7),
        candidateLimit: Number(ragSearchCfg.candidateLimit || 400),
        topK: Number(ragSearchCfg.topK || 50)
      }
      const res = await api.saveSettings({ ragSearch: next })
      if (res && res.ok) {
        setRagCorpusVariant('success')
        setRagCorpusNotice('RAG Search threshold disimpan (terpisah dari TM semantic).')
      } else {
        setRagCorpusVariant('danger')
        setRagCorpusNotice(res?.error || 'Gagal menyimpan RAG Search settings.')
      }
    } catch (e) {
      setRagCorpusVariant('danger')
      setRagCorpusNotice(e.message || 'Gagal menyimpan RAG Search settings.')
    } finally {
      setRagSearchSaving(false)
    }
  }

  const reindexSemanticTranslationMemory = async () => {
    if (!api || !api.semanticReindexTranslationMemory) return
    setTmSemanticRunning(true)
    setTmSemanticNotice('')
    setTmSemanticResult(null)
    try {
      const res = await api.semanticReindexTranslationMemory(buildTmSemanticPayload())
      if (res && res.ok) {
        setTmSemanticVariant('success')
        setTmSemanticNotice(`Reindex semantic TM selesai. Indexed: ${res.indexedCount || 0}, skipped: ${res.skippedCount || 0}, failed: ${res.failedCount || 0}.`)
        setTmSemanticResult(res)
      } else {
        setTmSemanticVariant('danger')
        setTmSemanticNotice(res?.error || 'Reindex semantic TM gagal.')
      }
    } catch (e) {
      setTmSemanticVariant('danger')
      setTmSemanticNotice(e.message || 'Reindex semantic TM gagal.')
    } finally {
      setTmSemanticRunning(false)
    }
  }

  const buildRagCorpusPayload = () => ({
    idKitab: Number(ragCorpusCfg.idKitab || 0) || null,
    mode: String(ragCorpusCfg.mode || 'incremental'),
    limit: Number(ragCorpusCfg.limit || 5000),
    includeOriginal: !!ragCorpusCfg.includeOriginal,
    includeTranslation: !!ragCorpusCfg.includeTranslation
  })

  const reindexRagCorpus = async () => {
    if (!api || !api.ragReindexCorpus) return
    setRagCorpusRunning(true)
    setRagCorpusNotice('')
    setRagCorpusResult(null)
    try {
      const res = await api.ragReindexCorpus(buildRagCorpusPayload())
      if (res && res.ok) {
        setRagCorpusVariant('success')
        setRagCorpusNotice(
          `Reindex RAG corpus selesai. Created: ${res.createdCount || 0}, embedded: ${res.embeddedCount || 0}, skipped: ${res.skippedCount || 0}, failed: ${res.failedCount || 0}.`
        )
        setRagCorpusResult(res)
      } else {
        setRagCorpusVariant('danger')
        setRagCorpusNotice(res?.error || 'Reindex RAG corpus gagal.')
      }
    } catch (e) {
      setRagCorpusVariant('danger')
      setRagCorpusNotice(e.message || 'Reindex RAG corpus gagal.')
    } finally {
      setRagCorpusRunning(false)
    }
  }

  const refreshLearningSemantic = async () => {
    if (!api || !api.learningRefreshSemantic) return
    setLearningRunning(true)
    setLearningNotice('')
    setLearningResult(null)
    try {
      const res = await api.learningRefreshSemantic(buildLearningPayload())
      if (res && res.ok) {
        setLearningVariant('success')
        setLearningNotice(`Refresh semantic index selesai. Indexed: ${res.indexedCount || 0} dari ${res.candidateCount || 0} kandidat.`)
        setLearningResult(res)
        loadLearningPreview()
      } else {
        setLearningVariant('danger')
        setLearningNotice(res?.error || 'Refresh semantic index gagal.')
      }
    } catch (e) {
      setLearningVariant('danger')
      setLearningNotice(e.message || 'Refresh semantic index gagal.')
    } finally {
      setLearningRunning(false)
    }
  }

  const exportLearningJsonl = async () => {
    if (!api || !api.learningExportJsonl) return
    setLearningRunning(true)
    setLearningNotice('')
    setLearningResult(null)
    try {
      const exportPayload = buildLearningExportPayload()
      const res = await api.learningExportJsonl(exportPayload)
      if (res && res.ok) {
        setLearningVariant('success')
        setLearningNotice(`Export JSONL selesai. ${res.count || 0} baris ditulis ke file.`)
        setLearningResult(res)
        loadLearningPreview()
      } else if (res?.cancelled) {
        setLearningVariant('warning')
        setLearningNotice('Export JSONL dibatalkan.')
      } else {
        setLearningVariant('danger')
        setLearningNotice(res?.error || 'Export JSONL gagal.')
      }
    } catch (e) {
      setLearningVariant('danger')
      setLearningNotice(e.message || 'Export JSONL gagal.')
    } finally {
      setLearningRunning(false)
    }
  }

  const buildStyleMemoryPayload = () => ({
    useGlobalStyleInTranslate: !!styleMemoryCfg.useGlobalStyleInTranslate,
    approvedOnly: !!styleMemoryCfg.approvedOnly,
    requireExplicitApproval: !!styleMemoryCfg.requireExplicitApproval,
    includeHighQualityFallback: !!styleMemoryCfg.includeHighQualityFallback,
    useQualityWeighting: !!styleMemoryCfg.useQualityWeighting,
    includeRepresentativeSamples: !!styleMemoryCfg.includeRepresentativeSamples,
    representativeSampleCount: Number(styleMemoryCfg.representativeSampleCount || 2),
    lockedRulesText: styleMemoryCfg.lockedRulesText || '',
    enableClusterFallback: !!styleMemoryCfg.enableClusterFallback,
    clusterStrategy: styleMemoryCfg.clusterStrategy === 'manual' ? 'manual' : 'auto',
    defaultClusterKey: styleMemoryCfg.defaultClusterKey || '',
    minConfidence: Number(styleMemoryCfg.minConfidence || 0.85),
    limit: Number(styleMemoryCfg.limit || 500),
    minSamples: Number(styleMemoryCfg.minSamples || 8)
  })

  const selectedStyleKitab = kitabList.find((item) => String(item.id) === String(selectedStyleKitabId || ''))
  const selectedStyleCluster = styleClusterOptions.find((item) => item.key === selectedStyleClusterKey)

  const saveStyleMemoryConfig = async () => {
    if (!api || !api.saveSettings) return
    setStyleProfileNotice('')
    try {
      const res = await api.saveSettings({ translationStyleMemory: buildStyleMemoryPayload() })
      if (res && res.ok) {
        setStyleProfileVariant('success')
        setStyleProfileNotice('Konfigurasi style memory disimpan.')
      } else {
        setStyleProfileVariant('danger')
        setStyleProfileNotice(res?.error || 'Gagal menyimpan konfigurasi style memory.')
      }
    } catch (e) {
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Gagal menyimpan konfigurasi style memory.')
    }
  }

  const previewStyleProfile = async () => {
    if (!api || !api.previewGlobalStyleProfile) return
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.previewGlobalStyleProfile(buildStyleMemoryPayload())
      if (res && res.ok) {
        setStyleProfilePreview(res.draft || null)
        setStyleProfileVariant('info')
        setStyleProfileNotice('Draft profile berhasil dibuat untuk preview.')
      } else {
        setStyleProfilePreview(null)
        setStyleProfileVariant('warning')
        setStyleProfileNotice(res?.error || 'Preview profile gagal.')
      }
    } catch (e) {
      setStyleProfilePreview(null)
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Preview profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const rebuildStyleProfile = async () => {
    if (!api || !api.rebuildGlobalStyleProfile) return
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.rebuildGlobalStyleProfile(buildStyleMemoryPayload())
      if (res && res.ok) {
        setStyleProfilePreview(res.draft || null)
        setStyleProfileVariant('success')
        setStyleProfileNotice(`Draft version baru disimpan${res.profile?.version_number ? ` (v${res.profile.version_number})` : ''}. Aktivasi masih manual.`)
        await loadStyleProfiles()
      } else {
        setStyleProfileVariant('warning')
        setStyleProfileNotice(res?.error || 'Rebuild profile gagal.')
      }
    } catch (e) {
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Rebuild profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const previewKitabStyleProfile = async () => {
    if (!api || !api.previewKitabStyleProfile) return
    if (!selectedStyleKitabId) {
      setStyleProfileVariant('warning')
      setStyleProfileNotice('Pilih kitab dulu untuk preview profile kitab.')
      return
    }
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.previewKitabStyleProfile({
        ...buildStyleMemoryPayload(),
        idKitab: Number(selectedStyleKitabId)
      })
      if (res && res.ok) {
        setKitabStyleProfilePreview(res.draft || null)
        setStyleProfileVariant('info')
        setStyleProfileNotice('Draft kitab profile berhasil dibuat untuk preview.')
      } else {
        setKitabStyleProfilePreview(null)
        setStyleProfileVariant('warning')
        setStyleProfileNotice(res?.error || 'Preview kitab profile gagal.')
      }
    } catch (e) {
      setKitabStyleProfilePreview(null)
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Preview kitab profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const rebuildKitabStyleProfile = async () => {
    if (!api || !api.rebuildKitabStyleProfile) return
    if (!selectedStyleKitabId) {
      setStyleProfileVariant('warning')
      setStyleProfileNotice('Pilih kitab dulu untuk rebuild profile kitab.')
      return
    }
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.rebuildKitabStyleProfile({
        ...buildStyleMemoryPayload(),
        idKitab: Number(selectedStyleKitabId)
      })
      if (res && res.ok) {
        setKitabStyleProfilePreview(res.draft || null)
        setStyleProfileVariant('success')
        setStyleProfileNotice(`Draft kitab version baru disimpan${res.profile?.version_number ? ` (v${res.profile.version_number})` : ''}. Aktivasi masih manual.`)
        await loadKitabStyleProfiles(selectedStyleKitabId)
      } else {
        setStyleProfileVariant('warning')
        setStyleProfileNotice(res?.error || 'Rebuild kitab profile gagal.')
      }
    } catch (e) {
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Rebuild kitab profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const previewClusterStyleProfile = async () => {
    if (!api || !api.previewClusterStyleProfile) return
    if (!selectedStyleClusterKey) {
      setStyleProfileVariant('warning')
      setStyleProfileNotice('Pilih cluster dulu untuk preview profile cluster.')
      return
    }
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.previewClusterStyleProfile({
        ...buildStyleMemoryPayload(),
        clusterKey: selectedStyleClusterKey
      })
      if (res && res.ok) {
        setClusterStyleProfilePreview(res.draft || null)
        setStyleProfileVariant('info')
        setStyleProfileNotice('Draft cluster profile berhasil dibuat untuk preview.')
      } else {
        setClusterStyleProfilePreview(null)
        setStyleProfileVariant('warning')
        setStyleProfileNotice(res?.error || 'Preview cluster profile gagal.')
      }
    } catch (e) {
      setClusterStyleProfilePreview(null)
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Preview cluster profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const rebuildClusterStyleProfile = async () => {
    if (!api || !api.rebuildClusterStyleProfile) return
    if (!selectedStyleClusterKey) {
      setStyleProfileVariant('warning')
      setStyleProfileNotice('Pilih cluster dulu untuk rebuild profile cluster.')
      return
    }
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.rebuildClusterStyleProfile({
        ...buildStyleMemoryPayload(),
        clusterKey: selectedStyleClusterKey
      })
      if (res && res.ok) {
        setClusterStyleProfilePreview(res.draft || null)
        setStyleProfileVariant('success')
        setStyleProfileNotice(`Draft cluster version baru disimpan${res.profile?.version_number ? ` (v${res.profile.version_number})` : ''}. Aktivasi masih manual.`)
        await loadClusterStyleProfiles(selectedStyleClusterKey)
      } else {
        setStyleProfileVariant('warning')
        setStyleProfileNotice(res?.error || 'Rebuild cluster profile gagal.')
      }
    } catch (e) {
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Rebuild cluster profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const activateStyleProfileVersion = async (profileId) => {
    if (!api || !api.activateTranslationStyleProfile) return
    setStyleProfileRunning(true)
    setStyleProfileNotice('')
    try {
      const res = await api.activateTranslationStyleProfile(profileId)
      if (res && res.ok) {
        setStyleProfileVariant('success')
        setStyleProfileNotice(`Profile aktif diganti ke v${res.data?.version_number || profileId}.`)
        await loadStyleProfiles()
        if (res?.data?.scope_type === 'kitab' && res?.data?.scope_key) {
          await loadKitabStyleProfiles(res.data.scope_key)
        }
        if (res?.data?.scope_type === 'global_cluster' && res?.data?.scope_key) {
          await loadClusterStyleProfiles(res.data.scope_key)
        }
      } else {
        setStyleProfileVariant('danger')
        setStyleProfileNotice(res?.error || 'Aktivasi profile gagal.')
      }
    } catch (e) {
      setStyleProfileVariant('danger')
      setStyleProfileNotice(e.message || 'Aktivasi profile gagal.')
    } finally {
      setStyleProfileRunning(false)
    }
  }

  const categories = [
    { id: 'translate_openai', label: 'Translate OpenAI' },
    { id: 'translate_gemini', label: 'Translate Gemini' },
    { id: 'ocr_openai', label: 'OCR OpenAI' },
    { id: 'ai_chat', label: 'AI Chat' }
  ]

  return (
    <Row className="g-3">
      <Col md={3}>
        <div className="h5 mb-3">Settings</div>
        <ListGroup>
          <ListGroup.Item action active={active === 'db'} onClick={() => setActive('db')}>
            <i className="bi bi-database me-2" /> Database Settings
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'api'} onClick={() => setActive('api')}>
            <i className="bi bi-key me-2" /> API Setting
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'glossary'} onClick={() => setActive('glossary')}>
            <i className="bi bi-journal-text me-2" /> Glossary
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'agent'} onClick={() => setActive('agent')}>
            <i className="bi bi-robot me-2" /> Agent AI Setting
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'keep'} onClick={() => setActive('keep')}>
            <i className="bi bi-image me-2" /> Drive → Keep
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'cloud'} onClick={() => setActive('cloud')}>
            <i className="bi bi-cloud-arrow-up me-2" /> Cloud Sync
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'learning'} onClick={() => setActive('learning')}>
            <i className="bi bi-mortarboard me-2" /> Learning
          </ListGroup.Item>
          <ListGroup.Item action active={active === 'style-memory'} onClick={() => setActive('style-memory')}>
            <i className="bi bi-bezier2 me-2" /> Style Memory
          </ListGroup.Item>
        </ListGroup>
      </Col>
      <Col md={9}>
        {active === 'db' && (
          <DBSettingsPage />
        )}
        {active === 'api' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">API Setting</div>
            {notice && <Alert variant={variant}>{notice}</Alert>}
            <div>
              <div className="text-muted small mb-2">Daftar API</div>
              <ListGroup>
                {apiList.map((it) => (
                  <ListGroup.Item key={it.id} action onClick={() => setForm(mapApiToForm(it))}>
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <div className="fw-semibold">{it.name || '(tanpa nama)'} - {it.provider || '-'}</div>
                        <div className="text-muted small">
                          Status: {it.status || 'active'} | Model: {it.model_default || '-'} | Capability: {(it.capabilities || []).join(', ') || '-'}
                        </div>
                      </div>
                      <div className="text-muted small">#{it.id}</div>
                    </div>
                  </ListGroup.Item>
                ))}
                {apiList.length === 0 && (
                  <ListGroup.Item className="text-muted">Belum ada API setting.</ListGroup.Item>
                )}
              </ListGroup>
              <div className="d-flex justify-content-end mt-2">
                <Button variant="outline-secondary" size="sm" onClick={newApi}><i className="bi bi-plus-lg me-2" /> Baru</Button>
              </div>
            </div>

            <Form>
              <Row className="g-3">
                <Col md={6}>
                  <Form.Label>Nama</Form.Label>
                  <Form.Control value={form.name} onChange={(e) => setForm(v => ({ ...v, name: e.target.value }))} />
                </Col>
                <Col md={6}>
                  <Form.Label>Provider</Form.Label>
                  <Form.Control value={form.provider} onChange={(e) => setForm(v => ({ ...v, provider: e.target.value }))} />
                </Col>
                <Col md={12}>
                  <Form.Label>API Key</Form.Label>
                  <InputGroup>
                    <Form.Control type="text" value={form.api_key} onChange={(e) => setForm(v => ({ ...v, api_key: e.target.value }))} />
                  </InputGroup>
                </Col>
                <Col md={6}>
                  <Form.Label>Base URL</Form.Label>
                  <Form.Control value={form.base_url} onChange={(e) => setForm(v => ({ ...v, base_url: e.target.value }))} placeholder="Opsional" />
                </Col>
                <Col md={6}>
                  <Form.Label>Default Model</Form.Label>
                  <Form.Control value={form.model_default} onChange={(e) => setForm(v => ({ ...v, model_default: e.target.value }))} placeholder="Contoh: gpt-4o-mini" />
                </Col>
                <Col md={6}>
                  <Form.Label>Status</Form.Label>
                  <Form.Select value={form.status} onChange={(e) => setForm(v => ({ ...v, status: e.target.value }))}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </Form.Select>
                </Col>
                <Col md={6}>
                  <Form.Label>Priority Order</Form.Label>
                  <Form.Control value={form.priority_order} onChange={(e) => setForm(v => ({ ...v, priority_order: e.target.value }))} placeholder="Opsional, angka kecil lebih prioritas" />
                </Col>
                <Col md={12}>
                  <Form.Label>Capability</Form.Label>
                  <div className="d-flex flex-wrap gap-3">
                    {capabilityOptions.map((item) => (
                      <Form.Check
                        key={item.id}
                        type="checkbox"
                        id={`api-capability-${item.id}`}
                        label={item.label}
                        checked={form.capabilities.includes(item.id)}
                        onChange={() => toggleApiCapability(item.id)}
                      />
                    ))}
                  </div>
                </Col>
                <Col md={12}>
                  <Form.Label>Metadata JSON</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={6}
                    value={form.meta_json}
                    onChange={(e) => setForm(v => ({ ...v, meta_json: e.target.value }))}
                    placeholder='Contoh: {"supports_model_override": true}'
                  />
                </Col>
              </Row>
              <div className="d-flex justify-content-end mt-3 gap-2">
                <Button variant="danger" size="sm" onClick={deleteApi} disabled={!form.id}>Delete</Button>
                <Button variant="primary" size="sm" onClick={saveApi} disabled={saving}>Save</Button>
              </div>
            </Form>
          </div>
        )}
        {active === 'glossary' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">Translation Glossary</div>
            {glossaryNotice && <Alert variant={glossaryVariant}>{glossaryNotice}</Alert>}

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Metrik 30 Hari</div>
              {glossaryMetrics?.totals ? (
                <>
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Badge bg="secondary">Request: {glossaryMetrics.totals.total_translate_requests || 0}</Badge>
                    <Badge bg="success">Exact Hit: {glossaryMetrics.totals.exact_hit_count || 0}</Badge>
                    <Badge bg="info">TM Reuse: {glossaryMetrics.totals.tm_reuse_count || 0}</Badge>
                    <Badge bg="primary">AI Generation: {glossaryMetrics.totals.ai_generation_count || 0}</Badge>
                  </div>
                  <div className="text-muted small">
                    `exact_hit_rate`: {formatRate(glossaryMetrics.totals.exact_hit_rate)} | `tm_reuse_rate`: {formatRate(glossaryMetrics.totals.tm_reuse_rate)}
                  </div>
                </>
              ) : (
                <div className="text-muted small">Belum ada data metrik translate.</div>
              )}
            </div>

            <div className="border rounded-3 p-3">
              <Row className="g-3 align-items-end">
                <Col md={5}>
                  <Form.Label>Cari Glossary</Form.Label>
                  <Form.Control value={glossaryQuery} onChange={(e) => setGlossaryQuery(e.target.value)} placeholder="Arab, Indonesia, catatan, atau nama kitab" />
                </Col>
                <Col md={3}>
                  <Form.Label>Status</Form.Label>
                  <Form.Select value={glossaryStatusFilter} onChange={(e) => setGlossaryStatusFilter(e.target.value)}>
                    <option value="all">Semua</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Form.Select>
                </Col>
                <Col md={4}>
                  <Form.Label>Filter Kitab</Form.Label>
                  <Form.Select value={glossaryKitabFilter} onChange={(e) => setGlossaryKitabFilter(e.target.value)}>
                    <option value="">Semua Scope</option>
                    <option value="__global__" disabled>Global entries tampil bila scope kosong</option>
                    {kitabList.map((kitab) => (
                      <option key={kitab.id} value={String(kitab.id)}>{kitab.nama_kitab}</option>
                    ))}
                  </Form.Select>
                </Col>
              </Row>
            </div>

            <Row className="g-3">
              <Col md={5}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="fw-semibold">Daftar Istilah</div>
                    <div className="d-flex gap-2">
                      <Button variant="outline-secondary" size="sm" onClick={newGlossary}>Baru</Button>
                      <Button variant="outline-primary" size="sm" onClick={seedGlossary} disabled={glossarySeeding}>
                        {glossarySeeding ? 'Seeding...' : 'Seed Awal'}
                      </Button>
                    </div>
                  </div>
                  <ListGroup style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    {glossaryList.map((item) => (
                      <ListGroup.Item key={item.id} action onClick={() => setGlossaryForm(mapGlossaryToForm(item))}>
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div>
                            <div className="fw-semibold" style={{ direction: 'rtl', textAlign: 'right' }}>{item.source_term}</div>
                            <div>{item.target_term}</div>
                            <div className="text-muted small">
                              Scope: {item.kitab_name || 'Global'} | Priority: {item.priority}
                            </div>
                          </div>
                          <Badge bg={Number(item.is_active || 0) === 1 ? 'success' : 'secondary'}>
                            {Number(item.is_active || 0) === 1 ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </ListGroup.Item>
                    ))}
                    {glossaryList.length === 0 && (
                      <ListGroup.Item className="text-muted">Belum ada data glossary.</ListGroup.Item>
                    )}
                  </ListGroup>
                </div>
              </Col>

              <Col md={7}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="fw-semibold mb-3">Editor Glossary</div>
                  <Form>
                    <Row className="g-3">
                      <Col md={6}>
                        <Form.Label>Scope Kitab</Form.Label>
                        <Form.Select value={glossaryForm.id_kitab} onChange={(e) => setGlossaryForm(v => ({ ...v, id_kitab: e.target.value }))}>
                          <option value="">Global</option>
                          {kitabList.map((kitab) => (
                            <option key={kitab.id} value={String(kitab.id)}>{kitab.nama_kitab}</option>
                          ))}
                        </Form.Select>
                      </Col>
                      <Col md={3}>
                        <Form.Label>Source Lang</Form.Label>
                        <Form.Control value={glossaryForm.source_lang} onChange={(e) => setGlossaryForm(v => ({ ...v, source_lang: e.target.value }))} />
                      </Col>
                      <Col md={3}>
                        <Form.Label>Target Lang</Form.Label>
                        <Form.Control value={glossaryForm.target_lang} onChange={(e) => setGlossaryForm(v => ({ ...v, target_lang: e.target.value }))} />
                      </Col>
                      <Col md={6}>
                        <Form.Label>Istilah Sumber</Form.Label>
                        <Form.Control value={glossaryForm.source_term} onChange={(e) => setGlossaryForm(v => ({ ...v, source_term: e.target.value }))} style={{ direction: 'rtl' }} />
                      </Col>
                      <Col md={6}>
                        <Form.Label>Istilah Target</Form.Label>
                        <Form.Control value={glossaryForm.target_term} onChange={(e) => setGlossaryForm(v => ({ ...v, target_term: e.target.value }))} />
                      </Col>
                      <Col md={4}>
                        <Form.Label>Priority</Form.Label>
                        <Form.Control value={glossaryForm.priority} onChange={(e) => setGlossaryForm(v => ({ ...v, priority: e.target.value }))} />
                      </Col>
                      <Col md={8} className="d-flex align-items-end">
                        <Form.Check
                          type="switch"
                          id="glossary-active-switch"
                          label="Istilah aktif"
                          checked={glossaryForm.is_active}
                          onChange={(e) => setGlossaryForm(v => ({ ...v, is_active: e.target.checked }))}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Label>Catatan</Form.Label>
                        <Form.Control as="textarea" rows={5} value={glossaryForm.notes} onChange={(e) => setGlossaryForm(v => ({ ...v, notes: e.target.value }))} placeholder="Kapan istilah ini diprioritaskan, padanan alternatif, catatan pesantren, dll" />
                      </Col>
                    </Row>
                    <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
                      <div className="text-muted small">
                        Seed awal mengikuti scope editor saat ini: `Global` bila kosong, atau kitab terpilih bila ada.
                      </div>
                      <div className="d-flex gap-2">
                        <Button variant="danger" size="sm" onClick={deleteGlossary} disabled={!glossaryForm.id}>Delete</Button>
                        <Button variant="primary" size="sm" onClick={saveGlossary} disabled={glossarySaving}>Save</Button>
                      </div>
                    </div>
                  </Form>
                </div>
              </Col>
            </Row>

            {glossaryMetrics?.daily?.length ? (
              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Ringkasan Harian</div>
                <Table size="sm" responsive className="mb-0">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Request</th>
                      <th>Exact</th>
                      <th>TM Reuse</th>
                      <th>AI</th>
                      <th>Exact Rate</th>
                      <th>TM Reuse Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glossaryMetrics.daily.slice(0, 10).map((row) => (
                      <tr key={String(row.metric_date)}>
                        <td>{String(row.metric_date).slice(0, 10)}</td>
                        <td>{row.total_translate_requests}</td>
                        <td>{row.exact_hit_count}</td>
                        <td>{row.tm_reuse_count}</td>
                        <td>{row.ai_generation_count}</td>
                        <td>{formatRate(row.exact_hit_rate)}</td>
                        <td>{formatRate(row.tm_reuse_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : null}
          </div>
        )}
        {active === 'agent' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">Agent AI Setting</div>
            {agentNotice && <Alert variant={agentVariant}>{agentNotice}</Alert>}
            <div>
              <div className="text-muted small mb-2">Daftar System Prompt</div>
              <ListGroup>
                {agentList.map((it) => (
                  <ListGroup.Item
                    key={it.id}
                    action
                    onClick={() => setAgentForm({ id: it.id, slug: it.slug || '', label: it.label || '', system_prompt: it.system_prompt || '' })}
                  >
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <div className="fw-semibold">{it.label || '(tanpa label)'}</div>
                        <div className="text-muted small" style={{ whiteSpace: 'pre-wrap' }}>
                          {(it.system_prompt || '').slice(0, 140)}{(it.system_prompt || '').length > 140 ? '…' : ''}
                        </div>
                      </div>
                      <div className="text-muted small">#{it.id}</div>
                    </div>
                  </ListGroup.Item>
                ))}
                {agentList.length === 0 && (
                  <ListGroup.Item className="text-muted">Belum ada system prompt.</ListGroup.Item>
                )}
              </ListGroup>
              <div className="d-flex justify-content-end mt-2">
                <Button variant="outline-secondary" size="sm" onClick={newAgentPrompt}><i className="bi bi-plus-lg me-2" /> Baru</Button>
              </div>
            </div>

            <Form>
              <Row className="g-3">
                <Col md={12}>
                  <Form.Label>Aktif untuk</Form.Label>
                  <InputGroup>
                    <Form.Select value={agentCategory} onChange={(e) => setAgentCategory(e.target.value)}>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </Form.Select>
                    <Button variant="outline-primary" onClick={setActiveAgentPrompt} disabled={!agentForm.id || agentSaving}>
                      Set Active
                    </Button>
                  </InputGroup>
                  <div className="text-muted small mt-1">
                    Aktif sekarang: {(agentBindings.find(b => b.category === agentCategory)?.prompt_id) ? `#${agentBindings.find(b => b.category === agentCategory)?.prompt_id}` : '-'}
                  </div>
                </Col>
                <Col md={12}>
                  <Form.Label>Slug (opsional)</Form.Label>
                  <Form.Control value={agentForm.slug} onChange={(e) => setAgentForm(v => ({ ...v, slug: e.target.value }))} />
                </Col>
                <Col md={12}>
                  <Form.Label>Label</Form.Label>
                  <Form.Control value={agentForm.label} onChange={(e) => setAgentForm(v => ({ ...v, label: e.target.value }))} />
                </Col>
                <Col md={12}>
                  <Form.Label>System Prompt</Form.Label>
                  <Form.Control as="textarea" rows={14} value={agentForm.system_prompt} onChange={(e) => setAgentForm(v => ({ ...v, system_prompt: e.target.value }))} />
                </Col>
              </Row>
              <div className="d-flex justify-content-end mt-3 gap-2">
                <Button variant="danger" size="sm" onClick={deleteAgentPrompt} disabled={!agentForm.id}>Delete</Button>
                <Button variant="primary" size="sm" onClick={saveAgentPrompt} disabled={agentSaving}>Save</Button>
              </div>
            </Form>
          </div>
        )}
        {active === 'keep' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">Google Drive → Keep (Eksperimental)</div>
            {keepNotice && <Alert variant={keepVariant}>{keepNotice}</Alert>}

            <Form>
              <Row className="g-3">
                <Col md={12}>
                  <Form.Label>File gambar</Form.Label>
                  <InputGroup>
                    <Form.Control value={keepImagePath} onChange={(e) => setKeepImagePath(e.target.value)} placeholder="Pilih gambar" />
                    <Button variant="secondary" onClick={pickKeepImage} disabled={!api}>Browse</Button>
                  </InputGroup>
                </Col>

                <Col md={12}>
                  <Form.Label>Google Drive OAuth</Form.Label>
                  <Row className="g-2">
                    <Col md={6}>
                      <Form.Control value={driveClientId} onChange={(e) => setDriveClientId(e.target.value)} placeholder="Client ID" />
                    </Col>
                    <Col md={6}>
                      <Form.Control value={driveClientSecret} onChange={(e) => setDriveClientSecret(e.target.value)} placeholder="Client Secret" />
                    </Col>
                  </Row>
                  <div className="d-flex gap-2 flex-wrap mt-2">
                    <Button variant="outline-secondary" onClick={saveDriveConfig} disabled={!api || keepRunning}>Save Config</Button>
                    <Button variant="outline-primary" onClick={driveLogin} disabled={!api || keepRunning || !driveClientId || !driveClientSecret}>
                      {driveAuthorized ? 'Re-Login Drive' : 'Login Drive'}
                    </Button>
                  </div>
                  <div className="text-muted small mt-1">Butuh OAuth Client (Desktop). Scope: drive.file.</div>
                </Col>

                <Col md={12}>
                  <div className="d-flex gap-2 flex-wrap">
                    <Button variant="primary" onClick={uploadToDrive} disabled={!api || keepRunning || !keepImagePath}>
                      {keepRunning ? 'Running...' : 'Upload ke Drive + Link'}
                    </Button>
                    <Button variant="outline-secondary" onClick={() => { api && api.copyToClipboard && api.copyToClipboard(driveLink) }} disabled={!api || !driveLink}>Copy Link</Button>
                    <Button variant="outline-primary" onClick={openKeep} disabled={!api || keepRunning}><i className="bi bi-box-arrow-up-right me-2" /> Buka Google Keep</Button>
                    <Button variant="outline-success" onClick={createKeepNote} disabled={!api || keepRunning || !driveLink}>Simpan Link ke Keep</Button>
                  </div>
                </Col>

                <Col md={12}>
                  <Form.Label>Link Drive</Form.Label>
                  <Form.Control value={driveLink} readOnly />
                  <div className="text-muted small mt-1">File ID: {driveFileId || '-'}</div>
                </Col>

                {keepImageUrl && (
                  <Col md={12}>
                    <div className="border rounded-3 p-2" style={{ maxHeight: 240, overflow: 'auto' }}>
                      <img src={keepImageUrl} alt="preview" style={{ maxWidth: '100%' }} />
                    </div>
                  </Col>
                )}
              </Row>
            </Form>
          </div>
        )}
        {active === 'cloud' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">Cloud Sync</div>
            {cloudNotice && <Alert variant={cloudVariant}>{cloudNotice}</Alert>}

            <Form>
              <Row className="g-3">
                <Col md={6}>
                  <Form.Label>Host</Form.Label>
                  <Form.Control value={cloudCfg.host} onChange={(e) => setCloudCfg(v => ({ ...v, host: e.target.value }))} placeholder="contoh: 127.0.0.1 / db.example.com" />
                </Col>
                <Col md={6}>
                  <Form.Label>Port</Form.Label>
                  <Form.Control value={cloudCfg.port} onChange={(e) => setCloudCfg(v => ({ ...v, port: e.target.value }))} placeholder="3306" />
                </Col>
                <Col md={6}>
                  <Form.Label>User</Form.Label>
                  <Form.Control value={cloudCfg.user} onChange={(e) => setCloudCfg(v => ({ ...v, user: e.target.value }))} />
                </Col>
                <Col md={6}>
                  <Form.Label>Password</Form.Label>
                  <InputGroup>
                    <Form.Control type="password" value={cloudCfg.password} onChange={(e) => setCloudCfg(v => ({ ...v, password: e.target.value }))} />
                  </InputGroup>
                </Col>
                <Col md={12}>
                  <Form.Label>Database</Form.Label>
                  <Form.Control value={cloudCfg.database} onChange={(e) => setCloudCfg(v => ({ ...v, database: e.target.value }))} />
                </Col>
              </Row>
              <div className="d-flex justify-content-end gap-2 mt-3 flex-wrap">
                <Button variant="outline-secondary" onClick={testCloudConnection} disabled={!api || cloudRunning}>Test Connection</Button>
                <Button variant="primary" onClick={saveCloudConfig} disabled={!api || cloudRunning}>Save Config</Button>
              </div>
            </Form>

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Mode Sync</div>
              <div className="d-flex gap-3 flex-wrap">
                <Form.Check
                  type="radio"
                  name="cloudMode"
                  id="cloudModeReplace"
                  label="Full Replace"
                  checked={cloudMode === 'replace'}
                  onChange={() => setCloudMode('replace')}
                />
                <Form.Check
                  type="radio"
                  name="cloudMode"
                  id="cloudModeUpdate"
                  label="Update (Upsert)"
                  checked={cloudMode === 'update'}
                  onChange={() => setCloudMode('update')}
                />
              </div>
              <div className="text-muted small mt-2">
                Full Replace: cloud table dipastikan ada, lalu di-truncate dan diisi ulang dari local. Update: insert/update berdasarkan key unik/primary key.
              </div>
            </div>

            <div className="border rounded-3 p-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">Pilih Table</div>
                <div className="d-flex gap-2">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setCloudSelected(new Set(cloudTables))}
                    disabled={cloudRunning}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setCloudSelected(new Set())}
                    disabled={cloudRunning}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="d-flex flex-wrap gap-3">
                {cloudTables.map((t) => (
                  <Form.Check
                    key={t}
                    type="checkbox"
                    id={`cloudtbl_${t}`}
                    label={t}
                    checked={cloudSelected && cloudSelected.has(t)}
                    onChange={() => toggleCloudTable(t)}
                    disabled={cloudRunning}
                  />
                ))}
              </div>
              <div className="d-flex justify-content-end mt-3">
                <Button variant="success" onClick={syncCloudDb} disabled={!api || cloudRunning || !cloudSelected || cloudSelected.size === 0}>
                  {cloudRunning ? 'Syncing...' : 'Sync Database'}
                </Button>
              </div>
            </div>

            {cloudResult && cloudResult.ok && cloudResult.stats ? (
              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Hasil</div>
                <div className="text-muted small mb-2">Mode: {cloudResult.mode}</div>
                <div className="d-flex flex-column gap-1">
                  {Object.keys(cloudResult.stats).map((k) => (
                    <div key={k} className="d-flex justify-content-between">
                      <div>{k}</div>
                      <div className="text-muted small">
                        {cloudResult.stats[k]?.copied || 0} / {cloudResult.stats[k]?.total || 0}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        {active === 'style-memory' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">Translation Style Memory</div>
            {styleProfileNotice && <Alert variant={styleProfileVariant}>{styleProfileNotice}</Alert>}

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Phase 1 Default</div>
              <div className="text-muted small">
                Fase awal memakai `global style profile` dengan sumber `approved only`, rebuild manual dari Settings, prompt hanya memakai `style summary`, dan aktivasi profile tetap manual.
              </div>
            </div>

            <Row className="g-3">
              <Col md={5}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="fw-semibold mb-3">Konfigurasi</div>
                  <Form>
                    <Row className="g-3">
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-use-global"
                          label="Gunakan global style di prompt translate"
                          checked={styleMemoryCfg.useGlobalStyleInTranslate}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, useGlobalStyleInTranslate: e.target.checked }))}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-approved-only"
                          label="Approved only"
                          checked={styleMemoryCfg.approvedOnly}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, approvedOnly: e.target.checked }))}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-explicit-approval"
                          label="Require explicit approval"
                          checked={styleMemoryCfg.requireExplicitApproval}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, requireExplicitApproval: e.target.checked }))}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-high-quality-fallback"
                          label="Include high-quality manual fallback"
                          checked={styleMemoryCfg.includeHighQualityFallback}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, includeHighQualityFallback: e.target.checked }))}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-quality-weighting"
                          label="Gunakan quality weighting"
                          checked={styleMemoryCfg.useQualityWeighting}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, useQualityWeighting: e.target.checked }))}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-representative-samples"
                          label="Sertakan representative samples di prompt"
                          checked={styleMemoryCfg.includeRepresentativeSamples}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, includeRepresentativeSamples: e.target.checked }))}
                        />
                      </Col>
                      <Col md={4}>
                        <Form.Label>Min Confidence</Form.Label>
                        <Form.Control
                          value={styleMemoryCfg.minConfidence}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, minConfidence: e.target.value }))}
                          placeholder="0.85"
                        />
                      </Col>
                      <Col md={4}>
                        <Form.Label>Limit</Form.Label>
                        <Form.Control
                          value={styleMemoryCfg.limit}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, limit: e.target.value }))}
                          placeholder="500"
                        />
                      </Col>
                      <Col md={4}>
                        <Form.Label>Min Samples</Form.Label>
                        <Form.Control
                          value={styleMemoryCfg.minSamples}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, minSamples: e.target.value }))}
                          placeholder="8"
                        />
                      </Col>
                      <Col md={4}>
                        <Form.Label>Sample di Prompt</Form.Label>
                        <Form.Control
                          value={styleMemoryCfg.representativeSampleCount}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, representativeSampleCount: e.target.value }))}
                          placeholder="2"
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Label>Locked Rules</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={5}
                          value={styleMemoryCfg.lockedRulesText}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, lockedRulesText: e.target.value }))}
                          placeholder="Satu aturan per baris"
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Check
                          type="switch"
                          id="style-memory-enable-cluster"
                          label="Aktifkan cluster fallback"
                          checked={styleMemoryCfg.enableClusterFallback}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, enableClusterFallback: e.target.checked }))}
                        />
                      </Col>
                      <Col md={6}>
                        <Form.Label>Cluster Strategy</Form.Label>
                        <Form.Select
                          value={styleMemoryCfg.clusterStrategy}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, clusterStrategy: e.target.value }))}
                        >
                          <option value="auto">Auto Infer</option>
                          <option value="manual">Manual Default</option>
                        </Form.Select>
                      </Col>
                      <Col md={6}>
                        <Form.Label>Default Cluster</Form.Label>
                        <Form.Select
                          value={styleMemoryCfg.defaultClusterKey}
                          onChange={(e) => setStyleMemoryCfg(v => ({ ...v, defaultClusterKey: e.target.value }))}
                        >
                          <option value="">-- none --</option>
                          {styleClusterOptions.map((item) => (
                            <option key={`cfg-cluster-${item.key}`} value={item.key}>{item.label}</option>
                          ))}
                        </Form.Select>
                      </Col>
                    </Row>
                    <div className="text-muted small mt-3">
                      Phase 4 memisahkan `locked rules` dari `adaptive rules` dan menyiapkan fallback `global_cluster` sebelum jatuh ke `global` default.
                    </div>
                    <div className="d-flex gap-2 flex-wrap mt-3">
                      <Button variant="outline-primary" onClick={saveStyleMemoryConfig} disabled={!api || styleProfileRunning}>
                        Save Config
                      </Button>
                      <Button variant="outline-secondary" onClick={previewStyleProfile} disabled={!api || styleProfileRunning}>
                        {styleProfileRunning ? 'Running...' : 'Preview Draft'}
                      </Button>
                      <Button variant="primary" onClick={rebuildStyleProfile} disabled={!api || styleProfileRunning}>
                        {styleProfileRunning ? 'Running...' : 'Rebuild Draft'}
                      </Button>
                    </div>
                  </Form>
                </div>
              </Col>

              <Col md={7}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="fw-semibold">Preview Draft</div>
                    <div className="text-muted small">
                      {styleProfilePreview?.sampleCount ? `${styleProfilePreview.sampleCount} sample` : 'Belum ada draft'}
                    </div>
                  </div>
                  {styleProfilePreview ? (
                    <div className="d-flex flex-column gap-3">
                      <div className="text-muted small">
                        Scope: Global | Source: ar | Target: id
                      </div>
                      <div className="text-muted small">
                        Weighting: {styleProfilePreview.metadata?.weighting?.enabled ? 'aktif' : 'nonaktif'} | Representative samples di prompt: {styleMemoryCfg.includeRepresentativeSamples ? `aktif (${styleMemoryCfg.representativeSampleCount})` : 'nonaktif'}
                      </div>
                      <div className="text-muted small">
                        Locked rules: {Array.isArray(styleProfilePreview.metadata?.lockedRules) ? styleProfilePreview.metadata.lockedRules.length : 0} | Adaptive rules: {Array.isArray(styleProfilePreview.metadata?.adaptiveRules) ? styleProfilePreview.metadata.adaptiveRules.length : 0}
                      </div>
                      <Form.Control as="textarea" rows={10} value={styleProfilePreview.summaryText || ''} readOnly />
                      <div>
                        <div className="fw-semibold small mb-2">Aturan Ringkas</div>
                        <ListGroup>
                          {(styleProfilePreview.rules || []).map((rule, index) => (
                            <ListGroup.Item key={`style-rule-${index}`}>{rule}</ListGroup.Item>
                          ))}
                        </ListGroup>
                      </div>
                      {Array.isArray(styleProfilePreview.metadata?.representativeSamples) && styleProfilePreview.metadata.representativeSamples.length > 0 ? (
                        <div>
                          <div className="fw-semibold small mb-2">Representative Samples</div>
                          <Table size="sm" bordered hover className="mb-0 align-middle">
                            <thead>
                              <tr>
                                <th>Kitab / File</th>
                                <th>Source</th>
                                <th>Target</th>
                              </tr>
                            </thead>
                            <tbody>
                              {styleProfilePreview.metadata.representativeSamples.map((item) => (
                                <tr key={`style-sample-${item.translation_id}`}>
                                  <td>
                                    <div>{item.kitab_name || 'Tanpa Kitab'}</div>
                                    <div className="text-muted small">{item.file_name || '-'}</div>
                                  </td>
                                  <td style={{ direction: 'rtl', textAlign: 'right' }}>{item.source_preview || '-'}</td>
                                  <td>
                                    <div>{item.target_preview || '-'}</div>
                                    <div className="text-muted small">Weight: {item.quality_weight != null ? Number(item.quality_weight).toFixed(2) : '-'}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-muted small">
                      Jalankan `Preview Draft` untuk melihat ringkasan style global dari corpus approved.
                    </div>
                  )}
                </div>
              </Col>
            </Row>

            <div className="border rounded-3 p-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">Versi Profile</div>
                <Button variant="outline-secondary" size="sm" onClick={loadStyleProfiles} disabled={!api || styleProfileRunning}>
                  Refresh
                </Button>
              </div>
              {styleProfileList.length > 0 ? (
                <Table size="sm" responsive className="mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Samples</th>
                      <th>Dibuat</th>
                      <th>Ringkasan</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {styleProfileList.map((item) => (
                      <tr key={item.id}>
                        <td>v{item.version_number}</td>
                        <td>
                          <Badge bg={item.is_active ? 'success' : 'secondary'}>
                            {item.is_active ? 'Active' : 'Draft'}
                          </Badge>
                        </td>
                        <td>{item.sample_count || 0}</td>
                        <td>{item.created_at ? String(item.created_at).slice(0, 19).replace('T', ' ') : '-'}</td>
                        <td>{(item.summary_text || '').slice(0, 140)}{(item.summary_text || '').length > 140 ? '…' : ''}</td>
                        <td>
                          <Button
                            variant={item.is_active ? 'outline-success' : 'outline-primary'}
                            size="sm"
                            onClick={() => activateStyleProfileVersion(item.id)}
                            disabled={!api || styleProfileRunning || item.is_active}
                          >
                            {item.is_active ? 'Active' : 'Activate'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <div className="text-muted small">Belum ada version profile global.</div>
              )}
            </div>

            <Row className="g-3">
              <Col md={5}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="fw-semibold mb-3">Kitab Style Profile</div>
                  <Form>
                    <Form.Label>Pilih Kitab</Form.Label>
                    <Form.Select
                      value={selectedStyleKitabId}
                      onChange={(e) => {
                        setSelectedStyleKitabId(e.target.value)
                        setKitabStyleProfilePreview(null)
                      }}
                    >
                      <option value="">-- pilih kitab --</option>
                      {kitabList.map((kitab) => (
                        <option key={`style-kitab-${kitab.id}`} value={String(kitab.id)}>
                          {kitab.nama_kitab}
                        </option>
                      ))}
                    </Form.Select>
                    <div className="text-muted small mt-2">
                      Phase 2 menambahkan profile gaya per kitab. Runtime akan memakai profile kitab aktif lebih dulu, lalu fallback ke global bila kitab belum punya profile aktif.
                    </div>
                    <div className="d-flex gap-2 flex-wrap mt-3">
                      <Button variant="outline-secondary" onClick={previewKitabStyleProfile} disabled={!api || styleProfileRunning || !selectedStyleKitabId}>
                        {styleProfileRunning ? 'Running...' : 'Preview Kitab Draft'}
                      </Button>
                      <Button variant="primary" onClick={rebuildKitabStyleProfile} disabled={!api || styleProfileRunning || !selectedStyleKitabId}>
                        {styleProfileRunning ? 'Running...' : 'Rebuild Kitab Draft'}
                      </Button>
                    </div>
                  </Form>
                </div>
              </Col>

              <Col md={7}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="fw-semibold">Preview Draft Kitab</div>
                    <div className="text-muted small">
                      {kitabStyleProfilePreview?.sampleCount ? `${kitabStyleProfilePreview.sampleCount} sample` : 'Belum ada draft'}
                    </div>
                  </div>
                  {kitabStyleProfilePreview ? (
                    <div className="d-flex flex-column gap-3">
                      <div className="text-muted small">
                        Scope: Kitab {selectedStyleKitab?.nama_kitab ? `| ${selectedStyleKitab.nama_kitab}` : ''} | Source: ar | Target: id
                      </div>
                      <div className="text-muted small">
                        Weighting: {kitabStyleProfilePreview.metadata?.weighting?.enabled ? 'aktif' : 'nonaktif'} | Representative samples di prompt: {styleMemoryCfg.includeRepresentativeSamples ? `aktif (${styleMemoryCfg.representativeSampleCount})` : 'nonaktif'}
                      </div>
                      <div className="text-muted small">
                        Locked rules: {Array.isArray(kitabStyleProfilePreview.metadata?.lockedRules) ? kitabStyleProfilePreview.metadata.lockedRules.length : 0} | Adaptive rules: {Array.isArray(kitabStyleProfilePreview.metadata?.adaptiveRules) ? kitabStyleProfilePreview.metadata.adaptiveRules.length : 0}
                      </div>
                      <Form.Control as="textarea" rows={10} value={kitabStyleProfilePreview.summaryText || ''} readOnly />
                      <div>
                        <div className="fw-semibold small mb-2">Aturan Ringkas</div>
                        <ListGroup>
                          {(kitabStyleProfilePreview.rules || []).map((rule, index) => (
                            <ListGroup.Item key={`kitab-style-rule-${index}`}>{rule}</ListGroup.Item>
                          ))}
                        </ListGroup>
                      </div>
                      {Array.isArray(kitabStyleProfilePreview.metadata?.representativeSamples) && kitabStyleProfilePreview.metadata.representativeSamples.length > 0 ? (
                        <div>
                          <div className="fw-semibold small mb-2">Representative Samples</div>
                          <Table size="sm" bordered hover className="mb-0 align-middle">
                            <thead>
                              <tr>
                                <th>Kitab / File</th>
                                <th>Source</th>
                                <th>Target</th>
                              </tr>
                            </thead>
                            <tbody>
                              {kitabStyleProfilePreview.metadata.representativeSamples.map((item) => (
                                <tr key={`kitab-style-sample-${item.translation_id}`}>
                                  <td>
                                    <div>{item.kitab_name || selectedStyleKitab?.nama_kitab || 'Tanpa Kitab'}</div>
                                    <div className="text-muted small">{item.file_name || '-'}</div>
                                  </td>
                                  <td style={{ direction: 'rtl', textAlign: 'right' }}>{item.source_preview || '-'}</td>
                                  <td>
                                    <div>{item.target_preview || '-'}</div>
                                    <div className="text-muted small">Weight: {item.quality_weight != null ? Number(item.quality_weight).toFixed(2) : '-'}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-muted small">
                      Pilih kitab lalu jalankan `Preview Kitab Draft` untuk melihat ringkasan style kitab dari corpus approved.
                    </div>
                  )}
                </div>
              </Col>
            </Row>

            <div className="border rounded-3 p-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">Versi Profile Kitab</div>
                <Button variant="outline-secondary" size="sm" onClick={() => loadKitabStyleProfiles(selectedStyleKitabId)} disabled={!api || styleProfileRunning || !selectedStyleKitabId}>
                  Refresh
                </Button>
              </div>
              {selectedStyleKitabId ? (
                kitabStyleProfileList.length > 0 ? (
                  <Table size="sm" responsive className="mb-0 align-middle">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Status</th>
                        <th>Samples</th>
                        <th>Dibuat</th>
                        <th>Ringkasan</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitabStyleProfileList.map((item) => (
                        <tr key={item.id}>
                          <td>v{item.version_number}</td>
                          <td>
                            <Badge bg={item.is_active ? 'success' : 'secondary'}>
                              {item.is_active ? 'Active' : 'Draft'}
                            </Badge>
                          </td>
                          <td>{item.sample_count || 0}</td>
                          <td>{item.created_at ? String(item.created_at).slice(0, 19).replace('T', ' ') : '-'}</td>
                          <td>{(item.summary_text || '').slice(0, 140)}{(item.summary_text || '').length > 140 ? '…' : ''}</td>
                          <td>
                            <Button
                              variant={item.is_active ? 'outline-success' : 'outline-primary'}
                              size="sm"
                              onClick={() => activateStyleProfileVersion(item.id)}
                              disabled={!api || styleProfileRunning || item.is_active}
                            >
                              {item.is_active ? 'Active' : 'Activate'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="text-muted small">Belum ada version profile untuk kitab ini.</div>
                )
              ) : (
                <div className="text-muted small">Pilih kitab untuk melihat version profile per kitab.</div>
              )}
            </div>

            <Row className="g-3">
              <Col md={5}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="fw-semibold mb-3">Cluster Style Profile</div>
                  <Form>
                    <Form.Label>Pilih Cluster</Form.Label>
                    <Form.Select
                      value={selectedStyleClusterKey}
                      onChange={(e) => {
                        setSelectedStyleClusterKey(e.target.value)
                        setClusterStyleProfilePreview(null)
                      }}
                    >
                      <option value="">-- pilih cluster --</option>
                      {styleClusterOptions.map((item) => (
                        <option key={`style-cluster-${item.key}`} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </Form.Select>
                    <div className="text-muted small mt-2">
                      Phase 4 menyiapkan `global_cluster` sebagai fallback di antara `kitab` dan `global` default.
                    </div>
                    <div className="d-flex gap-2 flex-wrap mt-3">
                      <Button variant="outline-secondary" onClick={previewClusterStyleProfile} disabled={!api || styleProfileRunning || !selectedStyleClusterKey}>
                        {styleProfileRunning ? 'Running...' : 'Preview Cluster Draft'}
                      </Button>
                      <Button variant="primary" onClick={rebuildClusterStyleProfile} disabled={!api || styleProfileRunning || !selectedStyleClusterKey}>
                        {styleProfileRunning ? 'Running...' : 'Rebuild Cluster Draft'}
                      </Button>
                    </div>
                  </Form>
                </div>
              </Col>

              <Col md={7}>
                <div className="border rounded-3 p-3 h-100">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="fw-semibold">Preview Draft Cluster</div>
                    <div className="text-muted small">
                      {clusterStyleProfilePreview?.sampleCount ? `${clusterStyleProfilePreview.sampleCount} sample` : 'Belum ada draft'}
                    </div>
                  </div>
                  {clusterStyleProfilePreview ? (
                    <div className="d-flex flex-column gap-3">
                      <div className="text-muted small">
                        Scope: Global Cluster {selectedStyleCluster?.label ? `| ${selectedStyleCluster.label}` : ''} | Source: ar | Target: id
                      </div>
                      <div className="text-muted small">
                        Locked rules: {Array.isArray(clusterStyleProfilePreview.metadata?.lockedRules) ? clusterStyleProfilePreview.metadata.lockedRules.length : 0} | Adaptive rules: {Array.isArray(clusterStyleProfilePreview.metadata?.adaptiveRules) ? clusterStyleProfilePreview.metadata.adaptiveRules.length : 0}
                      </div>
                      <Form.Control as="textarea" rows={10} value={clusterStyleProfilePreview.summaryText || ''} readOnly />
                      <div>
                        <div className="fw-semibold small mb-2">Aturan Ringkas</div>
                        <ListGroup>
                          {(clusterStyleProfilePreview.rules || []).map((rule, index) => (
                            <ListGroup.Item key={`cluster-style-rule-${index}`}>{rule}</ListGroup.Item>
                          ))}
                        </ListGroup>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted small">
                      Pilih cluster lalu jalankan `Preview Cluster Draft` untuk melihat ringkasan style cluster.
                    </div>
                  )}
                </div>
              </Col>
            </Row>

            <div className="border rounded-3 p-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">Versi Profile Cluster</div>
                <Button variant="outline-secondary" size="sm" onClick={() => loadClusterStyleProfiles(selectedStyleClusterKey)} disabled={!api || styleProfileRunning || !selectedStyleClusterKey}>
                  Refresh
                </Button>
              </div>
              {selectedStyleClusterKey ? (
                clusterStyleProfileList.length > 0 ? (
                  <Table size="sm" responsive className="mb-0 align-middle">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Status</th>
                        <th>Samples</th>
                        <th>Dibuat</th>
                        <th>Ringkasan</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clusterStyleProfileList.map((item) => (
                        <tr key={item.id}>
                          <td>v{item.version_number}</td>
                          <td>
                            <Badge bg={item.is_active ? 'success' : 'secondary'}>
                              {item.is_active ? 'Active' : 'Draft'}
                            </Badge>
                          </td>
                          <td>{item.sample_count || 0}</td>
                          <td>{item.created_at ? String(item.created_at).slice(0, 19).replace('T', ' ') : '-'}</td>
                          <td>{(item.summary_text || '').slice(0, 140)}{(item.summary_text || '').length > 140 ? '…' : ''}</td>
                          <td>
                            <Button
                              variant={item.is_active ? 'outline-success' : 'outline-primary'}
                              size="sm"
                              onClick={() => activateStyleProfileVersion(item.id)}
                              disabled={!api || styleProfileRunning || item.is_active}
                            >
                              {item.is_active ? 'Active' : 'Activate'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="text-muted small">Belum ada version profile untuk cluster ini.</div>
                )
              ) : (
                <div className="text-muted small">Pilih cluster untuk melihat version profile per cluster.</div>
              )}
            </div>
          </div>
        )}
        {active === 'learning' && (
          <div className="d-flex flex-column gap-3">
            <div className="h5 mb-0">Continuous Learning + Dataset Export</div>
            {tmSemanticNotice && <Alert variant={tmSemanticVariant}>{tmSemanticNotice}</Alert>}
            {ragCorpusNotice && <Alert variant={ragCorpusVariant}>{ragCorpusNotice}</Alert>}
            {learningNotice && <Alert variant={learningVariant}>{learningNotice}</Alert>}

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Semantic TM Operations</div>
              <Row className="g-3">
                <Col md={3}>
                  <Form.Label>Mode Reindex</Form.Label>
                  <Form.Select
                    value={tmSemanticCfg.mode}
                    onChange={(e) => setTmSemanticCfg(v => ({ ...v, mode: e.target.value }))}
                  >
                    <option value="incremental">Incremental</option>
                    <option value="full">Full Reindex</option>
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label>Minimum Quality Score</Form.Label>
                  <Form.Control
                    value={tmSemanticCfg.minQualityScore}
                    onChange={(e) => setTmSemanticCfg(v => ({ ...v, minQualityScore: e.target.value }))}
                    placeholder="0.80"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Limit Kandidat</Form.Label>
                  <Form.Control
                    value={tmSemanticCfg.limit}
                    onChange={(e) => setTmSemanticCfg(v => ({ ...v, limit: e.target.value }))}
                    placeholder="5000"
                  />
                </Col>
                <Col md={12}>
                  <div className="d-flex flex-wrap gap-3 mt-2">
                    <Form.Check
                      type="checkbox"
                      id="tm-semantic-approved-only"
                      label="Require approval / review signal"
                      checked={tmSemanticCfg.approvedOnly}
                      onChange={(e) => setTmSemanticCfg(v => ({ ...v, approvedOnly: e.target.checked }))}
                    />
                    <Form.Check
                      type="checkbox"
                      id="tm-semantic-high-quality-fallback"
                      label="Include high-quality fallback"
                      checked={tmSemanticCfg.includeHighQualityFallback}
                      onChange={(e) => setTmSemanticCfg(v => ({ ...v, includeHighQualityFallback: e.target.checked }))}
                    />
                  </div>
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                Mode incremental akan skip embedding yang hash source-nya belum berubah. Full reindex akan memproses ulang seluruh kandidat `translation_memory` yang lolos filter.
              </div>
              <div className="d-flex gap-2 flex-wrap mt-3">
                <Button variant="primary" onClick={reindexSemanticTranslationMemory} disabled={!api || tmSemanticRunning || learningRunning || ragCorpusRunning}>
                  {tmSemanticRunning ? 'Running...' : 'Reindex Semantic TM'}
                </Button>
              </div>
            </div>

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">RAG Corpus Operations</div>
              <Row className="g-3">
                <Col md={3}>
                  <Form.Label>ID Kitab</Form.Label>
                  <Form.Control
                    value={ragCorpusCfg.idKitab}
                    onChange={(e) => setRagCorpusCfg(v => ({ ...v, idKitab: e.target.value }))}
                    placeholder="14"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Mode Reindex</Form.Label>
                  <Form.Select
                    value={ragCorpusCfg.mode}
                    onChange={(e) => setRagCorpusCfg(v => ({ ...v, mode: e.target.value }))}
                  >
                    <option value="incremental">Incremental</option>
                    <option value="full">Full (reactivate upsert)</option>
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label>Limit Kandidat</Form.Label>
                  <Form.Control
                    value={ragCorpusCfg.limit}
                    onChange={(e) => setRagCorpusCfg(v => ({ ...v, limit: e.target.value }))}
                    placeholder="5000"
                  />
                </Col>
                <Col md={12}>
                  <div className="d-flex flex-wrap gap-3 mt-2">
                    <Form.Check
                      type="checkbox"
                      id="rag-include-original"
                      label="Include original (source_units)"
                      checked={ragCorpusCfg.includeOriginal}
                      onChange={(e) => setRagCorpusCfg(v => ({ ...v, includeOriginal: e.target.checked }))}
                    />
                    <Form.Check
                      type="checkbox"
                      id="rag-include-translation"
                      label="Include translation (+ bilingual pendek)"
                      checked={ragCorpusCfg.includeTranslation}
                      onChange={(e) => setRagCorpusCfg(v => ({ ...v, includeTranslation: e.target.checked }))}
                    />
                  </div>
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                Terpisah dari Semantic TM. Incremental skip embedding bila `text_hash` + model sama. Default kitab uji Phase 0: id=14 (tajul arus). Tidak menghapus data kitab sumber.
              </div>
              <div className="d-flex gap-2 flex-wrap mt-3">
                <Button variant="primary" onClick={reindexRagCorpus} disabled={!api || ragCorpusRunning || tmSemanticRunning || learningRunning}>
                  {ragCorpusRunning ? 'Running...' : 'Reindex RAG Corpus'}
                </Button>
              </div>
              {ragCorpusResult ? (
                <div className="small mt-3 text-muted">
                  <div>Kitab: {ragCorpusResult.namaKitab || '-'} (id={ragCorpusResult.idKitab})</div>
                  {'mode' in ragCorpusResult ? <div>Mode: {ragCorpusResult.mode}</div> : null}
                  {'scannedCount' in ragCorpusResult ? <div>Scanned drafts: {ragCorpusResult.scannedCount || 0}</div> : null}
                  {'createdCount' in ragCorpusResult ? <div>Created: {ragCorpusResult.createdCount || 0}</div> : null}
                  {'updatedCount' in ragCorpusResult ? <div>Updated: {ragCorpusResult.updatedCount || 0}</div> : null}
                  {'embeddedCount' in ragCorpusResult ? <div>Embedded: {ragCorpusResult.embeddedCount || 0}</div> : null}
                  {'skippedCount' in ragCorpusResult ? <div>Skipped: {ragCorpusResult.skippedCount || 0}</div> : null}
                  {'failedCount' in ragCorpusResult ? <div>Failed: {ragCorpusResult.failedCount || 0}</div> : null}
                  {'activeChunkCount' in ragCorpusResult ? <div>Active chunks: {ragCorpusResult.activeChunkCount || 0}</div> : null}
                  {'embeddingCount' in ragCorpusResult ? <div>Embeddings (rag_chunk): {ragCorpusResult.embeddingCount || 0}</div> : null}
                  {ragCorpusResult.provider ? <div>Provider: {ragCorpusResult.provider}</div> : null}
                  {ragCorpusResult.model ? <div>Model: {ragCorpusResult.model}</div> : null}
                  {ragCorpusResult.skipReasons && Object.keys(ragCorpusResult.skipReasons).length > 0 ? (
                    <div className="mt-2">
                      Skip reasons:
                      <ul className="mb-0">
                        {Object.entries(ragCorpusResult.skipReasons).map(([key, value]) => (
                          <li key={key}>{key}: {value}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {ragCorpusResult.failedReasons && Object.keys(ragCorpusResult.failedReasons).length > 0 ? (
                    <div className="mt-2">
                      Failed reasons:
                      <ul className="mb-0">
                        {Object.entries(ragCorpusResult.failedReasons).map(([key, value]) => (
                          <li key={key}>{key}: {value}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">RAG Search Threshold</div>
              <Row className="g-3">
                <Col md={3}>
                  <Form.Label>Search Similarity</Form.Label>
                  <Form.Control
                    value={ragSearchCfg.searchSimilarityThreshold}
                    onChange={(e) => setRagSearchCfg(v => ({ ...v, searchSimilarityThreshold: e.target.value }))}
                    placeholder="0.55"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Chat Similarity (Phase 3)</Form.Label>
                  <Form.Control
                    value={ragSearchCfg.chatSimilarityThreshold}
                    onChange={(e) => setRagSearchCfg(v => ({ ...v, chatSimilarityThreshold: e.target.value }))}
                    placeholder="0.70"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Candidate Limit</Form.Label>
                  <Form.Control
                    value={ragSearchCfg.candidateLimit}
                    onChange={(e) => setRagSearchCfg(v => ({ ...v, candidateLimit: e.target.value }))}
                    placeholder="400"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Top K Results</Form.Label>
                  <Form.Control
                    value={ragSearchCfg.topK}
                    onChange={(e) => setRagSearchCfg(v => ({ ...v, topK: e.target.value }))}
                    placeholder="50"
                  />
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                Terpisah dari TM semantic. Search longgar (~0.55); Chat RAG nanti lebih ketat (~0.70). Candidate limit membatasi load `vector_json` sebelum cosine.
              </div>
              <div className="d-flex gap-2 flex-wrap mt-3">
                <Button variant="outline-primary" onClick={saveRagSearchConfig} disabled={!api || ragSearchSaving || ragCorpusRunning}>
                  {ragSearchSaving ? 'Saving...' : 'Save RAG Search Settings'}
                </Button>
              </div>
            </div>

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Semantic Quality Tuning</div>
              <Row className="g-3">
                <Col md={3}>
                  <Form.Label>TM Similarity Threshold</Form.Label>
                  <Form.Control
                    value={semanticTuningCfg.tmSimilarityThreshold}
                    onChange={(e) => setSemanticTuningCfg(v => ({ ...v, tmSimilarityThreshold: e.target.value }))}
                    placeholder="0.68"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Source Unit Threshold</Form.Label>
                  <Form.Control
                    value={semanticTuningCfg.sourceUnitSimilarityThreshold}
                    onChange={(e) => setSemanticTuningCfg(v => ({ ...v, sourceUnitSimilarityThreshold: e.target.value }))}
                    placeholder="0.72"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Max TM Examples</Form.Label>
                  <Form.Control
                    value={semanticTuningCfg.maxTmExamples}
                    onChange={(e) => setSemanticTuningCfg(v => ({ ...v, maxTmExamples: e.target.value }))}
                    placeholder="4"
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Max Source Unit Examples</Form.Label>
                  <Form.Control
                    value={semanticTuningCfg.maxSourceUnitExamples}
                    onChange={(e) => setSemanticTuningCfg(v => ({ ...v, maxSourceUnitExamples: e.target.value }))}
                    placeholder="3"
                  />
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                Threshold lebih tinggi akan membuat semantic hit lebih ketat. Jumlah example membatasi berapa banyak konteks semantic yang benar-benar masuk ke prompt `translate-ai`.
              </div>
              <div className="d-flex gap-2 flex-wrap mt-3">
                <Button variant="outline-primary" onClick={saveSemanticTuningConfig} disabled={!api || semanticTuningSaving || learningRunning || tmSemanticRunning}>
                  {semanticTuningSaving ? 'Saving...' : 'Save Semantic Tuning'}
                </Button>
              </div>
            </div>

            {tmSemanticResult ? (
              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Hasil Semantic TM</div>
                <div className="d-flex flex-column gap-1 text-muted small">
                  {'mode' in tmSemanticResult ? <div>Mode: {tmSemanticResult.mode}</div> : null}
                  {'candidateCount' in tmSemanticResult ? <div>Kandidat: {tmSemanticResult.candidateCount || 0}</div> : null}
                  {'scannedCount' in tmSemanticResult ? <div>Scanned: {tmSemanticResult.scannedCount || 0}</div> : null}
                  {'indexedCount' in tmSemanticResult ? <div>Indexed: {tmSemanticResult.indexedCount || 0}</div> : null}
                  {'skippedCount' in tmSemanticResult ? <div>Skipped: {tmSemanticResult.skippedCount || 0}</div> : null}
                  {'failedCount' in tmSemanticResult ? <div>Failed: {tmSemanticResult.failedCount || 0}</div> : null}
                  {tmSemanticResult.provider ? <div>Provider: {tmSemanticResult.provider}</div> : null}
                  {tmSemanticResult.model ? <div>Model: {tmSemanticResult.model}</div> : null}
                </div>
                {tmSemanticResult.skipReasons && Object.keys(tmSemanticResult.skipReasons).length > 0 ? (
                  <div className="mt-3">
                    <div className="fw-semibold small mb-1">Skip Reasons</div>
                    <div className="d-flex flex-column gap-1 text-muted small">
                      {Object.entries(tmSemanticResult.skipReasons).map(([key, value]) => (
                        <div key={key} className="d-flex justify-content-between gap-3">
                          <div>{key}</div>
                          <div>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {tmSemanticResult.failedReasons && Object.keys(tmSemanticResult.failedReasons).length > 0 ? (
                  <div className="mt-3">
                    <div className="fw-semibold small mb-1">Failed Reasons</div>
                    <div className="d-flex flex-column gap-1 text-muted small">
                      {Object.entries(tmSemanticResult.failedReasons).map(([key, value]) => (
                        <div key={key} className="d-flex justify-content-between gap-3">
                          <div>{key}</div>
                          <div>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Filter Kualitas</div>
              <Row className="g-3">
                <Col md={4}>
                  <Form.Label>Minimum Confidence</Form.Label>
                  <Form.Control
                    value={learningCfg.minConfidence}
                    onChange={(e) => setLearningCfg(v => ({ ...v, minConfidence: e.target.value }))}
                    placeholder="0.80"
                  />
                </Col>
                <Col md={4}>
                  <Form.Label>Limit Kandidat</Form.Label>
                  <Form.Control
                    value={learningCfg.limit}
                    onChange={(e) => setLearningCfg(v => ({ ...v, limit: e.target.value }))}
                    placeholder="5000"
                  />
                </Col>
                <Col md={12}>
                  <div className="d-flex flex-wrap gap-3 mt-2">
                    <Form.Check
                      type="checkbox"
                      id="learning-approved-only"
                      label="Approved / confirmed only"
                      checked={learningCfg.approvedOnly}
                      onChange={(e) => setLearningCfg(v => ({ ...v, approvedOnly: e.target.checked }))}
                    />
                    <Form.Check
                      type="checkbox"
                      id="learning-require-explicit-approval"
                      label="Require explicit approval only"
                      checked={learningCfg.requireExplicitApproval}
                      onChange={(e) => setLearningCfg(v => ({ ...v, requireExplicitApproval: e.target.checked }))}
                    />
                    <Form.Check
                      type="checkbox"
                      id="learning-high-quality-fallback"
                      label="Include high-quality manual fallback"
                      checked={learningCfg.includeHighQualityFallback}
                      onChange={(e) => setLearningCfg(v => ({ ...v, includeHighQualityFallback: e.target.checked }))}
                    />
                  </div>
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                Refresh semantic index memakai kandidat approved atau confirmed. Bila `Require explicit approval only` aktif, hanya entry dengan status review formal `approved` yang lolos. Entry `rejected` selalu dibuang. Bila fallback aktif, entry manual dengan confidence tinggi hanya dipakai saat gate formal tidak dipaksa.
              </div>
            </div>

            <div className="d-flex gap-2 flex-wrap">
              <Button variant="outline-secondary" onClick={loadLearningPreview} disabled={!api || learningRunning || learningPreviewLoading}>
                {learningPreviewLoading ? 'Loading...' : 'Preview Candidates'}
              </Button>
              <Button variant="primary" onClick={refreshLearningSemantic} disabled={!api || learningRunning}>
                {learningRunning ? 'Running...' : 'Refresh Semantic Index'}
              </Button>
              <Button variant="success" onClick={exportLearningJsonl} disabled={!api || learningRunning}>
                {learningRunning ? 'Running...' : 'Export Dataset JSONL'}
              </Button>
            </div>

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Catatan Operasional</div>
              <div className="text-muted small">
                Pastikan ada API provider dengan capability `embed` sebelum menjalankan refresh semantic index. Export JSONL memakai filter kualitas yang sama dengan refresh learning.
              </div>
            </div>

            <div className="border rounded-3 p-3">
              <div className="fw-semibold mb-2">Dataset Export Options</div>
              <Row className="g-3">
                <Col md={4}>
                  <Form.Label>Export Variant</Form.Label>
                  <Form.Select
                    value={learningExportCfg.exportVariant}
                    onChange={(e) => setLearningExportCfg(v => ({ ...v, exportVariant: e.target.value }))}
                  >
                    <option value="flat">Flat JSONL</option>
                    <option value="chat">Chat JSONL</option>
                  </Form.Select>
                </Col>
                <Col md={12}>
                  <div className="d-flex flex-wrap gap-3 mt-2">
                    <Form.Check
                      type="checkbox"
                      id="learning-export-manifest"
                      label="Generate manifest metadata"
                      checked={learningExportCfg.includeManifest}
                      onChange={(e) => setLearningExportCfg(v => ({ ...v, includeManifest: e.target.checked }))}
                    />
                    <Form.Check
                      type="checkbox"
                      id="learning-export-deduplicate"
                      label="Deduplicate exact source-target pairs"
                      checked={learningExportCfg.deduplicateExact}
                      onChange={(e) => setLearningExportCfg(v => ({ ...v, deduplicateExact: e.target.checked }))}
                    />
                  </div>
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                `Flat JSONL` cocok untuk dataset pasangan source-target. `Chat JSONL` cocok untuk eksperimen format messages. Manifest metadata membantu review hasil export internal. Opsi dedup membantu membuang pasangan source-target yang identik sebelum file ditulis.
              </div>
            </div>

            <div className="border rounded-3 p-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">Monitoring Kandidat Learning</div>
                <div className="text-muted small">
                  {learningPreviewLoading
                    ? 'Memuat preview...'
                    : learningPreview?.summary
                      ? `${learningPreview.summary.candidateCount || 0} kandidat lolos filter`
                      : 'Belum ada preview'}
                </div>
              </div>
              {learningPreview?.summary ? (
                <div className="d-flex flex-column gap-3">
                  <Row className="g-3">
                    <Col md={3}><div className="small text-muted">Kandidat</div><div className="fw-semibold">{learningPreview.summary.candidateCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Approved</div><div className="fw-semibold">{learningPreview.summary.approvedCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Confirmed</div><div className="fw-semibold">{learningPreview.summary.confirmedCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">High Quality Manual</div><div className="fw-semibold">{learningPreview.summary.highQualityManualCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Rata-rata Confidence</div><div className="fw-semibold">{((Number(learningPreview.summary.averageConfidence || 0) * 100).toFixed(1))}%</div></Col>
                    <Col md={3}><div className="small text-muted">Jumlah Kitab</div><div className="fw-semibold">{learningPreview.summary.kitabCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Min Confidence</div><div className="fw-semibold">{((Number(learningPreview.summary.minConfidence || 0) * 100).toFixed(1))}%</div></Col>
                    <Col md={3}><div className="small text-muted">Limit</div><div className="fw-semibold">{learningPreview.summary.limit || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Formal Approval Gate</div><div className="fw-semibold">{learningPreview.summary.requireExplicitApproval ? 'yes' : 'no'}</div></Col>
                    <Col md={3}><div className="small text-muted">Unique Pairs</div><div className="fw-semibold">{learningPreview.summary.uniquePairCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Duplicate Rows</div><div className="fw-semibold">{learningPreview.summary.duplicateRowsRemoved || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Confidence High</div><div className="fw-semibold">{learningPreview.summary.highConfidenceCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Confidence Medium</div><div className="fw-semibold">{learningPreview.summary.mediumConfidenceCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Confidence Low</div><div className="fw-semibold">{learningPreview.summary.lowConfidenceCount || 0}</div></Col>
                    <Col md={3}><div className="small text-muted">Confidence Unknown</div><div className="fw-semibold">{learningPreview.summary.unknownConfidenceCount || 0}</div></Col>
                  </Row>

                  <div>
                    <div className="fw-semibold small mb-2">Top Kitab</div>
                    {Array.isArray(learningPreview.topKitabs) && learningPreview.topKitabs.length > 0 ? (
                      <div className="d-flex flex-column gap-1 text-muted small">
                        {learningPreview.topKitabs.map((item, index) => (
                          <div key={`learning-kitab-${index}`} className="d-flex justify-content-between gap-3">
                            <div>{item.nama_kitab || 'Tanpa Kitab'}</div>
                            <div>{item.count || 0}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted small">Belum ada distribusi kitab.</div>
                    )}
                  </div>

                  <div>
                    <div className="fw-semibold small mb-2">Top Source Labels</div>
                    {Array.isArray(learningPreview.topSourceLabels) && learningPreview.topSourceLabels.length > 0 ? (
                      <div className="d-flex flex-column gap-1 text-muted small">
                        {learningPreview.topSourceLabels.map((item, index) => (
                          <div key={`learning-source-label-${index}`} className="d-flex justify-content-between gap-3">
                            <div>{item.label || 'unknown'}</div>
                            <div>{item.count || 0}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted small">Belum ada distribusi source label.</div>
                    )}
                  </div>

                  <div>
                    <div className="fw-semibold small mb-2">Duplicate Examples</div>
                    {Array.isArray(learningPreview.duplicateExamples) && learningPreview.duplicateExamples.length > 0 ? (
                      <div className="table-responsive">
                        <Table size="sm" bordered hover className="mb-0 align-middle">
                          <thead>
                            <tr>
                              <th>Status</th>
                              <th>Kitab / File</th>
                              <th>Source</th>
                              <th>Target</th>
                            </tr>
                          </thead>
                          <tbody>
                            {learningPreview.duplicateExamples.map((item) => (
                              <tr key={`learning-duplicate-${item.translation_id}`}>
                                <td>{item.approval_status || '-'}</td>
                                <td>
                                  <div>{item.kitab_name || 'Tanpa Kitab'}</div>
                                  <div className="text-muted small">{item.file_name || '-'}</div>
                                </td>
                                <td style={{ direction: 'rtl', textAlign: 'right' }}>{item.source_text_preview || '-'}</td>
                                <td>{item.target_text_preview || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-muted small">Belum ada duplicate exact pada kandidat saat ini.</div>
                    )}
                  </div>

                  <div>
                    <div className="fw-semibold small mb-2">Sampel Kandidat</div>
                    {Array.isArray(learningPreview.samples) && learningPreview.samples.length > 0 ? (
                      <div className="table-responsive">
                        <Table size="sm" bordered hover className="mb-0 align-middle">
                          <thead>
                            <tr>
                              <th>Status</th>
                              <th>Confidence</th>
                              <th>Kitab / File</th>
                              <th>Source</th>
                              <th>Preview</th>
                            </tr>
                          </thead>
                          <tbody>
                            {learningPreview.samples.map((item) => (
                              <tr key={`learning-sample-${item.translation_id}`}>
                                <td>{item.approval_status || '-'}</td>
                                <td>{item.confidence_score != null ? `${(Number(item.confidence_score) * 100).toFixed(1)}%` : '-'}</td>
                                <td>
                                  <div>{item.nama_kitab || 'Tanpa Kitab'}</div>
                                  <div className="text-muted small">{item.file_name || '-'}</div>
                                </td>
                                <td>
                                  <div>{item.source_label || '-'}</div>
                                  <div className="text-muted small">Feedback: {item.feedback_count || 0}</div>
                                </td>
                                <td>
                                  <div className="small mb-1" style={{ direction: 'rtl', textAlign: 'right' }}>{item.text_original_preview || '-'}</div>
                                  <div className="small text-muted">{item.text_translate_preview || '-'}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-muted small">Belum ada kandidat yang lolos filter saat ini.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-muted small">
                  Jalankan preview untuk melihat kandidat approved, confirmed, atau high quality manual yang akan dipakai workflow learning.
                </div>
              )}
            </div>

            {learningResult ? (
              <div className="border rounded-3 p-3">
                <div className="fw-semibold mb-2">Hasil</div>
                <div className="d-flex flex-column gap-1 text-muted small">
                  {'candidateCount' in learningResult ? <div>Kandidat: {learningResult.candidateCount || 0}</div> : null}
                  {'indexedCount' in learningResult ? <div>Indexed: {learningResult.indexedCount || 0}</div> : null}
                  {'skippedCount' in learningResult ? <div>Skipped: {learningResult.skippedCount || 0}</div> : null}
                  {'requireExplicitApproval' in learningResult ? <div>Require Explicit Approval: {learningResult.requireExplicitApproval ? 'yes' : 'no'}</div> : null}
                  {learningResult.exportVariant ? <div>Variant: {learningResult.exportVariant}</div> : null}
                  {'includeManifest' in learningResult ? <div>Manifest: {learningResult.includeManifest ? 'yes' : 'no'}</div> : null}
                  {'deduplicateExact' in learningResult ? <div>Deduplicate Exact: {learningResult.deduplicateExact ? 'yes' : 'no'}</div> : null}
                  {learningResult.provider ? <div>Provider: {learningResult.provider}</div> : null}
                  {learningResult.model ? <div>Model: {learningResult.model}</div> : null}
                  {learningResult.filePath ? <div>File: {learningResult.filePath}</div> : null}
                  {learningResult.manifestPath ? <div>Manifest File: {learningResult.manifestPath}</div> : null}
                  {'count' in learningResult ? <div>Rows: {learningResult.count || 0}</div> : null}
                  {'originalCount' in learningResult ? <div>Original Rows: {learningResult.originalCount || 0}</div> : null}
                  {'uniquePairCount' in learningResult ? <div>Unique Pairs: {learningResult.uniquePairCount || 0}</div> : null}
                  {'duplicateRowsRemoved' in learningResult ? <div>Duplicate Rows Removed: {learningResult.duplicateRowsRemoved || 0}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Col>
    </Row>
  )
}
