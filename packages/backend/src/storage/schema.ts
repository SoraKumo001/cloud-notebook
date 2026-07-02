// packages/backend/src/storage/schema.ts
//
// Zod validation for the admin storage-settings endpoint. The endpoint
// accepts plaintext credentials; the route handler is responsible for
// encrypting access_key_id / secret_access_key before persisting.

import { z } from 'zod'

export const storageSettingsInputSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('r2-binding'),
  }),
  z.object({
    provider: z.literal('s3-compatible'),
    bucket: z.string().min(1).max(255),
    region: z.string().min(1).max(100),
    endpoint: z.string().min(1).max(500).url(),
    access_key_id: z.string().min(1).max(500),
    secret_access_key: z.string().min(1).max(500),
    force_path_style: z.boolean().default(true),
  }),
])

export type StorageSettingsInput = z.infer<typeof storageSettingsInputSchema>
