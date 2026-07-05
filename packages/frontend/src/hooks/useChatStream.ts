import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  citations?: { valid: number[]; invalid: number[] }
  risk?: 'low' | 'medium' | 'high'
  reasons?: string[]
  chunks?: Array<{
    id: string
    sourceName: string
    pageNumber?: number
    score: number
  }>
}

interface UseChatStreamReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
  activeSessionId: string | null
  sendQuery(query: string, sourceId?: string): Promise<void>
  reset(): void
  loadSession(sessionId: string): Promise<void>
  selectedSourceId: string | null
  setSelectedSourceId: (id: string | null) => void
}

interface StoredSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  created_at: string
}

// ── localStorage helpers ─────────────────────────────────────────────────────

function getSessionStorageKey(notebookId: string): string {
  return `cloud-notebook:session:${notebookId}`
}

function getStoredSessionId(notebookId: string): string | null {
  if (typeof globalThis === 'undefined') return null
  try {
    return globalThis.localStorage.getItem(getSessionStorageKey(notebookId))
  } catch {
    return null
  }
}

function setStoredSessionId(notebookId: string, sessionId: string | null): void {
  if (typeof globalThis === 'undefined') return
  try {
    const key = getSessionStorageKey(notebookId)
    if (sessionId) {
      globalThis.localStorage.setItem(key, sessionId)
    } else {
      globalThis.localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage errors (e.g. private mode)
  }
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

/**
 * Extract a named field from a single SSE event block.
 * Looks for a line starting with `${key}: ` and returns the value part.
 */
function parseSSEField(eventBlock: string, key: string): string | null {
  for (const line of eventBlock.split('\n')) {
    const prefix = `${key}: `
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length)
    }
  }
  return null
}

/**
 * Read a ReadableStream<Uint8Array> and yield complete SSE event strings.
 * Events are separated by `\n\n`.  The generator handles partial chunks
 * split across `read()` boundaries.
 */
async function* sseEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Split on event boundaries (\n\n with optional trailing whitespace)
    const parts = buffer.split(/\n\n+/)
    // Keep the last (possibly partial) part in the buffer
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed) yield trimmed
    }
  }

  // Emit any remaining buffered content
  const remaining = buffer.trim()
  if (remaining) yield remaining
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChatStream(notebookId: string, userId: string): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    getStoredSessionId(notebookId),
  )
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const hasRestoredRef = useRef(false)

  // ------------------------------------------------------------------
  // loadSession
  // ------------------------------------------------------------------
  const loadSession = useCallback(
    async (sessionId: string) => {
      try {
        setError(null)
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)

        if (!res.ok) {
          throw new Error(`Failed to load session messages: ${res.status}`)
        }

        const data = (await res.json()) as StoredSessionMessage[]
        setMessages(
          data.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
          })),
        )
        setActiveSessionId(sessionId)
        setStoredSessionId(notebookId, sessionId)
      } catch {
        // Silently drop restore errors – a stale session ID should not surface a visible error
        // on initial load. The user can resend a query to start a fresh session.
      }
    },
    [notebookId],
  )

  // Restore session on mount if a stored session ID exists (only once)
  useEffect(() => {
    if (hasRestoredRef.current) return
    const storedId = getStoredSessionId(notebookId)
    if (storedId) {
      hasRestoredRef.current = true
      void loadSession(storedId)
    }
  }, [loadSession, notebookId])

  // ------------------------------------------------------------------
  // sendQuery
  // ------------------------------------------------------------------
  const sendQuery = useCallback(
    async (query: string, sourceId?: string) => {
      const trimmed = query.trim()
      if (!trimmed || streamingRef.current || abortRef.current) return

      setError(null)
      streamingRef.current = true
      setIsStreaming(true)

      const userMsgId = crypto.randomUUID()
      const assistantMsgId = crypto.randomUUID()

      // Optimistic UI – add user message and empty assistant placeholder
      const userMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: trimmed,
      }
      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])

      const abortController = new AbortController()
      abortRef.current = abortController

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notebookId,
            userId,
            query: trimmed,
            ...(activeSessionId ? { sessionId: activeSessionId } : {}),
            ...(sourceId ? { sourceId } : {}),
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`Chat request failed (${response.status})`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body stream')

        // ---- SSE event loop ----
        for await (const eventBlock of sseEventStream(reader)) {
          const eventType = parseSSEField(eventBlock, 'event')
          const dataStr = parseSSEField(eventBlock, 'data')
          if (!dataStr) continue

          switch (eventType) {
            case 'meta': {
              const data = JSON.parse(dataStr) as {
                sessionId: string
                chunks?: ChatMessage['chunks']
              }
              setActiveSessionId(data.sessionId)
              setStoredSessionId(notebookId, data.sessionId)
              if (data.chunks && data.chunks.length > 0) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, chunks: data.chunks } : m)),
                )
              }
              break
            }

            case 'reasoning': {
              const data = JSON.parse(dataStr) as { text?: string }
              if (data.text) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? // biome-ignore lint/style/noNonNullAssertion: guarded by `if (data.text)` above
                        { ...m, reasoning: (m.reasoning ?? '') + data.text! }
                      : m,
                  ),
                )
              }
              break
            }

            case 'delta': {
              const data = JSON.parse(dataStr) as { text?: string }
              if (data.text) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? // biome-ignore lint/style/noNonNullAssertion: guarded by `if (data.text)` above
                        { ...m, content: m.content + data.text! }
                      : m,
                  ),
                )
              }
              break
            }

            case 'done': {
              const data = JSON.parse(dataStr) as {
                finalText?: string
                finalReasoning?: string
                citations?: ChatMessage['citations']
                risk?: { risk: ChatMessage['risk']; reasons: string[] }
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: data.finalText ?? m.content,
                        reasoning: data.finalReasoning ?? m.reasoning,
                        citations: data.citations,
                        risk: data.risk?.risk,
                        reasons: data.risk?.reasons,
                      }
                    : m,
                ),
              )
              break
            }

            case 'error': {
              const data = JSON.parse(dataStr) as { message?: string }
              throw new Error(data.message || 'SSE error received')
            }
          }
        }
      } catch (err) {
        // Ignore abort errors (triggered by reset())
        if (abortController.signal.aborted) return

        const errorMessage = err instanceof Error ? err.message : String(err)

        // Remove the placeholder assistant message
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId))
        setError(errorMessage)
      } finally {
        streamingRef.current = false
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [notebookId, userId, activeSessionId],
  )

  // ------------------------------------------------------------------
  // reset
  // ------------------------------------------------------------------
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setError(null)
    setIsStreaming(false)
    streamingRef.current = false
    setActiveSessionId(null)
    setStoredSessionId(notebookId, null)
  }, [notebookId])

  return {
    messages,
    isStreaming,
    error,
    activeSessionId,
    sendQuery,
    reset,
    loadSession,
    selectedSourceId,
    setSelectedSourceId,
  }
}
