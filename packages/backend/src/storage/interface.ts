// packages/backend/src/storage/interface.ts
//
// Adapter-neutral surface for object storage. Two implementations exist:
//   - R2BindingAdapter   : uses env.BUCKET (Cloudflare R2 native binding)
//   - S3CompatibleAdapter: uses aws4fetch against any S3-compatible endpoint
//
// The presign() method on R2BindingAdapter generates a URL to the
// R2-hosted CDN (not the S3 endpoint), avoiding the CORS preflight
// issue that affects direct PUTs to *.r2.cloudflarestorage.com. The
// S3 adapter's presign() uses query-string SigV4 signing and exposes
// `supportsDirectPresign()` so callers (the /api/uploads/presign
// route) can decide whether to return the URL directly or wrap it in
// a Worker proxy.

export interface PresignResult {
  /** URL the browser can PUT (or GET) to without any Worker hop. */
  url: string
  /** ISO-8601 timestamp. */
  expiresAt: string
}

export interface PutResult {
  etag: string
  size: number
}

export interface HeadResult {
  size: number
  contentType?: string
}

export interface ObjectStorage {
  /**
   * Generate a URL the browser can PUT to for a direct upload.
   * @param key          Object key (e.g. "notebooks/nb-1/sources/src-1/file.pdf")
   * @param contentType  Expected Content-Type the client will send
   * @param expiresInSec Time-to-live in seconds
   */
  presign(key: string, contentType: string, expiresInSec?: number): Promise<PresignResult>

  /**
   * Upload an object through the Worker (proxy path). Used when the
   * presigned URL would hit CORS preflight issues (notably R2's S3
   * endpoint) or when the client doesn't support direct presign.
   */
  put(
    key: string,
    body: ArrayBuffer | ReadableStream<Uint8Array>,
    contentType?: string,
  ): Promise<PutResult>

  /**
   * Get object metadata. Returns null if the object does not exist.
   * The current app only needs size, but contentType is included
   * for completeness.
   */
  head(key: string): Promise<HeadResult | null>

  /**
   * Delete one or more objects. Best-effort: per-key errors are
   * logged but never thrown. The R2 binding natively supports
   * batch delete (up to 1000 keys); the S3 adapter issues one
   * DELETE per key.
   */
  delete(keys: string | string[]): Promise<void>

  /**
   * Write + delete a probe object. Throws on failure. Used by the
   * admin PUT endpoint to verify credentials at save time.
   */
  healthCheck(): Promise<void>

  /**
   * Whether presign() returns a URL the browser can hit directly.
   * False for R2-via-S3 (CORS preflight fails on *.r2.cloudflarestorage.com)
   * and for any endpoint known to have CORS issues.
   */
  supportsDirectPresign(): boolean

  /** Discriminator for logging/metrics. */
  readonly provider: 'r2-binding' | 's3-compatible'
}
