// packages/backend/src/auth.ts
// Email + password authentication with HMAC-signed session cookies.
//
// Replaces the previous Cloudflare Access JWT verification.
//
// Design:
//   getAuthContext  — extracts user from the signed session cookie, or returns
//                     a dummy user in dev mode (bypass).
//   authMiddleware   — Hono middleware that sets c.get('user') on /api/* routes.

import type { Context, Next } from 'hono'
import { createDb } from './db/client'
import { ErrorCode, errorResponse } from './errors'
import { SESSION_COOKIE_NAME, validateSession } from './session'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  name?: string
  isAdmin: boolean
}

interface AuthEnv {
  NODE_ENV?: string
  CF_ENV?: string
  CF_DEV_BYPASS_AUTH?: string
  SESSION_SECRET?: string
}

// ---------------------------------------------------------------------------
// Dev bypass
// ---------------------------------------------------------------------------

const DEV_USER: AuthUser = {
  id: 'dev-user',
  email: 'dev@example.com',
  name: 'Dev User',
  isAdmin: true,
}

function isDevBypass(env: AuthEnv): boolean {
  return (
    env.CF_DEV_BYPASS_AUTH === '1' ||
    env.CF_DEV_BYPASS_AUTH === 'true' ||
    env.NODE_ENV === 'development' ||
    env.CF_ENV === 'development'
  )
}

// ---------------------------------------------------------------------------
// Auth context extraction
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated user from the request context.
 *
 * - Dev bypass: returns a dummy user without checking any header.
 * - Production: reads the `session` cookie, verifies the HMAC signature,
 *   looks the session up in D1, and returns the decoded user identity.
 *
 * @throws  If the cookie is missing/invalid, the secret is not configured, or
 *          the session has expired.
 */
export async function getAuthContext(c: Context): Promise<AuthUser> {
  const env = c.env as AuthEnv

  if (isDevBypass(env)) {
    return DEV_USER
  }

  const secret = env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET not configured')
  }

  const rawCookie = c.req.header('Cookie')
  if (!rawCookie) {
    throw new Error('Missing authentication token')
  }

  // Extract just the session cookie value (Cookie header is "key=val; key=val; …")
  const match = rawCookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!match) {
    throw new Error('Missing authentication token')
  }
  const cookieValue = match.slice(SESSION_COOKIE_NAME.length + 1)

  const db = createDb(c.env.DB)
  const user = await validateSession(db, cookieValue, secret)
  if (!user) {
    throw new Error('Invalid or expired session')
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    isAdmin: user.isAdmin,
  }
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

/**
 * Hono middleware that injects `c.get('user')` for all downstream handlers.
 *
 * Bypasses authentication for `/api/auth/register` and `/api/auth/login` so
 * unauthenticated callers can create a session. The logout endpoint is
 * intentionally behind the middleware (it tolerates a missing/invalid cookie
 * and clears it server-side).
 *
 * On failure an `{ error: string }` JSON body with status 401 is returned.
 */
export async function authMiddleware(c: Context, next: Next) {
  const path = new URL(c.req.url).pathname
  if (path === '/api/auth/register' || path === '/api/auth/login') {
    await next()
    return
  }
  try {
    const user = await getAuthContext(c)
    c.set('user', user)
    await next()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Authentication failed'
    return errorResponse(c, ErrorCode.AuthUnauthorized, message, 401)
  }
}

/**
 * Middleware that 403s any request whose `c.get('user').isAdmin` is not true.
 * Must run AFTER `authMiddleware` so `user` is populated.
 */
export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user') as AuthUser | undefined
  if (!user?.isAdmin) {
    return errorResponse(c, ErrorCode.AuthForbidden, 'Admin only', 403)
  }
  await next()
}
