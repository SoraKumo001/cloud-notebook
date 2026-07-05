// packages/backend/src/providers/index.ts
// AI provider abstraction layer — factory functions and re-exports.
//
// Consumers import from '../providers' (directory resolution picks up index.ts).

import modelsConfig from '../../models.json'
import { AnthropicChatProvider, AnthropicOcrProvider, AnthropicScriptProvider } from './anthropic'
import type { NotebookAiConfig } from './base'
import {
  buildOpenAiUrl,
  type ChatProvider,
  type EmbedProvider,
  type OcrProvider,
  type ProviderEnv,
  type ScriptProvider,
} from './base'
import { GoogleChatProvider, GoogleOcrProvider, GoogleScriptProvider } from './google'
import { OpenAIChatProvider, OpenAIOcrProvider, OpenAIScriptProvider } from './openai'
import {
  WorkersAIChatProvider,
  WorkersAIEmbedProvider,
  WorkersAIScriptProvider,
  WorkersAiOcrProvider,
} from './workers-ai'

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function getChatProvider(env: ProviderEnv, notebook: NotebookAiConfig): ChatProvider {
  switch (notebook.ai_provider) {
    case 'workers-ai':
      return new WorkersAIChatProvider(env)
    case 'openai':
      return new OpenAIChatProvider(env, notebook)
    case 'anthropic':
      return new AnthropicChatProvider(env, notebook)
    case 'google':
      return new GoogleChatProvider(env, notebook)
    default:
      throw new Error(`Unknown chat provider: ${notebook.ai_provider}`)
  }
}

export function getEmbedProvider(env: ProviderEnv, notebook: NotebookAiConfig): EmbedProvider {
  switch (notebook.ai_provider) {
    case 'workers-ai':
      return new WorkersAIEmbedProvider(env)
    case 'anthropic':
      throw new Error('Anthropic does not provide embedding APIs. Use Workers AI (bge-m3) instead.')
    case 'openai':
      throw new Error(
        'OpenAI embedding is not supported: the Vectorize index is 1024-dim, but OpenAI text-embedding-3-small produces 1536-dim vectors. ' +
          'Provision a dedicated 1536-dim Vectorize index or use Workers AI (bge-m3).',
      )
    case 'google':
      throw new Error(
        'Google embedding is not supported: the Vectorize index is 1024-dim, but Google text-embedding-004 produces 768-dim vectors. ' +
          'Provision a dedicated 768-dim Vectorize index or use Workers AI (bge-m3).',
      )
    default:
      throw new Error(
        `Unknown embedding provider: ${notebook.ai_provider}. Supported: 'workers-ai'.`,
      )
  }
}

export function getScriptProvider(env: ProviderEnv, notebook: NotebookAiConfig): ScriptProvider {
  switch (notebook.ai_provider) {
    case 'workers-ai':
      return new WorkersAIScriptProvider(env)
    case 'openai':
      return new OpenAIScriptProvider(env, notebook)
    case 'anthropic':
      return new AnthropicScriptProvider(env, notebook)
    case 'google':
      return new GoogleScriptProvider(env, notebook)
    default:
      throw new Error(`Unknown script provider: ${notebook.ai_provider}`)
  }
}

export function getOcrProvider(
  env: ProviderEnv,
  config: { provider: string; apiKey?: string | null; baseUrl?: string | null },
): OcrProvider {
  switch (config.provider) {
    case 'workers-ai':
      return new WorkersAiOcrProvider(env)
    case 'openai':
    case 'custom':
      return new OpenAIOcrProvider(env, config)
    case 'anthropic':
      return new AnthropicOcrProvider(env, config)
    case 'google':
      return new GoogleOcrProvider(env, config)
    default:
      throw new Error(`Unknown OCR provider: ${config.provider}`)
  }
}

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

export async function fetchConnectionModels(
  provider: string,
  apiKey?: string | null,
  baseUrl?: string | null,
  type: 'chat' | 'embedding' | 'ocr' = 'chat',
): Promise<string[]> {
  switch (provider) {
    case 'workers-ai': {
      const apiToken = apiKey
      const accountId = baseUrl

      if (apiToken && accountId) {
        try {
          const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`
          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
          })
          if (res.ok) {
            const data = (await res.json()) as {
              success: boolean
              result: Array<{
                name: string
                task: { name: string }
              }>
            }
            if (data.success && Array.isArray(data.result)) {
              // Map Cloudflare task classifications to application types
              if (type === 'embedding') {
                return data.result
                  .filter((m) => m.task.name === 'Text Embeddings')
                  .map((m) => m.name)
              }
              if (type === 'ocr') {
                // Workers AI has 'Image-to-Text' task, also include vision LLMs if any
                return data.result
                  .filter((m) => m.task.name === 'Image-to-Text' || m.name.includes('vision'))
                  .map((m) => m.name)
              }
              // chat/text-generation
              return data.result.filter((m) => m.task.name === 'Text Generation').map((m) => m.name)
            }
          }
        } catch (err) {
          console.error('[workers-ai] Failed to dynamically fetch models from Cloudflare API:', err)
        }
      }

      // Fallback to models.json config
      const fallbackList = modelsConfig['workers-ai']?.[type] || []
      return fallbackList
    }
    case 'anthropic':
      if (type === 'embedding') {
        return []
      }
      return [
        'claude-3-5-sonnet-latest',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-latest',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-latest',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
      ]
    case 'google': {
      const key = apiKey || ''
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Google API error ${res.status}: ${await res.text()}`)
      }
      const json = (await res.json()) as {
        models: Array<{ name: string; supportedGenerationMethods: string[] }>
      }
      const methodToMatch = type === 'embedding' ? 'embedContent' : 'generateContent'
      return (json.models || [])
        .filter((m) => m.supportedGenerationMethods.includes(methodToMatch))
        .map((m) => m.name.replace(/^models\//, ''))
    }
    case 'openai':
    case 'custom': {
      const key = apiKey || ''
      const cleanBaseUrl = (baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
      const url = buildOpenAiUrl(cleanBaseUrl, '/v1/models')
      const headers: Record<string, string> = {}
      if (key) {
        headers.Authorization = `Bearer ${key}`
      }
      try {
        const res = await fetch(url, { headers })
        if (!res.ok) {
          throw new Error(`OpenAI-compatible API error ${res.status}: ${await res.text()}`)
        }
        const json = (await res.json()) as { data: Array<{ id: string }> }
        const allModels = (json.data || []).map((m) => m.id)
        if (type === 'embedding') {
          return allModels.filter((m) => m.toLowerCase().includes('embed')).sort()
        } else {
          return allModels.filter((m) => !m.toLowerCase().includes('embed')).sort()
        }
      } catch (err) {
        console.error(`Failed to fetch models from ${url}, using fallback models:`, err)
        if (type === 'embedding') {
          return ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002']
        } else if (type === 'ocr') {
          return ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022', 'gemini-1.5-flash']
        } else {
          return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
        }
      }
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

// ---------------------------------------------------------------------------
// Re-exports (types only — individual provider classes are not re-exported;
// consumers use factory functions above)
// ---------------------------------------------------------------------------

export {
  arrayBufferToBase64,
  buildOpenAiUrl,
  ChatProvider,
  DEFAULT_EMBED_MODEL,
  EmbedProvider,
  NotebookAiConfig,
  OcrProvider,
  ProviderEnv,
  ScriptProvider,
} from './base'
