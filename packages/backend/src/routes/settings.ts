import { zValidator } from '@hono/zod-validator'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../auth'
import { encryptApiKey } from '../crypto'
import { globalSettings, notebooks, userSettings } from '../db/schema'
import type { StorageConfigJson } from '../db/schema/globalSettings'
import { ErrorCode, errorResponse } from '../errors'
import { storageSettingsInputSchema } from '../storage/schema'
import type { AppEnv } from '../types'
import { vHook } from './common'

const router = new Hono<AppEnv>()

// Get global user settings
router.get('/settings', async (c) => {
  const userId = c.get('user').id
  const db = c.get('db')

  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)

  if (!settings) {
    return c.json({
      ai_embedding_model: '@cf/baai/bge-m3',
      model_chat: '@cf/meta/llama-3.1-8b-instruct-fast',
      model_summarization: '@cf/meta/llama-3.1-8b-instruct-fast',
      model_ocr: '@cf/meta/llama-3.2-11b-vision-instruct',
      system_prompt: null,
    })
  }

  return c.json({
    ai_embedding_model: settings.aiEmbeddingModel,
    model_chat: settings.modelChat,
    model_summarization: settings.modelSummarization,
    model_ocr: settings.modelOcr,
    system_prompt: settings.systemPrompt,
  })
})

// Update global user settings
router.put(
  '/settings',
  zValidator(
    'json',
    z.object({
      ai_embedding_model: z.string().min(1).max(200),
      model_chat: z.string().min(1).max(200),
      model_summarization: z.string().min(1).max(200),
      model_ocr: z.string().min(1).max(200),
      system_prompt: z.string().max(4000).nullable().optional(),
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
      modelOcr: body.model_ocr,
      systemPrompt: body.system_prompt,
      updatedAt: sql`(current_timestamp)`,
    }

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
        modelOcr: updates.modelOcr,
        systemPrompt: updates.systemPrompt,
      })
    }

    // Invalidate cached notebook configs for this user
    if (typeof caches !== 'undefined' && caches.default) {
      try {
        const userNotebooks = await db
          .select({ id: notebooks.id })
          .from(notebooks)
          .where(eq(notebooks.userId, userId))
        await Promise.all(
          userNotebooks.map((nb) =>
            caches.default.delete(new Request(`https://cache.internal/notebook/${nb.id}`)),
          ),
        )
      } catch {
        // cache invalidation is best-effort
      }
    }

    return c.json({ success: true })
  },
)

// Get global storage settings (admin only)
router.get('/admin/storage', requireAdmin, async (c) => {
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

// Update global storage settings (admin only)
router.put(
  '/admin/storage',
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
        return errorResponse(
          c,
          ErrorCode.ServerConfigError,
          'API_KEY_ENCRYPTION_MASTER is not configured',
          500,
        )
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

    if (body.provider === 'r2-binding' && !c.env.BUCKET) {
      return errorResponse(
        c,
        ErrorCode.StorageProviderMismatch,
        "Cannot save provider 'r2-binding': this Worker has no R2_BUCKET binding configured. Choose 's3-compatible' instead.",
        400,
      )
    }

    if (body.provider === 's3-compatible' && storageConfig) {
      try {
        const { S3CompatibleAdapter } = await import('../storage/s3-compatible-adapter')
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
        return errorResponse(c, ErrorCode.StorageHealthCheckFailed, warnings[0], 400)
      }
    }

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

export default router
