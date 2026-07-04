import { CircleCheck, SlidersHorizontal, X, XCircle } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { ConnectionsSection } from './ConnectionsSection'
import { useGlobalSettings } from './hooks/useGlobalSettings'
import { SettingsSection } from './SettingsSection'

export type { Connection, GlobalSettings, ProviderModels } from './types'
export { DEFAULT_SYSTEM_PROMPT, PROVIDER_OPTIONS } from './types'

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const { t } = useTranslation('common')
  const {
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
    needsReindex,
    isReindexing,
    reindexProgress,
    reindexDone,
    fetchData,
    handleAddConnection,
    handleDeleteConnection,
    handleSubmitSettings,
    handleReindexAll,
  } = useGlobalSettings(onClose)

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
          <Button
            type='button'
            size='sm'
            shape='circle'
            variant='ghost'
            iconLeft={X}
            iconOnlyAriaLabel={t('globalSettings.closeAria')}
            disabled={isSaving || isLoading}
            className='text-base-content/70 hover:text-base-content'
            onClick={onClose}
          />
        </div>

        {/* Navigation Tabs */}
        <div className='flex border-b border-base-300 bg-base-200/40 px-6'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            iconLeft={SlidersHorizontal}
            className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all rounded-none ${
              activeTab === 'settings'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
            }`}
            onClick={() => setActiveTab('settings')}
          >
            {t('globalSettings.tabModels')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            iconLeft={SlidersHorizontal}
            className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all rounded-none ${
              activeTab === 'connections'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
            }`}
            onClick={() => setActiveTab('connections')}
          >
            {t('globalSettings.tabConnections', { count: connections.length })}
          </Button>
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
            <SettingsSection
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
              modelsLoading={modelsLoading}
              customEmbedding={customEmbedding}
              setCustomEmbedding={setCustomEmbedding}
              customChat={customChat}
              setCustomChat={setCustomChat}
              customSummarization={customSummarization}
              setCustomSummarization={setCustomSummarization}
              customOcr={customOcr}
              setCustomOcr={setCustomOcr}
              isSaving={isSaving}
              needsReindex={needsReindex}
              isReindexing={isReindexing}
              reindexProgress={reindexProgress}
              reindexDone={reindexDone}
              onClose={onClose}
              onReindexAll={handleReindexAll}
              onSubmit={handleSubmitSettings}
            />
          ) : (
            <ConnectionsSection
              connections={connections}
              connName={connName}
              setConnName={setConnName}
              connProvider={connProvider}
              setConnProvider={setConnProvider}
              connApiKey={connApiKey}
              setConnApiKey={setConnApiKey}
              connBaseUrl={connBaseUrl}
              setConnBaseUrl={setConnBaseUrl}
              isSaving={isSaving}
              onAddConnection={handleAddConnection}
              onDeleteConnection={handleDeleteConnection}
            />
          )}
        </div>
      </div>
    </div>
  )
}
