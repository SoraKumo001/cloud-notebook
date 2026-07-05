import { closestCenter, DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Check, File, Plus, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNotebookStats } from '../../hooks/useNotebookStats'
import { useLocale } from '../../i18n/useLocale'
import { Button } from '../ui/Button'
import { useSourceReorder } from './hooks/useSourceReorder'
import { SortableSourceItem, StaticSourceItem } from './SourceItem'
import type { SourceListProps } from './types'

export type { Source, SourceListProps } from './types'

export function SourceList({
  sources,
  notebookId,
  onDelete,
  onRename,
  onEdit,
  onReorder,
  onFilesSelected,
  uploadProgress,
  onClearErrors,
}: SourceListProps) {
  const { t } = useTranslation('common')
  const { locale } = useLocale()
  const { stats, refresh: refreshStats } = useNotebookStats(notebookId ?? '', sources.length)
  const { sensors, handleDragEnd } = useSourceReorder(sources, onReorder)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  // Track which uploadProgress entries have already been seen as "done" so
  // we refresh stats exactly once per completion (and never on every render
  // while the entry is still visible).
  const seenDoneRef = React.useRef(new Set<string>())
  React.useEffect(() => {
    if (!uploadProgress) return
    let needsRefresh = false
    for (const item of uploadProgress) {
      if (item.status === 'done' && !seenDoneRef.current.has(item.fileName)) {
        seenDoneRef.current.add(item.fileName)
        needsRefresh = true
      }
    }
    if (needsRefresh) {
      void refreshStats()
    }
  }, [uploadProgress, refreshStats])

  const handleDragOver = (e: React.DragEvent) => {
    if (!onFilesSelected) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!onFilesSelected) return
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!onFilesSelected) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      onFilesSelected(files)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      onFilesSelected?.(Array.from(files))
    }
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  const hasErrors = uploadProgress?.some((p) => p.status === 'error')

  // ── Progress items ───────────────────────────────────────────────────────
  const progressBlock =
    uploadProgress && uploadProgress.length > 0 ? (
      <div className='divide-y divide-base-300'>
        {uploadProgress.map((item) => (
          <div key={item.fileName} className='px-5 py-3 flex items-center gap-3 text-sm'>
            {/* Status icon */}
            <div className='flex-shrink-0 w-5 h-5 flex items-center justify-center'>
              {item.status === 'done' ? (
                <Check size={16} strokeWidth={2} className='text-accent' aria-hidden='true' />
              ) : item.status === 'error' ? (
                <X size={16} strokeWidth={2} className='text-error' aria-hidden='true' />
              ) : (
                <span className='loading loading-spinner loading-sm text-secondary' />
              )}
            </div>

            {/* File name + status text */}
            <div className='flex-1 min-w-0'>
              <p className='text-sm font-medium text-base-content/70 truncate'>{item.fileName}</p>
              {item.status === 'error' && item.error ? (
                <p className='text-xs text-error mt-0.5'>{item.error}</p>
              ) : (
                <p className='text-xs text-base-content/50 mt-0.5'>
                  {item.status === 'uploading'
                    ? t('sourceList.status.uploading')
                    : item.status === 'done'
                      ? t('sourceList.status.done')
                      : t('sourceList.status.pending')}
                </p>
              )}
            </div>

            {/* Progress bar for uploading */}
            {item.status === 'uploading' && (
              <progress
                className='progress progress-primary w-24 flex-shrink-0'
                value={item.percent}
                max={100}
              />
            )}
          </div>
        ))}
      </div>
    ) : null

  const hasActiveProgress = uploadProgress && uploadProgress.length > 0

  // ── Empty state with progress ───────────────────────────────────────────
  if (sources.length === 0) {
    if (hasActiveProgress) {
      return (
        <section
          role='region'
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-300 ${
            isDragging
              ? 'border-teal-400 bg-teal-500/10 shadow-lg shadow-teal-500/10'
              : 'border-base-300 bg-base-100/30'
          }`}
        >
          <input
            ref={inputRef}
            type='file'
            accept='.pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            multiple
            onChange={handleInputChange}
            className='hidden'
          />
          {progressBlock}
          {onFilesSelected && (
            <div className='mt-4'>
              <button
                type='button'
                onClick={() => inputRef.current?.click()}
                className='btn btn-neutral btn-sm'
                aria-label={t('sourceList.addMore')}
              >
                <Plus size={16} strokeWidth={2} aria-hidden='true' />
                {t('sourceList.addMore')}
              </button>
            </div>
          )}
        </section>
      )
    }

    return (
      <section
        role='region'
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
          isDragging
            ? 'border-teal-400 bg-teal-500/10 shadow-lg shadow-teal-500/10'
            : 'border-base-300 bg-base-100/30'
        }`}
      >
        <input
          ref={inputRef}
          type='file'
          accept='.pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          multiple
          onChange={handleInputChange}
          className='hidden'
        />
        <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-base-300 text-base-content/50'>
          <File size={24} strokeWidth={2} aria-hidden='true' />
        </div>
        <h3 className='text-base font-medium text-base-content/70'>{t('sourceList.empty')}</h3>
        <p className='mt-1 text-sm text-base-content/50'>
          {onFilesSelected ? t('sourceList.emptyWithDrop') : t('sourceList.emptyWithWeb')}
        </p>
        {onFilesSelected && (
          <button
            type='button'
            onClick={() => inputRef.current?.click()}
            className='mt-4 btn btn-neutral'
            aria-label={t('sourceList.addFiles')}
          >
            <Plus size={16} strokeWidth={2} aria-hidden='true' />
            {t('sourceList.clickToAdd')}
          </button>
        )}
      </section>
    )
  }

  // ── List content ────────────────────────────────────────────────────────
  const list = (
    <section
      role='region'
      className={`card card-border bg-base-100 relative transition-all duration-300 ${
        isDragging ? 'border-2 border-dashed border-teal-500 bg-teal-500/5' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className='px-5 py-4 border-b border-base-300 bg-base-200 flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <h3 className='text-sm font-semibold text-base-content/90'>
            {t('sourceList.sectionTitle')}
          </h3>
          {onFilesSelected && (
            <button
              type='button'
              onClick={() => inputRef.current?.click()}
              className='btn btn-ghost btn-sm btn-circle'
              aria-label={t('sourceList.addFiles')}
            >
              <Plus size={16} strokeWidth={2} aria-hidden='true' />
            </button>
          )}
        </div>
        <div className='flex items-center gap-3'>
          {hasErrors && onClearErrors && (
            <Button type='button' size='xs' variant='ghost' iconLeft={X} onClick={onClearErrors}>
              {t('sourceList.clearErrors')}
            </Button>
          )}
          <span className='text-xs text-base-content/50'>
            {t('sourceList.stats', {
              count: sources.length,
              vectors: stats?.notebookVectorCount ?? 0,
              globalVectors: stats?.globalVectorCount ?? 0,
            })}
          </span>
        </div>
      </div>
      <input
        ref={inputRef}
        type='file'
        accept='.pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        multiple
        onChange={handleInputChange}
        className='hidden'
      />
      {progressBlock}
      <ul className='divide-y divide-base-300'>
        {sources.map((source) =>
          onReorder ? (
            <SortableSourceItem
              key={source.id}
              source={source}
              onDelete={onDelete}
              onRename={onRename}
              onEdit={onEdit}
              refreshStats={refreshStats}
              t={t}
              locale={locale}
            />
          ) : (
            <StaticSourceItem
              key={source.id}
              source={source}
              onDelete={onDelete}
              onRename={onRename}
              onEdit={onEdit}
              refreshStats={refreshStats}
              t={t}
              locale={locale}
            />
          ),
        )}
      </ul>
    </section>
  )

  if (!onReorder) return list

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sources.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        {list}
      </SortableContext>
    </DndContext>
  )
}
