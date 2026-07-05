import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { streamChat } from '../chat'
import { chatMessages, chatSessions, notebooks } from '../db/schema'
import { ErrorCode, errorResponse } from '../errors'
import type { AppEnv } from '../types'
import { vHook } from './common'

const router = new Hono<AppEnv>()

// Chat: SSE streaming RAG endpoint
router.post(
  '/chat',
  zValidator(
    'json',
    z.object({
      notebookId: z.string().min(1).max(100),
      query: z.string().min(1).max(10000),
      sessionId: z.string().min(1).max(100).optional(),
      sourceId: z.string().min(1).max(100).optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { notebookId, query, sessionId, sourceId } = c.req.valid('json')
    const userId = c.get('user').id

    return streamChat(c.env, notebookId, userId, query, sessionId, sourceId)
  },
)

// Get messages for a chat session
router.get(
  '/sessions/:sessionId/messages',
  zValidator('param', z.object({ sessionId: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { sessionId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [session] = await db
      .select({ notebook_id: chatSessions.notebookId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    if (!session) {
      return errorResponse(c, ErrorCode.SessionNotFound, 'Session not found', 404)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, session.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.SessionNotFound, 'Session not found', 404)
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
      .orderBy(asc(chatMessages.createdAt))

    return c.json(rows)
  },
)

// Delete a chat session
router.delete(
  '/sessions/:sessionId',
  zValidator('param', z.object({ sessionId: z.string().min(1).max(100) }), vHook),
  async (c) => {
    const { sessionId } = c.req.valid('param')
    const userId = c.get('user').id
    const db = c.get('db')

    const [session] = await db
      .select({ notebook_id: chatSessions.notebookId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    if (!session) {
      return errorResponse(c, ErrorCode.SessionNotFound, 'Session not found', 404)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, session.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.SessionNotFound, 'Session not found', 404)
    }

    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId))
    return c.newResponse(null, 204)
  },
)

// Rename a chat session
router.patch(
  '/sessions/:sessionId',
  zValidator('param', z.object({ sessionId: z.string().min(1).max(100) }), vHook),
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
    }),
    vHook,
  ),
  async (c) => {
    const { sessionId } = c.req.valid('param')
    const { title } = c.req.valid('json')
    const userId = c.get('user').id
    const db = c.get('db')

    const [session] = await db
      .select({ notebook_id: chatSessions.notebookId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    if (!session) {
      return errorResponse(c, ErrorCode.SessionNotFound, 'Session not found', 404)
    }

    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, session.notebook_id))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.SessionNotFound, 'Session not found', 404)
    }

    await db.update(chatSessions).set({ title: title.trim() }).where(eq(chatSessions.id, sessionId))

    const [updated] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)

    return c.json(updated)
  },
)

// Feature #4: Chat History Search (keyword)
router.get(
  '/notebooks/:id/sessions/search',
  zValidator('param', z.object({ id: z.string().min(1).max(100) }), vHook),
  zValidator('query', z.object({ q: z.string().min(1).max(200) }), vHook),
  async (c) => {
    const { id: notebookId } = c.req.valid('param')
    const { q } = c.req.valid('query')
    const userId = c.get('user').id
    const db = c.get('db')

    // Ownership check
    const [notebook] = await db
      .select({ user_id: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1)

    if (!notebook || notebook.user_id !== userId) {
      return errorResponse(c, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    }

    // Query: JOIN sessions with messages, filter by content LIKE
    const rows = await db
      .select({
        sessionId: chatSessions.id,
        sessionTitle: chatSessions.title,
        sessionCreatedAt: chatSessions.createdAt,
        messageId: chatMessages.id,
        messageRole: chatMessages.role,
        messageContent: chatMessages.content,
        messageCreatedAt: chatMessages.createdAt,
      })
      .from(chatSessions)
      .innerJoin(chatMessages, eq(chatMessages.sessionId, chatSessions.id))
      .where(and(eq(chatSessions.notebookId, notebookId), like(chatMessages.content, `%${q}%`)))
      .orderBy(desc(chatSessions.createdAt), asc(chatMessages.createdAt))
      .limit(50)

    // Group by session
    const sessionMap = new Map<
      string,
      {
        session: { id: string; title: string; created_at: string }
        messages: Array<{ id: string; role: string; content: string; created_at: string }>
      }
    >()

    for (const row of rows) {
      if (!sessionMap.has(row.sessionId)) {
        sessionMap.set(row.sessionId, {
          session: { id: row.sessionId, title: row.sessionTitle, created_at: row.sessionCreatedAt },
          messages: [],
        })
      }
      sessionMap.get(row.sessionId)?.messages.push({
        id: row.messageId,
        role: row.messageRole,
        content: row.messageContent,
        created_at: row.messageCreatedAt,
      })
    }

    return c.json({ results: Array.from(sessionMap.values()) })
  },
)

export default router
