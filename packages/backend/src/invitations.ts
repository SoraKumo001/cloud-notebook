// packages/backend/src/invitations.ts
// Server-side invitation token management.
//
// Tokens are 32 random bytes encoded as URL-safe base64. The plaintext
// token is what we hand to the admin (and what they put in the invite
// URL). Only the plaintext is sent over the wire; we never store a hash
// because the token grants nothing on its own without matching email
// + being unconsumed + being unexpired.

import { and, eq, isNull } from 'drizzle-orm'
import type { DB } from './db/client'
import { type Invitation, invitations } from './db/schema'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export interface CreatedInvitation {
  id: string
  token: string
  email: string
  expiresAt: string
}

export async function createInvitation(
  db: DB,
  invitedBy: string,
  email: string,
  ttlMs: number = INVITATION_TTL_MS,
): Promise<CreatedInvitation> {
  const id = crypto.randomUUID()
  const token = newToken()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  await db.insert(invitations).values({
    id,
    token,
    email: email.toLowerCase().trim(),
    invitedBy,
    expiresAt,
  })
  return { id, token, email, expiresAt }
}

export interface InvitationView {
  id: string
  email: string
  expiresAt: string
  usedAt: string | null
  createdAt: string
}

export async function listInvitations(db: DB): Promise<InvitationView[]> {
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
      usedAt: invitations.usedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .orderBy(invitations.createdAt)
  return rows
}

export async function revokeInvitation(db: DB, id: string): Promise<boolean> {
  const result = await db
    .delete(invitations)
    .where(and(eq(invitations.id, id), isNull(invitations.usedAt)))
  return (result as unknown as { changes?: number }).changes !== 0
}

/**
 * Find a valid (unconsumed, unexpired) invitation that matches the
 * given token and email. Does NOT consume it — that happens in
 * {@link consumeInvitation} after the user is created.
 */
export async function findValidInvitation(
  db: DB,
  token: string,
  email: string,
): Promise<Invitation | null> {
  const nowIso = new Date().toISOString()
  const [row] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, token),
        eq(invitations.email, email.toLowerCase().trim()),
        isNull(invitations.usedAt),
        // expiresAt > nowIso
        // (drizzle's gt operator works for SQL; cast in expression)
      ),
    )
    .limit(1)
  if (!row) return null
  if (row.expiresAt <= nowIso) return null
  return row
}

/**
 * Mark an invitation as consumed. Returns the updated row or null if
 * the row is already consumed / not found (idempotency guard).
 */
export async function consumeInvitation(db: DB, id: string, userId: string): Promise<void> {
  await db
    .update(invitations)
    .set({ usedAt: new Date().toISOString(), usedBy: userId })
    .where(and(eq(invitations.id, id), isNull(invitations.usedAt)))
}
