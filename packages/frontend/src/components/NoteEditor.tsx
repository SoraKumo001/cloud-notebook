import * as React from 'react'
import ReactMarkdown from 'react-markdown'

export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

interface NoteEditorProps {
  note: Note | null
  onSave: (id: string | null, data: { title: string; content: string }) => void | Promise<void>
  onCancel: () => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function NoteEditor({ note, onSave, onCancel }: NoteEditorProps) {
  const isNew = note === null
  const [title, setTitle] = React.useState(note?.title ?? '')
  const [content, setContent] = React.useState(note?.content ?? '')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
  const [isSaving, setIsSaving] = React.useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = React.useState<SaveStatus>('idle')
  const lastSavedRef = React.useRef({ title: note?.title ?? '', content: note?.content ?? '' })

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset editor state only when the note identity changes, not when title/content mutate during editing.
  React.useEffect(() => {
    setTitle(note?.title ?? '')
    setContent(note?.content ?? '')
    setMode('edit')
    lastSavedRef.current = { title: note?.title ?? '', content: note?.content ?? '' }
    setAutoSaveStatus('idle')
  }, [note?.id])

  React.useEffect(() => {
    if (isNew) return
    const noteId = note?.id
    if (!noteId) return

    if (title === lastSavedRef.current.title && content === lastSavedRef.current.content) {
      return
    }

    setAutoSaveStatus('idle')
    const timer = setTimeout(() => {
      setAutoSaveStatus('saving')
      Promise.resolve(onSave(noteId, { title, content }))
        .then(() => {
          lastSavedRef.current = { title, content }
          setAutoSaveStatus('saved')
        })
        .catch(() => {
          setAutoSaveStatus('error')
        })
    }, 3000)

    return () => clearTimeout(timer)
  }, [title, content, isNew, note?.id, onSave])

  async function handleSave() {
    setIsSaving(true)
    try {
      await onSave(note?.id ?? null, { title, content })
      lastSavedRef.current = { title, content }
    } finally {
      setIsSaving(false)
    }
  }

  function statusText() {
    switch (autoSaveStatus) {
      case 'saving':
        return 'Saving…'
      case 'saved':
        return 'Saved'
      case 'error':
        return 'Auto-save failed'
      default:
        return ''
    }
  }

  return (
    <div className='card card-border bg-base-100 overflow-hidden'>
      <div className='px-5 py-4 border-b border-base-300 bg-base-200 flex items-center justify-between gap-4'>
        <h3 className='text-sm font-semibold text-base-content/90'>
          {isNew ? 'New note' : 'Edit note'}
        </h3>
        <div role='tablist' className='tabs tabs-box bg-base-200 border border-base-300'>
          <button
            type='button'
            role='tab'
            onClick={() => setMode('edit')}
            className={`tab tab-sm ${mode === 'edit' ? 'tab-active' : ''}`}
          >
            Edit
          </button>
          <button
            type='button'
            role='tab'
            onClick={() => setMode('preview')}
            className={`tab tab-sm ${mode === 'preview' ? 'tab-active' : ''}`}
          >
            Preview
          </button>
        </div>
      </div>

      <div className='p-5 space-y-4'>
        <div className='space-y-2'>
          <label htmlFor='note-title' className='block text-sm font-medium text-base-content/70'>
            Title
          </label>
          <input
            id='note-title'
            type='text'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Note title'
            className='w-full input input-bordered'
          />
        </div>

        <div className='space-y-2'>
          <label htmlFor='note-content' className='block text-sm font-medium text-base-content/70'>
            Content
          </label>
          {mode === 'edit' ? (
            <textarea
              id='note-content'
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder='Write in Markdown…'
              rows={12}
              className='w-full textarea textarea-bordered resize-y font-mono text-sm leading-relaxed'
            />
          ) : (
            <div className='min-h-[20rem] px-4 py-3 rounded-md bg-base-200 border border-base-300 text-base-content/70 overflow-auto'>
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1 className='text-2xl font-bold text-base-content mb-4'>{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className='text-xl font-semibold text-base-content mt-6 mb-3'>
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className='text-lg font-semibold text-base-content/90 mt-4 mb-2'>
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => <p className='mb-4 leading-relaxed'>{children}</p>,
                  ul: ({ children }) => (
                    <ul className='list-disc list-inside mb-4 space-y-1'>{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className='list-decimal list-inside mb-4 space-y-1'>{children}</ol>
                  ),
                  li: ({ children }) => <li className='text-base-content/70'>{children}</li>,
                  code: ({ children }) => (
                    <code className='px-1.5 py-0.5 rounded bg-base-100 text-base-content/90 text-sm font-mono'>
                      {children}
                    </code>
                  ),
                  pre: ({ children }) => (
                    <pre className='p-3 rounded-md bg-base-100 border border-base-300 overflow-auto mb-4'>
                      {children}
                    </pre>
                  ),
                  strong: ({ children }) => (
                    <strong className='font-semibold text-base-content'>{children}</strong>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      className='text-primary hover:text-primary/80 underline'
                      target='_blank'
                      rel='noreferrer'
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {content || '*Nothing to preview*'}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <div className='flex items-center justify-between pt-2'>
          <span className='text-xs text-base-content/50'>{statusText()}</span>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={onCancel}
              disabled={isSaving}
              className='btn btn-neutral'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={isSaving || title.trim() === ''}
              className='btn btn-primary'
            >
              {isSaving ? (
                <>
                  <span className='loading loading-spinner loading-sm text-white' />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
