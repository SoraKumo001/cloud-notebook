// packages/backend/src/prompts.ts
// RAG prompt templates + hallucination-guard utilities.
//
// These are pure functions (no side-effects, no I/O) so they can be
// tested in isolation.  The actual LLM call + post-processing pipeline
// will be assembled in a separate chat handler (L3 / M2+).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RagChunk {
  /** D1 source_chunks.id — used to map Vectorize result → chunk row */
  id: string
  /** The chunk text content */
  content: string
  /** Human-readable source name (e.g. report.pdf) */
  sourceName: string
  /** Optional page number from the source PDF */
  pageNumber?: number
}

export interface PromptPair {
  system: string
  user: string
}

// ---------------------------------------------------------------------------
// System prompt — shared across RAG chat invocations
// ---------------------------------------------------------------------------

/**
 * System prompt for the RAG chat assistant.
 *
 * Design goals:
 *  1. Force the model to answer **only** from the provided context.
 *  2. Explicitly instruct it to say "I don't know" when info is missing.
 *  3. Require citation numbers matching the context blocks.
 *  4. Keep output concise — one paragraph unless the user asks for detail.
 */
export const RAG_SYSTEM_PROMPT = [
  'You are a precise research assistant that answers questions based solely on the provided document context.',
  '',
  'Rules:',
  '1. ONLY use information present in the "Context" blocks below. Do not use any external or prior knowledge.',
  '2. If the answer cannot be found in the context, respond with: "The provided documents do not contain that information."',
  '3. When citing information, use the citation numbers shown in the context, e.g. [1], [2]. Cite every factual claim.',
  '4. Be concise. Answer in one paragraph unless the question explicitly asks for a detailed breakdown.',
  '5. Never invent sources, authors, dates, or numbers that are not present in the context.',
  '6. If the context contains contradictory information, point out the contradiction with citations.',
  '7. The user may have written notes about this topic. If notes are provided alongside source documents, treat the notes as authoritative context.',
].join('\n')

// ---------------------------------------------------------------------------
// System prompt — summarization (planned for M2+, interface only)
// ---------------------------------------------------------------------------

export const SUMMARIZATION_SYSTEM_PROMPT = [
  'You are a document summarization assistant. Your task is to produce a concise, structured summary of the provided text.',
  '',
  'Rules:',
  '1. Include only information that is explicitly present in the text.',
  '2. Structure the summary with bullet points for key findings.',
  '3. Preserve important numbers, dates, and named entities verbatim.',
  '4. Keep the total output under 25% of the input length.',
].join('\n')

// ---------------------------------------------------------------------------
// RAG prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the system + user prompt pair for a RAG chat turn.
 *
 * The user prompt injects numbered context blocks so the model can cite
 * specific chunks with `[1]`, `[2]`, etc.
 *
 * @param query  The user's natural-language question.
 * @param chunks Context chunks returned by Vectorize similarity search.
 *               Assumed already sorted by relevance (best match first).
 * @param notes  Optional user-written notes for the notebook.
 */
export function buildRagPrompt(
  query: string,
  chunks: RagChunk[],
  notes?: Array<{ title: string; content: string }>,
): PromptPair {
  const contextBlocks = chunks.map((chunk, i) => {
    const num = i + 1 // 1-based for human readability
    const source =
      chunk.pageNumber != null
        ? `source: ${chunk.sourceName}, page: ${chunk.pageNumber}`
        : `source: ${chunk.sourceName}`
    return `[${num}] (${source}): ${chunk.content}`
  })

  const parts: string[] = []

  // Notes section (if any)
  if (notes && notes.length > 0) {
    parts.push('## User Notes')
    parts.push(
      'The following are notes written by the user. Treat them as authoritative context:',
      '',
    )
    for (const note of notes) {
      parts.push(`### ${note.title}`)
      parts.push(note.content, '')
    }
    parts.push('---', '')
  }

  // Context blocks
  if (contextBlocks.length > 0) {
    parts.push(`Context:\n${contextBlocks.join('\n')}`)
  } else {
    parts.push('Context: (no relevant documents found)')
  }

  parts.push('', `Question: ${query}`)
  const user = parts.join('\n')

  return { system: RAG_SYSTEM_PROMPT, user }
}

export const GENERAL_SYSTEM_PROMPT = [
  'You are a helpful assistant.',
  'If there are notes available, treat them as context.',
  'If the user is asking a question and there are no relevant documents or no documents at all, answer to the best of your ability using your general knowledge.',
  'However, you MUST politely mention at the beginning of your response that you could not find any relevant documents in their notebook.',
].join('\n')

export function buildGeneralPrompt(
  query: string,
  notes?: Array<{ title: string; content: string }>,
): PromptPair {
  const parts: string[] = []

  if (notes && notes.length > 0) {
    parts.push('## User Notes')
    parts.push(
      'The following are notes written by the user. Treat them as authoritative context:',
      '',
    )
    for (const note of notes) {
      parts.push(`### ${note.title}`)
      parts.push(note.content, '')
    }
    parts.push('---', '')
  }

  parts.push(`Question: ${query}`)
  const user = parts.join('\n')

  return { system: GENERAL_SYSTEM_PROMPT, user }
}

// ---------------------------------------------------------------------------
// Summarization prompt builder (interface for M2+)
// ---------------------------------------------------------------------------

/**
 * Build a summarization prompt for a long document.
 *
 * @param fullText  The complete text to summarize.
 */
