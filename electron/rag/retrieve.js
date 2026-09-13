/**
 * Hybrid retrieval for document RAG (Search Phase 2).
 * Combines legacy keyword search + rag_chunks keyword + vector cosine.
 * Isolated from semantic TM retrieve used by translate-ai.
 */

import { normalizeRagText } from './chunker.js'
import {
  searchGlobal,
  searchRagChunksByKeyword,
  listRagChunkEmbeddingCandidates,
} from '../db.js'

const DEFAULT_SEARCH_THRESHOLD = 0.55
const DEFAULT_TOP_K = 50
const DEFAULT_CANDIDATE_LIMIT = 400

function clamp01(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function detectQueryLang(text) {
  const sample = String(text || '')
  if (/[\u0600-\u06FF]/.test(sample)) return 'ar'
  return 'id'
}

function tokenizeQuery(text, lang = 'id') {
  const normalized = normalizeRagText(text, lang)
  return normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function keywordOverlapScore(queryTokens, haystack, lang = 'id') {
  if (!queryTokens.length) return 0
  const norm = normalizeRagText(haystack, lang)
  if (!norm) return 0
  let hits = 0
  for (const token of queryTokens) {
    if (norm.includes(token)) hits += 1
  }
  return hits / queryTokens.length
}

function pageMergeKey(item) {
  const kitabId = item.kitab_id != null ? String(item.kitab_id) : 'x'
  const file = String(item.file_name || '').trim().toLowerCase() || `nofile:${item.chunk_id || item.translation_id || ''}`
  return `${kitabId}::${file}`
}

function hasTranslationSignal(item) {
  if (item.has_translation_boost) return true
  const kind = String(item.source_kind || '').toLowerCase()
  if (kind === 'translation' || kind === 'bilingual') return true
  if (item.translation_id) return true
  if (item.text_translate && String(item.text_translate).trim()) return true
  return false
}

function buildSearchResultFromLegacy(row) {
  return {
    translation_id: row.translation_id ?? null,
    text_original: row.text_original || null,
    text_translate: row.text_translate || null,
    file_name: row.file_name || null,
    kitab_id: row.kitab_id ?? null,
    nama_kitab: row.nama_kitab || null,
    kitab_folder_path: row.kitab_folder_path || null,
    page_number: null,
    chunk_id: null,
    source_kind: row.translation_id ? 'translation' : 'master',
    match_type: 'keyword',
    similarity_score: null,
    keyword_score: 1,
    vector_similarity: 0,
    rank_score: 0,
    preview: String(row.text_translate || row.text_original || '').slice(0, 280),
  }
}

function buildSearchResultFromChunk(chunk, extras = {}) {
  const kind = String(chunk.source_kind || '').toLowerCase()
  const text = String(chunk.text || '')
  let textOriginal = null
  let textTranslate = null
  if (kind === 'original') textOriginal = text
  else if (kind === 'translation') textTranslate = text
  else {
    textOriginal = text
    textTranslate = text
  }
  return {
    translation_id: chunk.translation_id ?? null,
    text_original: textOriginal,
    text_translate: textTranslate,
    file_name: chunk.file_name || null,
    kitab_id: chunk.id_kitab ?? null,
    nama_kitab: chunk.nama_kitab || null,
    kitab_folder_path: chunk.kitab_folder_path || null,
    page_number: chunk.page_number ?? null,
    chunk_id: chunk.id ?? chunk.chunk_id ?? null,
    source_kind: chunk.source_kind || null,
    lang: chunk.lang || null,
    match_type: extras.match_type || 'semantic',
    similarity_score:
      extras.similarity_score != null ? Number(extras.similarity_score) : null,
    keyword_score: Number(extras.keyword_score || 0),
    vector_similarity: Number(extras.vector_similarity || 0),
    rank_score: Number(extras.rank_score || 0),
    preview: text.slice(0, 280),
    quality_score: chunk.quality_score != null ? Number(chunk.quality_score) : null,
  }
}

function computeHybridRank({
  vectorSimilarity = 0,
  keywordScore = 0,
  sameKitab = false,
  hasTranslation = false,
}) {
  return (
    0.6 * clamp01(vectorSimilarity, 0) +
    0.25 * clamp01(keywordScore, 0) +
    0.1 * (sameKitab ? 1 : 0) +
    0.05 * (hasTranslation ? 1 : 0)
  )
}

function mergeHits(map, item) {
  const key = pageMergeKey(item)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ...item })
    return
  }
  const next = { ...existing }
  next.keyword_score = Math.max(
    Number(existing.keyword_score || 0),
    Number(item.keyword_score || 0),
  )
  next.vector_similarity = Math.max(
    Number(existing.vector_similarity || 0),
    Number(item.vector_similarity || 0),
  )
  if (
    item.similarity_score != null &&
    (existing.similarity_score == null ||
      Number(item.similarity_score) > Number(existing.similarity_score))
  ) {
    next.similarity_score = item.similarity_score
    next.chunk_id = item.chunk_id ?? existing.chunk_id
    next.source_kind = item.source_kind || existing.source_kind
    next.page_number = item.page_number ?? existing.page_number
    if (item.preview) next.preview = item.preview
  }
  if (!next.text_original && item.text_original) next.text_original = item.text_original
  if (!next.text_translate && item.text_translate) next.text_translate = item.text_translate
  if (!next.translation_id && item.translation_id) next.translation_id = item.translation_id
  if (!next.file_name && item.file_name) next.file_name = item.file_name
  if (!next.kitab_folder_path && item.kitab_folder_path) {
    next.kitab_folder_path = item.kitab_folder_path
  }
  const hasKw = Number(next.keyword_score || 0) > 0.15
  const hasVec = Number(next.vector_similarity || 0) > 0
  if (hasKw && hasVec) next.match_type = 'hybrid'
  else if (hasVec) next.match_type = 'semantic'
  else next.match_type = 'keyword'
  map.set(key, next)
}

