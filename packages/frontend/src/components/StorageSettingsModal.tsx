// packages/frontend/src/components/StorageSettingsModal.tsx
//
// Admin-only modal for managing the deployment's object storage backend.
// Two providers are supported:
//   - r2-binding       : uses the Cloudflare R2 native binding (zero
//                        credentials; requires an R2 bucket bound in
//                        wrangler.jsonc).
//   - s3-compatible    : any S3-compatible service (AWS S3, MinIO,
//                        Backblaze B2, R2 via S3 API). Credentials are
//                        stored encrypted in the backend's global_settings
//                        table.
//
// The PUT endpoint validates credentials with a real put+delete probe
// before saving. S3-compatible secrets are write-only — the GET endpoint
// only returns `has_access_key` / `has_secret_key` booleans.

import { AlertTriangle, Cloud, Database, Save, X, XCircle } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/Button'

interface StorageSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isAdmin: boolean
}

interface StorageConfig {
  provider: 'r2-binding' | 's3-compatible'
  configured: boolean
  bucket?: string
  region?: string
  endpoint?: string
  force_path_style?: boolean
  has_access_key?: boolean
  has_secret_key?: boolean
  updated_by?: string | null
  updated_at?: string | null
}

export function StorageSettingsModal({ isOpen, onClose, isAdmin }: StorageSettingsModalProps) {
  const { t } = useTranslation('common')
  const [config, setConfig] = React.useState<StorageConfig | null>(null)
  const [provider, setProvider] = React.useState<'r2-binding' | 's3-compatible'>('r2-binding')
  const [bucket, setBucket] = React.useState('')
  const [region, setRegion] = React.useState('auto')
  const [endpoint, setEndpoint] = React.useState('')
  const [forcePathStyle, setForcePathStyle] = React.useState(true)
  const [accessKeyId, setAccessKeyId] = React.useState('')
  const [secretAccessKey, setSecretAccessKey] = React.useState('')

  const [isLoading, setIsLoading] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/storage')
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? t('errors.loadStorageFailed', { status: res.status }))
      }
      const data = (await res.json()) as StorageConfig
      setConfig(data)
      setProvider(data.provider)
      if (data.bucket) setBucket(data.bucket)
      if (data.region) setRegion(data.region)
      if (data.endpoint) setEndpoint(data.endpoint)
      if (typeof data.force_path_style === 'boolean') setForcePathStyle(data.force_path_style)
      // Secrets are never returned — leave fields empty. The user
      // only fills them in if they want to change them.
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.loadStorageFailedGeneric'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (isOpen) {
      load()
    }
  }, [isOpen, load])

  if (!isOpen) return null

  if (!isAdmin) {
    return (
      <ModalShell onClose={onClose} title={t('storage.title')}>
        <div className='rounded-md bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2'>
          <XCircle className='w-4 h-4 mt-0.5 flex-shrink-0' />
          <span>{t('storage.adminRequired')}</span>
        </div>
      </ModalShell>
    )
  }

  const handleSave = async () => {
    setError(null)
    setIsSaving(true)
    try {
      const body: Record<string, unknown> = { provider }
      if (provider === 's3-compatible') {
        if (!bucket.trim()) throw new Error(t('storage.validation.bucketRequired'))
        if (!endpoint.trim()) throw new Error(t('storage.validation.endpointRequired'))
        // Secrets are write-only: if empty, the backend keeps the
        // stored values. If the user provides new values, they
        // replace the existing ones. Our backend currently requires
        // both fields on every PUT, so warn the user if they're
        // missing on an already-configured row.
        if (config?.configured && config.provider === 's3-compatible') {
          if (!accessKeyId && !config.has_access_key) {
            throw new Error(t('storage.validation.accessKeyRequiredNew'))
          }
          if (!secretAccessKey && !config.has_secret_key) {
            throw new Error(t('storage.validation.secretKeyRequiredNew'))
          }
        } else {
          if (!accessKeyId) throw new Error(t('storage.validation.accessKeyRequired'))
          if (!secretAccessKey) throw new Error(t('storage.validation.secretKeyRequired'))
        }
        body.bucket = bucket.trim()
        body.region = region.trim() || 'auto'
        body.endpoint = endpoint.trim()
        body.force_path_style = forcePathStyle
        body.access_key_id = accessKeyId
        body.secret_access_key = secretAccessKey
      }
      const res = await fetch('/api/admin/storage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? t('errors.saveStorageFailed', { status: res.status }))
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveStorageFailedGeneric'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={t('storage.title')}>
      {isLoading ? (
        <div className='text-sm text-gray-500'>{t('common.loading')}</div>
      ) : (
        <>
          {config && (
            <div className='mb-4 text-xs text-gray-500'>
              {config.configured
                ? t('storage.lastUpdated', {
                    user: config.updated_by ?? '—',
                    time: config.updated_at ?? '—',
                  })
                : t('storage.notConfigured')}
            </div>
          )}

          {error && (
            <div className='mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2'>
              <AlertTriangle className='w-4 h-4 mt-0.5 flex-shrink-0' />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!isSaving) void handleSave()
            }}
            autoComplete='off'
            data-form-type='other'
            className='space-y-4'
          >
            <fieldset>
              <legend className='block text-sm font-medium text-gray-700 mb-1'>
                {t('storage.providerLegend')}
              </legend>
              <div className='grid grid-cols-2 gap-2'>
                <ProviderButton
                  icon={<Database className='w-4 h-4' />}
                  label={t('storage.r2Native')}
                  description={t('storage.r2Body')}
                  active={provider === 'r2-binding'}
                  onClick={() => setProvider('r2-binding')}
                />
                <ProviderButton
                  icon={<Cloud className='w-4 h-4' />}
                  label={t('storage.s3Compatible')}
                  description={t('storage.s3Body')}
                  active={provider === 's3-compatible'}
                  onClick={() => setProvider('s3-compatible')}
                />
              </div>
            </fieldset>

            {provider === 'r2-binding' && (
              <div className='rounded-md bg-blue-50 p-3 text-sm text-blue-900'>
                {t('storage.r2Details')}
              </div>
            )}

            {provider === 's3-compatible' && (
              <div className='space-y-3'>
                <Field label={t('storage.endpoint')} required>
                  <input
                    type='url'
                    name='storage-endpoint'
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder={t('storage.endpointPlaceholder')}
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    spellCheck={false}
                    data-form-type='other'
                    data-lpignore='true'
                    className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                  />
                </Field>
                <div className='grid grid-cols-2 gap-3'>
                  <Field label={t('storage.bucket')} required>
                    <input
                      type='text'
                      name='storage-bucket'
                      value={bucket}
                      onChange={(e) => setBucket(e.target.value)}
                      placeholder={t('storage.bucketPlaceholder')}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                    />
                  </Field>
                  <Field label={t('storage.region')}>
                    <input
                      type='text'
                      name='storage-region'
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder={t('storage.regionPlaceholder')}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                    />
                  </Field>
                </div>
                <label className='flex items-center gap-2 text-sm text-gray-700'>
                  <input
                    type='checkbox'
                    checked={forcePathStyle}
                    onChange={(e) => setForcePathStyle(e.target.checked)}
                  />
                  <span>{t('storage.pathStyle')}</span>
                </label>

                <div className='border-t border-gray-200 pt-3 space-y-3'>
                  <div className='text-xs text-gray-500'>
                    {t('storage.credentialsNote')}{' '}
                    {config?.has_access_key || config?.has_secret_key
                      ? t('storage.leaveBlankHint')
                      : null}
                  </div>
                  <Field label={t('storage.accessKey')} required={!config?.has_access_key}>
                    <input
                      type='text'
                      name='storage-access-key-id'
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder={
                        config?.has_access_key
                          ? t('storage.unchangedHint')
                          : t('storage.accessKeyPlaceholder')
                      }
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                    />
                  </Field>
                  <Field label={t('storage.secretKey')} required={!config?.has_secret_key}>
                    <input
                      // Chrome's built-in password manager ONLY targets
                      // <input type="password"> elements. By using type="text"
                      // we completely remove this field from the password
                      // manager's scope. We preserve the visual masking via
                      // -webkit-text-security: disc (Chrome/Safari/Edge).
                      // Firefox shows plain text, which is acceptable for an
                      // admin-only modal.
                      //
                      // Defenses layered on top of the type change:
                      //  - readOnly + onFocus  : Chrome skips readonly inputs
                      //  - autocomplete="new-password" : belt-and-suspenders
                      //    hint that this is NOT a credential to autofill
                      type='text'
                      name='storage-secret-access-key'
                      value={secretAccessKey}
                      onChange={(e) => setSecretAccessKey(e.target.value)}
                      placeholder={
                        config?.has_secret_key
                          ? t('storage.unchangedHint')
                          : t('storage.secretKeyPlaceholder')
                      }
                      autoComplete='new-password'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      readOnly
                      onFocus={(e) => {
                        e.currentTarget.removeAttribute('readonly')
                      }}
                      style={{ WebkitTextSecurity: 'disc' }}
                      className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                    />
                  </Field>
                </div>

                <div className='rounded-md bg-amber-50 p-3 text-xs text-amber-900'>
                  {t('storage.corsNote')}
                </div>
              </div>
            )}

            <div className='mt-6 flex justify-end gap-2'>
              <Button type='button' variant='ghost' iconLeft={X} onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type='submit' variant='primary' iconLeft={Save} loading={isSaving}>
                {isSaving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </>
      )}
    </ModalShell>
  )
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'>
      {/* The backdrop is a real <button> so the click-to-close interaction
          has correct a11y semantics (and avoids nested-button issues since
          the modal content lives in a sibling <div>, not inside it). */}
      <button
        type='button'
        aria-label='Close dialog'
        tabIndex={-1}
        className='absolute inset-0 w-full h-full cursor-default appearance-none border-0 bg-transparent p-0'
        onClick={onClose}
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl'
      >
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-semibold text-gray-900'>{title}</h2>
          <Button
            type='button'
            size='sm'
            shape='circle'
            variant='ghost'
            iconLeft={X}
            iconOnlyAriaLabel='Close'
            onClick={onClose}
          />
        </div>
        {children}
      </div>
    </div>
  )
}

function ProviderButton({
  icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${
        active ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-white'
      }`}
    >
      <div className='flex items-center gap-2 text-sm font-medium text-gray-900'>
        {icon}
        {label}
      </div>
      <div className='text-xs text-gray-500 mt-1'>{description}</div>
    </button>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactElement<{ id?: string }>
}) {
  // The label is a wrapper around the control so the association is implicit;
  // we still forward an auto-generated id to the child for proper a11y.
  const childId = children.props.id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <label className='block' htmlFor={childId}>
      <span className='block text-xs font-medium text-gray-700 mb-1'>
        {label}
        {required && <span className='text-red-500 ml-1'>*</span>}
      </span>
      {React.cloneElement(children, { id: childId })}
    </label>
  )
}
