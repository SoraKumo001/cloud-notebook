// packages/backend/src/fetch.test.ts
// Tests for GET /api/fetch — CORS proxy endpoint.
// Uses Cookie-based auth (under authMiddleware).

import { afterEach, describe, expect, it, vi } from 'vitest'
import app from './index'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe('GET /api/fetch — URL validation', () => {
  it('returns 400 when url param is missing', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(authedRequest('http://localhost/api/fetch', cookie), env)
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('Validation failed')
  })

  it('returns 400 for non-http protocol', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('ftp://example.com/file.txt')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects localhost URLs (SSRF)', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('http://localhost:8080/secret')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects 127.0.0.1 (SSRF)', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('http://127.0.0.1:8787/admin')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects 192.168.* (SSRF)', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('http://192.168.1.1/config')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects 10.* (SSRF)', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('http://10.0.0.1/internal')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('accepts a valid public HTTPS URL', async () => {
    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    // We only test validation — fetch mock happens below
    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('https://example.com/page')}`,
        cookie,
      ),
      env,
    )
    // Will fail at the fetch stage (no mock), not validation
    expect(res.status).not.toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Fetch & error handling
// ---------------------------------------------------------------------------

describe('GET /api/fetch — fetch behaviour', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns HTML when upstream responds 200', async () => {
    const fakeHtml = '<html><body><p>Hello</p></body></html>'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fakeHtml),
    } as Response)

    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('https://example.com')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    const text = await res.text()
    expect(text).toBe(fakeHtml)
  })

  it('returns 502 when upstream returns error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve(''),
    } as Response)

    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('https://example.com/missing')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('404')
  })

  it('returns 502 when fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))

    const { env } = createTestEnv()
    const { cookie } = await createAuthedRequest(env)

    const res = await app.fetch(
      authedRequest(
        `http://localhost/api/fetch?url=${encodeURIComponent('https://nonexistent.example.com')}`,
        cookie,
      ),
      env,
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('ENOTFOUND')
  })
})
