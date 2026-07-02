// packages/backend/src/auth.test.ts
// Tests for email + password authentication and session-cookie auth middleware.
//
// Replaces the previous Cloudflare Access JWT tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authMiddleware, getAuthContext } from './auth'
import app from './index'
import { hashPassword, verifyPassword } from './password'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const TEST_SESSION_SECRET = 'test-secret-please-do-not-use-in-prod-32+chars-long'

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// password
// ---------------------------------------------------------------------------

describe('password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    // Cloudflare Workers caps PBKDF2 iterations at 100_000.
    expect(hash.startsWith('100000:')).toBe(true)
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('returns false for malformed stored hash', async () => {
    expect(await verifyPassword('whatever', 'not-a-valid-hash')).toBe(false)
  })

  it('returns false for hash with invalid base64', async () => {
    expect(await verifyPassword('whatever', '100000:!!!:@@@')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getAuthContext
// ---------------------------------------------------------------------------

describe('getAuthContext', () => {
  it('returns dev user when NODE_ENV=development', async () => {
    const c = {
      env: { NODE_ENV: 'development' },
      req: { header: vi.fn() },
    } as any

    const user = await getAuthContext(c)
    expect(user.id).toBe('dev-user')
    expect(user.email).toBe('dev@example.com')
  })

  it('returns dev user when CF_DEV_BYPASS_AUTH=1', async () => {
    const c = {
      env: { CF_DEV_BYPASS_AUTH: '1' },
      req: { header: vi.fn() },
    } as any

    const user = await getAuthContext(c)
    expect(user.id).toBe('dev-user')
  })

  it('throws when SESSION_SECRET is not set in prod', async () => {
    const c = {
      env: {},
      req: { header: vi.fn() },
    } as any

    await expect(getAuthContext(c)).rejects.toThrow('SESSION_SECRET not configured')
  })

  it('throws when cookie is missing in prod', async () => {
    const c = {
      env: { SESSION_SECRET: TEST_SESSION_SECRET },
      req: { header: vi.fn().mockReturnValue(null) },
    } as any

    await expect(getAuthContext(c)).rejects.toThrow('Missing authentication token')
  })

  it('throws when no session cookie present', async () => {
    const c = {
      env: { SESSION_SECRET: TEST_SESSION_SECRET },
      req: { header: vi.fn().mockReturnValue('foo=bar; baz=qux') },
    } as any

    await expect(getAuthContext(c)).rejects.toThrow('Missing authentication token')
  })
})

// ---------------------------------------------------------------------------
// authMiddleware
// ---------------------------------------------------------------------------

describe('authMiddleware', () => {
  it('sets user on context and calls next in dev mode', async () => {
    const c = {
      env: { NODE_ENV: 'development' },
      req: { url: 'http://localhost/api/me', header: vi.fn() },
      set: vi.fn(),
    } as any
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await authMiddleware(c, next)
    expect(c.set).toHaveBeenCalledWith('user', {
      id: 'dev-user',
      email: 'dev@example.com',
      name: 'Dev User',
      isAdmin: true,
    })
    expect(nextCalled).toBe(true)
  })

  it('returns 401 JSON when auth fails', async () => {
    const c = {
      env: { SESSION_SECRET: TEST_SESSION_SECRET },
      req: { url: 'http://localhost/api/me', header: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockReturnValue('unauthorized-response'),
    } as any
    const next = vi.fn()

    const result = await authMiddleware(c, next)
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Missing authentication token', code: 'auth.unauthorized' },
      401,
    )
    expect(next).not.toHaveBeenCalled()
    expect(result).toBe('unauthorized-response')
  })

  it('bypasses auth for /api/auth/register', async () => {
    const c = {
      req: { url: 'http://localhost/api/auth/register' },
      env: {},
    } as any
    let nextCalled = false
    await authMiddleware(c, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })

  it('bypasses auth for /api/auth/login', async () => {
    const c = {
      req: { url: 'http://localhost/api/auth/login' },
      env: {},
    } as any
    let nextCalled = false
    await authMiddleware(c, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Integration: /api/me, /api/auth/register, /api/auth/login, /api/auth/logout
// ---------------------------------------------------------------------------

describe('GET /api/me (integration)', () => {
  it('returns dev user when NODE_ENV=development', async () => {
    const { env } = createTestEnv()
    const res = await app.fetch(new Request('http://localhost/api/me'), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe('dev-user')
  })

  it('returns 401 when no cookie in prod mode', async () => {
    const { env } = createTestEnv()
    // Switch off the default dev-bypass in createTestEnv.
    ;(env as Record<string, unknown>).NODE_ENV = 'production'
    ;(env as Record<string, unknown>).CF_ENV = undefined
    ;(env as Record<string, unknown>).CF_DEV_BYPASS_AUTH = undefined
    ;(env as Record<string, unknown>).SESSION_SECRET = TEST_SESSION_SECRET
    const res = await app.fetch(new Request('http://localhost/api/me'), env)
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('error')
  })
})

describe('POST /api/auth/register and /api/auth/login (integration)', () => {
  function buildEnv() {
    const { env } = createTestEnv()
    // createTestEnv sets NODE_ENV=development for the dev-bypass path; we want
    // the real session-cookie flow here.
    ;(env as Record<string, unknown>).NODE_ENV = 'production'
    ;(env as Record<string, unknown>).CF_ENV = undefined
    ;(env as Record<string, unknown>).CF_DEV_BYPASS_AUTH = undefined
    ;(env as Record<string, unknown>).SESSION_SECRET = TEST_SESSION_SECRET
    return env
  }

  it('registers a new user, then logs in successfully', async () => {
    const env = buildEnv()

    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Alice@Example.com',
          password: 'correct-horse-battery-staple',
          name: 'Alice',
        }),
      }),
      env,
    )
    expect(reg.status).toBe(201)
    const regBody = (await reg.json()) as Record<string, unknown>
    expect(regBody.email).toBe('alice@example.com')
    expect(regBody.name).toBe('Alice')

    const login = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'correct-horse-battery-staple',
        }),
      }),
      env,
    )
    expect(login.status).toBe(200)
    const setCookie = login.headers.get('Set-Cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toMatch(/^session=.*\..*;.*HttpOnly/s)
  })

  it('rejects registration with a short password', async () => {
    const env = buildEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bob@example.com', password: 'short' }),
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects duplicate email registration', async () => {
    const env = buildEnv()
    const body = JSON.stringify({ email: 'dup@example.com', password: 'long-enough-password' })
    await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      env,
    )
    const dup = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      env,
    )
    expect(dup.status).toBe(409)
  })

  it('rejects login with wrong password', async () => {
    const env = buildEnv()
    await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'eve@example.com', password: 'long-enough-password' }),
      }),
      env,
    )
    const login = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'eve@example.com', password: 'wrong-password' }),
      }),
      env,
    )
    expect(login.status).toBe(401)
  })

  it('rejects login with unknown email', async () => {
    const env = buildEnv()
    const login = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever' }),
      }),
      env,
    )
    expect(login.status).toBe(401)
  })

  it('accepts a valid session cookie on /api/me', async () => {
    const env = buildEnv()
    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'carol@example.com', password: 'long-enough-password' }),
      }),
      env,
    )
    const setCookie = reg.headers.get('Set-Cookie')
    expect(setCookie).toBeTruthy()

    const me = await app.fetch(
      new Request('http://localhost/api/me', { headers: { Cookie: setCookie as string } }),
      env,
    )
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as Record<string, unknown>
    expect(meBody.email).toBe('carol@example.com')
  })

  it('rejects a tampered session cookie', async () => {
    const env = buildEnv()
    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dave@example.com', password: 'long-enough-password' }),
      }),
      env,
    )
    const setCookie = reg.headers.get('Set-Cookie') as string
    // Mutate a byte inside the signature (not the trailing semicolon).
    // The cookie format is `session=<uuid>.<sig>; Path=/; ...`
    const eqIdx = setCookie.indexOf('=')
    const dotIdx = setCookie.indexOf('.', eqIdx + 1)
    const sigStart = dotIdx + 1
    const sigEnd = setCookie.indexOf(';', sigStart)
    const signature = setCookie.slice(sigStart, sigEnd)
    const flipped = signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`
    const tampered = `${setCookie.slice(0, sigStart)}${flipped}${setCookie.slice(sigEnd)}`
    const me = await app.fetch(
      new Request('http://localhost/api/me', { headers: { Cookie: tampered } }),
      env,
    )
    expect(me.status).toBe(401)
  })

  it('clears the session on /api/auth/logout', async () => {
    const env = buildEnv()
    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'frank@example.com', password: 'long-enough-password' }),
      }),
      env,
    )
    const setCookie = reg.headers.get('Set-Cookie') as string
    const logout = await app.fetch(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: setCookie },
      }),
      env,
    )
    expect(logout.status).toBe(204)
    const clear = logout.headers.get('Set-Cookie')
    expect(clear).toMatch(/session=;/)
  })
})

// ---------------------------------------------------------------------------
// Invitation-gated registration
// ---------------------------------------------------------------------------

describe('Invitation-gated registration (integration)', () => {
  // Single env reused across register → invite → second-register so the
  // underlying SQLite DB (in-memory) is shared.
  function sharedEnv() {
    const { env, db } = createTestEnv()
    ;(env as Record<string, unknown>).NODE_ENV = 'production'
    ;(env as Record<string, unknown>).CF_ENV = undefined
    ;(env as Record<string, unknown>).CF_DEV_BYPASS_AUTH = undefined
    ;(env as Record<string, unknown>).SESSION_SECRET = TEST_SESSION_SECRET
    return { env, db }
  }

  async function registerFirstUser(env: Record<string, unknown>, email: string) {
    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'long-enough-password' }),
      }),
      env,
    )
    expect(res.status).toBe(201)
    return { setCookie: res.headers.get('Set-Cookie') as string }
  }

  it('makes the first registered user an admin', async () => {
    const { env } = sharedEnv()
    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'long-enough-password' }),
      }),
      env,
    )
    const body = (await res.json()) as Record<string, unknown>
    expect(body.isAdmin).toBe(true)
  })

  it('rejects the second registration without an invite token', async () => {
    const { env } = sharedEnv()
    await registerFirstUser(env, 'admin@example.com')
    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'second@example.com', password: 'long-enough-password' }),
      }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('rejects an invite token bound to a different email', async () => {
    const { env } = sharedEnv()
    const { setCookie } = await registerFirstUser(env, 'admin@example.com')
    const issue = await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: setCookie },
        body: JSON.stringify({ email: 'intended@example.com' }),
      }),
      env,
    )
    const { token } = (await issue.json()) as { token: string }

    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'wrong@example.com',
          password: 'long-enough-password',
          inviteToken: token,
        }),
      }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('lets the second user register with a valid invite', async () => {
    const { env } = sharedEnv()
    const { setCookie } = await registerFirstUser(env, 'admin@example.com')
    const issue = await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: setCookie },
        body: JSON.stringify({ email: 'second@example.com' }),
      }),
      env,
    )
    const { token } = (await issue.json()) as { token: string }

    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'second@example.com',
          password: 'long-enough-password',
          inviteToken: token,
        }),
      }),
      env,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.isAdmin).toBe(false)
  })

  it('rejects an already-consumed invite token', async () => {
    const { env } = sharedEnv()
    const { setCookie } = await registerFirstUser(env, 'admin@example.com')
    const issue = await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: setCookie },
        body: JSON.stringify({ email: 'second@example.com' }),
      }),
      env,
    )
    const { token } = (await issue.json()) as { token: string }

    await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'second@example.com',
          password: 'long-enough-password',
          inviteToken: token,
        }),
      }),
      env,
    )
    const reused = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'third@example.com',
          password: 'long-enough-password',
          inviteToken: token,
        }),
      }),
      env,
    )
    expect(reused.status).toBe(403)
  })

  it('rejects invite-issuance from a non-admin', async () => {
    const { env } = sharedEnv()
    const { setCookie } = await registerFirstUser(env, 'admin@example.com')
    const issue = await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: setCookie },
        body: JSON.stringify({ email: 'second@example.com' }),
      }),
      env,
    )
    const { token } = (await issue.json()) as { token: string }

    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'second@example.com',
          password: 'long-enough-password',
          inviteToken: token,
        }),
      }),
      env,
    )
    const secondCookie = reg.headers.get('Set-Cookie') as string

    const forbid = await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: secondCookie },
        body: JSON.stringify({ email: 'third@example.com' }),
      }),
      env,
    )
    expect(forbid.status).toBe(403)
  })

  it('GET /api/auth/invitations returns issued invitations', async () => {
    const { env } = sharedEnv()
    const { setCookie } = await registerFirstUser(env, 'admin@example.com')
    await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: setCookie },
        body: JSON.stringify({ email: 'second@example.com' }),
      }),
      env,
    )
    const list = await app.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'GET',
        headers: { Cookie: setCookie },
      }),
      env,
    )
    expect(list.status).toBe(200)
    const body = (await list.json()) as Array<{ email: string; active: boolean }>
    expect(body).toHaveLength(1)
    expect(body[0].email).toBe('second@example.com')
    expect(body[0].active).toBe(true)
  })
})
