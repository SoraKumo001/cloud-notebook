import { useTranslation } from 'react-i18next'
import { SearchableSelect } from '../ui/SearchableSelect'
import type { ProviderModels } from './types'

interface AiSectionProps {
  embeddingModel: string
  setEmbeddingModel: (v: string) => void
  chatModel: string
  setChatModel: (v: string) => void
  summarizationModel: string
  setSummarizationModel: (v: string) => void
  ocrModel: string
  setOcrModel: (v: string) => void
  systemPrompt: string
  setSystemPrompt: (v: string) => void
  chatGroupCandidates: ProviderModels[]
  embeddingGroupCandidates: ProviderModels[]
  ocrGroupCandidates: ProviderModels[]
  customEmbedding: boolean
  setCustomEmbedding: (v: boolean) => void
  customChat: boolean
  setCustomChat: (v: boolean) => void
  customSummarization: boolean
  setCustomSummarization: (v: boolean) => void
  customOcr: boolean
  setCustomOcr: (v: boolean) => void
  isSaving: boolean
  modelsLoading: boolean
}

function sectionTitle(title: string) {
  return (
    <h3 className='text-sm font-semibold text-base-content/90 uppercase tracking-wider'>{title}</h3>
  )
}

export function AiSection({
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
}: AiSectionProps) {
  const { t } = useTranslation('common')

  return (
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
            <SearchableSelect
              id='settings-embedding'
              value={embeddingModel}
              onChange={setEmbeddingModel}
              groups={embeddingGroupCandidates}
              disabled={isSaving || modelsLoading}
              inheritLabel={t('notebookSettings.useGlobal')}
            />
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
            <SearchableSelect
              id='settings-chat'
              value={chatModel}
              onChange={setChatModel}
              groups={chatGroupCandidates}
              disabled={isSaving || modelsLoading}
              inheritLabel={t('notebookSettings.useGlobal')}
            />
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
            <SearchableSelect
              id='settings-summarization'
              value={summarizationModel}
              onChange={setSummarizationModel}
              groups={chatGroupCandidates}
              disabled={isSaving || modelsLoading}
              inheritLabel={t('notebookSettings.useGlobal')}
            />
          )}
        </div>

        {/* OCR Model */}
        <div className='space-y-2'>
          <div className='flex justify-between items-center mb-1'>
            <label
              htmlFor='settings-ocr'
              className='block text-sm font-medium text-base-content/70'
            >
              OCR Model
            </label>
            <button
              type='button'
              className='text-[10px] text-primary hover:underline font-semibold'
              onClick={() => setCustomOcr(!customOcr)}
            >
              {customOcr ? t('notebookSettings.selectFromList') : t('notebookSettings.directInput')}
            </button>
          </div>
          {customOcr || chatGroupCandidates.length === 0 ? (
            <input
              id='settings-ocr'
              type='text'
              value={ocrModel}
              onChange={(e) => setOcrModel(e.target.value)}
              disabled={isSaving || modelsLoading}
              className='w-full input input-bordered rounded-xl'
            />
          ) : (
            <SearchableSelect
              id='settings-ocr'
              value={ocrModel}
              onChange={setOcrModel}
              groups={ocrGroupCandidates}
              disabled={isSaving || modelsLoading}
              inheritLabel={t('notebookSettings.useGlobal')}
            />
          )}
        </div>

        {/* System Prompt Override */}
        <div className='space-y-2'>
          <label
            htmlFor='settings-system-prompt'
            className='block text-sm font-medium text-base-content/70'
          >
            {t('notebookSettings.systemPrompt', { defaultValue: 'System Prompt' })}
          </label>
          <textarea
            id='settings-system-prompt'
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={isSaving}
            placeholder={t('notebookSettings.systemPromptPlaceholder', {
              defaultValue: 'Leave blank to inherit the global default system prompt...',
            })}
            rows={4}
            className='w-full textarea textarea-bordered font-mono text-sm resize-y rounded-xl'
          />
          <p className='text-[10px] text-base-content/50 leading-relaxed'>
            You can specify custom system instructions for this notebook. Leave empty to use the
            global settings configuration.
          </p>
        </div>
      </div>
    </div>
  )
}
