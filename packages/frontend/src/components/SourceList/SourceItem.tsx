import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { File, FileEdit, FileText, GripVertical, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { formatBytes, formatNumber, formatShortDate } from '../../i18n/formatters'
import { Button } from '../ui/Button'
import type { Source } from './types'

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

function isEditableSourceType(type: string): boolean {
  const normalized = type.toLowerCase()
  return normalized === 'text' || normalized === 'markdown' || normalized === 'webpage'
}

function SourceActions({
  source,
  onDelete,
  onRename,
  onEdit,
  isConfirmingDelete,
  setIsConfirmingDelete,
  onRenameStart,
  refreshStats,
  t,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onEdit?: (id: string) => void | Promise<void>
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

  if (!onDelete && !onRename && !onEdit) return null

  return (
    <div className='flex items-center gap-1'>
      {onEdit && isEditableSourceType(source.type) && (
        <Button
          type='button'
          size='xs'
          shape='circle'
          variant='ghost'
          iconLeft={FileEdit}
          iconOnlyAriaLabel={t('sourceList.editAria')}
          title={t('sourceList.editLabel')}
          className='text-base-content/60 hover:text-primary'
          onClick={() => onEdit(source.id)}
        />
      )}
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

function RefreshButton({
  source,
  onRefresh,
  t,
}: {
  source: Source
  onRefresh: (id: string) => void | Promise<void>
  t: (key: string) => string
}) {
  const [isConfirmingRefresh, setIsConfirmingRefresh] = React.useState(false)

  if (source.status === 'processing') {
    return (
      <span className='text-xs text-base-content/50 flex items-center gap-1'>
        <span className='loading loading-spinner loading-xs text-secondary' />
        {t('sourceList.refresh.refreshing')}
      </span>
    )
  }

  if (isConfirmingRefresh) {
    return (
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          size='xs'
          variant='primary'
          iconLeft={RefreshCw}
          onClick={async () => {
            setIsConfirmingRefresh(false)
            await onRefresh(source.id)
          }}
        >
          {t('common.yes')}
        </Button>
        <Button
          type='button'
          size='xs'
          variant='ghost'
          iconLeft={X}
          onClick={() => setIsConfirmingRefresh(false)}
        >
          {t('common.cancel')}
        </Button>
      </div>
    )
  }

  return (
    <Button
      type='button'
      size='xs'
      shape='circle'
      variant='ghost'
      iconLeft={RefreshCw}
      iconOnlyAriaLabel={t('sourceList.refresh.button')}
      title={t('sourceList.refresh.button')}
      className='text-base-content/60 hover:text-primary'
      onClick={() => setIsConfirmingRefresh(true)}
    />
  )
}

export function SortableSourceItem({
  source,
  onDelete,
  onRename,
  onEdit,
  refreshStats,
  t,
  locale,
  isSelected,
  onToggleSelect,
  onRefresh,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onEdit?: (id: string) => void | Promise<void>
  refreshStats: () => Promise<void>
  t: (key: string) => string
  locale: string
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onRefresh?: (id: string) => void | Promise<void>
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
        <label
          className='flex-shrink-0 flex items-center cursor-pointer'
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onToggleSelect?.(source.id)
            }
          }}
        >
          <input
            type='checkbox'
            className='checkbox checkbox-sm'
            checked={isSelected ?? false}
            onChange={() => onToggleSelect?.(source.id)}
          />
        </label>
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
          <>
            {onRefresh && source.type === 'webpage' && (
              <RefreshButton source={source} onRefresh={onRefresh} t={t} />
            )}
            <SourceActions
              source={source}
              onDelete={onDelete}
              onRename={onRename}
              onEdit={onEdit}
              isConfirmingDelete={isConfirmingDelete}
              setIsConfirmingDelete={setIsConfirmingDelete}
              onRenameStart={() => setIsEditing(true)}
              refreshStats={refreshStats}
              t={t}
            />
          </>
        )}
      </div>
    </li>
  )
}

export function StaticSourceItem({
  source,
  onDelete,
  onRename,
  onEdit,
  refreshStats,
  t,
  locale,
  isSelected,
  onToggleSelect,
  onRefresh,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onEdit?: (id: string) => void | Promise<void>
  refreshStats: () => Promise<void>
  t: (key: string) => string
  locale: string
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onRefresh?: (id: string) => void | Promise<void>
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
        <label
          className='flex-shrink-0 flex items-center cursor-pointer'
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onToggleSelect?.(source.id)
            }
          }}
        >
          <input
            type='checkbox'
            className='checkbox checkbox-sm'
            checked={isSelected ?? false}
            onChange={() => onToggleSelect?.(source.id)}
          />
        </label>
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
          <>
            {onRefresh && source.type === 'webpage' && (
              <RefreshButton source={source} onRefresh={onRefresh} t={t} />
            )}
            <SourceActions
              source={source}
              onDelete={onDelete}
              onRename={onRename}
              onEdit={onEdit}
              isConfirmingDelete={isConfirmingDelete}
              setIsConfirmingDelete={setIsConfirmingDelete}
              onRenameStart={() => setIsEditing(true)}
              refreshStats={refreshStats}
              t={t}
            />
          </>
        )}
      </div>
    </li>
  )
}
