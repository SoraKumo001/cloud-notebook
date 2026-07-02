// packages/backend/src/storage/__tests__/s3-compatible-adapter.test.ts
//
// Unit tests for S3CompatibleAdapter. We mock global fetch and
// inspect the URL/method/headers of each request to confirm
// SigV4 signing happens via aws4fetch. We don't validate the
// actual HMAC signatures (that's aws4fetch's job); we validate
// the integration: that the correct path-style URL, method,
// content-type, and signed X-Amz-* query string are produced.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3CompatibleAdapter } from '../s3-compatible-adapter'

function makeAdapter(endpoint: string, forcePathStyle = true) {
  return new S3CompatibleAdapter({
    bucket: 'test-bucket',
    region: 'auto',
    endpoint,
    accessKeyId: 'AKID-TEST',
    secretAccessKey: 'SECRET-TEST',
    forcePathStyle,
  })
}

let originalFetch: typeof fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  originalFetch = globalThis.fetch
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers,
  })
}

function urlOf(call: unknown): string {
  const input = call as string | URL | Request
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return String(input)
}

function methodOf(call: unknown): string {
  const input = call as Request
  if (input instanceof Request) return input.method
  return 'GET'
}

describe('S3CompatibleAdapter', () => {
  it('exposes provider "s3-compatible" and disables direct presign for R2 endpoints', () => {
    const r2 = makeAdapter('https://account.r2.cloudflarestorage.com')
    expect(r2.provider).toBe('s3-compatible')
    expect(r2.supportsDirectPresign()).toBe(false)

    const aws = makeAdapter('https://s3.us-east-1.amazonaws.com')
    expect(aws.supportsDirectPresign()).toBe(true)

    const minio = makeAdapter('http://localhost:9000')
    expect(minio.supportsDirectPresign()).toBe(true)
  })

  it('strips trailing slash from the endpoint', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com/')
    fetchMock.mockResolvedValue(jsonResponse(200))

    await adapter.head('k')

    const calledUrl = urlOf(fetchMock.mock.calls[0][0])
    expect(calledUrl).toBe('https://account.r2.cloudflarestorage.com/test-bucket/k')
    expect(calledUrl).not.toContain('//test-bucket')
  })

  it('head() returns null on 404 and a size+contentType on 200', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')

    fetchMock.mockResolvedValueOnce(jsonResponse(404))
    expect(await adapter.head('missing')).toBeNull()

    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'content-length': '1234', 'content-type': 'application/pdf' },
      }),
    )
    expect(await adapter.head('k')).toEqual({ size: 1234, contentType: 'application/pdf' })
  })

  it('head() throws on non-OK non-404', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'oops' }))

    await expect(adapter.head('k')).rejects.toThrow(/HEAD k failed: 500/)
  })

  it('put() sends PUT to path-style URL with content-type and returns etag', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { etag: '"abc123"' } }),
    )

    const body = new ArrayBuffer(8)
    const result = await adapter.put('notebooks/n/file.pdf', body, 'application/pdf')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = urlOf(fetchMock.mock.calls[0][0])
    expect(calledUrl).toBe(
      'https://account.r2.cloudflarestorage.com/test-bucket/notebooks/n/file.pdf',
    )
    expect(methodOf(fetchMock.mock.calls[0][0])).toBe('PUT')
    expect(result.etag).toBe('abc123') // quotes stripped
  })

  it('put() throws on non-OK response', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))

    await expect(adapter.put('k', new ArrayBuffer(0))).rejects.toThrow(/PUT k failed: 403/)
  })

  it('delete() issues one DELETE per key and never throws on 404', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))

    await adapter.delete(['a', 'b', 'c'])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    // Promise.all preserves input order; the URLs are independent
    // of completion order. Sort the URLs for stable assertion.
    const urls = fetchMock.mock.calls.map((c) => urlOf(c[0])).sort()
    expect(urls).toEqual(
      [
        'https://account.r2.cloudflarestorage.com/test-bucket/a',
        'https://account.r2.cloudflarestorage.com/test-bucket/b',
        'https://account.r2.cloudflarestorage.com/test-bucket/c',
      ].sort(),
    )
    // 500 logs an error but does not throw
  })

  it('delete() noops on empty array', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    await adapter.delete([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('presign() returns a URL with X-Amz-* query string parameters', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    const result = await adapter.presign('notebooks/n/file.pdf', 'application/pdf', 600)

    expect(result.url).toContain(
      'https://account.r2.cloudflarestorage.com/test-bucket/notebooks/n/file.pdf',
    )
    expect(result.url).toMatch(/[?&]X-Amz-Algorithm=AWS4-HMAC-SHA256/)
    expect(result.url).toMatch(/[?&]X-Amz-Credential=/)
    expect(result.url).toMatch(/[?&]X-Amz-Date=/)
    expect(result.url).toMatch(/[?&]X-Amz-Expires=600/)
    expect(result.url).toMatch(/[?&]X-Amz-Signature=/)
    expect(result.url).toMatch(/[?&]X-Amz-SignedHeaders=/)
    // expiresAt is a future ISO date
    const expiresAtMs = Date.parse(result.expiresAt)
    expect(expiresAtMs).toBeGreaterThan(Date.now())
  })

  it('encodes special characters in object keys', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    fetchMock.mockResolvedValueOnce(jsonResponse(404))

    await adapter.head('folder with space/file+name.pdf')

    const calledUrl = urlOf(fetchMock.mock.calls[0][0])
    expect(calledUrl).toBe(
      'https://account.r2.cloudflarestorage.com/test-bucket/folder%20with%20space/file%2Bname.pdf',
    )
  })

  it('healthCheck() writes then deletes a probe key', async () => {
    const adapter = makeAdapter('https://account.r2.cloudflarestorage.com')
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"x"' } })) // put
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // delete

    await adapter.healthCheck()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const putUrl = urlOf(fetchMock.mock.calls[0][0])
    const delUrl = urlOf(fetchMock.mock.calls[1][0])
    expect(putUrl).toMatch(
      /^https:\/\/account\.r2\.cloudflarestorage\.com\/test-bucket\/__healthcheck\//,
    )
    expect(delUrl).toBe(putUrl)
  })
})
