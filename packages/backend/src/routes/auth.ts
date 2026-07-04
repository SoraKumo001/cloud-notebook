import { zValidator } from '@hono/zod-validator'
import { eq, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../auth'
import { users } from '../db/schema'
import { ErrorCode, errorResponse } from '../errors'
import {
  consumeInvitation,
  createInvitation,
  findValidInvitation,
  listInvitations,
  revokeInvitation,
} from '../invitations'
import { hashPassword, verifyPassword } from '../password'
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  deleteSession,
  parseSessionCookie,
  SESSION_COOKIE_NAME,
} from '../session'
import type { AppEnv } from '../types'
import { vHook } from './common'

const router = new Hono<AppEnv>()

function cookieSecure(c: Context): boolean {
  const url = new URL(c.req.url)
  return url.protocol === 'https:'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Return the authenticated user's profile
router.get('/me', (c) => {
  const user = c.get('user')
  return c.json(user)
})

// Register
router.post(
  '/auth/register',
  zValidator(
    'json',
    z.object({
      email: z
        .string()
        .min(3)
        .max(200)
        .refine((s) => EMAIL_RE.test(s), 'Invalid email'),
      password: z.string().min(8).max(200),
      name: z.string().min(1).max(100).optional(),
      inviteToken: z.string().min(8).max(200).optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { email, password, name, inviteToken } = c.req.valid('json')
    const db = c.get('db')
    const normalizedEmail = email.toLowerCase().trim()

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
    if (existing) {
      return errorResponse(c, ErrorCode.AuthEmailRegistered, 'Email already registered', 409)
    }

    const [{ count }] = (await db
      .select({ count: sql<number>`count(*)` })
      .from(users)) as unknown as Array<{ count: number }>
    const isFirstUser = Number(count) === 0

    if (!isFirstUser) {
      if (!inviteToken) {
        return errorResponse(
          c,
          ErrorCode.AuthInviteRequired,
          'Invite token required. Ask an admin to invite you.',
          403,
        )
      }
      const invitation = await findValidInvitation(db, inviteToken, normalizedEmail)
      if (!invitation) {
        return errorResponse(c, ErrorCode.AuthInviteInvalid, 'Invalid or expired invite token', 403)
      }

      const passwordHash = await hashPassword(password)
      const userId = crypto.randomUUID()
      await db.insert(users).values({
        id: userId,
        email: normalizedEmail,
        passwordHash,
        name: name?.trim() || null,
        isAdmin: false,
      })
      await consumeInvitation(db, invitation.id, userId)

      const secret = c.env.SESSION_SECRET
      if (!secret) {
        return errorResponse(c, ErrorCode.ServerConfigError, 'SESSION_SECRET not configured', 500)
      }
      const { id: sessionId } = await createSession(db, userId)
      const cookie = await buildSessionCookie(sessionId, secret, cookieSecure(c))
      const headers: Record<string, string> = { 'Set-Cookie': cookie }
      return c.json(
        { id: userId, email: normalizedEmail, name: name?.trim() || null, isAdmin: false },
        201,
        headers,
      )
    }

    const passwordHash = await hashPassword(password)
    const userId = crypto.randomUUID()
    await db.insert(users).values({
      id: userId,
      email: normalizedEmail,
      passwordHash,
      name: name?.trim() || null,
      isAdmin: true,
    })

    const secret = c.env.SESSION_SECRET
    if (!secret) {
      return errorResponse(c, ErrorCode.ServerConfigError, 'SESSION_SECRET not configured', 500)
    }
    const { id: sessionId } = await createSession(db, userId)
    const cookie = await buildSessionCookie(sessionId, secret, cookieSecure(c))
    const headers: Record<string, string> = { 'Set-Cookie': cookie }
    return c.json(
      { id: userId, email: normalizedEmail, name: name?.trim() || null, isAdmin: true },
      201,
      headers,
    )
  },
)

// Login
router.post(
  '/auth/login',
  zValidator(
    'json',
    z.object({
      email: z.string().min(3).max(200),
      password: z.string().min(1).max(200),
    }),
    vHook,
  ),
  async (c) => {
    const { email, password } = c.req.valid('json')
    const db = c.get('db')
    const normalizedEmail = email.toLowerCase().trim()

    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)
    if (!user) {
      return errorResponse(c, ErrorCode.AuthInvalidCredentials, 'Invalid email or password', 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return errorResponse(c, ErrorCode.AuthInvalidCredentials, 'Invalid email or password', 401)
    }

    const secret = c.env.SESSION_SECRET
    if (!secret) {
      return errorResponse(c, ErrorCode.ServerConfigError, 'SESSION_SECRET not configured', 500)
    }
    const { id: sessionId } = await createSession(db, user.id)
    const cookie = await buildSessionCookie(sessionId, secret, cookieSecure(c))
    const headers: Record<string, string> = { 'Set-Cookie': cookie }
    return c.json(
      { id: user.id, email: user.email, name: user.name ?? null, isAdmin: user.isAdmin },
      200,
      headers,
    )
  },
)

// Logout
router.post('/auth/logout', async (c) => {
  const db = c.get('db')
  const rawCookie = c.req.header('Cookie')
  if (rawCookie) {
    const match = rawCookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`))
    if (match) {
      const parsed = parseSessionCookie(match.slice(SESSION_COOKIE_NAME.length + 1))
      if (parsed) {
        await deleteSession(db, parsed.sessionId).catch(() => {
          // Best-effort: a stale cookie is still cleared client-side.
        })
      }
    }
  }
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(cookieSecure(c)) },
  })
})

// List invitations (admin only)
router.get('/auth/invitations', requireAdmin, async (c) => {
  const db = c.get('db')
  const rows = await listInvitations(db)
  const now = Date.now()
  return c.json(
    rows.map((r) => ({
      ...r,
      active: !r.usedAt && new Date(r.expiresAt).getTime() > now,
    })),
  )
})

// Create invitation (admin only)
router.post(
  '/auth/invitations',
  requireAdmin,
  zValidator(
    'json',
    z.object({
      email: z
        .string()
        .min(3)
        .max(200)
        .refine((s) => EMAIL_RE.test(s), 'Invalid email'),
    }),
    vHook,
  ),
  async (c) => {
    const { email } = c.req.valid('json')
    const db = c.get('db')
    const user = c.get('user')

    const normalizedEmail = email.toLowerCase().trim()
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
    if (existing) {
      return errorResponse(c, ErrorCode.AuthEmailRegistered, 'Email is already registered', 409)
    }

    const invitation = await createInvitation(db, user.id, normalizedEmail)
    return c.json(invitation, 201)
  },
)

// Revoke invitation (admin only)
router.delete('/auth/invitations/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  if (!id) {
    return errorResponse(c, ErrorCode.ValidationFailed, 'Invitation id required', 400)
  }
  const db = c.get('db')
  const removed = await revokeInvitation(db, id)
  if (!removed) {
    return errorResponse(
      c,
      ErrorCode.InvitationNotFound,
      'Invitation not found or already used',
      404,
    )
  }
  return new Response(null, { status: 204 })
})

export default router
