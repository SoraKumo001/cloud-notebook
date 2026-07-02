// packages/backend/src/notes.test.ts
// Tests for Notes CRUD endpoints.

import { describe, expect, it } from 'vitest'
import { notebooks, notes } from './db/schema'
import app from './index'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedNotes(
  userId: string,
  otherUserId: string,
  testEnv: ReturnType<typeof createTestEnv>,
) {
  await testEnv.db.insert(notebooks).values([
    {
      id: 'nb-1',
      userId,
      title: 'Test',
      description: '',
    },
    {
      id: 'nb-2',
      userId: otherUserId,
      title: 'Other',
      description: '',
    },
  ])
  await testEnv.db.insert(notes).values([
    {
      id: 'note-1',
      notebookId: 'nb-1',
      title: 'Meeting Notes',
      content: 'Discuss Q3 roadmap',
    },
    {
      id: 'note-2',
      notebookId: 'nb-2',
      title: 'Other Note',
      content: 'Secret',
    },
  ])
}

// ---------------------------------------------------------------------------
// GET /api/notebooks/:id/notes
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/notes', () => {
  it('lists notes for the notebook', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-notes-list@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/notes', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(1)
    expect((body[0] as Record<string, unknown>).title).toBe('Meeting Notes')
  })

  it('returns 404 for other user notebook', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-notes-404@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-2/notes', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /api/notebooks/:id/notes
// ---------------------------------------------------------------------------

describe('POST /api/notebooks/:id/notes', () => {
  it('creates a note', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-post-notes-create@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/notes', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Note', content: 'Content here' }),
      }),
      env,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('New Note')
  })

  it('returns 400 when title is empty', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-post-notes-empty@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/notes', cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', content: 'x' }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /api/notes/:noteId
// ---------------------------------------------------------------------------

describe('GET /api/notes/:noteId', () => {
  it('returns the note', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-note-ok@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(authedRequest('http://localhost/api/notes/note-1', cookie), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Meeting Notes')
  })

  it('returns 404 when note belongs to other user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-note-other@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(authedRequest('http://localhost/api/notes/note-2', cookie), env)
    expect(res.status).toBe(404)
  })

  it('returns 404 when note does not exist', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-get-note-nonexist@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notes/nonexistent', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/notes/:noteId
// ---------------------------------------------------------------------------

describe('PATCH /api/notes/:noteId', () => {
  it('updates a note title', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-note-update@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notes/note-1', cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title' }),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Updated Title')
  })

  it('returns 404 when note belongs to other user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-patch-note-other@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notes/note-2', cookie, {
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
// DELETE /api/notes/:noteId
// ---------------------------------------------------------------------------

describe('DELETE /api/notes/:noteId', () => {
  it('deletes the note', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-delete-note-ok@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notes/note-1', cookie, {
        method: 'DELETE',
      }),
      env,
    )
    expect(res.status).toBe(204)
  })

  it('returns 404 when note belongs to other user', async () => {
    const { env, db, sqlite } = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(env)
    const { userId: otherUserId } = await createAuthedRequest(env, {
      email: 'other-delete-note-other@example.com',
      adminCookie: cookie,
    })
    await seedNotes(userId, otherUserId, { env, db, sqlite })

    const res = await app.fetch(
      authedRequest('http://localhost/api/notes/note-2', cookie, {
        method: 'DELETE',
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})
