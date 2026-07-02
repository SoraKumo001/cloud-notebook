// packages/backend/src/embeddings.test.ts
// Unit tests for embedding utilities (Promise pool, retry, chunk/query embedding).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { embedChunks, embedQuery, getEmbeddingProvider } from './embeddings'

// ---------------------------------------------------------------------------
// Mock AI binding
// ---------------------------------------------------------------------------

function createMockAi(handler?: (model: string, inputs: unknown) => unknown) {
  const run = vi.fn(
    handler ??
      ((_model: string, inputs: unknown) => {
        const { text } = inputs as { text: string | string[] }
        const texts = Array.isArray(text) ? text : [text]
        return Promise.resolve({
          shape: [texts.length, 1024],
          data: texts.map(() => Array.from({ length: 1024 }, () => Math.random() * 2 - 1)),
        } as const)
      }),
  )
  return { run }
}

// ---------------------------------------------------------------------------
// Shared env / wrappers
// ---------------------------------------------------------------------------

function makeEnv(ai: ReturnType<typeof createMockAi>) {
  return { AI: ai as any }
}

function getProvider(env: any) {
  return getEmbeddingProvider(env, {
    provider: 'workers-ai',
    apiKey: null,
    baseUrl: null,
    model: '',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('embedChunks — Promise pool concurrency', () => {
  it('limits concurrency to the specified value (default 4)', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    const ai = createMockAi(async (_model: string, inputs: unknown) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 20))
      const { text } = inputs as { text: string | string[] }
      const texts = Array.isArray(text) ? text : [text]
      concurrent--
      return {
        shape: [texts.length, 1024],
        data: texts.map(() => Array.from({ length: 1024 }, () => Math.random() * 2 - 1)),
      } as const
    })

    const chunks = Array.from({ length: 10 }, (_, i) => `chunk ${i}`)
    const results = await embedChunks(getProvider(makeEnv(ai)), chunks, { concurrency: 4 })

    expect(results).toHaveLength(10)
    expect(maxConcurrent).toBeLessThanOrEqual(4)
    for (const r of results) {
      expect(r).toHaveProperty('id')
      expect(r).toHaveProperty('values')
      expect(r.values).toHaveLength(1024)
      expect(r.metadata).toHaveProperty('source_chunk_id')
      expect(typeof r.id).toBe('string')
    }
  })
})

describe('embedChunks — retry logic', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('retries on 429 error', async () => {
    let attempts = 0
    const ai = createMockAi(async () => {
      attempts++
      if (attempts <= 2) {
        const err = new Error('Rate limited')
        ;(err as any).status = 429
        throw err
      }
      return {
        shape: [1, 1024],
        data: [Array.from({ length: 1024 }, () => 0.5)],
      } as const
    })

    vi.useRealTimers()

    const results = await embedChunks(getProvider(makeEnv(ai)), ['test'], {
      maxRetries: 3,
      concurrency: 1,
    })

    expect(results).toHaveLength(1)
    expect(attempts).toBe(3)
  })

  it('throws after maxRetries failures', async () => {
    const ai = createMockAi(async () => {
      const err = new Error('Always fails')
      ;(err as any).status = 429
      throw err
    })

    vi.useRealTimers()

    await expect(
      embedChunks(getProvider(makeEnv(ai)), ['test'], {
        maxRetries: 3,
        concurrency: 1,
      }),
    ).rejects.toThrow('Always fails')
  })

  it('does not retry on non-retryable errors (e.g. 400)', async () => {
    let attempts = 0
    const ai = createMockAi(async () => {
      attempts++
      const err = new Error('Bad request')
      ;(err as any).status = 400
      throw err
    })

    vi.useRealTimers()

    await expect(
      embedChunks(getProvider(makeEnv(ai)), ['test'], {
        maxRetries: 3,
        concurrency: 1,
      }),
    ).rejects.toThrow('Bad request')

    expect(attempts).toBe(1)
  })
})

