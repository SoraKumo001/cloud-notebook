// packages/backend/src/sources.test.ts
// Tests for source CRUD + notebook deletion (sources/notebooks endpoints).

import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { notebooks, sourceChunks, sourceImages, sources } from './db/schema'
import app from './index'
import type { ObjectStorage } from './storage/interface'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

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

    const parts = buffer.split('\n\n')
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

/** Build a default no-op storage adapter. Tests override individual methods. */
function noopStorage(): ObjectStorage {
  return {
    provider: 'r2-binding',
    presign: vi.fn().mockResolvedValue({
      url: 'https://mock-presigned.example/k',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }),
    put: vi.fn().mockResolvedValue({ etag: 'mock-etag', size: 0 }),
    head: vi.fn().mockResolvedValue({ size: 0 }),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(undefined),
    supportsDirectPresign: () => true,
  }
}

async function seedEnv(
  db: ReturnType<typeof createTestEnv>['db'],
  userId: string,
  otherUserId: string,
) {
  await db.insert(notebooks).values([
    {
      id: 'nb-1',
      userId,
      title: 'Test Notebook',
      description: 'A test notebook',
    },
    {
      id: 'nb-2',
      userId: otherUserId,
      title: 'Another User Notebook',
      description: '',
    },
  ])
  await db.insert(sources).values([
    {
      id: 'src-1',
      notebookId: 'nb-1',
      userId,
      name: 'intro.pdf',
      type: 'pdf',
      status: 'completed',
      r2Key: 'notebooks/nb-1/sources/src-1/intro.pdf',
      hash: 'hash-intro',
    },
    {
      id: 'src-2',
      notebookId: 'nb-1',
      userId,
      name: 'notes.txt',
      type: 'text',
      status: 'completed',
      r2Key: 'notebooks/nb-1/sources/src-2/notes.txt',
      hash: 'hash-notes',
    },
  ])
}

function mockEmbeddingVector(): number[] {
  return Array.from({ length: 1024 }, () => Math.random() * 2 - 1)
}

// ---------------------------------------------------------------------------
// GET /api/notebooks/:id
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id', () => {
  it('returns a notebook when it exists and userId matches', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(authedRequest('http://localhost/api/notebooks/nb-1', cookie), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe('nb-1')
    expect(body.user_id).toBe(userId)
    expect(body.title).toBe('Test Notebook')
    expect(body.description).toBe('A test notebook')
    expect(body.ai_provider).toBeNull()
    expect(body.ai_embedding_model).toBeNull()
    expect(body.model_chat).toBeNull()
    expect(body.model_summarization).toBeNull()
    expect(body.created_at).toBeDefined()
    expect(body.updated_at).toBeDefined()
    // Sensitive fields must NOT leak
    expect(body.ai_api_key).toBeUndefined()
    expect(body.ai_base_url).toBeUndefined()
    expect(body.mcp_token).toBeUndefined()
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/non-existent', cookie),
      env,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Notebook not found')
  })

  it('returns 404 when notebook belongs to another user', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    // nb-2 belongs to 'other-user-id', but auth user is userId
    const res = await app.fetch(authedRequest('http://localhost/api/notebooks/nb-2', cookie), env)
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Notebook not found')
  })
})

describe('GET /api/notebooks/:id/sources', () => {
  it('returns an empty array when no sources exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    // notebooks only, no sources
    await db.insert(notebooks).values([
      {
        id: 'nb-1',
        userId,
        title: 'Test Notebook',
        description: 'A test notebook',
      },
    ])
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/sources', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toEqual([])
  })

  it('returns multiple sources for the notebook', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/sources', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body).toHaveLength(2)

    // Verify shape of first source
    const src = body[0] as Record<string, unknown>
    expect(src.id).toBe('src-1')
    expect(src.notebook_id).toBe('nb-1')
    expect(src.name).toBe('intro.pdf')
    expect(src.type).toBe('pdf')
    expect(src.status).toBe('completed')
    expect(src.r2_key).toBeDefined()
    expect(src.created_at).toBeDefined()
    // text_content must NOT be included
    expect(src.text_content).toBeUndefined()
  })

  it('returns 404 when notebook belongs to another user', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/sources', cookie),
      env,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Notebook not found')
  })
})

// ---------------------------------------------------------------------------
// POST /api/sources/finalize — D1 insert + embed + Vectorize upsert
// ---------------------------------------------------------------------------

