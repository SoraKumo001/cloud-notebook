// packages/frontend/src/lib/webpageParser.ts
// Webpage parser: fetches HTML via backend proxy (CORS-safe), extracts readable text.

import type { ParsedSource } from './sourceParser'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROXY_ENDPOINT = '/api/fetch'

// Tags whose content is completely removed before extracting text.
const REMOVE_TAGS = new Set([
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'noscript',
  'iframe',
  'svg',
  'canvas',
])

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse a webpage URL into a `ParsedSource`.
 *
 * Fetches the HTML via the backend proxy (`/api/fetch?url=…`) to avoid CORS
 * issues, then uses `DOMParser` to extract the readable text content.
 *
 * @param url  The public HTTP/HTTPS URL to parse.
 */
export async function parseWebpageUrl(url: string): Promise<ParsedSource> {
  const encodedUrl = encodeURIComponent(url)
  const proxyUrl = `${PROXY_ENDPOINT}?url=${encodedUrl}`

  let html: string
  try {
    const response = await fetch(proxyUrl)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(
        (body as Record<string, unknown>).error
          ? String((body as Record<string, unknown>).error)
          : `Proxy returned ${response.status}`,
      )
    }
    html = await response.text()
  } catch (err) {
    throw new Error(`Failed to fetch webpage: ${err instanceof Error ? err.message : String(err)}`)
  }

  return extractFromHtml(html, url)
}

// ---------------------------------------------------------------------------
// Internal: HTML → ParsedSource
// ---------------------------------------------------------------------------

/**
 * Extract readable content from raw HTML using DOMParser.
 */
export function extractFromHtml(html: string, sourceUrl: string): ParsedSource {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Title: prefer <title>, fallback to first <h1>, then URL
  const titleTag = doc.querySelector('title')
  const h1Tag = doc.querySelector('h1')
  const title =
    titleTag?.textContent?.trim() ?? h1Tag?.textContent?.trim() ?? new URL(sourceUrl).hostname

  const body = doc.body
  if (!body) {
    return {
      type: 'webpage',
      title,
      pages: [{ text: '' }],
      fullText: '',
      metadata: { url: sourceUrl, fileName: sourceUrl },
    }
  }

  // Recursively extract text with spacing for block elements
  const fullText = getElementTextWithSpacing(body).trim()

  // Collapse excessive blank lines
  const cleaned = fullText.replace(/\n{3,}/g, '\n\n')

  return {
    type: 'webpage',
    title,
    pages: [{ text: cleaned }],
    fullText: cleaned,
    metadata: { url: sourceUrl, fileName: sourceUrl },
  }
}

/**
 * Recursively extract text from a DOM node, inserting line breaks/spaces
 * between block-level elements to prevent words from sticking together.
 */
function getElementTextWithSpacing(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    const tagName = element.tagName.toLowerCase()

    // Skip removed tags entirely
    if (REMOVE_TAGS.has(tagName)) {
      return ''
    }

    let text = ''
    let child = element.firstChild
    while (child) {
      text += getElementTextWithSpacing(child)
      child = child.nextSibling
    }

    // Add spacing for block elements or line breaks to prevent text concatenation
    const isBlock = [
      'p',
      'div',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'li',
      'tr',
      'td',
      'th',
      'article',
      'section',
      'aside',
      'blockquote',
      'pre',
      'br',
    ].includes(tagName)

    if (isBlock) {
      return text.trim() ? `${text}\n` : ''
    }

    return text
  }

  return ''
}
