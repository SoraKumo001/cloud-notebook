import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const aiConnections = sqliteTable('ai_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  provider: text('provider').notNull(), // 'workers-ai' | 'openai' | 'anthropic' | 'google' | 'custom'
  apiKey: text('api_key'), // Encrypted AES-GCM ciphertext
  baseUrl: text('base_url'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
})

export type AiConnection = typeof aiConnections.$inferSelect
export type NewAiConnection = typeof aiConnections.$inferInsert
