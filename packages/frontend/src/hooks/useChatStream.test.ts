import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Must import before useChatStream so vi.hoisted vars are available to vi.mock
// (No vi.mock needed – we mock fetch directly)
import { useChatStream } from './useChatStream'

// ── Helpers ──────────────────────────────────────────────────────────────────

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Build a ReadableStream that yields the provided SSE text in small chunks
 * so the SSE parser exercises its buffering logic.
 */
function sseStream(sseText: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(sseText)
  let offset = 0
  const CHUNK = 16

  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const end = Math.min(offset + CHUNK, bytes.length)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
  })
}

/** Shorthand to build an SSE string. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Create a fake Response-like object with a readable body stream. */
function sseResponse(sseText: string): Response {
  return {
    ok: true,
    status: 200,
    body: sseStream(sseText),
    json: async () => ({}),
  } as unknown as Response
}

// ── Inline renderHook ────────────────────────────────────────────────────────

interface RenderHookResult<T> {
  result: { current: T }
  unmount: () => void
}

function renderHook<T>(useHook: () => T): RenderHookResult<T> {
  const result: { current: T } = { current: undefined as unknown as T }
  let root: Root

  function TestComponent() {
    result.current = useHook()
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(React.createElement(TestComponent))

  return {
    result,
    unmount: () => {
      root.unmount()
      document.body.removeChild(container)
    },
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('useChatStream', () => {
  beforeEach(async () => {
    // Deterministic UUID generator: first call → user msg, second → asst msg
    const makeUUID = (() => {
      let counter = 0
      return () => {
        counter += 1
        return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`
      }
    })()
    vi.spyOn(crypto, 'randomUUID').mockImplementation(makeUUID)
    globalThis.fetch = vi.fn()

    // Mock localStorage
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    window.localStorage.clear()
    await flushMicrotasks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // ---- helpers ---------------------------------------------------------------

  /** Set up fetch to return a single SSE response. */
  function mockChatSSE(sseText: string) {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(sseResponse(sseText))
  }

  /** Return the (URL, init) pairs passed to fetch. */
  function _fetchCalls(): Array<[string, RequestInit | undefined]> {
    return (globalThis.fetch as Mock).mock.calls as Array<[string, RequestInit | undefined]>
  }

  // ---- Tests -----------------------------------------------------------------

  it('should add user message immediately on sendQuery', async () => {
    mockChatSSE(sse('meta', { sessionId: 'sess-1', chunks: [] }) + sse('done', { finalText: 'OK' }))

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    expect(result.current.messages).toHaveLength(0)

    await result.current.sendQuery('Hello')
    await flushMicrotasks()

    // User message should be present
    const userMsg = result.current.messages.find((m) => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg?.content).toBe('Hello')

    unmount()
  })

  it('should build assistant message through meta → delta → done', async () => {
    const sseText =
      sse('meta', { sessionId: 'sess-1', chunks: [] }) +
      sse('delta', { text: 'Hello' }) +
      sse('delta', { text: ' world' }) +
      sse('done', {
        finalText: 'Hello world',
        citations: { valid: [1, 2], invalid: [] },
        risk: { risk: 'low', reasons: ['Safe'] },
      })

    mockChatSSE(sseText)

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('Hi')
    await flushMicrotasks()

    const asstMsg = result.current.messages.find((m) => m.role === 'assistant')
    expect(asstMsg).toBeDefined()
    expect(asstMsg?.content).toBe('Hello world')
    expect(asstMsg?.citations).toEqual({ valid: [1, 2], invalid: [] })
    expect(asstMsg?.risk).toBe('low')
    expect(asstMsg?.reasons).toEqual(['Safe'])

    unmount()
  })

  it('should append delta text to assistant content', async () => {
    const sseText =
      sse('meta', { sessionId: 'sess-1', chunks: [] }) +
      sse('delta', { text: 'Part 1. ' }) +
      sse('delta', { text: 'Part 2. ' }) +
      sse('delta', { text: 'Part 3.' }) +
      sse('done', {
        finalText: 'Part 1. Part 2. Part 3.',
        citations: { valid: [], invalid: [] },
        risk: { risk: 'low', reasons: [] },
      })

    mockChatSSE(sseText)

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('test')
    await flushMicrotasks()

    const asstMsg = result.current.messages.find((m) => m.role === 'assistant')
    expect(asstMsg?.content).toBe('Part 1. Part 2. Part 3.')

    unmount()
  })

  it('should set citations and risk on done event', async () => {
    const sseText =
      sse('meta', { sessionId: 'sess-1', chunks: [] }) +
      sse('delta', { text: 'Answer' }) +
      sse('done', {
        finalText: 'Answer',
        citations: { valid: [1], invalid: [3] },
        risk: { risk: 'medium', reasons: ['Needs verification'] },
      })

    mockChatSSE(sseText)

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('q')
    await flushMicrotasks()

    const asstMsg = result.current.messages.find((m) => m.role === 'assistant')
    expect(asstMsg?.citations).toEqual({ valid: [1], invalid: [3] })
    expect(asstMsg?.risk).toBe('medium')
    expect(asstMsg?.reasons).toEqual(['Needs verification'])

    unmount()
  })

  it('should set error state on error event', async () => {
    const sseText = sse('error', { message: 'Internal server error' })

    mockChatSSE(sseText)

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('cause error')
    await flushMicrotasks()

    // Error should be set
    expect(result.current.error).toBe('Internal server error')
    // Assistant placeholder is removed, user message stays
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].role).toBe('user')

    unmount()
  })

  it('should reflect isStreaming lifecycle (true → false)', async () => {
    // Build SSE that we gate so we can observe isStreaming mid-flight
    let resolveStream!: () => void
    const streamGate = new Promise<void>((resolve) => {
      resolveStream = resolve
    })

    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation(async () => {
      await streamGate
      return sseResponse(
        sse('meta', { sessionId: 'sess-1', chunks: [] }) + sse('done', { finalText: 'done' }),
      )
    })

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    expect(result.current.isStreaming).toBe(false)

    // Start query without awaiting
    const queryPromise = result.current.sendQuery('wait')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushMicrotasks()

    expect(result.current.isStreaming).toBe(true)

    // Release the gate
    resolveStream()
    await queryPromise
    await flushMicrotasks()

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.messages.length).toBeGreaterThanOrEqual(2)

    unmount()
  })

  it('should reset messages and error', async () => {
    mockChatSSE(
      sse('meta', { sessionId: 'sess-1', chunks: [] }) + sse('done', { finalText: 'done' }),
    )

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('hello')
    await flushMicrotasks()

    expect(result.current.messages.length).toBeGreaterThanOrEqual(2)
    expect(result.current.error).toBeNull()

    result.current.reset()
    await flushMicrotasks()

    expect(result.current.messages).toHaveLength(0)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()

    unmount()
  })

  it('should reuse sessionId across multiple sendQuery calls', async () => {
    const fetchMock = globalThis.fetch as Mock

    // First call: return a meta with sessionId
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body1 = JSON.parse(String(init?.body ?? '{}'))
      expect(body1.sessionId).toBeUndefined() // first call omits sessionId

      return sseResponse(
        sse('meta', { sessionId: 'sess-reuse', chunks: [] }) + sse('done', { finalText: 'First' }),
      )
    })

    // Second call: must include the sessionId from the first response
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body2 = JSON.parse(String(init?.body ?? '{}'))
      expect(body2.sessionId).toBe('sess-reuse')

      return sseResponse(
        sse('meta', { sessionId: 'sess-reuse', chunks: [] }) + sse('done', { finalText: 'Second' }),
      )
    })

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('first')
    await flushMicrotasks()

    expect(result.current.messages.length).toBeGreaterThanOrEqual(2)

    // Wait a tick so React flushes the activeSessionId state update
    await new Promise((resolve) => setTimeout(resolve, 0))

    await result.current.sendQuery('second')
    await flushMicrotasks()

    expect(result.current.messages.length).toBeGreaterThanOrEqual(3)

    unmount()
  })

  it('should expose activeSessionId and store it in localStorage on meta', async () => {
    mockChatSSE(
      sse('meta', { sessionId: 'sess-store', chunks: [] }) + sse('done', { finalText: 'OK' }),
    )

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    expect(result.current.activeSessionId).toBeNull()

    await result.current.sendQuery('hello')
    await flushMicrotasks()

    expect(result.current.activeSessionId).toBe('sess-store')
    expect(window.localStorage.getItem('cloud-notebook:session:nb-1')).toBe('sess-store')

    unmount()
  })

  it('should restore activeSessionId from localStorage on mount', async () => {
    const fetchMock = globalThis.fetch as Mock
    window.localStorage.setItem('cloud-notebook:session:nb-1', 'sess-restore')

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Previous question',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Previous answer',
          created_at: '2024-01-01T00:00:01Z',
        },
      ],
    })

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()
    await vi.waitFor(() => {
      expect(result.current.activeSessionId).toBe('sess-restore')
      expect(result.current.messages).toHaveLength(2)
    })

    expect(result.current.messages[0].content).toBe('Previous question')
    expect(result.current.messages[1].content).toBe('Previous answer')

    unmount()
  })

  it('should load session messages via loadSession', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Loaded question',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Loaded answer',
          created_at: '2024-01-01T00:00:01Z',
        },
      ],
    })

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.loadSession('sess-load')
    await flushMicrotasks()

    expect(result.current.activeSessionId).toBe('sess-load')
    expect(result.current.messages).toHaveLength(2)
    expect(window.localStorage.getItem('cloud-notebook:session:nb-1')).toBe('sess-load')

    unmount()
  })

  it('should clear localStorage on reset', async () => {
    mockChatSSE(
      sse('meta', { sessionId: 'sess-clear', chunks: [] }) + sse('done', { finalText: 'OK' }),
    )

    const { result, unmount } = renderHook(() => useChatStream('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.sendQuery('hello')
    await flushMicrotasks()

    expect(window.localStorage.getItem('cloud-notebook:session:nb-1')).toBe('sess-clear')

    result.current.reset()
    await flushMicrotasks()

    expect(result.current.activeSessionId).toBeNull()
    expect(window.localStorage.getItem('cloud-notebook:session:nb-1')).toBeNull()

    unmount()
  })
})
