// packages/backend/src/session.ts
// Server-side session management with HMAC-signed cookies stored in D1.
//
// Cookie format: `session=<sessionId>.<sigB64>`
//   - sessionId: random UUID v4
//   - sig:       HMAC-SHA256(sessionId, SESSION_SECRET), base64
//
// The signed cookie is tamper-evident (signature fails) and stateless-looking,
// but the sessionId is also persisted in the D1 `sessions` table with an
// `expires_at` so we can revoke individual sessions and enforce expiration.

import { and, eq, gt } from 'drizzle-orm'
import type { DB } from './db/client'
import { sessions, type User, users } from './db/schema'

export const SESSION_COOKIE_NAME = 'session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const ENCODER = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signSessionId(sessionId: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(sessionId))
  return bytesToBase64(new Uint8Array(sig))
}

async function verifySignature(
  sessionId: string,
  sigB64: string,
  secret: string,
): Promise<boolean> {
  try {
    const key = await importHmacKey(secret)
    const sigBytes = base64ToBytes(sigB64)
    return crypto.subtle.verify('HMAC', key, sigBytes, ENCODER.encode(sessionId))
  } catch {
    return false
  }
}

/**
 * Parse a session cookie value (e.g. `<sid>.<sig>`).
 * Returns the sessionId, or null if the value is malformed.
 */
export function parseSessionCookie(
  raw: string | undefined,
): { sessionId: string; sig: string } | null {
  if (!raw) return null
  const [sessionId, sig] = raw.split('.')
  if (!sessionId || !sig) return null
  return { sessionId, sig }
}

/**
 * Build a `Set-Cookie` header value for the given session.
 * The signature is computed from the sessionId using SESSION_SECRET.
 */
export async function buildSessionCookie(
  sessionId: string,
  secret: string,
  secure: boolean,
): Promise<string> {
  const sig = await signSessionId(sessionId, secret)
  const value = `${sessionId}.${sig}`
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Build a `Set-Cookie` header that clears the session cookie.
 */
export function clearSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Create a new session row for the given user.
 */
export async function createSession(
  db: DB,
  userId: string,
): Promise<{ id: string; expiresAt: string }> {
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await db.insert(sessions).values({ id, userId, expiresAt })
  return { id, expiresAt }
}

/**
 * Delete a single session by id.
 */
export async function deleteSession(db: DB, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

/**
 * Validate a session cookie:
 *  1. Verify HMAC signature with SESSION_SECRET.
 *  2. Look up the session row in D1 (must exist and not be expired).
 *  3. Return the associated user, or null if any step fails.
 */
export async function validateSession(
  db: DB,
  rawCookie: string | undefined,
  secret: string,
): Promise<User | null> {
  const parsed = parseSessionCookie(rawCookie)
  if (!parsed) return null
  const ok = await verifySignature(parsed.sessionId, parsed.sig, secret)
  if (!ok) return null

  const nowIso = new Date().toISOString()
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, parsed.sessionId), gt(sessions.expiresAt, nowIso)))
    .limit(1)

  return row?.user ?? null
}
