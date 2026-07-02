import { sql } from 'drizzle-orm'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { notebooks } from './notebooks'

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index('idx_notes_notebook_created').on(t.notebookId, t.createdAt)],
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
