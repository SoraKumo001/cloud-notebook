import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, like, ne, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'

// Shared validation error hook — returns { error: string } to match frontend expectations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vHook = (result: any, c: any) => {
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Invalid request'
    return c.json({ error: `Validation failed: ${message}` }, 400)
  }
}

import { authMiddleware, requireAdmin } from './auth'
import { streamChat } from './chat'
import { encryptApiKey, getDecryptedApiKey } from './crypto'
import { createDb, type DB } from './db/client'
import {
  aiConnections,
  chatMessages,
  chatSessions,
  globalSettings,
  notebooks,
  notes,
  sourceChunks,
  sourceImages,
  sources,
  userSettings,
  users,
} from './db/schema'
import type { StorageConfigJson } from './db/schema/globalSettings'
import { getEffectiveAiConfig } from './db/settings'
import { embedChunks, getEmbeddingProvider } from './embeddings'
import {
  consumeInvitation,
  createInvitation,
  findValidInvitation,
  listInvitations,
  revokeInvitation,
} from './invitations'
import { mcpApp } from './mcp'
import { dbMiddleware } from './middleware/db'
import { storageMiddleware } from './middleware/storage'
import { hashPassword, verifyPassword } from './password'
import { fetchConnectionModels } from './providers'
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  deleteSession,
  parseSessionCookie,
  SESSION_COOKIE_NAME,
} from './session'
import { getObjectStorage } from './storage/factory'
import type { ObjectStorage } from './storage/interface'
import { storageSettingsInputSchema } from './storage/schema'

// ---------------------------------------------------------------------------

type Bindings = {
  DB: D1Database
  // R2 binding is now optional: deployments that use the
  // `s3-compatible` provider don't need it.
  BUCKET?: R2Bucket
  VECTORIZE: VectorizeIndex
  AI: Ai
  ASSETS: Fetcher
  NODE_ENV?: string
  CF_ENV?: string
  CF_DEV_BYPASS_AUTH?: string
  SESSION_SECRET?: string
  API_KEY_ENCRYPTION_MASTER?: string
  /** Test override — when set, the storage middleware uses this directly. */
  __storage?: ObjectStorage
}

