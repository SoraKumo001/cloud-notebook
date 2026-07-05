import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Download,
  MoreVertical,
  PanelRightOpen,
  Pencil,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SourceList } from '../../components/SourceList'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import type { IngestProgressItem } from '../../hooks/useIngestPipeline'
import { useIngestPipeline } from '../../hooks/useIngestPipeline'
import { useNotes } from '../../hooks/useNotes'
import { useSources } from '../../hooks/useSources'
import { LanguageSwitcher } from '../../i18n/components/LanguageSwitcher'

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
const SourceEditor = React.lazy(() =>
  import('../../components/SourceEditor').then((m) => ({ default: m.SourceEditor })),
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
    createSource,
    reorderSources,
    updateNotebook,
    deleteNotebook,
    getSourceContent,
    updateSourceContent,
    bulkDeleteSources,
    refreshSource,
  } = useSources(notebookId)
  const { notes, createNote, updateNote, deleteNote } = useNotes(notebookId)

  const [isEditingTitle, setIsEditingTitle] = React.useState(false)
  const [titleInput, setTitleInput] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = React.useState(false)
  const [activeNoteId, setActiveNoteId] = React.useState<string | null>(null)
  const [editingSourceId, setEditingSourceId] = React.useState<string | null>(null)
  const [isNotesCollapsed, setIsNotesCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('cloud-notebook:notes-collapsed') === 'true'
  })
  const titleInputRef = React.useRef<HTMLInputElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('cloud-notebook:notes-collapsed', String(isNotesCollapsed))
  }, [isNotesCollapsed])

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

  const editingSource = React.useMemo(
    () => sources.find((s) => s.id === editingSourceId) ?? null,
    [sources, editingSourceId],
  )

  React.useEffect(() => {
    if (editingSourceId && !editingSource) {
      setEditingSourceId(null)
    }
  }, [editingSourceId, editingSource])

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

  async function handleExport() {
    if (!notebook) return
    setIsExporting(true)
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/export`)
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const contentDisposition = res.headers.get('Content-Disposition')
      let filename = 'export.md'
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/)
        if (match) filename = match[1]
      }
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleRenameNote(id: string, title: string) {
    await updateNote(id, { title })
  }

  async function handleEditSource(id: string) {
    setEditingSourceId(id)
  }

  async function handleCreateSource(type: 'text' | 'markdown') {
    const source = await createSource(type)
    setEditingSourceId(source.id)
  }

  async function handleSaveSourceContent(id: string, content: string) {
    const { chunkText } = await import('../../lib/tokenizer')
    const chunks = chunkText(content).map((chunk) => ({ content: chunk.content }))
    await updateSourceContent(id, content, chunks)
    setEditingSourceId(null)
  }

  function handleCloseSourceEditor() {
    setEditingSourceId(null)
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
            <Button
              as='link'
              to='/notebooks'
              shape='circle'
              variant='ghost'
              iconLeft={ArrowLeft}
              iconOnlyAriaLabel={t('notebookDetail.backToList')}
            />

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
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    iconLeft={Pencil}
                    onClick={startTitleEdit}
                    title={t('notebookDetail.editTitleAria')}
                    className='text-lg font-semibold text-base-content hover:text-primary transition-colors cursor-pointer'
                  >
                    {notebook.title}
                  </Button>
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
            <div ref={menuRef} className='relative flex-shrink-0 flex items-center space-x-2'>
              <LanguageSwitcher />
              <Button
                type='button'
                size='sm'
                shape='circle'
                variant='ghost'
                iconLeft={MoreVertical}
                iconOnlyAriaLabel={t('notebookDetail.actionsAria')}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((prev) => !prev)
                }}
              />

              {menuOpen && (
                <ul className='absolute right-0 top-full mt-2 w-48 bg-base-100 border border-base-300 rounded-xl shadow-xl shadow-black/40 py-2 z-50 text-sm'>
                  <li>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      iconLeft={Settings}
                      className='w-full justify-start px-4 py-2 text-base-content'
                      onClick={() => {
                        setIsSettingsOpen(true)
                        setMenuOpen(false)
                      }}
                    >
                      {t('notebookDetail.settingsMenu')}
                    </Button>
                  </li>
                  <li>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      iconLeft={Settings}
                      className='w-full justify-start px-4 py-2 text-base-content'
                      onClick={() => {
                        setIsGlobalSettingsOpen(true)
                        setMenuOpen(false)
                      }}
                    >
                      {t('notebookDetail.globalSettingsMenu')}
                    </Button>
                  </li>
                  <li>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      iconLeft={Download}
                      className='w-full justify-start px-4 py-2 text-base-content'
                      disabled={isExporting}
                      onClick={() => {
                        void handleExport()
                        setMenuOpen(false)
                      }}
                    >
                      {isExporting
                        ? t('notebookDetail.export.downloading')
                        : t('notebookDetail.export.menu')}
                    </Button>
                  </li>
                  <li>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      iconLeft={Trash2}
                      className='w-full justify-start px-4 py-2 text-error font-medium'
                      onClick={() => {
                        setIsConfirmingDelete(true)
                        setMenuOpen(false)
                      }}
                    >
                      {t('notebookDetail.deleteMenu')}
                    </Button>
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
                <Button
                  type='button'
                  variant='ghost'
                  iconLeft={X}
                  onClick={() => setIsConfirmingDelete(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type='button'
                  variant='error'
                  iconLeft={Trash2}
                  onClick={confirmDeleteNotebook}
                >
                  {t('common.delete')}
                </Button>
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
                    onEdit={handleEditSource}
                    onCreateSource={handleCreateSource}
                    onReorder={reorderSources}
                    onFilesSelected={handleFilesSelected}
                    uploadProgress={uploadProgress}
                    onClearErrors={clearAllErrors}
                    onBulkDelete={bulkDeleteSources}
                    onRefresh={refreshSource}
                  />
                </section>
              </div>
            </div>

            {/* Column 2: Chat or Source Editor (Width: flex-1, Fixed scroll inside) */}
            <div className='flex-1 flex flex-col h-full bg-base-200/20 p-5 overflow-hidden'>
              <React.Suspense fallback={<div className='skeleton h-full w-full rounded-2xl' />}>
                {editingSource ? (
                  <SourceEditor
                    source={editingSource}
                    notebookId={notebookId}
                    onClose={handleCloseSourceEditor}
                    onSave={handleSaveSourceContent}
                    getSourceContent={getSourceContent}
                  />
                ) : (
                  <ChatPanel notebookId={notebookId} userId={user?.id ?? ''} />
                )}
              </React.Suspense>
            </div>

            {/* Column 3: Notes & Studio (collapsible) */}
            <div
              className={`flex-shrink-0 flex flex-col h-full bg-base-100/10 overflow-hidden transition-all duration-300 ${
                isNotesCollapsed ? 'w-12' : 'w-96'
              }`}
            >
              {isNotesCollapsed ? (
                <div className='flex-1 flex flex-col items-center pt-4'>
                  <button
                    type='button'
                    onClick={() => setIsNotesCollapsed(false)}
                    className='btn btn-ghost btn-sm btn-circle'
                    aria-label={t('notebookDetail.expandNotes')}
                    title={t('notebookDetail.expandNotes')}
                  >
                    <PanelRightOpen size={16} strokeWidth={2} aria-hidden='true' />
                  </button>
                </div>
              ) : (
                <div className='flex-1 overflow-y-auto p-5 space-y-6'>
                  <section className='space-y-4'>
                    <React.Suspense fallback={<div className='skeleton h-48 w-full rounded-2xl' />}>
                      <NoteList
                        notes={notes}
                        activeNoteId={activeNoteId}
                        onSelect={setActiveNoteId}
                        onCreate={handleCreateNote}
                        onDelete={handleDeleteNote}
                        onRename={handleRenameNote}
                        onCollapse={() => setIsNotesCollapsed(true)}
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
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
