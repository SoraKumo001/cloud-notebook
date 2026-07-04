// packages/backend/src/routes/notebooks/crud.ts
// Notebook CRUD: create, list, get, update, delete.

import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core'
import { Hono } from 'hono'
import { z } from 'zod'
import { encryptApiKey } from '../../crypto'
import { notebooks, sources } from '../../db/schema'
import { ErrorCode, errorResponse } from '../../errors'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const router = new Hono<AppEnv>()

// Create a new notebook
router.post(
  '/',
  zValidator(
    'json',
    z.object({ title: z.string().min(1).max(200), description: z.string().optional().default('') }),
    vHook,
  ),
  async (c) => {
    const { title, description } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const id = crypto.randomUUID()

    await db.insert(notebooks).values({ id, userId, title, description })

    return c.json({ id, title, description, userId })
  },
)

// List notebooks for the authenticated user with search / sort / pagination
router.get(
  '/',
  zValidator(
    'query',
    z.object({
      q: z.string().optional(),
      sort: z.enum(['created_at', 'updated_at', 'title']).optional().default('created_at'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    vHook,
  ),
  async (c) => {
    const userId = c.get('user').id
    const db = c.get('db')
    const { q, sort, order, limit, offset } = c.req.valid('query')

    // Whitelist sort columns (SQL injection defence)
    const sortMap = {
      updated_at: notebooks.updatedAt,
      created_at: notebooks.createdAt,
      title: notebooks.title,
    } as const
    const sortColumn = sortMap[sort] ?? notebooks.createdAt
    const orderBy = order === 'asc' ? asc(sortColumn) : desc(sortColumn)

    const conditions = [eq(notebooks.userId, userId)]
    if (q) {
      // biome-ignore lint/style/noNonNullAssertion: or() returns SQL when both args are SQL
      conditions.push(or(like(notebooks.title, `%${q}%`), like(notebooks.description, `%${q}%`))!)
    }

    const rows = await db
      .select({
        id: notebooks.id,
        userId: notebooks.userId,
        title: notebooks.title,
        description: notebooks.description,
        aiProvider: notebooks.aiProvider,
        aiEmbeddingModel: notebooks.aiEmbeddingModel,
        modelChat: notebooks.modelChat,
        modelSummarization: notebooks.modelSummarization,
        createdAt: notebooks.createdAt,
        updatedAt: notebooks.updatedAt,
      })
      .from(notebooks)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)

    // Fetch source counts for each notebook in one batch query
    const notebookIds = rows.map((r) => r.id)
    const sourceCounts: Record<string, number> = {}
    if (notebookIds.length > 0) {
      const countRows = await db
        .select({
          notebookId: sources.notebookId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(sources)
        .where(and(inArray(sources.notebookId, notebookIds), eq(sources.status, 'completed')))
        .groupBy(sources.notebookId)

      for (const row of countRows) {
        sourceCounts[row.notebookId] = Number(row.count)
      }
    }

    return c.json(rows.map((r) => ({ ...r, sourceCount: sourceCounts[r.id] ?? 0 })))
  },
)

// Get a single notebook by ID (ownership check via auth user)
router.get(
  '/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({
        id: notebooks.id,
        user_id: notebooks.userId,
        title: notebooks.title,
        description: notebooks.description,
        ai_provider: notebooks.aiProvider,
        ai_embedding_model: notebooks.aiEmbeddingModel,
        model_chat: notebooks.modelChat,
        model_summarization: notebooks.modelSummarization,
        model_ocr: notebooks.modelOcr,
        system_prompt: notebooks.systemPrompt,
        created_at: notebooks.createdAt,
        updated_at: notebooks.updatedAt,
      })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    return c.json(notebook)
  },
)

// Update notebook metadata
router.patch(
  '/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      ai_provider: z
        .enum(['workers-ai', 'openai', 'anthropic', 'google', 'custom'])
        .nullable()
        .optional(),
      ai_base_url: z.string().max(500).nullable().optional(),
      ai_embedding_model: z.string().max(100).nullable().optional(),
      model_chat: z.string().max(100).nullable().optional(),
      model_summarization: z.string().max(100).nullable().optional(),
      model_ocr: z.string().max(100).nullable().optional(),
      system_prompt: z.string().max(4000).nullable().optional(),
      ai_api_key: z.string().nullable().optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({ user_id: notebooks.userId, ai_api_key: notebooks.aiApiKey })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const updates: SQLiteUpdateSetSource<typeof notebooks> = { updatedAt: sql`(current_timestamp)` }
    if (body.title !== undefined) updates.title = body.title.trim()
    if (body.description !== undefined) updates.description = body.description

    if (body.ai_provider !== undefined) {
      if (body.ai_provider !== null) {
        const supportedForEmbedding = ['workers-ai']
        if (!supportedForEmbedding.includes(body.ai_provider)) {
          return errorResponse(
            c,
            ErrorCode.ValidationFailed,
            `ai_provider "${body.ai_provider}" is not supported for embedding. ` +
              `The Vectorize index is 1024-dim and only Workers AI (bge-m3) produces matching vectors. ` +
              `Use ai_provider=workers-ai for embedding, and configure model_chat / model_summarization separately if you need a different chat model.`,
            400,
          )
        }
      }
      updates.aiProvider = body.ai_provider
    }
    if (body.ai_base_url !== undefined) updates.aiBaseUrl = body.ai_base_url?.trim() || null
    if (body.ai_embedding_model !== undefined)
      updates.aiEmbeddingModel = body.ai_embedding_model ? body.ai_embedding_model.trim() : null
    if (body.model_chat !== undefined)
      updates.modelChat = body.model_chat ? body.model_chat.trim() : null
    if (body.model_summarization !== undefined)
      updates.modelSummarization = body.model_summarization ? body.model_summarization.trim() : null
    if (body.model_ocr !== undefined)
      updates.modelOcr = body.model_ocr ? body.model_ocr.trim() : null
    if (body.system_prompt !== undefined) updates.systemPrompt = body.system_prompt

    // Encrypt API key if provided
    if (body.ai_api_key !== undefined) {
      if (body.ai_api_key && body.ai_api_key.trim().length > 0) {
        const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
        if (!masterKey) throw new Error('API_KEY_ENCRYPTION_MASTER is not configured')
        updates.aiApiKey = await encryptApiKey(masterKey, body.ai_api_key.trim())
      } else {
        updates.aiApiKey = null
      }
    }

    await db.update(notebooks).set(updates).where(eq(notebooks.id, id))

    const [updated] = await db
      .select({
        id: notebooks.id,
        user_id: notebooks.userId,
        title: notebooks.title,
        description: notebooks.description,
        ai_provider: notebooks.aiProvider,
        ai_base_url: notebooks.aiBaseUrl,
        ai_embedding_model: notebooks.aiEmbeddingModel,
        model_chat: notebooks.modelChat,
        model_summarization: notebooks.modelSummarization,
        model_ocr: notebooks.modelOcr,
        system_prompt: notebooks.systemPrompt,
        created_at: notebooks.createdAt,
        updated_at: notebooks.updatedAt,
      })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    return c.json(updated)
  },
)

// Delete a notebook
router.delete(
  '/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const notebook = await db.query.notebooks.findFirst({
      where: { id },
      with: {
        sources: { with: { sourceChunks: true } },
        sourceImages: true,
      },
    })

    if (!notebook || notebook.userId !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const r2Keys: string[] = []
    for (const src of notebook.sources ?? []) if (src.r2Key) r2Keys.push(src.r2Key)
    for (const img of notebook.sourceImages ?? []) r2Keys.push(img.r2Key)

    if (r2Keys.length > 0) {
      await c.get('storage').delete(r2Keys)
    }

    const chunkIds = (notebook.sources ?? []).flatMap((s) =>
      (s.sourceChunks ?? []).map((c2) => c2.id),
    )
    if (chunkIds.length > 0) {
      await c.env.VECTORIZE.deleteByIds(chunkIds).catch((err: unknown) => {
        console.error(
          `[cleanup] failed to delete ${chunkIds.length} vectors for notebook=${id}:`,
          err instanceof Error ? err.message : err,
        )
      })
    }

    await db.delete(notebooks).where(eq(notebooks.id, id))

    return c.newResponse(null, 204)
  },
)

export default router
