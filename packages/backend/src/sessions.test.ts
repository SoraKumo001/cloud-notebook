// packages/backend/src/sessions.test.ts
// Tests for session CRUD endpoints (DELETE, PATCH).

import { describe, expect, it } from 'vitest'
import { chatSessions, notebooks } from './db/schema'
import app from './index'
import { createTestEnv } from './test/d1-adapter'

const DEV_USER = 'dev-user'

async function seedEnv() {
  const testEnv = createTestEnv()
  await testEnv.db.insert(notebooks).values([
    {
      id: 'nb-1',
      userId: DEV_USER,
      title: 'Test Notebook',
      description: '',
    },
    {
      id: 'nb-2',
      userId: 'other-user',
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
  return testEnv.env
}

// ---------------------------------------------------------------------------
// DELETE /api/sessions/:sessionId
// ---------------------------------------------------------------------------

describe('DELETE /api/sessions/:sessionId', () => {
  it('deletes a session owned by the current user', async () => {
    const env = await seedEnv()

    const res = await app.fetch(
      new Request('http://localhost/api/sessions/sess-1', { method: 'DELETE' }),
      env,
    )

    expect(res.status).toBe(204)
  })

  it('returns 404 when session does not exist', async () => {
    const env = await seedEnv()

    const res = await app.fetch(
      new Request('http://localhost/api/sessions/nonexistent', { method: 'DELETE' }),
      env,
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when session belongs to another user', async () => {
    const env = await seedEnv()
    // sess-2 belongs to nb-2 which is owned by 'other-user'
    const res = await app.fetch(
      new Request('http://localhost/api/sessions/sess-2', { method: 'DELETE' }),
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
    const env = await seedEnv()

    const res = await app.fetch(
      new Request('http://localhost/api/sessions/sess-1', {
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
    const env = await seedEnv()

    const res = await app.fetch(
      new Request('http://localhost/api/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }),
      env,
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 when session does not exist', async () => {
    const env = await seedEnv()

    const res = await app.fetch(
      new Request('http://localhost/api/sessions/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      }),
      env,
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when session belongs to another user', async () => {
    const env = await seedEnv()

    const res = await app.fetch(
      new Request('http://localhost/api/sessions/sess-2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hacked' }),
      }),
      env,
    )

    expect(res.status).toBe(404)
  })
})
