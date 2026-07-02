// packages/backend/src/storage/types.ts
//
// Plain (pre-encryption) shapes for storage configuration.
// The D1 row stores the encrypted form (see StorageConfigJson in
// db/schema/globalSettings.ts); this file holds the in-memory shapes.

export type StorageProvider = 'r2-binding' | 's3-compatible'

/**
 * Plain (unencrypted) S3-compatible config. Used at the boundary
 * where the admin PUTs new credentials and where the factory
 * constructs an S3CompatibleAdapter.
 */
export interface S3CompatibleConfig {
  bucket: string
  region: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export interface R2BindingConfig {
  /** The R2Bucket binding is supplied via env.BUCKET at construction time. */
  // Marker only — no fields.
  readonly __brand?: 'r2-binding'
}
