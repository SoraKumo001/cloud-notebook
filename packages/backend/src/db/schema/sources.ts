import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { notebooks } from './notebooks'

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    r2Key: text('r2_key'),
    hash: text('hash'),
    status: text('status').notNull(),
    url: text('url'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    index('idx_sources_notebook_display_order').on(t.notebookId, t.displayOrder),
    index('idx_sources_notebook_status').on(t.notebookId, t.status),
    index('idx_sources_notebook_hash').on(t.notebookId, t.hash),
  ],
)

export type Source = typeof sources.$inferSelect
export type NewSource = typeof sources.$inferInsert
