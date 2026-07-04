// packages/backend/src/providers/google.ts
// Google AI provider implementations (Chat, Script, OCR).

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

export class GoogleChatProvider implements ChatProvider {
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

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export class GoogleScriptProvider implements ScriptProvider {
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

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export class GoogleOcrProvider implements OcrProvider {
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
