import { Check, Globe } from 'lucide-react'
import * as React from 'react'
import { parseWebpage } from '../lib/sourceParser'

interface WebpageImporterProps {
  notebookId: string
  userId: string
  uploadWebpage: (url: string) => Promise<void>
  isProcessing: boolean
}

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function deriveFileName(url: string): string {
  try {
    const { hostname } = new URL(url)
    return `webpage-${hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}.txt`
  } catch {
    return 'webpage.txt'
  }
}

export function WebpageImporter({ uploadWebpage, isProcessing }: WebpageImporterProps) {
  const [url, setUrl] = React.useState('')
  const [preview, setPreview] = React.useState<{
    title: string
    text: string
    fileName: string
  } | null>(null)
  const [parsing, setParsing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || isProcessing || parsing) return

    if (!isValidUrl(trimmed)) {
      setError('Please enter a valid http:// or https:// URL')
      return
    }

    setError(null)
    setPreview(null)
    setParsing(true)

    try {
      const parsed = await parseWebpage(trimmed)
      const fileName = deriveFileName(trimmed)
      setPreview({
        title: parsed.title || fileName,
        text: parsed.fullText.slice(0, 200),
        fileName,
      })
      await uploadWebpage(trimmed)
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import webpage')
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className='card card-border bg-base-100 overflow-hidden'>
      <div className='px-5 py-4 border-b border-base-300 bg-base-200'>
        <div className='flex items-center gap-2'>
          <div className='w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500/20 to-emerald-500/20 border border-teal-500/20 flex items-center justify-center text-teal-400'>
            <Globe size={16} strokeWidth={2} aria-hidden='true' />
          </div>
          <h2 className='text-base font-semibold text-base-content'>Add webpage</h2>
        </div>
      </div>

      <div className='p-5 space-y-4'>
        <form onSubmit={handleSubmit} className='flex items-end gap-3'>
          <div className='flex-1 min-w-0'>
            <label htmlFor='webpage-url' className='sr-only'>
              Webpage URL
            </label>
            <input
              id='webpage-url'
              type='url'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder='https://example.com/article'
              disabled={isProcessing || parsing}
              className='w-full input input-bordered'
            />
          </div>
          <button
            type='submit'
            disabled={isProcessing || parsing || url.trim() === ''}
            className='btn btn-primary'
          >
            {parsing ? (
              <span className='flex items-center gap-2'>
                <span className='loading loading-spinner loading-sm text-white' />
                Fetching…
              </span>
            ) : (
              'Add'
            )}
          </button>
        </form>

        {error && <div className='alert alert-error text-sm'>{error}</div>}

        {preview && (
          <div className='rounded-xl bg-base-200 border border-base-300 p-4 space-y-2'>
            <div className='flex items-center gap-2'>
              <Check size={14} strokeWidth={2} className='text-accent' aria-hidden='true' />
              <p className='text-sm font-medium text-base-content/90 truncate'>{preview.title}</p>
            </div>
            <p className='text-xs text-base-content/50'>{preview.fileName}</p>
            <p className='text-sm text-base-content/60 leading-relaxed line-clamp-3'>
              {preview.text}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
