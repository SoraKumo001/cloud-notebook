// packages/backend/src/notebooks.test.ts
// Tests for notebook management (list, search, sort, AI settings, source reorder).
// Uses createTestEnv() — real in-memory SQLite + drizzle queries execute for real.

import { describe, expect, it, vi } from 'vitest'
import { notebooks, sources } from './db/schema'
import app from './index'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Seed two notebooks: one for the primary user, one for another user. */
async function seedBasicNotebooks(
  userId: string,
  otherUserId: string,
  testEnv: ReturnType<typeof createTestEnv>,
) {
  await testEnv.db.insert(notebooks).values([
    {
      id: 'nb-1',
      userId,
      title: 'Alpha Project',
      description: 'First notebook',
    },
    {
      id: 'nb-2',
      userId: otherUserId,
      title: 'Other',
      description: '',
    },
  ])
  return testEnv
}

/** Seed three sources: two for nb-1, one for nb-2. */
async function seedBasicSources(
  userId: string,
  otherUserId: string,
  testEnv: ReturnType<typeof createTestEnv>,
) {
  await testEnv.db.insert(sources).values([
    {
      id: 'src-1',
      notebookId: 'nb-1',
      userId,
      name: 'a.pdf',
      type: 'pdf',
      status: 'completed',
      r2Key: 'r2/a',
      displayOrder: 0,
    },
    {
      id: 'src-2',
      notebookId: 'nb-1',
      userId,
      name: 'b.pdf',
      type: 'pdf',
      status: 'completed',
      r2Key: 'r2/b',
      displayOrder: 1,
    },
    {
      id: 'src-3',
      notebookId: 'nb-2',
      userId: otherUserId,
      name: 'c.pdf',
      type: 'pdf',
      status: 'completed',
      r2Key: 'r2/c',
      displayOrder: 2,
    },
  ])
}

// ---------------------------------------------------------------------------
// GET /api/notebooks — whitelist + search/sort
// ---------------------------------------------------------------------------

describe('GET /api/notebooks', () => {
  it('returns only the user-owned notebooks with whitelisted columns', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-whitelist@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(authedRequest('http://localhost/api/notebooks', cookie), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1) // only user's notebooks
    expect(body[0].id).toBe('nb-1')
    expect(body[0].userId).toBe(userId)
    // Sensitive fields MUST NOT be included
    expect(body[0].aiApiKey).toBeUndefined()
    expect(body[0].aiBaseUrl).toBeUndefined()
    expect(body[0].mcpToken).toBeUndefined()
  })

  it('returns correct sourceCount per notebook (counts only completed sources)', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-srccount@example.com',
      adminCookie: cookie,
    })
    const testEnv = { env, db, sqlite }
    await seedBasicNotebooks(userId, otherUserId, testEnv)
    await seedBasicSources(userId, otherUserId, testEnv)
    // Add a processing and a failed source to nb-1 (should not be counted)
    await testEnv.db.insert(sources).values([
      {
        id: 'src-proc',
        notebookId: 'nb-1',
        userId,
        name: 'proc.pdf',
        type: 'pdf',
        status: 'processing',
        r2Key: 'r2/proc',
        displayOrder: 2,
      },
      {
        id: 'src-fail',
        notebookId: 'nb-1',
        userId,
        name: 'fail.pdf',
        type: 'pdf',
        status: 'failed',
        r2Key: 'r2/fail',
        displayOrder: 3,
      },
    ])

    const res = await app.fetch(authedRequest('http://localhost/api/notebooks', cookie), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('nb-1')
    expect(body[0].sourceCount).toBe(2) // only 2 'completed' sources
  })

  it('filters by search query (q)', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-search@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    // nb-1 has title "Alpha Project"
    const res1 = await app.fetch(
      authedRequest('http://localhost/api/notebooks?q=Alpha', cookie),
      env,
    )
    const body1 = (await res1.json()) as unknown[]
    expect(body1).toHaveLength(1)

    // nb-1 description contains "First"
    const res2 = await app.fetch(
      authedRequest('http://localhost/api/notebooks?q=First', cookie),
      env,
    )
    const body2 = (await res2.json()) as unknown[]
    expect(body2).toHaveLength(1)

    // No match
    const res3 = await app.fetch(
      authedRequest('http://localhost/api/notebooks?q=Zebra', cookie),
      env,
    )
    const body3 = (await res3.json()) as unknown[]
    expect(body3).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/notebooks/:id — AI settings
// ---------------------------------------------------------------------------

describe('PATCH /api/notebooks/:id', () => {
  it('updates AI provider and model settings', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-ai@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_provider: 'workers-ai',
          ai_embedding_model: '@cf/baai/bge-m3',
          model_chat: '@cf/meta/llama-3.1-8b-instruct-fast',
          model_summarization: '@cf/meta/llama-3.1-8b-instruct-fast',
        }),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ai_provider).toBe('workers-ai')
    expect(body.ai_embedding_model).toBe('@cf/baai/bge-m3')
    expect(body.model_chat).toBe('@cf/meta/llama-3.1-8b-instruct-fast')
  })

  it('rejects openai provider because the Vectorize index is 1024-dim (M21)', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-openai@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_provider: 'openai' }),
      }),
      env,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Vectorize index is 1024-dim')
  })

  it('returns 400 when ai_provider is an empty string', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-empty@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_provider: '' }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('updates title and description alongside AI settings', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-title@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated Title',
          description: 'Updated desc',
        }),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Updated Title')
    expect(body.description).toBe('Updated desc')
  })
})

