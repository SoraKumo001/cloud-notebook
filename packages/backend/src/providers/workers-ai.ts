// packages/backend/src/providers/workers-ai.ts
// Workers AI provider implementations (Chat, Embed, Script, OCR).

import type { ChatProvider, EmbedProvider, OcrProvider, ProviderEnv, ScriptProvider } from './base'
import { DEFAULT_EMBED_MODEL } from './base'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeModel(model: string): string {
  if (model === '@cf/meta/llama-3-8b-instruct') {
    return '@cf/meta/llama-3.1-8b-instruct-fast'
  }
  return model
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export class WorkersAIChatProvider implements ChatProvider {
  constructor(private env: ProviderEnv) {}
  async streamChat({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<ReadableStream<Uint8Array>> {
    const sanitized = sanitizeModel(model)
    const result = await this.env.AI.run(sanitized, { messages, stream: true } as never)
    return result as unknown as ReadableStream
  }
}

// ---------------------------------------------------------------------------
// Embed
// ---------------------------------------------------------------------------

export class WorkersAIEmbedProvider implements EmbedProvider {
  constructor(private env: ProviderEnv) {}
  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.env.AI.run(DEFAULT_EMBED_MODEL, { text: texts })
    const output = result as { data?: number[][]; shape?: number[] }
    const data = output.data
    if (!data || data.length === 0) throw new Error('Embedding returned empty data')
    return data as number[][]
  }
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export class WorkersAIScriptProvider implements ScriptProvider {
  constructor(private env: ProviderEnv) {}
  async generateScript({
    model,
    messages,
  }: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<string> {
    const sanitized = sanitizeModel(model)
    const result = await this.env.AI.run(sanitized, { messages } as never)
    return (result as { response?: string }).response ?? ''
  }
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export class WorkersAiOcrProvider implements OcrProvider {
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
        aiRes = await this.env.AI.run(sanitized as keyof ProviderEnv['AI'], {
          image: Array.from(new Uint8Array(imageBuffer)),
          prompt,
        })
        lastError = null
        break
      } catch (err: any) {
        lastError = err
        const errStr = String(err)
        if (errStr.includes("submit the prompt 'agree'") || errStr.includes('5016')) {
          await this.env.AI.run(sanitized as keyof ProviderEnv['AI'], { prompt: 'agree' })
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
