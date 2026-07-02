import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

/**
 * One-time invitation tokens. Created by an admin via
 * POST /api/auth/invitations; consumed by /api/auth/register when a new
 * user signs up. Revoked tokens are kept (used_at IS NULL) but can never
 * be reused.
 */
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  // 32-byte base64url token used in the invite URL.
  token: text('token').notNull().unique(),
  // Email the invite is bound to (case-insensitive match at consume time).
  email: text('email').notNull(),
  invitedBy: text('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  // Set when the invitation is consumed by a successful /api/auth/register.
  usedAt: text('used_at'),
  usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
})

export type Invitation = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert
