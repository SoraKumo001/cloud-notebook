import { Plus, Trash2 } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import type { Connection } from './types'
import { PROVIDER_OPTIONS } from './types'

interface ConnectionsSectionProps {
  connections: Connection[]
  connName: string
  setConnName: (v: string) => void
  connProvider: string
  setConnProvider: (v: string) => void
  connApiKey: string
  setConnApiKey: (v: string) => void
  connBaseUrl: string
  setConnBaseUrl: (v: string) => void
  isSaving: boolean
  onAddConnection: (e: React.FormEvent) => void
  onDeleteConnection: (id: string) => void
}

export function ConnectionsSection({
  connections,
  connName,
  setConnName,
  connProvider,
  setConnProvider,
  connApiKey,
  setConnApiKey,
  connBaseUrl,
  setConnBaseUrl,
  isSaving,
  onAddConnection,
  onDeleteConnection,
}: ConnectionsSectionProps) {
  const { t } = useTranslation('common')

  return (
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
                  onClick={() => onDeleteConnection(c.id)}
                  className='btn btn-ghost btn-xs btn-square text-error hover:bg-error/10 rounded-lg'
                  title={t('globalSettings.deleteAria')}
                >
                  <Trash2 aria-hidden='true' size={16} strokeWidth={1.5} className='w-4 h-4' />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Connection Form */}
      <form
        onSubmit={onAddConnection}
        className='border-t border-base-300 pt-4 space-y-3.5'
        autoComplete='off'
        data-form-type='other'
      >
        <h3 className='text-sm font-semibold text-base-content/85'>{t('globalSettings.addNew')}</h3>

        {/* Decoy inputs that are not visible to users but defeat
            password-manager heuristics. The browser looks at the
            first username + password pair it sees in a form; by
            placing these inert inputs *first*, the saved-credentials
            popup is satisfied by them and leaves the real fields
            alone. The decoys have no name, no id, no value, and
            tabIndex={-1} so they cannot be focused or submitted. */}
        <div
          aria-hidden='true'
          style={{
            position: 'absolute',
            top: -1000,
            left: -1000,
            width: 1,
            height: 1,
            overflow: 'hidden',
            opacity: 0,
          }}
        >
          <input type='text' tabIndex={-1} autoComplete='off' />
          <input type='password' tabIndex={-1} autoComplete='new-password' />
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
              autoComplete='new-password'
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
          <Button
            type='submit'
            variant='primary'
            iconLeft={Plus}
            loading={isSaving}
            className='rounded-xl px-4 text-xs font-semibold'
          >
            {isSaving ? t('globalSettings.adding') : t('globalSettings.addConnection')}
          </Button>
        </div>
      </form>
    </div>
  )
}
