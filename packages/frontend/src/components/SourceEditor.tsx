import { AlertCircle, FileEdit, Save, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdownComponents'
import type { Source } from './SourceList'
import { Button } from './ui/Button'

interface SourceEditorProps {
  source: Source
  notebookId: string
  onClose: () => void
  onSave: (id: string, content: string) => Promise<void>
  getSourceContent: (id: string) => Promise<{ content: string; type: string; name: string }>
}

export function SourceEditor({ source, onClose, onSave, getSourceContent }: SourceEditorProps) {
  const { t } = useTranslation('common')
  const [content, setContent] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const isMarkdown = source.type.toLowerCase() === 'markdown'

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setLoadError(null)
        const data = await getSourceContent(source.id)
        if (!cancelled) {
          setContent(data.content)
          setLoaded(true)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t('sourceEditor.loadError'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [source.id, getSourceContent, t])

  React.useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [loading])

  async function handleSave() {
    try {
      setSaving(true)
      setSaveError(null)
      await onSave(source.id, content)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('sourceEditor.saveError'))
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault()
      void handleSave()
    }
  }

  return (
    <div className='flex flex-col h-full bg-base-200/20 rounded-2xl border border-base-300 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center justify-between px-5 py-4 border-b border-base-300 bg-base-100/80 backdrop-blur-sm flex-shrink-0 gap-4'>
        <div className='flex items-center gap-3 min-w-0'>
          <div className='flex-shrink-0 w-9 h-9 rounded-lg bg-base-300 text-base-content/60 flex items-center justify-center'>
            <FileEdit size={18} strokeWidth={2} aria-hidden='true' />
          </div>
          <div className='min-w-0'>
            <h2 className='text-sm font-semibold text-base-content/90 truncate'>
              {source.fileName}
            </h2>
            <p className='text-xs text-base-content/50'>
              {t('sourceEditor.title')} · {source.type.toUpperCase()}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2 flex-shrink-0'>
          <Button
            type='button'
            size='sm'
            variant='primary'
            iconLeft={Save}
            loading={saving}
            onClick={handleSave}
            disabled={!loaded || saving}
          >
            {saving ? t('sourceEditor.saving') : t('sourceEditor.save')}
          </Button>
          <Button
            type='button'
            size='sm'
            shape='circle'
            variant='ghost'
            iconLeft={X}
            iconOnlyAriaLabel={t('sourceEditor.close')}
            title={t('sourceEditor.close')}
            onClick={onClose}
            disabled={saving}
          />
        </div>
      </div>

      {/* Error banners */}
      {(loadError || saveError) && (
        <div className='px-5 py-3 bg-error/10 border-b border-error/20 flex items-start gap-3 flex-shrink-0'>
          <AlertCircle size={16} strokeWidth={2} className='text-error flex-shrink-0 mt-0.5' />
          <p className='text-sm text-error'>{loadError || saveError}</p>
        </div>
      )}

      {/* Editor body */}
      <div className='flex-1 flex overflow-hidden'>
        {isMarkdown ? (
          <div className='flex-1 flex divide-x divide-base-300 min-h-0'>
            <div className='flex-1 flex flex-col min-w-0'>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!loaded || saving}
                spellCheck={false}
                className='flex-1 w-full resize-none bg-base-100/30 p-4 text-sm leading-relaxed text-base-content/90 focus:outline-none focus:bg-base-100/50'
                aria-label={t('sourceEditor.title')}
              />
            </div>
            <div className='flex-1 flex flex-col min-w-0 bg-base-100/20'>
              <div className='px-3 py-2 bg-base-200/60 border-b border-base-300 text-xs font-medium text-base-content/50 flex items-center gap-2 flex-shrink-0'>
                {t('sourceEditor.preview')}
              </div>
              <div className='flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-base-content/90'>
                {content.trim() ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight, rehypeRaw]}
                    components={markdownComponents}
                  >
                    {content}
                  </ReactMarkdown>
                ) : (
                  <p className='text-base-content/40 italic'>{t('sourceEditor.emptyContent')}</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!loaded || saving}
            spellCheck={false}
            className='flex-1 w-full h-full resize-none bg-base-100/30 p-4 text-sm leading-relaxed font-mono text-base-content/90 focus:outline-none focus:bg-base-100/50'
            aria-label={t('sourceEditor.title')}
          />
        )}
      </div>

      {/* Footer hint */}
      <div className='px-5 py-2 bg-base-200/60 border-t border-base-300 text-xs text-base-content/50 flex-shrink-0'>
        {t('sourceEditor.saveHint')} · Ctrl/Cmd + S {t('sourceEditor.save').toLowerCase()}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className='absolute inset-0 bg-base-200/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-2xl'>
          <span className='loading loading-spinner loading-lg text-primary' />
          <p className='mt-3 text-sm text-base-content/70'>{t('common.loading')}</p>
        </div>
      )}
    </div>
  )
}
