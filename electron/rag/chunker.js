/**
 * RAG text chunking helpers (document corpus, not TM).
 * Baseline mirrors source_units splitter: minChars=180, maxChars=900.
 */

const ARABIC_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g
const NON_WORD_PUNCT_RE = /[^\p{L}\p{N}\s]/gu
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/

export function normalizeIndonesiaText(input) {
  return String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(NON_WORD_PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeRagText(input, lang = 'ar') {
  const text = String(input || '')
  if (!text.trim()) return ''
  if (String(lang).toLowerCase() === 'id') return normalizeIndonesiaText(text)
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

export function estimateTokenCount(input) {
  const text = String(input || '').trim()
  if (!text) return 0
  // Rough estimate: Arabic denser than Latin; keep simple for Phase 1.
  return Math.max(1, Math.ceil(text.length / 3.5))
}

export function scoreChunkQuality(input, { minChars = 40 } = {}) {
  const text = String(input || '').replace(/\s+/g, ' ').trim()
  if (!text) return 0
  if (text.length < minChars) return Math.max(5, Math.round((text.length / minChars) * 35))
  let score = 70
  if (text.length >= 120) score += 10
  if (text.length >= 240) score += 8
  if (ARABIC_SCRIPT_RE.test(text)) score += 4
  const digitRatio = (text.match(/\d/g) || []).length / text.length
  if (digitRatio > 0.35) score -= 20
  const punctOnly = !/[\p{L}]/u.test(text)
  if (punctOnly) score = 0
  return Math.max(0, Math.min(100, score))
}

export function isNoiseChunk(input, { minChars = 40 } = {}) {
  const text = String(input || '').replace(/\s+/g, ' ').trim()
  if (!text) return true
  if (text.length < minChars) return true
  // Only harakat / punctuation / digits
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (!letters) return true
  if (scoreChunkQuality(text, { minChars }) < 20) return true
  return false
}

/**
 * Split long page/segment text into RAG-sized chunks.
 * Overlap: keep last short sentence fragment when cutting mid-discussion.
 */
export function chunkTextForRag(input, { minChars = 180, maxChars = 900, overlapChars = 80 } = {}) {
  const raw = String(input || '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return []

  const paragraphBlocks = raw
    .split(/\n\s*\n+/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const pieces = []
  const pushChunk = (text) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim()
    if (!value) return
    pieces.push(value)
  }

  for (const block of paragraphBlocks) {
    if (block.length <= maxChars) {
      pushChunk(block)
      continue
    }

    const sentenceLikeParts = block
      .split(/(?<=[.!?؟؛۔:])\s+|\s*\n+\s*/u)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    if (sentenceLikeParts.length <= 1) {
      for (let cursor = 0; cursor < block.length; cursor += Math.max(1, maxChars - overlapChars)) {
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
      const overlap =
        overlapChars > 0 && current
          ? current.slice(Math.max(0, current.length - overlapChars)).trim()
          : ''
      current = overlap && !part.startsWith(overlap) ? `${overlap} ${part}`.trim() : part
      while (current.length > maxChars) {
        pushChunk(current.slice(0, maxChars))
        const nextStart = Math.max(1, maxChars - overlapChars)
        current = current.slice(nextStart).trim()
      }
    }
    if (current) pushChunk(current)
  }

  if (pieces.length <= 1) return pieces

  const merged = []
  for (const chunk of pieces) {
    const previous = merged.length > 0 ? merged[merged.length - 1] : ''
    if (previous && previous.length < minChars && previous.length + 1 + chunk.length <= maxChars) {
      merged[merged.length - 1] = `${previous} ${chunk}`.trim()
    } else {
      merged.push(chunk)
    }
  }
  return merged
}
