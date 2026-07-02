import { eq } from 'drizzle-orm'
import { getDecryptedApiKey } from '../crypto'
import type { DB } from './client'
import { aiConnections } from './schema/aiConnections'
import { userSettings } from './schema/userSettings'

export interface TaskConfig {
  provider: string
  apiKey: string | null
  baseUrl: string | null
  model: string
}

export interface AiConfig {
  embedding: TaskConfig
  chat: TaskConfig
  summarization: TaskConfig
}

async function resolveTaskConfig(
  db: DB,
  userId: string,
  masterKey: string | undefined,
  modelString: string | null | undefined,
  defaultProvider: string,
  defaultModel: string,
): Promise<TaskConfig> {
  if (modelString?.includes(':')) {
    const parts = modelString.split(':')
    const connectionId = parts[0]
    const model = parts.slice(1).join(':')

    if (connectionId === 'workers-ai') {
      return {
        provider: 'workers-ai',
        apiKey: null,
        baseUrl: null,
        model,
      }
    }

    const [conn] = await db
      .select()
      .from(aiConnections)
      .where(eq(aiConnections.id, connectionId))
      .limit(1)

    if (conn && conn.userId === userId) {
      const apiKey = await getDecryptedApiKey(masterKey, conn.apiKey)
      return {
        provider: conn.provider,
        apiKey,
        baseUrl: conn.baseUrl,
        model,
      }
    }
  }

  // Fallback to legacy single-provider/Workers AI model
  return {
    provider: defaultProvider,
    apiKey: null,
    baseUrl: null,
    model: modelString || defaultModel,
  }
}

/**
 * Resolves the effective AI config for a notebook, falling back to global user settings
 * and then to system defaults.
 */
export async function getEffectiveAiConfig(
  db: DB,
  userId: string,
  masterKey: string | undefined,
  nb: {
    aiEmbeddingModel?: string | null
    modelChat?: string | null
    modelSummarization?: string | null
  },
): Promise<AiConfig> {
  // 1. Fetch Global Settings
  const [globalSettings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)

  // 2. Resolve embedding model
  const effectiveEmbeddingStr =
    nb.aiEmbeddingModel !== undefined && nb.aiEmbeddingModel !== null
      ? nb.aiEmbeddingModel
      : globalSettings?.aiEmbeddingModel || 'workers-ai:@cf/baai/bge-large-en-v1.5'

  const embedding = await resolveTaskConfig(
    db,
    userId,
    masterKey,
    effectiveEmbeddingStr,
    'workers-ai',
    '@cf/baai/bge-large-en-v1.5',
  )

  // 3. Resolve chat model
  const effectiveChatStr =
    nb.modelChat !== undefined && nb.modelChat !== null
      ? nb.modelChat
      : globalSettings?.modelChat || 'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast'

  const chat = await resolveTaskConfig(
    db,
    userId,
    masterKey,
    effectiveChatStr,
    'workers-ai',
    '@cf/meta/llama-3.1-8b-instruct-fast',
  )

  // 4. Resolve summarization model
  const effectiveSummarizationStr =
    nb.modelSummarization !== undefined && nb.modelSummarization !== null
      ? nb.modelSummarization
      : globalSettings?.modelSummarization || 'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast'

  const summarization = await resolveTaskConfig(
    db,
    userId,
    masterKey,
    effectiveSummarizationStr,
    'workers-ai',
    '@cf/meta/llama-3.1-8b-instruct-fast',
  )

  return {
    embedding,
    chat,
    summarization,
  }
}
