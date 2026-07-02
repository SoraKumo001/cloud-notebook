// packages/backend/src/sessions.test.ts
// Tests for session CRUD endpoints (DELETE, PATCH).

import { describe, expect, it } from 'vitest'
import { chatSessions, notebooks } from './db/schema'
import app from './index'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedSessions(
  userId: string,
  otherUserId: string,
  testEnv: ReturnType<typeof createTestEnv>,
) {
  await testEnv.db.insert(notebooks).values([
    {
      id: 'nb-1',
      userId,
      title: 'Test Notebook',
      description: '',
    },
    {
      id: 'nb-2',
      userId: otherUserId,
      title: 'Other Notebook',
      description: '',
    },
  ])
  await testEnv.db.insert(chatSessions).values([
    {
      id: 'sess-1',
      notebookId: 'nb-1',
      title: 'Chat about PDF',
    },
    {
      id: 'sess-2',
      notebookId: 'nb-2',
      title: 'Other chat',
    },
  ])
}

// ---------------------------------------------------------------------------
// DELETE /api/sessions/:sessionId
// ---------------------------------------------------------------------------

describe('DELETE /api/sessions/:sessionId', () => {
  it('deletes a session owned by the current user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-delete-sess-ok@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/sess-1', cookie, {
        method: 'DELETE',
      }),
      env,
    )
    expect(res.status).toBe(204)
  })

  it('returns 404 when session does not exist', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-delete-sess-nonexist@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/nonexistent', cookie, {
        method: 'DELETE',
      }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when session belongs to another user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-delete-sess-other@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    // sess-2 belongs to nb-2 which is owned by otherUserId
    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/sess-2', cookie, {
        method: 'DELETE',
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/sessions/:sessionId
// ---------------------------------------------------------------------------

describe('PATCH /api/sessions/:sessionId', () => {
  it('renames a session', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-sess-rename@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/sess-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed Chat' }),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Renamed Chat')
    expect(body.id).toBe('sess-1')
  })

  it('returns 400 when title is empty', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-sess-empty@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/sess-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when session does not exist', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-sess-nonexist@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/nonexistent', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when session belongs to another user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-sess-other@example.com',
      adminCookie: cookie,
    })
    await seedSessions(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/sessions/sess-2', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hacked' }),
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})
