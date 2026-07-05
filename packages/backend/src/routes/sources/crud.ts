// packages/backend/src/routes/sources/crud.ts
// Source CRUD: delete, rename, get content, and update content.

import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { notebooks, sourceChunks, sourceImages, sources } from '../../db/schema'
import { getEffectiveAiConfig } from '../../db/settings'
import { embedChunks, getEmbeddingProvider } from '../../embeddings'
import { ErrorCode, errorResponse } from '../../errors'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const router = new Hono<AppEnv>()

const EDITABLE_TYPES = new Set(['text', 'markdown', 'webpage'])

const paramSchema = z.object({ id: z.string().min(1).max(100) })

const contentChunkSchema = z.object({
  content: z.string().max(10000),
  pageNumber: z.number().int().optional(),
})

// Shared ownership check: returns the source row or sends an error response.
async function getOwnedSource(
  c: Context<AppEnv>,
  sourceId: string,
): Promise<{ type: string; r2Key: string | null; notebookId: string; name: string } | Response> {
  const userId = c.get('user').id
  const db = c.get('db')

  const [source] = await db
    .select({
      notebook_id: sources.notebookId,
      type: sources.type,
      r2_key: sources.r2Key,
      name: sources.name,
    })
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

  return {
    type: source.type,
    r2Key: source.r2_key,
    notebookId: source.notebook_id,
    name: source.name,
  }
}

// POST /api/notebooks/:id/sources — create a new empty text/markdown source
router.post(
  '/notebooks/:id/sources',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      type: z.enum(['text', 'markdown']),
      name: z
        .string()
        .min(1)
        .max(255)
        .refine((s) => !s.includes('..') && !s.includes('/') && !s.includes('\\'), 'Invalid name')
        .optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { id: notebookId } = c.req.valid('param')
    const { type, name: rawName } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const sourceId = crypto.randomUUID()
    const name = rawName ?? (type === 'markdown' ? 'untitled.md' : 'untitled.txt')
    const r2Key = `notebooks/${notebookId}/sources/${sourceId}/${name}`
    const contentType = type === 'markdown' ? 'text/markdown' : 'text/plain'

    // Put empty content to R2
    const storage = c.get('storage')
    await storage.put(r2Key, new TextEncoder().encode('').buffer as ArrayBuffer, contentType)

    // Compute hash of empty string
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(''))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const newHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    // Insert into sources table
    await db.insert(sources).values({
      id: sourceId,
      notebookId,
      userId,
      name,
      type,
      r2Key,
      hash: newHash,
      status: 'completed',
    })

    // Select and return the created source
    const [created] = await db
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

    return c.json(created, 201)
  },
)

// GET /api/sources/:id/content — retrieve editable source content
router.get('/sources/:id/content', zValidator('param', paramSchema, vHook), async (c) => {
  const { id: sourceId } = c.req.valid('param')
  const db = c.get('db')

  const owned = await getOwnedSource(c, sourceId)
  if (owned instanceof Response) return owned

  if (!EDITABLE_TYPES.has(owned.type)) {
    return errorResponse(c, ErrorCode.ValidationFailed, 'This source type cannot be edited', 400)
  }

  let content: string

  if (owned.r2Key) {
    const storage = c.get('storage')
    const buffer = await storage.get(owned.r2Key)
    if (buffer) {
      content = new TextDecoder().decode(buffer)
    } else {
      // Fallback: concatenate chunks
      const rows = await db
        .select({ content: sourceChunks.content })
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceId, sourceId))
        .orderBy(sourceChunks.pageNumber, sourceChunks.id)

      content = rows.map((r) => r.content).join('\n\n')
    }
  } else {
    // No R2 key — fallback to chunks
    const rows = await db
      .select({ content: sourceChunks.content })
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceId, sourceId))
      .orderBy(sourceChunks.pageNumber, sourceChunks.id)

    content = rows.map((r) => r.content).join('\n\n')
  }

  return c.json({ content, type: owned.type, name: owned.name })
})

