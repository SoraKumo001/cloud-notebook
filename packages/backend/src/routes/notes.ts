import { zValidator } from '@hono/zod-validator'
import { desc, eq, sql } from 'drizzle-orm'
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core'
import { Hono } from 'hono'
import { z } from 'zod'
import { notebooks, notes } from '../db/schema'
import { ErrorCode, errorResponse } from '../errors'
import type { AppEnv } from '../types'
import { vHook } from './common'

const router = new Hono<AppEnv>()

// List notes in a notebook
router.get(
  '/notebooks/:id/notes',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        created_at: notes.createdAt,
        updated_at: notes.updatedAt,
      })
      .from(notes)
      .where(eq(notes.notebookId, id))
      .orderBy(desc(notes.updatedAt))

    return c.json(rows)
  },
)

// Create a note
router.post(
  '/notebooks/:id/notes',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({ title: z.string().min(1).max(200), content: z.string().optional().default('') }),
    vHook,
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const { title, content } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const noteId = crypto.randomUUID()
    await db.insert(notes).values({ id: noteId, notebookId: id, title: title.trim(), content })

    const [created] = await db.select().from(notes).where(eq(notes.id, noteId)).limit(1)
    return c.json(created, 201)
  },
)

// Get a single note
router.get(
  '/notes/:noteId',
  zValidator('param', z.object({ noteId: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { noteId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [note] = await db
      .select({
        id: notes.id,
        notebook_id: notes.notebookId,
        title: notes.title,
        content: notes.content,
        created_at: notes.createdAt,
        updated_at: notes.updatedAt,
      })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1)

    if (!note) return errorResponse(c, ErrorCode.NoteNotFound, 'Note not found', 404)

    const [nb] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, note.notebook_id))
      .limit(1)

    if (!nb || nb.user_id !== userId) {
      return errorResponse(c, ErrorCode.NoteNotFound, 'Note not found', 404)
    }

    return c.json(note)
  },
)

// Update a note
router.patch(
  '/notes/:noteId',
  zValidator('param', z.object({ noteId: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200).optional(),
      content: z.string().optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { noteId } = c.req.valid('param')
    const body = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [note] = await db
      .select({ notebook_id: notes.notebookId })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1)

    if (!note) return errorResponse(c, ErrorCode.NoteNotFound, 'Note not found', 404)

    const [nb] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, note.notebook_id))
      .limit(1)

    if (!nb || nb.user_id !== userId) {
      return errorResponse(c, ErrorCode.NoteNotFound, 'Note not found', 404)
    }

    const updates: SQLiteUpdateSetSource<typeof notes> = { updatedAt: sql`(current_timestamp)` }
    if (body.title !== undefined) updates.title = body.title.trim()
    if (body.content !== undefined) updates.content = body.content

    await db.update(notes).set(updates).where(eq(notes.id, noteId))

    const [updated] = await db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        created_at: notes.createdAt,
        updated_at: notes.updatedAt,
      })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1)

    return c.json(updated)
  },
)

// Delete a note
router.delete(
  '/notes/:noteId',
  zValidator('param', z.object({ noteId: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { noteId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [note] = await db
      .select({ notebook_id: notes.notebookId })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1)

    if (!note) return errorResponse(c, ErrorCode.NoteNotFound, 'Note not found', 404)

    const [nb] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, note.notebook_id))
      .limit(1)

    if (!nb || nb.user_id !== userId) {
      return errorResponse(c, ErrorCode.NoteNotFound, 'Note not found', 404)
    }

    await db.delete(notes).where(eq(notes.id, noteId))
    return c.newResponse(null, 204)
  },
)

export default router
