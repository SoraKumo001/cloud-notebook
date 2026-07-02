import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    // First registered user becomes admin automatically. Subsequent admins
    // must be promoted by an existing admin (out of band, e.g. via wrangler
    // d1 execute or a future admin API). 0/1 in SQLite is mapped to false/true.
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [uniqueIndex('idx_users_email').on(t.email)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
