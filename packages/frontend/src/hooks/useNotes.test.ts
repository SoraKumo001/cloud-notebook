import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotes } from './useNotes'

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

async function waitForNotes(
  result: { current: { notes: { length: number }[] } },
  length: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(result.current.notes).toHaveLength(length)
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

describe('useNotes', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load notes on mount', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(
      mockApiResponse([
        {
          id: 'note-1',
          title: 'First note',
          content: 'Hello',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]),
    )

    const { result, unmount } = renderHook(() => useNotes('nb-1'))
    await waitForNotes(result, 1)

    expect(result.current.loading).toBe(false)
    expect(result.current.notes[0].title).toBe('First note')
    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/notes')

    unmount()
  })

  it('should create a note and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(
        mockApiResponse({
          id: 'note-2',
          notebookId: 'nb-1',
          title: 'New note',
          content: 'Content',
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'note-2',
            title: 'New note',
            content: 'Content',
            createdAt: '2024-01-02T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
          },
        ]),
      )

    const { result, unmount } = renderHook(() => useNotes('nb-1'))
    await waitForNotes(result, 0)

    const created = await result.current.createNote('New note', 'Content')
    await flushMicrotasks()

    expect(created.title).toBe('New note')
    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New note', content: 'Content' }),
    })
    expect(result.current.notes).toHaveLength(1)

    unmount()
  })

  it('should update a note and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'note-1',
            title: 'Old title',
            content: 'Old content',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce(
        mockApiResponse({
          id: 'note-1',
          notebookId: 'nb-1',
          title: 'Updated title',
          content: 'Updated content',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'note-1',
            title: 'Updated title',
            content: 'Updated content',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
          },
        ]),
      )

    const { result, unmount } = renderHook(() => useNotes('nb-1'))
    await waitForNotes(result, 1)

    await result.current.updateNote('note-1', {
      title: 'Updated title',
      content: 'Updated content',
    })
    await vi.waitFor(() => {
      expect(result.current.notes[0].title).toBe('Updated title')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/notes/note-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title', content: 'Updated content' }),
    })

    unmount()
  })

  it('should delete a note and refresh', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(
        mockApiResponse([
          {
            id: 'note-1',
            title: 'Note',
            content: 'Content',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined })
      .mockResolvedValueOnce(mockApiResponse([]))

    const { result, unmount } = renderHook(() => useNotes('nb-1'))
    await waitForNotes(result, 1)

    await result.current.deleteNote('note-1')
    await waitForNotes(result, 0)

    expect(fetchMock).toHaveBeenCalledWith('/api/notes/note-1', { method: 'DELETE' })

    unmount()
  })

  it('should set error when refresh fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ error: 'Server error' }, 500))

    const { result, unmount } = renderHook(() => useNotes('nb-1'))
    await vi.waitFor(() => {
      expect(result.current.error).toBe('Failed to load notes: 500')
    })

    unmount()
  })

  it('should set error when create fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(mockApiResponse({ error: 'Bad request' }, 400))

    const { result, unmount } = renderHook(() => useNotes('nb-1'))
    await waitForNotes(result, 0)

    await expect(result.current.createNote('', '')).rejects.toThrow('Bad request')
    await vi.waitFor(() => {
      expect(result.current.error).toBe('Bad request')
    })

    unmount()
  })
})