describe('POST /api/sources/finalize', () => {
  it('inserts chunks, embeds them, and upserts to Vectorize', async () => {
    const mockAiRun = vi.fn().mockImplementation((_model: string, inputs: unknown) => {
      const { text } = inputs as { text: string[] }
      return Promise.resolve({
        shape: [text.length, 1024],
        data: text.map(() => mockEmbeddingVector()),
      })
    })
    const mockUpsert = vi.fn().mockResolvedValue({ count: 2, ids: ['id-1', 'id-2'] })

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    env.VECTORIZE = { upsert: mockUpsert } as any
    env.AI = { run: mockAiRun } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/finalize', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'new-source-1',
          fileName: 'doc.pdf',
          type: 'pdf',
          hash: 'hash-new',
          chunks: [
            { content: 'first chunk text', pageNumber: 1 },
            { content: 'second chunk text' },
          ],
          images: [{ r2Key: 'img/key.png', pageNumber: 1 }],
        }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const events = await collectSSE(res)
    const doneEvent = events.find((e) => e.event === 'done')
    expect(doneEvent).toBeDefined()
    const body = doneEvent?.data as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.embedded).toBe(2)
    expect(body.chunks).toBe(2)
    expect(body.images).toBe(1)

    // AI.run called with both texts in a single batch (batch size 32)
    expect(mockAiRun).toHaveBeenCalledTimes(1)
    expect(mockAiRun).toHaveBeenCalledWith('@cf/baai/bge-m3', {
      text: ['first chunk text', 'second chunk text'],
    })

    // VECTORIZE.upsert called with 2 vectors
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const upsertArg = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(upsertArg).toHaveLength(2)
    expect(upsertArg[0]).toHaveProperty('id')
    expect(upsertArg[0]).toHaveProperty('values')
    expect(upsertArg[0].values as number[]).toHaveLength(1024)

    // Metadata includes source_id and notebook_id
    const meta0 = upsertArg[0].metadata as Record<string, string>
    expect(meta0.source_id).toBe('new-source-1')
    expect(meta0.notebook_id).toBe('nb-1')
    expect(meta0.source_chunk_id).toBeDefined()
  })

  it('marks source as failed when embedding throws', async () => {
    const mockAiRun = vi.fn().mockRejectedValue(new Error('AI API error'))
    const mockUpsert = vi.fn()

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    env.VECTORIZE = { upsert: mockUpsert } as any
    env.AI = { run: mockAiRun } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/finalize', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'new-source-2',
          fileName: 'doc.pdf',
          type: 'pdf',
          hash: 'hash-new-2',
          chunks: [{ content: 'chunk one' }],
        }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const events = await collectSSE(res)
    const errorEvent = events.find((e) => e.event === 'error')
    expect(errorEvent).toBeDefined()
    const body = errorEvent?.data as Record<string, unknown>
    expect(body.message).toContain('AI API error')
    // VECTORIZE should NOT have been called
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/finalize', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('Validation failed')
  })

  it('succeeds with zero chunks (no embed / upsert calls)', async () => {
    const mockAiRun = vi.fn()
    const mockUpsert = vi.fn()

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    env.VECTORIZE = { upsert: mockUpsert } as any
    env.AI = { run: mockAiRun } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/finalize', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'new-source-3',
          fileName: 'empty.txt',
          type: 'text',
          hash: 'hash-empty',
          chunks: [],
        }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const events = await collectSSE(res)
    const doneEvent = events.find((e) => e.event === 'done')
    expect(doneEvent).toBeDefined()
    const body = doneEvent?.data as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.embedded).toBe(0)
    expect(body.chunks).toBe(0)
    expect(mockAiRun).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// POST /api/uploads/presign
// ---------------------------------------------------------------------------

