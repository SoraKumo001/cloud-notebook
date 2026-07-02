// packages/backend/src/db/schema/globalSettings.ts
//
// Deployment-wide singleton settings row. The id is fixed to 'default' and
// a CHECK constraint guarantees no other row can be inserted, giving us a
// hard DB-level guarantee of the singleton invariant in addition to the
// application-level convention of always using `id = 'default'`.
//
// The `storageConfig` column is a JSON blob; the `s3-compatible` branch
// stores AES-256-GCM-encrypted credentials inside it, so the column itself
// is just opaque text from the DB's perspective.

import { sql } from 'drizzle-orm'
import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const globalSettings = sqliteTable(
  'global_settings',
  {
    id: text('id').primaryKey().default('default'),
    // 'r2-binding' | 's3-compatible'
    storageProvider: text('storage_provider', { enum: ['r2-binding', 's3-compatible'] })
      .notNull()
      .default('r2-binding'),
    // For 'r2-binding' this is null.
    // For 's3-compatible' this is JSON of:
    //   {
    //     bucket, region, endpoint, forcePathStyle,
    //     accessKeyId (encrypted), secretAccessKey (encrypted),
    //   }
    storageConfig: text('storage_config', { mode: 'json' }).$type<StorageConfigJson | null>(),
    updatedBy: text('updated_by'),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [check('single_row', sql`${t.id} = 'default'`)],
)

export type GlobalSettings = typeof globalSettings.$inferSelect
export type NewGlobalSettings = typeof globalSettings.$inferInsert

/**
 * Shape of the `storageConfig` JSON blob, post-encryption.
 *
 * NOTE: `accessKeyId` and `secretAccessKey` are stored as AES-256-GCM
 * ciphertext in the format produced by `encryptApiKey`:
 *   "{iv_b64}:{ciphertext_b64}:{tag_b64}"
 */
export interface StorageConfigJson {
  bucket: string
  region: string
  endpoint: string
  forcePathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
}
