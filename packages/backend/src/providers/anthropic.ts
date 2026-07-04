// packages/backend/src/providers/anthropic.ts
// Anthropic provider implementations (Chat, Script, OCR).

import type {
  ChatProvider,
  NotebookAiConfig,
  OcrProvider,
  ProviderEnv,
  ScriptProvider,
} from './base'
import { arrayBufferToBase64 } from './base'

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export class AnthropicChatProvider implements ChatProvider {
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

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export class AnthropicScriptProvider implements ScriptProvider {
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
// OCR
// ---------------------------------------------------------------------------

export class AnthropicOcrProvider implements OcrProvider {
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