describe('POST /api/uploads/presign', () => {
  it('returns 200 and presigned URL when hash is not duplicated', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/uploads/presign', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'new-source-url',
          fileName: 'new-file.pdf',
          contentType: 'application/pdf',
          fileHash: 'new-unique-hash',
        }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.url).toBeDefined()
    expect(body.r2Key).toBe('notebooks/nb-1/sources/new-source-url/new-file.pdf')
  })

  it('returns 409 Conflict when hash is duplicated within the notebook', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/uploads/presign', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'another-source',
          fileName: 'same-content.pdf',
          contentType: 'application/pdf',
          fileHash: 'hash-intro', // Matches src-1 which is completed
        }),
      }),
      env,
    )

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('already exists')
  })

  it('returns 200 when hash matches a failed source', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    // Insert a failed source with a specific hash
    await db.insert(sources).values({
      id: 'failed-src',
      notebookId: 'nb-1',
      userId,
      name: 'failed.pdf',
      type: 'pdf',
      status: 'failed',
      r2Key: 'notebooks/nb-1/sources/failed-src/failed.pdf',
      hash: 'hash-failed',
    })

    const res = await app.fetch(
      authedRequest('http://localhost/api/uploads/presign', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'retry-source',
          fileName: 'failed.pdf',
          contentType: 'application/pdf',
          fileHash: 'hash-failed',
        }),
      }),
      env,
    )

    expect(res.status).toBe(200)
  })

  it('returns 400 when parameters are missing', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/uploads/presign', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: 'nb-1',
          sourceId: 'some-id',
          // Missing other fields
        }),
      }),
      env,
    )

    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/uploads/direct
// ---------------------------------------------------------------------------

describe('POST /api/uploads/direct', () => {
  it('writes the body to R2 and returns the key/etag/size', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const mockPut = vi.fn().mockResolvedValue({ etag: 'mock-etag', size: 12 })
    env.__storage = { ...noopStorage(), put: mockPut } as any

    const body = new TextEncoder().encode('hello world!')
    const res = await app.fetch(
      authedRequest(
        'http://localhost/api/uploads/direct?key=notebooks/nb-1/sources/direct-1/test.txt&contentType=text/plain',
        cookie,
        { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } },
      ),
      env,
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.r2Key).toBe('notebooks/nb-1/sources/direct-1/test.txt')
    expect(json.etag).toBe('mock-etag')
    expect(json.size).toBe(12)
    expect(mockPut).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the notebook is not owned by the user', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const mockPut = vi.fn()
    env.__storage = { ...noopStorage(), put: mockPut } as any

    // nb-2 is owned by `other-user-id`, not the current user
    const body = new TextEncoder().encode('x')
    const res = await app.fetch(
      authedRequest(
        'http://localhost/api/uploads/direct?key=notebooks/nb-2/sources/x/x.txt&contentType=text/plain',
        cookie,
        { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } },
      ),
      env,
    )

    expect(res.status).toBe(404)
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is empty', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const mockPut = vi.fn()
    env.__storage = { ...noopStorage(), put: mockPut } as any

    const res = await app.fetch(
      authedRequest(
        'http://localhost/api/uploads/direct?key=notebooks/nb-1/sources/x/x.txt&contentType=text/plain',
        cookie,
        { method: 'POST', body: new Uint8Array(0) },
      ),
      env,
    )

    expect(res.status).toBe(400)
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('returns 400 when the key is malformed', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const mockPut = vi.fn()
    env.__storage = { ...noopStorage(), put: mockPut } as any

    const body = new TextEncoder().encode('x')
    const res = await app.fetch(
      authedRequest(
        'http://localhost/api/uploads/direct?key=bogus/key.txt&contentType=text/plain',
        cookie,
        { method: 'POST', body },
      ),
      env,
    )

    expect(res.status).toBe(400)
    expect(mockPut).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/sources/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/sources/:id', () => {
  it('deletes source, its R2 objects, and Vectorize entries', async () => {
    const mockDeleteR2 = vi.fn().mockResolvedValue(undefined)
    const mockDeleteVec = vi.fn().mockResolvedValue({ count: 2, ids: ['chunk-1', 'chunk-2'] })

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    // Seed chunks + images
    await db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'first',
      },
      {
        id: 'chunk-2',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'second',
      },
    ])
    await db.insert(sourceImages).values([
      {
        id: 'img-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        r2Key: 'img/key-1.png',
      },
    ])

    env.__storage = { ...noopStorage(), delete: mockDeleteR2 } as any
    env.VECTORIZE = { deleteByIds: mockDeleteVec } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-1', cookie, { method: 'DELETE' }),
      env,
    )

    expect(res.status).toBe(204)

    // Storage adapter is called once with the batched list of all
    // keys (source file + image). The adapter handles per-key errors
    // internally; here we just confirm the call.
    expect(mockDeleteR2).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2).toHaveBeenCalledWith([
      'notebooks/nb-1/sources/src-1/intro.pdf',
      'img/key-1.png',
    ])

    // Vectorize deleted chunk vectors
    expect(mockDeleteVec).toHaveBeenCalledWith(['chunk-1', 'chunk-2'])
  })

  it('returns 404 when source does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/nonexistent', cookie, { method: 'DELETE' }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/sources/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/sources/:id', () => {
  it('renames a source', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed.pdf' }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('renamed.pdf')
    expect(body.id).toBe('src-1')
  })

  it('returns 400 when name is empty', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
      env,
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 when source does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/nonexistent', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new.pdf' }),
      }),
      env,
    )

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /api/sources/:id/content
// ---------------------------------------------------------------------------

