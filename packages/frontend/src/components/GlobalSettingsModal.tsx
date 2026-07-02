import { AlertTriangle, CircleCheck, Trash2, XCircle } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export interface GlobalSettings {
  ai_embedding_model: string
  model_chat: string
  model_summarization: string
}

export interface Connection {
  id: string
  name: string
  provider: string
  has_api_key: boolean
  base_url: string | null
  created_at: string
}

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const PROVIDER_OPTIONS = [
  { value: 'workers-ai', label: 'workersAi' },
  { value: 'openai', label: 'openai' },
  { value: 'anthropic', label: 'anthropic' },
  { value: 'google', label: 'google' },
  { value: 'custom', label: 'custom' },
]

interface ProviderModels {
  connectionId: string
  connectionName: string
  models: string[]
}

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const { t } = useTranslation('common')
  // Tabs: 'settings' | 'connections'
  const [activeTab, setActiveTab] = React.useState<'settings' | 'connections'>('settings')

  // Global Settings States
  const [embeddingModel, setEmbeddingModel] = React.useState(
    'workers-ai:@cf/baai/bge-large-en-v1.5',
  )
  const [chatModel, setChatModel] = React.useState('workers-ai:@cf/meta/llama-3.1-8b-instruct-fast')
  const [summarizationModel, setSummarizationModel] = React.useState(
    'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast',
  )

  // Connection List States
  const [connections, setConnections] = React.useState<Connection[]>([])

  // Connection Form States
  const [connName, setConnName] = React.useState('')
  const [connProvider, setConnProvider] = React.useState('openai')
  const [connApiKey, setConnApiKey] = React.useState('')
  const [connBaseUrl, setConnBaseUrl] = React.useState('')

  // Dynamic grouped models
  const [chatGroupCandidates, setChatGroupCandidates] = React.useState<ProviderModels[]>([])
  const [embeddingGroupCandidates, setEmbeddingGroupCandidates] = React.useState<ProviderModels[]>(
    [],
  )
  const [modelsLoading, setModelsLoading] = React.useState(false)

  // Direct Input toggles
  const [customEmbedding, setCustomEmbedding] = React.useState(false)
  const [customChat, setCustomChat] = React.useState(false)
  const [customSummarization, setCustomSummarization] = React.useState(false)

  const [isLoading, setIsLoading] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)

  // Reindex state
  const [savedEmbeddingModel, setSavedEmbeddingModel] = React.useState('')
  const [needsReindex, setNeedsReindex] = React.useState(false)
  const [isReindexing, setIsReindexing] = React.useState(false)
  const [reindexProgress, setReindexProgress] = React.useState<{
    done: number
    total: number
  } | null>(null)
  const [reindexDone, setReindexDone] = React.useState(false)

  // Fetch initial settings data and then fetch models for all connections
  const fetchData = React.useCallback(async () => {
    setError(null)
    setSuccess(false)
    setIsLoading(true)
    try {
      // 1. Fetch Global Settings
      const settingsRes = await fetch('/api/settings')
      if (!settingsRes.ok) throw new Error(t('errors.loadGlobalSettingsFailed'))
      const settingsData = (await settingsRes.json()) as GlobalSettings
      const currentEmbed =
        settingsData.ai_embedding_model || 'workers-ai:@cf/baai/bge-large-en-v1.5'
      setEmbeddingModel(currentEmbed)
      setSavedEmbeddingModel(currentEmbed)
      setChatModel(settingsData.model_chat || 'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast')
      setSummarizationModel(
        settingsData.model_summarization || 'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast',
      )

      // 2. Fetch Connections
      const connRes = await fetch('/api/connections')
      if (!connRes.ok) throw new Error(t('errors.loadConnectionsFailed'))
      const connData = (await connRes.json()) as Connection[]
      setConnections(connData)

      // 3. Load all models for all connections
      setModelsLoading(true)
      const allConns = [
        { id: 'workers-ai', name: t('notebookSettings.providerGroup') },
        ...connData.map((c) => ({ id: c.id, name: c.name })),
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

      // Auto-toggle direct input if saved value is not in any of the fetched lists
      const hasChat = filteredChats.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.model_chat),
      )
      if (!hasChat && settingsData.model_chat) setCustomChat(true)

      const hasSum = filteredChats.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.model_summarization),
      )
      if (!hasSum && settingsData.model_summarization) setCustomSummarization(true)

      const hasEmbed = filteredEmbeds.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.ai_embedding_model),
      )
      if (!hasEmbed && settingsData.ai_embedding_model) setCustomEmbedding(true)
    } catch (err: any) {
      setError(err.message || t('errors.generic'))
    } finally {
      setIsLoading(false)
      setModelsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (isOpen) {
      void fetchData()
    }
  }, [isOpen, fetchData])

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen && !isSaving && !isLoading) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSaving, isLoading, onClose])

  if (!isOpen) return null

  // Add Connection Handler
  async function handleAddConnection(e: React.FormEvent) {
    e.preventDefault()
    if (!connName.trim()) return

    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: connName.trim(),
          provider: connProvider,
          api_key: connApiKey.trim() || null,
          base_url: connBaseUrl.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('errors.addConnectionFailed'))
      }

      // Re-fetch all data to rebuild model candidates including the new connection
      await fetchData()

      // Clear form
      setConnName('')
      setConnApiKey('')
      setConnBaseUrl('')
    } catch (err: any) {
      setError(err.message)
      setIsSaving(false)
    }
  }

  // Delete Connection Handler
  async function handleDeleteConnection(id: string) {
    if (!window.confirm(t('errors.deleteConnectionConfirm'))) return

    setError(null)
    try {
      const res = await fetch(`/api/connections/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('errors.deleteConnectionFailed'))
      }

      // Re-fetch all to refresh models and connections
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Save Settings Handler
  async function handleSubmitSettings(event: React.FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    setSuccess(false)
    setNeedsReindex(false)
    setReindexDone(false)

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_embedding_model: embeddingModel.trim(),
          model_chat: chatModel.trim(),
          model_summarization: summarizationModel.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('common.saveFailed', { status: res.status }))
      }

      // Detect embedding model change
      if (embeddingModel.trim() !== savedEmbeddingModel) {
        setSavedEmbeddingModel(embeddingModel.trim())
        setNeedsReindex(true)
      } else {
        setSuccess(true)
        setTimeout(() => {
          onClose()
        }, 800)
      }
    } catch (err: any) {
      setError(err.message || t('errors.saveOccurred'))
    } finally {
      setIsSaving(false)
    }
  }

  // Reindex all notebooks handler
  async function handleReindexAll() {
    setIsReindexing(true)
    setError(null)
    setReindexProgress(null)
    try {
      const nbRes = await fetch('/api/notebooks')
      if (!nbRes.ok) throw new Error(t('errors.fetchNotebooksFailed'))
      const nbList = (await nbRes.json()) as Array<{ id: string }>
      const total = nbList.length
      setReindexProgress({ done: 0, total })

      for (let i = 0; i < nbList.length; i++) {
        await fetch(`/api/notebooks/${nbList[i].id}/reindex`, { method: 'POST' })
        setReindexProgress({ done: i + 1, total })
      }

      setReindexDone(true)
      setNeedsReindex(false)
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err: any) {
      setError(err.message || t('errors.reindexFailed'))
    } finally {
      setIsReindexing(false)
    }
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      role='dialog'
      aria-modal='true'
    >
      <div className='w-full max-w-xl overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl shadow-black/80 flex flex-col max-h-[85vh]'>
        {/* Header */}
        <div className='flex items-center justify-between border-b border-base-300 px-6 py-4'>
          <div>
            <h2 className='text-lg font-bold text-base-content'>{t('globalSettings.title')}</h2>
            <p className='text-xs text-base-content/60'>{t('globalSettings.subtitle')}</p>
          </div>
          <button
            type='button'
            onClick={onClose}
            className='btn btn-sm btn-circle btn-ghost text-base-content/70 hover:text-base-content'
            aria-label={t('globalSettings.closeAria')}
            disabled={isSaving || isLoading}
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className='flex border-b border-base-300 bg-base-200/40 px-6'>
          <button
            type='button'
            className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all ${
              activeTab === 'settings'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
            }`}
            onClick={() => setActiveTab('settings')}
          >
            {t('globalSettings.tabModels')}
          </button>
          <button
            type='button'
            className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all ${
              activeTab === 'connections'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
            }`}
            onClick={() => setActiveTab('connections')}
          >
            {t('globalSettings.tabConnections', { count: connections.length })}
          </button>
        </div>

        {/* Content Box */}
        <div className='flex-1 overflow-y-auto px-6 py-4 space-y-4'>
          {error && (
            <div className='alert alert-error text-xs rounded-xl shadow border border-error/20 flex gap-2 py-2'>
              <XCircle
                aria-hidden='true'
                size={16}
                strokeWidth={2}
                className='stroke-current shrink-0 h-4 w-4'
              />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className='alert alert-success text-xs rounded-xl shadow border border-success/20 flex gap-2 py-2'>
              <CircleCheck
                aria-hidden='true'
                size={16}
                strokeWidth={2}
                className='stroke-current shrink-0 h-4 w-4'
              />
              <span>{t('globalSettings.savedToast')}</span>
            </div>
          )}

          {isLoading ? (
            <div className='flex flex-col items-center justify-center py-16 gap-3'>
              <span className='loading loading-spinner loading-md text-primary'></span>
              <p className='text-xs text-base-content/50'>{t('globalSettings.loading')}</p>
            </div>
          ) : activeTab === 'settings' ? (
            /* Model Settings Tab */
            <form onSubmit={(e) => void handleSubmitSettings(e)} className='space-y-5'>
              {/* Model Selectors */}
              <div className='space-y-4'>
                <h3 className='text-sm font-semibold text-base-content/80'>
                  {t('globalSettings.defaultModels')}
                </h3>

                {/* Embedding Model */}
                <div>
                  <div className='flex justify-between items-center mb-1'>
                    <label className='label py-0' htmlFor='settings-embedding'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('notebookSettings.embeddingModel')}
                      </span>
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
                      className='input input-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none focus:border-primary/60'
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      disabled={modelsLoading}
                    />
                  ) : (
                    <select
                      id='settings-embedding'
                      className='select select-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none'
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      disabled={modelsLoading}
                    >
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
                <div>
                  <div className='flex justify-between items-center mb-1'>
                    <label className='label py-0' htmlFor='settings-chat'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('notebookSettings.chatModel')}
                      </span>
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
                      className='input input-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none focus:border-primary/60'
                      value={chatModel}
                      onChange={(e) => setChatModel(e.target.value)}
                      disabled={modelsLoading}
                    />
                  ) : (
                    <select
                      id='settings-chat'
                      className='select select-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none'
                      value={chatModel}
                      onChange={(e) => setChatModel(e.target.value)}
                      disabled={modelsLoading}
                    >
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
                <div>
                  <div className='flex justify-between items-center mb-1'>
                    <label className='label py-0' htmlFor='settings-summarization'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('notebookSettings.summarizationModel')}
                      </span>
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
                      className='input input-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none focus:border-primary/60'
                      value={summarizationModel}
                      onChange={(e) => setSummarizationModel(e.target.value)}
                      disabled={modelsLoading}
                    />
                  ) : (
                    <select
                      id='settings-summarization'
                      className='select select-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none'
                      value={summarizationModel}
                      onChange={(e) => setSummarizationModel(e.target.value)}
                      disabled={modelsLoading}
                    >
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

              {/* Reindex Warning Banner */}
              {needsReindex && (
                <div className='rounded-xl border border-warning/30 bg-warning/10 p-4 space-y-3'>
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
                  {reindexProgress && (
                    <div className='space-y-1'>
                      <div className='flex justify-between text-xs text-base-content/60'>
                        <span>{t('notebookSettings.reindex.running')}</span>
                        <span>
                          {reindexProgress.done} / {reindexProgress.total}
                        </span>
                      </div>
                      <progress
                        className='progress progress-warning w-full'
                        value={reindexProgress.done}
                        max={reindexProgress.total}
                      />
                    </div>
                  )}
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
                      onClick={() => void handleReindexAll()}
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
                <div className='alert alert-success text-xs rounded-xl shadow border border-success/20 flex gap-2 py-2'>
                  <CircleCheck
                    aria-hidden='true'
                    size={16}
                    strokeWidth={2}
                    className='stroke-current shrink-0 h-4 w-4'
                  />
                  <span>{t('notebookSettings.reindex.done')}</span>
                </div>
              )}

              {/* Actions */}
              {!needsReindex && (
                <div className='flex items-center justify-end gap-3 pt-4 border-t border-base-300'>
                  <button
                    type='button'
                    onClick={onClose}
                    className='btn btn-ghost rounded-xl px-5 text-sm font-medium'
                    disabled={isSaving}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type='submit'
                    className='btn btn-primary rounded-xl px-5 text-sm font-medium'
                    disabled={isSaving || modelsLoading}
                  >
                    {isSaving ? t('common.saving') : t('common.saveSettings')}
                  </button>
                </div>
              )}
            </form>
          ) : (
            /* API Connections Tab */
            <div className='space-y-6'>
              {/* Connections List */}
              <div className='space-y-3'>
                <h3 className='text-sm font-semibold text-base-content/85'>
                  {t('globalSettings.configured')}
                </h3>
                {connections.length === 0 ? (
                  <p className='text-xs text-base-content/50 py-4 text-center bg-base-200/30 rounded-xl border border-base-300 border-dashed'>
                    {t('globalSettings.empty')}
                  </p>
                ) : (
                  <div className='grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto pr-1'>
                    {connections.map((c) => (
                      <div
                        key={c.id}
                        className='flex items-center justify-between p-3 bg-base-200/50 border border-base-300 rounded-xl'
                      >
                        <div className='space-y-0.5'>
                          <div className='flex items-center gap-2'>
                            <span className='font-bold text-xs text-base-content'>{c.name}</span>
                            <span className='badge badge-neutral text-[9px] px-1.5 py-0.5 rounded'>
                              {c.provider}
                            </span>
                          </div>
                          {c.base_url && (
                            <p className='text-[10px] text-base-content/50 truncate max-w-[320px]'>
                              {c.base_url}
                            </p>
                          )}
                        </div>
                        <button
                          type='button'
                          onClick={() => void handleDeleteConnection(c.id)}
                          className='btn btn-ghost btn-xs btn-square text-error hover:bg-error/10 rounded-lg'
                          title={t('globalSettings.deleteAria')}
                        >
                          <Trash2
                            aria-hidden='true'
                            size={16}
                            strokeWidth={1.5}
                            className='w-4 h-4'
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Connection Form */}
              <form
                onSubmit={(e) => void handleAddConnection(e)}
                className='border-t border-base-300 pt-4 space-y-3.5'
                autoComplete='off'
                data-form-type='other'
                onKeyDown={(e) => {
                  // Prevent the browser from triggering a credential-save
                  // prompt when the user finishes typing the API key.
                  if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
                    e.preventDefault()
                    void handleAddConnection(e as unknown as React.FormEvent<HTMLFormElement>)
                  }
                }}
              >
                <h3 className='text-sm font-semibold text-base-content/85'>
                  {t('globalSettings.addNew')}
                </h3>

                {/* Decoy inputs that are not visible to users but defeat
                    password-manager heuristics. The browser looks at the
                    first username + password pair it sees in a form; by
                    placing these inert inputs *first*, the saved-credentials
                    popup is satisfied by them and leaves the real fields
                    alone. The decoys have no name, no id, no value, and
                    tabIndex={-1} so they cannot be focused or submitted. */}
                <div aria-hidden='true' className='hidden' inert=''>
                  <input type='text' tabIndex={-1} />
                  <input type='password' tabIndex={-1} />
                </div>

                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <label className='label py-0' htmlFor='conn-name'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('globalSettings.connectionName')}
                      </span>
                    </label>
                    <input
                      id='conn-name'
                      type='text'
                      name='connection-name'
                      placeholder={t('globalSettings.connectionNamePlaceholder')}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='input input-bordered w-full rounded-xl bg-base-200 text-xs focus:outline-none focus:border-primary/60'
                      value={connName}
                      onChange={(e) => setConnName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className='label py-0' htmlFor='conn-provider'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('globalSettings.provider')}
                      </span>
                    </label>
                    <select
                      id='conn-provider'
                      name='connection-provider'
                      autoComplete='off'
                      data-form-type='other'
                      data-lpignore='true'
                      className='select select-bordered w-full rounded-xl bg-base-200 text-xs focus:outline-none'
                      value={connProvider}
                      onChange={(e) => setConnProvider(e.target.value)}
                    >
                      {PROVIDER_OPTIONS.filter((p) => p.value !== 'workers-ai').map((p) => (
                        <option key={p.value} value={p.value}>
                          {t(`globalSettings.providers.${p.label}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                  <div>
                    <label className='label py-0' htmlFor='conn-key'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('globalSettings.apiKey')}
                      </span>
                    </label>
                    <input
                      id='conn-key'
                      type='password'
                      name='connection-api-key'
                      placeholder={t('globalSettings.apiKeyPlaceholder')}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='input input-bordered w-full rounded-xl bg-base-200 text-xs focus:outline-none focus:border-primary/60'
                      value={connApiKey}
                      onChange={(e) => setConnApiKey(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className='label py-0' htmlFor='conn-url'>
                      <span className='label-text font-semibold text-base-content/75 text-xs'>
                        {t('globalSettings.baseUrlOptional')}
                      </span>
                    </label>
                    <input
                      id='conn-url'
                      type='url'
                      name='connection-base-url'
                      placeholder={t('globalSettings.baseUrlPlaceholder')}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='input input-bordered w-full rounded-xl bg-base-200 text-xs focus:outline-none focus:border-primary/60'
                      value={connBaseUrl}
                      onChange={(e) => setConnBaseUrl(e.target.value)}
                    />
                  </div>
                </div>

                <div className='flex justify-end pt-1'>
                  <button
                    type='submit'
                    className='btn btn-primary rounded-xl px-4 text-xs font-semibold'
                    disabled={isSaving}
                  >
                    {isSaving ? t('globalSettings.adding') : t('globalSettings.addConnection')}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
