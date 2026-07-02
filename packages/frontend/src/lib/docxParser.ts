import type { ParsedSource } from './sourceParser'

/**
 * Parse a .docx file into a ParsedSource using mammoth.js.
 *
 * - Extracts raw text via mammoth.extractRawText({ arrayBuffer })
 * - Title is derived from the file name (extension stripped)
 * - The full text is returned as a single page (pageNumber: 1)
 * - No image extraction (planned for M8+)
 */
export async function parseDocxFile(file: File): Promise<ParsedSource> {
  const arrayBuffer = await file.arrayBuffer()

  // Dynamic import to keep initial bundle size small
  const mammothModule = await import('mammoth/mammoth.browser')
  const mammoth = mammothModule.default ?? mammothModule

  const result = await mammoth.extractRawText({ arrayBuffer })
  const fullText = result.value

  // Derive title from file name (strip extension)
  const title = file.name.replace(/\.[^.]+$/, '') || 'Untitled'

  return {
    type: 'docx',
    title,
    pages: [{ text: fullText, pageNumber: 1 }],
    fullText,
    metadata: { fileName: file.name },
  }
}
