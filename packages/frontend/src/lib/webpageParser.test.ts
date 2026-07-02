// packages/frontend/src/lib/webpageParser.test.ts
// Tests for webpage parser (extractFromHtml + parseWebpageUrl).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractFromHtml, parseWebpageUrl } from './webpageParser'

// Minimal valid HTML for testing
const BASE_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <h1>Welcome</h1>
  <p>This is the main content.</p>
</body>
</html>`

// ---------------------------------------------------------------------------
// extractFromHtml (pure, no I/O)
// ---------------------------------------------------------------------------

describe('extractFromHtml', () => {
  it('extracts text from basic HTML', () => {
    const result = extractFromHtml(BASE_HTML, 'https://example.com')
    expect(result.type).toBe('webpage')
    expect(result.title).toBe('Test Page')
    expect(result.fullText).toContain('This is the main content')
    expect(result.fullText).toContain('Welcome')
    expect(result.metadata?.url).toBe('https://example.com')
  })

  it('removes script and style tags', () => {
    const html = `<html><head><title>Test</title></head><body>
      <p>Visible text</p>
      <script>alert('hack')</script>
      <style>.hidden { display: none; }</style>
      <p>More visible</p>
    </body></html>`
    const result = extractFromHtml(html, 'https://example.com')
    expect(result.fullText).toContain('Visible text')
    expect(result.fullText).toContain('More visible')
    expect(result.fullText).not.toContain('alert')
    expect(result.fullText).not.toContain('hidden')
  })

  it('removes nav, footer, header, noscript, iframe, svg, canvas', () => {
    const html = `<html><head><title>Test</title></head><body>
      <header>Header</header>
      <nav>Navigation</nav>
      <p>Content</p>
      <footer>Footer</footer>
      <noscript>No JS fallback</noscript>
      <iframe src="other.html"></iframe>
      <svg><text>SVG</text></svg>
      <canvas>Canvas</canvas>
    </body></html>`
    const result = extractFromHtml(html, 'https://example.com')
    expect(result.fullText).toContain('Content')
    expect(result.fullText).not.toContain('Header')
    expect(result.fullText).not.toContain('Navigation')
    expect(result.fullText).not.toContain('Footer')
    expect(result.fullText).not.toContain('No JS')
  })

  it('falls back to <h1> when <title> is missing', () => {
    const html = `<html><body><h1>Heading One</h1><p>Text</p></body></html>`
    const result = extractFromHtml(html, 'https://example.com')
    expect(result.title).toBe('Heading One')
  })

  it('falls back to hostname when no title or h1', () => {
    const html = `<html><body><p>No headings</p></body></html>`
    const result = extractFromHtml(html, 'https://example.com')
    expect(result.title).toBe('example.com')
  })

  it('handles empty body gracefully', () => {
    const html = `<html></html>`
    const result = extractFromHtml(html, 'https://example.com')
    expect(result.fullText).toBe('')
  })

  it('treats all text as a single page', () => {
    const result = extractFromHtml(BASE_HTML, 'https://example.com')
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].text).toBe(result.fullText)
    expect(result.pages[0].pageNumber).toBeUndefined()
    expect(result.pages[0].imageBlob).toBeUndefined()
  })

  it('prevents text concatenation between block-level elements', () => {
    const html = `<html><body><div>Block 1</div><p>Block 2</p><div>Block 3</div></body></html>`
    const result = extractFromHtml(html, 'https://example.com')
    expect(result.fullText).toBe('Block 1\nBlock 2\nBlock 3')
  })
})

// ---------------------------------------------------------------------------
// parseWebpageUrl (integration with mocked fetch)
// ---------------------------------------------------------------------------

describe('parseWebpageUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches HTML via proxy and returns parsed content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(BASE_HTML),
    } as Response)

    const result = await parseWebpageUrl('https://example.com/page')
    expect(result.title).toBe('Test Page')
    expect(result.fullText).toContain('This is the main content')

    // Verify it called the correct proxy URL
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/fetch?url=https%3A%2F%2Fexample.com%2Fpage')
  })

  it('throws when proxy returns an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'Upstream returned 404 Not Found' }),
    } as Response)

    await expect(parseWebpageUrl('https://example.com')).rejects.toThrow('Upstream returned 404')
  })

  it('throws when fetch itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'))

    await expect(parseWebpageUrl('https://example.com')).rejects.toThrow('Network failure')
  })
})