// PUT /api/sources/:id/content — update editable source content
router.put(
  '/sources/:id/content',
  zValidator('param', paramSchema, vHook),
  zValidator(
    'json',
    z.object({
      content: z.string().min(1).max(100000),
      chunks: z.array(contentChunkSchema).max(500).optional().default([]),
    }),
    vHook,
  ),
  async (c) => {
    const { id: sourceId } = c.req.valid('param')
    const { content, chunks } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const owned = await getOwnedSource(c, sourceId)
    if (owned instanceof Response) return owned

    if (!EDITABLE_TYPES.has(owned.type)) {
      return errorResponse(c, ErrorCode.ValidationFailed, 'This source type cannot be edited', 400)
    }

    if (!owned.r2Key) {
      return errorResponse(c, ErrorCode.SourceNotFound, 'Source storage key missing', 404)
    }

    const contentType = owned.type === 'markdown' ? 'text/markdown' : 'text/plain'

    // Update R2 storage
    const storage = c.get('storage')
    await storage.put(
      owned.r2Key,
      new TextEncoder().encode(content).buffer as ArrayBuffer,
      contentType,
    )

    // Compute new hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const newHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    // If no chunks provided, just update the file + hash and return
    if (!chunks || chunks.length === 0) {
      await db
        .update(sources)
        .set({ hash: newHash, status: 'completed' })
        .where(eq(sources.id, sourceId))
      return c.json({ id: sourceId, status: 'completed', chunks: 0, embedded: 0, hash: newHash })
    }

    // Delete existing chunks from D1
    const existingChunkRows = await db
      .select({ id: sourceChunks.id })
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceId, sourceId))

    const existingChunkIds = existingChunkRows.map((r) => r.id)

    // Delete existing vectors (before deleting D1 rows)
    if (existingChunkIds.length > 0) {
      await c.env.VECTORIZE.deleteByIds(existingChunkIds).catch((err: unknown) => {
        console.error(
          `[update] failed to delete ${existingChunkIds.length} vectors for source=${sourceId}:`,
          err instanceof Error ? err.message : err,
        )
      })
    }

    await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, sourceId))

    // Insert new chunks
    const chunkRecords = chunks.map((chunk) => ({
      id: crypto.randomUUID(),
      content: chunk.content,
      pageNumber: chunk.pageNumber ?? null,
    }))

    const chunkQueries: BatchItem<'sqlite'>[] = chunkRecords.map((rec) =>
      db.insert(sourceChunks).values({
        id: rec.id,
        sourceId,
        notebookId: owned.notebookId,
        content: rec.content,
        pageNumber: rec.pageNumber,
      }),
    )
    await db.batch(chunkQueries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

    // Embed chunks
    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    const effectiveConfig = await getEffectiveAiConfig(db, userId, masterKey, {
      aiEmbeddingModel: undefined,
    })

    const embedProvider = getEmbeddingProvider(c.env, {
      provider: effectiveConfig.embedding.provider,
      apiKey: effectiveConfig.embedding.apiKey,
      baseUrl: effectiveConfig.embedding.baseUrl,
      model: effectiveConfig.embedding.model,
    })

    const vectors = await embedChunks(
      embedProvider,
      chunkRecords.map((r) => ({ id: r.id, content: r.content })),
    )

    const vectorsWithMeta = vectors.map((v) => ({
      ...v,
      metadata: {
        ...v.metadata,
        source_id: sourceId,
        notebook_id: owned.notebookId,
      },
    }))

    const mutation = await c.env.VECTORIZE.upsert(vectorsWithMeta)

    // Update source row
    await db
      .update(sources)
      .set({ hash: newHash, status: 'completed' })
      .where(eq(sources.id, sourceId))

    return c.json({
      id: sourceId,
      status: 'completed',
      chunks: chunkRecords.length,
      embedded: mutation.count,
      hash: newHash,
    })
  },
)

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
