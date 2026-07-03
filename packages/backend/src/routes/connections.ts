import { zValidator } from '@hono/zod-validator'
import { desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { encryptApiKey, getDecryptedApiKey } from '../crypto'
import { aiConnections } from '../db/schema'
import { ErrorCode, errorResponse } from '../errors'
import { fetchConnectionModels } from '../providers'
import { type Bindings, type Variables, vHook } from './common'

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// List AI Connections
router.get('/connections', async (c) => {
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
router.post(
  '/connections',
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
router.delete(
  '/connections/:id',
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
      return errorResponse(c, ErrorCode.ConnectionNotFound, 'Connection not found', 404)
    }

    await db.delete(aiConnections).where(eq(aiConnections.id, id))
    return c.newResponse(null, 204)
  },
)

// Fetch models for a Connection
router.get(
  '/connections/:id/models',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator(
    'query',
    z.object({ type: z.enum(['chat', 'embedding', 'ocr']).optional().default('chat') }),
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
      return errorResponse(c, ErrorCode.ConnectionNotFound, 'Connection not found', 404)
    }

    const masterKey = c.env.API_KEY_ENCRYPTION_MASTER as string | undefined
    const apiKey = await getDecryptedApiKey(masterKey, conn.apiKey)

    try {
      const models = await fetchConnectionModels(conn.provider, apiKey, conn.baseUrl, type)
      return c.json({ models })
    } catch (err: unknown) {
      return errorResponse(
        c,
        ErrorCode.ServerUpstreamError,
        err instanceof Error ? err.message : 'Failed to fetch models',
        500,
      )
    }
  },
)

export default router
