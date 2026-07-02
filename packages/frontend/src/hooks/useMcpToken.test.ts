import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpToken } from './useMcpToken'

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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFetch(
  result: { current: { loading: boolean } | undefined },
  fetchMock: Mock,
): Promise<void> {
  // Happy-dom + React 18: the mount-time useEffect + the async refresh both
  // need a couple of microtask ticks to settle. Poll up to ~50ms.
  for (let i = 0; i < 10; i++) {
    if (fetchMock.mock.calls.length > 0 && !result.current?.loading) return
    await flushMicrotasks()
  }
}

async function waitForCallCount(
  fetchMock: Mock,
  count: number,
  result: { current: { loading: boolean } | undefined },
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (fetchMock.mock.calls.length >= count && !result.current?.loading) return
    await flushMicrotasks()
  }
}

function mockApiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('useMcpToken', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should report hasToken=false initially and fetch on mount', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ has_token: false }))

    const { result, unmount } = renderHook(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/mcp-token', {
      method: 'GET',
    })
    expect(result.current.hasToken).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()

    unmount()
  })

  it('should reflect hasToken=true and surface lastGeneratedToken after generation', async () => {
    const fetchMock = globalThis.fetch as Mock
    // First call: mount-time GET returns no token.
    // Second call: POST returns the new token.
    fetchMock
      .mockResolvedValueOnce(mockApiResponse({ has_token: false }))
      .mockResolvedValueOnce(mockApiResponse({ token: 'cn_test_token_123' }))

    const { result, unmount } = renderHook(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)
    expect(result.current.hasToken).toBe(false)
    expect(result.current.lastGeneratedToken).toBeNull()

    await result.current.generateToken()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/notebooks/nb-1/mcp-token', {
      method: 'POST',
    })
    expect(result.current.hasToken).toBe(true)
    expect(result.current.lastGeneratedToken).toBe('cn_test_token_123')
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)

    unmount()
  })

  it('should clear lastGeneratedToken when clearLastGeneratedToken is called', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse({ has_token: false }))
      .mockResolvedValueOnce(mockApiResponse({ token: 'cn_test_token_123' }))

    const { result, unmount } = renderHook(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)
    await result.current.generateToken()
    await flushMicrotasks()
    expect(result.current.lastGeneratedToken).toBe('cn_test_token_123')

    result.current.clearLastGeneratedToken()
    await flushMicrotasks()
    expect(result.current.lastGeneratedToken).toBeNull()
    // hasToken stays true; the token still exists on the server.
    expect(result.current.hasToken).toBe(true)

    unmount()
  })

  it('should set error when generate fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse({ has_token: false }))
      .mockResolvedValueOnce(mockApiResponse({ error: 'Forbidden' }, 403))

    const { result, unmount } = renderHook(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)
    await result.current.generateToken()
    await flushMicrotasks()

    expect(result.current.hasToken).toBe(false)
    expect(result.current.error).toBe('auth.forbidden:403')
    expect(result.current.loading).toBe(false)

    unmount()
  })

  it('should set hasToken=false after revoke', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse({ has_token: false }))
      .mockResolvedValueOnce(mockApiResponse({ token: 'cn_test_token_123' }))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined })

    const { result, unmount } = renderHook(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)
    await result.current.generateToken()
    await flushMicrotasks()
    expect(result.current.hasToken).toBe(true)

    await result.current.revokeToken()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/notebooks/nb-1/mcp-token', {
      method: 'DELETE',
    })
    expect(result.current.hasToken).toBe(false)
    expect(result.current.lastGeneratedToken).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)

    unmount()
  })

  it('should set error when revoke fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse({ has_token: true }))
      .mockResolvedValueOnce(mockApiResponse({ error: 'Not found' }, 404))

    const { result, unmount } = renderHook(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)
    expect(result.current.hasToken).toBe(true)

    await result.current.revokeToken()
    await flushMicrotasks()

    expect(result.current.hasToken).toBe(true) // unchanged on error
    expect(result.current.error).toBe('errors.generic:404')
    expect(result.current.loading).toBe(false)

    unmount()
  })

  it('should refetch when notebookId changes', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ has_token: true }))

    const { result, unmount, rerender } = renderHookWithRerender(() => useMcpToken('nb-1'))
    await waitForFetch(result, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.hasToken).toBe(true)

    rerender(() => useMcpToken('nb-2'))
    await waitForCallCount(fetchMock, 2, result)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/notebooks/nb-2/mcp-token', {
      method: 'GET',
    })

    unmount()
  })
})

// ── Rerender helper for the notebookId change test ────────────────────────────

interface RenderHookWithRerenderResult<T> extends RenderHookResult<T> {
  rerender: (nextUseHook: () => T) => void
}

function renderHookWithRerender<T>(useHook: () => T): RenderHookWithRerenderResult<T> {
  const result: { current: T } = { current: undefined as unknown as T }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  let currentUseHook: () => T = useHook
  function TestComponent() {
    result.current = currentUseHook()
    return null
  }
  root.render(React.createElement(TestComponent))

  return {
    result,
    unmount: () => {
      root.unmount()
      document.body.removeChild(container)
    },
    rerender: (nextUseHook: () => T) => {
      currentUseHook = nextUseHook
      root.render(React.createElement(TestComponent))
    },
  }
}
