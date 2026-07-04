import { sql } from 'drizzle-orm'
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    aiProvider: text('ai_provider'),
    aiApiKey: text('ai_api_key'),
    aiBaseUrl: text('ai_base_url'),
    aiEmbeddingModel: text('ai_embedding_model'),
    modelChat: text('model_chat'),
    modelSummarization: text('model_summarization'),
    modelOcr: text('model_ocr'),
    systemPrompt: text('system_prompt'),
    mcpToken: text('mcp_token'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [uniqueIndex('idx_notebooks_mcp_token').on(t.mcpToken).where(sql`mcp_token IS NOT NULL`)],
)

export type Notebook = typeof notebooks.$inferSelect
export type NewNotebook = typeof notebooks.$inferInsert
