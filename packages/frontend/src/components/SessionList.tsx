import { MoreVertical, Pencil, Search, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../i18n/formatters'
import { useLocale } from '../i18n/useLocale'
import { Button } from './ui/Button'

export interface ChatSession {
  id: string
  title: string
  created_at: string
}

export interface SearchResultItem {
  session: ChatSession
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
}

interface SessionListProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
  onSearch?: (query: string) => void
  searchResults?: SearchResultItem[]
  isSearching?: boolean
  onClearSearch?: () => void
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  t,
  locale,
}: {
  session: ChatSession
  isActive: boolean
  onSelect: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
  t: (key: string) => string
  locale: string
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
        <p className='text-xs text-base-content/60 mb-2'>{t('sessionList.deleteDialog.title')}</p>
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
        <p className='text-xs text-base-content/50'>
          {formatShortDate(locale, session.created_at)}
        </p>
      </button>

      {(onDelete || onRename) && (
        <div className='dropdown dropdown-end dropdown-top absolute right-2 top-1/2 -translate-y-1/2 z-10'>
          <Button
            type='button'
            size='sm'
            shape='circle'
            variant='ghost'
            iconLeft={MoreVertical}
            iconOnlyAriaLabel={t('sessionList.actionsAria')}
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
          />
          <ul className='dropdown-content menu menu-sm bg-base-100 border border-base-300 rounded-xl shadow-xl shadow-black/40 z-20 w-36 p-1 text-xs'>
            {onRename && (
              <li>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  iconLeft={Pencil}
                  className='w-full justify-start rounded-md text-base-content/80'
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename()
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
                  className='w-full justify-start rounded-md text-error font-medium'
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsConfirmingDelete(true)
                  }}
                >
                  {t('common.delete')}
                </Button>
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
  onSearch,
  searchResults,
  isSearching,
  onClearSearch,
}: SessionListProps) {
  const { t } = useTranslation('common')
  const { locale } = useLocale()
  const [searchQuery, setSearchQuery] = React.useState('')

  function handleSearch() {
    if (searchQuery.trim() && onSearch) {
      onSearch(searchQuery.trim())
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSearch()
    }
  }

  function handleClearSearch() {
    setSearchQuery('')
    onClearSearch?.()
  }

  const showSearchResults = searchResults !== undefined && searchResults.length > 0
  const showNoResults = searchResults !== undefined && searchResults.length === 0 && !isSearching

  return (
    <div className='space-y-3'>
      {/* Search input */}
      {onSearch && (
        <div className='flex items-center gap-2'>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('sessionList.search.placeholder')}
            className='input input-bordered input-sm flex-1'
          />
          <button
            type='button'
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className='btn btn-primary btn-sm'
          >
            {isSearching ? (
              <span className='loading loading-spinner loading-xs' />
            ) : (
              <Search size={14} strokeWidth={2} aria-hidden='true' />
            )}
            {t('sessionList.search.button')}
          </button>
        </div>
      )}

      {/* Search results header */}
      {showSearchResults && (
        <div className='flex items-center justify-between'>
          <p className='text-xs text-base-content/60'>
            {t('sessionList.search.results', { count: searchResults.length })}
          </p>
          <button type='button' onClick={handleClearSearch} className='btn btn-ghost btn-xs'>
            {t('sessionList.search.clear')}
          </button>
        </div>
      )}

      {showNoResults && (
        <div className='card card-border bg-base-100 p-4 text-center'>
          <p className='text-sm text-base-content/50'>
            {t('sessionList.search.noResults', { query: searchQuery })}
          </p>
        </div>
      )}

      {/* Search results list */}
      {showSearchResults && (
        <div className='card card-border bg-base-100 rounded-2xl'>
          {searchResults.map((item) => (
            <div key={item.session.id} className='border-b border-base-300 last:border-b-0'>
              <SessionItem
                session={item.session}
                isActive={item.session.id === activeSessionId}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
                t={t}
                locale={locale}
              />
              {item.messages.length > 0 && (
                <div className='px-4 pb-3 space-y-1'>
                  {item.messages.slice(0, 3).map((msg) => (
                    <p key={msg.id} className='text-xs text-base-content/50 truncate'>
                      {t('sessionList.search.messagePreview', {
                        role: msg.role,
                        content: msg.content,
                      })}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Normal session list (hidden when showing search results) */}
      {!showSearchResults &&
        !showNoResults &&
        (sessions.length === 0 ? (
          <div className='card card-border bg-base-100 p-4 text-center'>
            <p className='text-sm text-base-content/50'>{t('sessionList.empty')}</p>
          </div>
        ) : (
          <div className='card card-border bg-base-100 rounded-2xl'>
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
                t={t}
                locale={locale}
              />
            ))}
          </div>
        ))}
    </div>
  )
}
