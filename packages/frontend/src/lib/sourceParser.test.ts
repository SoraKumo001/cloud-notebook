import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock pdfParser (intercepts the dynamic import inside sourceParser) ────────

const mockParsePDF = vi.fn()
const mockParseDocx = vi.fn()
const mockParseWebpageUrl = vi.fn()

vi.mock('./pdfParser', () => ({
  parsePDF: mockParsePDF,
}))

vi.mock('./docxParser', () => ({
  parseDocxFile: mockParseDocx,
}))

vi.mock('./webpageParser', () => ({
  parseWebpageUrl: mockParseWebpageUrl,
}))

import { parseFile, parseWebpage } from './sourceParser'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name: string, content = 'test', type = 'application/pdf'): File {
  return new File([content], name, { type })
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('sourceParser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseFile', () => {
    it('should delegate PDF type to pdfParser.parsePDF', async () => {
      mockParsePDF.mockResolvedValue({
        title: 'Test PDF',
        pages: [{ pageNumber: 1, text: 'Page 1 content', imageBlob: undefined }],
        fullText: 'Page 1 content',
      })

      const result = await parseFile(makeFile('doc.pdf'), 'pdf')

      expect(mockParsePDF).toHaveBeenCalledTimes(1)
      expect(result.type).toBe('pdf')
      expect(result.title).toBe('Test PDF')
      expect(result.fullText).toBe('Page 1 content')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].text).toBe('Page 1 content')
      expect(result.metadata?.fileName).toBe('doc.pdf')
    })

    it('should pass the file arrayBuffer to pdfParser', async () => {
      mockParsePDF.mockResolvedValue({
        title: 'Doc',
        pages: [],
        fullText: '',
      })

      const file = makeFile('test.pdf', 'fake pdf bytes')
      const readSpy = vi.spyOn(file, 'arrayBuffer')

      await parseFile(file, 'pdf')

      expect(readSpy).toHaveBeenCalledTimes(1)
      expect(mockParsePDF).toHaveBeenCalledWith(expect.any(ArrayBuffer), true)
    })

    it('should delegate text type to textParser', async () => {
      const result = await parseFile(makeFile('notes.txt', 'Hello'), 'text')
      expect(result.type).toBe('text')
      expect(result.fullText).toBe('Hello')
      expect(result.metadata?.fileName).toBe('notes.txt')
    })

    it('should delegate docx type to docxParser', async () => {
      mockParseDocx.mockResolvedValue({
        type: 'docx',
        title: 'Doc',
        pages: [{ text: 'Hello', pageNumber: 1 }],
        fullText: 'Hello',
        metadata: { fileName: 'doc.docx' },
      })

      const result = await parseFile(makeFile('doc.docx'), 'docx')

      expect(mockParseDocx).toHaveBeenCalledTimes(1)
      expect(result.type).toBe('docx')
      expect(result.fullText).toBe('Hello')
      expect(result.metadata?.fileName).toBe('doc.docx')
    })

    it('should include file name in metadata for PDF', async () => {
      mockParsePDF.mockResolvedValue({
        title: 'Doc',
        pages: [],
        fullText: '',
      })

      const result = await parseFile(makeFile('report.pdf'), 'pdf')
      expect(result.metadata?.fileName).toBe('report.pdf')
    })
  })

  describe('parseWebpage', () => {
    it('should delegate to webpageParser.parseWebpageUrl', async () => {
      mockParseWebpageUrl.mockResolvedValue({
        type: 'webpage',
        title: 'Example Page',
        pages: [{ text: 'Hello world', pageNumber: 1 }],
        fullText: 'Hello world',
        metadata: { url: 'https://example.com', fileName: 'https://example.com' },
      })

      const result = await parseWebpage('https://example.com')

      expect(mockParseWebpageUrl).toHaveBeenCalledTimes(1)
      expect(mockParseWebpageUrl).toHaveBeenCalledWith('https://example.com')
      expect(result.type).toBe('webpage')
      expect(result.title).toBe('Example Page')
    })
  })
})
