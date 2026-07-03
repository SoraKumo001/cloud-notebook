import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, File, FileText, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { IngestProgressItem } from '../hooks/useIngestPipeline'
import { useNotebookStats } from '../hooks/useNotebookStats'
import { formatBytes, formatNumber, formatShortDate } from '../i18n/formatters'
import { useLocale } from '../i18n/useLocale'
import { Button } from './ui/Button'

export interface Source {
  id: string
  fileName: string
  type: string
  status: 'pending' | 'processing' | 'ready' | 'error'
  updatedAt: string
  size?: number
}

interface SourceListProps {
  sources: Source[]
  notebookId?: string
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onReorder?: (sourceIds: string[]) => void | Promise<void>
  onFilesSelected?: (files: File[]) => void | Promise<void>
  uploadProgress?: IngestProgressItem[]
  onClearErrors?: () => void
}

function FormatBytes({ bytes, locale }: { bytes: number; locale: string }) {
  const { value, unit } = formatBytes(locale as 'en' | 'ja', bytes)
  return (
    <span>
      {formatNumber(locale as 'en' | 'ja', value, 1)} {unit}
    </span>
  )
}

function FormatDate({ iso, locale }: { iso: string; locale: string }) {
  return <span>{formatShortDate(locale as 'en' | 'ja', iso)}</span>
}

function statusBadge(status: Source['status'], t: (key: string) => string) {
  switch (status) {
    case 'ready':
      return null // Hide Ready badge to save space
    case 'processing':
      return (
        <span className='badge badge-info badge-xs'>
          <span className='loading loading-spinner loading-xs -ml-0.5 mr-1 text-secondary' />
          {t('sourceList.status.processing')}
        </span>
      )
    case 'error':
      return <span className='badge badge-error badge-xs'>{t('sourceList.status.error')}</span>
    default:
      return <span className='badge badge-ghost badge-xs'>{t('sourceList.status.pending')}</span>
  }
}

function typeIcon(type: string) {
  const normalized = type.toLowerCase()

  if (normalized === 'pdf') {
    return <FileText size={18} strokeWidth={2} aria-hidden='true' />
  }

  return <File size={18} strokeWidth={2} aria-hidden='true' />
}

function SourceActions({
  source,
  onDelete,
  onRename,
  isConfirmingDelete,
  setIsConfirmingDelete,
  onRenameStart,
  refreshStats,
  t,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  isConfirmingDelete: boolean
  setIsConfirmingDelete: (val: boolean) => void
  onRenameStart: () => void
  refreshStats: () => Promise<void>
  t: (key: string) => string
}) {
  async function confirmDelete() {
    await onDelete?.(source.id)
    setIsConfirmingDelete(false)
    // Trigger stats refresh after delete completes; the parent already
    // optimistically updates the list, but `useNotebookStats` only watches
    // its `sourcesVersion` prop, so we ask for an explicit refresh to make
    // sure the new server-side vector count is reflected.
    await refreshStats()
  }

  if (isConfirmingDelete) {
    return (
      <div className='flex items-center gap-2'>
        <Button type='button' size='xs' variant='error' iconLeft={Trash2} onClick={confirmDelete}>
          {t('sourceList.deleteConfirm')}
        </Button>
        <Button
          type='button'
          size='xs'
          variant='ghost'
          iconLeft={X}
          onClick={() => setIsConfirmingDelete(false)}
        >
          {t('common.cancel')}
        </Button>
      </div>
    )
  }

  if (!onDelete && !onRename) return null

  return (
    <div className='flex items-center gap-1'>
      {onRename && (
        <Button
          type='button'
          size='xs'
          shape='circle'
          variant='ghost'
          iconLeft={Pencil}
          iconOnlyAriaLabel={t('sourceList.renameAria')}
          title={t('sourceList.renameLabel')}
          className='text-base-content/60 hover:text-primary'
          onClick={onRenameStart}
        />
      )}
      {onDelete && (
        <Button
          type='button'
          size='xs'
          shape='circle'
          variant='ghost'
          iconLeft={Trash2}
          iconOnlyAriaLabel={t('sourceList.deleteAria')}
          title={t('common.delete')}
          className='text-base-content/60 hover:text-error'
          onClick={() => setIsConfirmingDelete(true)}
        />
      )}
    </div>
  )
}

