import { zValidator } from '@hono/zod-validator'
import { and, eq, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { notebooks, sourceChunks, sourceImages, sources } from '../db/schema'
import { getEffectiveAiConfig } from '../db/settings'
import { embedChunks, getEmbeddingProvider } from '../embeddings'
import { getOcrProvider } from '../providers'
import { ErrorCode, errorResponse } from '../errors'
import { type Bindings, type Variables, vHook } from './common'

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// @deprecated Replaced by POST /api/uploads/presign + POST /api/sources/finalize
router.post('/sources/upload', (c) => {
  c.header('Deprecation', 'true')
  return errorResponse(
    c,
    ErrorCode.RequestDeprecated,
    'This endpoint is deprecated. Use /api/uploads/presign + /api/sources/finalize instead.',
    410,
  )
})

// Generate a presigned PUT URL for direct upload (bypasses Worker)
router.post(
  '/uploads/presign',
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
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
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
        return errorResponse(
          c,
          ErrorCode.ResourceConflict,
          'A source with the same content already exists in this notebook',
          409,
        )
      }
    }

    const r2Key = `notebooks/${notebookId}/sources/${sourceId}/${fileName}`

    const storage = c.get('storage')

    let url = ''
    let expiresAt = ''

    if (storage.supportsDirectPresign()) {
      const presigned = await storage.presign(r2Key, contentType, 600)
      url = presigned.url
      expiresAt = presigned.expiresAt
    } else {
      const host = c.req.header('host') || 'localhost:8787'
      const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https'
      url = `${protocol}://${host}/api/uploads/direct?key=${encodeURIComponent(r2Key)}&contentType=${encodeURIComponent(contentType)}`
      expiresAt = new Date(Date.now() + 600 * 1000).toISOString()
    }

    return c.json({ url, r2Key, expiresAt })
  },
)

// Production upload path: the browser POSTs the raw file bytes to the Worker
router.post(
  '/uploads/direct',
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

    const parts = key.split('/')
    const notebookId = parts[1]
    if (!notebookId) {
      return errorResponse(c, ErrorCode.RequestInvalidKey, 'Invalid key', 400)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const body = await c.req.arrayBuffer()
    if (body.byteLength === 0) {
      return errorResponse(c, ErrorCode.RequestEmptyBody, 'Empty body', 400)
    }
    const MAX_BYTES = 100 * 1024 * 1024
    if (body.byteLength > MAX_BYTES) {
      return errorResponse(
        c,
        ErrorCode.RequestTooLarge,
        `File too large (max ${MAX_BYTES} bytes)`,
        413,
      )
    }

    const headerType = c.req.header('content-type')?.split(';')[0]?.trim()
    const effectiveType = headerType || contentType

    const result = await c.get('storage').put(key, body, effectiveType)
    return c.json({ r2Key: key, etag: result.etag, size: result.size })
  },
)

// Finalize a source upload: register metadata in D1, then embed & upsert to Vectorize.
router.post(
  '/sources/finalize',
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
        model_ocr: notebooks.modelOcr,
      })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    const effectiveConfig = await getEffectiveAiConfig(db, userId, masterKey, {
      aiEmbeddingModel: notebook.ai_embedding_model,
      modelOcr: notebook.model_ocr,
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
      const processedChunks = [...chunks]
      let embeddedCount = 0

      // Automatic OCR processing using Vision LLM if no text chunks were extracted but images exist
      if (processedChunks.length === 0 && images.length > 0) {
        const storage = c.get('storage')
        const sortedImages = [...images].sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0))
        const ocrProvider = getOcrProvider(c.env as any, effectiveConfig.ocr)

        for (const img of sortedImages) {
          const buffer = await storage.get(img.r2Key)
          if (!buffer) continue

          let pageText = ''
          try {
            pageText = await ocrProvider.ocr({
              model: effectiveConfig.ocr.model,
              imageBuffer: buffer,
              prompt:
                'Transcribe all text from this document image in Japanese. Output only the transcribed text without any conversational preamble or notes.',
            })
          } catch (err) {
            console.error(`Failed to OCR page ${img.pageNumber} using provider ${effectiveConfig.ocr.provider}:`, err)
          }

          if (pageText) {
            processedChunks.push({
              content: pageText,
              pageNumber: img.pageNumber,
            })
          }
        }
      }

      if (processedChunks.length > 0) {
        const chunkRecords = processedChunks.map((chunk) => ({
          id: crypto.randomUUID(),
          content: chunk.content,
          pageNumber: chunk.pageNumber ?? null,
        }))

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
        chunks: processedChunks.length,
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
router.post(
  '/embed',
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
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
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
