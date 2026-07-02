import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted so the variables are available in the vi.mock factories
// (vi.mock is hoisted to the top, so we need hoisted variables too)
const { mockParseFile, mockChunkText } = vi.hoisted(() => ({
  mockParseFile: vi.fn(),
  mockChunkText: vi.fn(),
}))

vi.mock('../lib/sourceParser', () => ({
  parseFile: mockParseFile,
}))

vi.mock('../lib/tokenizer', () => ({
  chunkText: mockChunkText,
}))

import { useIngestPipeline } from './useIngestPipeline'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name: string, size = 1024, type = 'application/pdf'): File {
  const buf = new ArrayBuffer(size)
  return new File([buf], name, { type })
}

function directBody(prefix = '') {
  return {
    r2Key: `notebooks/nb-1/sources/src-1/${prefix}key`,
    etag: 'mock-etag',
    size: 1024,
  }
}

function finalizeBody() {
  return { id: 'src-1', status: 'ready', chunks: 2, images: 0 }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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

// ── URL-matched fetch mock for the ingestion API ────────────────────────────
//
// - POST /api/uploads/direct  → consumes from directQueue (FIFO) and returns
//   a JSON body that includes the r2Key
// - POST /api/sources/finalize → 200 / finalizeBody
//
// For the failure test, callers can provide a `failPredicate` function that
// receives the request URL (with query) and returns an error response if the
// upload should fail.

function mockIngestApi(opts?: { failPredicate?: (url: string) => boolean }) {
  const directQueue: Array<{ r2Key: string }> = []
  const fetchMock = globalThis.fetch as Mock
  fetchMock.mockImplementation(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input)

    // Direct upload endpoint
    if (url.startsWith('/api/uploads/direct') || url.includes('/api/uploads/direct')) {
      if (opts?.failPredicate?.(url)) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: 'Server Error' }),
        }
      }

      if (directQueue.length === 0) {
        throw new Error(`Unexpected direct upload call — no more responses: ${url}`)
      }
      // biome-ignore lint/style/noNonNullAssertion: queue length checked above
      const body = directQueue.shift()!
      return { ok: true, status: 200, json: async () => body }
    }

    // Finalize endpoint
    if (url.endsWith('/api/sources/finalize')) {
      return {
        ok: true,
        status: 200,
        json: async () => finalizeBody(),
      }
    }

    throw new Error(`Unmocked fetch: ${url}`)
  })

  return {
    pushDirect(...bodies: Array<{ r2Key: string }>) {
      directQueue.push(...bodies)
    },
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('useIngestPipeline', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000')
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should transition a single file through all stages to done', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'hello world' }],
      fullText: 'hello world',
    })
    mockChunkText.mockReturnValue([{ content: 'hello world', tokenCount: 2 }])

    const api = mockIngestApi()
    api.pushDirect(directBody())

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))

    await flushMicrotasks()
    expect(result.current).toBeDefined()
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.progress).toHaveLength(0)

    const file = makeFile('report.pdf')
    await result.current.uploadFiles([file])
    await flushMicrotasks()

    expect(result.current.isProcessing).toBe(false)
    expect(result.current.progress).toHaveLength(1)

    const item = result.current.progress[0]
    expect(item.fileName).toBe('report.pdf')
    expect(item.status).toBe('done')
    expect(item.percent).toBe(100)
    expect(item.error).toBeUndefined()

    unmount()
  })

  it('should upload images concurrently (3 pages) and reach done', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [
        { pageNumber: 1, text: 'page 1', imageBlob: new Blob(['img1']) },
        { pageNumber: 2, text: 'page 2', imageBlob: new Blob(['img2']) },
        { pageNumber: 3, text: 'page 3', imageBlob: new Blob(['img3']) },
      ],
      fullText: 'page 1 page 2 page 3',
    })
    mockChunkText.mockReturnValue([{ content: 'page 1 page 2 page 3', tokenCount: 6 }])

    // 1 presign for the PDF + 3 presigns for images
    const api = mockIngestApi()
    api.pushDirect(
      directBody('pdf-'),
      directBody('img1-'),
      directBody('img2-'),
      directBody('img3-'),
    )

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.uploadFiles([makeFile('multi.pdf')])
    await flushMicrotasks()

    expect(result.current.progress).toHaveLength(1)
    expect(result.current.progress[0].error).toBeUndefined()
    expect(result.current.progress[0].status).toBe('done')
    expect(result.current.progress[0].percent).toBe(100)

    const fetchCalls = (globalThis.fetch as Mock).mock.calls
    const directCalls = fetchCalls.filter(([url]: [string, RequestInit]) =>
      String(url).includes('/api/uploads/direct'),
    )
    expect(directCalls.length).toBe(4) // 1 PDF + 3 page images

    unmount()
  })

  it('should continue processing remaining files when one fails on presign', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    // file1 (fail.pdf) → failPredicate returns true → 500 error
    // file2 (ok.pdf) → upload succeeds
    const api = mockIngestApi({
      failPredicate: (url: string) => url.includes('fail.pdf'),
    })
    api.pushDirect(directBody('ok-'))

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.uploadFiles([makeFile('fail.pdf'), makeFile('ok.pdf')])
    await flushMicrotasks()

    expect(result.current.isProcessing).toBe(false)
    expect(result.current.progress).toHaveLength(2)

    const failItem = result.current.progress.find((p) => p.fileName === 'fail.pdf')
    const okItem = result.current.progress.find((p) => p.fileName === 'ok.pdf')

    expect(failItem?.status).toBe('error')
    expect(failItem?.error).toBeTruthy()
    if (failItem?.error) {
      expect(failItem.error).toContain('File upload failed')
    }

    expect(okItem?.status).toBe('done')
    expect(okItem?.percent).toBe(100)

    unmount()
  })

  it('should reflect isProcessing correctly', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    const api = mockIngestApi()

    // Gate the first fetch call so we can inspect isProcessing mid-flight
    let resolveDirect!: () => void
    const directGate = new Promise<void>((resolve) => {
      resolveDirect = resolve
    })

    const fetchMock = globalThis.fetch as Mock
    // After the normal mock is set up, override the first call only
    const originalImpl = fetchMock.getMockImplementation()
    fetchMock.mockReset()
    fetchMock.mockImplementationOnce(async (input: string | URL | Request, init?: RequestInit) => {
      await directGate
      // Forward to the original mock after releasing the gate
      return (
        (await originalImpl?.(input, init)) ?? {
          ok: true,
          status: 200,
          json: async () => directBody(),
        }
      )
    })
    // Remaining calls use the normal mock
    if (originalImpl) {
      fetchMock.mockImplementation(originalImpl)
    }

    // Push the direct upload response that will be consumed after the gate opens
    api.pushDirect(directBody())

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    expect(result.current.isProcessing).toBe(false)

    const uploadPromise = result.current.uploadFiles([makeFile('test.pdf')])

    // Yield to let React flush state updates
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushMicrotasks()

    expect(result.current.isProcessing).toBe(true)

    // Release the gate
    resolveDirect()

    await uploadPromise
    await flushMicrotasks()

    expect(result.current.isProcessing).toBe(false)
    expect(result.current.progress[0].status).toBe('done')

    unmount()
  })

  it('should reset progress and isProcessing', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    const api = mockIngestApi()
    api.pushDirect(directBody())

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    await result.current.uploadFiles([makeFile('doc.pdf')])
    await flushMicrotasks()

    expect(result.current.progress).toHaveLength(1)

    result.current.reset()
    await flushMicrotasks()

    expect(result.current.progress).toHaveLength(0)
    expect(result.current.isProcessing).toBe(false)

    unmount()
  })
})

