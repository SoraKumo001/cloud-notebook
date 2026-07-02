// packages/backend/src/chat.test.ts
// Tests for streaming SSE chat (streamChat, formatSSE).
// Uses a real in-memory SQLite DB via createTestEnv() — drizzle queries execute for real.

import { describe, expect, it, vi } from 'vitest'
import { formatSSE, streamChat } from './chat'
import { chatMessages, notebooks, sourceChunks, sources } from './db/schema'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SSE parser: reads a ReadableStream and returns all events as objects. */
async function collectSSE(response: Response): Promise<Array<{ event: string; data: unknown }>> {
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: Array<{ event: string; data: unknown }> = []

  while (true) {
    if (!reader) break
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE events are separated by \n\n
    const parts = buffer.split('\n\n')
    // Keep the last (possibly incomplete) part in buffer
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      if (!part.trim()) continue
      const lines = part.split('\n')
      let event = ''
      let dataStr = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) dataStr = line.slice(6)
      }
      if (dataStr) {
        events.push({ event, data: JSON.parse(dataStr) })
      }
    }
  }

  return events
}

/** Create a fake AI.run mock that handles both embedding and chat streaming. */
function createMockAi(embeddingVector?: number[], chatTokens?: string[]) {
  const vec = embeddingVector ?? Array.from({ length: 1024 }, () => 0.1)
  const tokens = chatTokens ?? ['Hello', ' world', '!']

  return vi.fn((model: string, inputs: unknown) => {
    // Embedding model
    if (model === '@cf/baai/bge-large-en-v1.5') {
      const { text } = inputs as { text: string | string[] }
      const texts = Array.isArray(text) ? text : [text]
      return Promise.resolve({
        shape: [texts.length, 1024],
        data: texts.map(() => vec),
      })
    }

    // Chat model (streaming)
    if (model === '@cf/meta/llama-3.1-8b-instruct-fast') {
      // Create a ReadableStream that yields SSE-formatted chunks
      const chunks = tokens.map((t) => `data: ${JSON.stringify({ response: t })}\n\n`)
      return Promise.resolve(
        new ReadableStream({
          start(controller) {
            for (const c of chunks) {
              controller.enqueue(new TextEncoder().encode(c))
            }
            controller.close()
          },
        }),
      )
    }

    return Promise.resolve(null)
  })
}

// ---------------------------------------------------------------------------
// formatSSE
// ---------------------------------------------------------------------------

