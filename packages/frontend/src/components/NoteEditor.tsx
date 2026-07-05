import { Eye, Pencil, Save, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdownComponents'
import { Button } from './ui/Button'

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
  const { t } = useTranslation('common')
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
        return t('common.saving')
      case 'saved':
        return t('common.saved')
      case 'error':
        return t('common.saveFailedGeneric')
      default:
        return ''
    }
  }

  return (
    <div className='card card-border bg-base-100 overflow-hidden'>
      <div className='px-5 py-4 border-b border-base-300 bg-base-200 flex items-center gap-4'>
        <div role='tablist' className='tabs tabs-box bg-base-200 border border-base-300'>
          <Button
            type='button'
            role='tab'
            size='sm'
            variant='ghost'
            iconLeft={Pencil}
            onClick={() => setMode('edit')}
            className={`tab ${mode === 'edit' ? 'tab-active' : ''}`}
          >
            {t('note.editor.tabEdit')}
          </Button>
          <Button
            type='button'
            role='tab'
            size='sm'
            variant='ghost'
            iconLeft={Eye}
            onClick={() => setMode('preview')}
            className={`tab ${mode === 'preview' ? 'tab-active' : ''}`}
          >
            {t('note.editor.tabPreview')}
          </Button>
        </div>
      </div>

      <div className='p-5 space-y-4'>
        <div className='space-y-2'>
          <label htmlFor='note-title' className='block text-sm font-medium text-base-content/70'>
            {t('note.editor.titleLabel')}
          </label>
          <input
            id='note-title'
            type='text'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('note.editor.titlePlaceholder')}
            className='w-full input input-bordered'
          />
        </div>

        <div className='space-y-2'>
          <label htmlFor='note-content' className='block text-sm font-medium text-base-content/70'>
            {t('note.editor.contentLabel')}
          </label>
          {mode === 'edit' ? (
            <textarea
              id='note-content'
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('note.editor.contentPlaceholder')}
              rows={12}
              className='w-full textarea textarea-bordered resize-y font-mono text-sm leading-relaxed'
            />
          ) : (
            <div className='min-h-[20rem] px-4 py-3 rounded-md bg-base-200 border border-base-300 text-base-content/70 overflow-auto'>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight, rehypeRaw]}
                components={markdownComponents}
              >
                {content || t('note.editor.previewEmpty')}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <div className='flex items-center justify-between pt-2'>
          <span className='text-xs text-base-content/50'>{statusText()}</span>
          <div className='flex items-center gap-3'>
            <Button
              type='button'
              variant='neutral'
              iconLeft={X}
              disabled={isSaving}
              onClick={onCancel}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type='button'
              variant='primary'
              iconLeft={Save}
              loading={isSaving}
              disabled={title.trim() === ''}
              onClick={() => void handleSave()}
            >
              {isSaving ? t('common.saving') : t('note.editor.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