/**
 * @param {object} options
 * @param {string} options.keyword
 * @param {'keyword'|'semantic'|'hybrid'} [options.mode]
 * @param {number|null} [options.idKitab]
 * @param {number} [options.threshold] Search threshold (looser than Chat)
 * @param {number} [options.topK]
 * @param {number} [options.candidateLimit]
 * @param {function} options.resolveEmbeddingProvider
 * @param {function} options.embedText
 * @param {function} options.computeCosineSimilarity
 * @param {function} [options.getDefaultModelName]
 */
export async function hybridSearch({
  keyword,
  mode = 'hybrid',
  idKitab = null,
  threshold = DEFAULT_SEARCH_THRESHOLD,
  topK = DEFAULT_TOP_K,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  resolveEmbeddingProvider,
  embedText,
  computeCosineSimilarity,
  getDefaultModelName,
} = {}) {
  const query = String(keyword || '').trim()
  const normalizedMode = ['keyword', 'semantic', 'hybrid'].includes(String(mode || '').toLowerCase())
    ? String(mode).toLowerCase()
    : 'hybrid'
  const searchThreshold = clamp01(threshold, DEFAULT_SEARCH_THRESHOLD)
  const boundedTopK = Math.max(1, Math.min(Number(topK) || DEFAULT_TOP_K, 100))
  const boundedCandidates = Math.max(
    50,
    Math.min(Number(candidateLimit) || DEFAULT_CANDIDATE_LIMIT, 2000),
  )
  const kitabScope =
    idKitab != null && idKitab !== '' && Number.isFinite(Number(idKitab))
      ? Number(idKitab)
      : null

  if (!query) {
    return {
      ok: true,
      mode: normalizedMode,
      data: [],
      meta: { query: '', threshold: searchThreshold, model: null, candidateCount: 0 },
    }
  }

  const queryLang = detectQueryLang(query)
  const queryTokens = tokenizeQuery(query, queryLang)
  const merged = new Map()
  const meta = {
    query,
    mode: normalizedMode,
    threshold: searchThreshold,
    idKitab: kitabScope,
    model: null,
    provider: null,
    candidateCount: 0,
    keywordLegacyCount: 0,
    keywordChunkCount: 0,
    vectorHitCount: 0,
    embedError: null,
  }

  // 1) Legacy keyword Search (kitab_terjemahan + master_kitab) — no regression path
  if (normalizedMode === 'keyword' || normalizedMode === 'hybrid') {
    const legacyRows = await searchGlobal(query, {
      idKitab: kitabScope,
      limit: boundedTopK,
    })
    meta.keywordLegacyCount = legacyRows.length
    for (const row of legacyRows) {
      const item = buildSearchResultFromLegacy(row)
      item.keyword_score = Math.max(
        0.85,
        keywordOverlapScore(
          queryTokens,
          `${row.text_original || ''} ${row.text_translate || ''} ${row.nama_kitab || ''}`,
          queryLang,
        ),
      )
      item.rank_score = computeHybridRank({
        vectorSimilarity: 0,
        keywordScore: item.keyword_score,
        sameKitab: kitabScope != null && Number(row.kitab_id) === kitabScope,
        hasTranslation: hasTranslationSignal(item),
      })
      mergeHits(merged, item)
    }
  }

  // 2) Keyword on rag_chunks
  if (normalizedMode === 'keyword' || normalizedMode === 'hybrid') {
    const chunkHits = await searchRagChunksByKeyword({
      keyword: query,
      idKitab: kitabScope,
      status: 'active',
      limit: Math.min(boundedTopK * 2, 160),
    })
    meta.keywordChunkCount = chunkHits.length
    for (const chunk of chunkHits) {
      const kwScore = Math.max(
        0.4,
        keywordOverlapScore(queryTokens, `${chunk.text} ${chunk.text_normalized}`, chunk.lang || queryLang),
      )
      const item = buildSearchResultFromChunk(chunk, {
        match_type: 'keyword',
        keyword_score: kwScore,
        vector_similarity: 0,
        similarity_score: null,
      })
      item.rank_score = computeHybridRank({
        vectorSimilarity: 0,
        keywordScore: kwScore,
        sameKitab: kitabScope != null && Number(chunk.id_kitab) === kitabScope,
        hasTranslation: hasTranslationSignal(item),
      })
      mergeHits(merged, item)
    }
  }

  // 3) Vector path
  if (normalizedMode === 'semantic' || normalizedMode === 'hybrid') {
    if (typeof resolveEmbeddingProvider !== 'function' || typeof embedText !== 'function') {
      meta.embedError = 'embedding_helpers_missing'
    } else {
      const providerSetting = await resolveEmbeddingProvider({})
      if (!providerSetting) {
        meta.embedError = 'embedding_provider_missing'
      } else {
        meta.provider = providerSetting.provider || providerSetting.name || null
        const embedded = await embedText(providerSetting, query)
        if (!embedded || !embedded.ok) {
          meta.embedError = embedded?.error || 'query_embedding_failed'
        } else {
          const modelName =
            embedded.modelName ||
            (typeof getDefaultModelName === 'function'
              ? getDefaultModelName(providerSetting)
              : null)
          meta.model = modelName || null
          if (modelName) {
            const candidates = await listRagChunkEmbeddingCandidates({
              idKitab: kitabScope,
              modelName,
              status: 'active',
              limit: boundedCandidates,
            })
            meta.candidateCount = candidates.length
            const cosine =
              typeof computeCosineSimilarity === 'function'
                ? computeCosineSimilarity
                : () => 0
            let vectorHits = 0
            for (const cand of candidates) {
              const sim = cosine(embedded.vector, cand.semantic_vector)
              if (sim < searchThreshold) continue
              vectorHits += 1
              const kwScore = keywordOverlapScore(
                queryTokens,
                `${cand.text || ''} ${cand.text_normalized || ''}`,
                cand.lang || queryLang,
              )
              const item = buildSearchResultFromChunk(cand, {
                match_type: kwScore > 0.15 ? 'hybrid' : 'semantic',
                similarity_score: Number(sim.toFixed(4)),
                vector_similarity: sim,
                keyword_score: kwScore,
              })
              item.rank_score = computeHybridRank({
                vectorSimilarity: sim,
                keywordScore: kwScore,
                sameKitab: kitabScope != null && Number(cand.id_kitab) === kitabScope,
                hasTranslation: hasTranslationSignal(item),
              })
              mergeHits(merged, item)
            }
            meta.vectorHitCount = vectorHits
          }
        }
      }
    }
  }

  // Finalize ranks after merge
  const results = [...merged.values()].map((item) => {
    const sameKitab =
      kitabScope != null && Number(item.kitab_id) === kitabScope
    const rank = computeHybridRank({
      vectorSimilarity: Number(item.vector_similarity || 0),
      keywordScore: Number(item.keyword_score || 0),
      sameKitab,
      hasTranslation: hasTranslationSignal(item),
    })
    const hasKw = Number(item.keyword_score || 0) > 0.15
    const hasVec = Number(item.vector_similarity || 0) > 0
    let matchType = 'keyword'
    if (hasKw && hasVec) matchType = 'hybrid'
    else if (hasVec) matchType = 'semantic'
    return {
      ...item,
      match_type: matchType,
      rank_score: Number(rank.toFixed(4)),
      similarity_score:
        item.similarity_score != null
          ? Number(Number(item.similarity_score).toFixed(4))
          : hasVec
            ? Number(Number(item.vector_similarity).toFixed(4))
            : null,
    }
  })

  results.sort((a, b) => {
    const rs = Number(b.rank_score || 0) - Number(a.rank_score || 0)
    if (rs !== 0) return rs
    const vs = Number(b.vector_similarity || 0) - Number(a.vector_similarity || 0)
    if (vs !== 0) return vs
    return Number(b.keyword_score || 0) - Number(a.keyword_score || 0)
  })

  // Semantic-only: drop pure keyword leftovers below threshold intent
  const filtered =
    normalizedMode === 'semantic'
      ? results.filter((r) => Number(r.vector_similarity || 0) >= searchThreshold)
      : results

  return {
    ok: true,
    mode: normalizedMode,
    data: filtered.slice(0, boundedTopK),
    meta,
  }
}

export const RAG_SEARCH_DEFAULTS = {
  searchSimilarityThreshold: DEFAULT_SEARCH_THRESHOLD,
  chatSimilarityThreshold: 0.7,
  candidateLimit: DEFAULT_CANDIDATE_LIMIT,
  topK: DEFAULT_TOP_K,
}
