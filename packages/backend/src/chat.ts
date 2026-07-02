// packages/backend/src/chat.ts
// Streaming SSE chat endpoint — RAG pipeline:
//   embed query → Vectorize search → build prompt → Workers AI stream → SSE

import { and, desc, eq, inArray } from 'drizzle-orm'
import { createDb } from './db/client'
import { chatMessages, chatSessions, notebooks, notes, sourceChunks, sources } from './db/schema'
import { getEffectiveAiConfig } from './db/settings'
import { embedChunks, embedQuery, getEmbeddingProvider } from './embeddings'
import { ErrorCode } from './errors'
import {
  assessHallucinationRisk,
  buildGeneralPrompt,
  buildRagPrompt,
  type RagChunk,
  validateCitations,
} from './prompts'
import { getChatProvider } from './providers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatEnv {
  DB: D1Database
  VECTORIZE: VectorizeIndex
  AI: Ai
  [key: string]: unknown
}

interface NotebookRow {
  id: string
  user_id: string
  ai_provider: string
  ai_api_key?: string | null
  ai_base_url?: string | null
  model_chat?: string | null
  embedding_provider: string
  embedding_api_key?: string | null
  embedding_base_url?: string | null
  embedding_model?: string | null
}

interface VectorizeMatchResult {
  id: string
  score: number
  metadata?: Record<string, string>
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

const SSE_ENCODER = new TextEncoder()

/**
 * Format a single SSE message.
 */
export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function writeSSE(writer: WritableStreamDefaultWriter<Uint8Array>, event: string, data: unknown) {
  writer.write(SSE_ENCODER.encode(formatSSE(event, data)))
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VECTORIZE_TOP_K = 8
const CACHE_TTL_SEC = 300 // 5 min for notebook metadata

// ---------------------------------------------------------------------------
// streamChat
// ---------------------------------------------------------------------------

export async function streamChat(
  env: ChatEnv,
  notebookId: string,
  userId: string,
  query: string,
  sessionId?: string,
): Promise<Response> {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      await runPipeline(env, notebookId, userId, query, sessionId, writer)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      writeSSE(writer, 'error', { message, code: ErrorCode.ServerInternalError })
    } finally {
      await writer.close().catch(() => {})
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ---------------------------------------------------------------------------
// Provider helper
// ---------------------------------------------------------------------------

function getChatChannel(
  env: ChatEnv & Record<string, unknown>,
  nb: NotebookRow,
): ReturnType<typeof getChatProvider> {
  return getChatProvider(env as any, {
    ai_provider: nb.ai_provider,
    ai_api_key: nb.ai_api_key,
    ai_base_url: nb.ai_base_url,
  })
}

// ---------------------------------------------------------------------------
// Cache helper
// ---------------------------------------------------------------------------

async function getNotebookCached(env: ChatEnv, notebookId: string): Promise<NotebookRow | null> {
  const db = createDb(env.DB)

  if (typeof caches !== 'undefined' && caches.default) {
    try {
      const cacheKey = new Request(`https://cache.internal/notebook/${notebookId}`)
      const cached = await caches.default.match(cacheKey)
      if (cached) {
        return (await cached.json()) as NotebookRow
      }

      const [notebookRaw] = await db
        .select({
          id: notebooks.id,
          user_id: notebooks.userId,
          ai_embedding_model: notebooks.aiEmbeddingModel,
          model_chat: notebooks.modelChat,
          model_summarization: notebooks.modelSummarization,
        })
        .from(notebooks)
        .where(eq(notebooks.id, notebookId))
        .limit(1)

      if (!notebookRaw) return null

      const masterKey = env.API_KEY_ENCRYPTION_MASTER as string | undefined
      const effectiveConfig = await getEffectiveAiConfig(db, notebookRaw.user_id, masterKey, {
        aiEmbeddingModel: notebookRaw.ai_embedding_model,
        modelChat: notebookRaw.model_chat,
        modelSummarization: notebookRaw.model_summarization,
      })

      const notebook: NotebookRow = {
        id: notebookRaw.id,
        user_id: notebookRaw.user_id,
        ai_provider: effectiveConfig.chat.provider,
        ai_api_key: effectiveConfig.chat.apiKey,
        ai_base_url: effectiveConfig.chat.baseUrl,
        model_chat: effectiveConfig.chat.model,
        embedding_provider: effectiveConfig.embedding.provider,
        embedding_api_key: effectiveConfig.embedding.apiKey,
        embedding_base_url: effectiveConfig.embedding.baseUrl,
        embedding_model: effectiveConfig.embedding.model,
      }

      const response = new Response(JSON.stringify(notebook), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${CACHE_TTL_SEC}`,
        },
      })
      await caches.default.put(cacheKey, response.clone())

      return notebook
    } catch {
      // fall through
    }
  }

  const [notebookRaw] = await db
    .select({
      id: notebooks.id,
      user_id: notebooks.userId,
      ai_embedding_model: notebooks.aiEmbeddingModel,
      model_chat: notebooks.modelChat,
      model_summarization: notebooks.modelSummarization,
    })
    .from(notebooks)
    .where(eq(notebooks.id, notebookId))
    .limit(1)

  if (!notebookRaw) return null

  const masterKey = env.API_KEY_ENCRYPTION_MASTER as string | undefined
  const effectiveConfig = await getEffectiveAiConfig(db, notebookRaw.user_id, masterKey, {
    aiEmbeddingModel: notebookRaw.ai_embedding_model,
    modelChat: notebookRaw.model_chat,
    modelSummarization: notebookRaw.model_summarization,
  })

  return {
    id: notebookRaw.id,
    user_id: notebookRaw.user_id,
    ai_provider: effectiveConfig.chat.provider,
    ai_api_key: effectiveConfig.chat.apiKey,
    ai_base_url: effectiveConfig.chat.baseUrl,
    model_chat: effectiveConfig.chat.model,
    embedding_provider: effectiveConfig.embedding.provider,
    embedding_api_key: effectiveConfig.embedding.apiKey,
    embedding_base_url: effectiveConfig.embedding.baseUrl,
    embedding_model: effectiveConfig.embedding.model,
  }
}

// ---------------------------------------------------------------------------
// Pipeline implementation
// ---------------------------------------------------------------------------

async function runPipeline(
  env: ChatEnv,
  notebookId: string,
  userId: string,
  query: string,
  sessionId: string | undefined,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  const db = createDb(env.DB)

  // ---- a. Notebook ownership check (cached) --------------------------------
  const notebook = await getNotebookCached(env, notebookId)

  if (!notebook || notebook.user_id !== userId) {
    writeSSE(writer, 'error', { message: 'Notebook not found', code: ErrorCode.NotebookNotFound })
    return
  }

  // ---- a1. Check if notebook has any sources -------------------------------
  const [firstSource] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.notebookId, notebookId))
    .limit(1)
  const hasSources = !!firstSource

  const chunks: RagChunk[] = []
  let scores: number[] = []
  let maxScore = 0
  let isFallback = !hasSources

  if (hasSources) {
    const embedProvider = getEmbeddingProvider(env, {
      provider: notebook.embedding_provider,
      apiKey: notebook.embedding_api_key || null,
      baseUrl: notebook.embedding_base_url || null,
      model: notebook.embedding_model || '',
    })

    // ---- b. Embed query ------------------------------------------------------
    const queryVector = await embedQuery(embedProvider, query)

    // ---- c. Vectorize search (scoped to notebook) ----------------------------
    let vectorMatches = await env.VECTORIZE.query(queryVector, {
      topK: VECTORIZE_TOP_K,
      returnMetadata: 'all',
      filter: { notebook_id: { $eq: notebookId } },
    })

    let matches = vectorMatches.matches as VectorizeMatchResult[]

    // Auto-sync / reindex logic:
    // If we have sources in D1 but Vectorize query returns 0 results,
    // it means Vectorize index might have been cleared (e.g. wrangler dev restart).
    // In this case, we automatically re-embed all chunks and upsert them.
    if (matches.length === 0) {
      const allChunks = await db
        .select({
          id: sourceChunks.id,
          content: sourceChunks.content,
          sourceId: sourceChunks.sourceId,
        })
        .from(sourceChunks)
        .where(eq(sourceChunks.notebookId, notebookId))

      if (allChunks.length > 0) {
        const vectors = await embedChunks(
          embedProvider,
          allChunks.map((c) => ({ id: c.id, content: c.content })),
        )

        const vectorsWithMeta = vectors.map((v) => {
          const originalChunk = allChunks.find((c) => c.id === v.id)
          return {
            ...v,
            metadata: {
              ...v.metadata,
              source_id: originalChunk?.sourceId ?? '',
              notebook_id: notebookId,
            },
          }
        })

        await env.VECTORIZE.upsert(vectorsWithMeta)

        // Retry Vectorize query
        vectorMatches = await env.VECTORIZE.query(queryVector, {
          topK: VECTORIZE_TOP_K,
          returnMetadata: 'all',
          filter: { notebook_id: { $eq: notebookId } },
        })
        matches = vectorMatches.matches as VectorizeMatchResult[]
      }
    }

    // ---- d. Fetch chunk content + source names from D1 -----------------------
    if (matches.length > 0) {
      const chunkIds = matches.map((m) => m.metadata?.source_chunk_id ?? m.id)

      // M15: JOIN chunks with sources to fetch content + name in one query.
      const joinedRows = await db
        .select({
          chunkId: sourceChunks.id,
          content: sourceChunks.content,
          sourceId: sourceChunks.sourceId,
          pageNumber: sourceChunks.pageNumber,
          sourceName: sources.name,
        })
        .from(sourceChunks)
        .leftJoin(sources, eq(sources.id, sourceChunks.sourceId))
        .where(inArray(sourceChunks.id, chunkIds))

      // Build a map so we can resolve matches back to chunk rows in order.
      const chunkMap = new Map<string, (typeof joinedRows)[number]>()
      for (const row of joinedRows) {
        chunkMap.set(row.chunkId, row)
      }

      for (const match of matches) {
        const chunkId = match.metadata?.source_chunk_id ?? match.id
        const row = chunkMap.get(chunkId)
        if (!row) continue

        chunks.push({
          id: row.chunkId,
          content: row.content,
          sourceName: row.sourceName ?? 'unknown',
          pageNumber: row.pageNumber ?? undefined,
        })
      }
    }

    scores = matches.map((m) => m.score)
    maxScore = scores.length > 0 ? Math.max(...scores) : 0
    if (maxScore < 0.3 || chunks.length === 0) {
      isFallback = true
    }
  }

  // ---- g. Fetch notes for context -----------------------------------------
  const noteRows = await db
    .select({ title: notes.title, content: notes.content })
    .from(notes)
    .where(eq(notes.notebookId, notebookId))
    .orderBy(desc(notes.updatedAt))

  const notesForContext = noteRows.length > 0 ? noteRows : undefined

  // ---- g1. Build prompt ----------------------------------------------------
  const { system, user } = isFallback
    ? buildGeneralPrompt(query, notesForContext)
    : buildRagPrompt(query, chunks, notesForContext)

  // ---- h. Session management -----------------------------------------------
  let activeSessionId: string
  if (sessionId) {
    const [existing] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.notebookId, notebookId)))
      .limit(1)

    if (!existing) {
      writeSSE(writer, 'error', { message: 'Session not found', code: ErrorCode.SessionNotFound })
      return
    }
    activeSessionId = sessionId

    // ---- i. Save user message (existing session, single INSERT) -------------
    await db.insert(chatMessages).values({
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      role: 'user',
      content: query,
    })
  } else {
    // New session: batch INSERT session + user message in a single D1 RPC.
    // Saves one round-trip on the chat hot path.
    activeSessionId = crypto.randomUUID()
    await db.batch([
      db
        .insert(chatSessions)
        .values({ id: activeSessionId, notebookId, title: query.slice(0, 100) }),
      db.insert(chatMessages).values({
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: 'user',
        content: query,
      }),
    ])
  }

  // ---- Send meta event (before streaming) ----------------------------------
  const metaChunks = chunks.map((c, i) => ({
    id: c.id,
    sourceName: c.sourceName,
    pageNumber: c.pageNumber ?? null,
    score: scores[i] ?? 0,
  }))
  writeSSE(writer, 'meta', {
    sessionId: activeSessionId,
    chunks: metaChunks,
  })

  // ---- j/k. Stream LLM response (provider-agnostic) ------------------------
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const provider = getChatChannel(env, notebook)
  let model = notebook.model_chat || '@cf/meta/llama-3.1-8b-instruct-fast'
  if (model === '@cf/meta/llama-3-8b-instruct') {
    model = '@cf/meta/llama-3.1-8b-instruct-fast'
  }
  const aiStream = await provider.streamChat({ model, messages })

  const aiReader = aiStream.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  let buffer = ''
  try {
    while (true) {
      const { done, value } = await aiReader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let text = ''
        const rawJson = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
        if (rawJson === '[DONE]') {
          continue
        }
        try {
          const parsed = JSON.parse(rawJson)
          if (parsed.choices?.[0]?.delta?.content !== undefined) {
            text = parsed.choices[0].delta.content
          } else if (parsed.response !== undefined) {
            text = parsed.response
          }
        } catch {
          // JSONとしてパースできない場合、プレーンテキストとして処理
          text = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
        }

        if (text) {
          writeSSE(writer, 'delta', { text })
          fullText += text
        }
      }
    }

    // 残ったバッファを処理
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      let text = ''
      const rawJson = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
      if (rawJson !== '[DONE]') {
        try {
          const parsed = JSON.parse(rawJson)
          if (parsed.choices?.[0]?.delta?.content !== undefined) {
            text = parsed.choices[0].delta.content
          } else if (parsed.response !== undefined) {
            text = parsed.response
          }
        } catch {
          text = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
        }

        if (text) {
          writeSSE(writer, 'delta', { text })
          fullText += text
        }
      }
    }
  } finally {
    aiReader.releaseLock()
  }

  // ---- l. Save assistant message -------------------------------------------
  await db.insert(chatMessages).values({
    id: crypto.randomUUID(),
    sessionId: activeSessionId,
    role: 'assistant',
    content: fullText,
  })

  // ---- Compute post-streaming analysis -------------------------------------
  const citationResult = validateCitations(fullText, chunks.length)
  let finalRisk = assessHallucinationRisk(fullText, chunks.length, scores)
  if (isFallback) {
    finalRisk = {
      risk: 'high',
      reasons: !hasSources
        ? ['no source documents uploaded']
        : maxScore < 0.3
          ? [`low max similarity (${maxScore.toFixed(2)})`]
          : ['no relevant chunks found'],
    }
  }

  writeSSE(writer, 'done', {
    finalText: fullText,
    citations: citationResult,
    risk: finalRisk,
  })
}
