/**
 * RAG corpus indexer: build chunks from source_units + kitab_terjemahan,
 * upsert rag_chunks, embed into semantic_embeddings (entity_type=rag_chunk).
 *
 * Safety: upsert / skip-by-hash only. Soft-delete unused only when mode=full.
 * Never wipes source corpus tables.
 */

import crypto from 'node:crypto'
import {
  chunkTextForRag,
  estimateTokenCount,
  isNoiseChunk,
  normalizeRagText,
  scoreChunkQuality,
} from './chunker.js'
import {
  countRagChunks,
  countSemanticEmbeddingsByEntityType,
  deleteRagChunksByKitab,
  getKitabDetailById,
  getSemanticEmbeddingEntry,
  listRagChunks,
  listRagSourceUnitCandidates,
  listRagTranslationCandidates,
  upsertRagChunk,
  upsertSemanticEmbeddingEntry,
} from '../db.js'

const RAG_ENTITY_TYPE = 'rag_chunk'
const MIN_CHUNK_CHARS = 40

function incrementReasonCounter(map, key) {
  const reasonKey = String(key || 'unknown')
  map[reasonKey] = Number(map[reasonKey] || 0) + 1
}

function buildTextHash(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex')
}

function parsePageNumber(fileName, fallback = null) {
  if (fallback != null && fallback !== '' && Number.isFinite(Number(fallback))) {
    return Number(fallback)
  }
  const name = String(fileName || '')
  const base = name.replace(/\.[^.]+$/, '')
  const trailing = base.match(/(\d+)$/)
  if (trailing) return Number.parseInt(trailing[1], 10)
  const anyDigits = base.match(/(\d+)/)
  if (anyDigits) return Number.parseInt(anyDigits[1], 10)
  return null
}

function buildDraftsFromText({
  idKitab,
  sourceKind,
  lang,
  text,
  sourceUnitId = null,
  translationId = null,
  fileName = null,
  pageNumber = null,
  kitabFolderPath = null,
  unitType = null,
}) {
  const body = String(text || '').replace(/\s+/g, ' ').trim()
  if (!body) return []
  const parts = chunkTextForRag(body)
  const drafts = []
  parts.forEach((part, index) => {
    if (isNoiseChunk(part, { minChars: MIN_CHUNK_CHARS })) return
    const normalized = normalizeRagText(part, lang)
    drafts.push({
      idKitab,
      sourceKind,
      lang,
      sourceUnitId,
      translationId,
      fileName: fileName || null,
      pageNumber: parsePageNumber(fileName, pageNumber),
      chunkIndex: index,
      text: part,
      textNormalized: normalized,
      tokenCount: estimateTokenCount(part),
      qualityScore: scoreChunkQuality(part, { minChars: MIN_CHUNK_CHARS }),
      status: 'active',
      metadata: {
        file_name: fileName || null,
        page_number: parsePageNumber(fileName, pageNumber),
        chunk_index: index,
        source_kind: sourceKind,
        unit_type: unitType,
        kitab_folder_path: kitabFolderPath || null,
        preview: part.slice(0, 280),
      },
    })
  })
  return drafts
}

