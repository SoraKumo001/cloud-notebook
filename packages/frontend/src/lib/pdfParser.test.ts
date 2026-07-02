import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks (available inside vi.mock factories) ───────────────────────

const { mockGetDocument, mockGetPage, mockGetViewport, mockRender } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockGetPage: vi.fn<(pageNum: number) => unknown>(),
  mockGetViewport: vi.fn(() => ({ width: 600, height: 800 })),
  mockRender: vi.fn(() => ({ promise: Promise.resolve() })),
}))

vi.mock('pdfjs-dist', () => ({
  getDocument: mockGetDocument,
  GlobalWorkerOptions: { workerSrc: '' },
  version: '4.0.0',
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePage(pageNum: number, text: string) {
  return {
    pageNumber: pageNum,
    getTextContent: () =>
      Promise.resolve({
        items: [{ str: text }],
      }),
    getViewport: mockGetViewport,
    render: mockRender,
  }
}

function makePdf(pages: ReturnType<typeof makePage>[]) {
  const numPages = pages.length
  // Set up getPage(index) – index is 1‑based in pdfjs
  for (let i = 0; i < pages.length; i++) {
    mockGetPage.mockImplementationOnce(() => Promise.resolve(pages[i]))
  }
  return {
    numPages,
    getPage: mockGetPage,
  }
}

function setupPdfjs(pages: ReturnType<typeof makePage>[]) {
  const pdf = makePdf(pages)
  mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset the cached pdfjs module so each test gets a fresh import
  // (the module-level `cachedPdfjs` variable is reset via clearAllMocks on the mock)
})

// ── Suite ────────────────────────────────────────────────────────────────────

describe('pdfParser', () => {
  it('should extract text from a single-page PDF', async () => {
    setupPdfjs([makePage(1, 'Hello World')])

    const { parsePDF } = await import('./pdfParser')
    const result = await parsePDF(new ArrayBuffer(8), false)

    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].text).toBe('Hello World')
    expect(result.pages[0].pageNumber).toBe(1)
  })

  it('should extract text from multiple pages', async () => {
    setupPdfjs([makePage(1, 'Page One'), makePage(2, 'Page Two')])

    const { parsePDF } = await import('./pdfParser')
    const result = await parsePDF(new ArrayBuffer(16), false)

    expect(result.pages).toHaveLength(2)
    expect(result.pages[0].text).toBe('Page One')
    expect(result.pages[1].text).toBe('Page Two')
  })

  it('should return fullText as concatenation of all pages', async () => {
    setupPdfjs([makePage(1, 'First page text.'), makePage(2, 'Second page text.')])

    const { parsePDF } = await import('./pdfParser')
    const result = await parsePDF(new ArrayBuffer(16), false)

    expect(result.fullText).toContain('First page text.')
    expect(result.fullText).toContain('Second page text.')
  })

  it('should return imageBlob when extractImages=true and canvas is available', async () => {
    setupPdfjs([makePage(1, 'Page with image')])

    // Mock canvas to support image extraction
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tagName, options)
        if (tagName === 'canvas') {
          const canvas = el as HTMLCanvasElement
          vi.spyOn(canvas, 'getContext').mockReturnValue({
            /* dummy canvas context */
          } as unknown as CanvasRenderingContext2D)
          vi.spyOn(canvas, 'toBlob').mockImplementation((callback: BlobCallback) => {
            callback(new Blob(['fake-image'], { type: 'image/jpeg' }))
          })
        }
        return el
      },
    )

    const { parsePDF } = await import('./pdfParser')
    const result = await parsePDF(new ArrayBuffer(8), true)

    expect(result.pages[0].imageBlob).toBeDefined()
    expect(result.pages[0].imageBlob).toBeInstanceOf(Blob)
  })

  it('should not create imageBlob when extractImages=false', async () => {
    setupPdfjs([makePage(1, 'No image')])

    const { parsePDF } = await import('./pdfParser')
    const result = await parsePDF(new ArrayBuffer(8), false)

    expect(result.pages[0].imageBlob).toBeUndefined()
  })

  it('should handle PDF loading errors gracefully', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('Corrupt PDF')),
    })

    const { parsePDF } = await import('./pdfParser')
    await expect(parsePDF(new ArrayBuffer(8), false)).rejects.toThrow('Corrupt PDF')
  })
})
