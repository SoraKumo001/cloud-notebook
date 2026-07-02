import { getEncoding } from 'js-tiktoken'

// Initialize tokenizer with cl100k_base (used by GPT-4 and most modern embedding models)
const encoder = getEncoding('cl100k_base')

export interface TextChunk {
  content: string
  tokenCount: number
}

/**
 * Find a semantic boundary (paragraph or sentence break) near the given position.
 * Searches backward from `maxPos` within `text` and prefers paragraph breaks (`\n\n`)
 * over sentence breaks (`. `), requiring the boundary to be past the halfway mark.
 *
 * @returns The character index immediately after the boundary (or `maxPos` if none found).
 */
function findSemanticBoundary(text: string, minPos: number, maxPos: number): number {
  const halfWay = minPos + (maxPos - minPos) / 2

  // Paragraph boundary (double newline) — highest priority
  const paragraphEnd = text.lastIndexOf('\n\n', maxPos)
  if (paragraphEnd >= halfWay) return paragraphEnd + 2

  // Sentence boundary (period + space) — fallback
  const sentenceEnd = text.lastIndexOf('. ', maxPos)
  if (sentenceEnd >= halfWay) return sentenceEnd + 2

  return maxPos
}

/**
 * Split text into semantic chunks based on token counts.
 *
 * - Aligns chunk boundaries to paragraph/sentence breaks when possible.
 * - Default maxTokens (500) is within bge-large-en-v1.5's 512-token limit.
 * - Overlap is increased to 100 tokens for better retrieval context.
 *
 * @param text Original source text
 * @param maxTokens Maximum tokens per chunk (default 500)
 * @param overlapTokens Tokens to overlap between adjacent chunks (default 100)
 */
export function chunkText(
  text: string,
  maxTokens: number = 500,
  overlapTokens: number = 100,
): TextChunk[] {
  if (!text || text.trim() === '') {
    return []
  }

  const tokens = encoder.encode(text)
  const chunks: TextChunk[] = []

  let index = 0
  while (index < tokens.length) {
    // 1. Compute raw token-based boundary
    let chunkEnd = Math.min(index + maxTokens, tokens.length)

    // 2. Try to align with a semantic boundary
    if (chunkEnd < tokens.length) {
      const chunkTokens = tokens.slice(index, chunkEnd)
      const content = encoder.decode(chunkTokens)

      const boundaryPos = findSemanticBoundary(content, 0, content.length)
      if (boundaryPos < content.length) {
        const boundaryText = content.substring(0, boundaryPos)
        const boundaryTokenCount = encoder.encode(boundaryText).length
        const newChunkEnd = index + boundaryTokenCount

        // Ensure forward progress (avoid infinite loop on pathological input)
        if (newChunkEnd > index) {
          chunkEnd = newChunkEnd
        }
      }
    }

    // Safety: ensure we always make forward progress
    if (chunkEnd <= index) {
      chunkEnd = Math.min(index + 1, tokens.length)
    }

    const chunkTokens = tokens.slice(index, chunkEnd)
    const content = encoder.decode(chunkTokens)

    chunks.push({
      content,
      tokenCount: chunkTokens.length,
    })

    // Advance by maxTokens minus overlap
    if (chunkEnd === tokens.length) {
      break
    }
    index += Math.max(1, maxTokens - overlapTokens)
  }

  return chunks
}

/**
 * Helper to count tokens of a given text
 */
export function countTokens(text: string): number {
  return encoder.encode(text).length
}
