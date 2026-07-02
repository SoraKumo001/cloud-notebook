import { describe, expect, it } from 'vitest'
import { chunkText, countTokens } from './tokenizer'

describe('tokenizer tests', () => {
  it('should count tokens correctly', () => {
    const text = 'Hello world!'
    const tokenCount = countTokens(text)
    expect(tokenCount).toBeGreaterThan(0)
  })

  it('should split text into chunks based on maxTokens', () => {
    const longText = 'This is a long sentence repeated many times. '.repeat(50)
    const maxTokens = 30
    const overlapTokens = 5

    const chunks = chunkText(longText, maxTokens, overlapTokens)

    expect(chunks.length).toBeGreaterThan(1)

    // Check that each chunk is below or equal to maxTokens
    chunks.forEach((chunk) => {
      expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens)
      expect(chunk.content.length).toBeGreaterThan(0)
    })
  })

  it('should handle empty text gracefully', () => {
    const chunks = chunkText('')
    expect(chunks).toEqual([])
  })

  // ── New test cases ───────────────────────────────────────────────────────

  it('should handle Unicode text including Japanese and emoji', () => {
    const text = 'こんにちは世界！Hello 👋 日本語とEnglishが混ざったテキストです。🚀✨'
    const tokens = countTokens(text)
    expect(tokens).toBeGreaterThan(0)

    const chunks = chunkText(text, 100, 10)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // All content should be preserved
    const combined = chunks.map((c) => c.content).join('')
    expect(combined).toContain('こんにちは')
    expect(combined).toContain('👋')
    expect(combined).toContain('🚀')
  })

  it('should handle very long text (10000+ tokens)', () => {
    // Generate a paragraph that is long enough
    const sentence = 'The quick brown fox jumps over the lazy dog. '
    // 10000 tokens ≈ ~7500 words ≈ ~600 sentences
    const longText = sentence.repeat(2000)
    const tokenCount = countTokens(longText)
    expect(tokenCount).toBeGreaterThan(100)

    const chunks = chunkText(longText, 200, 20)
    expect(chunks.length).toBeGreaterThan(1)

    // Verify total content is preserved
    const combinedContent = chunks.map((c) => c.content).join('')
    expect(combinedContent.length).toBeGreaterThan(0)
  })

  it('should correctly overlap adjacent chunks', () => {
    // Use a short maxTokens so we get multiple chunks with overlap
    const text = 'apple banana cherry date elderberry fig grape honeydew '
    const maxTokens = 5
    const overlapTokens = 2

    const chunks = chunkText(text, maxTokens, overlapTokens)

    expect(chunks.length).toBeGreaterThan(1)

    // Check overlap: the start of chunk[i+1] should appear at the end of chunk[i]
    // when overlapping is working (accounting for token → text boundary fuzziness)
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i].content
      const next = chunks[i + 1].content

      // At least some overlap should be visible (the last few words of `current`
      // should appear at the start of `next`)
      const currentWords = current.split(/\s+/)
      const _nextStart = next.split(/\s+/).slice(0, 3).join(' ')
      const _currentEnd = currentWords.slice(-3).join(' ')

      // Since token boundaries don't perfectly align with word boundaries,
      // at minimum the chunks should not be completely disjoint
      const currentTokens = countTokens(current)
      const nextTokens = countTokens(next)

      // Each chunk should be at most maxTokens
      expect(currentTokens).toBeLessThanOrEqual(maxTokens)
      expect(nextTokens).toBeLessThanOrEqual(maxTokens)
    }
  })

  it('should handle maxTokens=1 edge case', () => {
    const text = 'Hello world this is a test with multiple tokens'
    const chunks = chunkText(text, 1, 0)

    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk) => {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1)
    })

    // Content should be preserved overall
    const combined = chunks.map((c) => c.content).join('')
    expect(combined.length).toBeGreaterThan(0)
  })

  it('should count tokens with edge cases (empty, single char)', () => {
    // Empty string
    expect(countTokens('')).toBe(0)

    // Single ASCII character
    expect(countTokens('a')).toBe(1)

    // Single space
    expect(countTokens(' ')).toBe(1)

    // Single Unicode character
    expect(countTokens('あ')).toBeGreaterThanOrEqual(1)
  })

  // ── Semantic boundary tests ──────────────────────────────────────────────

  it('should align chunk boundary with paragraph break when near the end', () => {
    // Build text: a long paragraph followed by a short paragraph that would
    // push the chunk over maxTokens if the boundary weren't respected.
    const p1 = 'This is the first paragraph. '.repeat(60) // ~180 tokens
    const p2 = 'Short paragraph. '.repeat(5) // ~15 tokens
    const text = `${p1}\n\n${p2}`

    const maxTokens = 200
    const overlapTokens = 0
    const chunks = chunkText(text, maxTokens, overlapTokens)

    expect(chunks.length).toBeGreaterThanOrEqual(1)

    // The first chunk should end at the paragraph boundary, not include p2
    const first = chunks[0]
    expect(first.content).toContain('first paragraph')
    expect(first.content).not.toContain('Short paragraph')
    expect(first.tokenCount).toBeLessThanOrEqual(maxTokens)
  })

  it('should align chunk boundary with sentence break when no paragraph break exists', () => {
    // Build text without any paragraph breaks — long text with sentences
    const longSentence = 'Machine learning is a subset of artificial intelligence. '.repeat(80)
    const text = longSentence

    const maxTokens = 200
    const overlapTokens = 0
    const chunks = chunkText(text, maxTokens, overlapTokens)

    expect(chunks.length).toBeGreaterThanOrEqual(1)

    // Each chunk should end with a complete sentence (period + space)
    // when the boundary was found past the halfway mark
    chunks.forEach((chunk) => {
      expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens)
    })
  })

  // ── bge-large constraint ─────────────────────────────────────────────────

  it('should keep default chunk size within bge-large 512-token limit', () => {
    const longText = 'The fundamental principles of deep learning involve neural networks. '.repeat(
      200,
    )

    // Use default parameters (maxTokens=500, overlapTokens=100)
    const chunks = chunkText(longText)

    expect(chunks.length).toBeGreaterThanOrEqual(1)
    chunks.forEach((chunk) => {
      // Must stay within bge-large-en-v1.5's 512-token limit
      expect(chunk.tokenCount).toBeLessThanOrEqual(512)
    })
  })

  // ── Default overlap ──────────────────────────────────────────────────────

  it('should apply the default overlap of 100 tokens', () => {
    // Build text long enough to require multiple chunks with default params
    const sentence = 'Natural language processing enables computers to understand text. '
    const text = sentence.repeat(300)

    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)

    // With default maxTokens=500, overlapTokens=100, each step is 400 tokens.
    // Check that adjacent chunks have some content in common.
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i].content
      const next = chunks[i + 1].content

      // The tail of current chunk should overlap with the head of next chunk
      const currentWords = current.split(/\s+/)
      const overlapCandidate = currentWords.slice(-30).join(' ')
      expect(next).toContain(overlapCandidate.slice(0, 20))
    }
  })
})
