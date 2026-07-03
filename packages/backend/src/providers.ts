// packages/backend/src/providers.ts
// AI provider abstraction layer — Workers AI / OpenAI / Anthropic / Google AI.

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

export const DEFAULT_EMBED_MODEL = '@cf/baai/bge-large-en-v1.5'

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
    return fetch(`${this.baseUrl}${this.apiPath}`, {
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
    case 'workers-ai':
      if (type === 'embedding') {
        return [
          '@cf/baai/bge-large-en-v1.5',
          '@cf/baai/bge-base-en-v1.5',
          '@cf/baai/bge-small-en-v1.5',
          '@cf/baai/bge-m3',
          '@cf/pfnet/plamo-embedding-1b',
          '@cf/google/embeddinggemma-300m',
          '@cf/qwen/qwen3-embedding-0.6b',
        ]
      }
      if (type === 'ocr') {
        return [
          '@cf/meta/llama-3.2-11b-vision-instruct',
          '@cf/meta/llama-3.2-90b-vision-instruct',
        ]
      }
      return [
        '@cf/meta/llama-3.1-8b-instruct-fast',
        '@cf/meta/llama-3-8b-instruct',
        '@cf/qwen/qwen1.5-14b-chat',
        '@cf/mistral/mistral-7b-instruct-v0.2',
        '@cf/google/gemma-7b-it',
        '@cf/tinyllama/tinyllama-1.1b-chat-v1.0',
      ]
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
      const url = `${baseUrl || 'https://api.openai.com/v1'}/models`
      const headers: Record<string, string> = {}
      if (key) {
        headers.Authorization = `Bearer ${key}`
      }
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
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}
