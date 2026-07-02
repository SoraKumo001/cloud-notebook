/**
 * Regression tests for useNotebookStats.
 *
 * Bug context: the stats header (vector count) in SourceList used to only
 * fetch on initial mount because the hook's useEffect ignored the
 * `sourcesVersion` argument. Deleting or uploading a source updated the
 * count badge only after a full page reload. This test guards the fix.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotebookStats } from './useNotebookStats'

// ── Test harness ─────────────────────────────────────────────────────────────

interface RenderHookResult<T> {
  result: { current: T }
  unmount: () => void
  rerender: (newProps: T) => void
}

function renderHookWithProps<TProps, TReturn>(
  useHook: (props: TProps) => TReturn,
  initialProps: TProps,
): RenderHookResult<TReturn> {
  const result: { current: TReturn } = { current: undefined as unknown as TReturn }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let currentProps = initialProps

  function TestComponent({ props }: { props: TProps }) {
    result.current = useHook(props)
    return null
  }

  function render() {
    root.render(React.createElement(TestComponent, { props: currentProps }))
  }

  render()

  return {
    result,
    unmount: () => {
      root.unmount()
      document.body.removeChild(container)
    },
    rerender: (newProps: TReturn) => {
      currentProps = newProps as unknown as TProps
      render()
    },
  }
}

function mockApiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

interface TestProps {
  id: string
  version: number
}

function useStatsHarness(props: TestProps) {
  return useNotebookStats(props.id, props.version)
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('useNotebookStats', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches stats on initial mount', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ notebookVectorCount: 0, globalVectorCount: 0 }))

    const { result, unmount } = renderHookWithProps<TestProps, ReturnType<typeof useStatsHarness>>(
      useStatsHarness,
      { id: 'nb-1', version: 0 },
    )

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1/stats')
    expect(result.current.loading).toBe(false)
    unmount()
  })

  it('refetches when sourcesVersion changes', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ notebookVectorCount: 0, globalVectorCount: 0 }))

    const { rerender, unmount } = renderHookWithProps<
      TestProps,
      ReturnType<typeof useStatsHarness>
    >(useStatsHarness, { id: 'nb-1', version: 0 })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    // Simulate the source count changing (delete / upload finished)
    rerender({ id: 'nb-1', version: 1 })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    rerender({ id: 'nb-1', version: 2 })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    unmount()
  })

  it('refetches when notebookId changes', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ notebookVectorCount: 0, globalVectorCount: 0 }))

    const { rerender, unmount } = renderHookWithProps<
      TestProps,
      ReturnType<typeof useStatsHarness>
    >(useStatsHarness, { id: 'nb-1', version: 0 })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    rerender({ id: 'nb-2', version: 0 })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/notebooks/nb-2/stats')

    unmount()
  })

  it('does not fetch when notebookId is empty', () => {
    const fetchMock = globalThis.fetch as Mock

    const { unmount } = renderHookWithProps<TestProps, ReturnType<typeof useStatsHarness>>(
      useStatsHarness,
      { id: '', version: 0 },
    )

    expect(fetchMock).not.toHaveBeenCalled()
    unmount()
  })

  it('manual refresh() triggers a new fetch', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(mockApiResponse({ notebookVectorCount: 0, globalVectorCount: 0 }))

    const { result, unmount } = renderHookWithProps<TestProps, ReturnType<typeof useStatsHarness>>(
      useStatsHarness,
      { id: 'nb-1', version: 0 },
    )

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await result.current.refresh()
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    unmount()
  })

  it('updates stats state after a successful fetch', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValueOnce(
      mockApiResponse({ notebookVectorCount: 23, globalVectorCount: 61 }),
    )

    const { result, unmount } = renderHookWithProps<TestProps, ReturnType<typeof useStatsHarness>>(
      useStatsHarness,
      { id: 'nb-1', version: 0 },
    )

    await vi.waitFor(() => {
      expect(result.current.stats).toEqual({
        notebookVectorCount: 23,
        globalVectorCount: 61,
      })
    })

    unmount()
  })

  it('captures error message when the server returns non-OK', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as Response)

    const { result, unmount } = renderHookWithProps<TestProps, ReturnType<typeof useStatsHarness>>(
      useStatsHarness,
      { id: 'nb-1', version: 0 },
    )

    await vi.waitFor(() => {
      expect(result.current.error).toMatch(/Failed to load stats: 500/)
    })

    unmount()
  })
})
