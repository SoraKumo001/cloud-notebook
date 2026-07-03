import type { DB } from '../db/client'
import { ErrorCode, errorResponse } from '../errors'
import type { ObjectStorage } from '../storage/interface'

export type Bindings = {
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
}

export type Variables = {
  user: { id: string; email: string; name?: string }
  db: DB
  storage: ObjectStorage
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vHook = (result: any, c: any) => {
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Invalid request'
    return errorResponse(c, ErrorCode.ValidationFailed, `Validation failed: ${message}`, 400)
  }
}
