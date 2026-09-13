const { contextBridge, ipcRenderer, clipboard } = require('electron')

contextBridge.exposeInMainWorld('api', {
  selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
  selectPdf: () => ipcRenderer.invoke('select-pdf'),
  selectImage: () => ipcRenderer.invoke('select-image'),
  selectTesseract: () => ipcRenderer.invoke('select-tesseract'),
  selectMagick: () => ipcRenderer.invoke('select-magick'),
  selectPdftoppm: () => ipcRenderer.invoke('select-pdftoppm'),
  openNewWindow: () => ipcRenderer.invoke('open-new-window'),
  openKeepWindow: () => ipcRenderer.invoke('keep-open'),
  keepOcr: (payload) => ipcRenderer.invoke('keep-ocr', payload),
  keepCreateNote: (payload) => ipcRenderer.invoke('keep-create-note', payload),
  driveAuthStatus: () => ipcRenderer.invoke('drive-auth-status'),
  driveAuth: () => ipcRenderer.invoke('drive-auth'),
  driveUpload: (payload) => ipcRenderer.invoke('drive-upload', payload),
  runOCR: (payload) => ipcRenderer.invoke('run-ocr', payload),
  runOCRDL: (payload) => ipcRenderer.invoke('run-ocr-dl', payload),
  runOCREasy: (payload) => ipcRenderer.invoke('run-ocr-easy', payload),
  runOCRKraken: (payload) => ipcRenderer.invoke('run-ocr-kraken', payload),
  runOCRVision: (payload) => ipcRenderer.invoke('run-ocr-vision', payload),
  runOCRUnlimited: (payload) => ipcRenderer.invoke('run-ocr-unlimited', payload),
  runOcrFile: (payload) => ipcRenderer.invoke('run-ocr-file', payload),
  runOcrOpenAi: (payload) => ipcRenderer.invoke('run-ocr-openai', payload),
  joinText: (payload) => ipcRenderer.invoke('join-text', payload),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getOcrStatus: () => ipcRenderer.invoke('get-ocr-status'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  openExplorer: (dirPath) => ipcRenderer.invoke('open-explorer', dirPath),
  ensureFolder: (dirPath) => ipcRenderer.invoke('ensure-folder', dirPath),
  convertPdf: (payload) => ipcRenderer.invoke('convert-pdf', payload),
  splitPdf: (payload) => ipcRenderer.invoke('split-pdf', payload),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readImageDataUrl: (filePath) => ipcRenderer.invoke('read-image-data-url', filePath),
  listTxtFiles: (dir) => ipcRenderer.invoke('list-txt-files', dir),
  listImageFiles: (dir) => ipcRenderer.invoke('list-image-files', dir),
  translateChatGPT: (payload) => ipcRenderer.invoke('translate-chatgpt', payload),
  getDbStatus: () => ipcRenderer.invoke('db-status'),
  getDbConfig: () => ipcRenderer.invoke('get-db-config'),
  saveDbConfig: (partial) => ipcRenderer.invoke('save-db-config', partial),
  getTranslation: (payload) => ipcRenderer.invoke('get-translation', payload),
  getTranslationAssistContext: (payload) => ipcRenderer.invoke('get-translation-assist-context', payload),
  getSourceUnitContext: (payload) => ipcRenderer.invoke('get-source-unit-context', payload),
  importSourceUnits: (payload) => ipcRenderer.invoke('import-source-units', payload),
  saveTranslation: (payload) => ipcRenderer.invoke('save-translation', payload),
  listTranslationVersions: (payload) => ipcRenderer.invoke('list-translation-versions', payload),
  listTranslationFeedbackHistory: (payload) => ipcRenderer.invoke('list-translation-feedback-history', payload),
  submitTranslationReview: (payload) => ipcRenderer.invoke('submit-translation-review', payload),
  learningRefreshSemantic: (payload) => ipcRenderer.invoke('learning-refresh-semantic', payload),
  learningPreviewCandidates: (payload) => ipcRenderer.invoke('learning-preview-candidates', payload),
  previewGlobalStyleProfile: (payload) => ipcRenderer.invoke('preview-global-style-profile', payload),
  rebuildGlobalStyleProfile: (payload) => ipcRenderer.invoke('rebuild-global-style-profile', payload),
  previewKitabStyleProfile: (payload) => ipcRenderer.invoke('preview-kitab-style-profile', payload),
  rebuildKitabStyleProfile: (payload) => ipcRenderer.invoke('rebuild-kitab-style-profile', payload),
  previewClusterStyleProfile: (payload) => ipcRenderer.invoke('preview-cluster-style-profile', payload),
  rebuildClusterStyleProfile: (payload) => ipcRenderer.invoke('rebuild-cluster-style-profile', payload),
  listTranslationStyleProfiles: (payload) => ipcRenderer.invoke('list-translation-style-profiles', payload),
  activateTranslationStyleProfile: (profileId) => ipcRenderer.invoke('activate-translation-style-profile', profileId),
  semanticReindexTranslationMemory: (payload) => ipcRenderer.invoke('semantic-reindex-translation-memory', payload),
  ragReindexCorpus: (payload) => ipcRenderer.invoke('rag-reindex-corpus', payload),
  ragVerifyIndex: (payload) => ipcRenderer.invoke('rag-verify-index', payload),
  learningExportJsonl: (payload) => ipcRenderer.invoke('learning-export-jsonl', payload),
  listKitabs: () => ipcRenderer.invoke('list-kitabs'),
  findKitabByFolder: (folderPath) => ipcRenderer.invoke('find-kitab-by-folder', folderPath),
  createKitab: (payload) => ipcRenderer.invoke('create-kitab', payload),
  listKitabFolders: (idKitab) => ipcRenderer.invoke('list-kitab-folders', idKitab),
  addKitabFolder: (payload) => ipcRenderer.invoke('add-kitab-folder', payload),
  removeKitabFolder: (payload) => ipcRenderer.invoke('remove-kitab-folder', payload),
  getKitabDetailByFolder: (folderPath) => ipcRenderer.invoke('get-kitab-detail-by-folder', folderPath),
  getKitabDetailById: (idKitab) => ipcRenderer.invoke('get-kitab-detail-by-id', idKitab),
  updateKitab: (payload) => ipcRenderer.invoke('update-kitab', payload),
  deleteKitab: (idKitab) => ipcRenderer.invoke('delete-kitab', idKitab),
  searchGlobal: (payload) => ipcRenderer.invoke('search-global', payload),
  copyToClipboard: (text) => { try { clipboard.writeText(String(text || '')); return true } catch (_) { return false } },
  copyImageToClipboard: (dataUrl) => ipcRenderer.invoke('copy-image-to-clipboard', dataUrl),
  listApiSettings: () => ipcRenderer.invoke('list-api-settings'),
  filterProvidersByCapability: (capability) => ipcRenderer.invoke('filter-providers-by-capability', capability),
  saveApiSetting: (payload) => ipcRenderer.invoke('save-api-setting', payload),
  deleteApiSetting: (id) => ipcRenderer.invoke('delete-api-setting', id),
  listTranslationGlossary: (payload) => ipcRenderer.invoke('list-translation-glossary', payload),
  saveTranslationGlossary: (payload) => ipcRenderer.invoke('save-translation-glossary', payload),
  deleteTranslationGlossary: (id) => ipcRenderer.invoke('delete-translation-glossary', id),
  seedTranslationGlossary: (payload) => ipcRenderer.invoke('seed-translation-glossary', payload),
  getTranslationRuntimeMetrics: (payload) => ipcRenderer.invoke('get-translation-runtime-metrics', payload),
  listAgentSystemPrompts: () => ipcRenderer.invoke('list-agent-system-prompts'),
  saveAgentSystemPrompt: (payload) => ipcRenderer.invoke('save-agent-system-prompt', payload),
  deleteAgentSystemPrompt: (id) => ipcRenderer.invoke('delete-agent-system-prompt', id),
  listAgentPromptBindings: () => ipcRenderer.invoke('list-agent-prompt-bindings'),
  setAgentPromptBinding: (payload) => ipcRenderer.invoke('set-agent-prompt-binding', payload),
  aiChatListThreads: (payload) => ipcRenderer.invoke('ai-chat-list-threads', payload),
  aiChatCreateThread: (payload) => ipcRenderer.invoke('ai-chat-create-thread', payload),
  aiChatListMessages: (threadId) => ipcRenderer.invoke('ai-chat-list-messages', threadId),
  aiChatSend: (payload) => ipcRenderer.invoke('ai-chat-send', payload),
  aiChatRenameThread: (payload) => ipcRenderer.invoke('ai-chat-rename-thread', payload),
  aiChatDeleteThread: (threadId) => ipcRenderer.invoke('ai-chat-delete-thread', threadId),
  aiChatCloneThread: (payload) => ipcRenderer.invoke('ai-chat-clone-thread', payload),
  translateGeminiCli: (payload) => ipcRenderer.invoke('translate-gemini-cli', payload),
  translateOpenAiCli: (payload) => ipcRenderer.invoke('translate-openai-cli', payload),
  translateAi: (payload) => ipcRenderer.invoke('translate-ai', payload),
  ttsOpenAi: (payload) => ipcRenderer.invoke('tts-openai', payload),
  getSavedTtsAudio: (payload) => ipcRenderer.invoke('get-saved-tts-audio', payload),
  translateWordAnalysis: (payload) => ipcRenderer.invoke('translate-word-analysis', payload),
  sttGemini: (payload) => ipcRenderer.invoke('stt-gemini', payload),
  getTranslateStatus: () => ipcRenderer.invoke('get-translate-status'),
  cloudDbTest: (payload) => ipcRenderer.invoke('cloud-db-test', payload),
  cloudDbSync: (payload) => ipcRenderer.invoke('cloud-db-sync', payload),
  onOcrProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('ocr-progress', listener)
    return () => ipcRenderer.removeListener('ocr-progress', listener)
  },
  onOcrComplete: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('ocr-complete', listener)
    return () => ipcRenderer.removeListener('ocr-complete', listener)
  },
  onTranslateStatus: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('translate-status', listener)
    return () => ipcRenderer.removeListener('translate-status', listener)
  },
  onTranslateComplete: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('translate-complete', listener)
    return () => ipcRenderer.removeListener('translate-complete', listener)
  },
  onPdfConvertProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('pdf-convert-progress', listener)
    return () => ipcRenderer.removeListener('pdf-convert-progress', listener)
  },
  onPdfConvertComplete: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('pdf-convert-complete', listener)
    return () => ipcRenderer.removeListener('pdf-convert-complete', listener)
  }
})