export async function buildRagChunkDrafts({
  idKitab,
  includeOriginal = true,
  includeTranslation = true,
  limit = 5000,
} = {}) {
  const kitabId = Number(idKitab)
  if (!kitabId) return { drafts: [], kitab: null, scanned: { source_units: 0, translations: 0 } }

  const kitab = await getKitabDetailById(kitabId)
  const kitabFolderPath = kitab?.folder_path || null
  const drafts = []
  let sourceScanned = 0
  let translationScanned = 0

  if (includeOriginal) {
    const units = await listRagSourceUnitCandidates({
      idKitab: kitabId,
      unitType: 'segment',
      limit,
    })
    sourceScanned = units.length
    for (const unit of units) {
      drafts.push(
        ...buildDraftsFromText({
          idKitab: kitabId,
          sourceKind: 'original',
          lang: 'ar',
          text: unit.source_text,
          sourceUnitId: unit.id,
          fileName: unit.file_name || null,
          pageNumber: unit.page_number,
          kitabFolderPath: unit.kitab_folder_path || unit.folder_path || kitabFolderPath,
          unitType: unit.unit_type || 'segment',
        }),
      )
    }
  }

  if (includeTranslation) {
    const translations = await listRagTranslationCandidates({
      idKitab: kitabId,
      limit,
      skipLowConfidence: true,
    })
    translationScanned = translations.length
    for (const row of translations) {
      drafts.push(
        ...buildDraftsFromText({
          idKitab: kitabId,
          sourceKind: 'translation',
          lang: 'id',
          text: row.text_translate,
          translationId: row.id,
          fileName: row.file_name || null,
          pageNumber: row.page_number,
          kitabFolderPath: row.kitab_folder_path || kitabFolderPath,
          unitType: 'translation',
        }),
      )

      // Short bilingual pair when both sides fit a single retrieval window.
      const original = String(row.text_original || '').replace(/\s+/g, ' ').trim()
      const translated = String(row.text_translate || '').replace(/\s+/g, ' ').trim()
      if (original && translated && original.length <= 900 && translated.length <= 900) {
        const bilingual = `${original}\n---\n${translated}`
        if (!isNoiseChunk(bilingual, { minChars: MIN_CHUNK_CHARS })) {
          drafts.push({
            idKitab: kitabId,
            sourceKind: 'bilingual',
            lang: 'mixed',
            sourceUnitId: null,
            translationId: row.id,
            fileName: row.file_name || null,
            pageNumber: parsePageNumber(row.file_name, row.page_number),
            chunkIndex: 0,
            text: bilingual,
            textNormalized: normalizeRagText(bilingual, 'id'),
            tokenCount: estimateTokenCount(bilingual),
            qualityScore: scoreChunkQuality(bilingual, { minChars: MIN_CHUNK_CHARS }),
            status: 'active',
            metadata: {
              file_name: row.file_name || null,
              page_number: parsePageNumber(row.file_name, row.page_number),
              chunk_index: 0,
              source_kind: 'bilingual',
              unit_type: 'translation',
              kitab_folder_path: row.kitab_folder_path || kitabFolderPath,
              preview: bilingual.slice(0, 280),
            },
          })
        }
      }
    }
  }

  return {
    drafts,
    kitab,
    scanned: {
      source_units: sourceScanned,
      translations: translationScanned,
    },
  }
}

/**
 * @param {object} options
 * @param {number} options.idKitab
 * @param {'incremental'|'full'} [options.mode]
 * @param {number} [options.limit]
 * @param {boolean} [options.includeOriginal]
 * @param {boolean} [options.includeTranslation]
 * @param {function} options.resolveEmbeddingProvider
 * @param {function} options.embedText
 * @param {function} [options.getDefaultModelName]
 */
