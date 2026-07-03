// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedPage {
  pageNumber: number
  text: string
  imageBlob?: Blob
}

export interface PDFParseResult {
  title: string
  pages: ParsedPage[]
  fullText: string
}

// ── Lazy pdfjs-dist loader (dynamic import to reduce initial bundle) ────────

// `?url` makes Vite emit the pdf.js worker as a real asset in the bundle
// (served from the same origin), avoiding the cross-origin CDN 404 that
// happened with pdfjs-dist 6.x (cdnjs only ships the .min.js worker for
// the 3.x line).
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PdfjsModule = typeof import('pdfjs-dist')

let cachedPdfjs: PdfjsModule | null = null

async function getPdfjsLib(): Promise<PdfjsModule> {
  if (!cachedPdfjs) {
    const mod = await import('pdfjs-dist')
    mod.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
    cachedPdfjs = mod
  }
  return cachedPdfjs
}

// ── Parse function ───────────────────────────────────────────────────────────

/**
 * Parses a PDF file from an ArrayBuffer, extracting text and rendering pages as image blobs.
 * @param arrayBuffer The PDF file content as an ArrayBuffer
 * @param extractImages Whether to render page images (default: true)
 */
export async function parsePDF(
  arrayBuffer: ArrayBuffer,
  extractImages: boolean = true,
): Promise<PDFParseResult> {
  const pdfjsLib = await getPdfjsLib()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  const pages: ParsedPage[] = []
  let fullText = ''

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)

    // 1. Extract Text
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    fullText += ` ${pageText}`

    // 2. Render Page to Image Blob
    let imageBlob: Blob | undefined
    if (extractImages) {
      try {
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (context) {
          canvas.height = viewport.height
          canvas.width = viewport.width

          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise

          imageBlob = await new Promise<Blob>((resolve) => {
            canvas.toBlob(
              (blob) => {
                if (blob) resolve(blob)
              },
              'image/jpeg',
              0.8,
            )
          })
        }
      } catch (err) {
        console.error(`Failed to render page ${pageNum} to image:`, err)
      }
    }

    pages.push({
      pageNumber: pageNum,
      text: pageText,
      imageBlob,
    })
  }

  return {
    title: 'Uploaded Document',
    pages,
    fullText: fullText.trim(),
  }
}
