import { FileText, MoreVertical, PanelRightClose, Pencil, Plus, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../i18n/formatters'
import { useLocale } from '../i18n/useLocale'
import { Button } from './ui/Button'

export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

interface NoteListProps {
  notes: Note[]
  activeNoteId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, title: string) => void | Promise<void>
  onCollapse?: () => void
}

function relativeTime(
  iso: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  const date = new Date(iso)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return t('note.time.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('note.time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('note.time.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('note.time.daysAgo', { count: days })
  return formatShortDate(locale, date)
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 100)
}

function NoteItem({
  note,
  isActive,
  onSelect,
  onDelete,
  onRename,
  t,
  locale,
}: {
  note: Note
  isActive: boolean
  onSelect: (id: string) => void
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, title: string) => void | Promise<void>
  t: (key: string, options?: Record<string, unknown>) => string
  locale: string
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState(note.title)
  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 0)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [menuOpen])

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  async function submitRename() {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== note.title) {
      await onRename?.(note.id, trimmed)
    }
    setIsEditing(false)
  }

  function cancelRename() {
    setEditTitle(note.title)
    setIsEditing(false)
  }

  function handleRenameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitRename()
    } else if (event.key === 'Escape') {
      cancelRename()
    }
  }

  async function confirmDelete() {
    await onDelete?.(note.id)
    setIsConfirmingDelete(false)
    setMenuOpen(false)
  }

  const activeClass = isActive
    ? 'border-primary bg-base-300/50'
    : 'border-transparent hover:bg-base-300/50'

  if (isEditing) {
    return (
      <div className={`px-4 py-3 border-l-2 ${activeClass}`}>
        <input
          ref={inputRef}
          type='text'
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={submitRename}
          onKeyDown={handleRenameKeyDown}
          className='w-full px-2 py-1 text-sm bg-base-200 border border-primary/30 rounded-md text-base-content focus:outline-none focus:ring-2 focus:ring-primary/20'
        />
      </div>
    )
  }

  if (isConfirmingDelete) {
    return (
      <div className={`px-4 py-3 border-l-2 ${activeClass}`}>
        <p className='text-xs text-base-content/60 mb-2'>{t('note.deleteDialog.title')}</p>
        <div className='flex items-center gap-2'>
          <Button type='button' size='xs' variant='error' iconLeft={Trash2} onClick={confirmDelete}>
            {t('common.delete')}
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
      </div>
    )
  }

  return (
    <div
      className={`group relative flex items-stretch border-l-2 transition-colors ${activeClass}`}
    >
      <button
        type='button'
        onClick={() => onSelect(note.id)}
        className='flex-1 min-w-0 text-left px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30'
      >
        <p
          className={`text-sm font-medium truncate ${isActive ? 'text-base-content' : 'text-base-content/70'}`}
        >
          {note.title}
        </p>
        <p className='text-xs text-base-content/50 mb-1'>
          {relativeTime(note.updatedAt, t, locale)}
        </p>
        <p className='text-xs text-base-content/60 line-clamp-2'>{preview(note.content)}</p>
      </button>

      {(onDelete || onRename) && (
        <div ref={menuRef} className='absolute right-2 top-1/2 -translate-y-1/2 z-10'>
          <Button
            type='button'
            size='sm'
            shape='circle'
            variant='ghost'
            iconLeft={MoreVertical}
            iconOnlyAriaLabel={t('note.actionsAria')}
            className='opacity-0 group-hover:opacity-100 focus:opacity-100'
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((prev) => !prev)
            }}
          />

          {menuOpen && (
            <ul className='absolute right-0 top-full mt-1 w-36 bg-base-100 border border-base-300 rounded-xl shadow-xl shadow-black/40 py-1 z-20 text-xs'>
              {onRename && (
                <li>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    iconLeft={Pencil}
                    className='w-full justify-start px-3 py-1.5 text-base-content/80'
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsEditing(true)
                      setMenuOpen(false)
                    }}
                  >
                    {t('common.rename')}
                  </Button>
                </li>
              )}
              {onDelete && (
                <li>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    iconLeft={Trash2}
                    className='w-full justify-start px-3 py-1.5 text-error font-medium'
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsConfirmingDelete(true)
                      setMenuOpen(false)
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function NoteList({
  notes,
  activeNoteId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onCollapse,
}: NoteListProps) {
  const { t } = useTranslation('common')
  const { locale } = useLocale()

  return (
    <div className='card card-border bg-base-100 overflow-hidden'>
      <div className='px-5 py-4 border-b border-base-300 bg-base-200 flex items-center justify-between'>
        <div>
          <h3 className='text-sm font-semibold text-base-content/90'>{t('note.listTitle')}</h3>
          <p className='text-xs text-base-content/50'>
            {t('note.listCount', { count: notes.length })}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button type='button' size='sm' variant='primary' iconLeft={Plus} onClick={onCreate}>
            {t('note.newNote')}
          </Button>
          {onCollapse && (
            <button
              type='button'
              onClick={onCollapse}
              className='btn btn-ghost btn-sm btn-circle'
              aria-label={t('notebookDetail.collapseNotes')}
              title={t('notebookDetail.collapseNotes')}
            >
              <PanelRightClose size={16} strokeWidth={2} aria-hidden='true' />
            </button>
          )}
        </div>
      </div>

      {notes.length === 0 ? (
        <div className='p-10 text-center'>
          <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-base-300 text-base-content/50'>
            <FileText size={24} strokeWidth={2} aria-hidden='true' />
          </div>
          <h4 className='text-base font-medium text-base-content/70'>{t('note.empty')}</h4>
          <p className='mt-1 text-sm text-base-content/50'>{t('note.emptyHint')}</p>
        </div>
      ) : (
        <div>
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              isActive={note.id === activeNoteId}
              onSelect={onSelect}
              onDelete={onDelete}
              onRename={onRename}
              t={t}
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  )
}
