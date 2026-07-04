// packages/backend/src/providers/base.ts
// Shared types, constants, and utility functions for AI provider implementations.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotebookAiConfig {
  ai_provider: string
  ai_api_key?: string | null
  ai_base_url?: string | null
  ai_embedding_model?: string | null
  model_chat?: string | null
  model_summarization?: string | null
}

export interface ChatProvider {
  streamChat(params: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<ReadableStream<Uint8Array>>
}

export interface EmbedProvider {
  embed(texts: string[]): Promise<number[][]>
}

export interface ScriptProvider {
  generateScript(params: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<string>
}

export interface OcrProvider {
  ocr(params: { model: string; imageBuffer: ArrayBuffer; prompt: string }): Promise<string>
}

// ---------------------------------------------------------------------------
// Environment type
// ---------------------------------------------------------------------------

export type ProviderEnv = { AI: Ai }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_EMBED_MODEL = '@cf/baai/bge-m3'

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Convert an ArrayBuffer to a base64-encoded string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Build a full URL for an OpenAI-compatible API endpoint.
 *
 * Handles the common case where the base URL already ends with `/v1` and the
 * path also starts with `/v1` — the duplicate segment is stripped.
 */
export function buildOpenAiUrl(baseUrl: string, apiPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  if (cleanBase.endsWith('/v1') && apiPath.startsWith('/v1')) {
    return `${cleanBase}${apiPath.slice(3)}`
  }
  return `${cleanBase}${apiPath}`
}
