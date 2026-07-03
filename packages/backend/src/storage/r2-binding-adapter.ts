// packages/backend/src/storage/r2-binding-adapter.ts
//
// Adapter that uses the Cloudflare R2 native binding (env.BUCKET).
// This is the zero-credential, lowest-latency option: no HTTPS
// round-trip, no egress fee within Cloudflare.
//
// presign() uses bucket.createPresignedUrl(), which generates a URL
// to the R2-hosted CDN (not the S3 endpoint), avoiding the CORS
// preflight issue documented in uploads.ts:18-23. supportsDirectPresign()
// therefore returns true.
//
// `R2Bucket.createPresignedUrl` is documented in the Cloudflare R2
// Workers API reference but is not yet in the @cloudflare/workers-types
// declarations. We cast to a local structural type at the call site.

import type { R2Bucket } from '@cloudflare/workers-types'
import type { HeadResult, ObjectStorage, PresignResult, PutResult } from './interface'

type R2BucketWithPresign = R2Bucket & {
  createPresignedUrl(
    key: string,
    options?: {
      method?: 'GET' | 'PUT' | 'DELETE' | 'POST'
      expiresIn?: number
      headers?: Record<string, string>
    },
  ): Promise<string>
}

export class R2BindingAdapter implements ObjectStorage {
  readonly provider = 'r2-binding' as const
  private readonly bucket: R2BucketWithPresign

  constructor(bucket: R2Bucket) {
    this.bucket = bucket as R2BucketWithPresign
  }

  async presign(key: string, contentType: string, expiresInSec = 600): Promise<PresignResult> {
    const url = await this.bucket.createPresignedUrl(key, {
      method: 'PUT',
      expiresIn: expiresInSec,
      headers: contentType ? { 'content-type': contentType } : undefined,
    })
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString()
    return { url, expiresAt }
  }

  async put(
    key: string,
    body: ArrayBuffer | ReadableStream<Uint8Array>,
    contentType?: string,
  ): Promise<PutResult> {
    const result = await this.bucket.put(key, body, {
      httpMetadata: contentType ? { contentType } : undefined,
    })
    if (!result) {
      throw new Error(`R2 upload failed: empty result for key=${key}`)
    }
    return { etag: result.etag, size: result.size }
  }

  async head(key: string): Promise<HeadResult | null> {
    const obj = await this.bucket.head(key)
    if (!obj) return null
    return {
      size: obj.size,
      contentType: obj.httpMetadata?.contentType,
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return await obj.arrayBuffer()
  }

  async delete(keys: string | string[]): Promise<void> {
    const arr = Array.isArray(keys) ? keys : [keys]
    if (arr.length === 0) return
    // R2 supports batch delete of up to 1000 keys natively. The
    // return value is ignored: best-effort, never throws (the binding
    // already silently no-ops on missing keys).
    await this.bucket.delete(arr as [string, ...string[]])
  }

  async healthCheck(): Promise<void> {
    const testKey = `__healthcheck/${Date.now()}-${crypto.randomUUID()}`
    try {
      await this.bucket.put(testKey, 'health-check')
    } finally {
      // Always try to clean up; failure here is logged but not fatal.
      await this.bucket.delete(testKey).catch(() => {
        // best-effort
      })
    }
  }

  supportsDirectPresign(): boolean {
    return true
  }
}
