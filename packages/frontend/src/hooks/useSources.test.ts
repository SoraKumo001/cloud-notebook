import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSources } from './useSources'

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

async function waitForSources(
  result: { current: { sources: { length: number }[] } },
  length: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(result.current.sources).toHaveLength(length)
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

describe('useSources', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load sources on mount', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(
      mockApiResponse([
        {
          id: 'src-1',
          name: 'report.pdf',
          type: 'pdf',
          status: 'completed',
          created_at: '2024-01-01T00:00:00Z',
        },
      ]),
    )

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 1)

    expect(result.current.loading).toBe(false)
    expect(result.current.sources[0].fileName).toBe('report.pdf')
    expect(result.current.sources[0].status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/sources', undefined)

    unmount()
  })

  it('should refresh sources', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValueOnce(mockApiResponse([]))

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 0)

    fetchMock.mockResolvedValueOnce(
      mockApiResponse([
        {
          id: 'src-2',
          name: 'article.txt',
          type: 'text',
          status: 'processing',
          created_at: '2024-01-02T00:00:00Z',
        },
      ]),
    )

    await result.current.refresh()
    await waitForSources(result, 1)

    expect(result.current.sources[0].fileName).toBe('article.txt')

    unmount()
  })

  it('should delete a source optimistically and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'src-1',
            name: 'report.pdf',
            type: 'pdf',
            status: 'completed',
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined })
      .mockResolvedValueOnce(mockApiResponse([]))

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 1)

    const deletePromise = result.current.deleteSource('src-1')

    // Check optimistic update (immediately removed)
    await vi.waitFor(() => {
      expect(result.current.sources).toHaveLength(0)
    })

    await deletePromise
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('/api/sources/src-1', { method: 'DELETE' })
    expect(result.current.sources).toHaveLength(0)

    unmount()
  })

  it('should rollback delete when API fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    const initialSources = [
      {
        id: 'src-1',
        name: 'report.pdf',
        type: 'pdf',
        status: 'completed',
        created_at: '2024-01-01T00:00:00Z',
      },
    ]
    fetchMock
      .mockResolvedValueOnce(mockApiResponse(initialSources))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Delete failed' }),
      })
      .mockResolvedValueOnce(mockApiResponse(initialSources))

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 1)

    await expect(result.current.deleteSource('src-1')).rejects.toMatchObject({
      code: 'server.internalError',
      fallbackMessage: 'Delete failed',
      status: 500,
    })
    await flushMicrotasks()

    // Restored to initial count
    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0].fileName).toBe('report.pdf')

    unmount()
  })

  it('should rename a source and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(
        mockApiResponse({
          id: 'src-1',
          notebook_id: 'nb-1',
          name: 'renamed.pdf',
          type: 'pdf',
          status: 'ready',
          r2_key: 'r2-key',
          created_at: '2024-01-01T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'src-1',
            name: 'renamed.pdf',
            type: 'pdf',
            status: 'ready',
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      )

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 0)

    await result.current.renameSource('src-1', 'renamed.pdf')
    await waitForSources(result, 1)

    expect(fetchMock).toHaveBeenCalledWith('/api/sources/src-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed.pdf' }),
    })
    expect(result.current.sources[0].fileName).toBe('renamed.pdf')

    unmount()
  })

  it('should reorder sources optimistically and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'src-1',
            name: 'first.pdf',
            type: 'pdf',
            status: 'ready',
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            id: 'src-2',
            name: 'second.txt',
            type: 'text',
            status: 'ready',
            created_at: '2024-01-02T00:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce(mockApiResponse({ ok: true }))
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'src-2',
            name: 'second.txt',
            type: 'text',
            status: 'ready',
            created_at: '2024-01-02T00:00:00Z',
          },
          {
            id: 'src-1',
            name: 'first.pdf',
            type: 'pdf',
            status: 'ready',
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      )

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 2)
    expect(result.current.sources[0].id).toBe('src-1')

    await result.current.reorderSources(['src-2', 'src-1'])
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/sources/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceIds: ['src-2', 'src-1'] }),
    })
    expect(result.current.sources[0].id).toBe('src-2')
    expect(result.current.sources[1].id).toBe('src-1')

    unmount()
  })

  it('should set error when reorder fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'src-1',
            name: 'first.pdf',
            type: 'pdf',
            status: 'ready',
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce(mockApiResponse({ error: 'Forbidden' }, 403))

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 1)

    await expect(result.current.reorderSources(['src-1'])).rejects.toMatchObject({
      code: 'auth.forbidden',
      fallbackMessage: 'Forbidden',
      status: 403,
    })
    await vi.waitFor(() => {
      expect(result.current.error).toBe('auth.forbidden:403')
    })

    unmount()
  })

  it('should update a notebook', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValueOnce(mockApiResponse([]))
    fetchMock.mockResolvedValueOnce(
      mockApiResponse({
        id: 'nb-1',
        title: 'Updated Title',
        description: 'Updated description',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      }),
    )

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 0)

    await result.current.updateNotebook('nb-1', {
      title: 'Updated Title',
      description: 'Updated description',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title', description: 'Updated description' }),
    })

    unmount()
  })

  it('should delete a notebook', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValueOnce(mockApiResponse([]))
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined })

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 0)

    await result.current.deleteNotebook('nb-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1', { method: 'DELETE' })

    unmount()
  })

  it('should set error when refresh fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ error: 'Server error' }, 500))

    const { result, unmount } = renderHook(() => useSources('nb-1'))
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

    const { result, unmount } = renderHook(() => useSources('nb-1'))
    await waitForSources(result, 0)

    await expect(result.current.deleteSource('src-1')).rejects.toMatchObject({
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