type Variables = {
  user: { id: string; email: string; name?: string }
  db: DB
  storage: ObjectStorage
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Security headers — applied to all responses
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

// Auth middleware — validates Cloudflare Access JWT or returns dev user
app.use('/api/*', authMiddleware)

// DB middleware — creates drizzle instance from D1 binding
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('/api/*', dbMiddleware() as any)

// Storage middleware — resolves the active ObjectStorage adapter and
// attaches it as c.get('storage'). Must come after dbMiddleware.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('/api/*', storageMiddleware() as any)

app.onError((err, c) => {
  console.error('[SERVER ERROR]:', err)
  const isDev = c.env.NODE_ENV === 'development'
  return c.json(
    {
      error: isDev ? err.message || 'Internal Server Error' : 'Internal Server Error',
      ...(isDev ? { stack: err.stack } : {}),
    },
    500,
  )
})

app.get('/api/debug/health', async (c) => {
  const results: Record<string, { status: 'ok' | 'error'; message?: string }> = {}

  // 1. D1 Database Check
  try {
    const db = c.get('db')
    await db.select({ val: sql`1` })
    results.d1 = { status: 'ok' }
  } catch (err: any) {
    results.d1 = { status: 'error', message: err.message }
  }

  // 2. R2 Bucket Check
  try {
    const storage = c.get('storage')
    await storage.healthCheck()
    results.r2 = { status: 'ok' }
  } catch (err: any) {
    results.r2 = { status: 'error', message: err.message }
  }

  // 3. Vectorize Check
  try {
    await c.env.VECTORIZE.query(
      Array.from({ length: 1024 }, () => 0.1),
      {
        topK: 1,
      },
    )
    results.vectorize = { status: 'ok' }
  } catch (err: any) {
    results.vectorize = { status: 'error', message: err.message }
  }

  // 4. Workers AI Check
  try {
    const aiRes = (await c.env.AI.run('@cf/baai/bge-large-en-v1.5', { text: ['test'] })) as any
    if (aiRes?.data) {
      results.ai = { status: 'ok' }
    } else {
      results.ai = { status: 'error', message: 'No output data returned' }
    }
  } catch (err: any) {
    results.ai = { status: 'error', message: err.message }
  }

  const overallStatus = Object.values(results).every((r) => r.status === 'ok')
    ? 'healthy'
    : 'degraded'
  return c.json({ status: overallStatus, diagnostics: results })
})

// MCP server — mounted outside authMiddleware (has its own Bearer-token auth)
app.route('/mcp', mcpApp)

// Create a new notebook
app.post(
  '/api/notebooks',
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
app.get(
  '/api/notebooks',
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
app.get(
  '/api/notebooks/:id',
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
        created_at: notebooks.createdAt,
        updated_at: notebooks.updatedAt,
      })
      .from(notebooks)
      .where(eq(notebooks.id, id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Notebook not found' }, 404)
    }

    return c.json(notebook)
  },
)

// List sources for a notebook (ownership check via auth user)
app.get(
  '/api/notebooks/:id/sources',
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
      return c.json({ error: 'Notebook not found' }, 404)
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
app.get(
  '/api/notebooks/:id/stats',
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
      return c.json({ error: 'Notebook not found' }, 404)
    }

    // 1. Notebook vector count (count from sourceChunks table)
    const [chunkCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sourceChunks)
      .where(eq(sourceChunks.notebookId, id))

    const notebookVectorCount = chunkCountRow?.count ?? 0

    // 2. Global vector count from Vectorize
    // The runtime workers-types definition uses `vectorsCount` (legacy), but
    // the REST/control plane API uses `vectorCount`. Accept either to be safe.
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

// @deprecated Replaced by POST /api/uploads/presign + POST /api/sources/finalize
app.post('/api/sources/upload', (c) => {
  c.header('Deprecation', 'true')
  return c.json(
    {
      error:
        'This endpoint is deprecated. Use /api/uploads/presign + /api/sources/finalize instead.',
    },
    410,
  )
})

// Local development R2 upload proxy (mounted outside /api/* to bypass authMiddleware)
// CORS headers are required because the Vite dev server (:5173) and the
// wrangler dev server (:8787) are different origins; the browser sends a
// preflight OPTIONS for the PUT request.
const LOCAL_UPLOADS_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
} as const

app.options('/local-uploads', (c) => {
  for (const [k, v] of Object.entries(LOCAL_UPLOADS_CORS_HEADERS)) {
    c.header(k, v)
  }
  return c.newResponse(null, 204)
})

app.put('/local-uploads', async (c) => {
  if (c.env.NODE_ENV !== 'development') {
    return c.text('Forbidden in production', 403)
  }

  const key = c.req.query('key')
  if (!key) return c.json({ error: 'key query parameter is required' }, 400)

  const contentType = c.req.header('content-type')
  const body = await c.req.arrayBuffer()

  // /local-uploads is mounted outside /api/* so it does not get the
  // storageMiddleware. Resolve the adapter directly from the factory.
  const db = createDb(c.env.DB)
  const storage = await getObjectStorage(c.env, db)
  await storage.put(key, body, contentType ?? undefined)

  for (const [k, v] of Object.entries(LOCAL_UPLOADS_CORS_HEADERS)) {
    c.header(k, v)
  }
  return c.text('OK')
})

// Generate a presigned PUT URL for direct R2 upload (bypasses Worker)
app.post(
  '/api/uploads/presign',
  zValidator(
    'json',
    z.object({
      notebookId: z.string().min(1).max(100),
      sourceId: z.string().min(1).max(100),
      fileName: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (s) => !s.includes('..') && !s.includes('/') && !s.includes('\\'),
          'Invalid fileName',
        ),
      contentType: z.string().min(1).max(100),
      fileHash: z.string().optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { notebookId, sourceId, fileName, contentType, fileHash } = c.req.valid('json')

    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Notebook not found' }, 404)
    }

    if (fileHash) {
      const [existingSource] = await db
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            eq(sources.notebookId, notebookId),
            eq(sources.hash, fileHash),
            ne(sources.status, 'failed'),
          ),
        )
        .limit(1)

      if (existingSource) {
        return c.json(
          { error: 'A source with the same content already exists in this notebook' },
          409,
        )
      }
    }

    const r2Key = `notebooks/${notebookId}/sources/${sourceId}/${fileName}`

    const storage = c.get('storage')

    let url = ''
    let expiresAt = ''

    if (storage.supportsDirectPresign()) {
      // AWS S3 / MinIO / B2 / R2 binding: the browser can PUT directly.
      const presigned = await storage.presign(r2Key, contentType, 600)
      url = presigned.url
      expiresAt = presigned.expiresAt
    } else {
      // R2 via S3: the S3 endpoint's CORS preflight fails for signed PUTs
      // (see uploads.ts:18-23). Force the browser through the Worker proxy.
      const host = c.req.header('host') || 'localhost:8787'
      const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https'
      url = `${protocol}://${host}/api/uploads/direct?key=${encodeURIComponent(r2Key)}&contentType=${encodeURIComponent(contentType)}`
      expiresAt = new Date(Date.now() + 600 * 1000).toISOString()
    }

    return c.json({ url, r2Key, expiresAt })
  },
)

