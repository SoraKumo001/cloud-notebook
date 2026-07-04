import { useCallback, useRef, useState } from 'react'
import type { SourceType } from '../lib/sourceParser'
import { parseFile, parseWebpage } from '../lib/sourceParser'

// ── Types ────────────────────────────────────────────────────────────────────

export interface IngestProgressItem {
  fileName: string
  status: 'pending' | 'parsing' | 'uploading' | 'finalizing' | 'done' | 'error'
  percent: number
  error?: string
}

interface UploadedImageInfo {
  r2Key: string
  pageNumber: number
}

// ── File type helpers ────────────────────────────────────────────────────────

function detectSourceType(file: File): SourceType {
  const ext = file.name.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'txt':
    case 'md':
      return 'text'
    case 'docx':
      return 'docx'
    default:
      break
  }

  switch (file.type) {
    case 'application/pdf':
      return 'pdf'
    case 'text/plain':
    case 'text/markdown':
      return 'text'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx'
    default:
      throw new Error(`Unsupported file type: ${file.name}`)
  }
}

function getContentType(type: SourceType): string {
  switch (type) {
    case 'pdf':
      return 'application/pdf'
    case 'text':
      return 'text/plain'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    default:
      // Exhaustiveness guard
      throw new Error(`Unsupported source type: ${type satisfies never}`)
  }
}

// ── Pure utility functions (hoisted for stability) ──────────────────────────

function deriveWebpageFileName(url: string): string {
  try {
    const { hostname } = new URL(url)
    return `webpage-${hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}.txt`
  } catch {
    return 'webpage.txt'
  }
}

