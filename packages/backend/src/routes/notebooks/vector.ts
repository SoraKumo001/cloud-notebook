// packages/backend/src/routes/notebooks/vector.ts
// Vectorize statistics and re-indexing.

import { zValidator } from '@hono/zod-validator'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { notebooks, sourceChunks } from '../../db/schema'
import { getEffectiveAiConfig } from '../../db/settings'
import { embedChunks, getEmbeddingProvider } from '../../embeddings'
import { ErrorCode, errorResponse } from '../../errors'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const router = new Hono<AppEnv>()

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

    const embedProvider = getEmbeddingProvider(c.env, {
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

export default router