// Production upload path: the browser POSTs the raw file bytes to the Worker
// and the Worker writes them to R2 via `env.BUCKET.put()`. This avoids the
// `*.r2.cloudflarestorage.com` CORS preflight problem (where OPTIONS is
// treated as a regular S3 request and 403s because the signature verb is PUT).
//
// Request:  POST /api/uploads/direct?key=<r2Key>&contentType=<mime>
// Headers:  Content-Type: <mime>  (the same value passed in `contentType` query)
// Body:     raw file bytes
// Returns:  { r2Key, etag, size }
app.post(
  '/api/uploads/direct',
  zValidator(
    'query',
    z.object({
      key: z
        .string()
        .min(1)
        .max(500)
        .regex(/^notebooks\/[^/]+\/sources\/[^/]+\/[^/]+$/, 'Invalid key'),
      contentType: z.string().min(1).max(100),
    }),
    vHook,
  ),
  async (c) => {
    const { key, contentType } = c.req.valid('query')
    const userId = c.get('user').id
    const db = c.get('db')

    // The key is `notebooks/{notebookId}/sources/{sourceId}/{fileName}` —
    // parse the notebookId out and verify ownership before writing anything.
    const parts = key.split('/')
    // parts: ["notebooks", notebookId, "sources", sourceId, fileName]
    const notebookId = parts[1]
    if (!notebookId) {
      return c.json({ error: 'Invalid key' }, 400)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Notebook not found' }, 404)
    }

    const body = await c.req.arrayBuffer()
    if (body.byteLength === 0) {
      return c.json({ error: 'Empty body' }, 400)
    }
    // 100 MB hard cap; matches R2's single-shot PUT limit and protects the
    // Worker from memory pressure.
    const MAX_BYTES = 100 * 1024 * 1024
    if (body.byteLength > MAX_BYTES) {
      return c.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, 413)
    }

    // Prefer the request's Content-Type when the body carries a real file
    // (the browser sends it on `fetch(url, { body: file })`); fall back to
    // the query value otherwise.
    const headerType = c.req.header('content-type')?.split(';')[0]?.trim()
    const effectiveType = headerType || contentType

    const result = await c.get('storage').put(key, body, effectiveType)
    return c.json({ r2Key: key, etag: result.etag, size: result.size })
  },
)

// Finalize a source upload: register metadata in D1, then embed & upsert to Vectorize.
app.post(
  '/api/sources/finalize',
  zValidator(
    'json',
    z.object({
      notebookId: z.string().min(1).max(100),
      sourceId: z.string().min(1).max(100),
      fileName: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (s) => !s.includes('..') && !s.includes('/') && !s.includes('\\'),
          'Invalid fileName',
        ),
      type: z.string().min(1).max(50),
      hash: z.string().min(1).max(100),
      chunks: z
        .array(
          z.object({ content: z.string().max(10000), pageNumber: z.number().int().optional() }),
        )
        .max(500)
        .optional()
        .default([]),
      images: z
        .array(
          z.object({ r2Key: z.string().min(1).max(500), pageNumber: z.number().int().optional() }),
        )
        .max(100)
        .optional()
        .default([]),
    }),
    vHook,
  ),
  async (c) => {
    const { notebookId, sourceId, fileName, type, hash, chunks, images } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebook] = await db
      .select({
        user_id: notebooks.userId,
        ai_embedding_model: notebooks.aiEmbeddingModel,
      })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Notebook not found' }, 404)
    }

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

    const r2Key = `notebooks/${notebookId}/sources/${sourceId}/${fileName}`

    await db.insert(sources).values({
      id: sourceId,
      notebookId,
      userId,
      name: fileName,
      type,
      r2Key,
      hash,
      status: 'processing',
    })

    try {
      let embeddedCount = 0
      if (chunks.length > 0) {
        const chunkRecords = chunks.map((chunk) => ({
          id: crypto.randomUUID(),
          content: chunk.content,
          pageNumber: chunk.pageNumber ?? null,
        }))

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.batch(
          chunkRecords.map((rec) =>
            db.insert(sourceChunks).values({
              id: rec.id,
              sourceId,
              notebookId,
              content: rec.content,
              pageNumber: rec.pageNumber,
            }),
          ) as any,
        )

        const vectors = await embedChunks(
          embedProvider,
          chunkRecords.map((r) => ({ id: r.id, content: r.content })),
        )

        const vectorsWithMeta = vectors.map((v) => ({
          ...v,
          metadata: {
            ...v.metadata,
            source_id: sourceId,
            notebook_id: notebookId,
          },
        }))

        const mutation = await c.env.VECTORIZE.upsert(vectorsWithMeta)
        embeddedCount = mutation.count
      }

      if (images.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.batch(
          images.map((img) =>
            db.insert(sourceImages).values({
              id: crypto.randomUUID(),
              sourceId,
              notebookId,
              r2Key: img.r2Key,
              pageNumber: img.pageNumber ?? null,
            }),
          ) as any,
        )
      }

      await db.update(sources).set({ status: 'completed' }).where(eq(sources.id, sourceId))

      return c.json({
        id: sourceId,
        status: 'completed',
        chunks: chunks.length,
        images: images.length,
        embedded: embeddedCount,
      })
    } catch (err) {
      await db.update(sources).set({ status: 'failed' }).where(eq(sources.id, sourceId))

      const message = err instanceof Error ? err.message : String(err)
      return c.json(
        {
          id: sourceId,
          status: 'failed',
          chunks: chunks.length,
          images: images.length,
          embedded: 0,
          error: message,
        },
        500,
      )
    }
  },
)

