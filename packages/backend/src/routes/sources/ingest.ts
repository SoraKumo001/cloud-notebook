// packages/backend/src/routes/sources/ingest.ts
// Source ingestion pipeline: finalize (OCR + embedding) and embed endpoints.

import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { formatSSE } from '../../chat'
import { notebooks, sourceChunks, sourceImages, sources } from '../../db/schema'
import { getEffectiveAiConfig } from '../../db/settings'
import { embedChunks, getEmbeddingProvider } from '../../embeddings'
import { ErrorCode, errorResponse } from '../../errors'
import { getOcrProvider } from '../../providers'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const SSE_ENCODER = new TextEncoder()
function writeSSE(writer: WritableStreamDefaultWriter<Uint8Array>, event: string, data: unknown) {
  writer.write(SSE_ENCODER.encode(formatSSE(event, data)))
}

const router = new Hono<AppEnv>()

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

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    ;(async () => {
      try {
        const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
        const effectiveConfig = await getEffectiveAiConfig(db, userId, masterKey, {
          aiEmbeddingModel: notebook.ai_embedding_model,
          modelOcr: notebook.model_ocr,
        })

        const embedProvider = getEmbeddingProvider(c.env, {
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

        const processedChunks = [...chunks]
        let embeddedCount = 0

        // Automatic OCR processing using Vision LLM if no text chunks were extracted but images exist
        if (processedChunks.length === 0 && images.length > 0) {
          writeSSE(writer, 'progress', {
            stage: 'ocr',
            current: 0,
            total: images.length,
            percent: 0,
          })

          const storage = c.get('storage')
          const sortedImages = [...images].sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0))
          const ocrProvider = getOcrProvider(c.env, effectiveConfig.ocr)

          for (let i = 0; i < sortedImages.length; i++) {
            const img = sortedImages[i]
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
              console.error(
                `Failed to OCR page ${img.pageNumber} using provider ${effectiveConfig.ocr.provider}:`,
                err,
              )
            }

            if (pageText) {
              processedChunks.push({
                content: pageText,
                pageNumber: img.pageNumber,
              })
            }

            writeSSE(writer, 'progress', {
              stage: 'ocr',
              current: i + 1,
              total: sortedImages.length,
              percent: Math.round(((i + 1) / sortedImages.length) * 75), // scale OCR up to 75%
            })
          }
        }

        if (processedChunks.length > 0) {
          writeSSE(writer, 'progress', {
            stage: 'embedding',
            percent: 85,
          })

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

        writeSSE(writer, 'done', {
          id: sourceId,
          status: 'completed',
          chunks: processedChunks.length,
          images: images.length,
          embedded: embeddedCount,
        })
      } catch (err) {
        await db
          .update(sources)
          .set({ status: 'failed' })
          .where(eq(sources.id, sourceId))
          .catch(() => {})
        const message = err instanceof Error ? err.message : String(err)
        writeSSE(writer, 'error', { message })
      } finally {
        await writer.close().catch(() => {})
      }
    })()

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
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

    const provider = getEmbeddingProvider(c.env, {
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

export default router