async function calculateHash(fileOrBlob: File | Blob): Promise<string> {
  const arrayBuffer = await fileOrBlob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Concurrency helper ───────────────────────────────────────────────────────

/**
 * Runs an async function over each item with at most `concurrency` operations
 * in-flight at the same time.
 */
async function asyncPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  let hasError = false
  const errors: any[] = []

  async function worker(): Promise<void> {
    while (queue.length > 0 && !hasError) {
      // biome-ignore lint/style/noNonNullAssertion: checked queue.length > 0
      const item = queue.shift()!
      try {
        await fn(item)
      } catch (err) {
        hasError = true
        errors.push(err)
      }
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker())

  await Promise.allSettled(workers)

  if (errors.length > 0) {
    throw errors[0]
  }
}

async function readFinalizeStream(
  response: Response,
  onProgress: (percent: number, current?: number, total?: number) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    try {
      const data = await response.json()
      if (data && data.status === 'failed') {
        throw new Error(data.error || 'Finalize failed')
      }
      onProgress(100)
      return
    } catch (err) {
      if (err instanceof Error && err.message.includes('Finalize failed')) {
        throw err
      }
      throw new Error('Response body stream is not readable')
    }
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7).trim()
        } else if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.slice(6).trim()
          try {
            const data = JSON.parse(rawData)
            if (currentEvent === 'progress') {
              onProgress(data.percent, data.current, data.total)
            } else if (currentEvent === 'done') {
              return
            } else if (currentEvent === 'error') {
              throw new Error(data.message || 'Unknown server error during finalization')
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useIngestPipeline(notebookId: string, userId: string) {
  const [progress, setProgress] = useState<IngestProgressItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const processingRef = useRef(false)
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ---- helpers ---------------------------------------------------------------

  const initProgress = useCallback((files: File[]) => {
    setProgress((prev) => {
      const existingNames = new Set(prev.map((p) => p.fileName))
      const newItems: IngestProgressItem[] = files
        .filter((f) => !existingNames.has(f.name))
        .map((f) => ({
          fileName: f.name,
          status: 'pending' as const,
          percent: 0,
        }))
      return [...prev, ...newItems]
    })
  }, [])

  const updateFile = useCallback((fileName: string, patch: Partial<IngestProgressItem>) => {
    setProgress((prev) => {
      const oldItem = prev.find((p) => p.fileName === fileName)

      // If transitioning to 'done', schedule auto-dismiss after 1 second
      if (oldItem && oldItem.status !== 'done' && patch.status === 'done') {
        const timers = dismissTimersRef.current
        // Clear any existing timer for this fileName (shouldn't happen, but be safe)
        const existing = timers.get(fileName)
        if (existing) clearTimeout(existing)

        const timerId = setTimeout(() => {
          setProgress((current) =>
            current.filter((p) => p.fileName !== fileName || p.status !== 'done'),
          )
          dismissTimersRef.current.delete(fileName)
        }, 1000)
        timers.set(fileName, timerId)
      }

      return prev.map((p) => (p.fileName === fileName ? { ...p, ...patch } : p))
    })
  }, [])

  // ---- per-file pipeline -----------------------------------------------------

  const processFile = useCallback(
    async (file: File): Promise<void> => {
      const fileName = file.name
      const sourceId = crypto.randomUUID()

      try {
        // a) Detect source type
        updateFile(fileName, { status: 'parsing', percent: 5 })
        const sourceType = detectSourceType(file)
        const contentType = getContentType(sourceType)

        // b) Parse file
        updateFile(fileName, { status: 'parsing', percent: 10 })
        const parsed = await parseFile(file, sourceType)

        // Calculate file hash
        const fileHash = await calculateHash(file)

        // d) Chunk extracted text (tokenizer is dynamically imported to reduce bundle size)
        updateFile(fileName, { status: 'parsing', percent: 15 })
        const { chunkText } = await import('../lib/tokenizer')
        const chunks = chunkText(parsed.fullText)

        const r2Key = `notebooks/${notebookId}/sources/${sourceId}/${fileName}`

        // e) Upload original file to R2 via Worker proxy (avoids the
        //    *.r2.cloudflarestorage.com CORS preflight issue)
        updateFile(fileName, { status: 'uploading', percent: 20 })
        const fileUploadRes = await fetch(
          `/api/uploads/direct?key=${encodeURIComponent(r2Key)}&contentType=${encodeURIComponent(contentType)}`,
          {
            method: 'POST',
            body: file,
            headers: { 'Content-Type': contentType },
          },
        )
        if (!fileUploadRes.ok) {
          throw new Error(`File upload failed (${fileUploadRes.status})`)
        }

        // g) Upload page images concurrently (pool size = 4)
        const imagePages = parsed.pages.filter((p) => p.imageBlob != null)

        const uploadedImages: UploadedImageInfo[] = []
        if (imagePages.length > 0) {
          updateFile(fileName, { status: 'uploading', percent: 50 })

          await asyncPool(imagePages, 4, async (page) => {
            const imageFileName = `page-${page.pageNumber}.jpg`
            const imageR2Key = `notebooks/${notebookId}/sources/${sourceId}/${imageFileName}`

            // Upload
            const imgUploadRes = await fetch(
              `/api/uploads/direct?key=${encodeURIComponent(imageR2Key)}&contentType=image/jpeg`,
              {
                method: 'POST',
                // biome-ignore lint/style/noNonNullAssertion: filtered by imageBlob != null above
                body: page.imageBlob!,
                headers: { 'Content-Type': 'image/jpeg' },
              },
            )
            if (!imgUploadRes.ok) {
              throw new Error(
                `Image upload failed for page ${page.pageNumber} (${imgUploadRes.status})`,
              )
            }

            uploadedImages.push({ r2Key: imageR2Key, pageNumber: page.pageNumber })
          })
        }

        // h) Finalize source
        updateFile(fileName, { status: 'finalizing', percent: 50 })
        const finalizeRes = await fetch('/api/sources/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notebookId,
            sourceId,
            userId,
            fileName,
            type: sourceType,
            hash: fileHash,
            chunks: chunks.map((c) => ({ content: c.content })),
            images: uploadedImages.map((img) => ({
              r2Key: img.r2Key,
              pageNumber: img.pageNumber,
            })),
          }),
        })
        if (!finalizeRes.ok) {
          throw new Error(`Finalize failed (${finalizeRes.status})`)
        }

        await readFinalizeStream(finalizeRes, (streamPercent) => {
          const scaledPercent = 50 + Math.round(streamPercent * 0.45)
          updateFile(fileName, { status: 'finalizing', percent: scaledPercent })
        })

        updateFile(fileName, { status: 'done', percent: 100 })
      } catch (err) {
        updateFile(fileName, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          percent: 100,
        })
      }
    },
    [notebookId, userId, updateFile],
  )

  const processWebpage = useCallback(
    async (url: string): Promise<void> => {
      const fileName = deriveWebpageFileName(url)
      const sourceId = crypto.randomUUID()

      try {
        // a) Pending → Parsing
        updateFile(fileName, { status: 'parsing', percent: 5 })

        // b) Parse webpage via backend proxy
        updateFile(fileName, { status: 'parsing', percent: 10 })
        const parsed = await parseWebpage(url)

        // c) Chunk extracted text (tokenizer is dynamically imported to reduce bundle size)
        updateFile(fileName, { status: 'parsing', percent: 15 })
        const { chunkText } = await import('../lib/tokenizer')
        const chunks = chunkText(parsed.fullText)

        // d) Create a text blob from the extracted content
        const textBlob = new Blob([parsed.fullText], { type: 'text/plain' })
        const fileHash = await calculateHash(textBlob)

        const r2Key = `notebooks/${notebookId}/sources/${sourceId}/${fileName}`

        // e) Upload text to R2 via Worker proxy
        updateFile(fileName, { status: 'uploading', percent: 20 })
        const fileUploadRes = await fetch(
          `/api/uploads/direct?key=${encodeURIComponent(r2Key)}&contentType=text/plain`,
          {
            method: 'POST',
            body: textBlob,
            headers: { 'Content-Type': 'text/plain' },
          },
        )
        if (!fileUploadRes.ok) {
          throw new Error(`File upload failed (${fileUploadRes.status})`)
        }

        // g) Finalize source
        updateFile(fileName, { status: 'finalizing', percent: 50 })
        const finalizeRes = await fetch('/api/sources/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notebookId,
            sourceId,
            userId,
            fileName,
            type: 'webpage',
            url,
            hash: fileHash,
            chunks: chunks.map((c) => ({ content: c.content })),
            images: [],
          }),
        })
        if (!finalizeRes.ok) {
          throw new Error(`Finalize failed (${finalizeRes.status})`)
        }

        await readFinalizeStream(finalizeRes, (streamPercent) => {
          const scaledPercent = 50 + Math.round(streamPercent * 0.45)
          updateFile(fileName, { status: 'finalizing', percent: scaledPercent })
        })

        updateFile(fileName, { status: 'done', percent: 100 })
      } catch (err) {
        updateFile(fileName, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          percent: 100,
        })
      }
    },
    [notebookId, userId, updateFile],
  )

  // ---- public API ------------------------------------------------------------

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || processingRef.current) return

      processingRef.current = true
      setIsProcessing(true)

      initProgress(files)

      // Process one file at a time so a single failure doesn't cascade
      for (const file of files) {
        await processFile(file)
      }

      processingRef.current = false
      setIsProcessing(false)
    },
    [initProgress, processFile],
  )

  const uploadWebpage = useCallback(
    async (url: string) => {
      if (processingRef.current) return

      processingRef.current = true
      setIsProcessing(true)

      const fileName = deriveWebpageFileName(url)
      setProgress((prev) => {
        if (prev.some((p) => p.fileName === fileName)) return prev
        return [...prev, { fileName, status: 'pending' as const, percent: 0 }]
      })

      await processWebpage(url)

      processingRef.current = false
      setIsProcessing(false)
    },
    [processWebpage],
  )

  const clearAllErrors = useCallback(() => {
    setProgress((prev) => prev.filter((p) => p.status !== 'error'))
  }, [])

  const reset = useCallback(() => {
    // Clear all pending dismiss timers
    for (const timerId of dismissTimersRef.current.values()) {
      clearTimeout(timerId)
    }
    dismissTimersRef.current.clear()
    setProgress([])
    setIsProcessing(false)
    processingRef.current = false
  }, [])

  return { uploadFiles, uploadWebpage, progress, isProcessing, reset, clearAllErrors }
}
