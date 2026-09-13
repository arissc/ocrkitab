/**
 * Phase 1 verification (schema + index + optional cosine).
 * Usage:
 *   node electron/rag/_verify-phase1.mjs 14
 *   node electron/rag/_verify-phase1.mjs 14 --embed-limit=20
 * Safety: CREATE IF NOT EXISTS + upsert only.
 */
import crypto from 'node:crypto'
import {
  initMySql,
  getDbStatus,
  listApiSettings,
  filterProvidersByCapability,
  countRagChunks,
  countSemanticEmbeddingsByEntityType,
  listRagChunks,
  getSemanticEmbeddingEntry,
  upsertRagChunk,
  upsertSemanticEmbeddingEntry,
  getApiSettingByName,
} from '../db.js'
import { buildRagChunkDrafts } from './indexer.js'
import { normalizeRagText } from './chunker.js'

const idKitab = Number(process.argv[2] || 14)
const embedLimitArg = process.argv.find((a) => a.startsWith('--embed-limit='))
const embedLimit = embedLimitArg
  ? Math.max(1, Number(embedLimitArg.split('=')[1]) || 20)
  : 20

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i += 1) {
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
  if (protocol === 'google' && String(providerSetting.name || '').includes('gemini')) {
    protocol = 'gemini'
  }
  if (protocol === 'google') protocol = 'gemini'

  if (protocol === 'openai') {
    const model = getDefaultEmbeddingModelName({ ...providerSetting, meta: { ...meta, protocol: 'openai' } })
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
    const vector = data?.data?.[0]?.embedding
    return {
      ok: Array.isArray(vector) && vector.length > 0,
      vector: vector || [],
      modelName: model,
      protocol,
      error: Array.isArray(vector) && vector.length > 0 ? null : 'Embedding vector kosong.',
    }
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
      return {
        ok: false,
        error: (data && data.error && data.error.message) || resp.statusText || 'Gemini embedding gagal.',
      }
    }
    const values = data?.embedding?.values || data?.embeddings?.[0]?.values
    const vector = Array.isArray(values) ? values : []
    return {
      ok: vector.length > 0,
      vector,
      modelName: model,
      protocol,
      error: vector.length > 0 ? null : 'Embedding vector kosong.',
    }
  }

  return { ok: false, error: `Protocol embedding tidak didukung: ${protocol || '(kosong)'}` }
}

async function main() {
  console.log(`[rag-verify] init MySQL, kitab=${idKitab}, embedLimit=${embedLimit}`)
  await initMySql()
  const status = getDbStatus()
  if (!status.ok) {
    console.error('[rag-verify] DB not ready:', status.error)
    process.exit(1)
  }

  const draftInfo = await buildRagChunkDrafts({ idKitab, limit: 5000 })
  console.log('[rag-verify] drafts:', {
    nama: draftInfo.kitab?.nama_kitab,
    draftCount: draftInfo.drafts.length,
    scanned: draftInfo.scanned,
    sampleMeta: draftInfo.drafts[0]?.metadata || null,
  })

  let created = 0
  let updated = 0
  let skipped = 0
  const upsertedIds = []
  for (const draft of draftInfo.drafts) {
    const res = await upsertRagChunk(draft)
    if (!res.id) {
      skipped += 1
      continue
    }
    if (res.action === 'insert') created += 1
    else updated += 1
    upsertedIds.push({ id: res.id, draft })
  }
  const chunkCount = await countRagChunks({ idKitab, status: 'active' })
  console.log('[rag-verify] chunk upsert:', { created, updated, skipped, activeChunkCount: chunkCount })

  const provider = await resolveProvider()
  if (!provider || !provider.api_key) {
    console.error('[rag-verify] no usable embed provider/api_key; chunks OK, embeddings pending')
    process.exit(2)
  }
  console.log('[rag-verify] provider:', {
    id: provider.id,
    name: provider.name,
    provider: provider.provider,
    hasKey: !!provider.api_key,
  })

  let modelName = getDefaultEmbeddingModelName(provider)
  let embedded = 0
  let embedFailed = 0
  let embedSkipped = 0
  const toEmbed = upsertedIds.slice(0, embedLimit)
  for (const item of toEmbed) {
    const existing = await getSemanticEmbeddingEntry({
      entityType: 'rag_chunk',
      entityId: item.id,
      modelName,
    })
    const textHash = crypto.createHash('sha256').update(item.draft.text, 'utf8').digest('hex')
    if (existing && existing.text_hash === textHash && existing.vector?.length) {
      embedSkipped += 1
      continue
    }
    const embeddedRes = await embedTextWithProvider(provider, item.draft.text)
    if (!embeddedRes.ok) {
      embedFailed += 1
      console.error('[rag-verify] embed fail:', embeddedRes.error)
      continue
    }
    modelName = embeddedRes.modelName || modelName
    await upsertSemanticEmbeddingEntry({
      entityType: 'rag_chunk',
      entityId: item.id,
      idKitab,
      sourceLang: item.draft.lang === 'id' ? 'id' : item.draft.lang === 'mixed' ? 'mixed' : 'ar',
      targetLang: 'id',
      modelName: embeddedRes.modelName || modelName,
      text: item.draft.text,
      vector: embeddedRes.vector,
      metadata: {
        ...item.draft.metadata,
        provider: provider.provider || null,
        protocol: embeddedRes.protocol || null,
        source_hash: textHash,
        indexed_from: 'rag_chunks',
        reindex_mode: 'verify_sample',
        chunk_id: item.id,
      },
    })
    embedded += 1
  }

  const embeddingCount = await countSemanticEmbeddingsByEntityType({
    entityType: 'rag_chunk',
    idKitab,
  })
  console.log('[rag-verify] embed sample:', {
    attempted: toEmbed.length,
    embedded,
    embedSkipped,
    embedFailed,
    embeddingCount,
    modelName,
  })

  const samples = await listRagChunks({ idKitab, status: 'active', limit: 50 })
  let chunk = null
  let emb = null
  for (const candidate of samples) {
    const row = await getSemanticEmbeddingEntry({
      entityType: 'rag_chunk',
      entityId: candidate.id,
      modelName,
    })
    if (row?.vector?.length) {
      chunk = candidate
      emb = row
      break
    }
  }
  if (!chunk || !emb) {
    console.error('[rag-verify] no embedded chunk for cosine test')
    process.exit(5)
  }

  const queryText = String(chunk.text).slice(0, 220)
  const qEmbed = await embedTextWithProvider(provider, queryText)
  if (!qEmbed.ok) {
    console.error('[rag-verify] query embed failed', qEmbed.error)
    process.exit(6)
  }
  const score = cosine(qEmbed.vector, emb.vector)
  console.log('[rag-verify] cosine self-query:', {
    chunk_id: chunk.id,
    source_kind: chunk.source_kind,
    file_name: chunk.file_name,
    page_number: chunk.page_number,
    kitab_folder_path: chunk.kitab_folder_path,
    score: Number(score.toFixed(4)),
    text_hash_match:
      emb.text_hash === crypto.createHash('sha256').update(chunk.text, 'utf8').digest('hex'),
    query_normalized_preview: normalizeRagText(queryText, chunk.lang || 'ar').slice(0, 80),
  })

  if (!(score >= 0.7)) {
    console.error('[rag-verify] cosine too low for near-identical query')
    process.exit(7)
  }

  console.log('[rag-verify] Phase 1 verification OK (chunks full + sample vectors)')
  process.exit(0)
}

main().catch((err) => {
  console.error('[rag-verify] fatal', err)
  process.exit(1)
})
