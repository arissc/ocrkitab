import mysql from 'mysql2/promise'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'

export let dbPool = null
export let dbReady = false
export let dbError = null
export const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'reader_app'
}

const ARABIC_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g
const NON_WORD_PUNCT_RE = /[^\p{L}\p{N}\s]/gu
const DEFAULT_GLOSSARY_SEED = [
  { source_term: 'كتاب', target_term: 'kitab', notes: 'Istilah kitab, pertahankan bentuk serapan.', priority: 10 },
  { source_term: 'باب', target_term: 'bab', notes: 'Struktur bab dalam kitab.', priority: 15 },
  { source_term: 'فصل', target_term: 'fasal', notes: 'Subbagian dalam kitab.', priority: 15 },
  { source_term: 'مسألة', target_term: 'masalah', notes: 'Penanda pembahasan atau butir masalah.', priority: 20 },
  { source_term: 'المتن', target_term: 'matan', notes: 'Teks inti kitab.', priority: 20 },
  { source_term: 'الشرح', target_term: 'syarah', notes: 'Penjelasan atas matan.', priority: 20 },
  { source_term: 'الحاشية', target_term: 'hasyiyah', notes: 'Catatan pinggir atau komentar.', priority: 20 },
  { source_term: 'الشيخ', target_term: 'Syekh', notes: 'Gelar ulama.', priority: 30 },
  { source_term: 'الإمام', target_term: 'Imam', notes: 'Gelar ulama.', priority: 30 },
  { source_term: 'الحافظ', target_term: 'Al-Hafizh', notes: 'Gelar ulama ahli hadits.', priority: 30 },
  { source_term: 'رحمه الله', target_term: "rahimahullah", notes: 'Doa untuk ulama yang wafat.', priority: 40 },
  { source_term: 'رضي الله عنه', target_term: "radhiyallahu 'anhu", notes: 'Doa untuk sahabat laki-laki.', priority: 40 },
  { source_term: 'رضي الله عنها', target_term: "radhiyallahu 'anha", notes: 'Doa untuk sahabat perempuan.', priority: 40 },
  { source_term: 'قدس الله سره', target_term: 'quddisa sirruh', notes: 'Doa atau penghormatan bagi wali atau ulama.', priority: 45 },
  { source_term: 'المدرسة', target_term: 'madrasah', notes: 'Istilah pendidikan Islam.', priority: 50 },
  { source_term: 'المعهد', target_term: 'mahad', notes: 'Istilah lembaga pendidikan atau pesantren.', priority: 50 },
  { source_term: 'الطالب', target_term: 'santri', notes: 'Penyesuaian istilah pesantren bila konteks pendidikan klasik.', priority: 60 }
]

function normalizeLangCode(input, fallback) {
  const value = String(input || fallback || '').trim().toLowerCase()
  return value || fallback
}

