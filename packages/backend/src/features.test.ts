// packages/backend/src/features.test.ts
// Tests for 6 new features: suggested questions, source-scoped Q&A, bulk source delete,
// chat history search, webpage refresh, and notebook export.

import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { streamChat } from './chat'
import { chatMessages, chatSessions, notebooks, notes, sourceChunks, sources } from './db/schema'
import app from './index'
import { chunkText } from './lib/chunker'
import type { ObjectStorage } from './storage/interface'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noopStorage(): ObjectStorage {
  return {
    provider: 'r2-binding',
    presign: vi
      .fn()
      .mockResolvedValue({ url: 'https://mock.example/k', expiresAt: '2030-01-01T00:00:00.000Z' }),
    put: vi.fn().mockResolvedValue({ etag: 'mock-etag', size: 0 }),
    head: vi.fn().mockResolvedValue({ size: 0 }),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(undefined),
    supportsDirectPresign: () => true,
  }
}

function mockEmbeddingVector(): number[] {
  return Array.from({ length: 1024 }, () => Math.random() * 2 - 1)
}

function createMockAi(chatResponse?: string) {
  const resp =
    chatResponse ??
    '["What is the capital?", "How does it work?", "Why is it important?", "When was it created?", "Who discovered it?"]'
  return vi.fn((model: string, inputs: unknown) => {
    if (model === '@cf/baai/bge-m3') {
      const { text } = inputs as { text: string | string[] }
      const texts = Array.isArray(text) ? text : [text]
      return Promise.resolve({
        shape: [texts.length, 1024],
        data: texts.map(() => mockEmbeddingVector()),
      })
    }
    if (model === '@cf/meta/llama-3.1-8b-instruct-fast') {
      const chunks = [`data: ${JSON.stringify({ response: resp })}\n\n`]
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

async function seedEnv(
  db: ReturnType<typeof createTestEnv>['db'],
  userId: string,
  otherUserId: string,
) {
  await db.insert(notebooks).values([
    { id: 'nb-1', userId, title: 'Test Notebook', description: 'A test notebook' },
    { id: 'nb-2', userId: otherUserId, title: 'Other', description: '' },
  ])
  await db.insert(sources).values([
    {
      id: 'src-1',
      notebookId: 'nb-1',
      userId,
      name: 'intro.pdf',
      type: 'pdf',
      status: 'completed',
      r2Key: 'r2/intro.pdf',
      hash: 'h1',
    },
    {
      id: 'src-2',
      notebookId: 'nb-1',
      userId,
      name: 'webpage.txt',
      type: 'webpage',
      status: 'completed',
      r2Key: 'r2/webpage.txt',
      hash: 'h2',
      url: 'https://example.com',
    },
    {
      id: 'src-3',
      notebookId: 'nb-2',
      userId: otherUserId,
      name: 'other.pdf',
      type: 'pdf',
      status: 'completed',
      r2Key: 'r2/other.pdf',
      hash: 'h3',
    },
  ])
}

// ---------------------------------------------------------------------------
// Feature #1: Suggested Questions
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/suggested-questions', () => {
  it('returns questions when chunks exist', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    await db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'Paris is the capital of France.',
      },
      {
        id: 'chunk-2',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'The Eiffel Tower is in Paris.',
      },
    ])
    env.AI = { run: createMockAi() } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/suggested-questions', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { questions: string[] }
    expect(body.questions).toBeDefined()
    expect(Array.isArray(body.questions)).toBe(true)
    expect(body.questions.length).toBeGreaterThan(0)
  })

  it('returns empty questions when no chunks exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/suggested-questions', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { questions: string[] }
    expect(body.questions).toEqual([])
  })

  it('returns 404 for other user notebook', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/suggested-questions', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Feature #2: Source-Scoped Q&A
// ---------------------------------------------------------------------------

describe('Source-scoped Q&A (sourceId in chat)', () => {
  it('passes sourceId to Vectorize filter', async () => {
    const ai = createMockAi()
    const seeded = createTestEnv()
    await seeded.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'user-1',
      title: 'Test',
      aiProvider: 'workers-ai',
      modelChat: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
    await seeded.db.insert(sources).values({
      id: 'src-1',
      notebookId: 'nb-1',
      userId: 'user-1',
      name: 'doc.pdf',
      type: 'pdf',
      status: 'completed',
    })
    await seeded.db
      .insert(sourceChunks)
      .values([{ id: 'chunk-1', sourceId: 'src-1', notebookId: 'nb-1', content: 'Test content.' }])

    const mockQuery = vi.fn().mockResolvedValue({
      matches: [{ id: 'vec-1', score: 0.85, metadata: { source_chunk_id: 'chunk-1' } }],
      count: 1,
    })

    const env = seeded.env as any
    env.VECTORIZE = { query: mockQuery } as any
    env.AI = { run: ai } as any

    const response = await streamChat(env, 'nb-1', 'user-1', 'test question', undefined, 'src-1')

    // Collect SSE to ensure it works
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let _buffer = ''
    while (true) {
      if (!reader) break
      const { done, value } = await reader.read()
      if (done) break
      _buffer += decoder.decode(value, { stream: true })
    }

    // Verify the filter included source_id
    expect(mockQuery).toHaveBeenCalled()
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[1].filter).toHaveProperty('source_id')
    expect(callArgs[1].filter.source_id).toEqual({ $eq: 'src-1' })
  })
})

