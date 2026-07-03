import { Hono } from 'hono'
import { authMiddleware } from './auth'
import { createDb } from './db/client'
import { ErrorCode, errorResponse } from './errors'
import { mcpApp } from './mcp'
import { dbMiddleware } from './middleware/db'
import { storageMiddleware } from './middleware/storage'
import authRouter from './routes/auth'
import chatRouter from './routes/chat'
// Import router modules
import type { Bindings, Variables } from './routes/common'
import connectionsRouter from './routes/connections'
import debugRouter from './routes/debug'
import notebooksRouter from './routes/notebooks'
import notesRouter from './routes/notes'
import settingsRouter from './routes/settings'
import sourcesRouter from './routes/sources'
import { getObjectStorage } from './storage/factory'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Security headers — applied to all responses
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

// Auth middleware — validates Cloudflare Access JWT or returns dev user
app.use('/api/*', authMiddleware)

// DB middleware — creates drizzle instance from D1 binding
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('/api/*', dbMiddleware() as any)

// Storage middleware — resolves the active ObjectStorage adapter and
// attaches it as c.get('storage'). Must come after dbMiddleware.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('/api/*', storageMiddleware() as any)

app.onError((err, c) => {
  console.error('[SERVER ERROR]:', err)
  const isDev = c.env.NODE_ENV === 'development'
  return errorResponse(
    c,
    ErrorCode.ServerInternalError,
    isDev ? err.message || 'Internal Server Error' : 'Internal Server Error',
    500,
    isDev ? { stack: err.stack } : undefined,
  )
})

// MCP server — mounted outside authMiddleware (has its own Bearer-token auth)
app.route('/mcp', mcpApp)

// Mount modular routers
app.route('/api/notebooks', notebooksRouter)
app.route('/api', sourcesRouter)
app.route('/api', notesRouter)
app.route('/api', chatRouter)
app.route('/api', authRouter)
app.route('/api', connectionsRouter)
app.route('/api', settingsRouter)
app.route('/api', debugRouter)

// Local development R2 upload proxy (mounted outside /api/* to bypass authMiddleware)
const LOCAL_UPLOADS_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
} as const

app.options('/local-uploads', (c) => {
  for (const [k, v] of Object.entries(LOCAL_UPLOADS_CORS_HEADERS)) {
    c.header(k, v)
  }
  return c.newResponse(null, 204)
})

app.put('/local-uploads', async (c) => {
  if (c.env.NODE_ENV !== 'development') {
    return errorResponse(c, ErrorCode.StorageForbiddenInProduction, 'Forbidden in production', 403)
  }

  const key = c.req.query('key')
  if (!key)
    return errorResponse(c, ErrorCode.ValidationFailed, 'key query parameter is required', 400)

  const contentType = c.req.header('content-type')
  const body = await c.req.arrayBuffer()

  const db = createDb(c.env.DB)
  const storage = await getObjectStorage(c.env, db)
  await storage.put(key, body, contentType ?? undefined)

  for (const [k, v] of Object.entries(LOCAL_UPLOADS_CORS_HEADERS)) {
    c.header(k, v)
  }
  return c.text('OK')
})

export default app
