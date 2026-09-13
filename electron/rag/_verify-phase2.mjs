/**
 * Phase 2 verification: hybrid retrieval (keyword + vector).
 * Usage:
 *   node electron/rag/_verify-phase2.mjs 14
 *   node electron/rag/_verify-phase2.mjs 14 "keutamaan shalawat"
 * Safety: SELECT + embed query only; no wipe.
 */
import {
  initMySql,
  getDbStatus,
  searchGlobal,
  countRagChunks,
  countSemanticEmbeddingsByEntityType,
  listApiSettings,
  filterProvidersByCapability,
  getApiSettingByName,
} from '../db.js'
import { hybridSearch } from './retrieve.js'

const idKitab = Number(process.argv[2] || 14)
const paraphrase =
  process.argv[3] ||
  'keutamaan bershalawat kepada nabi'

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]) || 0
    const y = Number(b[i]) || 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function getDefaultEmbeddingModelName(providerSetting) {
  const meta =
    providerSetting && providerSetting.meta && typeof providerSetting.meta === 'object'
      ? providerSetting.meta
      : {}
  const protocol = String(meta.protocol || providerSetting?.provider || '')
    .trim()
    .toLowerCase()
  return (
    String(meta.embedding_model || providerSetting?.model_default || '').trim() ||
    (protocol === 'gemini' || protocol === 'google' ? 'text-embedding-004' : 'text-embedding-3-small')
  )
}

async function resolveProvider() {
  const tagged = await filterProvidersByCapability('embed')
  if (Array.isArray(tagged) && tagged.length > 0) return tagged[0]
  const openai = await getApiSettingByName('openai')
  if (openai) return openai
  const gemini = (await getApiSettingByName('geminicli')) || (await getApiSettingByName('gemini'))
  if (gemini) return gemini
  const all = await listApiSettings()
  return (all || []).find((row) => String(row.status || 'active') !== 'inactive') || null
}

async function embedTextWithProvider(providerSetting, text) {
  const sourceText = String(text || '').trim()
  if (!providerSetting || !sourceText) {
    return { ok: false, error: 'Embedding provider or text missing.' }
  }
  if (!providerSetting.api_key) {
    return { ok: false, error: 'Embedding provider API key tidak ditemukan.' }
  }
  const meta =
    providerSetting.meta && typeof providerSetting.meta === 'object'
      ? providerSetting.meta
      : {}
  let protocol = String(meta.protocol || providerSetting.provider || '')
    .trim()
    .toLowerCase()
  if (protocol === 'google') protocol = 'gemini'

  if (protocol === 'openai') {
    const model = getDefaultEmbeddingModelName({
      ...providerSetting,
      meta: { ...meta, protocol: 'openai' },
    })
    let base = String(providerSetting.base_url || 'https://api.openai.com').replace(/\/$/, '')
    if (!base.endsWith('/v1')) base = `${base}/v1`
    const endpoint = `${base}/embeddings`
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerSetting.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: sourceText }),
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) {
      return { ok: false, error: (data && data.error && data.error.message) || resp.statusText }
    }
    const vector = data?.data?.[0]?.embedding || []
    return { ok: vector.length > 0, vector, modelName: model, protocol }
  }

  if (protocol === 'gemini') {
    const model = getDefaultEmbeddingModelName({
      ...providerSetting,
      meta: { ...meta, protocol: 'gemini' },
    })
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${providerSetting.api_key}`
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: sourceText }] },
      }),
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) {
      return { ok: false, error: (data && data.error && data.error.message) || resp.statusText }
    }
    const vector = data?.embedding?.values || []
    return { ok: vector.length > 0, vector, modelName: model, protocol }
  }

  return { ok: false, error: `Protocol embedding "${protocol}" belum didukung.` }
}

function summarizeHits(rows, limit = 5) {
  return (rows || []).slice(0, limit).map((r) => ({
    match_type: r.match_type,
    similarity_score: r.similarity_score,
    rank_score: r.rank_score,
    chunk_id: r.chunk_id,
    file_name: r.file_name,
    nama_kitab: r.nama_kitab,
    preview: String(r.preview || r.text_translate || r.text_original || '').slice(0, 120),
  }))
}

async function main() {
  await initMySql()
  const status = getDbStatus()
  if (!status.ok) {
    console.error('DB not ready', status)
    process.exit(1)
  }

  const activeChunks = await countRagChunks({ idKitab, status: 'active' })
  const embCount = await countSemanticEmbeddingsByEntityType({
    entityType: 'rag_chunk',
    idKitab,
  })
  console.log(JSON.stringify({ idKitab, activeChunks, embCount }, null, 2))

  // Scenario 1: keyword exact path should still return rows for a known substring
  const keywordProbe = 'shalawat'
  const keywordOnly = await searchGlobal(keywordProbe, { idKitab, limit: 20 })
  console.log('\n=== Scenario 1: keyword-only (legacy) ===')
  console.log(`query="${keywordProbe}" hits=${keywordOnly.length}`)
  console.log(JSON.stringify(summarizeHits(keywordOnly), null, 2))

  const hybridKw = await hybridSearch({
    keyword: keywordProbe,
    mode: 'keyword',
    idKitab,
    threshold: 0.55,
    resolveEmbeddingProvider: resolveProvider,
    embedText: embedTextWithProvider,
    computeCosineSimilarity: cosine,
    getDefaultModelName: getDefaultEmbeddingModelName,
  })
  console.log(`hybrid mode=keyword hits=${hybridKw.data.length}`)

  // Scenario 2: paraphrase — should prefer semantic/hybrid
  console.log('\n=== Scenario 2: paraphrase hybrid ===')
  console.log(`query="${paraphrase}"`)
  const hybrid = await hybridSearch({
    keyword: paraphrase,
    mode: 'hybrid',
    idKitab,
    threshold: 0.55,
    candidateLimit: 400,
    topK: 20,
    resolveEmbeddingProvider: resolveProvider,
    embedText: embedTextWithProvider,
    computeCosineSimilarity: cosine,
    getDefaultModelName: getDefaultEmbeddingModelName,
  })
  console.log(JSON.stringify(hybrid.meta, null, 2))
  console.log(`hits=${hybrid.data.length}`)
  console.log(JSON.stringify(summarizeHits(hybrid.data, 8), null, 2))

  const semanticOnly = hybrid.data.filter(
    (r) => r.match_type === 'semantic' || r.match_type === 'hybrid',
  )
  const keywordLegacyForPara = await searchGlobal(paraphrase, { idKitab, limit: 20 })
  console.log('\n=== Compare paraphrase ===')
  console.log(
    JSON.stringify(
      {
        keyword_legacy_hits: keywordLegacyForPara.length,
        hybrid_total: hybrid.data.length,
        hybrid_semantic_or_hybrid: semanticOnly.length,
        paraphrase_beats_keyword:
          semanticOnly.length > 0 && keywordLegacyForPara.length === 0
            ? true
            : semanticOnly.length > keywordLegacyForPara.length,
        split_view_ready: hybrid.data.some((r) => r.kitab_folder_path && r.file_name),
      },
      null,
      2,
    ),
  )

  if (hybrid.meta?.embedError) {
    console.warn('WARN embed:', hybrid.meta.embedError)
    process.exitCode = 2
  } else if (activeChunks === 0 || embCount === 0) {
    console.warn('WARN: no rag index for kitab; run Phase 1 reindex first')
    process.exitCode = 2
  } else {
    console.log('\nPhase 2 verify finished OK')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
