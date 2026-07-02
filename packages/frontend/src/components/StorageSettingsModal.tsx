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

import { AlertTriangle, Cloud, Database, X, XCircle } from 'lucide-react'
import * as React from 'react'

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
        throw new Error(body.error ?? `Failed to load (${res.status})`)
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
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (isOpen) {
      load()
    }
  }, [isOpen, load])

  if (!isOpen) return null

  if (!isAdmin) {
    return (
      <ModalShell onClose={onClose} title='Storage Settings'>
        <div className='rounded-md bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2'>
          <XCircle className='w-4 h-4 mt-0.5 flex-shrink-0' />
          <span>Admin privileges required.</span>
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
        if (!bucket.trim()) throw new Error('Bucket is required')
        if (!endpoint.trim()) throw new Error('Endpoint is required')
        // Secrets are write-only: if empty, the backend keeps the
        // stored values. If the user provides new values, they
        // replace the existing ones. Our backend currently requires
        // both fields on every PUT, so warn the user if they're
        // missing on an already-configured row.
        if (config?.configured && config.provider === 's3-compatible') {
          if (!accessKeyId && !config.has_access_key) {
            throw new Error('Access key ID is required (no existing value to keep)')
          }
          if (!secretAccessKey && !config.has_secret_key) {
            throw new Error('Secret access key is required (no existing value to keep)')
          }
        } else {
          if (!accessKeyId) throw new Error('Access key ID is required')
          if (!secretAccessKey) throw new Error('Secret access key is required')
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
        throw new Error(errBody.error ?? `Save failed (${res.status})`)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title='Storage Settings'>
      {isLoading ? (
        <div className='text-sm text-gray-500'>Loading…</div>
      ) : (
        <>
          {config && (
            <div className='mb-4 text-xs text-gray-500'>
              {config.configured ? (
                <>
                  Last updated by <span className='font-mono'>{config.updated_by ?? '—'}</span> at{' '}
                  <span className='font-mono'>{config.updated_at ?? '—'}</span>
                </>
              ) : (
                <>No storage configuration saved yet. Defaults to the R2 native binding.</>
              )}
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
              <legend className='block text-sm font-medium text-gray-700 mb-1'>Provider</legend>
              <div className='grid grid-cols-2 gap-2'>
                <ProviderButton
                  icon={<Database className='w-4 h-4' />}
                  label='R2 (Native Binding)'
                  description='Uses the R2 bucket bound in wrangler. Zero credentials.'
                  active={provider === 'r2-binding'}
                  onClick={() => setProvider('r2-binding')}
                />
                <ProviderButton
                  icon={<Cloud className='w-4 h-4' />}
                  label='S3-Compatible'
                  description='AWS S3, MinIO, Backblaze B2, R2 via S3 API.'
                  active={provider === 's3-compatible'}
                  onClick={() => setProvider('s3-compatible')}
                />
              </div>
            </fieldset>

            {provider === 'r2-binding' && (
              <div className='rounded-md bg-blue-50 p-3 text-sm text-blue-900'>
                The R2 native binding is used directly. No credentials are required at runtime — the
                binding is configured in <code>wrangler.jsonc</code>. Make sure an R2 bucket is
                bound to this Worker.
              </div>
            )}

            {provider === 's3-compatible' && (
              <div className='space-y-3'>
                <Field label='Endpoint' required>
                  <input
                    type='url'
                    name='storage-endpoint'
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder='https://account.r2.cloudflarestorage.com'
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
                  <Field label='Bucket' required>
                    <input
                      type='text'
                      name='storage-bucket'
                      value={bucket}
                      onChange={(e) => setBucket(e.target.value)}
                      placeholder='my-bucket'
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                    />
                  </Field>
                  <Field label='Region'>
                    <input
                      type='text'
                      name='storage-region'
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder='auto'
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
                  <span>Use path-style URLs (recommended for R2, MinIO; required for B2)</span>
                </label>

                <div className='border-t border-gray-200 pt-3 space-y-3'>
                  <div className='text-xs text-gray-500'>
                    Credentials are encrypted server-side and never returned by the API.{' '}
                    {config?.has_access_key || config?.has_secret_key ? (
                      <>Leave blank to keep the existing values.</>
                    ) : null}
                  </div>
                  <Field label='Access Key ID' required={!config?.has_access_key}>
                    <input
                      type='text'
                      name='storage-access-key-id'
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder={config?.has_access_key ? '(unchanged)' : 'AKID...'}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck={false}
                      data-form-type='other'
                      data-lpignore='true'
                      className='w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono'
                    />
                  </Field>
                  <Field label='Secret Access Key' required={!config?.has_secret_key}>
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
                      placeholder={config?.has_secret_key ? '(unchanged)' : '••••••••'}
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
                  <strong>Note:</strong> When the endpoint is{' '}
                  <code>*.r2.cloudflarestorage.com</code>, browser uploads are routed through the
                  Worker proxy (CORS preflight limitations on R2's S3 endpoint). All other endpoints
                  receive a presigned PUT URL for direct browser uploads.
                </div>
              </div>
            )}

            <div className='mt-6 flex justify-end gap-2'>
              <button
                type='button'
                onClick={onClose}
                className='rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
              >
                Cancel
              </button>
              <button
                type='submit'
                disabled={isSaving}
                className='rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
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
          <button
            type='button'
            onClick={onClose}
            className='text-gray-400 hover:text-gray-600'
            aria-label='Close'
          >
            <X className='w-5 h-5' />
          </button>
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
