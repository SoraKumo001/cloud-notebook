// packages/backend/src/types.ts
//
// Centralised Hono Env types for the entire backend.
// This is a leaf module — it imports nothing from other project modules,
// so it is safe from circular dependencies.

import type { DB } from './db/client'
import type { ObjectStorage } from './storage/interface'

export type AppBindings = {
  DB: D1Database
  BUCKET?: R2Bucket
  VECTORIZE: VectorizeIndex
  AI: Ai
  ASSETS: Fetcher
  NODE_ENV?: string
  CF_ENV?: string
  SESSION_SECRET?: string
  API_KEY_ENCRYPTION_MASTER?: string
  __storage?: ObjectStorage
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
}

export type AppVariables = {
  user: { id: string; email: string; name?: string; isAdmin: boolean }
  db: DB
  storage: ObjectStorage
}

export type AppEnv = { Bindings: AppBindings; Variables: AppVariables }
