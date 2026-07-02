import { Check, Clipboard, Trash2, UserPlus } from 'lucide-react'
import * as React from 'react'

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
}: {
  email: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className='modal modal-open'>
      <div className='modal-box max-w-sm p-6'>
        <h3 className='text-lg font-semibold text-base-content mb-2'>Revoke invitation?</h3>
        <p className='text-sm text-base-content/60 mb-6'>
          The invitation for <span className='font-mono'>{email}</span> will be deleted. The link
          will no longer work, even if the recipient has not yet used it.
        </p>
        <div className='flex items-center justify-end gap-3'>
          <button type='button' onClick={onCancel} className='btn btn-ghost'>
            Cancel
          </button>
          <button type='button' onClick={onConfirm} className='btn btn-error'>
            Revoke
          </button>
        </div>
      </div>
    </div>
  )
}

function CopyableLink({ url }: { url: string }) {
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
            <Check size={14} strokeWidth={2} aria-hidden='true' /> Copied
          </>
        ) : (
          <>
            <Clipboard size={14} strokeWidth={2} aria-hidden='true' /> Copy
          </>
        )}
      </button>
    </div>
  )
}

export function InviteUserPanel() {
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
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Failed to load invitations: ${res.status}`)
      }
      const data = (await res.json()) as Invitation[]
      setInvitations(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invitations')
    } finally {
      setLoading(false)
    }
  }, [])

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
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Failed to issue invitation: ${res.status}`)
      }
      const data = (await res.json()) as { email: string; token: string }
      setLastIssued({ email: data.email, token: data.token })
      setEmail('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to issue invitation')
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
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Failed to revoke: ${res.status}`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke')
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
              Invitation sent to <span className='font-mono'>{lastIssued.email}</span>. Send the
              link below — it can be redeemed once, expires in 7 days.
            </p>
            <CopyableLink url={buildInviteUrl(lastIssued.token)} />
            <button
              type='button'
              onClick={() => setLastIssued(null)}
              className='btn btn-ghost btn-xs'
            >
              Dismiss
            </button>
          </div>
        )}

        <form onSubmit={handleIssue} className='flex items-end gap-2'>
          <label className='form-control flex-1'>
            <span className='label-text mb-1 block'>Invite a teammate</span>
            <input
              type='email'
              required
              placeholder='alice@example.com'
              className='input input-bordered w-full'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </label>
          <button type='submit' disabled={submitting} className='btn btn-primary'>
            {submitting ? <Spinner /> : <UserPlus size={16} strokeWidth={2} aria-hidden='true' />}
            Send invite
          </button>
        </form>

        <div className='border-t border-base-300 pt-4'>
          <h3 className='text-sm font-semibold text-base-content/80 mb-2'>Issued invitations</h3>
          {loading ? (
            <div className='flex items-center justify-center gap-2 py-3 text-sm text-base-content/60'>
              <Spinner /> Loading…
            </div>
          ) : invitations.length === 0 ? (
            <p className='text-sm text-base-content/50 py-2'>
              No invitations yet. Use the form above to invite your first teammate.
            </p>
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
                        ? `Used ${new Date(inv.usedAt).toLocaleString()}`
                        : inv.active
                          ? `Expires ${new Date(inv.expiresAt).toLocaleString()}`
                          : `Expired ${new Date(inv.expiresAt).toLocaleString()}`}
                    </div>
                  </div>
                  {!inv.usedAt && (
                    <button
                      type='button'
                      onClick={() => setConfirmDeleteId(inv.id)}
                      className='btn btn-ghost btn-sm text-error'
                      aria-label={`Revoke invitation for ${inv.email}`}
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
        />
      )}
    </div>
  )
}
