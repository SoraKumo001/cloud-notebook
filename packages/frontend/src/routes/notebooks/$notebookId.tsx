import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, MoreVertical } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SourceList } from '../../components/SourceList'
import { useAuth } from '../../contexts/AuthContext'
import type { IngestProgressItem } from '../../hooks/useIngestPipeline'
import { useIngestPipeline } from '../../hooks/useIngestPipeline'
import { useNotes } from '../../hooks/useNotes'
import { useSources } from '../../hooks/useSources'

// Heavy components loaded on demand (React.lazy)
const ChatPanel = React.lazy(() =>
  import('../../components/ChatPanel').then((m) => ({ default: m.ChatPanel })),
)
const WebpageImporter = React.lazy(() =>
  import('../../components/WebpageImporter').then((m) => ({ default: m.WebpageImporter })),
)
const NotebookSettingsModal = React.lazy(() =>
  import('../../components/NotebookSettingsModal').then((m) => ({
    default: m.NotebookSettingsModal,
  })),
)
const GlobalSettingsModal = React.lazy(() =>
  import('../../components/GlobalSettingsModal').then((m) => ({
    default: m.GlobalSettingsModal,
  })),
)
const NoteList = React.lazy(() =>
  import('../../components/NoteList').then((m) => ({ default: m.NoteList })),
)
const NoteEditor = React.lazy(() =>
  import('../../components/NoteEditor').then((m) => ({ default: m.NoteEditor })),
)

// NotebookSettingsNotebook type is erased at runtime — only static type import needed
import type { NotebookSettingsNotebook } from '../../components/NotebookSettingsModal'

export const Route = createFileRoute('/notebooks/$notebookId')({
  component: NotebookDetailPage,
})

interface Notebook {
  id: string
  title: string
  description: string | null
  ai_provider?: string | null
  ai_base_url?: string | null
  ai_embedding_model?: string | null
  model_chat?: string | null
  model_summarization?: string | null
  ai_api_key?: string | null
  [key: string]: unknown
}

function NotebookDetailPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { notebookId } = useParams({ from: '/notebooks/$notebookId' })
  const { user, loading: authLoading } = useAuth()
  const [notebook, setNotebook] = React.useState<Notebook | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { uploadFiles, uploadWebpage, progress, isProcessing, clearAllErrors } = useIngestPipeline(
    notebookId,
    user?.id ?? '',
  )
  const {
    sources,
    refresh,
    deleteSource,
    renameSource,
    reorderSources,
    updateNotebook,
    deleteNotebook,
  } = useSources(notebookId)
  const { notes, createNote, updateNote, deleteNote } = useNotes(notebookId)

  const [isEditingTitle, setIsEditingTitle] = React.useState(false)
  const [titleInput, setTitleInput] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = React.useState(false)
  const [activeNoteId, setActiveNoteId] = React.useState<string | null>(null)
  const titleInputRef = React.useRef<HTMLInputElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: '/login' })
    }
  }, [user, authLoading, navigate])

  // Map hook progress (detailed) → IngestProgressItem (4-state for SourceList)
  const uploadProgress = React.useMemo<IngestProgressItem[]>(
    () =>
      progress.map((p) => {
        let mappedStatus: IngestProgressItem['status']
        switch (p.status) {
          case 'done':
            mappedStatus = 'done'
            break
          case 'error':
            mappedStatus = 'error'
            break
          case 'pending':
            mappedStatus = 'pending'
            break
          default:
            // parsing / uploading / finalizing → 'uploading'
            mappedStatus = 'uploading'
        }
        return { fileName: p.fileName, status: mappedStatus, percent: p.percent, error: p.error }
      }),
    [progress],
  )

  React.useEffect(() => {
    if (!user) return
    async function loadNotebook() {
      try {
        setLoading(true)
        const response = await fetch(`/api/notebooks?userId=${encodeURIComponent(user.id)}`)

        if (!response.ok) {
          throw new Error(t('errors.loadNotebooksFailed', { status: response.status }))
        }

        const data = await response.json()
        const found = (data as Notebook[]).find((n) => n.id === notebookId)

        if (!found) {
          throw new Error(t('errors.notFound', { resource: 'Notebook' }))
        }

        setNotebook(found)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.generic'))
      } finally {
        setLoading(false)
      }
    }

    loadNotebook()
  }, [notebookId, user, t])

  React.useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

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

  async function handleFilesSelected(files: File[]) {
    await uploadFiles(files)
    // Refresh the source list after uploads complete
    await refresh()
  }

  async function handleWebpageAdded(url: string) {
    await uploadWebpage(url)
    // Refresh the source list after ingestion completes
    await refresh()
  }

  function startTitleEdit() {
    setTitleInput(notebook?.title ?? '')
    setIsEditingTitle(true)
  }

  async function submitTitle() {
    const trimmed = titleInput.trim()
    if (!trimmed || trimmed === notebook?.title) {
      setIsEditingTitle(false)
      return
    }

    try {
      await updateNotebook(notebookId, { title: trimmed })
      setNotebook((prev) => (prev ? { ...prev, title: trimmed } : prev))
      setIsEditingTitle(false)
    } catch {
      // Error is handled by useSources state
    }
  }

  function cancelTitleEdit() {
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitTitle()
    } else if (event.key === 'Escape') {
      cancelTitleEdit()
    }
  }

  async function confirmDeleteNotebook() {
    try {
      await deleteNotebook(notebookId)
      navigate({ to: '/notebooks' })
    } catch {
      // Error is handled by useSources state
      setIsConfirmingDelete(false)
    }
  }

  const activeNote = React.useMemo(
    () => notes.find((n) => n.id === activeNoteId) ?? null,
    [notes, activeNoteId],
  )

  async function handleSaveNote(id: string | null, data: { title: string; content: string }) {
    if (id) {
      await updateNote(id, data)
    } else {
      const created = await createNote(data.title, data.content)
      setActiveNoteId(created.id)
    }
  }

  async function handleDeleteNote(id: string) {
    await deleteNote(id)
    if (id === activeNoteId) {
      setActiveNoteId(notes.length > 1 ? (notes.find((n) => n.id !== id)?.id ?? null) : null)
    }
  }

  async function handleRenameNote(id: string, title: string) {
    await updateNote(id, { title })
  }

  function handleCreateNote() {
    setActiveNoteId(null)
  }

  function handleCancelEditor() {
    setActiveNoteId(notes[0]?.id ?? null)
  }

  const combinedError = error || null

  return (
    <div className='h-screen bg-base-200 text-base-content flex flex-col font-sans overflow-hidden'>
      <header className='border-b border-base-300 bg-base-100/50 backdrop-blur-md flex-shrink-0 z-40'>
        <div className='w-full px-6 h-16 flex items-center justify-between gap-4'>
          <div className='flex items-center gap-4 min-w-0'>
            <Link
              to='/notebooks'
              className='btn btn-ghost btn-circle'
              aria-label={t('notebookDetail.backToList')}
            >
              <ArrowLeft size={20} strokeWidth={2} aria-hidden='true' />
            </Link>

            {loading ? (
              <div className='skeleton h-6 w-40' />
            ) : notebook ? (
              <div className='min-w-0'>
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type='text'
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onBlur={submitTitle}
                    onKeyDown={handleTitleKeyDown}
                    className='text-lg font-semibold bg-base-300/50 border border-primary/30 rounded-md px-2 py-1 text-base-content focus:outline-none focus:ring-2 focus:ring-primary/20'
                  />
                ) : (
                  <button
                    type='button'
                    onClick={startTitleEdit}
                    className='text-lg font-semibold text-base-content hover:text-primary transition-colors cursor-pointer'
                    title={t('notebookDetail.editTitleAria')}
                  >
                    {notebook.title}
                  </button>
                )}
                {notebook.description && !isEditingTitle && (
                  <p className='text-xs text-base-content/50 truncate hidden sm:block'>
                    {notebook.description}
                  </p>
                )}
              </div>
            ) : (
              <span className='text-lg font-semibold text-base-content'>
                {t('notebookList.title')}
              </span>
            )}
          </div>

          {!loading && notebook && (
            <div ref={menuRef} className='relative flex-shrink-0'>
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((prev) => !prev)
                }}
                className='btn btn-ghost btn-circle btn-sm'
                aria-label={t('notebookDetail.actionsAria')}
              >
                <MoreVertical size={20} strokeWidth={2} aria-hidden='true' />
              </button>

              {menuOpen && (
                <ul className='absolute right-0 top-full mt-2 w-48 bg-base-100 border border-base-300 rounded-xl shadow-xl shadow-black/40 py-2 z-50 text-sm'>
                  <li>
                    <button
                      type='button'
                      onClick={() => {
                        setIsSettingsOpen(true)
                        setMenuOpen(false)
                      }}
                      className='w-full text-left px-4 py-2 hover:bg-base-200 transition-colors text-base-content'
                    >
                      {t('notebookDetail.settingsMenu')}
                    </button>
                  </li>
                  <li>
                    <button
                      type='button'
                      onClick={() => {
                        setIsGlobalSettingsOpen(true)
                        setMenuOpen(false)
                      }}
                      className='w-full text-left px-4 py-2 hover:bg-base-200 transition-colors text-base-content'
                    >
                      {t('notebookDetail.globalSettingsMenu')}
                    </button>
                  </li>
                  <li>
                    <button
                      type='button'
                      onClick={() => {
                        setIsConfirmingDelete(true)
                        setMenuOpen(false)
                      }}
                      className='w-full text-left px-4 py-2 hover:bg-error/10 text-error transition-colors font-medium'
                    >
                      {t('notebookDetail.deleteMenu')}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>
      </header>

      <main className='flex-1 flex overflow-hidden w-full relative h-[calc(100vh-4rem)]'>
        {(combinedError || sources.error) && (
          <div className='absolute top-4 left-6 right-6 z-50 alert alert-error text-sm shadow-lg backdrop-blur-md'>
            {combinedError || sources.error}
          </div>
        )}

        {isConfirmingDelete && (
          <div className='modal modal-open'>
            <div className='modal-box max-w-sm p-6'>
              <h3 className='text-lg font-semibold text-slate-100 mb-2'>
                {t('notebookDetail.deleteDialog.title')}
              </h3>
              <p className='text-sm text-slate-400 mb-6'>
                {t('notebookDetail.deleteDialog.body', { title: notebook?.title ?? '' })}
              </p>
              <div className='flex items-center justify-end gap-3'>
                <button
                  type='button'
                  onClick={() => setIsConfirmingDelete(false)}
                  className='btn btn-ghost'
                >
                  {t('common.cancel')}
                </button>
                <button type='button' onClick={confirmDeleteNotebook} className='btn btn-error'>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {notebook && (
          <React.Suspense fallback={null}>
            <NotebookSettingsModal
              notebookId={notebookId}
              notebook={notebook as NotebookSettingsNotebook}
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              onSaved={(updated) => setNotebook((prev) => (prev ? { ...prev, ...updated } : prev))}
            />
            <GlobalSettingsModal
              isOpen={isGlobalSettingsOpen}
              onClose={() => setIsGlobalSettingsOpen(false)}
            />
          </React.Suspense>
        )}

        {loading ? (
          <div className='flex-1 flex divide-x divide-base-300 h-full w-full'>
            <div className='w-96 flex-shrink-0 p-6 space-y-6'>
              <div className='skeleton h-8 w-24' />
              <div className='skeleton h-32 w-full' />
            </div>
            <div className='flex-1 p-6 space-y-6 bg-base-200/20'>
              <div className='skeleton h-full w-full' />
            </div>
            <div className='w-96 flex-shrink-0 p-6 space-y-6'>
              <div className='skeleton h-32 w-full' />
              <div className='skeleton h-48 w-full' />
            </div>
          </div>
        ) : (
          <div className='flex-1 flex divide-x divide-base-300 h-full w-full overflow-hidden'>
            {/* Column 1: Sources (Width: w-96, Scrollable) */}
            <div className='w-96 flex-shrink-0 flex flex-col h-full bg-base-100/10 overflow-hidden'>
              <div className='flex-1 overflow-y-auto p-5 space-y-6'>
                <section>
                  <React.Suspense fallback={<div className='skeleton h-32 w-full rounded-2xl' />}>
                    <WebpageImporter
                      notebookId={notebookId}
                      userId={user?.id ?? ''}
                      uploadWebpage={handleWebpageAdded}
                      isProcessing={isProcessing}
                    />
                  </React.Suspense>
                </section>

                <section>
                  <SourceList
                    sources={sources}
                    notebookId={notebookId}
                    onDelete={deleteSource}
                    onRename={renameSource}
                    onReorder={reorderSources}
                    onFilesSelected={handleFilesSelected}
                    uploadProgress={uploadProgress}
                    onClearErrors={clearAllErrors}
                  />
                </section>
              </div>
            </div>

            {/* Column 2: Chat (Width: flex-1, Fixed scroll inside ChatPanel) */}
            <div className='flex-1 flex flex-col h-full bg-base-200/20 p-5 overflow-hidden'>
              <React.Suspense fallback={<div className='skeleton h-full w-full rounded-2xl' />}>
                <ChatPanel notebookId={notebookId} userId={user?.id ?? ''} />
              </React.Suspense>
            </div>

            {/* Column 3: Notes & Studio (Width: w-96, Scrollable) */}
            <div className='w-96 flex-shrink-0 flex flex-col h-full bg-base-100/10 overflow-hidden'>
              <div className='flex-1 overflow-y-auto p-5 space-y-6'>
                <section className='space-y-4'>
                  <div>
                    <h2 className='text-sm font-semibold text-base-content/90 uppercase tracking-wider'>
                      {t('notebookDetail.studio.title')}
                    </h2>
                    <p className='text-xs text-base-content/50'>
                      {t('notebookDetail.studio.subtitle')}
                    </p>
                  </div>
                  <React.Suspense fallback={<div className='skeleton h-48 w-full rounded-2xl' />}>
                    <NoteList
                      notes={notes}
                      activeNoteId={activeNoteId}
                      onSelect={setActiveNoteId}
                      onCreate={handleCreateNote}
                      onDelete={handleDeleteNote}
                      onRename={handleRenameNote}
                    />
                  </React.Suspense>
                  <React.Suspense fallback={<div className='skeleton h-64 w-full rounded-2xl' />}>
                    <NoteEditor
                      note={activeNote}
                      onSave={handleSaveNote}
                      onCancel={handleCancelEditor}
                    />
                  </React.Suspense>
                </section>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
