import { AlertTriangle, CircleCheck, RefreshCw, Save, X } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { SearchableSelect } from '../ui/SearchableSelect'
import type { ProviderModels } from './types'

interface SettingsSectionProps {
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
  modelsLoading: boolean
  customEmbedding: boolean
  setCustomEmbedding: (v: boolean) => void
  customChat: boolean
  setCustomChat: (v: boolean) => void
  customSummarization: boolean
  setCustomSummarization: (v: boolean) => void
  customOcr: boolean
  setCustomOcr: (v: boolean) => void
  isSaving: boolean
  needsReindex: boolean
  isReindexing: boolean
  reindexProgress: { done: number; total: number } | null
  reindexDone: boolean
  onClose: () => void
  onReindexAll: () => void
  onSubmit: (e: React.FormEvent) => void
}

export function SettingsSection({
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
  modelsLoading,
  customEmbedding,
  setCustomEmbedding,
  customChat,
  setCustomChat,
  customSummarization,
  setCustomSummarization,
  customOcr,
  setCustomOcr,
  isSaving,
  needsReindex,
  isReindexing,
  reindexProgress,
  reindexDone,
  onClose,
  onReindexAll,
  onSubmit,
}: SettingsSectionProps) {
  const { t } = useTranslation('common')

  return (
    <form onSubmit={onSubmit} className='space-y-5'>
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
            <SearchableSelect
              id='settings-embedding'
              value={embeddingModel}
              onChange={setEmbeddingModel}
              groups={embeddingGroupCandidates}
              disabled={modelsLoading}
            />
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
            <SearchableSelect
              id='settings-chat'
              value={chatModel}
              onChange={setChatModel}
              groups={chatGroupCandidates}
              disabled={modelsLoading}
            />
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
            <SearchableSelect
              id='settings-summarization'
              value={summarizationModel}
              onChange={setSummarizationModel}
              groups={chatGroupCandidates}
              disabled={modelsLoading}
            />
          )}
        </div>

        {/* OCR Model */}
        <div>
          <div className='flex justify-between items-center mb-1'>
            <label className='label py-0' htmlFor='settings-ocr'>
              <span className='label-text font-semibold text-base-content/75 text-xs'>
                OCR Model
              </span>
            </label>
            <button
              type='button'
              className='text-[10px] text-primary hover:underline font-semibold'
              onClick={() => setCustomOcr(!customOcr)}
            >
              {customOcr ? t('notebookSettings.selectFromList') : t('notebookSettings.directInput')}
            </button>
          </div>
          {customOcr || ocrGroupCandidates.length === 0 ? (
            <input
              id='settings-ocr'
              type='text'
              className='input input-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none focus:border-primary/60'
              value={ocrModel}
              onChange={(e) => setOcrModel(e.target.value)}
              disabled={modelsLoading}
            />
          ) : (
            <SearchableSelect
              id='settings-ocr'
              value={ocrModel}
              onChange={setOcrModel}
              groups={ocrGroupCandidates}
              disabled={modelsLoading}
            />
          )}
        </div>

        {/* Default System Prompt */}
        <div>
          <label className='label py-0' htmlFor='settings-system-prompt'>
            <span className='label-text font-semibold text-base-content/75 text-xs'>
              {t('globalSettings.defaultSystemPrompt', {
                defaultValue: 'Default System Prompt',
              })}
            </span>
          </label>
          <textarea
            id='settings-system-prompt'
            className='textarea textarea-bordered w-full rounded-xl bg-base-200 text-sm focus:outline-none focus:border-primary/60 min-h-[100px] font-mono mt-1'
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder='Enter custom instructions for the AI (RAG and general chat)...'
            disabled={modelsLoading}
          />
          <p className='text-[10px] text-base-content/50 mt-1 leading-relaxed'>
            This system prompt will be used as the default behavior for all notebooks unless
            overridden individually.
          </p>
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
              onClick={onReindexAll}
              className='rounded-xl text-xs font-semibold'
            >
              {t('notebookSettings.reindex.run')}
            </Button>
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
          <Button
            type='button'
            variant='ghost'
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
            disabled={modelsLoading}
            className='rounded-xl px-5 text-sm font-medium'
          >
            {isSaving ? t('common.saving') : t('common.saveSettings')}
          </Button>
        </div>
      )}
    </form>
  )
}
