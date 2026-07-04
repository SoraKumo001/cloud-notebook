// packages/backend/src/routes/sources/presign.ts
// Presigned URL generation and direct upload endpoints.

import { zValidator } from '@hono/zod-validator'
import { and, eq, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { notebooks, sources } from '../../db/schema'
import { ErrorCode, errorResponse } from '../../errors'
import type { AppEnv } from '../../types'
import { vHook } from '../common'

const router = new Hono<AppEnv>()

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

export default router