describe('formatSSE', () => {
  it('formats event and data correctly', () => {
    const result = formatSSE('meta', { sessionId: 'abc' })
    expect(result).toContain('event: meta')
    expect(result).toContain('data: ')
    expect(result).toContain('"sessionId":"abc"')
    expect(result.endsWith('\n\n')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// streamChat — normal flow
// ---------------------------------------------------------------------------

describe('streamChat', () => {
  it('returns SSE events in order: meta → delta* → done', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
    await seeded.db.insert(sources).values({
      id: 'src-1',
      notebookId: 'nb-1',
      userId: 'user-1',
      name: 'france.pdf',
      type: 'pdf',
      status: 'completed',
    })
    await seeded.db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'Paris is the capital of France.',
        pageNumber: 1,
      },
      {
        id: 'chunk-2',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'The Eiffel Tower is in Paris.',
        pageNumber: 2,
      },
    ])

    const vectorMatches = {
      matches: [
        { id: 'vec-1', score: 0.85, metadata: { source_chunk_id: 'chunk-1' } },
        { id: 'vec-2', score: 0.72, metadata: { source_chunk_id: 'chunk-2' } },
      ],
      count: 2,
    }

    const env = seeded.env as any
    env.VECTORIZE = { query: vi.fn().mockResolvedValue(vectorMatches) } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'What is the capital of France?')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')

    const events = await collectSSE(response)

    // Order: meta, delta*, done
    const eventTypes = events.map((e) => e.event)
    expect(eventTypes[0]).toBe('meta')
    expect(eventTypes[eventTypes.length - 1]).toBe('done')
    // At least one delta
    const deltas = events.filter((e) => e.event === 'delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)

    // meta event shape
    const metaData = events[0].data as Record<string, unknown>
    expect(metaData).toHaveProperty('sessionId')
    expect(metaData).toHaveProperty('chunks')
    const chunksArr = metaData.chunks as Array<Record<string, unknown>>
    expect(chunksArr).toHaveLength(2)
    expect(chunksArr[0]).toHaveProperty('sourceName', 'france.pdf')
    expect(chunksArr[0]).toHaveProperty('score', 0.85)

    // done event shape
    const doneData = events[events.length - 1].data as Record<string, unknown>
    expect(doneData).toHaveProperty('finalText')
    expect(doneData).toHaveProperty('citations')
    expect(doneData).toHaveProperty('risk')
    expect((doneData.finalText as string).length).toBeGreaterThan(0)
  })

  it('returns 400-like error event when user_id does not match', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })

    const env = seeded.env as any
    env.VECTORIZE = { query: vi.fn() } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'wrong-user', 'some question')

    const events = await collectSSE(response)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('error')
    expect((events[0].data as Record<string, unknown>).message).toContain('Notebook not found')
  })

  it('short-circuits with done when Vectorize returns empty matches', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })

    const env = seeded.env as any
    env.VECTORIZE = {
      query: vi.fn().mockResolvedValue({ matches: [], count: 0 }),
    } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'irrelevant question')

    const events = await collectSSE(response)
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].event).toBe('meta')
    expect((events[0].data as Record<string, unknown>).chunks).toEqual([])

    const doneEvent = events[events.length - 1]
    expect(doneEvent.event).toBe('done')
    const doneData = doneEvent.data as Record<string, unknown>
    expect((doneData.risk as Record<string, unknown>).risk).toBe('high')
  })

  it('sends error event when LLM streaming fails', async () => {
    const ai = vi.fn((model: string) => {
      if (model === '@cf/baai/bge-large-en-v1.5') {
        return Promise.resolve({
          shape: [1, 1024],
          data: [Array.from({ length: 1024 }, () => 0.1)],
        })
      }
      // Chat model throws
      return Promise.reject(new Error('LLM overloaded'))
    })

    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
    await seeded.db.insert(sources).values({
      id: 'src-1',
      notebookId: 'nb-1',
      userId: 'user-1',
      name: 'france.pdf',
      type: 'pdf',
      status: 'completed',
    })
    await seeded.db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'Paris is the capital of France.',
        pageNumber: 1,
      },
    ])

    const env = seeded.env as any
    env.VECTORIZE = {
      query: vi.fn().mockResolvedValue({
        matches: [
          {
            id: 'vec-1',
            score: 0.85,
            metadata: { source_chunk_id: 'chunk-1' },
          },
        ],
        count: 1,
      }),
    } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'some question')

    const events = await collectSSE(response)
    // Should have meta first, then error
    expect(events[0].event).toBe('meta')
    const lastEvent = events[events.length - 1]
    expect(lastEvent.event).toBe('error')
    expect((lastEvent.data as Record<string, unknown>).message).toContain('LLM overloaded')
  })

  it('creates a new session when sessionId is not provided', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
    await seeded.db.insert(sources).values({
      id: 'src-1',
      notebookId: 'nb-1',
      userId: 'user-1',
      name: 'france.pdf',
      type: 'pdf',
      status: 'completed',
    })
    await seeded.db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'Paris is the capital of France.',
        pageNumber: 1,
      },
    ])

    const env = seeded.env as any
    env.VECTORIZE = {
      query: vi.fn().mockResolvedValue({
        matches: [
          {
            id: 'vec-1',
            score: 0.85,
            metadata: { source_chunk_id: 'chunk-1' },
          },
        ],
        count: 1,
      }),
    } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'some question')

    const events = await collectSSE(response)
    const metaData = events[0].data as Record<string, unknown>
    // sessionId should be a UUID string
    expect(metaData.sessionId).toBeDefined()
    expect(typeof metaData.sessionId).toBe('string')
    expect((metaData.sessionId as string).length).toBeGreaterThan(0)
  })

  it('saves both user and assistant messages to DB', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
    await seeded.db.insert(sources).values({
      id: 'src-1',
      notebookId: 'nb-1',
      userId: 'user-1',
      name: 'france.pdf',
      type: 'pdf',
      status: 'completed',
    })
    await seeded.db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'Paris is the capital of France.',
        pageNumber: 1,
      },
    ])

    const env = seeded.env as any
    env.VECTORIZE = {
      query: vi.fn().mockResolvedValue({
        matches: [
          {
            id: 'vec-1',
            score: 0.85,
            metadata: { source_chunk_id: 'chunk-1' },
          },
        ],
        count: 1,
      }),
    } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'some question')

    await collectSSE(response)

    // After streaming, verify chat_messages table has 2 entries
    const rows = await seeded.db.select().from(chatMessages)
    expect(rows).toHaveLength(2)
    expect(rows[0].role).toBe('user')
    expect(rows[0].content).toBe('some question')
    expect(rows[1].role).toBe('assistant')
    expect(rows[1].content.length).toBeGreaterThan(0)
  })

  it('automatically triggers re-indexing and queries again when first query returns 0 matches but D1 has chunks', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test notebook',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
    await seeded.db.insert(sources).values({
      id: 'src-1',
      notebookId: 'nb-1',
      userId: 'user-1',
      name: 'france.pdf',
      type: 'pdf',
      status: 'completed',
    })
    await seeded.db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'Paris is the capital of France.',
        pageNumber: 1,
      },
    ])

    const env = seeded.env as any
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ matches: [], count: 0 })
      .mockResolvedValueOnce({
        matches: [{ id: 'vec-1', score: 0.85, metadata: { source_chunk_id: 'chunk-1' } }],
        count: 1,
      })
    const mockUpsert = vi.fn().mockResolvedValue({ count: 1 })

    env.VECTORIZE = {
      query: mockQuery,
      upsert: mockUpsert,
    } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'What is Paris?')
    const events = await collectSSE(response)

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledTimes(2)

    const doneEvent = events.find((e) => e.event === 'done')
    expect(doneEvent).toBeDefined()
    const doneData = doneEvent?.data as any
    expect(doneData.risk.risk).toBe('low')
  })
})
