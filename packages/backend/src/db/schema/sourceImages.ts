import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { notebooks } from './notebooks'
import { sources } from './sources'

export const sourceImages = sqliteTable(
  'source_images',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    pageNumber: integer('page_number'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    index('idx_source_images_source').on(t.sourceId),
    index('idx_source_images_notebook').on(t.notebookId),
  ],
)

export type SourceImage = typeof sourceImages.$inferSelect
export type NewSourceImage = typeof sourceImages.$inferInsert