// Embed chunks for a notebook source and upsert vectors into Vectorize.
app.post(
  '/api/embed',
  zValidator(
    'json',
    z.object({
      notebookId: z.string().min(1).max(100),
      sourceId: z.string().min(1).max(100),
      chunks: z
        .array(z.object({ id: z.string().min(1).max(100), content: z.string().max(10000) }))
        .min(1)
        .max(500),
    }),
    vHook,
  ),
  async (c) => {
    const { notebookId, sourceId, chunks } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [notebookRaw] = await db
      .select({
        id: notebooks.id,
        user_id: notebooks.userId,
        ai_provider: notebooks.aiProvider,
        ai_api_key: notebooks.aiApiKey,
        ai_base_url: notebooks.aiBaseUrl,
        ai_embedding_model: notebooks.aiEmbeddingModel,
      })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebookRaw || notebookRaw.user_id !== userId) {
      return c.json({ error: 'Notebook not found' }, 404)
    }

    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    const effectiveConfig = await getEffectiveAiConfig(db, userId, masterKey, {
      aiEmbeddingModel: notebookRaw.ai_embedding_model,
    })

    const provider = getEmbeddingProvider(c.env as any, {
      provider: effectiveConfig.embedding.provider,
      apiKey: effectiveConfig.embedding.apiKey,
      baseUrl: effectiveConfig.embedding.baseUrl,
      model: effectiveConfig.embedding.model,
    })

    const texts = chunks.map((c) => c.content)
    const embeddings = await provider.embed(texts)

    const vectors = chunks.map((chunk, i) => ({
      id: chunk.id,
      values: embeddings[i],
      metadata: {
        source_chunk_id: chunk.id,
        source_id: sourceId,
        notebook_id: notebookId,
      },
    }))

    const mutation = await c.env.VECTORIZE.upsert(vectors)

    return c.json({
      embedded: mutation.count,
      vectors: vectors.map((v) => ({ id: v.id })),
    })
  },
)

// Chat: SSE streaming RAG endpoint
app.post(
  '/api/chat',
  zValidator(
    'json',
    z.object({
      notebookId: z.string().min(1).max(100),
      query: z.string().min(1).max(10000),
      sessionId: z.string().min(1).max(100).optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { notebookId, query, sessionId } = c.req.valid('json')
    const userId = c.get('user').id

    return streamChat(c.env, notebookId, userId, query, sessionId)
  },
)

// List AI Connections
app.get('/api/connections', async (c) => {
  const userId = c.get('user').id
  const db = c.get('db')

  const list = await db
    .select({
      id: aiConnections.id,
      name: aiConnections.name,
      provider: aiConnections.provider,
      has_api_key: sql<boolean>`${aiConnections.apiKey} IS NOT NULL`,
      base_url: aiConnections.baseUrl,
      created_at: aiConnections.createdAt,
    })
    .from(aiConnections)
    .where(eq(aiConnections.userId, userId))
    .orderBy(desc(aiConnections.createdAt))

  return c.json(list)
})

// Create AI Connection
app.post(
  '/api/connections',
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100),
      provider: z.enum(['workers-ai', 'openai', 'anthropic', 'google', 'custom']),
      api_key: z.string().max(2000).optional().nullable(),
      base_url: z.string().max(2000).optional().nullable(),
    }),
    vHook,
  ),
  async (c) => {
    const userId = c.get('user').id
    const db = c.get('db')
    const body = c.req.valid('json')

    let encryptedKey: string | null = null
    if (body.api_key && body.api_key.trim() !== '') {
      const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
      if (!masterKey) throw new Error('API_KEY_ENCRYPTION_MASTER is not configured')
      encryptedKey = await encryptApiKey(masterKey, body.api_key.trim())
    }

    const id = crypto.randomUUID()
    await db.insert(aiConnections).values({
      id,
      userId,
      name: body.name.trim(),
      provider: body.provider,
      apiKey: encryptedKey,
      baseUrl: body.base_url?.trim() || null,
    })

    return c.json({
      id,
      name: body.name.trim(),
      provider: body.provider,
      has_api_key: !!encryptedKey,
      base_url: body.base_url?.trim() || null,
    })
  },
)

// Delete AI Connection
app.delete(
  '/api/connections/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const userId = c.get('user').id
    const { id } = c.req.valid('param')
    const db = c.get('db')

    const [existing] = await db
      .select({ user_id: aiConnections.userId })
      .from(aiConnections)
      .where(eq(aiConnections.id, id))
      .limit(1)

    if (!existing || existing.user_id !== userId) {
      return c.json({ error: 'Connection not found' }, 404)
    }

    await db.delete(aiConnections).where(eq(aiConnections.id, id))
    return c.newResponse(null, 204)
  },
)

// Fetch models for a Connection
app.get(
  '/api/connections/:id/models',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'query',
    z.object({ type: z.enum(['chat', 'embedding']).optional().default('chat') }),
    vHook,
  ),
  async (c) => {
    const userId = c.get('user').id
    const { id } = c.req.valid('param')
    const { type } = c.req.valid('query')
    const db = c.get('db')

    if (id === 'workers-ai') {
      const models = await fetchConnectionModels('workers-ai', null, null, type)
      return c.json({ models })
    }

    const [conn] = await db.select().from(aiConnections).where(eq(aiConnections.id, id)).limit(1)

    if (!conn || conn.userId !== userId) {
      return c.json({ error: 'Connection not found' }, 404)
    }

    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    const apiKey = await getDecryptedApiKey(masterKey, conn.apiKey)

    try {
      const models = await fetchConnectionModels(conn.provider, apiKey, conn.baseUrl, type)
      return c.json({ models })
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch models' }, 500)
    }
  },
)