export function buildSummarizationPrompt(fullText: string): PromptPair {
  const user = [
    'Please summarize the following document:',
    '',
    '--- DOCUMENT START ---',
    fullText,
    '--- DOCUMENT END ---',
  ].join('\n')

  return { system: SUMMARIZATION_SYSTEM_PROMPT, user }
}

// ---------------------------------------------------------------------------
// Hallucination guard helpers (post-processing)
// ---------------------------------------------------------------------------

/**
 * Extract all citation numbers from an LLM response string.
 *
 * Matches patterns like [1], [12], [1,2,3], [1-3].
 * Returns a deduplicated set of individual chunk reference numbers.
 */
export function extractCitations(response: string): Set<number> {
  const numbers = new Set<number>()

  // Match [N], [N,M], [N-M] patterns
  const citationRegex = /\[(\d+(?:[,|-]\d+)*)\]/g
  let match: RegExpExecArray | null

  while ((match = citationRegex.exec(response)) !== null) {
    const inner = match[1] // e.g. "1" or "1,2,3" or "1-3"
    for (const part of inner.split(',')) {
      if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number)
        if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
          for (let n = lo; n <= hi; n++) numbers.add(n)
        }
      } else {
        const n = Number(part)
        if (!Number.isNaN(n)) numbers.add(n)
      }
    }
  }

  return numbers
}

/**
 * Validate that every citation in the LLM response references a chunk
 * that was actually provided in the context.
 *
 * @param response      The raw LLM output.
 * @param chunkCount    Number of context blocks passed to the model (max valid index).
 * @returns             Object with valid/invalid citation sets.
 */
export function validateCitations(
  response: string,
  chunkCount: number,
): { valid: number[]; invalid: number[] } {
  const cited = extractCitations(response)
  const valid: number[] = []
  const invalid: number[] = []

  for (const n of cited) {
    if (n >= 1 && n <= chunkCount) {
      valid.push(n)
    } else {
      invalid.push(n)
    }
  }

  valid.sort((a, b) => a - b)
  invalid.sort((a, b) => a - b)

  return { valid, invalid }
}

/**
 * Strip or flag citations that reference non-existent context chunks.
 *
 * Strategy: replace invalid `[N]` patterns with `[citation missing]` so
 * the reader knows the model tried to cite something it shouldn't have.
 *
 * @param response   The raw LLM output.
 * @param chunkCount Number of context blocks provided.
 */
export function sanitizeCitations(
  response: string,
  chunkCount: number,
): { sanitized: string; hadInvalid: boolean } {
  let hadInvalid = false
  const sanitized = response.replace(/\[(\d+(?:[,|-]\d+)*)\]/g, (match, inner) => {
    const nums = extractCitationsFromInner(inner)
    const allValid = nums.every((n) => n >= 1 && n <= chunkCount)
    if (allValid) return match
    hadInvalid = true
    return '[citation missing]'
  })
  return { sanitized, hadInvalid }
}

/** Parse inner text of a citation bracket like "1,2,5-7" → [1,2,5,6,7] */
function extractCitationsFromInner(inner: string): number[] {
  const result: number[] = []
  for (const part of inner.split(',')) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number)
      if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
        for (let n = lo; n <= hi; n++) result.push(n)
      }
    } else {
      const n = Number(part)
      if (!Number.isNaN(n)) result.push(n)
    }
  }
  return result
}

/**
 * Quick heuristic to detect likely hallucinated passages.
 *
 * Checks if the response contains common hallucination markers:
 *   - Missing-context preamble (already handled by system prompt, but
 *     sometimes models still try to answer).
 *   - Fabricated citation numbers (caught by validateCitations).
 *
 * @returns An object with the hallucination risk assessment.
 */
export function assessHallucinationRisk(
  response: string,
  chunkCount: number,
  similarityScores?: number[],
): {
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
} {
  const reasons: string[] = []

  // 1. Citation validity check
  const { invalid } = validateCitations(response, chunkCount)
  if (invalid.length > 0) {
    reasons.push(`fabricated citations: [${invalid.join(', ')}]`)
  }

  // 2. Missing-context disclaimer — if the model itself admits it lacks info
  //    this is actually a *good* outcome, not a hallucination.
  const disclaimerPatterns = [
    /do(?:es)? not contain/i,
    /(?:no|without)\s+(?:relevant\s+)?(?:information|context|data)/i,
    /cannot\s+(?:find|answer|determine)/i,
    /(?:not|isn['’]t)\s+(?:mentioned|covered|included|available)/i,
  ]
  const _modelSaysNo = disclaimerPatterns.some((re) => re.test(response))
  // Not adding as a risk — this is desired behavior.

  // 3. Similarity score analysis
  if (similarityScores && similarityScores.length > 0) {
    const avg = similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
    const max = Math.max(...similarityScores)
    if (max < 0.5) {
      reasons.push(`low max similarity (${max.toFixed(2)}) — context may be irrelevant`)
    }
    if (avg < 0.3) {
      reasons.push(`low avg similarity (${avg.toFixed(2)})`)
    }
  }

  // 4. Empty response — always flag as high risk
  if (response.trim().length === 0) {
    reasons.push('empty response')
    return { risk: 'high', reasons }
  }

  if (
    reasons.length >= 2 ||
    invalid.length > 0 ||
    (similarityScores && Math.max(...similarityScores) < 0.3)
  ) {
    return { risk: 'high', reasons }
  }
  if (reasons.length === 1) {
    return { risk: 'medium', reasons }
  }
  return { risk: 'low', reasons: [] }
}
