// packages/backend/src/lib/chunker.ts
// Server-side text chunker for webpage refresh re-indexing.
// Splits on paragraph boundaries (\n\n) and falls back to sentence boundaries (. ).

export interface ChunkResult {
  content: string
}

/**
 * Split text into chunks of approximately maxChars characters.
 * Splits on paragraph boundaries first, then sentence boundaries.
 */
export function chunkText(text: string, maxChars = 2000, overlapChars = 200): ChunkResult[] {
  if (!text || text.trim().length === 0) return []

  const normalized = text.replace(/\r\n/g, '\n').trim()
  const chunks: ChunkResult[] = []

  // First, split by double newlines (paragraphs)
  const paragraphs = splitByParagraphs(normalized)

  let currentChunk = ''

  for (const para of paragraphs) {
    // If a single paragraph exceeds maxChars, split it by sentences
    if (para.length > maxChars) {
      // Flush current chunk first
      if (currentChunk) {
        chunks.push({ content: currentChunk.trim() })
        currentChunk = getOverlap(currentChunk, overlapChars)
      }

      const sentences = splitBySentences(para)
      for (const sentence of sentences) {
        if (`${currentChunk} ${sentence}`.trim().length > maxChars && currentChunk) {
          chunks.push({ content: currentChunk.trim() })
          currentChunk = getOverlap(currentChunk, overlapChars)
        }
        currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence
      }
      continue
    }

    // Normal case: add paragraph to current chunk
    const candidate = currentChunk ? `${currentChunk}\n\n${para}` : para
    if (candidate.length > maxChars && currentChunk) {
      chunks.push({ content: currentChunk.trim() })
      currentChunk = `${getOverlap(currentChunk, overlapChars)}\n\n${para}`
    } else {
      currentChunk = candidate
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim() })
  }

  return chunks
}

function splitByParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
}

function splitBySentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or newline
  const parts = text.split(/(?<=[.!?])\s+/)
  return parts.filter((p) => p.trim().length > 0)
}

function getOverlap(chunk: string, overlapChars: number): string {
  if (chunk.length <= overlapChars) return chunk
  // Take the last `overlapChars` characters, starting from a word boundary
  const tail = chunk.slice(-overlapChars)
  const firstSpace = tail.indexOf(' ')
  return firstSpace > 0 ? tail.slice(firstSpace + 1) : tail
}