// Get global user settings
app.get('/api/settings', async (c) => {
  const userId = c.get('user').id
  const db = c.get('db')

  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)

  if (!settings) {
    // Return default settings if none exist
    return c.json({
      ai_embedding_model: '@cf/baai/bge-large-en-v1.5',
      model_chat: '@cf/meta/llama-3.1-8b-instruct-fast',
      model_summarization: '@cf/meta/llama-3.1-8b-instruct-fast',
    })
  }

  return c.json({
    ai_embedding_model: settings.aiEmbeddingModel,
    model_chat: settings.modelChat,
    model_summarization: settings.modelSummarization,
  })
})

// Update global user settings
app.put(
  '/api/settings',
  zValidator(
    'json',
    z.object({
      ai_embedding_model: z.string().min(1).max(200),
      model_chat: z.string().min(1).max(200),
      model_summarization: z.string().min(1).max(200),
    }),
    vHook,
  ),
  async (c) => {
    const userId = c.get('user').id
    const db = c.get('db')
    const body = c.req.valid('json')

    const updates: Record<string, any> = {
      aiEmbeddingModel: body.ai_embedding_model,
      modelChat: body.model_chat,
      modelSummarization: body.model_summarization,
      updatedAt: sql`(current_timestamp)`,
    }

    // Upsert user settings
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1)

    if (existing) {
      await db.update(userSettings).set(updates).where(eq(userSettings.userId, userId))
    } else {
      await db.insert(userSettings).values({
        userId,
        aiEmbeddingModel: updates.aiEmbeddingModel,
        modelChat: updates.modelChat,
        modelSummarization: updates.modelSummarization,
      })
    }

    return c.json({ success: true })
  },
)

