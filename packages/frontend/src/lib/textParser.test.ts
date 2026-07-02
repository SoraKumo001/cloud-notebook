import { describe, expect, it } from 'vitest'
import { parseTextFile } from './textParser'

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' })
}

describe('textParser', () => {
  describe('parseTextFile', () => {
    it('should parse a plain .txt file', async () => {
      const file = makeFile('notes.txt', 'Hello, world!\nThis is a text file.')
      const result = await parseTextFile(file)

      expect(result.type).toBe('text')
      expect(result.title).toBe('notes')
      expect(result.fullText).toBe('Hello, world!\nThis is a text file.')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].text).toBe(result.fullText)
      expect(result.pages[0].pageNumber).toBe(1)
      expect(result.pages[0].imageBlob).toBeUndefined()
      expect(result.metadata?.fileName).toBe('notes.txt')
    })

    it('should strip YAML front matter from .md files', async () => {
      const file = makeFile(
        'article.md',
        '---\ntitle: My Article\ndate: 2025-01-01\n---\n\n# Hello\n\nThis is the body.',
      )
      const result = await parseTextFile(file)

      expect(result.title).toBe('Hello')
      expect(result.fullText).not.toContain('---')
      expect(result.fullText).not.toContain('title: My Article')
      expect(result.fullText).toContain('# Hello')
      expect(result.fullText).toContain('This is the body.')
    })

    it('should handle .md files without front matter', async () => {
      const file = makeFile('readme.md', '# Project Title\n\nDescription here.')
      const result = await parseTextFile(file)

      expect(result.title).toBe('Project Title')
      expect(result.fullText).toBe('# Project Title\n\nDescription here.')
    })

    it('should derive title from file name when no Markdown heading', async () => {
      const file = makeFile('my-notes.txt', 'Some content without a heading.')
      const result = await parseTextFile(file)

      expect(result.title).toBe('my-notes')
    })

    it('should handle empty file', async () => {
      const file = makeFile('empty.txt', '')
      const result = await parseTextFile(file)

      expect(result.title).toBe('empty')
      expect(result.fullText).toBe('')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].text).toBe('')
    })

    it('should use "Untitled" for an extensionless empty file', async () => {
      const file = makeFile('', '')
      const result = await parseTextFile(file)

      expect(result.title).toBe('Untitled')
    })
  })
})
