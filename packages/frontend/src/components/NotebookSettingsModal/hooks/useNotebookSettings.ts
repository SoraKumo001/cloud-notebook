import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { NotebookSettingsNotebook, ProviderModels } from '../types'

export function useNotebookSettings(
  notebookId: string,
  notebook: NotebookSettingsNotebook,
  onClose: () => void,
  onSaved?: (notebook: NotebookSettingsNotebook) => void,
) {
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
  const [ocrModel, setOcrModel] = React.useState(notebook.model_ocr ?? 'inherit')
  const [systemPrompt, setSystemPrompt] = React.useState(notebook.system_prompt ?? '')

  const [chatGroupCandidates, setChatGroupCandidates] = React.useState<ProviderModels[]>([])
  const [embeddingGroupCandidates, setEmbeddingGroupCandidates] = React.useState<ProviderModels[]>(
    [],
  )
  const [ocrGroupCandidates, setOcrGroupCandidates] = React.useState<ProviderModels[]>([])

  // Direct Input toggles
  const [customEmbedding, setCustomEmbedding] = React.useState(false)
  const [customChat, setCustomChat] = React.useState(false)
  const [customSummarization, setCustomSummarization] = React.useState(false)
  const [customOcr, setCustomOcr] = React.useState(false)

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

      const currentOcr = notebook.model_ocr ?? 'inherit'
      if (currentOcr !== 'inherit' && currentOcr !== '') {
        const hasOcr = filteredOcrs.some((g) =>
          g.models.some((m) => `${g.connectionId}:${m}` === currentOcr),
        )
        if (!hasOcr) setCustomOcr(true)
      }

      const currentEmbed = notebook.ai_embedding_model ?? 'inherit'
      if (currentEmbed !== 'inherit' && currentEmbed !== '') {
        const hasEmbed = filteredEmbeds.some((g) =>
          g.models.some((m) => `${g.connectionId}:${m}` === currentEmbed),
        )
        if (!hasEmbed) setCustomEmbedding(true)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelsLoading(false)
    }
  }, [notebook, t])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const isTitleEmpty = title.trim() === ''
    if (isTitleEmpty) return

    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      ai_embedding_model: embeddingModel === 'inherit' ? null : embeddingModel.trim() || null,
      model_chat: chatModel === 'inherit' ? null : chatModel.trim() || null,
      model_summarization:
        summarizationModel === 'inherit' ? null : summarizationModel.trim() || null,
      model_ocr: ocrModel === 'inherit' ? null : ocrModel.trim() || null,
      system_prompt: systemPrompt.trim() || null,
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

  return {
    // State
    title,
    setTitle,
    description,
    setDescription,
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
    chatGroupCandidates,
    embeddingGroupCandidates,
    ocrGroupCandidates,
    customEmbedding,
    setCustomEmbedding,
    customChat,
    setCustomChat,
    customSummarization,
    setCustomSummarization,
    customOcr,
    setCustomOcr,
    isSaving,
    modelsLoading,
    error,
    setError,
    savedEmbeddingModel,
    setSavedEmbeddingModel,
    needsReindex,
    setNeedsReindex,
    isReindexing,
    reindexDone,
    setReindexDone,
    // Handlers
    fetchData,
    handleSubmit,
    handleReindex,
  }
}
