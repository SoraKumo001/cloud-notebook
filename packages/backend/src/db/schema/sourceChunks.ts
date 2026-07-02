import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { notebooks } from './notebooks'
import { sources } from './sources'

export const sourceChunks = sqliteTable(
  'source_chunks',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    pageNumber: integer('page_number'),
  },
  (t) => [
    index('idx_source_chunks_source').on(t.sourceId),
    index('idx_source_chunks_notebook').on(t.notebookId),
  ],
)

export type SourceChunk = typeof sourceChunks.$inferSelect
export type NewSourceChunk = typeof sourceChunks.$inferInsert