describe('GET /api/sources/:id/content', () => {
  it('returns content from R2 for text source', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const mockGet = vi.fn().mockResolvedValue(new TextEncoder().encode('hello world').buffer)
    env.__storage = { ...noopStorage(), get: mockGet } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-2/content', cookie),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.content).toBe('hello world')
    expect(body.type).toBe('text')
    expect(body.name).toBe('notes.txt')
    expect(mockGet).toHaveBeenCalledWith('notebooks/nb-1/sources/src-2/notes.txt')
  })

  it('falls back to chunks when R2 returns null', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const mockGet = vi.fn().mockResolvedValue(null)
    env.__storage = { ...noopStorage(), get: mockGet } as any

    await db.insert(sourceChunks).values([
      {
        id: 'chunk-a',
        sourceId: 'src-2',
        notebookId: 'nb-1',
        content: 'first chunk',
        pageNumber: 1,
      },
      {
        id: 'chunk-b',
        sourceId: 'src-2',
        notebookId: 'nb-1',
        content: 'second chunk',
        pageNumber: 2,
      },
    ])

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-2/content', cookie),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.content).toBe('first chunk\n\nsecond chunk')
    expect(body.type).toBe('text')
    expect(body.name).toBe('notes.txt')
  })

  it('returns 400 for pdf source', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-1/content', cookie),
      env,
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/cannot be edited/i)
  })

  it('returns 404 when source does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/nonexistent/content', cookie),
      env,
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when source belongs to another user', async () => {
    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    // Seed a source under nb-2 (owned by otherUserId)
    await db.insert(sources).values({
      id: 'src-other',
      notebookId: 'nb-2',
      userId: 'other-user-id',
      name: 'other.txt',
      type: 'text',
      status: 'completed',
      r2Key: 'notebooks/nb-2/sources/src-other/other.txt',
      hash: 'hash-other',
    })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-other/content', cookie),
      env,
    )

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/sources/:id/content
// ---------------------------------------------------------------------------