// Re-index all source chunks in a notebook with the current embedding model
app.post(
  '/api/notebooks/:id/reindex',
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
      return c.json({ error: 'Notebook not found' }, 404)
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
app.get(
  '/api/notebooks/:id/sessions',
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
      return c.json({ error: 'Notebook not found' }, 404)
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

// Get messages for a chat session
app.get(
  '/api/sessions/:sessionId/messages',
  zValidator('param', z.object({ sessionId: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { sessionId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [session] = await db
      .select({ notebook_id: chatSessions.notebookId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    if (!session) {
      return c.json({ error: 'Session not found' }, 404)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, session.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Session not found' }, 404)
    }

    const rows = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        created_at: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt))

    return c.json(rows)
  },
)

// Return the authenticated user's profile
app.get('/api/me', (c) => {
  const user = c.get('user')
  return c.json(user)
})

// ---- Email + password auth --------------------------------------------------

function isProdRequest(c: Context): boolean {
  // Treat anything that is NOT a dev bypass as production.
  const env = c.env as Bindings
  const bypass =
    env.CF_DEV_BYPASS_AUTH === '1' ||
    env.CF_DEV_BYPASS_AUTH === 'true' ||
    env.NODE_ENV === 'development' ||
    env.CF_ENV === 'development'
  return !bypass
}

function cookieSecure(c: Context): boolean {
  const url = new URL(c.req.url)
  return url.protocol === 'https:'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.post(
  '/api/auth/register',
  zValidator(
    'json',
    z.object({
      email: z
        .string()
        .min(3)
        .max(200)
        .refine((s) => EMAIL_RE.test(s), 'Invalid email'),
      password: z.string().min(8).max(200),
      name: z.string().min(1).max(100).optional(),
      // Required when at least one user already exists. The first user
      // becomes an admin automatically and skips the invite check.
      inviteToken: z.string().min(8).max(200).optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { email, password, name, inviteToken } = c.req.valid('json')
    const db = c.get('db')
    const normalizedEmail = email.toLowerCase().trim()

    // Reject duplicate emails first so we don't leak the "no users yet"
    // condition via timing or response shape.
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
    if (existing) {
      return c.json({ error: 'Email already registered' }, 409)
    }

    // Count existing users to decide if this is the bootstrap admin.
    const [{ count }] = (await db
      .select({ count: sql<number>`count(*)` })
      .from(users)) as unknown as Array<{ count: number }>
    const isFirstUser = Number(count) === 0

    if (!isFirstUser) {
      if (!inviteToken) {
        return c.json({ error: 'Invite token required. Ask an admin to invite you.' }, 403)
      }
      const invitation = await findValidInvitation(db, inviteToken, normalizedEmail)
      if (!invitation) {
        return c.json({ error: 'Invalid or expired invite token' }, 403)
      }

      const passwordHash = await hashPassword(password)
      const userId = crypto.randomUUID()
      await db.insert(users).values({
        id: userId,
        email: normalizedEmail,
        passwordHash,
        name: name?.trim() || null,
        isAdmin: false,
      })
      await consumeInvitation(db, invitation.id, userId)

      let cookie: string | null = null
      if (isProdRequest(c)) {
        const secret = c.env.SESSION_SECRET
        if (!secret) {
          return c.json({ error: 'SESSION_SECRET not configured' }, 500)
        }
        const { id: sessionId } = await createSession(db, userId)
        cookie = await buildSessionCookie(sessionId, secret, cookieSecure(c))
      }
      const headers: Record<string, string> = {}
      if (cookie) headers['Set-Cookie'] = cookie
      return c.json(
        { id: userId, email: normalizedEmail, name: name?.trim() || null, isAdmin: false },
        201,
        headers,
      )
    }

    // First user: bootstrap admin, no invite required.
    const passwordHash = await hashPassword(password)
    const userId = crypto.randomUUID()
    await db.insert(users).values({
      id: userId,
      email: normalizedEmail,
      passwordHash,
      name: name?.trim() || null,
      isAdmin: true,
    })

    let cookie: string | null = null
    if (isProdRequest(c)) {
      const secret = c.env.SESSION_SECRET
      if (!secret) {
        return c.json({ error: 'SESSION_SECRET not configured' }, 500)
      }
      const { id: sessionId } = await createSession(db, userId)
      cookie = await buildSessionCookie(sessionId, secret, cookieSecure(c))
    }
    const headers: Record<string, string> = {}
    if (cookie) headers['Set-Cookie'] = cookie
    return c.json(
      { id: userId, email: normalizedEmail, name: name?.trim() || null, isAdmin: true },
      201,
      headers,
    )
  },
)

app.post(
  '/api/auth/login',
  zValidator(
    'json',
    z.object({
      email: z.string().min(3).max(200),
      password: z.string().min(1).max(200),
    }),
    vHook,
  ),
  async (c) => {
    const { email, password } = c.req.valid('json')
    const db = c.get('db')
    const normalizedEmail = email.toLowerCase().trim()

    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)
    if (!user) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    let cookie: string | null = null
    if (isProdRequest(c)) {
      const secret = c.env.SESSION_SECRET
      if (!secret) {
        return c.json({ error: 'SESSION_SECRET not configured' }, 500)
      }
      const { id: sessionId } = await createSession(db, user.id)
      cookie = await buildSessionCookie(sessionId, secret, cookieSecure(c))
    }

    const headers: Record<string, string> = {}
    if (cookie) headers['Set-Cookie'] = cookie
    return c.json(
      { id: user.id, email: user.email, name: user.name ?? null, isAdmin: user.isAdmin },
      200,
      headers,
    )
  },
)

// Sign Out — exempt from authMiddleware so the user can log out even if
// their session is otherwise invalid.
app.post('/api/auth/logout', async (c) => {
  const db = c.get('db')
  const rawCookie = c.req.header('Cookie')
  if (rawCookie) {
    const match = rawCookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`))
    if (match) {
      const parsed = parseSessionCookie(match.slice(SESSION_COOKIE_NAME.length + 1))
      if (parsed) {
        await deleteSession(db, parsed.sessionId).catch(() => {
          // Best-effort: a stale cookie is still cleared client-side.
        })
      }
    }
  }
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(cookieSecure(c)) },
  })
})

// ---- Global Storage Settings (admin only) ---------------------------------

app.get('/api/admin/storage', requireAdmin, async (c) => {
  const db = c.get('db')
  const [row] = await db
    .select()
    .from(globalSettings)
    .where(eq(globalSettings.id, 'default'))
    .limit(1)

  if (!row) {
    return c.json({
      provider: 'r2-binding',
      configured: false,
      updated_by: null,
      updated_at: null,
    })
  }

  // Never return decrypted secrets. For s3-compatible, only surface
  // boolean "has_*" flags for the credentials.
  const cfg = row.storageConfig
  return c.json({
    provider: row.storageProvider,
    configured: true,
    ...(row.storageProvider === 's3-compatible' && cfg
      ? {
          bucket: cfg.bucket,
          region: cfg.region,
          endpoint: cfg.endpoint,
          force_path_style: cfg.forcePathStyle,
          has_access_key: !!cfg.accessKeyId,
          has_secret_key: !!cfg.secretAccessKey,
        }
      : {}),
    updated_by: row.updatedBy,
    updated_at: row.updatedAt,
  })
})

app.put(
  '/api/admin/storage',
  requireAdmin,
  zValidator('json', storageSettingsInputSchema, vHook),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const user = c.get('user')

    let storageConfig: StorageConfigJson | null = null
    const warnings: string[] = []

    if (body.provider === 's3-compatible') {
      const masterKey = c.env.API_KEY_ENCRYPTION_MASTER
      if (!masterKey) {
        return c.json({ error: 'API_KEY_ENCRYPTION_MASTER is not configured' }, 500)
      }

      const [accessKeyIdCipher, secretAccessKeyCipher] = await Promise.all([
        encryptApiKey(masterKey, body.access_key_id),
        encryptApiKey(masterKey, body.secret_access_key),
      ])

      storageConfig = {
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint,
        forcePathStyle: body.force_path_style,
        accessKeyId: accessKeyIdCipher,
        secretAccessKey: secretAccessKeyCipher,
      }
    }
    // For r2-binding, storageConfig stays null.

    // Validate r2-binding at save time so misconfiguration is
    // caught immediately, not on the first upload.
    if (body.provider === 'r2-binding' && !c.env.BUCKET) {
      return c.json(
        {
          error:
            "Cannot save provider 'r2-binding': this Worker has no R2_BUCKET binding configured. Choose 's3-compatible' instead.",
        },
        400,
      )
    }

    // For s3-compatible, validate the credentials with a real
    // put+delete probe. We do this AFTER the in-memory check but
    // BEFORE the upsert, so we never persist unvalidated config.
    if (body.provider === 's3-compatible' && storageConfig) {
      // We need the secret in plaintext to actually attempt a write.
      // Construct a transient S3CompatibleAdapter (not the cached one).
      try {
        const { S3CompatibleAdapter } = await import('./storage/s3-compatible-adapter')
        const probeAdapter = new S3CompatibleAdapter({
          bucket: body.bucket,
          region: body.region,
          endpoint: body.endpoint,
          accessKeyId: body.access_key_id,
          secretAccessKey: body.secret_access_key,
          forcePathStyle: body.force_path_style,
        })
        await probeAdapter.healthCheck()
      } catch (err) {
        warnings.push(
          `Storage health check failed: ${err instanceof Error ? err.message : String(err)}. Settings NOT saved — please verify credentials.`,
        )
        return c.json({ error: warnings[0] }, 400)
      }
    }

    // Upsert
    await db
      .insert(globalSettings)
      .values({
        id: 'default',
        storageProvider: body.provider,
        storageConfig,
        updatedBy: user.email,
      })
      .onConflictDoUpdate({
        target: globalSettings.id,
        set: {
          storageProvider: body.provider,
          storageConfig,
          updatedBy: user.email,
        },
      })

    return c.json({ success: true })
  },
)

// ---- Invitations (admin only) ---------------------------------------------

app.get('/api/auth/invitations', requireAdmin, async (c) => {
  const db = c.get('db')
  const rows = await listInvitations(db)
  // active = !usedAt && not expired
  const now = Date.now()
  return c.json(
    rows.map((r) => ({
      ...r,
      active: !r.usedAt && new Date(r.expiresAt).getTime() > now,
    })),
  )
})

app.post(
  '/api/auth/invitations',
  requireAdmin,
  zValidator(
    'json',
    z.object({
      email: z
        .string()
        .min(3)
        .max(200)
        .refine((s) => EMAIL_RE.test(s), 'Invalid email'),
    }),
    vHook,
  ),
  async (c) => {
    const { email } = c.req.valid('json')
    const db = c.get('db')
    const user = c.get('user')

    // If the email is already registered, refuse to issue a token.
    const normalizedEmail = email.toLowerCase().trim()
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
    if (existing) {
      return c.json({ error: 'Email is already registered' }, 409)
    }

    const invitation = await createInvitation(db, user.id, normalizedEmail)
    return c.json(invitation, 201)
  },
)

app.delete('/api/auth/invitations/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  if (!id) {
    return c.json({ error: 'Invitation id required' }, 400)
  }
  const db = c.get('db')
  const removed = await revokeInvitation(db, id)
  if (!removed) {
    return c.json({ error: 'Invitation not found or already used' }, 404)
  }
  return new Response(null, { status: 204 })
})

// ---- MCP token management ----------------------------------------------------

// Generate or regenerate an MCP Bearer token
app.post(
  '/api/notebooks/:id/mcp-token',
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
      return c.json({ error: 'Notebook not found' }, 404)
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
app.get(
  '/api/notebooks/:id/mcp-token',
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
      return c.json({ error: 'Notebook not found' }, 404)
    }

    return c.json({ has_token: notebook.mcpToken !== null })
  },
)

// Delete the MCP token
app.delete(
  '/api/notebooks/:id/mcp-token',
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
      return c.json({ error: 'Notebook not found' }, 404)
    }

    await db.update(notebooks).set({ mcpToken: null }).where(eq(notebooks.id, id))
    return c.newResponse(null, 204)
  },
)

// ---- Session CRUD -------------------------------------------------------------

// Delete a chat session
app.delete(
  '/api/sessions/:sessionId',
  zValidator('param', z.object({ sessionId: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { sessionId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [session] = await db
      .select({ notebook_id: chatSessions.notebookId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    if (!session) {
      return c.json({ error: 'Session not found' }, 404)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, session.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Session not found' }, 404)
    }

    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId))
    return c.newResponse(null, 204)
  },
)

// Rename a chat session
app.patch(
  '/api/sessions/:sessionId',
  zValidator('param', z.object({ sessionId: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
    }),
    vHook,
  ),
  async (c) => {
    const { sessionId } = c.req.valid('param')
    const { title } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [session] = await db
      .select({ notebook_id: chatSessions.notebookId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    if (!session) {
      return c.json({ error: 'Session not found' }, 404)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, session.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Session not found' }, 404)
    }

    await db.update(chatSessions).set({ title: title.trim() }).where(eq(chatSessions.id, sessionId))

    const [updated] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    return c.json(updated)
  },
)

// ---- Notes CRUD ---------------------------------------------------------------

// List notes in a notebook
app.get(
  '/api/notebooks/:id/notes',
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
      return c.json({ error: 'Notebook not found' }, 404)
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
app.post(
  '/api/notebooks/:id/notes',
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
      return c.json({ error: 'Notebook not found' }, 404)
    }

    const noteId = crypto.randomUUID()
    await db.insert(notes).values({ id: noteId, notebookId: id, title: title.trim(), content })

    const [created] = await db.select().from(notes).where(eq(notes.id, noteId)).limit(1)
    return c.json(created, 201)
  },
)

// Get a single note
app.get(
  '/api/notes/:noteId',
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

    if (!note) return c.json({ error: 'Note not found' }, 404)

    const [nb] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, note.notebook_id))
      .limit(1)

    if (!nb || nb.user_id !== userId) {
      return c.json({ error: 'Note not found' }, 404)
    }

    return c.json(note)
  },
)

// Update a note
app.patch(
  '/api/notes/:noteId',
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

    if (!note) return c.json({ error: 'Note not found' }, 404)

    const [nb] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, note.notebook_id))
      .limit(1)

    if (!nb || nb.user_id !== userId) {
      return c.json({ error: 'Note not found' }, 404)
    }

    const updates: Record<string, unknown> = { updatedAt: sql`(current_timestamp)` }
    if (body.title !== undefined) updates.title = body.title.trim()
    if (body.content !== undefined) updates.content = body.content

    await db
      .update(notes)
      .set(updates as any)
      .where(eq(notes.id, noteId))

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
app.delete(
  '/api/notes/:noteId',
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

    if (!note) return c.json({ error: 'Note not found' }, 404)

    const [nb] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, note.notebook_id))
      .limit(1)

    if (!nb || nb.user_id !== userId) {
      return c.json({ error: 'Note not found' }, 404)
    }

    await db.delete(notes).where(eq(notes.id, noteId))
    return c.newResponse(null, 204)
  },
)

// ---- Source CRUD --------------------------------------------------------------

// Delete a source
app.delete(
  '/api/sources/:id',
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

    if (!source) return c.json({ error: 'Source not found' }, 404)

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, source.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Source not found' }, 404)
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
      // The adapter's delete() is best-effort and never throws. M23
      // orphan-cleanup logging is handled inside the adapter.
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
app.patch(
  '/api/sources/:id',
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

    if (!source) return c.json({ error: 'Source not found' }, 404)

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, source.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return c.json({ error: 'Source not found' }, 404)
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

// ---- Notebook CRUD ----------------------------------------------------------

// Update notebook metadata
app.patch(
  '/api/notebooks/:id',
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
      return c.json({ error: 'Notebook not found' }, 404)
    }

    const updates: Record<string, unknown> = { updatedAt: sql`(current_timestamp)` }
    if (body.title !== undefined) updates.title = body.title.trim()
    if (body.description !== undefined) updates.description = body.description

    if (body.ai_provider !== undefined) {
      if (body.ai_provider !== null) {
        const supportedForEmbedding = ['workers-ai']
        if (!supportedForEmbedding.includes(body.ai_provider)) {
          return c.json(
            {
              error:
                `ai_provider "${body.ai_provider}" is not supported for embedding. ` +
                `The Vectorize index is 1024-dim and only Workers AI (bge-large-en-v1.5) produces matching vectors. ` +
                `Use ai_provider=workers-ai for embedding, and configure model_chat / model_summarization separately if you need a different chat model.`,
            },
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
app.delete(
  '/api/notebooks/:id',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    // M15.2: Use RQBv2 relations to fetch notebook + sources + chunks + images in
    // a single round-trip. Note: column shorthand `{ id }` is required because
    // drizzle v1's relations filter doesn't tolerate `eq()`'s enumerable props.
    const notebook = await db.query.notebooks.findFirst({
      where: { id },
      with: {
        sources: { with: { sourceChunks: true } },
        sourceImages: true,
      },
    })

    if (!notebook || notebook.userId !== userId) {
      return c.json({ error: 'Notebook not found' }, 404)
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

    // CASCADE on sources/source_chunks/source_images/notes/chat_sessions
    // via FK references handles cleanup; just delete the notebook row.
    await db.delete(notebooks).where(eq(notebooks.id, id))

    return c.newResponse(null, 204)
  },
)

// Reorder sources
app.post(
  '/api/notebooks/:id/sources/reorder',
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
      return c.json({ error: 'Notebook not found' }, 404)
    }

    // Verify all source IDs belong to this notebook
    const matching = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(inArray(sources.id, sourceIds), eq(sources.notebookId, id)))

    const matchingSet = new Set(matching.map((r) => r.id))
    const invalidIds = sourceIds.filter((sid) => !matchingSet.has(sid))
    if (invalidIds.length > 0) {
      return c.json({ error: `Invalid source IDs: ${invalidIds.join(', ')}` }, 400)
    }

    // Update display_order in source order using batch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// ---- Webpage fetch proxy -----------------------------------------------------

const PRIVATE_ORIGINS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.1[6-9]\./,
  /^https?:\/\/172\.2[0-9]\./,
  /^https?:\/\/172\.3[0-1]\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/(?:0:)?0:0:0:0:0:0:1/i,
]

function isValidFetchUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const href = url.href
  if (PRIVATE_ORIGINS.some((re) => re.test(href))) return null
  url.hash = ''
  return url.href
}

app.get(
  '/api/fetch',
  zValidator('query', z.object({ url: z.string().url() }), vHook),
  async (c) => {
    const { url: rawUrl } = c.req.valid('query')

    const safeUrl = isValidFetchUrl(rawUrl)
    if (!safeUrl) {
      return c.json({ error: 'Invalid or disallowed URL' }, 400)
    }

    try {
      const response = await fetch(safeUrl)
      if (!response.ok) {
        return c.json({ error: `Upstream returned ${response.status} ${response.statusText}` }, 502)
      }
      const html = await response.text()
      return c.newResponse(html, 200, { 'Content-Type': 'text/html; charset=utf-8' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: `Failed to fetch URL: ${message}` }, 502)
    }
  },
)

export default app
