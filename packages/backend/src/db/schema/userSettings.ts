import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  aiProvider: text('ai_provider'),
  aiApiKey: text('ai_api_key'), // Encrypted AES-GCM ciphertext
  aiBaseUrl: text('ai_base_url'),
  aiEmbeddingModel: text('ai_embedding_model').notNull().default('@cf/baai/bge-large-en-v1.5'),
  modelChat: text('model_chat').notNull().default('@cf/meta/llama-3.1-8b-instruct-fast'),
  modelSummarization: text('model_summarization')
    .notNull()
    .default('@cf/meta/llama-3.1-8b-instruct-fast'),
  modelOcr: text('model_ocr').notNull().default('@cf/meta/llama-3.2-11b-vision-instruct'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
})

export type UserSettings = typeof userSettings.$inferSelect
export type NewUserSettings = typeof userSettings.$inferInsert
