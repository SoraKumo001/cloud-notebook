import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { Connection, GlobalSettings, ProviderModels } from '../types'
import { DEFAULT_SYSTEM_PROMPT } from '../types'

export function useGlobalSettings(onClose: () => void) {
  const { t } = useTranslation('common')

  // Tabs: 'settings' | 'connections'
  const [activeTab, setActiveTab] = React.useState<'settings' | 'connections'>('settings')

  // Global Settings States
  const [embeddingModel, setEmbeddingModel] = React.useState('workers-ai:@cf/baai/bge-m3')
  const [chatModel, setChatModel] = React.useState('workers-ai:@cf/meta/llama-3.1-8b-instruct-fast')
  const [summarizationModel, setSummarizationModel] = React.useState(
    'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast',
  )
  const [ocrModel, setOcrModel] = React.useState('@cf/meta/llama-3.2-11b-vision-instruct')
  const [systemPrompt, setSystemPrompt] = React.useState('')

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
  const [ocrGroupCandidates, setOcrGroupCandidates] = React.useState<ProviderModels[]>([])
  const [modelsLoading, setModelsLoading] = React.useState(false)

  // Direct Input toggles
  const [customEmbedding, setCustomEmbedding] = React.useState(false)
  const [customChat, setCustomChat] = React.useState(false)
  const [customSummarization, setCustomSummarization] = React.useState(false)
  const [customOcr, setCustomOcr] = React.useState(false)

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
      const currentEmbed = settingsData.ai_embedding_model || 'workers-ai:@cf/baai/bge-m3'
      setEmbeddingModel(currentEmbed)
      setSavedEmbeddingModel(currentEmbed)
      setChatModel(settingsData.model_chat || 'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast')
      setSummarizationModel(
        settingsData.model_summarization || 'workers-ai:@cf/meta/llama-3.1-8b-instruct-fast',
      )
      setOcrModel(settingsData.model_ocr || 'workers-ai:@cf/meta/llama-3.2-11b-vision-instruct')
      setSystemPrompt(settingsData.system_prompt || DEFAULT_SYSTEM_PROMPT)

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

      const ocrPromises = allConns.map((c) =>
        fetch(`/api/connections/${c.id}/models?type=ocr`)
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
      const ocrResults = await Promise.all(ocrPromises)

      const filteredChats = chatResults.filter((r) => r.models.length > 0)
      const filteredEmbeds = embedResults.filter((r) => r.models.length > 0)
      const filteredOcrs = ocrResults.filter((r) => r.models.length > 0)

      setChatGroupCandidates(filteredChats)
      setEmbeddingGroupCandidates(filteredEmbeds)
      setOcrGroupCandidates(filteredOcrs)

      // Auto-toggle direct input if saved value is not in any of the fetched lists
      const hasChat = filteredChats.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.model_chat),
      )
      if (!hasChat && settingsData.model_chat) setCustomChat(true)

      const hasSum = filteredChats.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.model_summarization),
      )
      if (!hasSum && settingsData.model_summarization) setCustomSummarization(true)

      const hasOcr = filteredOcrs.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.model_ocr),
      )
      if (!hasOcr && settingsData.model_ocr) setCustomOcr(true)

      const hasEmbed = filteredEmbeds.some((g) =>
        g.models.some((m) => `${g.connectionId}:${m}` === settingsData.ai_embedding_model),
      )
      if (!hasEmbed && settingsData.ai_embedding_model) setCustomEmbedding(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
      setModelsLoading(false)
    }
  }, [t])

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
      setIsSaving(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
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
          model_ocr: ocrModel.trim(),
          system_prompt: systemPrompt.trim() || null,
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsReindexing(false)
    }
  }

  return {
    // State
    activeTab,
    setActiveTab,
    embeddingModel,
    setEmbeddingModel,
    chatModel,
    setChatModel,
    summarizationModel,
    setSummarizationModel,
    ocrModel,
    setOcrModel,
    systemPrompt,
    setSystemPrompt,
    connections,
    connName,
    setConnName,
    connProvider,
    setConnProvider,
    connApiKey,
    setConnApiKey,
    connBaseUrl,
    setConnBaseUrl,
    chatGroupCandidates,
    embeddingGroupCandidates,
    ocrGroupCandidates,
    modelsLoading,
    customEmbedding,
    setCustomEmbedding,
    customChat,
    setCustomChat,
    customSummarization,
    setCustomSummarization,
    customOcr,
    setCustomOcr,
    isLoading,
    isSaving,
    error,
    success,
    savedEmbeddingModel,
    needsReindex,
    isReindexing,
    reindexProgress,
    reindexDone,
    // Handlers
    fetchData,
    handleAddConnection,
    handleDeleteConnection,
    handleSubmitSettings,
    handleReindexAll,
  }
}
