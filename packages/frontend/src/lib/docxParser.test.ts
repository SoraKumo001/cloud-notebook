import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ParsedSource } from './sourceParser'

// ── Mock mammoth (intercepts the dynamic import inside docxParser) ────────────

const mockExtractRawText = vi.fn()

vi.mock('mammoth/mammoth.browser', () => ({
  default: {
    extractRawText: mockExtractRawText,
  },
}))

import { parseDocxFile } from './docxParser'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDocxFile(name: string, text: string): File {
  // Use a realistic MIME type for .docx files
  return new File([text], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('docxParser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseDocxFile', () => {
    it('should extract text from a .docx file and return a ParsedSource', async () => {
      mockExtractRawText.mockResolvedValue({
        value: 'Hello, this is a Word document.',
        messages: [],
      })

      const file = makeDocxFile('report.docx', 'fake docx bytes')
      const result: ParsedSource = await parseDocxFile(file)

      expect(mockExtractRawText).toHaveBeenCalledTimes(1)
      expect(mockExtractRawText).toHaveBeenCalledWith({
        arrayBuffer: expect.any(ArrayBuffer),
      })

      expect(result.type).toBe('docx')
      expect(result.title).toBe('report')
      expect(result.fullText).toBe('Hello, this is a Word document.')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].text).toBe('Hello, this is a Word document.')
      expect(result.pages[0].pageNumber).toBe(1)
      expect(result.pages[0].imageBlob).toBeUndefined()
      expect(result.metadata?.fileName).toBe('report.docx')
    })

    it('should derive title from file name without extension', async () => {
      mockExtractRawText.mockResolvedValue({
        value: 'Some content.',
        messages: [],
      })

      const file = makeDocxFile('my-document.docx', 'bytes')
      const result = await parseDocxFile(file)

      expect(result.title).toBe('my-document')
    })

    it('should handle empty .docx file gracefully', async () => {
      mockExtractRawText.mockResolvedValue({
        value: '',
        messages: [],
      })

      const file = makeDocxFile('empty.docx', '')
      const result = await parseDocxFile(file)

      expect(result.title).toBe('empty')
      expect(result.fullText).toBe('')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].text).toBe('')
    })

    it('should treat the entire text as a single page', async () => {
      const longText = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.'
      mockExtractRawText.mockResolvedValue({
        value: longText,
        messages: [],
      })

      const file = makeDocxFile('multi.docx', 'bytes')
      const result = await parseDocxFile(file)

      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].text).toBe(longText)
      expect(result.pages[0].pageNumber).toBe(1)
      expect(result.fullText).toBe(longText)
    })

    it('should use "Untitled" for a file with only extension', async () => {
      mockExtractRawText.mockResolvedValue({
        value: 'content',
        messages: [],
      })

      const file = makeDocxFile('.docx', 'bytes')
      const result = await parseDocxFile(file)

      expect(result.title).toBe('Untitled')
    })
  })
})
