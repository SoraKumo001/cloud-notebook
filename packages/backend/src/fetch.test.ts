// packages/backend/src/fetch.test.ts
// Tests for GET /api/fetch — CORS proxy endpoint.

import { afterEach, describe, expect, it, vi } from 'vitest'
import app from './index'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function callFetch(url: string | undefined, env?: Record<string, unknown>) {
  const path = url !== undefined ? `/api/fetch?url=${encodeURIComponent(url)}` : '/api/fetch'
  return app.fetch(new Request(`http://localhost${path}`), {
    NODE_ENV: 'development',
    ...env,
  })
}

/** Build an env that includes the default storage mock from createTestEnv. */
function baseEnv(): Record<string, unknown> {
  return createTestEnv().env
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe('GET /api/fetch — URL validation', () => {
  it('returns 400 when url param is missing', async () => {
    const res = await callFetch(undefined, baseEnv())
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('Validation failed')
  })

  it('returns 400 for non-http protocol', async () => {
    const res = await callFetch('ftp://example.com/file.txt', baseEnv())
    expect(res.status).toBe(400)
  })

  it('rejects localhost URLs (SSRF)', async () => {
    const res = await callFetch('http://localhost:8080/secret', baseEnv())
    expect(res.status).toBe(400)
  })

  it('rejects 127.0.0.1 (SSRF)', async () => {
    const res = await callFetch('http://127.0.0.1:8787/admin', baseEnv())
    expect(res.status).toBe(400)
  })

  it('rejects 192.168.* (SSRF)', async () => {
    const res = await callFetch('http://192.168.1.1/config', baseEnv())
    expect(res.status).toBe(400)
  })

  it('rejects 10.* (SSRF)', async () => {
    const res = await callFetch('http://10.0.0.1/internal', baseEnv())
    expect(res.status).toBe(400)
  })

  it('accepts a valid public HTTPS URL', async () => {
    // We only test validation — fetch mock happens below
    const res = await callFetch('https://example.com/page', baseEnv())
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

    const res = await callFetch('https://example.com', baseEnv())
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

    const res = await callFetch('https://example.com/missing', baseEnv())
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('404')
  })

  it('returns 502 when fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))

    const res = await callFetch('https://nonexistent.example.com', baseEnv())
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('ENOTFOUND')
  })
})
