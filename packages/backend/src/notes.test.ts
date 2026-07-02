// packages/backend/src/notes.test.ts
// Tests for Notes CRUD endpoints.

import { describe, expect, it } from 'vitest'
import { notebooks, notes } from './db/schema'
import app from './index'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

const DEV_USER = 'dev-user'

async function seedEnv() {
  const testEnv = createTestEnv()
  await testEnv.db.insert(notebooks).values([
    {
      id: 'nb-1',
      userId: DEV_USER,
      title: 'Test',
      description: '',
    },
    {
      id: 'nb-2',
      userId: 'other-user',
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
  return testEnv.env
}

// ---------------------------------------------------------------------------
// GET /api/notebooks/:id/notes
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/notes', () => {
  it('lists notes for the notebook', async () => {
    const env = await seedEnv()
    const res = await app.fetch(new Request('http://localhost/api/notebooks/nb-1/notes'), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(1)
    expect((body[0] as Record<string, unknown>).title).toBe('Meeting Notes')
  })
  it('returns 404 for other user notebook', async () => {
    const env = await seedEnv()
    const res = await app.fetch(new Request('http://localhost/api/notebooks/nb-2/notes'), env)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /api/notebooks/:id/notes
// ---------------------------------------------------------------------------

describe('POST /api/notebooks/:id/notes', () => {
  it('creates a note', async () => {
    const env = await seedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/notebooks/nb-1/notes', {
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
    const env = await seedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/notebooks/nb-1/notes', {
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
    const env = await seedEnv()
    const res = await app.fetch(new Request('http://localhost/api/notes/note-1'), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Meeting Notes')
  })
  it('returns 404 when note belongs to other user', async () => {
    const env = await seedEnv()
    const res = await app.fetch(new Request('http://localhost/api/notes/note-2'), env)
    expect(res.status).toBe(404)
  })
  it('returns 404 when note does not exist', async () => {
    const env = await seedEnv()
    const res = await app.fetch(new Request('http://localhost/api/notes/nonexistent'), env)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/notes/:noteId
// ---------------------------------------------------------------------------

describe('PATCH /api/notes/:noteId', () => {
  it('updates a note title', async () => {
    const env = await seedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/notes/note-1', {
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
    const env = await seedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/notes/note-2', {
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
    const env = await seedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/notes/note-1', { method: 'DELETE' }),
      env,
    )
    expect(res.status).toBe(204)
  })
  it('returns 404 when note belongs to other user', async () => {
    const env = await seedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/notes/note-2', { method: 'DELETE' }),
      env,
    )
    expect(res.status).toBe(404)
  })
})
