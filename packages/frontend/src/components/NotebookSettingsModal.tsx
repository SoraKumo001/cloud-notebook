import { AlertTriangle, CircleCheck, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { McpTokenPanel } from './McpTokenPanel'

export interface NotebookSettingsNotebook {
  id: string
  title: string
  description: string | null
  ai_embedding_model?: string | null
  model_chat?: string | null
  model_summarization?: string | null
  [key: string]: unknown
}

interface NotebookSettingsModalProps {
  notebookId: string
  notebook: NotebookSettingsNotebook
  isOpen: boolean
  onClose: () => void
  onSaved?: (notebook: NotebookSettingsNotebook) => void
}

interface ProviderModels {
  connectionId: string
  connectionName: string
  models: string[]
}

function sectionTitle(title: string) {
  return (
    <h3 className='text-sm font-semibold text-base-content/90 uppercase tracking-wider'>{title}</h3>
  )
}

export function NotebookSettingsModal({
  notebookId,
  notebook,
  isOpen,
  onClose,
  onSaved,
}: NotebookSettingsModalProps) {
  const { t } = useTranslation('common')
  const [title, setTitle] = React.useState(notebook.title)
  const [description, setDescription] = React.useState(notebook.description ?? '')

  const [embeddingModel, setEmbeddingModel] = React.useState(
    notebook.ai_embedding_model ?? 'inherit',
  )
  const [chatModel, setChatModel] = React.useState(notebook.model_chat ?? 'inherit')
  const [summarizationModel, setSummarizationModel] = React.useState(
    notebook.model_summarization ?? 'inherit',
  )

  const [chatGroupCandidates, setChatGroupCandidates] = React.useState<ProviderModels[]>([])
  const [embeddingGroupCandidates, setEmbeddingGroupCandidates] = React.useState<ProviderModels[]>(
    [],
  )

  // Direct Input toggles
  const [customEmbedding, setCustomEmbedding] = React.useState(false)
  const [customChat, setCustomChat] = React.useState(false)
  const [customSummarization, setCustomSummarization] = React.useState(false)

  const [isSaving, setIsSaving] = React.useState(false)
  const [modelsLoading, setModelsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reindex state
  const [savedEmbeddingModel, setSavedEmbeddingModel] = React.useState(
    notebook.ai_embedding_model ?? 'inherit',
  )
  const [needsReindex, setNeedsReindex] = React.useState(false)
  const [isReindexing, setIsReindexing] = React.useState(false)
  const [reindexDone, setReindexDone] = React.useState(false)

  // Fetch connection list and build candidates
  const fetchData = React.useCallback(async () => {
    setError(null)
    setModelsLoading(true)
    try {
      const connRes = await fetch('/api/connections')
      if (!connRes.ok) throw new Error(t('errors.loadConnectionsFailed'))
      const connections: Array<{ id: string; name: string; provider: string }> =
        await connRes.json()

      const allConns = [
        { id: 'workers-ai', name: t('notebookSettings.providerGroup') },
        ...connections.map((c) => ({ id: c.id, name: c.name })),
      ]

      const chatPromises = allConns.map((c) =>
        fetch(`/api/connections/${c.id}/models?type=chat`)
          .then((res) => {
            if (!res.ok) throw new Error()
            return res.json() as Promise<{ models: string[] }>
          })
          .then((data) => ({
            connectionId: c.id,
            connectionName: c.name,
            models: data.models || [],
          }))
          .catch(() => ({
            connectionId: c.id,
            connectionName: c.name,
            models: [],
          })),
      )

      const embedPromises = allConns.map((c) =>
        fetch(`/api/connections/${c.id}/models?type=embedding`)
          .then((res) => {
            if (!res.ok) throw new Error()
            return res.json() as Promise<{ models: string[] }>
          })
          .then((data) => ({
            connectionId: c.id,
            connectionName: c.name,
            models: data.models || [],
          }))
          .catch(() => ({
            connectionId: c.id,
            connectionName: c.name,
            models: [],
          })),
      )

      const chatResults = await Promise.all(chatPromises)
      const embedResults = await Promise.all(embedPromises)

      const filteredChats = chatResults.filter((r) => r.models.length > 0)
      const filteredEmbeds = embedResults.filter((r) => r.models.length > 0)

      setChatGroupCandidates(filteredChats)
      setEmbeddingGroupCandidates(filteredEmbeds)

      // Auto-toggle direct input if current settings are not in candidates list
      const currentChat = notebook.model_chat ?? 'inherit'
      if (currentChat !== 'inherit' && currentChat !== '') {
        const hasChat = filteredChats.some((g) =>
          g.models.some((m) => `${g.connectionId}:${m}` === currentChat),
        )
        if (!hasChat) setCustomChat(true)
      }

      const currentSum = notebook.model_summarization ?? 'inherit'
      if (currentSum !== 'inherit' && currentSum !== '') {
        const hasSum = filteredChats.some((g) =>
          g.models.some((m) => `${g.connectionId}:${m}` === currentSum),
        )
        if (!hasSum) setCustomSummarization(true)
      }

      const currentEmbed = notebook.ai_embedding_model ?? 'inherit'
      if (currentEmbed !== 'inherit' && currentEmbed !== '') {
        const hasEmbed = filteredEmbeds.some((g) =>
          g.models.some((m) => `${g.connectionId}:${m}` === currentEmbed),
        )
        if (!hasEmbed) setCustomEmbedding(true)
      }
    } catch (err: any) {
      setError(err.message || t('errors.fetchModelsFailed'))
    } finally {
      setModelsLoading(false)
    }
  }, [notebook, t])

  React.useEffect(() => {
    if (isOpen) {
      void fetchData()
    }
  }, [isOpen, fetchData])

  React.useEffect(() => {
    if (isOpen) {
      setTitle(notebook.title)
      setDescription(notebook.description ?? '')
      const initEmbed = notebook.ai_embedding_model ?? 'inherit'
      setEmbeddingModel(initEmbed)
      setSavedEmbeddingModel(initEmbed)
      setChatModel(notebook.model_chat ?? 'inherit')
      setSummarizationModel(notebook.model_summarization ?? 'inherit')
      setNeedsReindex(false)
      setReindexDone(false)
      setError(null)
    }
  }, [isOpen, notebook])

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen && !isSaving) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSaving, onClose])

  if (!isOpen) return null

  const isTitleEmpty = title.trim() === ''

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (isTitleEmpty) return

    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      ai_embedding_model: embeddingModel === 'inherit' ? null : embeddingModel.trim() || null,
      model_chat: chatModel === 'inherit' ? null : chatModel.trim() || null,
      model_summarization:
        summarizationModel === 'inherit' ? null : summarizationModel.trim() || null,
    }

    try {
      setIsSaving(true)
      setError(null)
      setNeedsReindex(false)
      setReindexDone(false)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error || t('common.saveFailed', { status: res.status }),
        )
      }

      const updated = (await res.json()) as NotebookSettingsNotebook
      onSaved?.(updated)

      // Detect embedding model change (only if not inherit)
      const newEmbed = embeddingModel === 'inherit' ? null : embeddingModel.trim() || null
      const oldEmbed = savedEmbeddingModel === 'inherit' ? null : savedEmbeddingModel.trim() || null
      if (newEmbed !== oldEmbed && newEmbed !== null) {
        setSavedEmbeddingModel(embeddingModel)
        setNeedsReindex(true)
      } else {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.saveFailedGeneric'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleReindex() {
    setIsReindexing(true)
    setError(null)
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/reindex`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || t('errors.reindexFailed'))
      }
      setReindexDone(true)
      setNeedsReindex(false)
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.reindexFailed'))
    } finally {
      setIsReindexing(false)
    }
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isSaving) {
      onClose()
    }
  }

  return (
    <div
      className='modal modal-open'
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      role='dialog'
      aria-modal='true'
      aria-labelledby='notebook-settings-title'
    >
      <div className='modal-box max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl'>
        <div className='px-6 py-5 border-b border-base-300 bg-base-200 flex items-center justify-between sticky top-0 z-10'>
          <h2 id='notebook-settings-title' className='text-lg font-semibold text-base-content'>
            {t('notebookSettings.title')}
          </h2>
          <button
            type='button'
            onClick={onClose}
            disabled={isSaving}
            className='btn btn-ghost btn-circle'
            aria-label={t('common.close')}
          >
            <X size={20} strokeWidth={2} aria-hidden='true' />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className='p-6 space-y-6'>
          {error && <div className='alert alert-error text-xs'>{error}</div>}

          {/* Basic info */}
          <div className='space-y-4'>
            {sectionTitle(t('notebookSettings.sectionBasic'))}
            <div className='space-y-2'>
              <label
                htmlFor='settings-title'
                className='block text-sm font-medium text-base-content/70'
              >
                {t('createNotebook.titleLabel')}
              </label>
              <input
                id='settings-title'
                type='text'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSaving}
                className='w-full input input-bordered rounded-xl'
              />
            </div>
            <div className='space-y-2'>
              <label
                htmlFor='settings-description'
                className='block text-sm font-medium text-base-content/70'
              >
                {t('createNotebook.descriptionLabel')}
              </label>
              <textarea
                id='settings-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSaving}
                rows={3}
                className='w-full textarea textarea-bordered resize-none rounded-xl'
              />
            </div>
          </div>

          {/* AI settings */}
          <div className='border-t border-base-300 pt-6 space-y-4'>
            {sectionTitle(t('notebookSettings.sectionAi'))}

            <div className='space-y-4'>
              {/* Embedding Model */}
              <div className='space-y-2'>
                <div className='flex justify-between items-center mb-1'>
                  <label
                    htmlFor='settings-embedding'
                    className='block text-sm font-medium text-base-content/70'
                  >
                    {t('notebookSettings.embeddingModel')}
                  </label>
                  <button
                    type='button'
                    className='text-[10px] text-primary hover:underline font-semibold'
                    onClick={() => setCustomEmbedding(!customEmbedding)}
                  >
                    {customEmbedding
                      ? t('notebookSettings.selectFromList')
                      : t('notebookSettings.directInput')}
                  </button>
                </div>
                {customEmbedding || embeddingGroupCandidates.length === 0 ? (
                  <input
                    id='settings-embedding'
                    type='text'
                    value={embeddingModel}
                    onChange={(e) => setEmbeddingModel(e.target.value)}
                    disabled={isSaving || modelsLoading}
                    className='w-full input input-bordered rounded-xl'
                  />
                ) : (
                  <select
                    id='settings-embedding'
                    className='select select-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none'
                    value={embeddingModel}
                    onChange={(e) => setEmbeddingModel(e.target.value)}
                    disabled={isSaving || modelsLoading}
                  >
                    <option value='inherit'>{t('notebookSettings.useGlobal')}</option>
                    {embeddingGroupCandidates.map((group) => (
                      <optgroup key={group.connectionId} label={group.connectionName}>
                        {group.models.map((m) => (
                          <option
                            key={`${group.connectionId}:${m}`}
                            value={`${group.connectionId}:${m}`}
                          >
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>

              {/* Chat Model */}
              <div className='space-y-2'>
                <div className='flex justify-between items-center mb-1'>
                  <label
                    htmlFor='settings-chat'
                    className='block text-sm font-medium text-base-content/70'
                  >
                    {t('notebookSettings.chatModel')}
                  </label>
                  <button
                    type='button'
                    className='text-[10px] text-primary hover:underline font-semibold'
                    onClick={() => setCustomChat(!customChat)}
                  >
                    {customChat
                      ? t('notebookSettings.selectFromList')
                      : t('notebookSettings.directInput')}
                  </button>
                </div>
                {customChat || chatGroupCandidates.length === 0 ? (
                  <input
                    id='settings-chat'
                    type='text'
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    disabled={isSaving || modelsLoading}
                    className='w-full input input-bordered rounded-xl'
                  />
                ) : (
                  <select
                    id='settings-chat'
                    className='select select-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none'
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    disabled={isSaving || modelsLoading}
                  >
                    <option value='inherit'>{t('notebookSettings.useGlobal')}</option>
                    {chatGroupCandidates.map((group) => (
                      <optgroup key={group.connectionId} label={group.connectionName}>
                        {group.models.map((m) => (
                          <option
                            key={`${group.connectionId}:${m}`}
                            value={`${group.connectionId}:${m}`}
                          >
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>

              {/* Summarization Model */}
              <div className='space-y-2'>
                <div className='flex justify-between items-center mb-1'>
                  <label
                    htmlFor='settings-summarization'
                    className='block text-sm font-medium text-base-content/70'
                  >
                    {t('notebookSettings.summarizationModel')}
                  </label>
                  <button
                    type='button'
                    className='text-[10px] text-primary hover:underline font-semibold'
                    onClick={() => setCustomSummarization(!customSummarization)}
                  >
                    {customSummarization
                      ? t('notebookSettings.selectFromList')
                      : t('notebookSettings.directInput')}
                  </button>
                </div>
                {customSummarization || chatGroupCandidates.length === 0 ? (
                  <input
                    id='settings-summarization'
                    type='text'
                    value={summarizationModel}
                    onChange={(e) => setSummarizationModel(e.target.value)}
                    disabled={isSaving || modelsLoading}
                    className='w-full input input-bordered rounded-xl'
                  />
                ) : (
                  <select
                    id='settings-summarization'
                    className='select select-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none'
                    value={summarizationModel}
                    onChange={(e) => setSummarizationModel(e.target.value)}
                    disabled={isSaving || modelsLoading}
                  >
                    <option value='inherit'>{t('notebookSettings.useGlobal')}</option>
                    {chatGroupCandidates.map((group) => (
                      <optgroup key={group.connectionId} label={group.connectionName}>
                        {group.models.map((m) => (
                          <option
                            key={`${group.connectionId}:${m}`}
                            value={`${group.connectionId}:${m}`}
                          >
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* MCP integration */}
          <div className='border-t border-base-300 pt-6 space-y-4'>
            {sectionTitle(t('notebookSettings.sectionMcp'))}
            <McpTokenPanel notebookId={notebookId} />
          </div>

          {/* Reindex Warning */}
          {needsReindex && (
            <div className='mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4 space-y-3'>
              <div className='flex items-start gap-2'>
                <AlertTriangle
                  aria-hidden='true'
                  size={20}
                  strokeWidth={2}
                  className='h-5 w-5 text-warning shrink-0 mt-0.5'
                />
                <div>
                  <p className='text-sm font-semibold text-warning'>
                    {t('notebookSettings.reindex.warningTitle')}
                  </p>
                  <p className='text-xs text-base-content/70 mt-0.5'>
                    {t('notebookSettings.reindex.warningBody')}
                  </p>
                </div>
              </div>
              <div className='flex justify-end gap-2'>
                <button
                  type='button'
                  onClick={onClose}
                  className='btn btn-ghost btn-sm rounded-xl text-xs'
                  disabled={isReindexing}
                >
                  {t('notebookSettings.reindex.later')}
                </button>
                <button
                  type='button'
                  onClick={() => void handleReindex()}
                  className='btn btn-warning btn-sm rounded-xl text-xs font-semibold'
                  disabled={isReindexing}
                >
                  {isReindexing ? (
                    <>
                      <span className='loading loading-spinner loading-xs' />
                      {t('notebookSettings.reindex.running')}
                    </>
                  ) : (
                    t('notebookSettings.reindex.run')
                  )}
                </button>
              </div>
            </div>
          )}

          {reindexDone && (
            <div className='mt-4 alert alert-success text-xs rounded-xl shadow border border-success/20 flex gap-2 py-2'>
              <CircleCheck
                aria-hidden='true'
                size={16}
                strokeWidth={2}
                className='stroke-current shrink-0 h-4 w-4'
              />
              <span>{t('notebookSettings.reindex.done')}</span>
            </div>
          )}

          {!needsReindex && (
            <div className='flex items-center justify-end gap-3 pt-4 border-t border-base-300'>
              <button
                type='button'
                onClick={onClose}
                disabled={isSaving}
                className='btn btn-neutral rounded-xl px-5 text-sm font-medium'
              >
                {t('common.cancel')}
              </button>
              <button
                type='submit'
                disabled={isSaving || isTitleEmpty || modelsLoading}
                className='btn btn-primary rounded-xl px-5 text-sm font-medium'
              >
                {isSaving ? t('common.saving') : t('common.saveChanges')}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
