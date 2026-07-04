// packages/backend/src/embeddings.ts
// Embedding utilities: Workers AI (bge-large-en-v1.5) and OpenAI-compatible provider abstraction.

import type { Ai } from '@cloudflare/workers-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

export interface EmbedResult {
  id: string
  values: number[]
  metadata: Record<string, string>
}

export interface EmbedOptions {
  concurrency?: number
  maxRetries?: number
}

export interface EmbeddingProviderContext {
  provider: string
  apiKey: string | null
  baseUrl: string | null
  model: string
}

// ---------------------------------------------------------------------------
// Promise pool helper
// ---------------------------------------------------------------------------

async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i], i)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastError = err
      if (attempt >= options.maxRetries) break

      const status =
        typeof err === 'object' && err !== null
          ? ((err as Record<string, unknown>).status ?? (err as Record<string, unknown>).statusCode)
          : undefined

      if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
        const delay = options.baseDelayMs * 2 ** attempt + Math.random() * 200
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      throw err
    }
  }

  throw lastError
}

// ---------------------------------------------------------------------------
// Workers AI embedding helpers
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = '@cf/baai/bge-m3'
const DEFAULT_CONCURRENCY = 2
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 500
const BATCH_SIZE = 32

function normaliseChunks(
  chunks: string[] | Array<{ id: string; content: string }>,
): Array<{ id: string; content: string }> {
  if (chunks.length === 0) return []
  if (typeof chunks[0] === 'string') {
    return (chunks as string[]).map((text) => ({
      id: crypto.randomUUID(),
      content: text,
    }))
  }
  return chunks as Array<{ id: string; content: string }>
}

/**
 * Embed an array of text chunks via the specified EmbeddingProvider.
 */
export async function embedChunks(
  provider: EmbeddingProvider,
  chunks: string[] | Array<{ id: string; content: string }>,
  options?: EmbedOptions,
): Promise<EmbedResult[]> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES

  const normalised = normaliseChunks(chunks)

  const batches: Array<Array<{ id: string; content: string }>> = []
  for (let i = 0; i < normalised.length; i += BATCH_SIZE) {
    batches.push(normalised.slice(i, i + BATCH_SIZE))
  }

  const batchResults = await promisePool(batches, concurrency, async (batch, batchIndex) => {
    const texts = batch.map((c) => c.content)

    const data = await withRetry(
      () =>
        provider.embed(texts).then((res) => {
          if (!res || res.length === 0) {
            throw new Error(`Embedding returned empty data for batch ${batchIndex}`)
          }
          return res
        }),
      { maxRetries, baseDelayMs: DEFAULT_BASE_DELAY_MS },
    )

    if (data.length !== batch.length) {
      throw new Error(`Batch ${batchIndex}: expected ${batch.length} vectors, got ${data.length}`)
    }

    return batch.map((chunk, j) => ({
      id: chunk.id,
      values: data[j],
      metadata: { source_chunk_id: chunk.id },
    }))
  })

  const results: EmbedResult[] = []
  for (const br of batchResults) results.push(...br)
  return results
}

/**
 * Embed a single query string via the specified EmbeddingProvider.
 */
export async function embedQuery(provider: EmbeddingProvider, query: string): Promise<number[]> {
  const data = await provider.embed([query])
  if (!data || data.length === 0) {
    throw new Error('Embedding returned empty data for query')
  }
  return data[0]
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export function getEmbeddingProvider(
  env: { AI: Ai },
  config: EmbeddingProviderContext,
): EmbeddingProvider {
  const provider = config.provider
  const model = config.model

  if (provider === 'workers-ai') {
    return {
      embed: async (texts: string[]) => {
        const result = await env.AI.run((model as keyof Ai) || (EMBEDDING_MODEL as keyof Ai), {
          text: texts,
        })
        const output = result as { data?: number[][]; shape?: number[] }
        const data = output.data
        if (!data || data.length === 0) {
          throw new Error('Embedding returned empty data')
        }
        return data as number[][]
      },
    }
  }

  if (provider === 'openai' || provider === 'custom') {
    const key = config.apiKey || ''
    const url = `${config.baseUrl || 'https://api.openai.com/v1'}/embeddings`
    return {
      embed: async (texts: string[]) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (key) {
          headers.Authorization = `Bearer ${key}`
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: texts,
            model: model || 'text-embedding-3-small',
          }),
        })
        if (!res.ok) {
          throw new Error(`OpenAI embedding API error ${res.status}: ${await res.text()}`)
        }
        const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
        return json.data.map((d) => d.embedding)
      },
    }
  }

  if (provider === 'google') {
    const key = config.apiKey || ''
    const cleanModel = model.replace(/^models\//, '')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:embedContent?key=${key}`
    return {
      embed: async (texts: string[]) => {
        const results: number[][] = []
        for (const text of texts) {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: { parts: [{ text }] },
            }),
          })
          if (!res.ok) {
            throw new Error(`Google embedding API error ${res.status}: ${await res.text()}`)
          }
          const json = (await res.json()) as { embedding: { values: number[] } }
          results.push(json.embedding.values)
        }
        return results
      },
    }
  }

  throw new Error(`Unsupported embedding provider: ${provider}`)
}
