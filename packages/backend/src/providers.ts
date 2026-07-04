// packages/backend/src/providers.ts
// AI provider abstraction layer — Workers AI / OpenAI / Anthropic / Google AI.
import modelsConfig from '../models.json'

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

// ---------------------------------------------------------------------------
// Default embedding model for Workers AI
// ---------------------------------------------------------------------------

export const DEFAULT_EMBED_MODEL = '@cf/baai/bge-m3'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ProviderEnv = { AI: Ai } & Record<string, unknown>

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
      throw new Error(
        'Anthropic does not provide embedding APIs. Use Workers AI (bge-large-en) instead.',
      )
    case 'openai':
      throw new Error(
        'OpenAI embedding is not supported: the Vectorize index is 1024-dim, but OpenAI text-embedding-3-small produces 1536-dim vectors. ' +
          'Provision a dedicated 1536-dim Vectorize index or use Workers AI (bge-large-en-v1.5).',
      )
    case 'google':
      throw new Error(
        'Google embedding is not supported: the Vectorize index is 1024-dim, but Google text-embedding-004 produces 768-dim vectors. ' +
          'Provision a dedicated 768-dim Vectorize index or use Workers AI (bge-large-en-v1.5).',
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

// ---------------------------------------------------------------------------
// Workers AI
// ---------------------------------------------------------------------------

function sanitizeModel(model: string): string {
  if (model === '@cf/meta/llama-3-8b-instruct') {
    return '@cf/meta/llama-3.1-8b-instruct-fast'
  }
  return model
}

class WorkersAIChatProvider implements ChatProvider {
  constructor(private env: ProviderEnv) {}
  async streamChat({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<ReadableStream<Uint8Array>> {
    const sanitized = sanitizeModel(model)
    const result = await this.env.AI.run(sanitized, { messages, stream: true } as any)
    return result as unknown as ReadableStream
  }
}

class WorkersAIEmbedProvider implements EmbedProvider {
  constructor(private env: ProviderEnv) {}
  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.env.AI.run(DEFAULT_EMBED_MODEL, { text: texts })
    const output = result as { data?: number[][]; shape?: number[] }
    const data = output.data
    if (!data || data.length === 0) throw new Error('Embedding returned empty data')
    return data as number[][]
  }
}

class WorkersAIScriptProvider implements ScriptProvider {
  constructor(private env: ProviderEnv) {}
  async generateScript({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<string> {
    const sanitized = sanitizeModel(model)
    const result = await this.env.AI.run(sanitized, { messages } as any)
    return (result as any).response as string
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export function buildOpenAiUrl(baseUrl: string, apiPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  if (cleanBase.endsWith('/v1') && apiPath.startsWith('/v1')) {
    return `${cleanBase}${apiPath.slice(3)}`
  }
  return `${cleanBase}${apiPath}`
}

abstract class BaseOpenAIProvider {
  protected abstract apiPath: string
  protected headers: Record<string, string>
  protected baseUrl: string

  constructor(_env: ProviderEnv, notebook: NotebookAiConfig) {
    this.baseUrl = (notebook.ai_base_url || 'https://api.openai.com').replace(/\/+$/, '')
    const apiKey = notebook.ai_api_key || ''
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }
  }

  protected async post(body: unknown): Promise<Response> {
    const url = buildOpenAiUrl(this.baseUrl, this.apiPath)
    return fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
  }
}

class OpenAIChatProvider extends BaseOpenAIProvider implements ChatProvider {
  protected apiPath = '/v1/chat/completions'

  async streamChat({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<ReadableStream<Uint8Array>> {
    const res = await this.post({ model, messages, stream: true })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI API error ${res.status}: ${body}`)
    }
    return res.body as ReadableStream
  }
}

class OpenAIScriptProvider extends BaseOpenAIProvider implements ScriptProvider {
  protected apiPath = '/v1/chat/completions'

  async generateScript({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<string> {
    const res = await this.post({ model, messages, stream: false })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI script API error ${res.status}: ${body}`)
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return json.choices[0]?.message?.content ?? ''
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

class AnthropicChatProvider implements ChatProvider {
  private baseUrl = 'https://api.anthropic.com'
  private headers: Record<string, string>

  constructor(_env: ProviderEnv, notebook: NotebookAiConfig) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': notebook.ai_api_key || '',
      'anthropic-version': '2023-06-01',
    }
  }

  async streamChat({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<ReadableStream<Uint8Array>> {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const msgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ model, system, messages: msgs, max_tokens: 4096, stream: true }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Anthropic API error ${res.status}: ${body}`)
    }
    return res.body as ReadableStream
  }
}

class AnthropicScriptProvider implements ScriptProvider {
  private baseUrl = 'https://api.anthropic.com'
  private headers: Record<string, string>

  constructor(_env: ProviderEnv, notebook: NotebookAiConfig) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': notebook.ai_api_key || '',
      'anthropic-version': '2023-06-01',
    }
  }

  async generateScript({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const msgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ model, system, messages: msgs, max_tokens: 4096, stream: false }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Anthropic script API error ${res.status}: ${body}`)
    }
    const json = (await res.json()) as { content: Array<{ text: string }> }
    return json.content?.[0]?.text ?? ''
  }
}

// ---------------------------------------------------------------------------
// Google AI
// ---------------------------------------------------------------------------

class GoogleChatProvider implements ChatProvider {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  private apiKey: string

  constructor(_env: ProviderEnv, notebook: NotebookAiConfig) {
    this.apiKey = notebook.ai_api_key || ''
  }

  async streamChat({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<ReadableStream<Uint8Array>> {
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => ({ text: m.content }))
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const body: Record<string, unknown> = { contents }
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts }

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Google AI API error ${res.status}: ${text}`)
    }
    return res.body as ReadableStream
  }
}

class GoogleScriptProvider implements ScriptProvider {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  private apiKey: string

  constructor(_env: ProviderEnv, notebook: NotebookAiConfig) {
    this.apiKey = notebook.ai_api_key || ''
  }

  async generateScript({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<string> {
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => ({ text: m.content }))
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const body: Record<string, unknown> = { contents }
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts }

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Google script API error ${res.status}: ${text}`)
    }
    const json = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    }
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
}

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
// OCR Providers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export interface OcrProvider {
  ocr(params: { model: string; imageBuffer: ArrayBuffer; prompt: string }): Promise<string>
}

class WorkersAiOcrProvider implements OcrProvider {
  constructor(private env: ProviderEnv) {}

  async ocr({
    model,
    imageBuffer,
    prompt,
  }: {
    model: string
    imageBuffer: ArrayBuffer
    prompt: string
  }): Promise<string> {
    const sanitized = sanitizeModel(model)
    let aiRes: any
    let lastError: any = null
    const maxRetries = 3
    const baseDelay = 500

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        aiRes = await this.env.AI.run(sanitized as any, {
          image: Array.from(new Uint8Array(imageBuffer)),
          prompt,
        })
        lastError = null
        break
      } catch (err: any) {
        lastError = err
        const errStr = String(err)
        if (errStr.includes("submit the prompt 'agree'") || errStr.includes('5016')) {
          console.log(`Model ${model} requires license agreement. Submitting 'agree'...`)
          await this.env.AI.run(sanitized as any, { prompt: 'agree' })
          attempt-- // Reset attempt count for license agreement flow
          continue
        }

        if (attempt < maxRetries) {
          const delay = baseDelay * 2 ** (attempt - 1)
          console.warn(
            `Workers AI OCR failed (attempt ${attempt}/${maxRetries}) for model ${model}: ${errStr}. Retrying in ${delay}ms...`,
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    if (lastError) {
      throw lastError
    }

    if (typeof aiRes?.response === 'string') {
      return aiRes.response.trim()
    }
    if (typeof aiRes?.text === 'string') {
      return aiRes.text.trim()
    }
    if (aiRes?.response) {
      return String(aiRes.response).trim()
    }
    if (aiRes?.text) {
      return String(aiRes.text).trim()
    }
    return ''
  }
}

class OpenAIOcrProvider implements OcrProvider {
  private baseUrl: string
  private apiKey: string

  constructor(_env: ProviderEnv, config: { apiKey?: string | null; baseUrl?: string | null }) {
    this.baseUrl = (config.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    this.apiKey = config.apiKey || ''
  }

  async ocr({
    model,
    imageBuffer,
    prompt,
  }: {
    model: string
    imageBuffer: ArrayBuffer
    prompt: string
  }): Promise<string> {
    const base64 = arrayBufferToBase64(imageBuffer)
    const url = buildOpenAiUrl(this.baseUrl, '/v1/chat/completions')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      if (
        errText.includes('image_url') ||
        errText.includes('unknown variant') ||
        errText.includes('expected `text`') ||
        errText.includes('expected text')
      ) {
        throw new Error(
          `The selected model does not support Vision/images (image_url is not supported by the provider/model). Please choose a Vision-enabled model for OCR. (Original error: ${errText})`,
        )
      }
      throw new Error(`OpenAI OCR API error ${res.status}: ${errText}`)
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return json.choices?.[0]?.message?.content?.trim() || ''
  }
}

class AnthropicOcrProvider implements OcrProvider {
  private baseUrl: string
  private apiKey: string

  constructor(_env: ProviderEnv, config: { apiKey?: string | null; baseUrl?: string | null }) {
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    this.apiKey = config.apiKey || ''
  }

  async ocr({
    model,
    imageBuffer,
    prompt,
  }: {
    model: string
    imageBuffer: ArrayBuffer
    prompt: string
  }): Promise<string> {
    const base64 = arrayBufferToBase64(imageBuffer)
    const url = `${this.baseUrl}/v1/messages`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      throw new Error(`Anthropic OCR API error ${res.status}: ${await res.text()}`)
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    return json.content?.find((c) => c.type === 'text')?.text?.trim() || ''
  }
}

class GoogleOcrProvider implements OcrProvider {
  private apiKey: string

  constructor(_env: ProviderEnv, config: { apiKey?: string | null }) {
    this.apiKey = config.apiKey || ''
  }

  async ocr({
    model,
    imageBuffer,
    prompt,
  }: {
    model: string
    imageBuffer: ArrayBuffer
    prompt: string
  }): Promise<string> {
    const base64 = arrayBufferToBase64(imageBuffer)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`

    let attempts = 0
    const maxAttempts = 3
    let delay = 1000

    while (attempts < maxAttempts) {
      try {
        attempts++
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64,
                    },
                  },
                ],
              },
            ],
          }),
        })

        if (!res.ok) {
          const text = await res.text()
          if ((res.status >= 500 || res.status === 429) && attempts < maxAttempts) {
            console.warn(
              `Gemini OCR API error ${res.status} (attempt ${attempts}/${maxAttempts}), retrying in ${delay}ms...`,
            )
            await new Promise((resolve) => setTimeout(resolve, delay))
            delay *= 2
            continue
          }
          throw new Error(`Google OCR API error ${res.status}: ${text}`)
        }

        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }
        return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
      } catch (err) {
        if (attempts >= maxAttempts) {
          throw err
        }
        console.warn(
          `Gemini OCR connection error (attempt ${attempts}/${maxAttempts}), retrying in ${delay}ms...`,
          err,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2
      }
    }
    throw new Error('Google OCR failed after max retries')
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
