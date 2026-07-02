// packages/backend/src/storage/factory.ts
//
// Returns the active ObjectStorage adapter for a given env, reading
// the singleton row from `global_settings` and decrypting any
// encrypted secrets inside.
//
// Backward-compatibility: when no `global_settings` row exists, the
// factory falls back to R2BindingAdapter using env.BUCKET. This
// preserves existing deployments' behavior with zero migration.
//
// The factory is intended to be called once per request via
// storageMiddleware; the result is cached on the Hono context.

import type { R2Bucket } from '@cloudflare/workers-types'
import { eq } from 'drizzle-orm'
import { decryptApiKey } from '../crypto'
import type { DB } from '../db/client'
import { globalSettings } from '../db/schema/globalSettings'
import type { ObjectStorage } from './interface'
import { R2BindingAdapter } from './r2-binding-adapter'
import { S3CompatibleAdapter } from './s3-compatible-adapter'
import type { S3CompatibleConfig } from './types'

export interface StorageEnv {
  BUCKET?: R2Bucket
  API_KEY_ENCRYPTION_MASTER?: string
  /** Test override — populated by createTestEnv() to bypass the factory. */
  __storage?: ObjectStorage
}

const SINGLETON_ID = 'default' as const

export async function getObjectStorage(env: StorageEnv, db: DB): Promise<ObjectStorage> {
  const [row] = await db
    .select()
    .from(globalSettings)
    .where(eq(globalSettings.id, SINGLETON_ID))
    .limit(1)

  // No row → fall back to the binding.
  if (!row?.storageProvider) {
    if (!env.BUCKET) {
      throw new Error('No storage configured and no R2_BUCKET binding available on this Worker')
    }
    return new R2BindingAdapter(env.BUCKET)
  }

  if (row.storageProvider === 'r2-binding') {
    if (!env.BUCKET) {
      throw new Error(
        "Storage provider is 'r2-binding' but no R2_BUCKET binding is configured on this Worker",
      )
    }
    return new R2BindingAdapter(env.BUCKET)
  }

  // s3-compatible
  if (!row.storageConfig) {
    throw new Error("Storage provider is 's3-compatible' but no storageConfig was found")
  }

  const masterKey = env.API_KEY_ENCRYPTION_MASTER
  if (!masterKey) {
    throw new Error('API_KEY_ENCRYPTION_MASTER is not configured — cannot decrypt storage secrets')
  }

  const accessKeyId = await decryptApiKey(masterKey, row.storageConfig.accessKeyId)
  const secretAccessKey = await decryptApiKey(masterKey, row.storageConfig.secretAccessKey)

  const cfg: S3CompatibleConfig = {
    bucket: row.storageConfig.bucket,
    region: row.storageConfig.region,
    endpoint: row.storageConfig.endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: row.storageConfig.forcePathStyle,
  }

  return new S3CompatibleAdapter(cfg)
}
