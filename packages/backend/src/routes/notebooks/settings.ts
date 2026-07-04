// packages/backend/src/routes/notebooks/settings.ts
// Notebook settings: source reorder, MCP token management.

import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { encryptApiKey } from '../../crypto'
import { chatSessions, notebooks, sources } from '../../db/schema'
import { ErrorCode, errorResponse } from '../../errors'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const router = new Hono<AppEnv>()

// List sources for a notebook (ownership check via auth user)
router.get(
  '/:id/sources',
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
        id: sources.id,
        notebook_id: sources.notebookId,
        name: sources.name,
        type: sources.type,
        status: sources.status,
        r2_key: sources.r2Key,
        display_order: sources.displayOrder,
        created_at: sources.createdAt,
      })
      .from(sources)
      .where(eq(sources.notebookId, id))
      .orderBy(asc(sources.displayOrder), desc(sources.createdAt))

    const rowsWithSizes = await Promise.all(
      rows.map(async (row) => {
        let size: number | null = null
        if (row.r2_key) {
          try {
            const obj = await c.get('storage').head(row.r2_key)
            if (obj) {
              size = obj.size
            }
          } catch (e) {
            console.error('Failed to get R2 object size for', row.r2_key, e)
          }
        }
        return {
          ...row,
          size,
        }
      }),
    )

    return c.json(rowsWithSizes)
  },
)

// Reorder sources
router.post(
  '/:id/sources/reorder',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      sourceIds: z.array(z.string().min(1).max(100)).min(1).max(100),
    }),
    vHook,
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const { sourceIds } = c.req.valid('json')
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

    // Verify all source IDs belong to this notebook
    const matching = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(inArray(sources.id, sourceIds), eq(sources.notebookId, id)))

    const matchingSet = new Set(matching.map((r) => r.id))
    const invalidIds = sourceIds.filter((sid) => !matchingSet.has(sid))
    if (invalidIds.length > 0) {
      return errorResponse(
        c,
        ErrorCode.RequestInvalidSourceIds,
        `Invalid source IDs: ${invalidIds.join(', ')}`,
        400,
      )
    }

    // Update display_order in source order using batch
    await db.batch(
      sourceIds.map((sid, i) =>
        db
          .update(sources)
          .set({ displayOrder: i })
          .where(and(eq(sources.id, sid), eq(sources.notebookId, id))),
      ) as any,
    )

    return c.json({ ok: true })
  },
)

// List chat sessions for a notebook
router.get(
  '/:id/sessions',
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
        id: chatSessions.id,
        title: chatSessions.title,
        created_at: chatSessions.createdAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.notebookId, id))
      .orderBy(desc(chatSessions.createdAt))

    return c.json(rows)
  },
)

// Generate or regenerate an MCP Bearer token
router.post(
  '/:id/mcp-token',
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

    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    if (!masterKey) throw new Error('API_KEY_ENCRYPTION_MASTER is not configured')
    const encrypted = await encryptApiKey(masterKey, token)

    await db.update(notebooks).set({ mcpToken: encrypted }).where(eq(notebooks.id, id))

    return c.json({ token })
  },
)

// Check whether an MCP Bearer token has been generated for this notebook
router.get(
  '/:id/mcp-token',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({ user_id: notebooks.userId, mcpToken: notebooks.mcpToken })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    return c.json({ has_token: notebook.mcpToken !== null })
  },
)

// Delete the MCP token
router.delete(
  '/:id/mcp-token',
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

    await db.update(notebooks).set({ mcpToken: null }).where(eq(notebooks.id, id))
    return c.newResponse(null, 204)
  },
)

export default router
