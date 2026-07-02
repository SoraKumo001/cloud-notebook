import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { BookOpen, Database, Plus, Search, Settings, UserPlus } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CreateNotebookFormData,
  CreateNotebookModal,
} from '../../components/CreateNotebookModal'
import { type Notebook, NotebookCard } from '../../components/NotebookCard'
import { useAuth } from '../../contexts/AuthContext'
import { LanguageSwitcher } from '../../i18n/components/LanguageSwitcher'

const GlobalSettingsModal = React.lazy(() =>
  import('../../components/GlobalSettingsModal').then((m) => ({
    default: m.GlobalSettingsModal,
  })),
)

const StorageSettingsModal = React.lazy(() =>
  import('../../components/StorageSettingsModal').then((m) => ({
    default: m.StorageSettingsModal,
  })),
)

const InviteUserPanel = React.lazy(() =>
  import('../../components/InviteUserPanel').then((m) => ({
    default: m.InviteUserPanel,
  })),
)

export const Route = createFileRoute('/notebooks/')({
  component: NotebooksPage,
})

type SortField = 'updated_at' | 'created_at' | 'title'
type SortOrder = 'asc' | 'desc'

interface SortOption {
  labelKey: string
  field: SortField
  order: SortOrder
}

const SORT_OPTIONS: SortOption[] = [
  { labelKey: 'notebookList.sort.updated', field: 'updated_at', order: 'desc' },
  { labelKey: 'notebookList.sort.newest', field: 'created_at', order: 'desc' },
  { labelKey: 'notebookList.sort.titleAsc', field: 'title', order: 'asc' },
  { labelKey: 'notebookList.sort.titleDesc', field: 'title', order: 'desc' },
]

function NotebooksPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { user, loading: authLoading, refresh } = useAuth()
  const [notebooks, setNotebooks] = React.useState<Notebook[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = React.useState(false)
  const [isStorageSettingsOpen, setIsStorageSettingsOpen] = React.useState(false)
  const [isInviteOpen, setIsInviteOpen] = React.useState(false)

  const [query, setQuery] = React.useState('')
  const [debouncedQuery, setDebouncedQuery] = React.useState('')
  const [sort, setSort] = React.useState<SortOption>(SORT_OPTIONS[0])

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: '/login' })
    }
  }, [user, authLoading, navigate])

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    async function loadNotebooks() {
      if (!user) return
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('userId', user.id)
        if (debouncedQuery) {
          params.set('q', debouncedQuery)
        }
        params.set('sort', sort.field)
        params.set('order', sort.order)

        const response = await fetch(`/api/notebooks?${params.toString()}`)

        if (!response.ok) {
          throw new Error(t('errors.loadNotebooksFailed', { status: response.status }))
        }

        const data = await response.json()
        setNotebooks(
          (data as Notebook[]).map((notebook) => ({
            ...notebook,
            sourceCount: notebook.sourceCount ?? 0,
            updatedAt:
              notebook.updatedAt ??
              notebook.updated_at ??
              notebook.created_at ??
              new Date().toISOString(),
          })),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.generic'))
      } finally {
        setLoading(false)
      }
    }

    loadNotebooks()
  }, [user, debouncedQuery, sort, t])

  async function handleCreate(data: CreateNotebookFormData) {
    if (!user) return
    try {
      setIsCreating(true)
      const response = await fetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          description: data.description || undefined,
          userId: user.id,
        }),
      })

      if (!response.ok) {
        throw new Error(t('errors.createFailed', { status: response.status }))
      }

      const created = await response.json()
      setNotebooks((prev) => [created, ...prev])
      setIsModalOpen(false)
      navigate({ to: '/notebooks/$notebookId', params: { notebookId: created.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className='min-h-screen bg-base-200 text-base-content flex flex-col font-sans'>
      <header className='border-b border-base-300 bg-base-100/50 backdrop-blur-md sticky top-0 z-40'>
        <div className='max-w-7xl mx-auto px-6 h-16 flex items-center justify-between'>
          <Link to='/' className='flex items-center space-x-3 group'>
            <div className='w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-teal-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/30 transition-shadow'>
              N
            </div>
            <span className='font-semibold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-base-content to-base-content/60'>
              {t('app.name')}
            </span>
          </Link>
          <div className='flex items-center space-x-4'>
            {user && (
              <span className='hidden sm:inline-flex text-sm text-base-content/60'>
                {user.name}
              </span>
            )}
            {user?.isAdmin && (
              <button
                type='button'
                onClick={() => setIsInviteOpen(true)}
                className='btn btn-ghost btn-circle btn-sm'
                aria-label={t('notebookList.inviteAria')}
                title={t('notebookList.inviteAria')}
              >
                <UserPlus size={20} strokeWidth={2} aria-hidden='true' />
              </button>
            )}
            {user?.isAdmin && (
              <button
                type='button'
                onClick={() => setIsStorageSettingsOpen(true)}
                className='btn btn-ghost btn-circle btn-sm'
                aria-label={t('notebookList.storageAria')}
                title={t('notebookList.storageAria')}
              >
                <Database size={20} strokeWidth={2} aria-hidden='true' />
              </button>
            )}
            <button
              type='button'
              onClick={() => setIsGlobalSettingsOpen(true)}
              className='btn btn-ghost btn-circle btn-sm'
              aria-label={t('notebookList.globalSettingsAria')}
            >
              <Settings size={20} strokeWidth={2} aria-hidden='true' />
            </button>
            <LanguageSwitcher />
            <button
              type='button'
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
                await refresh()
                await navigate({ to: '/login' })
              }}
              className='btn btn-neutral btn-sm rounded-xl'
            >
              {t('common.signOut')}
            </button>
          </div>
        </div>
      </header>

      <main className='flex-1 max-w-7xl w-full mx-auto px-6 py-10'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8'>
          <div>
            <h1 className='text-3xl font-bold tracking-tight text-base-content'>
              {t('notebookList.title')}
            </h1>
            <p className='mt-1 text-base-content/60'>{t('notebookList.subtitle')}</p>
          </div>
          <button type='button' onClick={() => setIsModalOpen(true)} className='btn btn-primary'>
            <Plus size={18} strokeWidth={2} aria-hidden='true' />
            {t('notebookList.newNotebook')}
          </button>
        </div>

        {/* Search and sort */}
        <div className='flex flex-col sm:flex-row gap-3 mb-8'>
          <div className='relative flex-1'>
            <Search
              size={18}
              strokeWidth={2}
              className='absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50'
              aria-hidden='true'
            />
            <input
              type='text'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('notebookList.searchPlaceholder')}
              className='w-full pl-10 pr-4 py-2.5 rounded-xl bg-base-100/40 border border-base-300 text-base-content placeholder:text-base-content/50 focus:outline-none focus:border-secondary/50 focus:ring-2 focus:ring-secondary/20 hover:border-base-300 transition-all'
            />
          </div>
          <select
            value={`${sort.field}:${sort.order}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split(':') as [SortField, SortOrder]
              const option = SORT_OPTIONS.find((o) => o.field === field && o.order === order)
              if (option) setSort(option)
            }}
            className='px-4 py-2.5 rounded-xl bg-base-100/40 border border-base-300 text-base-content focus:outline-none focus:border-secondary/50 focus:ring-2 focus:ring-secondary/20 hover:border-base-300 transition-all cursor-pointer'
          >
            {SORT_OPTIONS.map((option) => (
              <option
                key={`${option.field}:${option.order}`}
                value={`${option.field}:${option.order}`}
              >
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {error && <div className='alert alert-error text-sm mb-8'>{error}</div>}

        {loading ? (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <div
                key={`skel-${n}`}
                className='p-6 rounded-2xl bg-base-100/40 border border-base-300 space-y-4'
              >
                <div className='flex items-start justify-between'>
                  <div className='skeleton w-10 h-10 rounded-xl' />
                  <div className='skeleton w-16 h-6 rounded-full' />
                </div>
                <div className='skeleton h-5 w-3/4' />
                <div className='space-y-2'>
                  <div className='skeleton h-3 w-full' />
                  <div className='skeleton h-3 w-2/3' />
                </div>
                <div className='skeleton h-3 w-24' />
              </div>
            ))}
          </div>
        ) : notebooks.length === 0 ? (
          <div className='rounded-2xl border border-dashed border-base-300 bg-base-100/30 p-12 text-center'>
            <div className='mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-secondary/15 to-teal-500/15 border border-secondary/20 text-secondary'>
              <BookOpen size={32} strokeWidth={2} aria-hidden='true' />
            </div>
            <h2 className='text-xl font-semibold text-base-content/90 mb-2'>
              {debouncedQuery ? t('notebookList.emptySearch') : t('notebookList.empty')}
            </h2>
            <p className='text-base-content/60 max-w-md mx-auto mb-6'>
              {debouncedQuery
                ? t('notebookList.emptySearchHint', { query: debouncedQuery })
                : t('notebookList.emptyHint')}
            </p>
            {debouncedQuery ? (
              <button type='button' onClick={() => setQuery('')} className='btn btn-neutral'>
                {t('notebookList.clearSearch')}
              </button>
            ) : (
              <button
                type='button'
                onClick={() => setIsModalOpen(true)}
                className='btn btn-primary'
              >
                {t('notebookList.newNotebook')}
              </button>
            )}
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {notebooks.map((notebook) => (
              <NotebookCard key={notebook.id} notebook={notebook} />
            ))}
          </div>
        )}
      </main>

      <CreateNotebookModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreate}
        isSubmitting={isCreating}
      />
      <React.Suspense fallback={null}>
        <GlobalSettingsModal
          isOpen={isGlobalSettingsOpen}
          onClose={() => setIsGlobalSettingsOpen(false)}
        />
      </React.Suspense>

      <React.Suspense fallback={null}>
        <StorageSettingsModal
          isOpen={isStorageSettingsOpen}
          onClose={() => setIsStorageSettingsOpen(false)}
          isAdmin={!!user?.isAdmin}
        />
      </React.Suspense>

      {isInviteOpen && (
        <div className='modal modal-open' role='dialog' aria-modal='true'>
          <button
            type='button'
            aria-label={t('notebookList.closeInvite')}
            className='absolute inset-0 w-full h-full cursor-default bg-transparent border-0'
            onClick={() => setIsInviteOpen(false)}
          />
          <div className='modal-box max-w-lg p-0 relative'>
            <div className='flex items-center justify-between border-b border-base-300 px-5 py-3'>
              <h2 className='text-lg font-semibold'>{t('notebookList.inviteTitle')}</h2>
              <button
                type='button'
                onClick={() => setIsInviteOpen(false)}
                className='btn btn-ghost btn-sm btn-circle'
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <React.Suspense fallback={null}>
              <InviteUserPanel />
            </React.Suspense>
          </div>
        </div>
      )}
    </div>
  )
}
