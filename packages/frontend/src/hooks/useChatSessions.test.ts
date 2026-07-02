import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSessions } from './useChatSessions'

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function waitForSessions(
  result: { current: { sessions: { length: number }[] } },
  length: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(result.current.sessions).toHaveLength(length)
  })
}

function mockApiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('useChatSessions', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load sessions on mount', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(
      mockApiResponse([
        { id: 'session-1', title: 'First chat', created_at: '2024-01-01T00:00:00Z' },
        { id: 'session-2', title: 'Second chat', created_at: '2024-01-02T00:00:00Z' },
      ]),
    )

    const { result, unmount } = renderHook(() => useChatSessions('nb-1'))
    await waitForSessions(result, 2)

    expect(result.current.loading).toBe(false)
    expect(result.current.sessions[0].title).toBe('First chat')
    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/sessions', undefined)

    unmount()
  })

  it('should refresh sessions', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValueOnce(mockApiResponse([]))

    const { result, unmount } = renderHook(() => useChatSessions('nb-1'))
    await waitForSessions(result, 0)

    fetchMock.mockResolvedValueOnce(
      mockApiResponse([
        { id: 'session-3', title: 'Third chat', created_at: '2024-01-03T00:00:00Z' },
      ]),
    )

    await result.current.refresh()
    await waitForSessions(result, 1)

    expect(result.current.sessions[0].title).toBe('Third chat')

    unmount()
  })

  it('should delete a session and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined })
      .mockResolvedValueOnce(mockApiResponse([]))

    const { result, unmount } = renderHook(() => useChatSessions('nb-1'))
    await waitForSessions(result, 0)

    await result.current.deleteSession('session-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1', { method: 'DELETE' })
    expect(result.current.sessions).toHaveLength(0)

    unmount()
  })

  it('should rename a session and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(
        mockApiResponse({
          id: 'session-1',
          notebook_id: 'nb-1',
          title: 'Renamed chat',
          created_at: '2024-01-01T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        mockApiResponse([
          { id: 'session-1', title: 'Renamed chat', created_at: '2024-01-01T00:00:00Z' },
        ]),
      )

    const { result, unmount } = renderHook(() => useChatSessions('nb-1'))
    await waitForSessions(result, 0)

    await result.current.renameSession('session-1', 'Renamed chat')
    await waitForSessions(result, 1)

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed chat' }),
    })
    expect(result.current.sessions[0].title).toBe('Renamed chat')

    unmount()
  })

  it('should set error when refresh fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ error: 'Server error' }, 500))

    const { result, unmount } = renderHook(() => useChatSessions('nb-1'))
    await vi.waitFor(() => {
      expect(result.current.error).toBe('server.internalError:500')
    })

    unmount()
  })

  it('should set error when delete fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(mockApiResponse({ error: 'Forbidden' }, 403))

    const { result, unmount } = renderHook(() => useChatSessions('nb-1'))
    await waitForSessions(result, 0)

    await expect(result.current.deleteSession('session-1')).rejects.toMatchObject({
      code: 'auth.forbidden',
      fallbackMessage: 'Forbidden',
      status: 403,
    })
    await vi.waitFor(() => {
      expect(result.current.error).toBe('auth.forbidden:403')
    })

    unmount()
  })
})