function SortableSourceItem({
  source,
  onDelete,
  onRename,
  refreshStats,
  t,
  locale,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  refreshStats: () => Promise<void>
  t: (key: string) => string
  locale: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: source.id,
  })

  const [isEditing, setIsEditing] = React.useState(false)
  const [editName, setEditName] = React.useState(source.fileName)
  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  async function submitRename() {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== source.fileName) {
      await onRename?.(source.id, trimmed)
      // Names don't affect vector counts, but keeping the manual-refresh
      // call symmetric with the delete path makes it easier to add new
      // server-side counters later without missing this hook.
      await refreshStats()
    }
    setIsEditing(false)
  }

  function handleRenameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitRename()
    } else if (event.key === 'Escape') {
      setEditName(source.fileName)
      setIsEditing(false)
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`px-3 py-3 flex items-center justify-between gap-4 hover:bg-base-100/40 transition-colors last:rounded-b-2xl ${
        isDragging ? 'opacity-50 bg-base-300/50 z-10' : ''
      }`}
    >
      <div className='flex items-center gap-3 min-w-0 flex-1'>
        <Button
          type='button'
          size='xs'
          shape='circle'
          variant='ghost'
          iconLeft={GripVertical}
          iconOnlyAriaLabel={t('sourceList.dragAria')}
          className='cursor-grab active:cursor-grabbing flex-shrink-0'
          {...attributes}
          {...listeners}
        />
        <div className='flex-shrink-0 w-9 h-9 rounded-lg bg-base-300 text-base-content/60 flex items-center justify-center'>
          {typeIcon(source.type)}
        </div>
        <div className='min-w-0 flex-1'>
          {isEditing ? (
            <input
              ref={inputRef}
              type='text'
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={handleRenameKeyDown}
              className='w-full px-2 py-1 text-sm bg-base-200 border border-secondary/50 rounded-md text-base-content focus:outline-none focus:ring-2 focus:ring-secondary/20'
            />
          ) : (
            <>
              <p className='text-sm font-medium text-base-content/90 truncate'>{source.fileName}</p>
              <p className='text-xs text-base-content/50'>
                {source.type.toUpperCase()}
                {source.size !== undefined && (
                  <>
                    {' · '}
                    <FormatBytes bytes={source.size} locale={locale} />
                  </>
                )}
                {' · '}
                <FormatDate iso={source.updatedAt} locale={locale} />
              </p>
            </>
          )}
        </div>
      </div>
      <div className='flex items-center gap-3 flex-shrink-0'>
        {statusBadge(source.status, t)}
        {!isEditing && (
          <SourceActions
            source={source}
            onDelete={onDelete}
            onRename={onRename}
            isConfirmingDelete={isConfirmingDelete}
            setIsConfirmingDelete={setIsConfirmingDelete}
            onRenameStart={() => setIsEditing(true)}
            refreshStats={refreshStats}
            t={t}
          />
        )}
      </div>
    </li>
  )
}

function StaticSourceItem({
  source,
  onDelete,
  onRename,
  refreshStats,
  t,
  locale,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  refreshStats: () => Promise<void>
  t: (key: string) => string
  locale: string
}) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editName, setEditName] = React.useState(source.fileName)
  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  async function submitRename() {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== source.fileName) {
      await onRename?.(source.id, trimmed)
      // See SortableSourceItem.submitRename for the rationale.
      await refreshStats()
    }
    setIsEditing(false)
  }

  function handleRenameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitRename()
    } else if (event.key === 'Escape') {
      setEditName(source.fileName)
      setIsEditing(false)
    }
  }

  return (
    <li className='px-3 py-3 flex items-center justify-between gap-4 hover:bg-base-100/40 transition-colors last:rounded-b-2xl'>
      <div className='flex items-center gap-3 min-w-0 flex-1'>
        <div className='flex-shrink-0 w-9 h-9 rounded-lg bg-base-300 text-base-content/60 flex items-center justify-center'>
          {typeIcon(source.type)}
        </div>
        <div className='min-w-0 flex-1'>
          {isEditing ? (
            <input
              ref={inputRef}
              type='text'
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={handleRenameKeyDown}
              className='w-full px-2 py-1 text-sm bg-base-200 border border-secondary/50 rounded-md text-base-content focus:outline-none focus:ring-2 focus:ring-secondary/20'
            />
          ) : (
            <>
              <p className='text-sm font-medium text-base-content/90 truncate'>{source.fileName}</p>
              <p className='text-xs text-base-content/50'>
                {source.type.toUpperCase()}
                {source.size !== undefined && (
                  <>
                    {' · '}
                    <FormatBytes bytes={source.size} locale={locale} />
                  </>
                )}
                {' · '}
                <FormatDate iso={source.updatedAt} locale={locale} />
              </p>
            </>
          )}
        </div>
      </div>
      <div className='flex items-center gap-3 flex-shrink-0'>
        {statusBadge(source.status, t)}
        {!isEditing && (
          <SourceActions
            source={source}
            onDelete={onDelete}
            onRename={onRename}
            isConfirmingDelete={isConfirmingDelete}
            setIsConfirmingDelete={setIsConfirmingDelete}
            onRenameStart={() => setIsEditing(true)}
            refreshStats={refreshStats}
            t={t}
          />
        )}
      </div>
    </li>
  )
}

export function SourceList({
  sources,
  notebookId,
  onDelete,
  onRename,
  onReorder,
  onFilesSelected,
  uploadProgress,
  onClearErrors,
}: SourceListProps) {
  const { t } = useTranslation('common')
  const { locale } = useLocale()
  const { stats, refresh: refreshStats } = useNotebookStats(notebookId ?? '', sources.length)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!onReorder || !over || active.id === over.id) return

    const oldIndex = sources.findIndex((s) => s.id === active.id)
    const newIndex = sources.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(sources, oldIndex, newIndex)
    onReorder(reordered.map((s) => s.id))
  }

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
