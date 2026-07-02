// packages/backend/src/mcp-tools.ts
// MCP tool registrations for the cloud-notebook backend.

import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { streamChat } from './chat'
import { createDb } from './db/client'
import { chatMessages, chatSessions, sourceChunks, sources } from './db/schema'
import { embedQuery } from './embeddings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpNotebook {
  id: string
  userId: string
  title: string
}

interface McpEnv {
  DB: D1Database
  VECTORIZE: VectorizeIndex
  AI: Ai
}

// ---------------------------------------------------------------------------
// Register all tools on an McpServer
// ---------------------------------------------------------------------------

export function registerTools(server: any, env: McpEnv, notebook: McpNotebook): void {
  // ── list_sources ──────────────────────────────────────────────────────
  server.tool(
    'list_sources',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Max results (1–100)'),
      offset: z.number().int().min(0).optional().describe('Pagination offset'),
    },
    async ({ limit, offset }: { limit?: number; offset?: number }) => {
      const lim = Math.min(Math.max(limit ?? 50, 1), 100)
      const off = Math.max(offset ?? 0, 0)

      const db = createDb(env.DB)
      const rows = await db
        .select({
          id: sources.id,
          name: sources.name,
          type: sources.type,
          status: sources.status,
          created_at: sources.createdAt,
        })
        .from(sources)
        .where(eq(sources.notebookId, notebook.id))
        .orderBy(desc(sources.createdAt))
        .limit(lim)
        .offset(off)

      return { content: [{ type: 'text', text: JSON.stringify({ sources: rows }) }] }
    },
  )

  // ── get_source ────────────────────────────────────────────────────────
  server.tool(
    'get_source',
    {
      sourceId: z.string().min(1).max(100).describe('Source ID'),
    },
    async ({ sourceId }: { sourceId: string }) => {
      const db = createDb(env.DB)

      const [source] = await db
        .select({
          id: sources.id,
          name: sources.name,
          type: sources.type,
          status: sources.status,
          created_at: sources.createdAt,
        })
        .from(sources)
        .where(and(eq(sources.id, sourceId), eq(sources.notebookId, notebook.id)))
        .limit(1)

      if (!source) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: 'Source not found' }) }],
        }
      }

      const chunkRows = await db
        .select({
          id: sourceChunks.id,
          content: sourceChunks.content,
          page_number: sourceChunks.pageNumber,
        })
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceId, sourceId))
        .limit(50)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: source.id,
              name: source.name,
              type: source.type,
              status: source.status,
              chunks: chunkRows.map((r) => ({
                id: r.id,
                content: r.content,
                pageNumber: r.page_number,
              })),
              chunkCount: chunkRows.length,
            }),
          },
        ],
      }
    },
  )

  // ── search_sources ────────────────────────────────────────────────────
  server.tool(
    'search_sources',
    {
      query: z.string().min(1).max(1000).describe('Search query'),
      topK: z.number().int().min(1).max(20).optional().describe('Results (1–20)'),
    },
    async ({ query, topK }: { query: string; topK?: number }) => {
      const k = Math.min(Math.max(topK ?? 8, 1), 20)
      // Build a workers-ai embedding provider from the environment
      const { getEmbeddingProvider } = await import('./embeddings')
      const embedProvider = getEmbeddingProvider(env as any, {
        provider: 'workers-ai',
        apiKey: null,
        baseUrl: null,
        model: '',
      })
      const queryVector = await embedQuery(embedProvider, query)
      const vectorResult = await env.VECTORIZE.query(queryVector, {
        topK: k,
        returnMetadata: 'all',
        filter: { notebook_id: { $eq: notebook.id } },
      })
      const matches = vectorResult.matches as Array<{
        id: string
        score: number
        metadata?: Record<string, string>
      }>

      if (matches.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ matches: [] }) }] }
      }

      const db = createDb(env.DB)
      const chunkIds = matches.map((m) => m.metadata?.source_chunk_id ?? m.id)

      // M15: JOIN chunks with sources so we resolve content + name in one round-trip.
      const joinedRows = await db
        .select({
          chunkId: sourceChunks.id,
          content: sourceChunks.content,
          sourceName: sources.name,
        })
        .from(sourceChunks)
        .leftJoin(sources, eq(sources.id, sourceChunks.sourceId))
        .where(inArray(sourceChunks.id, chunkIds))

      const chunkMap = new Map(joinedRows.map((r) => [r.chunkId, r]))

      const results = matches.map((m) => {
        const ch = chunkMap.get(m.metadata?.source_chunk_id ?? m.id)
        return {
          chunkId: m.id,
          content: ch?.content ?? '',
          sourceName: ch?.sourceName ?? 'unknown',
          score: m.score,
        }
      })

      return { content: [{ type: 'text', text: JSON.stringify({ matches: results }) }] }
    },
  )

  // ── list_chat_sessions ────────────────────────────────────────────────
  server.tool(
    'list_chat_sessions',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Max results (1–100)'),
      offset: z.number().int().min(0).optional().describe('Pagination offset'),
    },
    async ({ limit, offset }: { limit?: number; offset?: number }) => {
      const lim = Math.min(Math.max(limit ?? 20, 1), 100)
      const off = Math.max(offset ?? 0, 0)

      const db = createDb(env.DB)
      const rows = await db
        .select({
          id: chatSessions.id,
          title: chatSessions.title,
          created_at: chatSessions.createdAt,
        })
        .from(chatSessions)
        .where(eq(chatSessions.notebookId, notebook.id))
        .orderBy(desc(chatSessions.createdAt))
        .limit(lim)
        .offset(off)

      return { content: [{ type: 'text', text: JSON.stringify({ sessions: rows }) }] }
    },
  )

  // ── get_chat_history ──────────────────────────────────────────────────
  server.tool(
    'get_chat_history',
    {
      sessionId: z.string().min(1).max(100).describe('Chat session ID'),
      limit: z.number().int().min(1).max(200).optional().describe('Max messages (1–200)'),
    },
    async ({ sessionId, limit }: { sessionId: string; limit?: number }) => {
      const lim = Math.min(Math.max(limit ?? 100, 1), 200)

      const db = createDb(env.DB)

      const [session] = await db
        .select({ notebook_id: chatSessions.notebookId })
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .limit(1)

      if (!session || session.notebook_id !== notebook.id) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }],
        }
      }

      const rows = await db
        .select({
          id: chatMessages.id,
          role: chatMessages.role,
          content: chatMessages.content,
          created_at: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId))
        .limit(lim)

      return { content: [{ type: 'text', text: JSON.stringify({ messages: rows }) }] }
    },
  )

  // ── chat (RAG streaming → JSON) ───────────────────────────────────────
  server.tool(
    'chat',
    {
      query: z.string().min(1).max(10000).describe('User question'),
      sessionId: z.string().min(1).max(100).optional().describe('Optional session ID to continue'),
    },
    async ({ query, sessionId }: { query: string; sessionId?: string }) => {
      const result = await chatViaRag(env, notebook.id, notebook.userId, query, sessionId)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )
}