export async function reindexRagCorpus({
  idKitab,
  mode = 'incremental',
  limit = 5000,
  includeOriginal = true,
  includeTranslation = true,
  resolveEmbeddingProvider,
  embedText,
  getDefaultModelName,
} = {}) {
  const kitabId = Number(idKitab)
  if (!kitabId) {
    return { ok: false, error: 'id_kitab wajib untuk reindex RAG corpus.' }
  }
  if (typeof resolveEmbeddingProvider !== 'function' || typeof embedText !== 'function') {
    return { ok: false, error: 'Embedding helpers tidak tersedia.' }
  }

  const providerSetting = await resolveEmbeddingProvider({})
  if (!providerSetting) {
    return {
      ok: false,
      error: 'Provider embedding dengan capability `embed` belum tersedia.',
    }
  }

  const normalizedMode =
    String(mode || 'incremental').trim().toLowerCase() === 'full' ? 'full' : 'incremental'
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 20000))
  const jobStartedAt = new Date().toISOString()
  const skipReasons = {}
  const failedReasons = {}

  let modelName =
    typeof getDefaultModelName === 'function'
      ? getDefaultModelName(providerSetting)
      : providerSetting?.model_default || 'text-embedding-3-small'

  const { drafts, kitab, scanned } = await buildRagChunkDrafts({
    idKitab: kitabId,
    includeOriginal,
    includeTranslation,
    limit: boundedLimit,
  })

  if (!kitab) {
    return { ok: false, error: `Kitab id=${kitabId} tidak ditemukan.` }
  }

  // Full mode: soft-deactivate existing chunks for this kitab, then reactivate via upsert.
  // Does not hard-delete or touch source_units / kitab_terjemahan.
  if (normalizedMode === 'full') {
    await deleteRagChunksByKitab(kitabId, { hard: false })
  }

  let scannedCount = 0
  let createdCount = 0
  let updatedCount = 0
  let embeddedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const draft of drafts) {
    scannedCount += 1
    try {
      const upserted = await upsertRagChunk(draft)
      if (!upserted.id) {
        skippedCount += 1
        incrementReasonCounter(skipReasons, upserted.reason || 'upsert_skip')
        continue
      }
      if (upserted.action === 'insert') createdCount += 1
      if (upserted.action === 'update') updatedCount += 1

      const existing = modelName
        ? await getSemanticEmbeddingEntry({
            entityType: RAG_ENTITY_TYPE,
            entityId: upserted.id,
            modelName,
          })
        : null
      const textHash = buildTextHash(draft.text)
      if (
        normalizedMode !== 'full' &&
        existing &&
        existing.text_hash === textHash &&
        Array.isArray(existing.vector) &&
        existing.vector.length > 0
      ) {
        skippedCount += 1
        incrementReasonCounter(skipReasons, 'unchanged_embedding')
        continue
      }

      const embedded = await embedText(providerSetting, draft.text)
      if (!embedded?.ok || !Array.isArray(embedded.vector) || embedded.vector.length === 0) {
        failedCount += 1
        incrementReasonCounter(
          failedReasons,
          embedded?.error ? `embedding_failed:${embedded.error}` : 'embedding_failed',
        )
        continue
      }
      modelName = embedded.modelName || modelName

      await upsertSemanticEmbeddingEntry({
        entityType: RAG_ENTITY_TYPE,
        entityId: upserted.id,
        idKitab: kitabId,
        sourceLang: draft.lang === 'id' ? 'id' : draft.lang === 'mixed' ? 'mixed' : 'ar',
        targetLang: 'id',
        modelName: embedded.modelName || modelName,
        text: draft.text,
        vector: embedded.vector,
        metadata: {
          ...draft.metadata,
          provider: providerSetting.provider || null,
          protocol: embedded.protocol || null,
          source_hash: textHash,
          indexed_from: 'rag_chunks',
          reindex_mode: normalizedMode,
          embedded_at: new Date().toISOString(),
          job_started_at: jobStartedAt,
          chunk_id: upserted.id,
        },
      })
      embeddedCount += 1
    } catch (err) {
      failedCount += 1
      incrementReasonCounter(failedReasons, err?.message || 'chunk_failed')
    }
  }

  const chunkCount = await countRagChunks({ idKitab: kitabId, status: 'active' })
  const embeddingCount = await countSemanticEmbeddingsByEntityType({
    entityType: RAG_ENTITY_TYPE,
    idKitab: kitabId,
    modelName: modelName || null,
  })

  return {
    ok: true,
    idKitab: kitabId,
    namaKitab: kitab.nama_kitab || null,
    folderPath: kitab.folder_path || null,
    provider: providerSetting.provider || null,
    model: modelName || null,
    mode: normalizedMode,
    candidateDraftCount: drafts.length,
    sourceUnitScanned: scanned.source_units,
    translationScanned: scanned.translations,
    scannedCount,
    createdCount,
    updatedCount,
    embeddedCount,
    skippedCount,
    failedCount,
    activeChunkCount: chunkCount,
    embeddingCount,
    skipReasons,
    failedReasons,
    jobStartedAt,
    jobFinishedAt: new Date().toISOString(),
  }
}

export async function verifyRagIndexForKitab(idKitab, { sampleLimit = 3 } = {}) {
  const kitabId = Number(idKitab)
  const chunkCount = await countRagChunks({ idKitab: kitabId, status: 'active' })
  const embeddingCount = await countSemanticEmbeddingsByEntityType({
    entityType: RAG_ENTITY_TYPE,
    idKitab: kitabId,
  })
  const samples = await listRagChunks({ idKitab: kitabId, status: 'active', limit: sampleLimit })
  const withVectors = []
  for (const chunk of samples) {
    const emb = await getSemanticEmbeddingEntry({
      entityType: RAG_ENTITY_TYPE,
      entityId: chunk.id,
    })
    withVectors.push({
      chunk_id: chunk.id,
      file_name: chunk.file_name,
      page_number: chunk.page_number,
      source_kind: chunk.source_kind,
      preview: String(chunk.text || '').slice(0, 120),
      has_embedding: !!(emb && Array.isArray(emb.vector) && emb.vector.length > 0),
      vector_dim: emb?.vector_dim || 0,
      model_name: emb?.model_name || null,
    })
  }
  return {
    idKitab: kitabId,
    chunkCount,
    embeddingCount,
    countsMatch: chunkCount > 0 && chunkCount === embeddingCount,
    samples: withVectors,
  }
}
