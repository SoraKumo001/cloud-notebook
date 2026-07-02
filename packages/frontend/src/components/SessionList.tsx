import { MoreVertical } from 'lucide-react'
import * as React from 'react'

export interface ChatSession {
  id: string
  title: string
  created_at: string
}

interface SessionListProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function KebabIcon() {
  return <MoreVertical size={16} strokeWidth={2} aria-hidden='true' />
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  session: ChatSession
  isActive: boolean
  onSelect: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState(session.title)
  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  function startRename() {
    setEditTitle(session.title)
    setIsEditing(true)
  }

  async function submitRename() {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      await onRename?.(session.id, trimmed)
    }
    setIsEditing(false)
  }

  function cancelRename() {
    setEditTitle(session.title)
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
    await onDelete?.(session.id)
    setIsConfirmingDelete(false)
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
        <p className='text-xs text-base-content/60 mb-2'>Delete this conversation?</p>
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
      </div>
    )
  }

  return (
    <div
      className={`group relative flex items-stretch border-l-2 transition-colors ${activeClass}`}
    >
      <button
        type='button'
        onClick={() => onSelect(session.id)}
        className='flex-1 min-w-0 text-left px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30'
      >
        <p
          className={`text-sm font-medium truncate ${
            isActive ? 'text-base-content' : 'text-base-content/70'
          }`}
        >
          {session.title}
        </p>
        <p className='text-xs text-base-content/50'>{formatDate(session.created_at)}</p>
      </button>

      {(onDelete || onRename) && (
        <div className='dropdown dropdown-end dropdown-top absolute right-2 top-1/2 -translate-y-1/2 z-10'>
          <button
            type='button'
            tabIndex={0}
            aria-label='Session actions'
            className='btn btn-ghost btn-sm btn-circle'
            onClick={(e) => e.stopPropagation()}
          >
            <KebabIcon />
          </button>
          <ul className='dropdown-content menu menu-sm bg-base-100 border border-base-300 rounded-xl shadow-xl shadow-black/40 z-20 w-36 p-1 text-xs'>
            {onRename && (
              <li>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename()
                  }}
                  className='rounded-md text-base-content/80'
                >
                  Rename
                </button>
              </li>
            )}
            {onDelete && (
              <li>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsConfirmingDelete(true)
                  }}
                  className='rounded-md text-error font-medium'
                >
                  Delete
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className='card card-border bg-base-100 p-4 text-center'>
        <p className='text-sm text-base-content/50'>No conversations yet</p>
      </div>
    )
  }

  return (
    <div className='card card-border bg-base-100 rounded-2xl'>
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </div>
  )
}