// ---------------------------------------------------------------------------
// POST /api/notebooks/:id/sources/reorder
// ---------------------------------------------------------------------------

describe('POST /api/notebooks/:id/sources/reorder', () => {
  it('reorders sources within a notebook', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-reorder-ok@example.com',
      adminCookie: cookie,
    })
    const testEnv = { env, db, sqlite }
    await seedBasicNotebooks(userId, otherUserId, testEnv)
    await seedBasicSources(userId, otherUserId, testEnv)

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/sources/reorder', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds: ['src-2', 'src-1'] }),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-reorder-nonexist@example.com',
      adminCookie: cookie,
    })
    const testEnv = { env, db, sqlite }
    await seedBasicNotebooks(userId, otherUserId, testEnv)
    await seedBasicSources(userId, otherUserId, testEnv)

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent/sources/reorder', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds: ['src-1'] }),
      }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when sourceIds contains invalid IDs', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-reorder-invalid@example.com',
      adminCookie: cookie,
    })
    const testEnv = { env, db, sqlite }
    await seedBasicNotebooks(userId, otherUserId, testEnv)
    await seedBasicSources(userId, otherUserId, testEnv)

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/sources/reorder', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds: ['src-1', 'invalid-id'] }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when notebook belongs to another user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-reorder-other@example.com',
      adminCookie: cookie,
    })
    const testEnv = { env, db, sqlite }
    await seedBasicNotebooks(userId, otherUserId, testEnv)
    await seedBasicSources(userId, otherUserId, testEnv)

    // userA tries to reorder sources in nb-2 (owned by otherUserId)
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/sources/reorder', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds: ['src-3'] }),
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /api/notebooks/:id/stats
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/stats', () => {
  it('returns notebook and global vector count statistics', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-stats-ok@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    // Mock VECTORIZE.describe
    const mockDescribe = vi.fn().mockResolvedValue({
      name: 'test-index',
      dimensions: 1024,
      metric: 'cosine',
      vectorsCount: 42,
    })
    env.VECTORIZE = {
      describe: mockDescribe,
    } as any

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/stats', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, number>
    expect(body.notebookVectorCount).toBe(0)
    expect(body.globalVectorCount).toBe(42)
    expect(mockDescribe).toHaveBeenCalled()
  })

  it('returns 404 for nonexistent notebook', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-stats-nonexist@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent/stats', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when notebook belongs to another user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-stats-other@example.com',
      adminCookie: cookie,
    })
    await seedBasicNotebooks(userId, otherUserId, { env, db, sqlite })

    // userA tries to access nb-2 (owned by otherUserId)
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/stats', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })
})
