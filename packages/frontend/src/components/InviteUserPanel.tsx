import { Check, Clipboard, Trash2, UserPlus, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '../i18n/formatters'
import { useLocale } from '../i18n/useLocale'
import { Button } from './ui/Button'

interface Invitation {
  id: string
  email: string
  expiresAt: string
  usedAt: string | null
  createdAt: string
  active: boolean
}

function buildInviteUrl(token: string): string {
  if (typeof window === 'undefined') {
    return `https://your-backend-url/login?invite=${token}`
  }
  return `${window.location.origin}/login?invite=${token}`
}

function Spinner({ className = '' }: { className?: string }) {
  return <span className={`loading loading-spinner loading-sm ${className}`} />
}

function ConfirmDelete({
  email,
  onConfirm,
  onCancel,
  t,
}: {
  email: string
  onConfirm: () => void
  onCancel: () => void
  t: (key: string) => string
}) {
  return (
    <div className='modal modal-open'>
      <div className='modal-box max-w-sm p-6'>
        <h3 className='text-lg font-semibold text-base-content mb-2'>
          {t('invite.revokeDialog.title')}
        </h3>
        <p className='text-sm text-base-content/60 mb-6'>
          {t('invite.revokeDialog.body', { email })}
        </p>
        <div className='flex items-center justify-end gap-3'>
          <Button type='button' variant='ghost' iconLeft={X} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type='button' variant='error' iconLeft={Trash2} onClick={onConfirm}>
            {t('invite.revokeDialog.submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CopyableLink({ url, t }: { url: string; t: (key: string) => string }) {
  const [copied, setCopied] = React.useState(false)
  async function handleCopy() {
    if (!navigator.clipboard || !window.isSecureContext) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }
  return (
    <div className='flex items-center gap-2'>
      <div className='flex-1 min-w-0 px-3 py-2 rounded-md bg-base-200 border border-base-300 font-mono text-xs text-base-content/70 truncate'>
        {url}
      </div>
      <button
        type='button'
        onClick={() => void handleCopy()}
        className='flex-shrink-0 btn btn-neutral btn-sm'
      >
        {copied ? (
          <>
            <Check size={14} strokeWidth={2} aria-hidden='true' /> {t('common.copied')}
          </>
        ) : (
          <>
            <Clipboard size={14} strokeWidth={2} aria-hidden='true' /> {t('common.copy')}
          </>
        )}
      </button>
    </div>
  )
}

export function InviteUserPanel() {
  const { t } = useTranslation('common')
  const { locale } = useLocale()
  const [invitations, setInvitations] = React.useState<Invitation[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [lastIssued, setLastIssued] = React.useState<{ email: string; token: string } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/invitations', { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`loadInvitationsFailed:${res.status}`)
      }
      const data = (await res.json()) as Invitation[]
      setInvitations(data)
    } catch (e) {
      const apiErr = e as { message?: string }
      if (apiErr.message?.includes(':')) {
        const [code, status] = apiErr.message.split(':')
        setError(t(`errors.${code}` as const, { status: Number(status) }))
      } else {
        setError(t('errors.loadInvitationsFailed'))
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        throw new Error(`issueInviteFailed:${res.status}`)
      }
      const data = (await res.json()) as { email: string; token: string }
      setLastIssued({ email: data.email, token: data.token })
      setEmail('')
      await load()
    } catch (e) {
      const apiErr = e as { message?: string }
      if (apiErr.message?.includes(':')) {
        const [code, status] = apiErr.message.split(':')
        setError(t(`errors.${code}` as const, { status: Number(status) }))
      } else {
        setError(t('errors.issueInviteFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/auth/invitations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`revokeFailed:${res.status}`)
      }
      await load()
    } catch (e) {
      const apiErr = e as { message?: string }
      if (apiErr.message?.includes(':')) {
        const [code, status] = apiErr.message.split(':')
        setError(t(`errors.${code}` as const, { status: Number(status) }))
      } else {
        setError(t('errors.revokeFailed'))
      }
    } finally {
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className='card bg-base-100'>
      <div className='p-5 space-y-4'>
        {error && <div className='alert alert-error text-xs'>{error}</div>}

        {lastIssued && (
          <div className='rounded-md border border-warning/30 bg-warning/10 p-3 space-y-2'>
            <p className='text-xs text-warning'>
              {t('invite.sentToast', { email: lastIssued.email })}
            </p>
            <CopyableLink url={buildInviteUrl(lastIssued.token)} t={t} />
            <Button
              type='button'
              size='xs'
              variant='ghost'
              iconLeft={X}
              onClick={() => setLastIssued(null)}
            >
              {t('common.dismiss')}
            </Button>
          </div>
        )}

        <form onSubmit={handleIssue} className='flex items-end gap-2'>
          <label className='form-control flex-1'>
            <span className='label-text mb-1 block'>{t('invite.formTitle')}</span>
            <input
              type='email'
              required
              placeholder={t('invite.emailPlaceholder')}
              className='input input-bordered w-full'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </label>
          <button type='submit' disabled={submitting} className='btn btn-primary'>
            {submitting ? <Spinner /> : <UserPlus size={16} strokeWidth={2} aria-hidden='true' />}
            {t('invite.submit')}
          </button>
        </form>

        <div className='border-t border-base-300 pt-4'>
          <h3 className='text-sm font-semibold text-base-content/80 mb-2'>
            {t('invite.issuedTitle')}
          </h3>
          {loading ? (
            <div className='flex items-center justify-center gap-2 py-3 text-sm text-base-content/60'>
              <Spinner /> {t('invite.loading')}
            </div>
          ) : invitations.length === 0 ? (
            <p className='text-sm text-base-content/50 py-2'>{t('invite.empty')}</p>
          ) : (
            <ul className='divide-y divide-base-300'>
              {invitations.map((inv) => (
                <li key={inv.id} className='py-2 flex items-center gap-2'>
                  <div className='flex-1 min-w-0'>
                    <div className='text-sm text-base-content/80 truncate font-mono'>
                      {inv.email}
                    </div>
                    <div className='text-xs text-base-content/50'>
                      {inv.usedAt
                        ? t('invite.used', { date: formatDateTime(locale, inv.usedAt) })
                        : inv.active
                          ? t('invite.expires', { date: formatDateTime(locale, inv.expiresAt) })
                          : t('invite.expired', { date: formatDateTime(locale, inv.expiresAt) })}
                    </div>
                  </div>
                  {!inv.usedAt && (
                    <button
                      type='button'
                      onClick={() => setConfirmDeleteId(inv.id)}
                      className='btn btn-ghost btn-sm text-error'
                      aria-label={t('invite.revokeAria', { email: inv.email })}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden='true' />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {confirmDeleteId && (
        <ConfirmDelete
          email={invitations.find((i) => i.id === confirmDeleteId)?.email ?? ''}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => void handleRevoke(confirmDeleteId)}
          t={t}
        />
      )}
    </div>
  )
}
