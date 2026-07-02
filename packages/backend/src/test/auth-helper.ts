import type { Ai, D1Database, R2Bucket, VectorizeIndex } from '@cloudflare/workers-types'
import app from '../index'

export const TEST_SESSION_SECRET = 'test-secret-please-do-not-use-in-prod-32+chars-long'

export interface AuthedEnv {
  [key: string]: unknown
  DB: D1Database
  BUCKET?: R2Bucket
  VECTORIZE?: VectorizeIndex
  AI?: Ai
  SESSION_SECRET: string
  API_KEY_ENCRYPTION_MASTER: string
  __storage?: unknown
}

/**
 * Register + login a user, then return env and a Cookie value to attach to subsequent requests.
 *
 * The first user registered in a given env becomes admin automatically.
 * Subsequent users require an invite token issued by the admin.
 *
 * When `adminCookie` is provided, the helper issues an invite for the target email
 * before registering. This allows creating multiple users in the same env.
 *
 * @param env - The test environment (must contain DB, SESSION_SECRET, etc.)
 * @param options - Optional email/password for the new user, and adminCookie to issue invite
 */
export async function createAuthedRequest(
  env: AuthedEnv,
  options?: { email?: string; password?: string; adminCookie?: string },
): Promise<{ cookie: string; userId: string }> {
  const email =
    options?.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = options?.password ?? 'long-enough-test-password-123'

  // If adminCookie is provided, issue an invite token first
  let inviteToken: string | undefined
  if (options?.adminCookie) {
    const issue = await app.fetch(
      authedRequest('http://localhost/api/auth/invitations', options.adminCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
      env,
    )
    if (issue.status !== 201) {
      const body = await issue.text()
      throw new Error(`invite issuance failed: ${issue.status} ${body}`)
    }
    const { token } = (await issue.json()) as { token: string }
    inviteToken = token
  }

  // Register the user (first user succeeds directly; subsequent users need inviteToken)
  const regBody = inviteToken
    ? await registerWithInvite(env, email, password, inviteToken)
    : await registerDirect(env, email, password)

  // Re-login to obtain a session cookie
  const login = await app.fetch(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    env,
  )
  if (login.status !== 200) {
    const body = await login.text()
    throw new Error(`login failed: ${login.status} ${body}`)
  }

  const setCookie = login.headers.get('Set-Cookie')
  if (!setCookie) {
    throw new Error('login did not return Set-Cookie')
  }

  // Extract session=...; value
  const m = setCookie.match(/session=([^;]+)/)
  if (!m) {
    throw new Error(`Set-Cookie missing session value: ${setCookie}`)
  }

  return { cookie: `session=${m[1]}`, userId: regBody.id }
}

async function registerDirect(
  env: AuthedEnv,
  email: string,
  password: string,
): Promise<{ id: string }> {
  const reg = await app.fetch(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Test User' }),
    }),
    env,
  )
  if (reg.status !== 201) {
    const body = await reg.text()
    throw new Error(`register failed: ${reg.status} ${body}`)
  }
  return (await reg.json()) as { id: string }
}

async function registerWithInvite(
  env: AuthedEnv,
  email: string,
  password: string,
  inviteToken: string,
): Promise<{ id: string }> {
  const reg = await app.fetch(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Test User', inviteToken }),
    }),
    env,
  )
  if (reg.status !== 201) {
    const body = await reg.text()
    throw new Error(`register with invite failed: ${reg.status} ${body}`)
  }
  return (await reg.json()) as { id: string }
}

/**
 * Build a Request with the auth cookie attached.
 */
export function authedRequest(url: string, cookie: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set('Cookie', cookie)
  return new Request(url, { ...init, headers })
}
