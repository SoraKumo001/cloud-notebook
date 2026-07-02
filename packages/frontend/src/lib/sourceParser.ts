// ── Types ────────────────────────────────────────────────────────────────────

export type SourceType = 'pdf' | 'text' | 'webpage' | 'docx'

export interface ParsedSource {
  type: SourceType
  title: string
  pages: Array<{
    text: string
    imageBlob?: Blob
    pageNumber?: number
  }>
  fullText: string
  metadata?: {
    url?: string
    fileName?: string
    author?: string
  }
}

// ── Parse dispatcher ─────────────────────────────────────────────────────────

/**
 * Parse a file according to its source type.
 *
 * - `'pdf'`   → delegates to `pdfParser.parsePDF` (dynamically imported)
 * - `'text'`  → not yet implemented (L2)
 * - `'docx'`  → not yet implemented (L6)
 * - `'webpage'` → use `parseWebpage()` instead
 */
export async function parseFile(file: File, type: SourceType): Promise<ParsedSource> {
  switch (type) {
    case 'pdf': {
      const arrayBuffer = await file.arrayBuffer()
      const { parsePDF } = await import('./pdfParser')
      const result = await parsePDF(arrayBuffer, true)

      return {
        type: 'pdf',
        title: result.title,
        pages: result.pages.map((p) => ({
          text: p.text,
          imageBlob: p.imageBlob,
          pageNumber: p.pageNumber,
        })),
        fullText: result.fullText,
        metadata: { fileName: file.name },
      }
    }

    case 'text': {
      const { parseTextFile } = await import('./textParser')
      return parseTextFile(file)
    }

    case 'docx': {
      const { parseDocxFile } = await import('./docxParser')
      return parseDocxFile(file)
    }

    default:
      // Exhaustiveness guard – ensures all SourceType values are handled
      throw new Error(`Not implemented yet: ${type satisfies never}`)
  }
}

/**
 * Parse content from a URL (webpage). Uses the backend CORS proxy to fetch
 * the HTML, then extracts text via DOMParser.
 */
export async function parseWebpage(url: string): Promise<ParsedSource> {
  const { parseWebpageUrl } = await import('./webpageParser')
  return parseWebpageUrl(url)
}
