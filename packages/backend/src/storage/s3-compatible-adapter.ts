// packages/backend/src/storage/s3-compatible-adapter.ts
//
// S3-compatible adapter. Uses aws4fetch (mhart) for SigV4 signing
// and HTTP I/O. Chosen over @aws-sdk/client-s3 because the latter
// imports node:fs in Workers even with nodejs_compat enabled
// (aws/aws-sdk-js-v3#7446). aws4fetch is 6.4 KB, zero-dependency,
// pure Web Standards.
//
// Supports R2-over-S3, AWS S3, MinIO, Backblaze B2, and any other
// S3-compatible service. The CORS preflight issue with R2's S3
// endpoint is handled at the route layer (the /api/uploads/presign
// route checks supportsDirectPresign() and falls back to a proxy
// URL for R2 endpoints).
//
// presign() uses AwsV4Signer directly (rather than AwsClient.sign
// with signQuery: true) because the latter hard-codes X-Amz-Expires
// to 86400 and does not respect the caller's expiresInSec.

import { AwsClient, AwsV4Signer } from 'aws4fetch'
import type { HeadResult, ObjectStorage, PresignResult, PutResult } from './interface'
import type { S3CompatibleConfig } from './types'

const R2_ENDPOINT_HOST = 'r2.cloudflarestorage.com'

export class S3CompatibleAdapter implements ObjectStorage {
  readonly provider = 's3-compatible' as const
  private readonly client: AwsClient
  private readonly endpoint: string
  private readonly bucket: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly forcePathStyle: boolean
  private readonly isR2: boolean

  constructor(cfg: S3CompatibleConfig) {
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
      // No internal retries: errors are returned to the caller, which
      // decides whether to retry. This matches the behavior of the R2
      // binding adapter (no implicit retries) and gives the admin
      // health check fast feedback on bad credentials.
      retries: 0,
    })
    this.endpoint = cfg.endpoint.replace(/\/$/, '')
    this.bucket = cfg.bucket
    this.region = cfg.region
    this.accessKeyId = cfg.accessKeyId
    this.secretAccessKey = cfg.secretAccessKey
    this.forcePathStyle = cfg.forcePathStyle
    this.isR2 = this.endpoint.includes(R2_ENDPOINT_HOST)
  }

  // Build the request URL. Path-style: <endpoint>/<bucket>/<key>.
  private objectUrl(key: string): string {
    if (this.forcePathStyle) {
      return `${this.endpoint}/${this.bucket}/${encodeS3Key(key)}`
    }
    // virtual-hosted-style — caller is responsible for endpoint shape
    return `${this.endpoint}/${encodeS3Key(key)}`
  }

  async presign(key: string, contentType: string, expiresInSec = 600): Promise<PresignResult> {
    // aws4fetch hard-codes X-Amz-Expires to 86400 for S3 signQuery mode
    // and will only honor a pre-existing value. Pre-seed the URL.
    const url = new URL(this.objectUrl(key))
    url.searchParams.set('X-Amz-Expires', String(expiresInSec))

    const signer = new AwsV4Signer({
      method: 'PUT',
      url: url.toString(),
      headers: contentType ? { 'content-type': contentType } : {},
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      service: 's3',
      region: this.region,
      signQuery: true,
    })
    const signed = await signer.sign()
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString()
    return { url: signed.url.toString(), expiresAt }
  }

  async put(
    key: string,
    body: ArrayBuffer | ReadableStream<Uint8Array>,
    contentType?: string,
  ): Promise<PutResult> {
    const res = await this.client.fetch(this.objectUrl(key), {
      method: 'PUT',
      body,
      headers: contentType ? { 'content-type': contentType } : {},
    })
    if (!res.ok) {
      throw new Error(`S3 PUT ${key} failed: ${res.status} ${await safeText(res)}`)
    }
    const etag = stripQuotes(res.headers.get('etag') ?? '')
    return { etag, size: 0 }
  }

  async head(key: string): Promise<HeadResult | null> {
    const res = await this.client.fetch(this.objectUrl(key), { method: 'HEAD' })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`S3 HEAD ${key} failed: ${res.status}`)
    }
    const size = Number(res.headers.get('content-length') ?? '0')
    return {
      size: Number.isFinite(size) ? size : 0,
      contentType: res.headers.get('content-type') ?? undefined,
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const res = await this.client.fetch(this.objectUrl(key), { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`S3 GET ${key} failed: ${res.status}`)
    }
    return await res.arrayBuffer()
  }

  async delete(keys: string | string[]): Promise<void> {
    const arr = Array.isArray(keys) ? keys : [keys]
    if (arr.length === 0) return
    await Promise.all(
      arr.map(async (key) => {
        try {
          const res = await this.client.fetch(this.objectUrl(key), { method: 'DELETE' })
          if (!res.ok && res.status !== 404) {
            console.error(`[storage] S3 DELETE ${key} failed: ${res.status} ${await safeText(res)}`)
          }
        } catch (err) {
          console.error(
            `[storage] S3 DELETE ${key} threw:`,
            err instanceof Error ? err.message : err,
          )
        }
      }),
    )
  }

  async healthCheck(): Promise<void> {
    const testKey = `__healthcheck/${Date.now()}-${crypto.randomUUID()}`
    const body = new TextEncoder().encode('health-check')
    const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    try {
      await this.put(testKey, arrayBuffer as ArrayBuffer, 'text/plain')
    } finally {
      await this.delete(testKey).catch(() => {
        // best-effort
      })
    }
  }

  supportsDirectPresign(): boolean {
    // R2's S3 endpoint fails CORS preflight on signed PUTs (see
    // uploads.ts:18-23). For R2 endpoints we force callers to use
    // the Worker proxy path. Non-R2 S3-compatible services
    // (AWS S3, MinIO, B2) typically have CORS configured correctly.
    return !this.isR2
  }
}

function encodeS3Key(key: string): string {
  // Encode each path segment but preserve slashes.
  return key.split('/').map(encodeURIComponent).join('/')
}

function stripQuotes(s: string): string {
  return s.replace(/^"|"$/g, '')
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return ''
  }
}
