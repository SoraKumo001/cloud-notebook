import { AlertTriangle, CircleCheck, RefreshCw, Save, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { McpTokenPanel } from '../McpTokenPanel'
import { Button } from '../ui/Button'
import { AiSection } from './AiSection'
import { BasicSection } from './BasicSection'
import { useNotebookSettings } from './hooks/useNotebookSettings'

export type { NotebookSettingsNotebook, ProviderModels } from './types'

interface NotebookSettingsModalProps {
  notebookId: string
  notebook: NotebookSettingsNotebook
  isOpen: boolean
  onClose: () => void
  onSaved?: (notebook: NotebookSettingsNotebook) => void
}

export function NotebookSettingsModal({
  notebookId,
  notebook,
  isOpen,
  onClose,
  onSaved,
}: NotebookSettingsModalProps) {
  const { t } = useTranslation('common')
  const {
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
    needsReindex,
    setNeedsReindex,
    isReindexing,
    reindexDone,
    setReindexDone,
    setSavedEmbeddingModel,
    fetchData,
    handleSubmit,
    handleReindex,
  } = useNotebookSettings(notebookId, notebook, onClose, onSaved)

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
      setOcrModel(notebook.model_ocr ?? 'inherit')
      setSystemPrompt(notebook.system_prompt ?? '')
      setNeedsReindex(false)
      setReindexDone(false)
      setError(null)
    }
  }, [
    isOpen,
    notebook,
    setTitle,
    setDescription,
    setEmbeddingModel,
    setSavedEmbeddingModel,
    setChatModel,
    setSummarizationModel,
    setOcrModel,
    setSystemPrompt,
    setNeedsReindex,
    setReindexDone,
    setError,
  ])

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
          <Button
            type='button'
            size='sm'
            shape='circle'
            variant='ghost'
            iconLeft={X}
            iconOnlyAriaLabel={t('common.close')}
            disabled={isSaving}
            onClick={onClose}
          />
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className='p-6 space-y-6'>
          {error && <div className='alert alert-error text-xs'>{error}</div>}

          {/* Basic info */}
          <BasicSection
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            isSaving={isSaving}
          />

          {/* AI settings */}
          <AiSection
            embeddingModel={embeddingModel}
            setEmbeddingModel={setEmbeddingModel}
            chatModel={chatModel}
            setChatModel={setChatModel}
            summarizationModel={summarizationModel}
            setSummarizationModel={setSummarizationModel}
            ocrModel={ocrModel}
            setOcrModel={setOcrModel}
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            chatGroupCandidates={chatGroupCandidates}
            embeddingGroupCandidates={embeddingGroupCandidates}
            ocrGroupCandidates={ocrGroupCandidates}
            customEmbedding={customEmbedding}
            setCustomEmbedding={setCustomEmbedding}
            customChat={customChat}
            setCustomChat={setCustomChat}
            customSummarization={customSummarization}
            setCustomSummarization={setCustomSummarization}
            customOcr={customOcr}
            setCustomOcr={setCustomOcr}
            isSaving={isSaving}
            modelsLoading={modelsLoading}
          />

          {/* MCP integration */}
          <div className='border-t border-base-300 pt-6 space-y-4'>
            <h3 className='text-sm font-semibold text-base-content/90 uppercase tracking-wider'>
              {t('notebookSettings.sectionMcp')}
            </h3>
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
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  iconLeft={X}
                  disabled={isReindexing}
                  onClick={onClose}
                  className='rounded-xl text-xs'
                >
                  {t('notebookSettings.reindex.later')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='warning'
                  iconLeft={RefreshCw}
                  loading={isReindexing}
                  onClick={() => void handleReindex()}
                  className='rounded-xl text-xs font-semibold'
                >
                  {t('notebookSettings.reindex.run')}
                </Button>
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
              <Button
                type='button'
                variant='neutral'
                iconLeft={X}
                disabled={isSaving}
                onClick={onClose}
                className='rounded-xl px-5 text-sm font-medium'
              >
                {t('common.cancel')}
              </Button>
              <Button
                type='submit'
                variant='primary'
                iconLeft={Save}
                loading={isSaving}
                disabled={isTitleEmpty || modelsLoading}
                className='rounded-xl px-5 text-sm font-medium'
              >
                {isSaving ? t('common.saving') : t('common.saveChanges')}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