export function normalizeArabicText(input) {
  const text = String(input || '')
  if (!text) return ''
  return text
    .normalize('NFKC')
    .replace(/\u0640/g, '')
    .replace(ARABIC_DIACRITICS_RE, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(NON_WORD_PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNormalizedTokens(input, { minLength = 2, limit = 8 } = {}) {
  const normalized = normalizeArabicText(input)
  if (!normalized) return []
  const seen = new Set()
  const tokens = []
  for (const token of normalized.split(/\s+/)) {
    if (!token || token.length < minLength || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length >= limit) break
  }
  return tokens
}


export function getDbStatus() {
  return { ok: dbReady, error: dbError, config: { host: dbConfig.host, user: dbConfig.user, database: dbConfig.database } }
}

export async function ensureMasterKitab(nama) {
  if (!dbPool) throw new Error('Database not ready')
  const [rows] = await dbPool.query('SELECT id FROM master_kitab WHERE nama_kitab = ? LIMIT 1', [nama])
  if (rows && rows.length > 0) return rows[0].id
  const [res] = await dbPool.query('INSERT INTO master_kitab (nama_kitab) VALUES (?)', [nama])
  return res.insertId
}

async function resolveKitabId({ kitabName, folderPath, createIfMissing = false } = {}) {
  if (!dbPool) throw new Error('Database not ready')
  let idKitab = null
  if (folderPath) {
    const kitab = await findKitabByFolder(folderPath)
    if (kitab) idKitab = kitab.id
  }
  if (!idKitab && kitabName) {
    const [rows] = await dbPool.query('SELECT id FROM master_kitab WHERE nama_kitab = ? LIMIT 1', [kitabName])
    if (rows && rows.length > 0) idKitab = rows[0].id
  }
  if (!idKitab && createIfMissing && kitabName) {
    idKitab = await ensureMasterKitab(kitabName)
  }
  return idKitab
}

async function ensureTranslationMemorySchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS translation_memory (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      id_kitab INT NULL,
      source_lang VARCHAR(32) NOT NULL DEFAULT 'ar',
      target_lang VARCHAR(32) NOT NULL DEFAULT 'id',
      source_text MEDIUMTEXT NOT NULL,
      source_text_normalized MEDIUMTEXT NOT NULL,
      translated_text MEDIUMTEXT NOT NULL,
      file_name VARCHAR(1024) NULL,
      provider VARCHAR(128) NULL,
      model VARCHAR(255) NULL,
      quality_score DECIMAL(5,2) NULL,
      usage_count INT NOT NULL DEFAULT 0,
      last_used_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tm_kitab_lang (id_kitab, source_lang, target_lang),
      INDEX idx_tm_lookup (source_lang, target_lang, source_text_normalized(255)),
      INDEX idx_tm_source_norm (source_text_normalized(255)),
      CONSTRAINT fk_translation_memory_kitab
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
        ON UPDATE CASCADE ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureTranslationGlossarySchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS translation_glossary (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      id_kitab INT NULL,
      source_lang VARCHAR(32) NOT NULL DEFAULT 'ar',
      target_lang VARCHAR(32) NOT NULL DEFAULT 'id',
      source_term VARCHAR(512) NOT NULL,
      source_term_normalized VARCHAR(512) NOT NULL,
      target_term VARCHAR(512) NOT NULL,
      notes TEXT NULL,
      priority INT NOT NULL DEFAULT 100,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_glossary_lookup (id_kitab, source_lang, target_lang, is_active, source_term_normalized(191)),
      INDEX idx_glossary_global (source_lang, target_lang, is_active, source_term_normalized(191)),
      CONSTRAINT fk_translation_glossary_kitab
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
        ON UPDATE CASCADE ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureTranslationRuntimeMetricsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS translation_runtime_metrics (
      metric_date DATE PRIMARY KEY,
      total_translate_requests INT NOT NULL DEFAULT 0,
      exact_hit_count INT NOT NULL DEFAULT 0,
      tm_reuse_count INT NOT NULL DEFAULT 0,
      ai_generation_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureSourceUnitsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS source_units (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      id_kitab INT NOT NULL,
      unit_key VARCHAR(1024) NOT NULL,
      unit_type VARCHAR(32) NOT NULL DEFAULT 'page',
      folder_path VARCHAR(1024) NULL,
      file_name VARCHAR(1024) NULL,
      file_path VARCHAR(2048) NULL,
      page_number INT NULL,
      segment_order INT NOT NULL DEFAULT 1,
      source_text MEDIUMTEXT NOT NULL,
      source_text_normalized MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_source_units_kitab_key (id_kitab, unit_key),
      INDEX idx_source_units_order (id_kitab, segment_order, page_number),
      INDEX idx_source_units_page (id_kitab, page_number),
      CONSTRAINT fk_source_units_kitab
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureTranslationVersionsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS translation_versions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      translation_id BIGINT NOT NULL,
      version_number INT NOT NULL,
      translated_text MEDIUMTEXT NOT NULL,
      source_label VARCHAR(64) NOT NULL DEFAULT 'manual',
      confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0,
      low_confidence TINYINT(1) NOT NULL DEFAULT 0,
      confidence_reasons_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_translation_version (translation_id, version_number),
      INDEX idx_translation_versions_translation (translation_id, created_at),
      CONSTRAINT fk_translation_versions_translation
        FOREIGN KEY (translation_id) REFERENCES kitab_terjemahan(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureTranslationFeedbackSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS translation_feedback (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      translation_id BIGINT NOT NULL,
      version_id BIGINT NULL,
      feedback_type VARCHAR(64) NOT NULL DEFAULT 'manual_edit',
      feedback_label VARCHAR(128) NULL,
      notes TEXT NULL,
      payload_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_translation_feedback_translation (translation_id, created_at),
      INDEX idx_translation_feedback_version (version_id),
      CONSTRAINT fk_translation_feedback_translation
        FOREIGN KEY (translation_id) REFERENCES kitab_terjemahan(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT fk_translation_feedback_version
        FOREIGN KEY (version_id) REFERENCES translation_versions(id)
        ON UPDATE CASCADE ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureSemanticEmbeddingsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS semantic_embeddings (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      entity_type VARCHAR(64) NOT NULL,
      entity_id BIGINT NOT NULL,
      id_kitab INT NULL,
      source_lang VARCHAR(32) NOT NULL DEFAULT 'ar',
      target_lang VARCHAR(32) NOT NULL DEFAULT 'id',
      model_name VARCHAR(255) NOT NULL,
      text_hash VARCHAR(64) NOT NULL,
      vector_dim INT NOT NULL DEFAULT 0,
      vector_json LONGTEXT NOT NULL,
      vector_norm DOUBLE NOT NULL DEFAULT 0,
      metadata_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_semantic_embedding (entity_type, entity_id, model_name, text_hash),
      INDEX idx_semantic_embeddings_lookup (entity_type, id_kitab, source_lang, target_lang),
      INDEX idx_semantic_embeddings_entity (entity_type, entity_id),
      CONSTRAINT fk_semantic_embeddings_kitab
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
        ON UPDATE CASCADE ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureRagChunksSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      id_kitab INT NOT NULL,
      source_kind VARCHAR(32) NOT NULL,
      lang VARCHAR(16) NOT NULL,
      source_unit_id BIGINT NULL,
      translation_id BIGINT NULL,
      file_name VARCHAR(1024) NULL,
      page_number INT NULL,
      chunk_index INT NOT NULL DEFAULT 0,
      text MEDIUMTEXT NOT NULL,
      text_normalized MEDIUMTEXT NOT NULL,
      token_count INT NOT NULL DEFAULT 0,
      quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_rag_chunk_identity (
        id_kitab,
        source_kind,
        lang,
        file_name(191),
        page_number,
        chunk_index,
        source_unit_id,
        translation_id
      ),
      INDEX idx_rag_chunks_kitab_page (id_kitab, page_number, chunk_index),
      INDEX idx_rag_chunks_kitab_status (id_kitab, status),
      INDEX idx_rag_chunks_source_unit (source_unit_id),
      INDEX idx_rag_chunks_translation (translation_id),
      CONSTRAINT fk_rag_chunks_kitab
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

async function ensureTranslationStyleProfilesSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS translation_style_profiles (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      scope_type VARCHAR(32) NOT NULL DEFAULT 'global',
      scope_key VARCHAR(255) NULL,
      source_lang VARCHAR(32) NOT NULL DEFAULT 'ar',
      target_lang VARCHAR(32) NOT NULL DEFAULT 'id',
      profile_name VARCHAR(255) NULL,
      summary_text MEDIUMTEXT NOT NULL,
      rules_json LONGTEXT NULL,
      sample_count INT NOT NULL DEFAULT 0,
      source_policy_json LONGTEXT NULL,
      metadata_json LONGTEXT NULL,
      version_number INT NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      created_by VARCHAR(128) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      activated_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_style_profile_scope (scope_type, source_lang, target_lang, created_at),
      INDEX idx_style_profile_active (scope_type, source_lang, target_lang, is_active, activated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

function clampConfidenceScore(input) {
  const num = Number(input)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(1, num))
}

function computeTranslationConfidence({
  sourceText,
  translatedText,
  sourceLabel = 'manual'
} = {}) {
  const source = String(sourceText || '').trim()
  const translated = String(translatedText || '').trim()
  const label = String(sourceLabel || 'manual').trim().toLowerCase()
  const reasons = []
  let score = label.startsWith('manual') ? 0.95 : label.includes('ai') ? 0.72 : 0.8

  if (!translated) {
    score = 0
    reasons.push('translated_text_empty')
  }

  if (source && translated) {
    const srcNorm = normalizeArabicText(source)
    const tgtNorm = normalizeArabicText(translated)
    if (srcNorm && srcNorm === tgtNorm) {
      score -= 0.45
      reasons.push('translated_text_same_as_source')
    }

    const srcLen = source.length || 1
    const tgtLen = translated.length || 0
    const ratio = tgtLen / srcLen
    if (ratio < 0.22) {
      score -= 0.28
      reasons.push('translated_text_too_short')
    } else if (ratio > 3.2) {
      score -= 0.18
      reasons.push('translated_text_too_long')
    }
  }

  if (/[\u0600-\u06FF]{8,}/.test(translated)) {
    score -= 0.15
    reasons.push('contains_long_arabic_span')
  }

  if (/[?？]\s*$/.test(translated) && !/[?؟]\s*$/.test(source)) {
    score -= 0.08
    reasons.push('unexpected_question_tone')
  }

  if (translated.split(/\s+/).filter(Boolean).length <= 2 && source.split(/\s+/).filter(Boolean).length >= 8) {
    score -= 0.18
    reasons.push('suspiciously_short_phrase')
  }

  const normalizedScore = clampConfidenceScore(score)
  return {
    confidence_score: normalizedScore,
    low_confidence: normalizedScore < 0.6 ? 1 : 0,
    confidence_reasons: reasons
  }
}

export function evaluateTranslationConfidence(payload = {}) {
  return computeTranslationConfidence(payload)
}

function buildTextHash(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex')
}

function normalizeEmbeddingVector(input) {
  const raw = Array.isArray(input) ? input : []
  const vector = raw
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  return {
    vector,
    vector_dim: vector.length,
    vector_norm: norm
  }
}

function parseEmbeddingVectorJson(input) {
  const parsed = parseJsonValue(input, [])
  const normalized = normalizeEmbeddingVector(parsed)
  return normalized.vector
}

function parsePageNumberFromName(fileName) {
  const name = String(fileName || '')
  const base = path.parse(name).name
  const trailing = base.match(/(\d+)$/)
  if (trailing) return Number.parseInt(trailing[1], 10)
  const anyDigits = base.match(/(\d+)/)
  if (anyDigits) return Number.parseInt(anyDigits[1], 10)
  return null
}

function sortTextFilePaths(filePaths, baseFolder = '') {
  return [...(Array.isArray(filePaths) ? filePaths : [])].sort((a, b) => {
    const ra = baseFolder ? a.replace(baseFolder + '\\', '').replace(baseFolder + '/', '') : a
    const rb = baseFolder ? b.replace(baseFolder + '\\', '').replace(baseFolder + '/', '') : b
    const ba = path.parse(ra).name
    const bb = path.parse(rb).name
    const na = parsePageNumberFromName(ba)
    const nb = parsePageNumberFromName(bb)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
    return ba.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function splitArabicTextIntoSegments(input, { minChars = 180, maxChars = 900 } = {}) {
  const raw = String(input || '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return []

  const paragraphBlocks = raw
    .split(/\n\s*\n+/)
    .map(block => block.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
    .map(block => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const chunks = []
  const pushChunk = (text) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim()
    if (!value) return
    chunks.push(value)
  }

  for (const block of paragraphBlocks) {
    if (block.length <= maxChars) {
      pushChunk(block)
      continue
    }

    const sentenceLikeParts = block
      .split(/(?<=[.!?؟؛۔:])\s+|\s*\n+\s*/u)
      .map(part => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    if (sentenceLikeParts.length <= 1) {
      for (let cursor = 0; cursor < block.length; cursor += maxChars) {
        pushChunk(block.slice(cursor, cursor + maxChars))
      }
      continue
    }

    let current = ''
    for (const part of sentenceLikeParts) {
      const candidate = current ? `${current} ${part}` : part
      if (candidate.length <= maxChars) {
        current = candidate
        continue
      }
      if (current) pushChunk(current)
      current = part
      while (current.length > maxChars) {
        pushChunk(current.slice(0, maxChars))
        current = current.slice(maxChars).trim()
      }
    }
    if (current) pushChunk(current)
  }

  if (chunks.length <= 1) return chunks

  const merged = []
  for (const chunk of chunks) {
    const previous = merged.length > 0 ? merged[merged.length - 1] : ''
    if (previous && previous.length < minChars && previous.length + 1 + chunk.length <= maxChars) {
      merged[merged.length - 1] = `${previous} ${chunk}`.trim()
    } else {
      merged.push(chunk)
    }
  }
  return merged
}

function buildSourceUnitKey({ folderPath, filePath, fileName, unitType = 'page', pageNumber, segmentOrder } = {}) {
  const normalizedFolder = String(folderPath || '').trim()
  const normalizedFilePath = String(filePath || '').trim()
  if (normalizedFolder && normalizedFilePath) {
    const rel = path.relative(normalizedFolder, normalizedFilePath).replace(/\\/g, '/')
    if (rel && rel !== '.') {
      if (unitType === 'segment') return `${unitType}:${rel}#${segmentOrder || 1}`
      return `${unitType}:${rel}`
    }
  }
  if (fileName) {
    const normalizedFileName = String(fileName).replace(/\\/g, '/')
    if (unitType === 'segment') return `${unitType}:${normalizedFileName}#${segmentOrder || 1}`
    return `${unitType}:${normalizedFileName}`
  }
  if (pageNumber) return `${unitType}:page:${pageNumber}`
  return `${unitType}:segment:${segmentOrder || 1}`
}

function mapSourceUnitRow(row) {
  if (!row) return null
  return {
    id: row.id,
    id_kitab: row.id_kitab,
    unit_key: row.unit_key,
    unit_type: row.unit_type,
    folder_path: row.folder_path || null,
    file_name: row.file_name || null,
    file_path: row.file_path || null,
    page_number: row.page_number == null ? null : Number(row.page_number),
    segment_order: Number(row.segment_order || 0),
    source_text: row.source_text,
    source_text_normalized: row.source_text_normalized,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

async function upsertSourceUnitEntry({
  idKitab,
  kitabName,
  folderPath,
  fileName,
  filePath,
  sourceText,
  unitType = 'page',
  pageNumber = null,
  segmentOrder = 1
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureSourceUnitsSchema()
  const resolvedKitabId = idKitab || await resolveKitabId({ kitabName, folderPath, createIfMissing: false })
  if (!resolvedKitabId) return null
  const source = String(sourceText || '')
  const normalized = normalizeArabicText(source)
  if (!source.trim()) return null
  const unitKey = buildSourceUnitKey({ folderPath, filePath, fileName, unitType, pageNumber, segmentOrder })
  await dbPool.query(
    `INSERT INTO source_units
      (id_kitab, unit_key, unit_type, folder_path, file_name, file_path, page_number, segment_order, source_text, source_text_normalized)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       folder_path = VALUES(folder_path),
       file_name = VALUES(file_name),
       file_path = VALUES(file_path),
       page_number = VALUES(page_number),
       segment_order = VALUES(segment_order),
       source_text = VALUES(source_text),
       source_text_normalized = VALUES(source_text_normalized),
       updated_at = CURRENT_TIMESTAMP`,
    [
      resolvedKitabId,
      unitKey,
      unitType,
      folderPath || null,
      fileName || null,
      filePath || null,
      pageNumber == null ? null : Number(pageNumber),
      Number(segmentOrder) || 1,
      source,
      normalized
    ]
  )
  const [rows] = await dbPool.query(
    'SELECT * FROM source_units WHERE id_kitab = ? AND unit_key = ? LIMIT 1',
    [resolvedKitabId, unitKey]
  )
  return rows && rows.length > 0 ? mapSourceUnitRow(rows[0]) : null
}

async function listTopLevelTxtFiles(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt') && entry.name.toLowerCase() !== 'all_pages.txt')
    .map(entry => path.join(folderPath, entry.name))
  return sortTextFilePaths(files, folderPath)
}

export function getDbConfig() {
  return { ...dbConfig }
}

export function setDbConfig(partial) {
  if (partial && typeof partial === 'object') {
    if (typeof partial.host === 'string') dbConfig.host = partial.host
    if (typeof partial.user === 'string') dbConfig.user = partial.user
    if (typeof partial.password === 'string') dbConfig.password = partial.password
    if (typeof partial.database === 'string') dbConfig.database = partial.database
  }
  dbReady = false
  dbError = null
}

export async function initMySql() {
  try {
    const serverConn = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password
    })
    await serverConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    await serverConn.end()

    dbPool = await mysql.createPool({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    })

    const createMaster = `
      CREATE TABLE IF NOT EXISTS master_kitab (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama_kitab VARCHAR(255) NOT NULL,
        pengarang VARCHAR(255),
        keterangan TEXT,
        folder_path VARCHAR(1024),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `
    const createTerjemahan = `
      CREATE TABLE IF NOT EXISTS kitab_terjemahan (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        id_kitab INT NOT NULL,
        text_original MEDIUMTEXT NOT NULL,
        text_translate MEDIUMTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
          ON UPDATE CASCADE ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `
    await dbPool.query(createMaster)
    await dbPool.query(createTerjemahan)

    try {
      const [mi] = await dbPool.query(
        `SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'master_kitab'`,
        [dbConfig.database]
      )
      if (mi && mi[0] && String(mi[0].ENGINE).toUpperCase() !== 'INNODB') {
        await dbPool.query(`ALTER TABLE master_kitab ENGINE=InnoDB`)
      }
    } catch (e) {
      console.warn('[DB] Could not ensure InnoDB for master_kitab:', e.message)
    }

    try {
      const [ti] = await dbPool.query(
        `SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kitab_terjemahan'`,
        [dbConfig.database]
      )
      if (ti && ti[0] && String(ti[0].ENGINE).toUpperCase() !== 'INNODB') {
        await dbPool.query(`ALTER TABLE kitab_terjemahan ENGINE=InnoDB`)
      }
    } catch (e) {
      console.warn('[DB] Could not ensure InnoDB for kitab_terjemahan:', e.message)
    }

    const createFolders = `
      CREATE TABLE IF NOT EXISTS kitab_folders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_kitab INT NOT NULL,
        folder_path VARCHAR(1024) NOT NULL,
        image_folder_path VARCHAR(1024),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_kitab_folder (id_kitab, folder_path)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `
    await dbPool.query(createFolders)
    await ensureTranslationMemorySchema()
    await ensureTranslationGlossarySchema()
    await ensureTranslationRuntimeMetricsSchema()
    await ensureSourceUnitsSchema()
    await ensureTranslationVersionsSchema()
    await ensureTranslationFeedbackSchema()
    await ensureSemanticEmbeddingsSchema()
    await ensureRagChunksSchema()
    await ensureTranslationStyleProfilesSchema()

    try {
      const [fnCol] = await dbPool.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kitab_terjemahan' AND COLUMN_NAME = 'file_name'`,
        [dbConfig.database]
      )
      if (fnCol && fnCol[0] && Number(fnCol[0].cnt) === 0) {
        await dbPool.query(`ALTER TABLE kitab_terjemahan ADD COLUMN file_name VARCHAR(1024) NULL`)
      }
    } catch (e) {
      console.warn('[DB] Could not verify/add file_name column:', e.message)
    }

    try {
      const extraColumns = [
        { name: 'confidence_score', sql: 'ALTER TABLE kitab_terjemahan ADD COLUMN confidence_score DECIMAL(5,2) NULL' },
        { name: 'low_confidence', sql: 'ALTER TABLE kitab_terjemahan ADD COLUMN low_confidence TINYINT(1) NOT NULL DEFAULT 0' },
        { name: 'confidence_reasons_json', sql: 'ALTER TABLE kitab_terjemahan ADD COLUMN confidence_reasons_json LONGTEXT NULL' },
        { name: 'current_version_id', sql: 'ALTER TABLE kitab_terjemahan ADD COLUMN current_version_id BIGINT NULL' }
      ]
      for (const col of extraColumns) {
        const [rows] = await dbPool.query(
          `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kitab_terjemahan' AND COLUMN_NAME = ?`,
          [dbConfig.database, col.name]
        )
        if (rows && rows[0] && Number(rows[0].cnt) === 0) {
          try {
            await dbPool.query(col.sql)
          } catch (e) {
            if (!/Duplicate column name/i.test(String(e?.message || ''))) throw e
          }
        }
      }
    } catch (e) {
      console.warn('[DB] Could not verify/add confidence columns on kitab_terjemahan:', e.message)
    }

    try {
      const [imgCol] = await dbPool.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kitab_folders' AND COLUMN_NAME = 'image_folder_path'`,
        [dbConfig.database]
      )
      if (imgCol && imgCol[0] && Number(imgCol[0].cnt) === 0) {
        await dbPool.query(`ALTER TABLE kitab_folders ADD COLUMN image_folder_path VARCHAR(1024) NULL`)
      }
    } catch (e) {
      console.warn('[DB] Could not verify/add image_folder_path column:', e.message)
    }

    // Safety: ensure folder_path column exists (for older DBs)
    try {
      const [colRows] = await dbPool.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'master_kitab' AND COLUMN_NAME = 'folder_path'`,
        [dbConfig.database]
      )
      if (colRows && colRows[0] && Number(colRows[0].cnt) === 0) {
        await dbPool.query(`ALTER TABLE master_kitab ADD COLUMN folder_path VARCHAR(1024) NULL`)
      }
    } catch (e) {
      console.warn('[DB] Could not verify/add folder_path column:', e.message)
    }

    try {
      const [migRows] = await dbPool.query(
        `SELECT COUNT(*) AS cnt FROM kitab_folders`
      )
      if (migRows && migRows[0] && Number(migRows[0].cnt) === 0) {
        await dbPool.query(
          `INSERT INTO kitab_folders (id_kitab, folder_path)
           SELECT id, folder_path FROM master_kitab WHERE folder_path IS NOT NULL AND folder_path <> ''`
        )
      }
    } catch (e) {
      console.warn('[DB] Initial folders migration failed:', e.message)
    }

    dbReady = true
    dbError = null
    console.log(`[DB] Connected: ${dbConfig.user}@${dbConfig.host}/${dbConfig.database}`)
  } catch (e) {
    dbReady = false
    dbError = e.message
    console.error('[DB] Initialization error:', e)
  }
}

async function ensureKitabFoldersSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createFolders = `
    CREATE TABLE IF NOT EXISTS kitab_folders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_kitab INT NOT NULL,
      folder_path VARCHAR(1024) NOT NULL,
      image_folder_path VARCHAR(1024),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_kitab_folder (id_kitab, folder_path)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createFolders)
  const [imgCol] = await dbPool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kitab_folders' AND COLUMN_NAME = 'image_folder_path'`,
    [dbConfig.database]
  )
  if (imgCol && imgCol[0] && Number(imgCol[0].cnt) === 0) {
    await dbPool.query(`ALTER TABLE kitab_folders ADD COLUMN image_folder_path VARCHAR(1024) NULL`)
  }
}

async function ensureMasterFolderPathColumn() {
  const [colRows] = await dbPool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'master_kitab' AND COLUMN_NAME = 'folder_path'`,
    [dbConfig.database]
  )
  if (colRows && colRows[0] && Number(colRows[0].cnt) === 0) {
    await dbPool.query(`ALTER TABLE master_kitab ADD COLUMN folder_path VARCHAR(1024) NULL`)
  }
}

async function ensureApiSettingsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createApi = `
    CREATE TABLE IF NOT EXISTS api_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255) NOT NULL,
      api_key TEXT NOT NULL,
      base_url VARCHAR(1024) NULL,
      model_default VARCHAR(255) NULL,
      capabilities_json LONGTEXT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      priority_order INT NULL,
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_provider_name (provider, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createApi)
  const columns = [
    { name: 'base_url', sql: 'ALTER TABLE api_settings ADD COLUMN base_url VARCHAR(1024) NULL' },
    { name: 'model_default', sql: 'ALTER TABLE api_settings ADD COLUMN model_default VARCHAR(255) NULL' },
    { name: 'capabilities_json', sql: 'ALTER TABLE api_settings ADD COLUMN capabilities_json LONGTEXT NULL' },
    { name: 'status', sql: `ALTER TABLE api_settings ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'` },
    { name: 'priority_order', sql: 'ALTER TABLE api_settings ADD COLUMN priority_order INT NULL' },
    { name: 'meta_json', sql: 'ALTER TABLE api_settings ADD COLUMN meta_json LONGTEXT NULL' }
  ]
  for (const col of columns) {
    try {
      const [rows] = await dbPool.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'api_settings' AND COLUMN_NAME = ?`,
        [dbConfig.database, col.name]
      )
      if (rows && rows[0] && Number(rows[0].cnt) === 0) {
        await dbPool.query(col.sql)
      }
    } catch (e) {
      console.warn(`[DB] Could not verify/add api_settings.${col.name}:`, e.message)
    }
  }
}

function normalizeApiSettingCapabilities(input) {
  let values = []
  if (Array.isArray(input)) {
    values = input
  } else if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) values = parsed
      else values = trimmed.split(/[\n,]+/)
    } catch (_) {
      values = trimmed.split(/[\n,]+/)
    }
  }
  const seen = new Set()
  const normalized = []
  for (const item of values) {
    const v = String(item || '').trim().toLowerCase()
    if (!v || seen.has(v)) continue
    seen.add(v)
    normalized.push(v)
  }
  return normalized
}

function normalizeApiSettingMeta(input) {
  if (input == null) return null
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return null
    const parsed = JSON.parse(trimmed)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('meta_json harus berupa object JSON yang valid.')
    }
    return parsed
  }
  if (typeof input === 'object' && !Array.isArray(input)) return input
  throw new Error('meta_json harus berupa object JSON yang valid.')
}

function normalizeApiSettingStatus(input) {
  const value = String(input || 'active').trim().toLowerCase()
  return value === 'inactive' ? 'inactive' : 'active'
}

function normalizeApiSettingPriority(input) {
  if (input == null || input === '') return null
  const num = Number(input)
  if (!Number.isFinite(num)) throw new Error('priority_order harus berupa angka yang valid.')
  return Math.trunc(num)
}

function serializeApiSettingRow(row) {
  const capabilities = normalizeApiSettingCapabilities(row?.capabilities_json)
  let meta = null
  try {
    meta = normalizeApiSettingMeta(row?.meta_json)
  } catch (_) {
    meta = null
  }
  return {
    ...row,
    base_url: row?.base_url || '',
    model_default: row?.model_default || '',
    capabilities,
    capabilities_json: JSON.stringify(capabilities, null, 2),
    status: normalizeApiSettingStatus(row?.status),
    priority_order: row?.priority_order == null ? null : Number(row.priority_order),
    meta,
    meta_json: meta ? JSON.stringify(meta, null, 2) : ''
  }
}

function normalizeApiSettingPayload(payload = {}) {
  const capabilities = normalizeApiSettingCapabilities(
    payload.capabilities != null ? payload.capabilities : payload.capabilities_json
  )
  const meta = normalizeApiSettingMeta(
    payload.meta != null ? payload.meta : payload.meta_json
  )
  return {
    id: payload.id ? Number(payload.id) : null,
    name: String(payload.name || '').trim(),
    provider: String(payload.provider || '').trim(),
    api_key: String(payload.api_key || ''),
    base_url: String(payload.base_url || '').trim() || null,
    model_default: String(payload.model_default || '').trim() || null,
    capabilities_json: JSON.stringify(capabilities),
    status: normalizeApiSettingStatus(payload.status),
    priority_order: normalizeApiSettingPriority(payload.priority_order),
    meta_json: meta ? JSON.stringify(meta) : null
  }
}

async function ensureAgentSystemPromptsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createTbl = `
    CREATE TABLE IF NOT EXISTS agent_system_prompts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(255),
      label VARCHAR(255) NOT NULL,
      system_prompt MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_label (label),
      UNIQUE KEY uniq_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
  try {
    const [slugCol] = await dbPool.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agent_system_prompts' AND COLUMN_NAME = 'slug'`,
      [dbConfig.database]
    )
    if (slugCol && slugCol[0] && Number(slugCol[0].cnt) === 0) {
      await dbPool.query(`ALTER TABLE agent_system_prompts ADD COLUMN slug VARCHAR(255) NULL`)
      try { await dbPool.query(`ALTER TABLE agent_system_prompts ADD UNIQUE KEY uniq_slug (slug)`) } catch (_) {}
    }
  } catch (_) {}
}

async function ensureAgentPromptBindingsSchema() {
  if (!dbPool) throw new Error('Database not ready')
  await ensureAgentSystemPromptsSchema()
  const createTbl = `
    CREATE TABLE IF NOT EXISTS agent_prompt_bindings (
      category VARCHAR(255) PRIMARY KEY,
      prompt_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_agent_prompt_bindings_prompt
        FOREIGN KEY (prompt_id) REFERENCES agent_system_prompts(id)
        ON UPDATE CASCADE ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createTbl)
}

 
export async function listKitabs() {
  if (!dbReady) throw new Error('Database not ready')
  const [rows] = await dbPool.query(
    'SELECT id, nama_kitab, pengarang, keterangan, folder_path, created_at FROM master_kitab ORDER BY created_at DESC, id DESC'
  )
  const ids = rows.map(r => r.id)
  if (ids.length === 0) return rows
  const placeholders = ids.map(() => '?').join(',')
  const [fRows] = await dbPool.query(
    `SELECT id_kitab, folder_path, image_folder_path FROM kitab_folders WHERE id_kitab IN (${placeholders})`,
    ids
  )
  const map = new Map()
  const mapDetail = new Map()
  for (const f of fRows) {
    const arr = map.get(f.id_kitab) || []
    arr.push(f.folder_path)
    map.set(f.id_kitab, arr)
    const ad = mapDetail.get(f.id_kitab) || []
    ad.push({ folder_path: f.folder_path, image_folder_path: f.image_folder_path || '' })
    mapDetail.set(f.id_kitab, ad)
  }
  for (const r of rows) {
    r.folders = map.get(r.id) || (r.folder_path ? [r.folder_path] : [])
    r.folders_detail = mapDetail.get(r.id) || (r.folder_path ? [{ folder_path: r.folder_path, image_folder_path: '' }] : [])
  }
  return rows
}

export async function findKitabByFolder(folderPath) {
  if (!dbReady) throw new Error('Database not ready')
  const fpBack = (folderPath || '').replace(/\//g, '\\')
  const fpForward = fpBack.replace(/\\/g, '/')
  const parentBack = fpBack ? path.dirname(fpBack) : ''
  const parentForward = parentBack ? parentBack.replace(/\\/g, '/') : ''
  const likeBack = parentBack || fpBack
  const likeForward = parentForward || fpForward
  const [rows] = await dbPool.query(
    `SELECT mk.id, mk.nama_kitab, mk.pengarang, mk.keterangan, mk.folder_path, mk.created_at
     FROM master_kitab mk
     LEFT JOIN kitab_folders kf ON kf.id_kitab = mk.id
     WHERE kf.folder_path = ?
        OR kf.folder_path = ?
        OR kf.folder_path LIKE CONCAT(?, '%')
        OR kf.folder_path LIKE CONCAT(?, '%')
        OR mk.folder_path = ?
        OR mk.folder_path = ?
        OR mk.folder_path LIKE CONCAT(?, '%')
        OR mk.folder_path LIKE CONCAT(?, '%')
     ORDER BY mk.id DESC
     LIMIT 1`,
    [fpBack, fpForward, likeBack, likeForward, fpBack, fpForward, likeBack, likeForward]
  )
  return rows && rows.length > 0 ? rows[0] : null
}

export async function createKitab({ nama_kitab, pengarang, keterangan, folder_path, folder_paths, folder_pairs }) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureMasterFolderPathColumn()
  await ensureKitabFoldersSchema()
  const firstFolder = (Array.isArray(folder_paths) && folder_paths.length > 0)
    ? (typeof folder_paths[0] === 'string' ? folder_paths[0] : folder_paths[0]?.folder_path || null)
    : (Array.isArray(folder_pairs) && folder_pairs.length > 0 ? folder_pairs[0]?.folder_path || null : (folder_path || null))
  const [res] = await dbPool.query(
    'INSERT INTO master_kitab (nama_kitab, pengarang, keterangan, folder_path) VALUES (?, ?, ?, ?)',
    [nama_kitab || '', pengarang || '', keterangan || '', firstFolder]
  )
  const id = res.insertId
  if (Array.isArray(folder_pairs) && folder_pairs.length > 0) {
    for (const p of folder_pairs) {
      const fp = p?.folder_path
      const img = p?.image_folder_path || null
      if (fp) {
        try { await dbPool.query('INSERT IGNORE INTO kitab_folders (id_kitab, folder_path, image_folder_path) VALUES (?, ?, ?)', [id, fp, img]) } catch (_) {}
      }
    }
  } else {
    const folders = Array.isArray(folder_paths) ? folder_paths : (firstFolder ? [firstFolder] : [])
    for (const fp of folders) {
      if (!fp) continue
      try {
        await dbPool.query('INSERT IGNORE INTO kitab_folders (id_kitab, folder_path) VALUES (?, ?)', [id, fp])
      } catch (_) {}
    }
  }
  return { id }
}

export async function listKitabFolders(idKitab) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureKitabFoldersSchema()
  const [rows] = await dbPool.query('SELECT id, folder_path, image_folder_path FROM kitab_folders WHERE id_kitab = ? ORDER BY id ASC', [idKitab])
  return rows
}

export async function addKitabFolder(idKitab, folderPath, imageFolderPath) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureKitabFoldersSchema()
  await dbPool.query('INSERT IGNORE INTO kitab_folders (id_kitab, folder_path, image_folder_path) VALUES (?, ?, ?)', [idKitab, folderPath, imageFolderPath || null])
  const [r] = await dbPool.query('SELECT folder_path FROM master_kitab WHERE id = ? LIMIT 1', [idKitab])
  if (r && r[0] && (!r[0].folder_path || r[0].folder_path.length === 0)) {
    await dbPool.query('UPDATE master_kitab SET folder_path = ? WHERE id = ?', [folderPath, idKitab])
  }
  return { ok: true }
}

export async function removeKitabFolder(idKitab, folderPath) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureKitabFoldersSchema()
  await dbPool.query('DELETE FROM kitab_folders WHERE id_kitab = ? AND folder_path = ?', [idKitab, folderPath])
  return { ok: true }
}

export async function getKitabDetailByFolder(folderPath) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureKitabFoldersSchema()
  const base = await findKitabByFolder(folderPath)
  if (!base) return null
  const folders = await listKitabFolders(base.id)
  const pairs = (folders || []).map(f => ({ folder_path: f.folder_path, image_folder_path: f.image_folder_path || '' }))
  return { ...base, folders: pairs.map(p => p.folder_path), folders_detail: pairs }
}

export async function getKitabDetailById(idKitab) {
  if (!dbReady) throw new Error('Database not ready')
  const [rows] = await dbPool.query(
    'SELECT id, nama_kitab, pengarang, keterangan, folder_path, created_at FROM master_kitab WHERE id = ? LIMIT 1',
    [idKitab]
  )
  if (!rows || rows.length === 0) return null
  const base = rows[0]
  const folders = await listKitabFolders(base.id)
  const pairs = (folders || []).map(f => ({ folder_path: f.folder_path, image_folder_path: f.image_folder_path || '' }))
  return { ...base, folders: pairs.map(p => p.folder_path), folders_detail: pairs }
}

export async function updateKitab({ id, nama_kitab, pengarang, keterangan, folder_paths, folder_pairs }) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureMasterFolderPathColumn()
  await ensureKitabFoldersSchema()
  if (!id) throw new Error('id is required')
  const firstFolder = Array.isArray(folder_pairs) && folder_pairs.length > 0
    ? (folder_pairs[0]?.folder_path || null)
    : (Array.isArray(folder_paths) && folder_paths.length > 0
      ? (typeof folder_paths[0] === 'string' ? folder_paths[0] : folder_paths[0]?.folder_path || null)
      : null)
  await dbPool.query(
    'UPDATE master_kitab SET nama_kitab = ?, pengarang = ?, keterangan = ?, folder_path = ? WHERE id = ?',
    [nama_kitab || '', pengarang || '', keterangan || '', firstFolder, id]
  )
  await dbPool.query('DELETE FROM kitab_folders WHERE id_kitab = ?', [id])
  const pairs = Array.isArray(folder_pairs) ? folder_pairs : (Array.isArray(folder_paths) ? folder_paths.map(fp => (typeof fp === 'string' ? { folder_path: fp, image_folder_path: null } : fp)) : [])
  for (const p of pairs) {
    const fp = p?.folder_path
    const img = p?.image_folder_path || null
    if (fp) await dbPool.query('INSERT IGNORE INTO kitab_folders (id_kitab, folder_path, image_folder_path) VALUES (?, ?, ?)', [id, fp, img])
  }
  return { ok: true }
}

export async function deleteKitab(idKitab) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureKitabFoldersSchema()
  await dbPool.query('DELETE FROM kitab_folders WHERE id_kitab = ?', [idKitab])
  await dbPool.query('DELETE FROM kitab_terjemahan WHERE id_kitab = ?', [idKitab])
  await dbPool.query('DELETE FROM master_kitab WHERE id = ?', [idKitab])
  return { ok: true }
}

export async function searchGlobal(keyword, { idKitab = null, limit = 100 } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureKitabFoldersSchema()
  
  const trimmed = (String(keyword || '')).trim()
  if (!trimmed) return []

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  const likeAny = tokens.map(t => `%${t}%`)
  const merged = `%${trimmed.replace(/\s+/g, '%')}%`
  const buildFieldCond = (field, count) => {
    const parts = []
    for (let i = 0; i < count; i++) parts.push(`LOWER(${field}) LIKE ?`)
    return `(${parts.join(' OR ')})`
  }
  const perFieldCount = likeAny.length + 1
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 200))
  const kitabId =
    idKitab != null && idKitab !== '' && Number.isFinite(Number(idKitab))
      ? Number(idKitab)
      : null

  const condTranslations = [
    buildFieldCond('t.text_original', perFieldCount),
    buildFieldCond('t.text_translate', perFieldCount),
    buildFieldCond('m.nama_kitab', perFieldCount),
    buildFieldCond('m.keterangan', perFieldCount)
  ].join(' OR ')

  const condMaster = [
    buildFieldCond('m.nama_kitab', perFieldCount),
    buildFieldCond('m.keterangan', perFieldCount)
  ].join(' OR ')

  const kitabFilterT = kitabId != null ? 'AND t.id_kitab = ?' : ''
  const kitabFilterM = kitabId != null ? 'AND m.id = ?' : ''

  const query = `
    (SELECT
      t.id AS translation_id,
      t.text_original,
      t.text_translate,
      t.file_name,
      m.id AS kitab_id,
      m.nama_kitab,
      m.folder_path AS kitab_folder_path,
      t.created_at AS sort_date
    FROM kitab_terjemahan t
    JOIN master_kitab m ON t.id_kitab = m.id
    WHERE (${condTranslations}) ${kitabFilterT})
    
    UNION

    (SELECT
      NULL AS translation_id,
      NULL AS text_original,
      m.keterangan AS text_translate,
      NULL AS file_name,
      m.id AS kitab_id,
      m.nama_kitab,
      m.folder_path AS kitab_folder_path,
      m.created_at AS sort_date
    FROM master_kitab m
    WHERE (${condMaster}) ${kitabFilterM})

    ORDER BY sort_date DESC
    LIMIT ?
  `

  const params = []
  const pushPatterns = () => { params.push(...likeAny, merged) }
  pushPatterns() // t.text_original
  pushPatterns() // t.text_translate
  pushPatterns() // m.nama_kitab
  pushPatterns() // m.keterangan
  if (kitabId != null) params.push(kitabId)
  pushPatterns() // m.nama_kitab (master)
  pushPatterns() // m.keterangan (master)
  if (kitabId != null) params.push(kitabId)
  params.push(boundedLimit)

  const [rows] = await dbPool.query(query, params)
  return (rows || []).map((row) => ({
    ...row,
    match_type: 'keyword',
    similarity_score: null,
    chunk_id: null
  }))
}

function mapTranslationMemoryRow(row, matchType) {
  if (!row) return null
  return {
    id: row.id,
    id_kitab: row.id_kitab,
    text_original: row.source_text,
    text_translate: row.translated_text,
    file_name: row.file_name || null,
    provider: row.provider || null,
    model: row.model || null,
    quality_score: row.quality_score == null ? null : Number(row.quality_score),
    usage_count: Number(row.usage_count || 0),
    feedback_count: Number(row.feedback_count || 0),
    has_explicit_approval: Number(row.has_explicit_approval || 0),
    has_review_signal: Number(row.has_review_signal || 0),
    has_rejection: Number(row.has_rejection || 0),
    feedback_boost: Number(row.feedback_boost || 0),
    approval_status: row.approval_status || 'unreviewed',
    created_at: row.created_at,
    updated_at: row.updated_at,
    match_type: matchType || null,
    source_table: 'translation_memory'
  }
}

function buildTranslationFeedbackSignalSql(memoryAlias = 'tm') {
  return {
    join: `
      LEFT JOIN kitab_terjemahan kt_fb
        ON ${memoryAlias}.id_kitab <=> kt_fb.id_kitab
       AND ${memoryAlias}.source_text = kt_fb.text_original
       AND ${memoryAlias}.translated_text = kt_fb.text_translate
      LEFT JOIN (
        SELECT
          translation_id,
          MAX(
            CASE
              WHEN LOWER(COALESCE(feedback_type, '')) = 'approval'
                OR LOWER(COALESCE(feedback_label, '')) IN ('approved', 'translation_approved', 'review_approved')
              THEN 1 ELSE 0
            END
          ) AS has_explicit_approval,
          MAX(
            CASE
              WHEN LOWER(COALESCE(feedback_type, '')) IN ('review', 'manual_confirmation')
                OR LOWER(COALESCE(feedback_label, '')) IN ('reviewed', 'confirmed', 'translation_confirmed')
              THEN 1 ELSE 0
            END
          ) AS has_review_signal,
          MAX(
            CASE
              WHEN LOWER(COALESCE(feedback_type, '')) IN ('rejection')
                OR LOWER(COALESCE(feedback_label, '')) IN ('rejected', 'translation_rejected', 'review_rejected')
              THEN 1 ELSE 0
            END
          ) AS has_rejection,
          COUNT(*) AS feedback_count
        FROM translation_feedback
        GROUP BY translation_id
      ) fb_tm
        ON fb_tm.translation_id = kt_fb.id`,
    select: `
      COALESCE(fb_tm.has_explicit_approval, 0) AS has_explicit_approval,
      COALESCE(fb_tm.has_review_signal, 0) AS has_review_signal,
      COALESCE(fb_tm.has_rejection, 0) AS has_rejection,
      COALESCE(fb_tm.feedback_count, 0) AS feedback_count,
      CASE
        WHEN COALESCE(fb_tm.has_rejection, 0) = 1 THEN 'rejected'
        WHEN COALESCE(fb_tm.has_explicit_approval, 0) = 1 THEN 'approved'
        WHEN COALESCE(fb_tm.has_review_signal, 0) = 1 THEN 'reviewed'
        ELSE 'unreviewed'
      END AS approval_status,
      CASE
        WHEN COALESCE(fb_tm.has_rejection, 0) = 1 THEN -60
        WHEN COALESCE(fb_tm.has_explicit_approval, 0) = 1 THEN 40
        WHEN COALESCE(fb_tm.has_review_signal, 0) = 1 THEN 20
        ELSE LEAST(COALESCE(fb_tm.feedback_count, 0), 5)
      END AS feedback_boost`
  }
}

function mapTranslationGlossaryRow(row) {
  if (!row) return null
  return {
    id: Number(row.id || 0),
    id_kitab: row.id_kitab == null ? null : Number(row.id_kitab),
    kitab_name: row.kitab_name || null,
    source_lang: row.source_lang || 'ar',
    target_lang: row.target_lang || 'id',
    source_term: row.source_term || '',
    source_term_normalized: row.source_term_normalized || '',
    target_term: row.target_term || '',
    notes: row.notes || '',
    priority: Number(row.priority || 100),
    is_active: Number(row.is_active || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

async function incrementTranslationMemoryUsage(memoryId) {
  if (!memoryId) return
  await ensureTranslationMemorySchema()
  await dbPool.query(
    `UPDATE translation_memory
     SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [memoryId]
  )
}

export async function markTranslationMemoryUsed(memoryId) {
  if (!dbReady) throw new Error('Database not ready')
  await incrementTranslationMemoryUsage(memoryId)
  return { ok: true, id: memoryId }
}

async function findLegacyExactTranslation(idKitab, originalText) {
  if (!idKitab || !originalText) return null
  const [rows] = await dbPool.query(
    `SELECT
       id,
       id_kitab,
       text_original,
       text_translate,
       file_name,
       confidence_score,
       low_confidence,
       confidence_reasons_json,
       current_version_id,
       created_at
     FROM kitab_terjemahan
     WHERE id_kitab = ? AND text_original = ? LIMIT 1`,
    [idKitab, originalText]
  )
  if (!rows || rows.length === 0) return null
  return {
    ...rows[0],
    match_type: 'legacy_exact',
    source_table: 'kitab_terjemahan'
  }
}

function parseJsonValue(input, fallback) {
  if (!input) return fallback
  if (typeof input === 'object') return input
  try {
    return JSON.parse(String(input))
  } catch (_) {
    return fallback
  }
}

function serializeConfidenceMeta(row) {
  const confidenceScore = row?.confidence_score == null ? null : Number(row.confidence_score)
  const confidenceReasons = parseJsonValue(row?.confidence_reasons_json, [])
  return {
    confidence_score: confidenceScore,
    low_confidence: Number(row?.low_confidence || 0),
    confidence_reasons: Array.isArray(confidenceReasons) ? confidenceReasons : [],
    current_version_id: row?.current_version_id == null ? null : Number(row.current_version_id)
  }
}

function serializeTranslationStyleProfileRow(row) {
  const rules = parseJsonValue(row?.rules_json, [])
  const sourcePolicy = parseJsonValue(row?.source_policy_json, {})
  const metadata = parseJsonValue(row?.metadata_json, {})
  return {
    id: Number(row?.id || 0),
    scope_type: row?.scope_type || 'global',
    scope_key: row?.scope_key || null,
    source_lang: row?.source_lang || 'ar',
    target_lang: row?.target_lang || 'id',
    profile_name: row?.profile_name || null,
    summary_text: row?.summary_text || '',
    rules: Array.isArray(rules) ? rules : [],
    sample_count: Number(row?.sample_count || 0),
    source_policy: sourcePolicy && typeof sourcePolicy === 'object' ? sourcePolicy : {},
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    version_number: Number(row?.version_number || 1),
    is_active: Number(row?.is_active || 0) === 1,
    created_by: row?.created_by || null,
    created_at: row?.created_at || null,
    activated_at: row?.activated_at || null
  }
}

async function getLatestTranslationVersion(translationId) {
  await ensureTranslationVersionsSchema()
  const [rows] = await dbPool.query(
    `SELECT id, translation_id, version_number, translated_text, source_label, confidence_score, low_confidence, confidence_reasons_json, created_at
     FROM translation_versions
     WHERE translation_id = ?
     ORDER BY version_number DESC, id DESC
     LIMIT 1`,
    [translationId]
  )
  if (!rows || rows.length === 0) return null
  const row = rows[0]
  return {
    id: row.id,
    translation_id: row.translation_id,
    version_number: Number(row.version_number || 0),
    translated_text: row.translated_text,
    source_label: row.source_label || 'manual',
    confidence_score: row.confidence_score == null ? null : Number(row.confidence_score),
    low_confidence: Number(row.low_confidence || 0),
    confidence_reasons: Array.isArray(parseJsonValue(row.confidence_reasons_json, [])) ? parseJsonValue(row.confidence_reasons_json, []) : [],
    created_at: row.created_at
  }
}

async function createTranslationVersion({
  translationId,
  translatedText,
  sourceLabel = 'manual',
  confidenceScore = 0,
  lowConfidence = 0,
  confidenceReasons = []
} = {}) {
  await ensureTranslationVersionsSchema()
  const [rows] = await dbPool.query(
    'SELECT COALESCE(MAX(version_number), 0) AS max_version FROM translation_versions WHERE translation_id = ?',
    [translationId]
  )
  const nextVersion = Number(rows?.[0]?.max_version || 0) + 1
  const [res] = await dbPool.query(
    `INSERT INTO translation_versions
      (translation_id, version_number, translated_text, source_label, confidence_score, low_confidence, confidence_reasons_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      translationId,
      nextVersion,
      String(translatedText || ''),
      String(sourceLabel || 'manual'),
      clampConfidenceScore(confidenceScore),
      lowConfidence ? 1 : 0,
      JSON.stringify(Array.isArray(confidenceReasons) ? confidenceReasons : [])
    ]
  )
  return { id: res.insertId, version_number: nextVersion }
}

async function createTranslationFeedback({
  translationId,
  versionId = null,
  feedbackType = 'manual_edit',
  feedbackLabel = null,
  notes = null,
  payload = null
} = {}) {
  await ensureTranslationFeedbackSchema()
  const [res] = await dbPool.query(
    `INSERT INTO translation_feedback
      (translation_id, version_id, feedback_type, feedback_label, notes, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      translationId,
      versionId,
      feedbackType,
      feedbackLabel || null,
      notes || null,
      payload ? JSON.stringify(payload) : null
    ]
  )
  return { id: res.insertId }
}

async function findTranslationRowByLocator({ kitabName, folderPath, originalText, translationId = null } = {}) {
  const resolvedTranslationId = translationId == null ? null : Number(translationId)
  if (resolvedTranslationId) {
    const [rows] = await dbPool.query(
      `SELECT
         kt.id,
         kt.id_kitab,
         mk.nama_kitab,
         kt.text_original,
         kt.text_translate,
         kt.file_name,
         kt.current_version_id,
         kt.confidence_score,
         kt.low_confidence,
         kt.confidence_reasons_json,
         kt.created_at
       FROM kitab_terjemahan kt
       LEFT JOIN master_kitab mk ON mk.id = kt.id_kitab
       WHERE kt.id = ?
       LIMIT 1`,
      [resolvedTranslationId]
    )
    return rows && rows.length > 0 ? rows[0] : null
  }
  const idKitab = await resolveKitabId({ kitabName, folderPath, createIfMissing: false })
  if (!idKitab || !originalText) return null
  const [rows] = await dbPool.query(
    `SELECT
       kt.id,
       kt.id_kitab,
       mk.nama_kitab,
       kt.text_original,
       kt.text_translate,
       kt.file_name,
       kt.current_version_id,
       kt.confidence_score,
       kt.low_confidence,
       kt.confidence_reasons_json,
       kt.created_at
     FROM kitab_terjemahan kt
     LEFT JOIN master_kitab mk ON mk.id = kt.id_kitab
     WHERE kt.id_kitab = ? AND kt.text_original = ?
     LIMIT 1`,
    [idKitab, originalText]
  )
  return rows && rows.length > 0 ? rows[0] : null
}

export async function listTranslationVersions({
  kitabName,
  folderPath,
  originalText,
  translationId = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationVersionsSchema()
  const row = await findTranslationRowByLocator({ kitabName, folderPath, originalText, translationId })
  if (!row) return { translation: null, versions: [] }
  const [rows] = await dbPool.query(
    `SELECT
       id,
       translation_id,
       version_number,
       translated_text,
       source_label,
       confidence_score,
       low_confidence,
       confidence_reasons_json,
       created_at
     FROM translation_versions
     WHERE translation_id = ?
     ORDER BY version_number DESC, id DESC`,
    [row.id]
  )
  return {
    translation: {
      id: Number(row.id || 0),
      id_kitab: row.id_kitab == null ? null : Number(row.id_kitab),
      nama_kitab: row.nama_kitab || null,
      text_original: row.text_original || '',
      text_translate: row.text_translate || '',
      file_name: row.file_name || null,
      ...serializeConfidenceMeta(row),
      created_at: row.created_at
    },
    versions: (rows || []).map(item => ({
      id: Number(item.id || 0),
      translation_id: Number(item.translation_id || 0),
      version_number: Number(item.version_number || 0),
      translated_text: item.translated_text || '',
      source_label: item.source_label || 'manual',
      confidence_score: item.confidence_score == null ? null : Number(item.confidence_score),
      low_confidence: Number(item.low_confidence || 0),
      confidence_reasons: Array.isArray(parseJsonValue(item.confidence_reasons_json, [])) ? parseJsonValue(item.confidence_reasons_json, []) : [],
      created_at: item.created_at
    }))
  }
}

export async function listTranslationFeedbackHistory({
  kitabName,
  folderPath,
  originalText,
  translationId = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationFeedbackSchema()
  const row = await findTranslationRowByLocator({ kitabName, folderPath, originalText, translationId })
  if (!row) return { translationId: null, items: [] }
  const [rows] = await dbPool.query(
    `SELECT
       tf.id,
       tf.translation_id,
       tf.version_id,
       tf.feedback_type,
       tf.feedback_label,
       tf.notes,
       tf.payload_json,
       tf.created_at,
       tv.version_number
     FROM translation_feedback tf
     LEFT JOIN translation_versions tv ON tv.id = tf.version_id
     WHERE tf.translation_id = ?
     ORDER BY tf.created_at DESC, tf.id DESC`,
    [row.id]
  )
  return {
    translationId: Number(row.id || 0),
    items: (rows || []).map(item => ({
      id: Number(item.id || 0),
      translation_id: Number(item.translation_id || 0),
      version_id: item.version_id == null ? null : Number(item.version_id),
      version_number: item.version_number == null ? null : Number(item.version_number),
      feedback_type: item.feedback_type || '',
      feedback_label: item.feedback_label || '',
      notes: item.notes || '',
      payload: parseJsonValue(item.payload_json, null),
      created_at: item.created_at
    }))
  }
}

export async function submitTranslationReview({
  kitabName,
  folderPath,
  originalText,
  translationId = null,
  versionId = null,
  reviewStatus,
  actorName = null,
  notes = null,
  sourceFlow = 'split_view'
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationFeedbackSchema()
  const normalizedStatus = String(reviewStatus || '').trim().toLowerCase()
  if (!['reviewed', 'approved', 'rejected'].includes(normalizedStatus)) {
    throw new Error('reviewStatus invalid')
  }
  const row = await findTranslationRowByLocator({ kitabName, folderPath, originalText, translationId })
  if (!row) throw new Error('translation not found')
  const resolvedVersionId = versionId == null ? (row.current_version_id == null ? null : Number(row.current_version_id)) : Number(versionId)
  const typeMap = {
    reviewed: 'review',
    approved: 'approval',
    rejected: 'rejection'
  }
  const labelMap = {
    reviewed: 'reviewed',
    approved: 'approved',
    rejected: 'rejected'
  }
  const res = await createTranslationFeedback({
    translationId: Number(row.id),
    versionId: resolvedVersionId,
    feedbackType: typeMap[normalizedStatus],
    feedbackLabel: labelMap[normalizedStatus],
    notes,
    payload: {
      actor_name: actorName || null,
      source_flow: sourceFlow || 'split_view',
      review_status: normalizedStatus
    }
  })
  return {
    ok: true,
    feedback_id: res.id,
    translation_id: Number(row.id),
    version_id: resolvedVersionId,
    review_status: normalizedStatus
  }
}

async function enrichTranslationRow(row) {
  if (!row) return null
  const latestVersion = row.id ? await getLatestTranslationVersion(row.id) : null
  return {
    ...row,
    ...serializeConfidenceMeta(row),
    latest_version: latestVersion
  }
}

export async function upsertTranslationMemoryEntry({
  idKitab = null,
  kitabName,
  folderPath,
  sourceText,
  translatedText,
  fileName = null,
  sourceLang = 'ar',
  targetLang = 'id',
  provider = null,
  model = null,
  qualityScore = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationMemorySchema()
  const resolvedKitabId = idKitab || await resolveKitabId({ kitabName, folderPath, createIfMissing: false })
  const source = String(sourceText || '')
  const translated = String(translatedText || '')
  const normalized = normalizeArabicText(source)
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  if (!source.trim() || !translated.trim() || !normalized) {
    return { action: 'skip', id: null }
  }

  const [rows] = await dbPool.query(
    `SELECT id
     FROM translation_memory
     WHERE source_lang = ? AND target_lang = ? AND source_text_normalized = ? AND id_kitab <=> ?
     ORDER BY id DESC
     LIMIT 1`,
    [srcLang, tgtLang, normalized, resolvedKitabId]
  )

  if (rows && rows.length > 0) {
    const id = rows[0].id
    await dbPool.query(
      `UPDATE translation_memory
       SET source_text = ?, translated_text = ?, file_name = ?, provider = ?, model = ?, quality_score = ?,
           last_used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [source, translated, fileName || null, provider || null, model || null, qualityScore, id]
    )
    return { action: 'update', id }
  }

  const [res] = await dbPool.query(
    `INSERT INTO translation_memory
      (id_kitab, source_lang, target_lang, source_text, source_text_normalized, translated_text, file_name, provider, model, quality_score, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [resolvedKitabId, srcLang, tgtLang, source, normalized, translated, fileName || null, provider || null, model || null, qualityScore]
  )
  return { action: 'insert', id: res.insertId }
}

async function findTranslationMemoryExact({ idKitab, sourceText, sourceLang = 'ar', targetLang = 'id' } = {}) {
  await ensureTranslationMemorySchema()
  await ensureTranslationFeedbackSchema()
  const normalized = normalizeArabicText(sourceText)
  if (!normalized) return null
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const scopeClause = idKitab ? 'AND (tm.id_kitab = ? OR tm.id_kitab IS NULL)' : 'AND tm.id_kitab IS NULL'
  const scopeRank = idKitab ? 'CASE WHEN tm.id_kitab = ? THEN 0 ELSE 1 END' : '0'
  const feedbackSql = buildTranslationFeedbackSignalSql('tm')
  const params = idKitab
    ? [idKitab, srcLang, tgtLang, normalized, idKitab]
    : [srcLang, tgtLang, normalized]
  const [rows] = await dbPool.query(
    `SELECT tm.id, tm.id_kitab, tm.source_text, tm.translated_text, tm.file_name, tm.provider, tm.model, tm.quality_score, tm.usage_count, tm.created_at, tm.updated_at,
            ${scopeRank} AS scope_rank
            , ${feedbackSql.select}
     FROM translation_memory tm
     ${feedbackSql.join}
     WHERE tm.source_lang = ? AND tm.target_lang = ? AND tm.source_text_normalized = ? ${scopeClause}
     ORDER BY scope_rank ASC, feedback_boost DESC, CASE WHEN tm.quality_score IS NULL THEN 1 ELSE 0 END ASC, tm.quality_score DESC, tm.usage_count DESC, tm.updated_at DESC, tm.id DESC
     LIMIT 1`,
    params
  )
  return rows && rows.length > 0 ? mapTranslationMemoryRow(rows[0], 'exact') : null
}

async function findTranslationMemorySimilar({ idKitab, sourceText, sourceLang = 'ar', targetLang = 'id', limit = 5 } = {}) {
  await ensureTranslationMemorySchema()
  await ensureTranslationFeedbackSchema()
  const normalized = normalizeArabicText(sourceText)
  const tokens = buildNormalizedTokens(normalized, { minLength: 2, limit: 6 })
  if (!normalized || tokens.length === 0) return []
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const scoreExpr = tokens.map(() => 'CASE WHEN source_text_normalized LIKE ? THEN 1 ELSE 0 END').join(' + ')
  const whereExpr = tokens.map(() => 'source_text_normalized LIKE ?').join(' OR ')
  const scopeClause = idKitab ? 'AND (tm.id_kitab = ? OR tm.id_kitab IS NULL)' : 'AND tm.id_kitab IS NULL'
  const scopeRank = idKitab ? 'CASE WHEN tm.id_kitab = ? THEN 0 ELSE 1 END' : '0'
  const feedbackSql = buildTranslationFeedbackSignalSql('tm')
  const likeTokens = tokens.map(token => `%${token}%`)
  const params = []
  if (idKitab) params.push(idKitab)
  params.push(...likeTokens, normalized, srcLang, tgtLang, normalized)
  if (idKitab) params.push(idKitab)
  params.push(...likeTokens, Number(limit) || 5)
  const [rows] = await dbPool.query(
    `SELECT tm.id, tm.id_kitab, tm.source_text, tm.translated_text, tm.file_name, tm.provider, tm.model, tm.quality_score, tm.usage_count, tm.created_at, tm.updated_at,
            ${scopeRank} AS scope_rank,
            (${scoreExpr}) AS token_score,
            ABS(CHAR_LENGTH(tm.source_text_normalized) - CHAR_LENGTH(?)) AS length_gap,
            ${feedbackSql.select}
     FROM translation_memory tm
     ${feedbackSql.join}
     WHERE tm.source_lang = ? AND tm.target_lang = ? AND tm.source_text_normalized <> ? ${scopeClause}
       AND (${whereExpr.replaceAll('source_text_normalized', 'tm.source_text_normalized')})
     HAVING token_score > 0
     ORDER BY token_score DESC, feedback_boost DESC, scope_rank ASC, length_gap ASC, CASE WHEN tm.quality_score IS NULL THEN 1 ELSE 0 END ASC, tm.quality_score DESC, tm.usage_count DESC, tm.updated_at DESC
     LIMIT ?`,
    params
  )
  return (rows || []).map(row => mapTranslationMemoryRow(row, 'similar'))
}

async function findTranslationMemorySubstring({ idKitab, sourceText, sourceLang = 'ar', targetLang = 'id', limit = 5 } = {}) {
  await ensureTranslationMemorySchema()
  await ensureTranslationFeedbackSchema()
  const normalized = normalizeArabicText(sourceText)
  if (!normalized) return []
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const scopeClause = idKitab ? 'AND (tm.id_kitab = ? OR tm.id_kitab IS NULL)' : 'AND tm.id_kitab IS NULL'
  const scopeRank = idKitab ? 'CASE WHEN tm.id_kitab = ? THEN 0 ELSE 1 END' : '0'
  const feedbackSql = buildTranslationFeedbackSignalSql('tm')
  const params = idKitab
    ? [idKitab, normalized, normalized, srcLang, tgtLang, idKitab, normalized, normalized, normalized, Number(limit) || 5]
    : [normalized, normalized, srcLang, tgtLang, normalized, normalized, normalized, Number(limit) || 5]
  const [rows] = await dbPool.query(
    `SELECT tm.id, tm.id_kitab, tm.source_text, tm.translated_text, tm.file_name, tm.provider, tm.model, tm.quality_score, tm.usage_count, tm.created_at, tm.updated_at,
            ${scopeRank} AS scope_rank,
            (
              CASE WHEN ? LIKE CONCAT('%', tm.source_text_normalized, '%') THEN 2 ELSE 0 END +
              CASE WHEN tm.source_text_normalized LIKE CONCAT('%', ?, '%') THEN 1 ELSE 0 END
            ) AS substring_score,
            ${feedbackSql.select}
     FROM translation_memory tm
     ${feedbackSql.join}
     WHERE tm.source_lang = ? AND tm.target_lang = ? ${scopeClause}
       AND tm.source_text_normalized <> ?
       AND (
         ? LIKE CONCAT('%', tm.source_text_normalized, '%')
         OR tm.source_text_normalized LIKE CONCAT('%', ?, '%')
       )
     ORDER BY substring_score DESC, feedback_boost DESC, scope_rank ASC, CHAR_LENGTH(tm.source_text_normalized) DESC, CASE WHEN tm.quality_score IS NULL THEN 1 ELSE 0 END ASC, tm.quality_score DESC, tm.usage_count DESC, tm.updated_at DESC
     LIMIT ?`,
    params
  )
  return (rows || []).map(row => mapTranslationMemoryRow(row, 'substring'))
}

async function findGlossaryMatches({ idKitab, sourceText, sourceLang = 'ar', targetLang = 'id', limit = 12 } = {}) {
  await ensureTranslationGlossarySchema()
  const normalized = normalizeArabicText(sourceText)
  if (!normalized) return []
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const scopeClause = idKitab ? 'AND (id_kitab = ? OR id_kitab IS NULL)' : 'AND id_kitab IS NULL'
  const scopeRank = idKitab ? 'CASE WHEN id_kitab = ? THEN 0 ELSE 1 END' : '0'
  const params = idKitab
    ? [idKitab, srcLang, tgtLang, idKitab, normalized, Number(limit) || 12]
    : [srcLang, tgtLang, normalized, Number(limit) || 12]
  const [rows] = await dbPool.query(
    `SELECT id, id_kitab, source_term, source_term_normalized, target_term, notes, priority, is_active, created_at, updated_at,
            ${scopeRank} AS scope_rank
     FROM translation_glossary
     WHERE source_lang = ? AND target_lang = ? AND is_active = 1 ${scopeClause}
       AND ? LIKE CONCAT('%', source_term_normalized, '%')
     ORDER BY scope_rank ASC, priority ASC, CHAR_LENGTH(source_term_normalized) DESC, id DESC
     LIMIT ?`,
    params
  )
  return rows || []
}

export async function listTranslationGlossary({
  query = '',
  idKitab = undefined,
  sourceLang = 'ar',
  targetLang = 'id',
  onlyActive = null,
  limit = 200
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationGlossarySchema()
  const lim = Math.max(1, Math.min(Number(limit) || 200, 1000))
  const filters = [
    'g.source_lang = ?',
    'g.target_lang = ?'
  ]
  const params = [normalizeLangCode(sourceLang, 'ar'), normalizeLangCode(targetLang, 'id')]

  if (idKitab !== undefined && idKitab !== null && idKitab !== '') {
    filters.push('g.id_kitab <=> ?')
    params.push(Number(idKitab))
  }
  if (onlyActive === true) filters.push('g.is_active = 1')
  if (onlyActive === false) filters.push('g.is_active = 0')

  const trimmed = String(query || '').trim()
  if (trimmed) {
    const like = `%${trimmed}%`
    filters.push(`(
      g.source_term LIKE ?
      OR g.target_term LIKE ?
      OR COALESCE(g.notes, '') LIKE ?
      OR COALESCE(mk.nama_kitab, '') LIKE ?
    )`)
    params.push(like, like, like, like)
  }

  const [rows] = await dbPool.query(
    `SELECT
       g.id,
       g.id_kitab,
       mk.nama_kitab AS kitab_name,
       g.source_lang,
       g.target_lang,
       g.source_term,
       g.source_term_normalized,
       g.target_term,
       g.notes,
       g.priority,
       g.is_active,
       g.created_at,
       g.updated_at
     FROM translation_glossary g
     LEFT JOIN master_kitab mk ON mk.id = g.id_kitab
     WHERE ${filters.join(' AND ')}
     ORDER BY
       CASE WHEN g.id_kitab IS NULL THEN 1 ELSE 0 END ASC,
       g.is_active DESC,
       g.priority ASC,
       CHAR_LENGTH(g.source_term_normalized) DESC,
       g.updated_at DESC,
       g.id DESC
     LIMIT ?`,
    [...params, lim]
  )
  return (rows || []).map(mapTranslationGlossaryRow)
}

export async function upsertTranslationGlossaryEntry({
  id = null,
  idKitab = null,
  kitabName,
  folderPath,
  sourceLang = 'ar',
  targetLang = 'id',
  sourceTerm,
  targetTerm,
  notes = null,
  priority = 100,
  isActive = 1
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationGlossarySchema()
  const resolvedKitabId = idKitab === '' || idKitab === undefined
    ? null
    : (idKitab != null
      ? Number(idKitab)
      : await resolveKitabId({ kitabName, folderPath, createIfMissing: false }))
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const source = String(sourceTerm || '').trim()
  const target = String(targetTerm || '').trim()
  const normalized = normalizeArabicText(source)
  if (!source || !target || !normalized) {
    throw new Error('source_term dan target_term wajib diisi.')
  }
  const normalizedPriority = Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : 100
  const activeFlag = isActive ? 1 : 0

  if (id) {
    await dbPool.query(
      `UPDATE translation_glossary
       SET id_kitab = ?, source_lang = ?, target_lang = ?, source_term = ?, source_term_normalized = ?,
           target_term = ?, notes = ?, priority = ?, is_active = ?
       WHERE id = ?`,
      [
        resolvedKitabId,
        srcLang,
        tgtLang,
        source,
        normalized,
        target,
        notes || null,
        normalizedPriority,
        activeFlag,
        Number(id)
      ]
    )
    return { action: 'update', id: Number(id) }
  }

  const [rows] = await dbPool.query(
    `SELECT id
     FROM translation_glossary
     WHERE source_lang = ? AND target_lang = ? AND source_term_normalized = ? AND id_kitab <=> ?
     ORDER BY id DESC
     LIMIT 1`,
    [srcLang, tgtLang, normalized, resolvedKitabId]
  )
  if (rows && rows.length > 0) {
    const existingId = Number(rows[0].id)
    await dbPool.query(
      `UPDATE translation_glossary
       SET source_term = ?, target_term = ?, notes = ?, priority = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [source, target, notes || null, normalizedPriority, activeFlag, existingId]
    )
    return { action: 'update', id: existingId }
  }

  const [res] = await dbPool.query(
    `INSERT INTO translation_glossary
      (id_kitab, source_lang, target_lang, source_term, source_term_normalized, target_term, notes, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [resolvedKitabId, srcLang, tgtLang, source, normalized, target, notes || null, normalizedPriority, activeFlag]
  )
  return { action: 'insert', id: res.insertId }
}

export async function deleteTranslationGlossaryEntry(id) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationGlossarySchema()
  const pid = Number(id)
  if (!pid) throw new Error('id required')
  await dbPool.query('DELETE FROM translation_glossary WHERE id = ?', [pid])
  return { ok: true, id: pid }
}

export async function seedTranslationGlossary({
  idKitab = null,
  kitabName,
  folderPath
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationGlossarySchema()
  const resolvedKitabId = idKitab === '' || idKitab === undefined
    ? null
    : (idKitab != null
      ? Number(idKitab)
      : await resolveKitabId({ kitabName, folderPath, createIfMissing: false }))

  let inserted = 0
  let updated = 0
  for (const item of DEFAULT_GLOSSARY_SEED) {
    const res = await upsertTranslationGlossaryEntry({
      idKitab: resolvedKitabId,
      sourceLang: 'ar',
      targetLang: 'id',
      sourceTerm: item.source_term,
      targetTerm: item.target_term,
      notes: item.notes,
      priority: item.priority,
      isActive: 1
    })
    if (res.action === 'insert') inserted += 1
    else if (res.action === 'update') updated += 1
  }

  return {
    ok: true,
    scope: resolvedKitabId ? 'kitab' : 'global',
    id_kitab: resolvedKitabId,
    totalSeed: DEFAULT_GLOSSARY_SEED.length,
    inserted,
    updated
  }
}

export async function recordTranslationRuntimeMetric({
  requestCount = 0,
  exactHitCount = 0,
  tmReuseCount = 0,
  aiGenerationCount = 0
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationRuntimeMetricsSchema()
  await dbPool.query(
    `INSERT INTO translation_runtime_metrics
      (metric_date, total_translate_requests, exact_hit_count, tm_reuse_count, ai_generation_count)
     VALUES (CURRENT_DATE(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_translate_requests = total_translate_requests + VALUES(total_translate_requests),
       exact_hit_count = exact_hit_count + VALUES(exact_hit_count),
       tm_reuse_count = tm_reuse_count + VALUES(tm_reuse_count),
       ai_generation_count = ai_generation_count + VALUES(ai_generation_count)`,
    [
      Math.max(0, Math.trunc(Number(requestCount) || 0)),
      Math.max(0, Math.trunc(Number(exactHitCount) || 0)),
      Math.max(0, Math.trunc(Number(tmReuseCount) || 0)),
      Math.max(0, Math.trunc(Number(aiGenerationCount) || 0))
    ]
  )
  return { ok: true }
}

export async function getTranslationRuntimeMetricsSummary({ days = 30 } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationRuntimeMetricsSchema()
  const boundedDays = Math.max(1, Math.min(Number(days) || 30, 365))
  const [rows] = await dbPool.query(
    `SELECT
       metric_date,
       total_translate_requests,
       exact_hit_count,
       tm_reuse_count,
       ai_generation_count
     FROM translation_runtime_metrics
     WHERE metric_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
     ORDER BY metric_date DESC`,
    [boundedDays - 1]
  )
  const daily = (rows || []).map(row => {
    const total = Number(row.total_translate_requests || 0)
    const exact = Number(row.exact_hit_count || 0)
    const tmReuse = Number(row.tm_reuse_count || 0)
    return {
      metric_date: row.metric_date,
      total_translate_requests: total,
      exact_hit_count: exact,
      tm_reuse_count: tmReuse,
      ai_generation_count: Number(row.ai_generation_count || 0),
      exact_hit_rate: total > 0 ? exact / total : 0,
      tm_reuse_rate: total > 0 ? tmReuse / total : 0
    }
  })
  const totals = daily.reduce((acc, row) => {
    acc.total_translate_requests += row.total_translate_requests
    acc.exact_hit_count += row.exact_hit_count
    acc.tm_reuse_count += row.tm_reuse_count
    acc.ai_generation_count += row.ai_generation_count
    return acc
  }, {
    total_translate_requests: 0,
    exact_hit_count: 0,
    tm_reuse_count: 0,
    ai_generation_count: 0
  })
  return {
    days: boundedDays,
    totals: {
      ...totals,
      exact_hit_rate: totals.total_translate_requests > 0 ? totals.exact_hit_count / totals.total_translate_requests : 0,
      tm_reuse_rate: totals.total_translate_requests > 0 ? totals.tm_reuse_count / totals.total_translate_requests : 0
    },
    daily
  }
}

export async function getTranslationAssistContext({
  kitabName,
  folderPath,
  originalText,
  sourceLang = 'ar',
  targetLang = 'id',
  limitPerType = 5
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  const idKitab = await resolveKitabId({ kitabName, folderPath, createIfMissing: false })
  const normalizedText = normalizeArabicText(originalText)
  if (!normalizedText) {
    return {
      idKitab,
      normalizedText: '',
      glossaryHits: [],
      tmHits: { exact: null, similar: [], substring: [] }
    }
  }

  let exact = await findTranslationMemoryExact({ idKitab, sourceText: originalText, sourceLang, targetLang })
  if (!exact && idKitab) {
    const legacy = await findLegacyExactTranslation(idKitab, originalText)
    if (legacy && legacy.text_translate) {
      await upsertTranslationMemoryEntry({
        idKitab,
        sourceText: legacy.text_original,
        translatedText: legacy.text_translate,
        fileName: legacy.file_name || null,
        sourceLang,
        targetLang,
        provider: 'legacy_kitab_terjemahan',
        qualityScore: 1
      })
      exact = await findTranslationMemoryExact({ idKitab, sourceText: originalText, sourceLang, targetLang })
      if (!exact) {
        exact = {
          ...legacy,
          provider: 'legacy_kitab_terjemahan',
          model: null,
          quality_score: 1,
          approval_status: 'unreviewed',
          feedback_boost: 0
        }
      }
    }
  }

  const glossaryHits = await findGlossaryMatches({ idKitab, sourceText: originalText, sourceLang, targetLang, limit: 12 })
  const similar = await findTranslationMemorySimilar({ idKitab, sourceText: originalText, sourceLang, targetLang, limit: limitPerType })
  const substring = await findTranslationMemorySubstring({ idKitab, sourceText: originalText, sourceLang, targetLang, limit: limitPerType })

  return {
    idKitab,
    normalizedText,
    glossaryHits,
    tmHits: {
      exact,
      similar,
      substring
    }
  }
}

export async function getSemanticEmbeddingEntry({
  entityType = 'translation_memory',
  entityId,
  modelName
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!entityId) return null
  await ensureSemanticEmbeddingsSchema()
  if (modelName) {
    const [rows] = await dbPool.query(
      `SELECT id, entity_type, entity_id, id_kitab, source_lang, target_lang, model_name, text_hash, vector_dim, vector_json, vector_norm, metadata_json, created_at, updated_at
       FROM semantic_embeddings
       WHERE entity_type = ? AND entity_id = ? AND model_name = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [entityType, entityId, modelName]
    )
    if (!rows || rows.length === 0) return null
    const row = rows[0]
    return {
      ...row,
      vector: parseEmbeddingVectorJson(row.vector_json),
      metadata: parseJsonValue(row.metadata_json, null)
    }
  }
  const [rows] = await dbPool.query(
    `SELECT id, entity_type, entity_id, id_kitab, source_lang, target_lang, model_name, text_hash, vector_dim, vector_json, vector_norm, metadata_json, created_at, updated_at
     FROM semantic_embeddings
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [entityType, entityId]
  )
  if (!rows || rows.length === 0) return null
  const row = rows[0]
  return {
    ...row,
    vector: parseEmbeddingVectorJson(row.vector_json),
    metadata: parseJsonValue(row.metadata_json, null)
  }
}

export async function upsertSemanticEmbeddingEntry({
  entityType = 'translation_memory',
  entityId,
  idKitab = null,
  sourceLang = 'ar',
  targetLang = 'id',
  modelName,
  text,
  vector,
  metadata = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!entityId || !modelName) return { action: 'skip', id: null }
  const sourceText = String(text || '')
  if (!sourceText.trim()) return { action: 'skip', id: null }
  const normalized = normalizeEmbeddingVector(vector)
  if (!normalized.vector_dim || !normalized.vector_norm) return { action: 'skip', id: null }
  await ensureSemanticEmbeddingsSchema()
  const textHash = buildTextHash(sourceText)
  await dbPool.query(
    'DELETE FROM semantic_embeddings WHERE entity_type = ? AND entity_id = ? AND model_name = ?',
    [entityType, entityId, modelName]
  )
  const [res] = await dbPool.query(
    `INSERT INTO semantic_embeddings
      (entity_type, entity_id, id_kitab, source_lang, target_lang, model_name, text_hash, vector_dim, vector_json, vector_norm, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityId,
      idKitab,
      normalizeLangCode(sourceLang, 'ar'),
      normalizeLangCode(targetLang, 'id'),
      String(modelName || '').trim(),
      textHash,
      normalized.vector_dim,
      JSON.stringify(normalized.vector),
      normalized.vector_norm,
      metadata ? JSON.stringify(metadata) : null
    ]
  )
  return {
    action: 'upsert',
    id: res.insertId,
    text_hash: textHash,
    vector_dim: normalized.vector_dim
  }
}

function mapRagChunkRow(row) {
  if (!row) return null
  return {
    id: row.id,
    id_kitab: row.id_kitab,
    source_kind: row.source_kind,
    lang: row.lang,
    source_unit_id: row.source_unit_id == null ? null : Number(row.source_unit_id),
    translation_id: row.translation_id == null ? null : Number(row.translation_id),
    file_name: row.file_name || null,
    page_number: row.page_number == null ? null : Number(row.page_number),
    chunk_index: Number(row.chunk_index || 0),
    text: row.text || '',
    text_normalized: row.text_normalized || '',
    token_count: Number(row.token_count || 0),
    quality_score: row.quality_score == null ? 0 : Number(row.quality_score),
    status: row.status || 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
    kitab_folder_path: row.kitab_folder_path || null,
    nama_kitab: row.nama_kitab || null
  }
}

export async function getRagChunkById(id) {
  if (!dbReady) throw new Error('Database not ready')
  if (!id) return null
  await ensureRagChunksSchema()
  const [rows] = await dbPool.query(
    `SELECT
       rc.*,
       mk.folder_path AS kitab_folder_path,
       mk.nama_kitab
     FROM rag_chunks rc
     LEFT JOIN master_kitab mk ON mk.id = rc.id_kitab
     WHERE rc.id = ?
     LIMIT 1`,
    [id]
  )
  if (!rows || rows.length === 0) return null
  return mapRagChunkRow(rows[0])
}

export async function listRagChunks({
  idKitab = null,
  status = 'active',
  sourceKind = null,
  lang = null,
  limit = 500,
  offset = 0
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureRagChunksSchema()
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 20000))
  const boundedOffset = Math.max(0, Number(offset) || 0)
  const clauses = []
  const params = []
  if (idKitab != null && idKitab !== '') {
    clauses.push('rc.id_kitab = ?')
    params.push(Number(idKitab))
  }
  if (status) {
    clauses.push('rc.status = ?')
    params.push(String(status))
  }
  if (sourceKind) {
    clauses.push('rc.source_kind = ?')
    params.push(String(sourceKind))
  }
  if (lang) {
    clauses.push('rc.lang = ?')
    params.push(String(lang))
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await dbPool.query(
    `SELECT
       rc.*,
       mk.folder_path AS kitab_folder_path,
       mk.nama_kitab
     FROM rag_chunks rc
     LEFT JOIN master_kitab mk ON mk.id = rc.id_kitab
     ${where}
     ORDER BY rc.id_kitab ASC, rc.page_number ASC, rc.chunk_index ASC, rc.id ASC
     LIMIT ? OFFSET ?`,
    [...params, boundedLimit, boundedOffset]
  )
  return (rows || []).map(mapRagChunkRow)
}

export async function countRagChunks({
  idKitab = null,
  status = 'active',
  sourceKind = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureRagChunksSchema()
  const clauses = []
  const params = []
  if (idKitab != null && idKitab !== '') {
    clauses.push('id_kitab = ?')
    params.push(Number(idKitab))
  }
  if (status) {
    clauses.push('status = ?')
    params.push(String(status))
  }
  if (sourceKind) {
    clauses.push('source_kind = ?')
    params.push(String(sourceKind))
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await dbPool.query(
    `SELECT COUNT(*) AS cnt FROM rag_chunks ${where}`,
    params
  )
  return Number(rows?.[0]?.cnt || 0)
}

export async function upsertRagChunk({
  idKitab,
  sourceKind,
  lang,
  sourceUnitId = null,
  translationId = null,
  fileName = null,
  pageNumber = null,
  chunkIndex = 0,
  text,
  textNormalized = null,
  tokenCount = 0,
  qualityScore = 0,
  status = 'active'
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!idKitab || !sourceKind || !lang) {
    return { action: 'skip', id: null, reason: 'missing_identity' }
  }
  const body = String(text || '').trim()
  if (!body) return { action: 'skip', id: null, reason: 'empty_text' }
  await ensureRagChunksSchema()
  const normalized =
    textNormalized != null && String(textNormalized).trim()
      ? String(textNormalized).trim()
      : normalizeArabicText(body)
  const safeFileName = fileName ? String(fileName).slice(0, 1024) : null
  const safePage =
    pageNumber == null || pageNumber === '' ? null : Number(pageNumber)
  const safeChunkIndex = Math.max(0, Number(chunkIndex) || 0)
  const safeSourceUnitId =
    sourceUnitId == null || sourceUnitId === '' ? null : Number(sourceUnitId)
  const safeTranslationId =
    translationId == null || translationId === '' ? null : Number(translationId)
  const safeTokenCount = Math.max(0, Number(tokenCount) || 0)
  const safeQuality = Math.max(0, Math.min(100, Number(qualityScore) || 0))
  const safeStatus = String(status || 'active').trim() || 'active'

  const [existingRows] = await dbPool.query(
    `SELECT id FROM rag_chunks
     WHERE id_kitab = ?
       AND source_kind = ?
       AND lang = ?
       AND ((file_name IS NULL AND ? IS NULL) OR file_name = ?)
       AND ((page_number IS NULL AND ? IS NULL) OR page_number = ?)
       AND chunk_index = ?
       AND ((source_unit_id IS NULL AND ? IS NULL) OR source_unit_id = ?)
       AND ((translation_id IS NULL AND ? IS NULL) OR translation_id = ?)
     LIMIT 1`,
    [
      Number(idKitab),
      String(sourceKind),
      String(lang),
      safeFileName,
      safeFileName,
      safePage,
      safePage,
      safeChunkIndex,
      safeSourceUnitId,
      safeSourceUnitId,
      safeTranslationId,
      safeTranslationId
    ]
  )
  if (existingRows && existingRows.length > 0) {
    const id = existingRows[0].id
    await dbPool.query(
      `UPDATE rag_chunks
       SET text = ?, text_normalized = ?, token_count = ?, quality_score = ?, status = ?
       WHERE id = ?`,
      [body, normalized, safeTokenCount, safeQuality, safeStatus, id]
    )
    return { action: 'update', id }
  }

  const [res] = await dbPool.query(
    `INSERT INTO rag_chunks
      (id_kitab, source_kind, lang, source_unit_id, translation_id, file_name, page_number, chunk_index, text, text_normalized, token_count, quality_score, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(idKitab),
      String(sourceKind),
      String(lang),
      safeSourceUnitId,
      safeTranslationId,
      safeFileName,
      safePage,
      safeChunkIndex,
      body,
      normalized,
      safeTokenCount,
      safeQuality,
      safeStatus
    ]
  )
  return { action: 'insert', id: res.insertId }
}

/**
 * Soft-delete RAG chunks for a kitab (status=inactive). Does not wipe source corpus tables.
 * Also marks related semantic_embeddings metadata; vectors are left in place for safety.
 */
export async function deleteRagChunksByKitab(idKitab, { hard = false } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!idKitab) return { ok: false, affected: 0 }
  await ensureRagChunksSchema()
  const kitabId = Number(idKitab)
  if (hard) {
    const [chunkRows] = await dbPool.query(
      'SELECT id FROM rag_chunks WHERE id_kitab = ?',
      [kitabId]
    )
    const ids = (chunkRows || []).map((row) => Number(row.id)).filter(Boolean)
    if (ids.length > 0) {
      await ensureSemanticEmbeddingsSchema()
      const placeholders = ids.map(() => '?').join(',')
      await dbPool.query(
        `DELETE FROM semantic_embeddings WHERE entity_type = 'rag_chunk' AND entity_id IN (${placeholders})`,
        ids
      )
    }
    const [res] = await dbPool.query('DELETE FROM rag_chunks WHERE id_kitab = ?', [kitabId])
    return { ok: true, affected: Number(res?.affectedRows || 0), mode: 'hard' }
  }
  const [res] = await dbPool.query(
    `UPDATE rag_chunks SET status = 'inactive' WHERE id_kitab = ? AND status <> 'inactive'`,
    [kitabId]
  )
  return { ok: true, affected: Number(res?.affectedRows || 0), mode: 'soft' }
}

export async function listRagSourceUnitCandidates({
  idKitab,
  unitType = 'segment',
  limit = 5000
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!idKitab) return []
  await ensureSourceUnitsSchema()
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 20000))
  const [rows] = await dbPool.query(
    `SELECT
       su.id,
       su.id_kitab,
       su.unit_key,
       su.unit_type,
       su.folder_path,
       su.file_name,
       su.file_path,
       su.page_number,
       su.segment_order,
       su.source_text,
       su.source_text_normalized,
       mk.folder_path AS kitab_folder_path,
       mk.nama_kitab
     FROM source_units su
     LEFT JOIN master_kitab mk ON mk.id = su.id_kitab
     WHERE su.id_kitab = ?
       AND su.unit_type = ?
       AND su.source_text <> ''
       AND su.source_text_normalized <> ''
     ORDER BY su.page_number ASC, su.segment_order ASC, su.id ASC
     LIMIT ?`,
    [Number(idKitab), String(unitType || 'segment'), boundedLimit]
  )
  return rows || []
}

export async function listRagTranslationCandidates({
  idKitab,
  limit = 5000,
  skipLowConfidence = true
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!idKitab) return []
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 20000))
  const confidenceClause = skipLowConfidence
    ? 'AND COALESCE(kt.low_confidence, 0) = 0'
    : ''
  const [rows] = await dbPool.query(
    `SELECT
       kt.id,
       kt.id_kitab,
       kt.text_original,
       kt.text_translate,
       kt.file_name,
       kt.confidence_score,
       kt.low_confidence,
       mk.folder_path AS kitab_folder_path,
       mk.nama_kitab
     FROM kitab_terjemahan kt
     LEFT JOIN master_kitab mk ON mk.id = kt.id_kitab
     WHERE kt.id_kitab = ?
       AND kt.text_translate <> ''
       ${confidenceClause}
     ORDER BY kt.id ASC
     LIMIT ?`,
    [Number(idKitab), boundedLimit]
  )
  return (rows || []).map((row) => ({
    ...row,
    page_number: parsePageNumberFromName(row.file_name)
  }))
}

/**
 * Keyword hits against rag_chunks (corpus), not TM.
 */
export async function searchRagChunksByKeyword({
  keyword,
  idKitab = null,
  status = 'active',
  limit = 80
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  const trimmed = String(keyword || '').trim()
  if (!trimmed) return []
  await ensureRagChunksSchema()
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  const likeAny = tokens.map((t) => `%${t}%`)
  const merged = `%${trimmed.replace(/\s+/g, '%')}%`
  const patterns = [...likeAny, merged]
  const fieldConds = (field) =>
    patterns.map(() => `LOWER(${field}) LIKE ?`).join(' OR ')
  const clauses = [
    `(${fieldConds('rc.text')} OR ${fieldConds('rc.text_normalized')})`
  ]
  const params = [...patterns, ...patterns]
  if (status) {
    clauses.push('rc.status = ?')
    params.push(String(status))
  }
  if (idKitab != null && idKitab !== '') {
    clauses.push('rc.id_kitab = ?')
    params.push(Number(idKitab))
  }
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 80, 500))
  params.push(boundedLimit)
  const [rows] = await dbPool.query(
    `SELECT
       rc.*,
       mk.folder_path AS kitab_folder_path,
       mk.nama_kitab
     FROM rag_chunks rc
     LEFT JOIN master_kitab mk ON mk.id = rc.id_kitab
     WHERE ${clauses.join(' AND ')}
     ORDER BY rc.quality_score DESC, rc.updated_at DESC, rc.id DESC
     LIMIT ?`,
    params
  )
  return (rows || []).map(mapRagChunkRow)
}

/**
 * Prefilter rag_chunk embeddings in MySQL before app-side cosine.
 */
export async function listRagChunkEmbeddingCandidates({
  idKitab = null,
  modelName,
  status = 'active',
  lang = null,
  limit = 400
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!modelName) return []
  await ensureRagChunksSchema()
  await ensureSemanticEmbeddingsSchema()
  const clauses = [
    `se.entity_type = 'rag_chunk'`,
    'se.model_name = ?',
    'rc.status = ?'
  ]
  const params = [String(modelName).trim(), String(status || 'active')]
  if (idKitab != null && idKitab !== '') {
    clauses.push('rc.id_kitab = ?')
    params.push(Number(idKitab))
  }
  if (lang) {
    clauses.push('rc.lang = ?')
    params.push(String(lang))
  }
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 400, 2000))
  params.push(boundedLimit)
  const [rows] = await dbPool.query(
    `SELECT
       se.id AS semantic_id,
       se.entity_id AS chunk_id,
       se.model_name,
       se.text_hash,
       se.vector_dim,
       se.vector_json,
       se.vector_norm,
       se.metadata_json,
       se.updated_at AS semantic_updated_at,
       rc.id,
       rc.id_kitab,
       rc.source_kind,
       rc.lang,
       rc.source_unit_id,
       rc.translation_id,
       rc.file_name,
       rc.page_number,
       rc.chunk_index,
       rc.text,
       rc.text_normalized,
       rc.token_count,
       rc.quality_score,
       rc.status,
       rc.created_at,
       rc.updated_at,
       mk.folder_path AS kitab_folder_path,
       mk.nama_kitab
     FROM semantic_embeddings se
     JOIN rag_chunks rc ON rc.id = se.entity_id
     LEFT JOIN master_kitab mk ON mk.id = rc.id_kitab
     WHERE ${clauses.join(' AND ')}
     ORDER BY rc.quality_score DESC, se.updated_at DESC, rc.id ASC
     LIMIT ?`,
    params
  )
  return (rows || []).map((row) => ({
    ...mapRagChunkRow(row),
    chunk_id: Number(row.chunk_id || row.id),
    semantic_id: row.semantic_id,
    semantic_model: row.model_name,
    semantic_text_hash: row.text_hash,
    semantic_vector_dim: Number(row.vector_dim || 0),
    semantic_vector_norm: Number(row.vector_norm || 0),
    semantic_vector: parseEmbeddingVectorJson(row.vector_json),
    semantic_metadata: parseJsonValue(row.metadata_json, null),
    semantic_updated_at: row.semantic_updated_at
  }))
}

export async function countSemanticEmbeddingsByEntityType({
  entityType,
  idKitab = null,
  modelName = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!entityType) return 0
  await ensureSemanticEmbeddingsSchema()
  const clauses = ['entity_type = ?']
  const params = [String(entityType)]
  if (idKitab != null && idKitab !== '') {
    clauses.push('id_kitab = ?')
    params.push(Number(idKitab))
  }
  if (modelName) {
    clauses.push('model_name = ?')
    params.push(String(modelName))
  }
  const [rows] = await dbPool.query(
    `SELECT COUNT(*) AS cnt FROM semantic_embeddings WHERE ${clauses.join(' AND ')}`,
    params
  )
  return Number(rows?.[0]?.cnt || 0)
}

export async function listTranslationMemorySemanticCandidates({
  idKitab = null,
  sourceLang = 'ar',
  targetLang = 'id',
  limit = 24
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationMemorySchema()
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const scoped = idKitab
    ? {
        clause: 'AND (id_kitab = ? OR id_kitab IS NULL)',
        params: [idKitab]
      }
    : {
        clause: 'AND id_kitab IS NULL',
        params: []
      }
  const [rows] = await dbPool.query(
    `SELECT id, id_kitab, source_lang, target_lang, source_text, source_text_normalized, translated_text, file_name, provider, model, quality_score, usage_count, updated_at
     FROM translation_memory
     WHERE source_lang = ? AND target_lang = ? ${scoped.clause}
       AND source_text_normalized <> ''
       AND translated_text <> ''
     ORDER BY
       CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END ASC,
       quality_score DESC,
       usage_count DESC,
       updated_at DESC,
       id DESC
     LIMIT ?`,
    [srcLang, tgtLang, ...scoped.params, Number(limit) || 24]
  )
  return rows || []
}

export async function listTranslationMemorySemanticReindexCandidates({
  idKitab = null,
  sourceLang = 'ar',
  targetLang = 'id',
  limit = 5000
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationMemorySchema()
  await ensureTranslationFeedbackSchema()
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 20000))
  const feedbackSql = buildTranslationFeedbackSignalSql('tm')
  const scoped = idKitab
    ? {
        clause: 'AND (tm.id_kitab = ? OR tm.id_kitab IS NULL)',
        rank: 'CASE WHEN tm.id_kitab = ? THEN 0 ELSE 1 END',
        params: [idKitab, idKitab]
      }
    : {
        clause: '',
        rank: '0',
        params: []
      }
  const [rows] = await dbPool.query(
    `SELECT
       tm.id,
       tm.id_kitab,
       tm.source_lang,
       tm.target_lang,
       tm.source_text,
       tm.source_text_normalized,
       tm.translated_text,
       tm.file_name,
       tm.provider,
       tm.model,
       tm.quality_score,
       tm.usage_count,
       tm.created_at,
       tm.updated_at,
       ${scoped.rank} AS scope_rank,
       ${feedbackSql.select}
     FROM translation_memory tm
     ${feedbackSql.join}
     WHERE tm.source_lang = ?
       AND tm.target_lang = ?
       ${scoped.clause}
       AND tm.source_text_normalized <> ''
       AND tm.translated_text <> ''
     ORDER BY
       scope_rank ASC,
       has_rejection ASC,
       has_explicit_approval DESC,
       has_review_signal DESC,
       CASE WHEN tm.quality_score IS NULL THEN 1 ELSE 0 END ASC,
       tm.quality_score DESC,
       tm.usage_count DESC,
       tm.updated_at DESC,
       tm.id DESC
     LIMIT ?`,
    [srcLang, tgtLang, ...scoped.params, boundedLimit]
  )
  return (rows || []).map(row => ({
    id: Number(row.id || 0),
    id_kitab: row.id_kitab == null ? null : Number(row.id_kitab),
    source_lang: row.source_lang || srcLang,
    target_lang: row.target_lang || tgtLang,
    source_text: row.source_text || '',
    source_text_normalized: row.source_text_normalized || '',
    translated_text: row.translated_text || '',
    file_name: row.file_name || null,
    provider: row.provider || null,
    model: row.model || null,
    quality_score: row.quality_score == null ? null : Number(row.quality_score),
    usage_count: Number(row.usage_count || 0),
    feedback_count: Number(row.feedback_count || 0),
    has_explicit_approval: Number(row.has_explicit_approval || 0),
    has_review_signal: Number(row.has_review_signal || 0),
    has_rejection: Number(row.has_rejection || 0),
    feedback_boost: Number(row.feedback_boost || 0),
    approval_status: row.approval_status || 'unreviewed',
    created_at: row.created_at,
    updated_at: row.updated_at,
    scope_rank: Number(row.scope_rank || 0)
  }))
}

export async function listSourceUnitSemanticCandidates({
  idKitab = null,
  folderPath = null,
  unitType = 'segment',
  currentPageNumber = null,
  currentFileName = null,
  limit = 60
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!idKitab) return []
  await ensureSourceUnitsSchema()
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 60, 500))
  const folderRank = folderPath ? 'CASE WHEN folder_path <=> ? THEN 0 ELSE 1 END' : '0'
  const fileRank = currentFileName ? 'CASE WHEN file_name <=> ? THEN 0 ELSE 1 END' : '0'
  const pageGap = currentPageNumber != null && currentPageNumber !== ''
    ? 'ABS(COALESCE(page_number, 0) - ?)'
    : '0'
  const params = [
    ...(folderPath ? [folderPath] : []),
    ...(currentFileName ? [currentFileName] : []),
    ...(currentPageNumber != null && currentPageNumber !== '' ? [Number(currentPageNumber)] : []),
    Number(idKitab),
    String(unitType || 'segment'),
    boundedLimit
  ]
  const [rows] = await dbPool.query(
    `SELECT
       id,
       id_kitab,
       unit_key,
       unit_type,
       folder_path,
       file_name,
       file_path,
       page_number,
       segment_order,
       source_text,
       source_text_normalized,
       created_at,
       updated_at,
       ${folderRank} AS folder_rank,
       ${fileRank} AS file_rank,
       ${pageGap} AS page_gap
     FROM source_units
     WHERE id_kitab = ?
       AND unit_type = ?
       AND source_text_normalized <> ''
       AND source_text <> ''
     ORDER BY
       folder_rank ASC,
       file_rank ASC,
       page_gap ASC,
       updated_at DESC,
       page_number ASC,
       segment_order ASC
     LIMIT ?`,
    params
  )
  return (rows || []).map(row => ({
    ...mapSourceUnitRow(row),
    folder_rank: Number(row.folder_rank || 0),
    file_rank: Number(row.file_rank || 0),
    page_gap: Number(row.page_gap || 0)
  }))
}

export async function listSemanticSourceUnitExamples({
  idKitab = null,
  folderPath = null,
  sourceLang = 'ar',
  targetLang = 'id',
  unitType = 'segment',
  modelName,
  excludeUnitId = null,
  currentPageNumber = null,
  currentFileName = null,
  limit = 80
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!idKitab || !modelName) return []
  await ensureSemanticEmbeddingsSchema()
  await ensureSourceUnitsSchema()
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 80, 500))
  const folderRank = folderPath ? 'CASE WHEN su.folder_path <=> ? THEN 0 ELSE 1 END' : '0'
  const fileRank = currentFileName ? 'CASE WHEN su.file_name <=> ? THEN 0 ELSE 1 END' : '0'
  const pageGap = currentPageNumber != null && currentPageNumber !== ''
    ? 'ABS(COALESCE(su.page_number, 0) - ?)'
    : '0'
  const params = [
    ...(folderPath ? [folderPath] : []),
    ...(currentFileName ? [currentFileName] : []),
    ...(currentPageNumber != null && currentPageNumber !== '' ? [Number(currentPageNumber)] : []),
    String(modelName || '').trim(),
    srcLang,
    tgtLang,
    Number(idKitab),
    String(unitType || 'segment'),
    ...(excludeUnitId ? [Number(excludeUnitId)] : []),
    boundedLimit
  ]
  const [rows] = await dbPool.query(
    `SELECT
       se.id AS semantic_id,
       se.entity_id,
       se.model_name,
       se.text_hash,
       se.vector_dim,
       se.vector_json,
       se.vector_norm,
       se.updated_at AS semantic_updated_at,
       su.id,
       su.id_kitab,
       su.unit_key,
       su.unit_type,
       su.folder_path,
       su.file_name,
       su.file_path,
       su.page_number,
       su.segment_order,
       su.source_text,
       su.source_text_normalized,
       su.created_at,
       su.updated_at,
       ${folderRank} AS folder_rank,
       ${fileRank} AS file_rank,
       ${pageGap} AS page_gap
     FROM semantic_embeddings se
     JOIN source_units su
       ON se.entity_type = 'source_unit'
      AND se.entity_id = su.id
     WHERE se.model_name = ?
       AND se.source_lang = ?
       AND se.target_lang = ?
       AND su.id_kitab = ?
       AND su.unit_type = ?
       ${excludeUnitId ? 'AND su.id <> ?' : ''}
     ORDER BY
       folder_rank ASC,
       file_rank ASC,
       page_gap ASC,
       su.updated_at DESC,
       su.page_number ASC,
       su.segment_order ASC
     LIMIT ?`,
    params
  )
  return (rows || []).map(row => ({
    ...mapSourceUnitRow(row),
    semantic_id: Number(row.semantic_id || 0),
    semantic_model: row.model_name,
    semantic_text_hash: row.text_hash,
    semantic_vector_dim: Number(row.vector_dim || 0),
    semantic_vector_norm: Number(row.vector_norm || 0),
    semantic_vector: parseEmbeddingVectorJson(row.vector_json),
    semantic_updated_at: row.semantic_updated_at,
    folder_rank: Number(row.folder_rank || 0),
    file_rank: Number(row.file_rank || 0),
    page_gap: Number(row.page_gap || 0)
  }))
}

export async function listSemanticTranslationMemoryExamples({
  idKitab = null,
  sourceLang = 'ar',
  targetLang = 'id',
  modelName,
  excludeNormalizedText = '',
  limit = 60
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  if (!modelName) return []
  await ensureSemanticEmbeddingsSchema()
  await ensureTranslationFeedbackSchema()
  const srcLang = normalizeLangCode(sourceLang, 'ar')
  const tgtLang = normalizeLangCode(targetLang, 'id')
  const normalizedExclusion = normalizeArabicText(excludeNormalizedText)
  const feedbackSql = buildTranslationFeedbackSignalSql('tm')
  const scoped = idKitab
    ? {
        clause: 'AND (tm.id_kitab = ? OR tm.id_kitab IS NULL)',
        rank: 'CASE WHEN tm.id_kitab = ? THEN 0 ELSE 1 END',
        params: [idKitab, idKitab]
      }
    : {
        clause: 'AND tm.id_kitab IS NULL',
        rank: '0',
        params: []
      }
  const [rows] = await dbPool.query(
    `SELECT
       se.id AS semantic_id,
       se.entity_id,
       se.model_name,
       se.text_hash,
       se.vector_dim,
       se.vector_json,
       se.vector_norm,
       se.updated_at AS semantic_updated_at,
       tm.id,
       tm.id_kitab,
       tm.source_lang,
       tm.target_lang,
       tm.source_text,
       tm.source_text_normalized,
       tm.translated_text,
       tm.file_name,
       tm.provider,
       tm.model,
       tm.quality_score,
       tm.usage_count,
       tm.updated_at,
       ${scoped.rank} AS scope_rank,
       ${feedbackSql.select}
     FROM semantic_embeddings se
     JOIN translation_memory tm
       ON se.entity_type = 'translation_memory'
      AND se.entity_id = tm.id
     ${feedbackSql.join}
     WHERE se.model_name = ?
       AND tm.source_lang = ?
       AND tm.target_lang = ?
       ${scoped.clause}
       ${normalizedExclusion ? 'AND tm.source_text_normalized <> ?' : ''}
     ORDER BY scope_rank ASC, feedback_boost DESC, tm.usage_count DESC, tm.updated_at DESC
     LIMIT ?`,
    normalizedExclusion
      ? [String(modelName || '').trim(), srcLang, tgtLang, ...scoped.params, normalizedExclusion, Number(limit) || 60]
      : [String(modelName || '').trim(), srcLang, tgtLang, ...scoped.params, Number(limit) || 60]
  )
  return (rows || []).map(row => ({
    ...mapTranslationMemoryRow(row, 'semantic'),
    semantic_id: row.semantic_id,
    semantic_model: row.model_name,
    semantic_text_hash: row.text_hash,
    semantic_vector_dim: Number(row.vector_dim || 0),
    semantic_vector_norm: Number(row.vector_norm || 0),
    semantic_vector: parseEmbeddingVectorJson(row.vector_json),
    semantic_updated_at: row.semantic_updated_at,
    scope_rank: Number(row.scope_rank || 0)
  }))
}

export async function importSourceUnitsFromFolder({
  kitabName,
  folderPath,
  unitType = 'segment',
  replaceExisting = true,
  cleanupLegacyPage = false
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureSourceUnitsSchema()
  const resolvedFolder = String(folderPath || '').trim()
  if (!resolvedFolder) return { ok: false, imported: 0, reason: 'folderPath_empty' }
  const idKitab = await resolveKitabId({ kitabName, folderPath: resolvedFolder, createIfMissing: false })
  if (!idKitab) return { ok: false, imported: 0, reason: 'kitab_not_found' }

  let files = []
  try {
    files = await listTopLevelTxtFiles(resolvedFolder)
  } catch (e) {
    return { ok: false, imported: 0, reason: e.message || 'folder_read_failed' }
  }
  if (files.length === 0) return { ok: true, imported: 0, total: 0 }

  if (replaceExisting) {
    await dbPool.query(
      'DELETE FROM source_units WHERE id_kitab = ? AND folder_path = ? AND unit_type = ?',
      [idKitab, resolvedFolder, unitType]
    )
  }
  if (unitType === 'segment' && cleanupLegacyPage) {
    await dbPool.query(
      'DELETE FROM source_units WHERE id_kitab = ? AND folder_path = ? AND unit_type = ?',
      [idKitab, resolvedFolder, 'page']
    )
  }

  let imported = 0
  for (let index = 0; index < files.length; index++) {
    const absPath = files[index]
    let content = ''
    try {
      content = await fs.readFile(absPath, 'utf-8')
    } catch (_) {
      continue
    }
    const fileName = path.basename(absPath)
    const pageNumber = parsePageNumberFromName(fileName)
    if (unitType === 'segment') {
      const segments = splitArabicTextIntoSegments(content)
      if (segments.length === 0) continue
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const item = await upsertSourceUnitEntry({
          idKitab,
          folderPath: resolvedFolder,
          fileName,
          filePath: absPath,
          sourceText: segments[segmentIndex],
          unitType: 'segment',
          pageNumber,
          segmentOrder: segmentIndex + 1
        })
        if (item) imported += 1
      }
      continue
    }
    const item = await upsertSourceUnitEntry({
      idKitab,
      folderPath: resolvedFolder,
      fileName,
      filePath: absPath,
      sourceText: content,
      unitType,
      pageNumber,
      segmentOrder: 1
    })
    if (item) imported += 1
  }

  return { ok: true, imported, total: files.length, idKitab }
}

async function findSourceUnitCurrent({
  idKitab,
  folderPath,
  fileName,
  filePath,
  originalText,
  pageNumber,
  preferredUnitType = 'segment'
} = {}) {
  await ensureSourceUnitsSchema()
  const normalizedText = normalizeArabicText(originalText)
  if (preferredUnitType === 'segment') {
    const segmentParams = [idKitab]
    const segmentFilters = ['id_kitab = ?', `unit_type = 'segment'`]
    if (folderPath) {
      segmentFilters.push('folder_path = ?')
      segmentParams.push(folderPath)
    }
    if (fileName) {
      segmentFilters.push('file_name = ?')
      segmentParams.push(fileName)
    } else if (pageNumber != null && pageNumber !== '') {
      segmentFilters.push('page_number = ?')
      segmentParams.push(Number(pageNumber))
    }
    if (fileName || (pageNumber != null && pageNumber !== '') || normalizedText) {
      const scoreParts = []
      const scoreParams = []
      if (normalizedText) {
        scoreParts.push('CASE WHEN source_text_normalized = ? THEN 4 ELSE 0 END')
        scoreParams.push(normalizedText)
        scoreParts.push(`CASE WHEN ? LIKE CONCAT('%', source_text_normalized, '%') THEN 2 ELSE 0 END`)
        scoreParams.push(normalizedText)
        scoreParts.push(`CASE WHEN source_text_normalized LIKE CONCAT('%', ?, '%') THEN 1 ELSE 0 END`)
        scoreParams.push(normalizedText)
      }
      const scoreExpr = scoreParts.length > 0 ? scoreParts.join(' + ') : '0'
      const gapExpr = normalizedText ? 'ABS(CHAR_LENGTH(source_text_normalized) - CHAR_LENGTH(?))' : 'CHAR_LENGTH(source_text_normalized)'
      const gapParams = normalizedText ? [normalizedText] : []
      const [rows] = await dbPool.query(
        `SELECT *, (${scoreExpr}) AS match_score, ${gapExpr} AS length_gap
         FROM source_units
         WHERE ${segmentFilters.join(' AND ')}
         ORDER BY match_score DESC, length_gap ASC, page_number ASC, segment_order ASC
         LIMIT 1`,
        [...scoreParams, ...gapParams, ...segmentParams]
      )
      if (rows && rows.length > 0) return mapSourceUnitRow(rows[0])
    }
  }
  if (filePath || fileName || pageNumber) {
    const unitKey = buildSourceUnitKey({
      folderPath,
      filePath,
      fileName,
      unitType: 'page',
      pageNumber,
      segmentOrder: 1
    })
    const [rows] = await dbPool.query(
      'SELECT * FROM source_units WHERE id_kitab = ? AND unit_key = ? LIMIT 1',
      [idKitab, unitKey]
    )
    if (rows && rows.length > 0) return mapSourceUnitRow(rows[0])
  }
  if (fileName) {
    const [rows] = await dbPool.query(
      'SELECT * FROM source_units WHERE id_kitab = ? AND file_name = ? AND unit_type = ? LIMIT 1',
      [idKitab, fileName, 'page']
    )
    if (rows && rows.length > 0) return mapSourceUnitRow(rows[0])
  }
  if (pageNumber != null && pageNumber !== '') {
    const [rows] = await dbPool.query(
      'SELECT * FROM source_units WHERE id_kitab = ? AND page_number = ? AND unit_type = ? ORDER BY segment_order ASC LIMIT 1',
      [idKitab, Number(pageNumber), 'page']
    )
    if (rows && rows.length > 0) return mapSourceUnitRow(rows[0])
  }
  if (normalizedText) {
    const [rows] = await dbPool.query(
      'SELECT * FROM source_units WHERE id_kitab = ? AND source_text_normalized = ? ORDER BY CASE WHEN unit_type = \'segment\' THEN 0 ELSE 1 END ASC, updated_at DESC LIMIT 1',
      [idKitab, normalizedText]
    )
    if (rows && rows.length > 0) return mapSourceUnitRow(rows[0])
  }
  return null
}

async function listCurrentPageSegments(idKitab, current) {
  if (!current || current.page_number == null) return []
  const [rows] = await dbPool.query(
    `SELECT * FROM source_units
     WHERE id_kitab = ? AND unit_type = ? AND page_number = ? AND file_name <=> ? AND folder_path <=> ?
     ORDER BY segment_order ASC`,
    [idKitab, current.unit_type, current.page_number, current.file_name || null, current.folder_path || null]
  )
  return (rows || []).map(mapSourceUnitRow)
}

async function findNeighborSourceUnit(idKitab, current, direction) {
  if (!current) return null
  const isPrev = direction === 'prev'
  const [rows] = await dbPool.query(
    `SELECT * FROM source_units
     WHERE id_kitab = ? AND unit_type = ? AND folder_path <=> ?
       AND (
         page_number ${isPrev ? '<' : '>'} ?
         OR (page_number = ? AND segment_order ${isPrev ? '<' : '>'} ?)
       )
     ORDER BY page_number ${isPrev ? 'DESC' : 'ASC'}, segment_order ${isPrev ? 'DESC' : 'ASC'}
     LIMIT 1`,
    [
      idKitab,
      current.unit_type,
      current.folder_path || null,
      current.page_number == null ? 0 : Number(current.page_number),
      current.page_number == null ? 0 : Number(current.page_number),
      Number(current.segment_order) || 0
    ]
  )
  return rows && rows.length > 0 ? mapSourceUnitRow(rows[0]) : null
}

export async function getSourceUnitContext({
  kitabName,
  folderPath,
  fileName,
  filePath,
  originalText,
  pageNumber,
  preferredUnitType = 'segment'
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  const idKitab = await resolveKitabId({ kitabName, folderPath, createIfMissing: false })
  if (!idKitab) return { idKitab: null, current: null, prev: null, next: null }

  if (folderPath) {
    try {
      await importSourceUnitsFromFolder({ kitabName, folderPath, unitType: preferredUnitType || 'segment' })
    } catch (_) {}
  }

  let current = await findSourceUnitCurrent({
    idKitab,
    folderPath,
    fileName,
    filePath,
    originalText,
    pageNumber,
    preferredUnitType
  })

  if (!current && String(originalText || '').trim()) {
    current = await upsertSourceUnitEntry({
      idKitab,
      folderPath,
      fileName,
      filePath,
      sourceText: originalText,
      unitType: preferredUnitType === 'segment' ? 'segment' : 'page',
      pageNumber: pageNumber == null || pageNumber === '' ? parsePageNumberFromName(fileName || '') : Number(pageNumber),
      segmentOrder: 1
    })
  }

  if (!current) return { idKitab, current: null, prev: null, next: null, current_page_segments: [] }

  const prev = await findNeighborSourceUnit(idKitab, current, 'prev')
  const next = await findNeighborSourceUnit(idKitab, current, 'next')
  const currentPageSegments = await listCurrentPageSegments(idKitab, current)
  return { idKitab, current, prev, next, current_page_segments: currentPageSegments }
}

export async function getTranslation({ kitabName, folderPath, originalText }) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationVersionsSchema()
  await ensureTranslationFeedbackSchema()
  const idKitab = await resolveKitabId({ kitabName, folderPath, createIfMissing: false })
  if (!idKitab) return null

  const legacy = await findLegacyExactTranslation(idKitab, originalText)
  if (legacy) return enrichTranslationRow(legacy)

  const exact = await findTranslationMemoryExact({ idKitab, sourceText: originalText, sourceLang: 'ar', targetLang: 'id' })
  if (exact) {
    await incrementTranslationMemoryUsage(exact.id)
    return exact
  }
  return null
}

export async function saveTranslation({
  kitabName,
  folderPath,
  fileName,
  originalText,
  translatedText,
  sourceLabel = 'manual',
  feedbackLabel = null,
  feedbackNotes = null,
  actorName = null,
  sourceFlow = 'manual'
}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationVersionsSchema()
  await ensureTranslationFeedbackSchema()
  const idKitab = await resolveKitabId({ kitabName, folderPath, createIfMissing: true })
  if (!idKitab) throw new Error('Kitab not found and no name provided.')
  const nextTranslated = String(translatedText || '')
  const confidence = computeTranslationConfidence({
    sourceText: originalText,
    translatedText: nextTranslated,
    sourceLabel
  })

  const [rows] = await dbPool.query(
    `SELECT
       id,
       text_translate,
       file_name,
       current_version_id,
       confidence_score,
       low_confidence,
       confidence_reasons_json
     FROM kitab_terjemahan
     WHERE id_kitab = ? AND text_original = ? LIMIT 1`,
    [idKitab, originalText]
  )
  if (rows && rows.length > 0) {
    const current = rows[0]
    const id = current.id
    const previousText = String(current.text_translate || '')
    const version = await createTranslationVersion({
      translationId: id,
      translatedText: nextTranslated,
      sourceLabel,
      confidenceScore: confidence.confidence_score,
      lowConfidence: confidence.low_confidence,
      confidenceReasons: confidence.confidence_reasons
    })
    await dbPool.query(
      `UPDATE kitab_terjemahan
       SET text_translate = ?, file_name = ?, confidence_score = ?, low_confidence = ?, confidence_reasons_json = ?, current_version_id = ?
       WHERE id = ?`,
      [
        nextTranslated,
        fileName || current.file_name || null,
        confidence.confidence_score,
        confidence.low_confidence,
        JSON.stringify(confidence.confidence_reasons),
        version.id,
        id
      ]
    )
    const changed = previousText.trim() !== nextTranslated.trim()
    await createTranslationFeedback({
      translationId: id,
      versionId: version.id,
      feedbackType: changed ? 'manual_correction' : 'manual_confirmation',
      feedbackLabel: feedbackLabel || (changed ? 'translation_updated' : 'translation_confirmed'),
      notes: feedbackNotes,
      payload: {
        actor_name: actorName || null,
        source_flow: sourceFlow || 'manual',
        source_label: sourceLabel,
        previous_text: previousText,
        next_text: nextTranslated
      }
    })
    const memory = await upsertTranslationMemoryEntry({
      idKitab,
      sourceText: originalText,
      translatedText: nextTranslated,
      fileName,
      sourceLang: 'ar',
      targetLang: 'id',
      provider: 'manual_save',
      qualityScore: 1
    })
    return {
      action: 'update',
      id,
      version_action: 'insert',
      version_id: version.id,
      version_number: version.version_number,
      feedback_action: 'insert',
      confidence_score: confidence.confidence_score,
      low_confidence: confidence.low_confidence,
      confidence_reasons: confidence.confidence_reasons,
      memory_action: memory.action,
      memory_id: memory.id
    }
  } else {
    const [res] = await dbPool.query(
      `INSERT INTO kitab_terjemahan
        (id_kitab, text_original, text_translate, file_name, confidence_score, low_confidence, confidence_reasons_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [idKitab, originalText, nextTranslated, fileName || null, confidence.confidence_score, confidence.low_confidence, JSON.stringify(confidence.confidence_reasons)]
    )
    const version = await createTranslationVersion({
      translationId: res.insertId,
      translatedText: nextTranslated,
      sourceLabel,
      confidenceScore: confidence.confidence_score,
      lowConfidence: confidence.low_confidence,
      confidenceReasons: confidence.confidence_reasons
    })
    await dbPool.query(
      'UPDATE kitab_terjemahan SET current_version_id = ? WHERE id = ?',
      [version.id, res.insertId]
    )
    await createTranslationFeedback({
      translationId: res.insertId,
      versionId: version.id,
      feedbackType: 'initial_save',
      feedbackLabel: feedbackLabel || 'translation_created',
      notes: feedbackNotes,
      payload: {
        actor_name: actorName || null,
        source_flow: sourceFlow || 'manual',
        source_label: sourceLabel
      }
    })
    const memory = await upsertTranslationMemoryEntry({
      idKitab,
      sourceText: originalText,
      translatedText: nextTranslated,
      fileName,
      sourceLang: 'ar',
      targetLang: 'id',
      provider: 'manual_save',
      qualityScore: 1
    })
    return {
      action: 'insert',
      id: res.insertId,
      version_action: 'insert',
      version_id: version.id,
      version_number: version.version_number,
      feedback_action: 'insert',
      confidence_score: confidence.confidence_score,
      low_confidence: confidence.low_confidence,
      confidence_reasons: confidence.confidence_reasons,
      memory_action: memory.action,
      memory_id: memory.id
    }
  }
}

export async function listLearningDatasetCandidates({
  approvedOnly = true,
  includeHighQualityFallback = true,
  requireExplicitApproval = false,
  minConfidence = 0.8,
  limit = 5000,
  idKitab = null
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationVersionsSchema()
  await ensureTranslationFeedbackSchema()
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 20000))
  const normalizedMinConfidence = Math.max(0, Math.min(1, Number(minConfidence) || 0))
  const normalizedIdKitab = idKitab == null || idKitab === '' ? null : Number(idKitab)
  const kitabFilterSql = Number.isFinite(normalizedIdKitab) && normalizedIdKitab > 0
    ? ' AND kt.id_kitab = ?'
    : ''
  const queryParams = [normalizedMinConfidence]
  if (kitabFilterSql) queryParams.push(normalizedIdKitab)
  queryParams.push(boundedLimit)
  const [rows] = await dbPool.query(
    `SELECT
       kt.id AS translation_id,
       kt.id_kitab,
       mk.nama_kitab,
       mk.pengarang,
       kt.text_original,
       kt.text_translate,
       kt.file_name,
       COALESCE(kt.confidence_score, tv.confidence_score, 0) AS confidence_score,
       COALESCE(kt.low_confidence, tv.low_confidence, 0) AS low_confidence,
       tv.source_label,
       COALESCE(fb.has_explicit_approval, 0) AS has_explicit_approval,
       COALESCE(fb.has_confirmation, 0) AS has_confirmation,
       COALESCE(fb.has_rejection, 0) AS has_rejection,
       COALESCE(fb.feedback_count, 0) AS feedback_count,
       kt.created_at,
       kt.current_version_id
     FROM kitab_terjemahan kt
     LEFT JOIN master_kitab mk
       ON kt.id_kitab = mk.id
     LEFT JOIN translation_versions tv
       ON kt.current_version_id = tv.id
     LEFT JOIN (
       SELECT
         translation_id,
         MAX(
           CASE
             WHEN LOWER(COALESCE(feedback_type, '')) = 'approval'
               OR LOWER(COALESCE(feedback_label, '')) IN ('approved', 'translation_approved', 'review_approved')
             THEN 1 ELSE 0
           END
         ) AS has_explicit_approval,
         MAX(
           CASE
             WHEN LOWER(COALESCE(feedback_type, '')) = 'manual_confirmation'
               OR LOWER(COALESCE(feedback_label, '')) IN ('translation_confirmed', 'confirmed', 'reviewed')
             THEN 1 ELSE 0
           END
         ) AS has_confirmation,
         MAX(
           CASE
             WHEN LOWER(COALESCE(feedback_type, '')) = 'rejection'
               OR LOWER(COALESCE(feedback_label, '')) IN ('rejected', 'translation_rejected', 'review_rejected')
             THEN 1 ELSE 0
           END
         ) AS has_rejection,
         COUNT(*) AS feedback_count
       FROM translation_feedback
       GROUP BY translation_id
     ) fb
       ON fb.translation_id = kt.id
     WHERE kt.text_original <> ''
       AND kt.text_translate <> ''
       AND COALESCE(kt.low_confidence, tv.low_confidence, 0) = 0
       AND COALESCE(kt.confidence_score, tv.confidence_score, 0) >= ?
       ${kitabFilterSql}
     ORDER BY
       COALESCE(fb.has_explicit_approval, 0) DESC,
       COALESCE(fb.has_confirmation, 0) DESC,
       COALESCE(kt.confidence_score, tv.confidence_score, 0) DESC,
       kt.created_at DESC
     LIMIT ?`,
    queryParams
  )

  const items = (rows || []).map(row => {
    const explicitApproved = Number(row.has_explicit_approval || 0) === 1
    const confirmed = Number(row.has_confirmation || 0) === 1
    const rejected = Number(row.has_rejection || 0) === 1
    const manualish = String(row.source_label || '').toLowerCase().startsWith('manual')
    let approvalStatus = 'unqualified'
    if (rejected) approvalStatus = 'rejected'
    else if (explicitApproved) approvalStatus = 'approved'
    else if (confirmed) approvalStatus = 'confirmed'
    else if (manualish && includeHighQualityFallback) approvalStatus = 'high_quality_manual'
    return {
      translation_id: Number(row.translation_id || 0),
      id_kitab: row.id_kitab == null ? null : Number(row.id_kitab),
      nama_kitab: row.nama_kitab || null,
      pengarang: row.pengarang || null,
      text_original: row.text_original,
      text_translate: row.text_translate,
      file_name: row.file_name || null,
      confidence_score: row.confidence_score == null ? null : Number(row.confidence_score),
      low_confidence: Number(row.low_confidence || 0),
      source_label: row.source_label || null,
      has_explicit_approval: explicitApproved ? 1 : 0,
      has_confirmation: confirmed ? 1 : 0,
      has_rejection: rejected ? 1 : 0,
      feedback_count: Number(row.feedback_count || 0),
      created_at: row.created_at,
      current_version_id: row.current_version_id == null ? null : Number(row.current_version_id),
      approval_status: approvalStatus
    }
  })

  return items.filter(item => {
    if (item.approval_status === 'rejected') return false
    if (requireExplicitApproval) return item.approval_status === 'approved'
    if (!approvedOnly) return item.approval_status !== 'unqualified'
    if (item.approval_status === 'approved') return true
    if (item.approval_status === 'confirmed') return true
    if (includeHighQualityFallback && item.approval_status === 'high_quality_manual') return true
    return false
  })
}

export async function listTranslationStyleProfiles({
  scopeType = 'global',
  scopeKey = null,
  sourceLang = 'ar',
  targetLang = 'id',
  onlyActive = null,
  limit = 20
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationStyleProfilesSchema()
  const clauses = ['scope_type = ?', 'source_lang = ?', 'target_lang = ?']
  const params = [String(scopeType || 'global'), normalizeLangCode(sourceLang, 'ar'), normalizeLangCode(targetLang, 'id')]
  if (scopeKey == null || scopeKey === '') {
    clauses.push('scope_key IS NULL')
  } else {
    clauses.push('scope_key = ?')
    params.push(String(scopeKey))
  }
  if (onlyActive === true) {
    clauses.push('is_active = 1')
  } else if (onlyActive === false) {
    clauses.push('is_active = 0')
  }
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 100))
  const [rows] = await dbPool.query(
    `SELECT
       id,
       scope_type,
       scope_key,
       source_lang,
       target_lang,
       profile_name,
       summary_text,
       rules_json,
       sample_count,
       source_policy_json,
       metadata_json,
       version_number,
       is_active,
       created_by,
       created_at,
       activated_at
     FROM translation_style_profiles
     WHERE ${clauses.join(' AND ')}
     ORDER BY
       is_active DESC,
       version_number DESC,
       created_at DESC,
       id DESC
     LIMIT ?`,
    [...params, boundedLimit]
  )
  return (rows || []).map(serializeTranslationStyleProfileRow)
}

export async function getActiveTranslationStyleProfile({
  scopeType = 'global',
  scopeKey = null,
  sourceLang = 'ar',
  targetLang = 'id'
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationStyleProfilesSchema()
  const clauses = [
    'scope_type = ?',
    'source_lang = ?',
    'target_lang = ?',
    'is_active = 1'
  ]
  const params = [String(scopeType || 'global'), normalizeLangCode(sourceLang, 'ar'), normalizeLangCode(targetLang, 'id')]
  if (scopeKey == null || scopeKey === '') {
    clauses.push('scope_key IS NULL')
  } else {
    clauses.push('scope_key = ?')
    params.push(String(scopeKey))
  }
  const [rows] = await dbPool.query(
    `SELECT
       id,
       scope_type,
       scope_key,
       source_lang,
       target_lang,
       profile_name,
       summary_text,
       rules_json,
       sample_count,
       source_policy_json,
       metadata_json,
       version_number,
       is_active,
       created_by,
       created_at,
       activated_at
     FROM translation_style_profiles
     WHERE ${clauses.join(' AND ')}
     ORDER BY activated_at DESC, version_number DESC, id DESC
     LIMIT 1`,
    params
  )
  if (!rows || rows.length === 0) return null
  return serializeTranslationStyleProfileRow(rows[0])
}

export async function createTranslationStyleProfile({
  scopeType = 'global',
  scopeKey = null,
  sourceLang = 'ar',
  targetLang = 'id',
  profileName = null,
  summaryText,
  rules = [],
  sampleCount = 0,
  sourcePolicy = {},
  metadata = {},
  createdBy = 'system'
} = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationStyleProfilesSchema()
  const normalizedSummary = String(summaryText || '').trim()
  if (!normalizedSummary) throw new Error('summaryText required')
  const normalizedScopeType = String(scopeType || 'global').trim() || 'global'
  const normalizedSourceLang = normalizeLangCode(sourceLang, 'ar')
  const normalizedTargetLang = normalizeLangCode(targetLang, 'id')
  const [versionRows] = await dbPool.query(
    `SELECT COALESCE(MAX(version_number), 0) AS max_version
     FROM translation_style_profiles
     WHERE scope_type = ?
       AND (
         (? IS NULL AND scope_key IS NULL)
         OR scope_key = ?
       )
       AND source_lang = ?
       AND target_lang = ?`,
    [
      normalizedScopeType,
      scopeKey ? String(scopeKey) : null,
      scopeKey ? String(scopeKey) : null,
      normalizedSourceLang,
      normalizedTargetLang
    ]
  )
  const nextVersion = Number(versionRows?.[0]?.max_version || 0) + 1
  const [result] = await dbPool.query(
    `INSERT INTO translation_style_profiles (
       scope_type,
       scope_key,
       source_lang,
       target_lang,
       profile_name,
       summary_text,
       rules_json,
       sample_count,
       source_policy_json,
       metadata_json,
       version_number,
       is_active,
       created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      normalizedScopeType,
      scopeKey ? String(scopeKey) : null,
      normalizedSourceLang,
      normalizedTargetLang,
      profileName ? String(profileName) : null,
      normalizedSummary,
      JSON.stringify(Array.isArray(rules) ? rules : []),
      Math.max(0, Number(sampleCount) || 0),
      JSON.stringify(sourcePolicy && typeof sourcePolicy === 'object' ? sourcePolicy : {}),
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
      nextVersion,
      createdBy ? String(createdBy) : 'system'
    ]
  )
  const [rows] = await dbPool.query(
    `SELECT
       id,
       scope_type,
       scope_key,
       source_lang,
       target_lang,
       profile_name,
       summary_text,
       rules_json,
       sample_count,
       source_policy_json,
       metadata_json,
       version_number,
       is_active,
       created_by,
       created_at,
       activated_at
     FROM translation_style_profiles
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  )
  return rows && rows[0] ? serializeTranslationStyleProfileRow(rows[0]) : null
}

export async function activateTranslationStyleProfile(profileId) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureTranslationStyleProfilesSchema()
  const normalizedId = Number(profileId)
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error('profileId required')
  }
  const [rows] = await dbPool.query(
    `SELECT id, scope_type, source_lang, target_lang
     FROM translation_style_profiles
     WHERE id = ?
     LIMIT 1`,
    [normalizedId]
  )
  if (!rows || rows.length === 0) throw new Error('Style profile tidak ditemukan')
  const row = rows[0]
  await dbPool.query(
    `UPDATE translation_style_profiles
     SET is_active = 0, activated_at = NULL
     WHERE scope_type = ?
       AND (
         (? IS NULL AND scope_key IS NULL)
         OR scope_key = ?
       )
       AND source_lang = ?
       AND target_lang = ?`,
    [row.scope_type, row.scope_key || null, row.scope_key || null, row.source_lang, row.target_lang]
  )
  await dbPool.query(
    `UPDATE translation_style_profiles
     SET is_active = 1, activated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [normalizedId]
  )
  return getActiveTranslationStyleProfile({
    scopeType: row.scope_type,
    scopeKey: row.scope_key || null,
    sourceLang: row.source_lang,
    targetLang: row.target_lang
  })
}

export async function listApiSettings() {
  if (!dbReady) throw new Error('Database not ready')
  await ensureApiSettingsSchema()
  const [rows] = await dbPool.query(`
    SELECT
      id,
      name,
      provider,
      api_key,
      base_url,
      model_default,
      capabilities_json,
      status,
      priority_order,
      meta_json,
      created_at,
      updated_at
    FROM api_settings
    ORDER BY
      CASE WHEN priority_order IS NULL THEN 1 ELSE 0 END ASC,
      priority_order ASC,
      updated_at DESC,
      id DESC
  `)
  return (rows || []).map(serializeApiSettingRow)
}

export async function filterProvidersByCapability(capability) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureApiSettingsSchema()
  const cap = String(capability || '').trim()
  if (!cap) return []
  const [rows] = await dbPool.query('SELECT * FROM api_settings WHERE status = "active" ORDER BY priority_order ASC, id ASC')
  const filtered = rows.filter(row => {
    const normalized = serializeApiSettingRow(row)
    return normalized.capabilities.includes(cap)
  })
  return filtered.map(serializeApiSettingRow)
}

export async function upsertApiSetting(payload) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureApiSettingsSchema()
  const normalized = normalizeApiSettingPayload(payload || {})
  if (!normalized.name) throw new Error('name required')
  if (!normalized.provider) throw new Error('provider required')
  if (normalized.id) {
    await dbPool.query(
      `UPDATE api_settings
       SET name = ?, provider = ?, api_key = ?, base_url = ?, model_default = ?, capabilities_json = ?, status = ?, priority_order = ?, meta_json = ?
       WHERE id = ?`,
      [
        normalized.name,
        normalized.provider,
        normalized.api_key,
        normalized.base_url,
        normalized.model_default,
        normalized.capabilities_json,
        normalized.status,
        normalized.priority_order,
        normalized.meta_json,
        normalized.id
      ]
    )
    return { action: 'update', id: normalized.id }
  } else {
    const [res] = await dbPool.query(
      `INSERT INTO api_settings
       (name, provider, api_key, base_url, model_default, capabilities_json, status, priority_order, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalized.name,
        normalized.provider,
        normalized.api_key,
        normalized.base_url,
        normalized.model_default,
        normalized.capabilities_json,
        normalized.status,
        normalized.priority_order,
        normalized.meta_json
      ]
    )
    return { action: 'insert', id: res.insertId }
  }
}

export async function deleteApiSetting(id) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureApiSettingsSchema()
  await dbPool.query('DELETE FROM api_settings WHERE id = ?', [id])
  return { ok: true }
}

export async function getApiSettingByName(name) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureApiSettingsSchema()
  const [rows] = await dbPool.query(
    `SELECT
      id,
      name,
      provider,
      api_key,
      base_url,
      model_default,
      capabilities_json,
      status,
      priority_order,
      meta_json,
      created_at,
      updated_at
    FROM api_settings
    WHERE name = ?
    LIMIT 1`,
    [name]
  )
  return rows && rows.length > 0 ? serializeApiSettingRow(rows[0]) : null
}

export async function getApiSettingById(id) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureApiSettingsSchema()
  const pid = Number(id)
  if (!pid) throw new Error('id required')
  const [rows] = await dbPool.query(
    `SELECT
      id,
      name,
      provider,
      api_key,
      base_url,
      model_default,
      capabilities_json,
      status,
      priority_order,
      meta_json,
      created_at,
      updated_at
    FROM api_settings
    WHERE id = ?
    LIMIT 1`,
    [pid]
  )
  return rows && rows.length > 0 ? serializeApiSettingRow(rows[0]) : null
}

export async function listAgentSystemPrompts() {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentSystemPromptsSchema()
  const [rows] = await dbPool.query('SELECT id, slug, label, system_prompt, created_at, updated_at FROM agent_system_prompts ORDER BY updated_at DESC, id DESC')
  return rows
}

export async function getAgentSystemPromptById(id) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentSystemPromptsSchema()
  const pid = Number(id)
  if (!pid) throw new Error('id required')
  const [rows] = await dbPool.query(
    'SELECT id, slug, label, system_prompt, created_at, updated_at FROM agent_system_prompts WHERE id = ? LIMIT 1',
    [pid]
  )
  return rows && rows.length > 0 ? rows[0] : null
}

export async function upsertAgentSystemPrompt({ id, slug, label, system_prompt }) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentSystemPromptsSchema()
  const sl = String(slug || '').trim()
  const lab = String(label || '').trim()
  const sp = String(system_prompt || '')
  if (!lab) throw new Error('label required')
  if (id) {
    await dbPool.query('UPDATE agent_system_prompts SET slug = ?, label = ?, system_prompt = ? WHERE id = ?', [sl || null, lab, sp, id])
    return { action: 'update', id }
  }
  const [res] = await dbPool.query('INSERT INTO agent_system_prompts (slug, label, system_prompt) VALUES (?, ?, ?)', [sl || null, lab, sp])
  return { action: 'insert', id: res.insertId }
}

export async function deleteAgentSystemPrompt(id) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentSystemPromptsSchema()
  await dbPool.query('DELETE FROM agent_system_prompts WHERE id = ?', [id])
  return { ok: true }
}

export async function listAgentPromptBindings() {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentPromptBindingsSchema()
  const [rows] = await dbPool.query('SELECT category, prompt_id, created_at, updated_at FROM agent_prompt_bindings ORDER BY category ASC')
  return rows
}

export async function setAgentPromptBinding({ category, prompt_id }) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentPromptBindingsSchema()
  const cat = String(category || '').trim()
  if (!cat) throw new Error('category required')
  const pid = prompt_id ? Number(prompt_id) : null
  await dbPool.query(
    'INSERT INTO agent_prompt_bindings (category, prompt_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE prompt_id = VALUES(prompt_id)',
    [cat, pid]
  )
  return { ok: true, category: cat, prompt_id: pid }
}

export async function getAgentActiveSystemPrompt(category) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAgentPromptBindingsSchema()
  const cat = String(category || '').trim()
  if (!cat) throw new Error('category required')
  const [bRows] = await dbPool.query('SELECT prompt_id FROM agent_prompt_bindings WHERE category = ? LIMIT 1', [cat])
  const pid = bRows && bRows.length > 0 ? bRows[0].prompt_id : null
  if (!pid) return null
  const [pRows] = await dbPool.query('SELECT id, slug, label, system_prompt, created_at, updated_at FROM agent_system_prompts WHERE id = ? LIMIT 1', [pid])
  return pRows && pRows.length > 0 ? pRows[0] : null
}

async function ensureAiChatSchema() {
  if (!dbPool) throw new Error('Database not ready')
  const createThreads = `
    CREATE TABLE IF NOT EXISTS ai_chat_threads (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      provider VARCHAR(64) NOT NULL,
      model VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  const createMessages = `
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      thread_id BIGINT NOT NULL,
      role VARCHAR(32) NOT NULL,
      content MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_thread_time (thread_id, created_at),
      CONSTRAINT fk_ai_chat_messages_thread
        FOREIGN KEY (thread_id) REFERENCES ai_chat_threads(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  await dbPool.query(createThreads)
  await dbPool.query(createMessages)
}

export async function listAiChatThreads({ limit = 50 } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const lim = Math.max(1, Math.min(200, Number(limit) || 50))
  const [rows] = await dbPool.query(
    `
      SELECT
        t.id,
        t.title,
        t.provider,
        t.model,
        t.created_at,
        t.updated_at,
        (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.thread_id = t.id) AS message_count,
        (SELECT MAX(m.created_at) FROM ai_chat_messages m WHERE m.thread_id = t.id) AS last_message_at
      FROM ai_chat_threads t
      ORDER BY COALESCE(last_message_at, t.updated_at) DESC, t.id DESC
      LIMIT ?
    `,
    [lim]
  )
  return rows
}

export async function createAiChatThread({ title, provider, model } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const prov = String(provider || 'openai').trim() || 'openai'
  const mod = typeof model === 'string' && model.trim() ? model.trim() : null
  const initialTitle = String(title || '').trim() || 'Chat Baru'
  const [res] = await dbPool.query(
    'INSERT INTO ai_chat_threads (title, provider, model) VALUES (?, ?, ?)',
    [initialTitle, prov, mod]
  )
  const id = res.insertId
  if (initialTitle === 'Chat Baru') {
    await dbPool.query('UPDATE ai_chat_threads SET title = ? WHERE id = ?', [`Chat Baru #${id}`, id])
  }
  const [rows] = await dbPool.query(
    'SELECT id, title, provider, model, created_at, updated_at FROM ai_chat_threads WHERE id = ? LIMIT 1',
    [id]
  )
  return rows && rows.length > 0 ? rows[0] : { id, title: initialTitle, provider: prov, model: mod }
}

export async function getAiChatThread(threadId) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const id = Number(threadId)
  if (!id) throw new Error('threadId required')
  const [rows] = await dbPool.query(
    'SELECT id, title, provider, model, created_at, updated_at FROM ai_chat_threads WHERE id = ? LIMIT 1',
    [id]
  )
  return rows && rows.length > 0 ? rows[0] : null
}

export async function updateAiChatThreadTitle(threadId, title) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const id = Number(threadId)
  if (!id) throw new Error('threadId required')
  const t = String(title || '').trim()
  if (!t) throw new Error('title required')
  await dbPool.query('UPDATE ai_chat_threads SET title = ? WHERE id = ?', [t, id])
  return { ok: true, id, title: t }
}

export async function listAiChatMessages(threadId, { limit = 200 } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const id = Number(threadId)
  if (!id) throw new Error('threadId required')
  const lim = Math.max(1, Math.min(2000, Number(limit) || 200))
  const [rows] = await dbPool.query(
    'SELECT id, thread_id, role, content, created_at FROM ai_chat_messages WHERE thread_id = ? ORDER BY id ASC LIMIT ?',
    [id, lim]
  )
  return rows
}

export async function countAiChatMessages(threadId) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const id = Number(threadId)
  if (!id) throw new Error('threadId required')
  const [rows] = await dbPool.query('SELECT COUNT(*) AS cnt FROM ai_chat_messages WHERE thread_id = ?', [id])
  return rows && rows[0] ? Number(rows[0].cnt) : 0
}

export async function addAiChatMessage(threadId, { role, content } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const id = Number(threadId)
  if (!id) throw new Error('threadId required')
  const r = String(role || '').trim()
  const c = String(content || '')
  if (!r) throw new Error('role required')
  if (!c.trim()) throw new Error('content required')
  const [res] = await dbPool.query(
    'INSERT INTO ai_chat_messages (thread_id, role, content) VALUES (?, ?, ?)',
    [id, r, c]
  )
  try {
    await dbPool.query('UPDATE ai_chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
  } catch (_) {}
  return { ok: true, id: res.insertId }
}

export async function deleteAiChatThread(threadId) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const id = Number(threadId)
  if (!id) throw new Error('threadId required')
  await dbPool.query('DELETE FROM ai_chat_threads WHERE id = ?', [id])
  return { ok: true, id }
}

export async function cloneAiChatThread({ threadId, title } = {}) {
  if (!dbReady) throw new Error('Database not ready')
  await ensureAiChatSchema()
  const srcId = Number(threadId)
  if (!srcId) throw new Error('threadId required')

  const src = await getAiChatThread(srcId)
  if (!src) throw new Error('Thread not found')

  const nextTitle =
    (typeof title === 'string' && title.trim()
      ? title.trim()
      : `${String(src.title || `Chat #${src.id}`)} (copy)`).slice(0, 255)

  const conn = await dbPool.getConnection()
  try {
    await conn.beginTransaction()
    const [res] = await conn.query(
      'INSERT INTO ai_chat_threads (title, provider, model) VALUES (?, ?, ?)',
      [nextTitle, src.provider || 'openai', src.model || null]
    )
    const newId = res.insertId

    await conn.query(
      `
        INSERT INTO ai_chat_messages (thread_id, role, content, created_at)
        SELECT ?, role, content, created_at
        FROM ai_chat_messages
        WHERE thread_id = ?
        ORDER BY id ASC
      `,
      [newId, srcId]
    )

    await conn.commit()
    const created = await getAiChatThread(newId)
    return created || { id: newId, title: nextTitle, provider: src.provider, model: src.model }
  } catch (e) {
    try { await conn.rollback() } catch (_) {}
    throw e
  } finally {
    try { conn.release() } catch (_) {}
  }
}