// ---------------------------------------------------------------------------
// Internal: RAG chat via SSE → JSON aggregation
// ---------------------------------------------------------------------------

async function chatViaRag(
  env: McpEnv,
  notebookId: string,
  userId: string,
  query: string,
  sessionId?: string,
): Promise<{
  answer: string
  citations: { valid: number[]; invalid: number[] }
  chunks: unknown[]
}> {
  const response = await streamChat(env as any, notebookId, userId, query, sessionId)

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  const chunks: unknown[] = []
  const citations: { valid: number[]; invalid: number[] } = { valid: [], invalid: [] }

  if (!reader) return { answer: '', citations: { valid: [], invalid: [] }, chunks: [] }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const event of parts) {
      const dataMatch = event.match(/^data: (.+)$/m)
      if (!dataMatch) continue
      try {
        const data = JSON.parse(dataMatch[1])
        if (Array.isArray(data.chunks)) chunks.push(...data.chunks)
        if (typeof data.text === 'string') finalText += data.text
        if (typeof data.finalText === 'string') finalText = data.finalText
        if (data.citations) {
          if (Array.isArray(data.citations.valid)) citations.valid = data.citations.valid
          if (Array.isArray(data.citations.invalid)) citations.invalid = data.citations.invalid
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  return { answer: finalText, citations, chunks }
}
