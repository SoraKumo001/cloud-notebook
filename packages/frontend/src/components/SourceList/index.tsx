import { closestCenter, DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Check, File, FilePlus, Plus, Trash2, X } from 'lucide-react'
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
  onCreateSource,
  onReorder,
  onFilesSelected,
  uploadProgress,
  onClearErrors,
  onBulkDelete,
  onRefresh,
}: SourceListProps) {
  const { t } = useTranslation('common')
  const { locale } = useLocale()
  const { stats, refresh: refreshStats } = useNotebookStats(notebookId ?? '', sources.length)
  const { sensors, handleDragEnd } = useSourceReorder(sources, onReorder)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const createMenuRef = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [showCreateMenu, setShowCreateMenu] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [isConfirmingBulkDelete, setIsConfirmingBulkDelete] = React.useState(false)
  const [bulkDeleteResult, setBulkDeleteResult] = React.useState<{
    deleted: number
    total: number
  } | null>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        setShowCreateMenu(false)
      }
    }

    if (showCreateMenu) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 0)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showCreateMenu])

  async function handleCreateSource(type: 'text' | 'markdown') {
    await onCreateSource?.(type)
    setShowCreateMenu(false)
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleSelectAll() {
    setSelectedIds(new Set(sources.map((s) => s.id)))
  }

  function handleDeselectAll() {
    setSelectedIds(new Set())
  }

  async function handleBulkDelete(ids: string[]) {
    if (!onBulkDelete) return
    setIsConfirmingBulkDelete(false)
    try {
      const result = await onBulkDelete(ids)
      setSelectedIds(new Set())
      if (typeof result === 'object' && result !== null && 'deleted' in result) {
        const r = result as { deleted: number; skipped?: number }
        setBulkDeleteResult({ deleted: r.deleted, total: ids.length })
      } else {
        setBulkDeleteResult({ deleted: ids.length, total: ids.length })
      }
    } catch {
      setBulkDeleteResult(null)
    }
  }

  // Clear bulk delete result toast after 4 seconds
  React.useEffect(() => {
    if (!bulkDeleteResult) return
    const timer = setTimeout(() => setBulkDeleteResult(null), 4000)
    return () => clearTimeout(timer)
  }, [bulkDeleteResult])

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
          {onCreateSource && (
            <div ref={createMenuRef} className='relative'>
              <button
                type='button'
                onClick={() => setShowCreateMenu((prev) => !prev)}
                className='btn btn-ghost btn-sm btn-circle'
                aria-label={t('sourceList.newFileAria')}
                title={t('sourceList.newFile')}
              >
                <FilePlus size={16} strokeWidth={2} aria-hidden='true' />
              </button>
              {showCreateMenu && (
                <ul className='absolute left-0 top-full mt-2 w-40 bg-base-100 border border-base-300 rounded-xl shadow-xl shadow-black/40 py-2 z-50 text-sm'>
                  <li>
                    <button
                      type='button'
                      onClick={() => void handleCreateSource('markdown')}
                      className='w-full text-left px-4 py-2 text-base-content hover:bg-base-200 transition-colors'
                    >
                      {t('sourceList.newMarkdown')}
                    </button>
                  </li>
                  <li>
                    <button
                      type='button'
                      onClick={() => void handleCreateSource('text')}
                      className='w-full text-left px-4 py-2 text-base-content hover:bg-base-200 transition-colors'
                    >
                      {t('sourceList.newText')}
                    </button>
                  </li>
                </ul>
              )}
            </div>
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

      {/* ── Bulk action bar ─────────────────────────────────────────────── */}
      {selectedIds.size > 0 && onBulkDelete && (
        <div className='px-5 py-2 border-b border-base-300 bg-primary/5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-w-0'>
          <span className='text-sm font-medium text-base-content/80 whitespace-nowrap flex-shrink-0'>
            {t('sourceList.bulk.selected', { count: selectedIds.size })}
          </span>
          <div className='flex flex-wrap items-center gap-2 flex-shrink-0'>
            <Button type='button' size='xs' variant='ghost' onClick={handleSelectAll}>
              {t('sourceList.bulk.selectAll')}
            </Button>
            <Button type='button' size='xs' variant='ghost' onClick={handleDeselectAll}>
              {t('sourceList.bulk.deselectAll')}
            </Button>
            <Button
              type='button'
              size='xs'
              variant='error'
              iconLeft={Trash2}
              onClick={() => setIsConfirmingBulkDelete(true)}
            >
              {t('sourceList.bulk.deleteSelected')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Bulk delete confirm modal ─────────────────────────────────── */}
      {isConfirmingBulkDelete && (
        <div className='modal modal-open'>
          <div className='modal-box'>
            <h3 className='font-bold text-lg'>
              {t('sourceList.bulk.deleteConfirmTitle', { count: selectedIds.size })}
            </h3>
            <p className='py-4 text-sm text-base-content/70'>
              {t('sourceList.bulk.deleteConfirmBody', { count: selectedIds.size })}
            </p>
            <div className='modal-action'>
              <Button
                type='button'
                variant='ghost'
                onClick={() => setIsConfirmingBulkDelete(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type='button'
                variant='error'
                iconLeft={Trash2}
                onClick={() => void handleBulkDelete(Array.from(selectedIds))}
              >
                {t('sourceList.bulk.deleteSelected')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk delete result toast ──────────────────────────────────── */}
      {bulkDeleteResult && (
        <div className='px-5 py-3 border-b border-base-300 bg-accent/10'>
          <p className='text-sm font-medium text-accent'>
            {bulkDeleteResult.deleted === bulkDeleteResult.total
              ? t('sourceList.bulk.deleteSuccess', { count: bulkDeleteResult.deleted })
              : t('sourceList.bulk.deletePartial', {
                  deleted: bulkDeleteResult.deleted,
                  total: bulkDeleteResult.total,
                })}
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type='file'
        accept='.pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        multiple
        onChange={handleInputChange}
        className='hidden'
      />
      {sources.length === 0 ? (
        <div
          className={`flex-1 flex flex-col items-center justify-center p-10 text-center transition-all duration-300 ${
            isDragging ? 'bg-teal-500/5' : ''
          }`}
        >
          {progressBlock}
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
        </div>
      ) : (
        <>
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
                  isSelected={selectedIds.has(source.id)}
                  onToggleSelect={handleToggleSelect}
                  onRefresh={onRefresh}
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
                  isSelected={selectedIds.has(source.id)}
                  onToggleSelect={handleToggleSelect}
                  onRefresh={onRefresh}
                />
              ),
            )}
          </ul>
        </>
      )}
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
