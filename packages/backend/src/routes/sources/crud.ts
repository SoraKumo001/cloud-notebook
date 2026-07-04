// packages/backend/src/routes/sources/crud.ts
// Source CRUD: delete and rename.

import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { notebooks, sourceChunks, sourceImages, sources } from '../../db/schema'
import { ErrorCode, errorResponse } from '../../errors'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const router = new Hono<AppEnv>()

// Delete a source
router.delete(
  '/sources/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id: sourceId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [source] = await db
      .select({ notebook_id: sources.notebookId })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1)

    if (!source) return errorResponse(c, ErrorCode.SourceNotFound, 'Source not found', 404)

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, source.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.SourceNotFound, 'Source not found', 404)
    }

    const [srcRow] = await db
      .select({ r2_key: sources.r2Key })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1)

    const r2Keys: string[] = []
    if (srcRow?.r2_key) r2Keys.push(srcRow.r2_key)

    const imgRows = await db
      .select({ r2_key: sourceImages.r2Key })
      .from(sourceImages)
      .where(eq(sourceImages.sourceId, sourceId))

    for (const row of imgRows) r2Keys.push(row.r2_key)

    if (r2Keys.length > 0) {
      await c.get('storage').delete(r2Keys)
    }

    const chunkRows = await db
      .select({ id: sourceChunks.id })
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceId, sourceId))

    const chunkIds = chunkRows.map((r) => r.id)
    if (chunkIds.length > 0) {
      await c.env.VECTORIZE.deleteByIds(chunkIds).catch((err: unknown) => {
        console.error(
          `[cleanup] failed to delete ${chunkIds.length} vectors for source=${sourceId}:`,
          err instanceof Error ? err.message : err,
        )
      })
    }

    await db.delete(sources).where(eq(sources.id, sourceId))

    return c.newResponse(null, 204)
  },
)

// Rename a source
router.patch(
  '/sources/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(255),
    }),
    vHook,
  ),
  async (c) => {
    const { id: sourceId } = c.req.valid('param')
    const { name } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [source] = await db
      .select({ notebook_id: sources.notebookId })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1)

    if (!source) return errorResponse(c, ErrorCode.SourceNotFound, 'Source not found', 404)

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, source.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.SourceNotFound, 'Source not found', 404)
    }

    await db.update(sources).set({ name: name.trim() }).where(eq(sources.id, sourceId))

    const [updated] = await db
      .select({
        id: sources.id,
        notebook_id: sources.notebookId,
        name: sources.name,
        type: sources.type,
        status: sources.status,
        r2_key: sources.r2Key,
        created_at: sources.createdAt,
      })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1)

    return c.json(updated)
  },
)

export default router
