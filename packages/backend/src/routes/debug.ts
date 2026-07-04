import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { ErrorCode, errorResponse } from '../errors'
import type { AppEnv } from '../types'
import { vHook } from './common'

const router = new Hono<AppEnv>()

router.get('/debug/health', async (c) => {
  const results: Record<string, { status: 'ok' | 'error'; message?: string }> = {}

  // 1. D1 Database Check
  try {
    const db = c.get('db')
    await db.select({ val: sql`1` })
    results.d1 = { status: 'ok' }
  } catch (err: unknown) {
    results.d1 = { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  // 2. R2 Bucket Check
  try {
    const storage = c.get('storage')
    await storage.healthCheck()
    results.r2 = { status: 'ok' }
  } catch (err: unknown) {
    results.r2 = { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  // 3. Vectorize Check
  try {
    await c.env.VECTORIZE.query(
      Array.from({ length: 1024 }, () => 0.1),
      {
        topK: 1,
      },
    )
    results.vectorize = { status: 'ok' }
  } catch (err: unknown) {
    results.vectorize = {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  // 4. Workers AI Check
  try {
    const aiRes = (await c.env.AI.run('@cf/baai/bge-large-en-v1.5', { text: ['test'] })) as any
    if (aiRes?.data) {
      results.ai = { status: 'ok' }
    } else {
      results.ai = { status: 'error', message: 'No output data returned' }
    }
  } catch (err: unknown) {
    results.ai = { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  const overallStatus = Object.values(results).every((r) => r.status === 'ok')
    ? 'healthy'
    : 'degraded'
  return c.json({ status: overallStatus, diagnostics: results })
})

// ---- Webpage fetch proxy -----------------------------------------------------

const PRIVATE_ORIGINS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.1[6-9]\./,
  /^https?:\/\/172\.2[0-9]\./,
  /^https?:\/\/172\.3[0-1]\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/(?:0:)?0:0:0:0:0:0:1/i,
]

function isValidFetchUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const href = url.href
  if (PRIVATE_ORIGINS.some((re) => re.test(href))) return null
  url.hash = ''
  return url.href
}

router.get('/fetch', zValidator('query', z.object({ url: z.string().url() }), vHook), async (c) => {
  const { url: rawUrl } = c.req.valid('query')

  const safeUrl = isValidFetchUrl(rawUrl)
  if (!safeUrl) {
    return errorResponse(c, ErrorCode.RequestInvalidUrl, 'Invalid or disallowed URL', 400)
  }

  try {
    const response = await fetch(safeUrl)
    if (!response.ok) {
      return errorResponse(
        c,
        ErrorCode.ProxyUpstreamError,
        `Upstream returned ${response.status} ${response.statusText}`,
        502,
      )
    }
    const html = await response.text()
    return c.newResponse(html, 200, { 'Content-Type': 'text/html; charset=utf-8' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(c, ErrorCode.ProxyUpstreamError, `Failed to fetch URL: ${message}`, 502)
  }
})

export default router
