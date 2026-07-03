import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { encryptApiKey } from '../crypto'
import { chatSessions, notebooks, sourceChunks, sources } from '../db/schema'
import { getEffectiveAiConfig } from '../db/settings'
import { embedChunks, getEmbeddingProvider } from '../embeddings'
import { ErrorCode, errorResponse } from '../errors'
import { type Bindings, type Variables, vHook } from './common'

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

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

// Get Vectorize statistics (global count + per-notebook count)
router.get(
  '/:id/stats',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    // Ownership check
    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    // 1. Notebook vector count (count from sourceChunks table)
    const [chunkCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sourceChunks)
      .where(eq(sourceChunks.notebookId, id))

    const notebookVectorCount = chunkCountRow?.count ?? 0

    // 2. Global vector count from Vectorize
    let globalVectorCount = 0
    try {
      const details: any = await c.env.VECTORIZE.describe()
      const raw =
        typeof details?.vectorsCount === 'number'
          ? details.vectorsCount
          : typeof details?.vectorCount === 'number'
            ? details.vectorCount
            : 0
      globalVectorCount = raw
    } catch (err) {
      console.error('Failed to describe Vectorize index:', err)
    }

    return c.json({
      notebookVectorCount,
      globalVectorCount,
    })
  },
)

// Re-index all source chunks in a notebook with the current embedding model
router.post(
  '/:id/reindex',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id: notebookId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    // Ownership check
    const [notebook] = await db
      .select({ user_id: notebooks.userId, ai_embedding_model: notebooks.aiEmbeddingModel })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    // Resolve effective embedding config
    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    const effectiveConfig = await getEffectiveAiConfig(db, userId, masterKey, {
      aiEmbeddingModel: notebook.ai_embedding_model,
    })

    const embedProvider = getEmbeddingProvider(c.env as any, {
      provider: effectiveConfig.embedding.provider,
      apiKey: effectiveConfig.embedding.apiKey,
      baseUrl: effectiveConfig.embedding.baseUrl,
      model: effectiveConfig.embedding.model,
    })

    // Fetch all chunks for this notebook
    const allChunks = await db
      .select({
        id: sourceChunks.id,
        content: sourceChunks.content,
        sourceId: sourceChunks.sourceId,
      })
      .from(sourceChunks)
      .where(eq(sourceChunks.notebookId, notebookId))

    if (allChunks.length === 0) {
      return c.json({ reindexed: 0 })
    }

    // Re-embed and upsert to Vectorize
    const vectors = await embedChunks(
      embedProvider,
      allChunks.map((ch) => ({ id: ch.id, content: ch.content })),
    )

    const vectorsWithMeta = vectors.map((v, i) => ({
      ...v,
      metadata: {
        ...v.metadata,
        source_id: allChunks[i].sourceId,
        notebook_id: notebookId,
      },
    }))

    const mutation = await c.env.VECTORIZE.upsert(vectorsWithMeta)

    return c.json({ reindexed: mutation.count })
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

    const updates: Record<string, unknown> = { updatedAt: sql`(current_timestamp)` }
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
              `The Vectorize index is 1024-dim and only Workers AI (bge-large-en-v1.5) produces matching vectors. ` +
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

    await db
      .update(notebooks)
      .set(updates as any)
      .where(eq(notebooks.id, id))

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
