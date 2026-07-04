// packages/backend/src/providers/openai.ts
// OpenAI-compatible provider implementations (Chat, Script, OCR).

import type {
  ChatProvider,
  NotebookAiConfig,
  OcrProvider,
  ProviderEnv,
  ScriptProvider,
} from './base'
import { arrayBufferToBase64, buildOpenAiUrl } from './base'

// ---------------------------------------------------------------------------
// Base class (not exported — internal to this file)
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
    const url = buildOpenAiUrl(this.baseUrl, this.apiPath)
    return fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export class OpenAIChatProvider extends BaseOpenAIProvider implements ChatProvider {
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

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export class OpenAIScriptProvider extends BaseOpenAIProvider implements ScriptProvider {
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
// OCR
// ---------------------------------------------------------------------------

export class OpenAIOcrProvider implements OcrProvider {
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
