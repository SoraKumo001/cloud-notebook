import { zValidator } from '@hono/zod-validator'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { streamChat } from '../chat'
import { chatMessages, chatSessions, notebooks } from '../db/schema'
import { ErrorCode, errorResponse } from '../errors'
import { type Bindings, type Variables, vHook } from './common'

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Chat: SSE streaming RAG endpoint
router.post(
  '/chat',
  zValidator(
    'json',
    z.object({
      notebookId: z.string().min(1).max(100),
      query: z.string().min(1).max(10000),
      sessionId: z.string().min(1).max(100).optional(),
    }),
    vHook,
  ),
  async (c) => {
    const { notebookId, query, sessionId } = c.req.valid('json')
    const userId = c.get('user').id

    return streamChat(c.env, notebookId, userId, query, sessionId)
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

export default router