describe('embedChunks — output format', () => {
  it('returns id, values, and metadata for each chunk', async () => {
    const ai = createMockAi()
    const chunks = ['hello', 'world']
    const results = await embedChunks(getProvider(makeEnv(ai)), chunks)

    expect(results).toHaveLength(2)

    for (const r of results) {
      expect(r).toHaveProperty('id')
      expect(r).toHaveProperty('values')
      expect(r).toHaveProperty('metadata')
      expect(r.metadata).toHaveProperty('source_chunk_id')
      expect(r.metadata.source_chunk_id).toBe(r.id)
      expect(Array.isArray(r.values)).toBe(true)
      expect(r.values).toHaveLength(1024)
      expect(typeof r.id).toBe('string')
    }
  })

  it('assigns unique ids to each chunk', async () => {
    const ai = createMockAi()
    const chunks = Array.from({ length: 5 }, (_, i) => `chunk ${i}`)
    const results = await embedChunks(getProvider(makeEnv(ai)), chunks)

    const ids = results.map((r) => r.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(5)
  })

  it('uses caller-provided ids when passed { id, content }[]', async () => {
    const ai = createMockAi()
    const chunks = [
      { id: 'my-id-1', content: 'first' },
      { id: 'my-id-2', content: 'second' },
    ]
    const results = await embedChunks(getProvider(makeEnv(ai)), chunks)

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('my-id-1')
    expect(results[1].id).toBe('my-id-2')
    expect(results[0].metadata.source_chunk_id).toBe('my-id-1')
    expect(results[1].metadata.source_chunk_id).toBe('my-id-2')
  })
})

describe('embedQuery', () => {
  it('returns a 1024-dimensional vector for a single query', async () => {
    const ai = createMockAi()
    const vector = await embedQuery(getProvider(makeEnv(ai)), 'What is machine learning?')

    expect(Array.isArray(vector)).toBe(true)
    expect(vector).toHaveLength(1024)
  })

  it('returns different vectors for different queries', async () => {
    const ai = createMockAi()
    const v1 = await embedQuery(getProvider(makeEnv(ai)), 'hello')
    const v2 = await embedQuery(getProvider(makeEnv(ai)), 'world')

    expect(v1).not.toEqual(v2)
  })
})

describe('getEmbeddingProvider', () => {
  it('returns a workers-ai provider that embeds texts', async () => {
    const ai = createMockAi()
    const env = makeEnv(ai)
    const provider = getEmbeddingProvider(env, {
      provider: 'workers-ai',
      apiKey: null,
      baseUrl: null,
      model: '',
    })

    const embeddings = await provider.embed(['test text'])
    expect(embeddings).toHaveLength(1)
    expect(embeddings[0]).toHaveLength(1024)
  })

  it('throws for unknown provider', async () => {
    const env = makeEnv(createMockAi())
    expect(() =>
      getEmbeddingProvider(env, { provider: 'unknown', apiKey: null, baseUrl: null, model: '' }),
    ).toThrow('Unsupported embedding provider')
  })
})

describe('embedChunks — batch mode', () => {
  it('sends multiple texts in a single API call when batch size is exceeded', async () => {
    const ai = createMockAi()
    const chunks = Array.from({ length: 40 }, (_, i) => `chunk ${i}`)
    const results = await embedChunks(getProvider(makeEnv(ai)), chunks)

    expect(results).toHaveLength(40)

    const calls = ai.run.mock.calls
    expect(calls.length).toBe(2)

    const firstArgs = calls[0][1] as { text: string[] }
    expect(firstArgs.text).toHaveLength(32)

    const secondArgs = calls[1][1] as { text: string[] }
    expect(secondArgs.text).toHaveLength(8)

    expect(results[0].id).toBeDefined()
    expect(results[39].id).toBeDefined()
    expect(results[0].values).toHaveLength(1024)
  })
})