describe('PUT /api/sources/:id/content', () => {
  it('updates content in R2 and re-chunks/re-embeds', async () => {
    const mockAiRun = vi.fn().mockImplementation((_model: string, inputs: unknown) => {
      const { text } = inputs as { text: string[] }
      return Promise.resolve({
        shape: [text.length, 1024],
        data: text.map(() => mockEmbeddingVector()),
      })
    })
    const mockUpsert = vi.fn().mockResolvedValue({ count: 1, ids: ['vec-1'] })
    const mockDeleteVec = vi.fn().mockResolvedValue({ count: 2, ids: ['old-1', 'old-2'] })
    const mockPut = vi.fn().mockResolvedValue({ etag: 'new-etag', size: 11 })

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    // Seed existing chunks for src-2
    await db.insert(sourceChunks).values([
      {
        id: 'old-chunk-1',
        sourceId: 'src-2',
        notebookId: 'nb-1',
        content: 'old content one',
        pageNumber: 1,
      },
      {
        id: 'old-chunk-2',
        sourceId: 'src-2',
        notebookId: 'nb-1',
        content: 'old content two',
        pageNumber: 2,
      },
    ])

    env.__storage = { ...noopStorage(), put: mockPut } as any
    env.AI = { run: mockAiRun } as any
    env.VECTORIZE = { upsert: mockUpsert, deleteByIds: mockDeleteVec } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-2/content', cookie, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'new content here',
          chunks: [{ content: 'new content here' }],
        }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.chunks).toBe(1)
    expect(body.embedded).toBe(1)
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/)

    // R2 put called with the r2Key and new content
    expect(mockPut).toHaveBeenCalledWith(
      'notebooks/nb-1/sources/src-2/notes.txt',
      expect.any(Uint8Array),
      'text/plain',
    )

    // Vectorize deleteByIds called with old chunk ids
    expect(mockDeleteVec).toHaveBeenCalledWith(['old-chunk-1', 'old-chunk-2'])

    // Vectorize upsert called with 1 vector
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const upsertArg = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(upsertArg).toHaveLength(1)
    expect(upsertArg[0]).toHaveProperty('id')
    expect(upsertArg[0]).toHaveProperty('values')
    expect((upsertArg[0].values as number[]).length).toBe(1024)

    // D1: old chunks deleted, new chunk inserted
    const remaining = await db.select().from(sourceChunks).where(eq(sourceChunks.sourceId, 'src-2'))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].content).toBe('new content here')
  })

  it('updates content without chunks (just file + hash)', async () => {
    const mockPut = vi.fn().mockResolvedValue({ etag: 'new-etag', size: 8 })
    const mockUpsert = vi.fn()
    const mockDeleteVec = vi.fn()

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    env.__storage = { ...noopStorage(), put: mockPut } as any
    env.AI = { run: vi.fn() } as any
    env.VECTORIZE = { upsert: mockUpsert, deleteByIds: mockDeleteVec } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-2/content', cookie, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'just text' }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.chunks).toBe(0)
    expect(body.embedded).toBe(0)
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/)

    // R2 put called
    expect(mockPut).toHaveBeenCalledTimes(1)

    // No Vectorize calls
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockDeleteVec).not.toHaveBeenCalled()
  })

  it('returns 400 for pdf source', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-1/content', cookie, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      }),
      env,
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/cannot be edited/i)
  })

  it('returns 400 when content is empty', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/src-2/content', cookie, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      }),
      env,
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 when source does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')

    const res = await app.fetch(
      authedRequest('http://localhost/api/sources/nonexistent/content', cookie, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'valid content' }),
      }),
      env,
    )

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/notebooks/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/notebooks/:id', () => {
  it('updates notebook title and description', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title', description: 'Updated desc' }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Updated Title')
    expect(body.description).toBe('Updated desc')
    // Sensitive fields must NOT leak (null means not set, also acceptable)
    expect(body.ai_api_key).toBeUndefined()
    expect(body.ai_base_url == null).toBe(true)
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when title is empty', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when notebook belongs to another user', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    // nb-2 belongs to 'other-user-id'
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hacked' }),
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/notebooks/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/notebooks/:id', () => {
  it('deletes notebook and all its associated resources', async () => {
    const mockDeleteR2 = vi.fn().mockResolvedValue(undefined)
    const mockDeleteVec = vi.fn().mockResolvedValue({ count: 2 })

    const { env: rawEnv, db } = createTestEnv()
    const env = rawEnv as any
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    await db.insert(sourceChunks).values([
      {
        id: 'chunk-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        content: 'first',
      },
      {
        id: 'chunk-2',
        sourceId: 'src-2',
        notebookId: 'nb-1',
        content: 'second',
      },
    ])
    await db.insert(sourceImages).values([
      {
        id: 'img-1',
        sourceId: 'src-1',
        notebookId: 'nb-1',
        r2Key: 'img/k1.png',
      },
    ])

    env.__storage = { ...noopStorage(), delete: mockDeleteR2 } as any
    env.VECTORIZE = { deleteByIds: mockDeleteVec } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, { method: 'DELETE' }),
      env,
    )

    expect(res.status).toBe(204)

    // Adapter is called once with a batched list of all keys
    expect(mockDeleteR2).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2).toHaveBeenCalledWith([
      'notebooks/nb-1/sources/src-1/intro.pdf',
      'notebooks/nb-1/sources/src-2/notes.txt',
      'img/k1.png',
    ])

    // Vectorize should have deleted all chunk vectors
    expect(mockDeleteVec).toHaveBeenCalledWith(['chunk-1', 'chunk-2'])
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent', cookie, { method: 'DELETE' }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when notebook belongs to another user', async () => {
    const { env, db } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    await seedEnv(db, userId, 'other-user-id')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2', cookie, { method: 'DELETE' }),
      env,
    )
    expect(res.status).toBe(404)
  })
})
