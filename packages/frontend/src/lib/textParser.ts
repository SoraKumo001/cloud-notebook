import type { ParsedSource, SourceType } from './sourceParser'

/**
 * Extract a title from the file name (strip extension) or the first `# ` heading.
 */
function extractTitle(fileName: string, text: string): string {
  // Prefer the first Markdown H1 heading
  const headingMatch = text.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  // Fall back to file name without extension
  const name = fileName.replace(/\.[^.]+$/, '')
  return name || 'Untitled'
}

/**
 * Remove YAML front matter (`---\n...\n---`) from the beginning of the text.
 * Returns the cleaned text and a boolean indicating whether front matter was found.
 */
function stripFrontMatter(text: string): { clean: string; hadFrontMatter: boolean } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (match) {
    return { clean: text.slice(match[0].length), hadFrontMatter: true }
  }
  return { clean: text, hadFrontMatter: false }
}

/**
 * Parse a plain-text or Markdown file into a ParsedSource.
 *
 * - Reads the file content via `file.text()`
 * - Strips YAML front matter from `.md` files
 * - Extracts title from the first `# ` heading or the file name
 * - Returns the full text as a single page (no image extraction)
 */
export async function parseTextFile(file: File): Promise<ParsedSource> {
  const raw = await file.text()
  const isMarkdown = file.name.endsWith('.md')

  const { clean: fullText } = isMarkdown ? stripFrontMatter(raw) : { clean: raw }
  const title = extractTitle(file.name, raw)

  return {
    type: 'text' as SourceType,
    title,
    pages: [{ text: fullText, pageNumber: 1 }],
    fullText,
    metadata: { fileName: file.name },
  }
}
