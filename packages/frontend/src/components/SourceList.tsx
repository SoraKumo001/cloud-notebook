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
import type { IngestProgressItem } from '../hooks/useIngestPipeline'
import { useNotebookStats } from '../hooks/useNotebookStats'

export interface Source {
  id: string
  fileName: string
  type: string
  status: 'pending' | 'processing' | 'ready' | 'error'
  updatedAt: string
  size?: number
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
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

function formatDate(iso: string): string {
  const date = new Date(iso)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd}`
}

function statusBadge(status: Source['status']) {
  switch (status) {
    case 'ready':
      return null // Hide Ready badge to save space
    case 'processing':
      return (
        <span className='badge badge-info badge-xs'>
          <span className='loading loading-spinner loading-xs -ml-0.5 mr-1 text-secondary' />
          Processing
        </span>
      )
    case 'error':
      return <span className='badge badge-error badge-xs'>Error</span>
    default:
      return <span className='badge badge-ghost badge-xs'>Pending</span>
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
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  isConfirmingDelete: boolean
  setIsConfirmingDelete: (val: boolean) => void
  onRenameStart: () => void
}) {
  async function confirmDelete() {
    await onDelete?.(source.id)
    setIsConfirmingDelete(false)
  }

  if (isConfirmingDelete) {
    return (
      <div className='flex items-center gap-2'>
        <button type='button' onClick={confirmDelete} className='btn btn-error btn-xs'>
          Delete
        </button>
        <button
          type='button'
          onClick={() => setIsConfirmingDelete(false)}
          className='btn btn-ghost btn-xs'
        >
          Cancel
        </button>
      </div>
    )
  }

  if (!onDelete && !onRename) return null

  return (
    <div className='flex items-center gap-1'>
      {onRename && (
        <button
          type='button'
          onClick={onRenameStart}
          className='btn btn-ghost btn-xs btn-circle text-base-content/60 hover:text-primary'
          aria-label='Rename source'
          title='Rename'
        >
          <Pencil size={14} strokeWidth={2} aria-hidden='true' />
        </button>
      )}
      {onDelete && (
        <button
          type='button'
          onClick={() => setIsConfirmingDelete(true)}
          className='btn btn-ghost btn-xs btn-circle text-base-content/60 hover:text-error'
          aria-label='Delete source'
          title='Delete'
        >
          <Trash2 size={14} strokeWidth={2} aria-hidden='true' />
        </button>
      )}
    </div>
  )
}

function SortableSourceItem({
  source,
  onDelete,
  onRename,
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
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
        <button
          type='button'
          {...attributes}
          {...listeners}
          className='btn btn-ghost btn-xs btn-circle cursor-grab active:cursor-grabbing flex-shrink-0'
          aria-label='Drag to reorder'
        >
          <GripVertical size={16} strokeWidth={2} aria-hidden='true' />
        </button>
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
                {source.size !== undefined && ` · ${formatBytes(source.size)}`}
                {` · ${formatDate(source.updatedAt)}`}
              </p>
            </>
          )}
        </div>
      </div>
      <div className='flex items-center gap-3 flex-shrink-0'>
        {statusBadge(source.status)}
        {!isEditing && (
          <SourceActions
            source={source}
            onDelete={onDelete}
            onRename={onRename}
            isConfirmingDelete={isConfirmingDelete}
            setIsConfirmingDelete={setIsConfirmingDelete}
            onRenameStart={() => setIsEditing(true)}
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
}: {
  source: Source
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
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
                {source.size !== undefined && ` · ${formatBytes(source.size)}`}
                {` · ${formatDate(source.updatedAt)}`}
              </p>
            </>
          )}
        </div>
      </div>
      <div className='flex items-center gap-3 flex-shrink-0'>
        {statusBadge(source.status)}
        {!isEditing && (
          <SourceActions
            source={source}
            onDelete={onDelete}
            onRename={onRename}
            isConfirmingDelete={isConfirmingDelete}
            setIsConfirmingDelete={setIsConfirmingDelete}
            onRenameStart={() => setIsEditing(true)}
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
  const { stats } = useNotebookStats(notebookId ?? '', sources.length)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

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
                    ? 'Uploading...'
                    : item.status === 'done'
                      ? 'Done'
                      : 'Pending'}
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
                aria-label='Add more files'
              >
                <Plus size={16} strokeWidth={2} aria-hidden='true' />
                Add more files
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
        <h3 className='text-base font-medium text-base-content/70'>No sources yet</h3>
        <p className='mt-1 text-sm text-base-content/50'>
          {onFilesSelected
            ? 'Click + above or drop files here to add your first source.'
            : 'Add a webpage above or upload files to get started.'}
        </p>
        {onFilesSelected && (
          <button
            type='button'
            onClick={() => inputRef.current?.click()}
            className='mt-4 btn btn-neutral'
            aria-label='Add files'
          >
            <Plus size={16} strokeWidth={2} aria-hidden='true' />
            Click to add files
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
          <h3 className='text-sm font-semibold text-base-content/90'>Sources</h3>
          {onFilesSelected && (
            <button
              type='button'
              onClick={() => inputRef.current?.click()}
              className='btn btn-ghost btn-sm btn-circle'
              aria-label='Add files'
            >
              <Plus size={16} strokeWidth={2} aria-hidden='true' />
            </button>
          )}
        </div>
        <div className='flex items-center gap-3'>
          {hasErrors && onClearErrors && (
            <button
              type='button'
              onClick={onClearErrors}
              className='btn btn-ghost btn-xs'
              aria-label='Clear upload errors'
            >
              クリア
            </button>
          )}
          <span className='text-xs text-base-content/50'>
            {sources.length} total
            {stats &&
              ` · ${stats.notebookVectorCount ?? 0} vectors (Global: ${stats.globalVectorCount ?? 0})`}
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
            />
          ) : (
            <StaticSourceItem
              key={source.id}
              source={source}
              onDelete={onDelete}
              onRename={onRename}
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
