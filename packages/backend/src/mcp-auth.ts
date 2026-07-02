// packages/backend/src/mcp-auth.ts
// Bearer-token authentication middleware for the /mcp endpoint.

import { eq } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { createDb } from './db/client'
import { notebooks } from './db/schema'
import { ErrorCode } from './errors'

export interface McpNotebook {
  id: string
  userId: string
  title: string
}

/**
 * Hono middleware that authenticates MCP requests via `Authorization: Bearer <token>`.
 *
 * Looks up the token in `notebooks.mcp_token` (indexed) and injects
 * the notebook identity into `c.get('notebook')`.
 */
export async function mcpAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      {
        error: 'Missing or invalid Authorization header. Use: Authorization: Bearer <token>',
        code: ErrorCode.AuthTokenMissing,
      },
      401,
      { 'WWW-Authenticate': 'Bearer' } as Record<string, string>,
    )
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return c.json({ error: 'Token is empty', code: ErrorCode.AuthTokenMissing }, 401, {
      'WWW-Authenticate': 'Bearer',
    } as Record<string, string>)
  }

  const db = createDb(c.env.DB)
  const [notebook] = await db
    .select({
      id: notebooks.id,
      user_id: notebooks.userId,
      title: notebooks.title,
    })
    .from(notebooks)
    .where(eq(notebooks.mcpToken, token))
    .limit(1)

  if (!notebook) {
    return c.json({ error: 'Invalid token', code: ErrorCode.AuthTokenInvalid }, 401, {
      'WWW-Authenticate': 'Bearer',
    } as Record<string, string>)
  }

  c.set('notebook', { id: notebook.id, userId: notebook.user_id, title: notebook.title })
  await next()
}