// ── clearAllErrors and auto-dismiss ──────────────────────────────────────────

describe('clearAllErrors and auto-dismiss', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000')
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should auto-dismiss done items after 1 second', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'hello' }],
      fullText: 'hello',
    })
    mockChunkText.mockReturnValue([{ content: 'hello', tokenCount: 1 }])

    const api = mockIngestApi()
    api.pushDirect(directBody())

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    // Install fake timers after component has rendered
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await act(async () => {
      await result.current.uploadFiles([makeFile('report.pdf')])
    })

    // Item should be done
    expect(result.current.progress).toHaveLength(1)
    expect(result.current.progress[0].status).toBe('done')

    // Advance time by 1 second — item should be removed
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.progress).toHaveLength(0)

    unmount()
  })

  it('should not auto-dismiss error items', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    const api = mockIngestApi({
      failPredicate: (url: string) => url.includes('fail.pdf'),
    })
    // No direct response pushed for fail.pdf — it will fail
    api.pushDirect(directBody('ok-'))

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await act(async () => {
      await result.current.uploadFiles([makeFile('fail.pdf'), makeFile('ok.pdf')])
    })

    expect(result.current.progress).toHaveLength(2)

    const failItem = result.current.progress.find((p) => p.fileName === 'fail.pdf')
    expect(failItem?.status).toBe('error')

    // Advance time by 5 seconds — error item should still be there
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    const failItemAfter = result.current.progress.find((p) => p.fileName === 'fail.pdf')
    expect(failItemAfter?.status).toBe('error')

    unmount()
  })

  it('should not auto-dismiss in-progress items', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    const api = mockIngestApi()
    api.pushDirect(directBody())

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    // Gate the first fetch call so we can inspect mid-flight
    let resolveDirect!: () => void
    const directGate = new Promise<void>((resolve) => {
      resolveDirect = resolve
    })

    const fetchMock = globalThis.fetch as Mock
    const originalImpl = fetchMock.getMockImplementation()
    fetchMock.mockReset()
    fetchMock.mockImplementationOnce(async (input: string | URL | Request, init?: RequestInit) => {
      await directGate
      return (
        (await originalImpl?.(input, init)) ?? {
          ok: true,
          status: 200,
          json: async () => directBody(),
        }
      )
    })
    if (originalImpl) {
      fetchMock.mockImplementation(originalImpl)
    }

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    // Start upload — it will pause at the presign gate
    const uploadPromise = result.current.uploadFiles([makeFile('doc.pdf')])
    // Let React flush the initial state update (pending item added)
    await act(async () => {})
    await act(async () => {})

    // Advance time — in-progress items should not be removed
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    // The item should still be present (in progress, not done yet)
    expect(result.current.progress.length).toBeGreaterThanOrEqual(1)
    expect(result.current.progress[0].status).not.toBe('done')

    // Release the gate and let the upload finish
    resolveDirect()
    await act(async () => {
      await uploadPromise
    })

    unmount()
  })

  it('should clearAllErrors remove only error items', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    const api = mockIngestApi({
      failPredicate: (url: string) => url.includes('fail.pdf'),
    })
    api.pushDirect(directBody('ok-'))

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await act(async () => {
      await result.current.uploadFiles([makeFile('fail.pdf'), makeFile('ok.pdf')])
    })

    expect(result.current.progress).toHaveLength(2)

    // Call clearAllErrors
    await act(async () => {
      result.current.clearAllErrors()
    })

    // Error item should be gone
    const failItem = result.current.progress.find((p) => p.fileName === 'fail.pdf')
    expect(failItem).toBeUndefined()

    // Done item should still be present
    const okItem = result.current.progress.find((p) => p.fileName === 'ok.pdf')
    expect(okItem?.status).toBe('done')

    unmount()
  })

  it('should be idempotent when calling clearAllErrors twice or with no errors', async () => {
    mockParseFile.mockResolvedValue({
      title: 'doc',
      pages: [{ pageNumber: 1, text: 'text' }],
      fullText: 'text',
    })
    mockChunkText.mockReturnValue([{ content: 'text', tokenCount: 1 }])

    const api = mockIngestApi()
    api.pushDirect(directBody())

    const { result, unmount } = renderHook(() => useIngestPipeline('nb-1', 'test-user'))
    await flushMicrotasks()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await act(async () => {
      await result.current.uploadFiles([makeFile('doc.pdf')])
    })

    // No errors — calling clearAllErrors should not throw
    await act(async () => {
      expect(() => result.current.clearAllErrors()).not.toThrow()
      expect(() => result.current.clearAllErrors()).not.toThrow()
    })

    // Done item should still be present (timer hasn't fired yet)
    expect(result.current.progress).toHaveLength(1)
    expect(result.current.progress[0].status).toBe('done')

    unmount()
  })
})