// ---------------------------------------------------------------------------
// Feature #3: Bulk Source Delete
// ---------------------------------------------------------------------------

describe('DELETE /api/sources (bulk)', () => {
  it('deletes multiple owned sources and skips unowned ones', async () => {
    const mockDeleteR2 = vi.fn().mockResolvedValue(undefined)
    const mockDeleteVec = vi.fn().mockResolvedValue({ count: 2 })

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    await db.insert(sourceChunks).values([
      { id: 'chunk-1', sourceId: 'src-1', notebookId: 'nb-1', content: 'first' },
      { id: 'chunk-2', sourceId: 'src-2', notebookId: 'nb-1', content: 'second' },
    ])

    env.__storage = { ...noopStorage(), delete: mockDeleteR2 } as any
    env.VECTORIZE = { deleteByIds: mockDeleteVec } as any

    // Delete src-1 (owned) and src-3 (unowned)
    const res = await app.fetch(
      authedRequest('http://localhost/api/sources', cookie, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['src-1', 'src-3'] }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number; skipped: number }
    expect(body.deleted).toBe(1) // src-1 owned
    expect(body.skipped).toBe(1) // src-3 not owned

    // Verify src-1 is deleted from D1
    const remaining = await db.select().from(sources).where(eq(sources.id, 'src-1'))
    expect(remaining).toHaveLength(0)
  })

  it('returns 400 for empty ids array', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources', cookie, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Feature #4: Chat History Search
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/sessions/search', () => {
  it('searches chat messages by keyword', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    // Create a session with messages
    await db.insert(chatSessions).values({
      id: 'session-1',
      notebookId: 'nb-1',
      title: 'Test Session',
    })
    await db.insert(chatMessages).values([
      {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'What is the capital of France?',
      },
      { id: 'msg-2', sessionId: 'session-1', role: 'assistant', content: 'Paris is the capital.' },
    ])

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/sessions/search?q=capital', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ session: any; messages: any[] }> }
    expect(body.results).toHaveLength(1)
    expect(body.results[0].session.title).toBe('Test Session')
    expect(body.results[0].messages.length).toBeGreaterThan(0)
  })

  it('returns empty results for no match', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/sessions/search?q=zzzzz', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: any[] }
    expect(body.results).toEqual([])
  })

  it('returns 404 for other user notebook', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/sessions/search?q=test', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Feature #5: Webpage Manual Refresh
// ---------------------------------------------------------------------------

describe('POST /api/sources/:id/refresh', () => {
  it('refreshes a webpage source', async () => {
    const mockAiRun = vi.fn().mockImplementation((_model: string, inputs: unknown) => {
      const { text } = inputs as { text: string[] }
      return Promise.resolve({
        shape: [text.length, 1024],
        data: text.map(() => mockEmbeddingVector()),
      })
    })
    const mockUpsert = vi.fn().mockResolvedValue({ count: 1 })
    const mockDeleteVec = vi.fn().mockResolvedValue({ count: 0 })
    const mockPut = vi.fn().mockResolvedValue({ etag: 'etag', size: 10 })
    const mockDeleteR2 = vi.fn().mockResolvedValue(undefined)

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    // Mock fetch for the webpage
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><p>Hello world content here</p></body></html>'),
    } as any)

    env.__storage = { ...noopStorage(), put: mockPut, delete: mockDeleteR2 } as any
    env.AI = { run: mockAiRun } as any
    env.VECTORIZE = { upsert: mockUpsert, deleteByIds: mockDeleteVec } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-2/refresh', cookie, { method: 'POST' }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.id).toBe('src-2')
  })

  it('returns 400 for non-webpage source', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-1/refresh', cookie, { method: 'POST' }),
      env,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Only webpage sources')
  })

  it('returns 404 for other user source', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-3/refresh', cookie, { method: 'POST' }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Feature #6: Notebook Export
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/export', () => {
  it('exports notebook as markdown', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    // Add some notes
    await db.insert(notes).values({
      id: 'note-1',
      notebookId: 'nb-1',
      title: 'My Note',
      content: 'Note content here',
    })

    // Add a chat session
    await db.insert(chatSessions).values({
      id: 'session-1',
      notebookId: 'nb-1',
      title: 'Chat Session',
    })
    await db.insert(chatMessages).values([
      { id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello' },
      { id: 'msg-2', sessionId: 'session-1', role: 'assistant', content: 'Hi there!' },
    ])

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/export', cookie),
      env,
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toContain('.md')

    const text = await res.text()
    expect(text).toContain('# Test Notebook')
    expect(text).toContain('## Sources')
    expect(text).toContain('## Notes')
    expect(text).toContain('### My Note')
    expect(text).toContain('Note content here')
    expect(text).toContain('## Chat History')
    expect(text).toContain('### Chat Session')
    expect(text).toContain('**User:** Hello')
    expect(text).toContain('**Assistant:** Hi there!')
  })

  it('returns 404 for other user notebook', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/export', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// chunkText unit tests
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('splits text into chunks', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.'
    const chunks = chunkText(text, 50, 10)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0].content).toBeTruthy()
  })

  it('returns empty array for empty text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   ')).toEqual([])
  })
})
