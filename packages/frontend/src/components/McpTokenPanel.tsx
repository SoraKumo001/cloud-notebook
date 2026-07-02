import { Check, ChevronDown } from 'lucide-react'
import * as React from 'react'
import { useMcpToken } from '../hooks/useMcpToken'

interface McpTokenPanelProps {
  notebookId: string
}

function maskToken(token: string): string {
  if (token.length <= 12) {
    return '•'.repeat(token.length)
  }
  const start = token.slice(0, 3)
  const end = token.slice(-4)
  return `${start}${'•'.repeat(token.length - 7)}${end}`
}

function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/mcp`
  }
  return 'https://your-backend-url/mcp'
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    if (!navigator.clipboard || !window.isSecureContext) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className='relative mt-2 rounded-md bg-base-200 border border-base-300'>
      <pre className='p-3 pr-16 overflow-x-auto font-mono text-xs text-base-content/70 whitespace-pre-wrap break-all'>
        <code>{code}</code>
      </pre>
      <button
        type='button'
        onClick={() => void handleCopy()}
        className='absolute right-2 top-2 btn btn-ghost btn-xs'
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Spinner({ className = '' }: { className?: string }) {
  return <span className={`loading loading-spinner loading-sm ${className}`} />
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className='modal modal-open'>
      <div className='modal-box max-w-sm p-6'>
        <h3 className='text-lg font-semibold text-base-content mb-2'>{title}</h3>
        <p className='text-sm text-base-content/60 mb-6'>{message}</p>
        <div className='flex items-center justify-end gap-3'>
          <button type='button' onClick={onCancel} className='btn btn-ghost'>
            Cancel
          </button>
          <button type='button' onClick={onConfirm} className='btn btn-error'>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function McpTokenPanel({ notebookId }: McpTokenPanelProps) {
  const {
    hasToken,
    lastGeneratedToken,
    loading,
    error,
    generateToken,
    revokeToken,
    clearLastGeneratedToken,
  } = useMcpToken(notebookId)
  const [showToken, setShowToken] = React.useState(true)
  const [copied, setCopied] = React.useState(false)
  const [instructionsOpen, setInstructionsOpen] = React.useState(false)
  const [confirmAction, setConfirmAction] = React.useState<'regenerate' | 'revoke' | null>(null)

  const backendUrl = getBackendUrl()

  // Reset the "show" toggle when a new token is generated.
  React.useEffect(() => {
    if (lastGeneratedToken) setShowToken(true)
  }, [lastGeneratedToken])

  async function handleCopy() {
    if (!lastGeneratedToken) return
    if (!navigator.clipboard || !window.isSecureContext) return
    try {
      await navigator.clipboard.writeText(lastGeneratedToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  async function handleConfirm() {
    if (confirmAction === 'regenerate') {
      await generateToken()
    } else if (confirmAction === 'revoke') {
      await revokeToken()
      setShowToken(true)
    }
    setConfirmAction(null)
  }

  return (
    <div className='card bg-base-100'>
      <div className='p-5 space-y-4'>
        {error && <div className='alert alert-error text-xs'>{error}</div>}

        {loading && !hasToken && !lastGeneratedToken ? (
          <div className='flex items-center justify-center gap-2 py-3 text-sm text-base-content/60'>
            <Spinner />
            Loading…
          </div>
        ) : lastGeneratedToken ? (
          // Generated this session — show the plaintext once, with a clear "you won't see it again" cue.
          <div className='space-y-3'>
            <div className='rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning'>
              Copy this token now — it will not be shown again after you close this view.
            </div>
            <div className='flex items-center gap-2'>
              <div className='flex-1 min-w-0 px-3 py-2 rounded-md bg-base-200 border border-base-300 font-mono text-sm text-base-content/70 truncate'>
                {showToken ? lastGeneratedToken : maskToken(lastGeneratedToken)}
              </div>
              <button
                type='button'
                onClick={() => setShowToken((prev) => !prev)}
                className='flex-shrink-0 btn btn-neutral btn-sm'
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
              <button
                type='button'
                onClick={() => void handleCopy()}
                className='flex-shrink-0 btn btn-neutral btn-sm'
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              type='button'
              onClick={clearLastGeneratedToken}
              className='w-full btn btn-primary btn-sm'
            >
              I&apos;ve saved the token
            </button>
          </div>
        ) : !hasToken ? (
          <button
            type='button'
            onClick={() => void generateToken()}
            disabled={loading}
            className='w-full btn btn-primary'
          >
            {loading ? <Spinner /> : null}
            Generate token
          </button>
        ) : (
          <div className='space-y-3'>
            {/* Token already generated previously and not surfaced this session. */}
            <div className='flex items-center gap-2 px-3 py-2 rounded-md bg-success/10 border border-success/30'>
              <Check
                size={16}
                strokeWidth={2}
                className='text-success shrink-0'
                aria-hidden='true'
              />
              <span className='text-sm text-base-content/80'>Token has been generated.</span>
            </div>

            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => setConfirmAction('regenerate')}
                disabled={loading}
                className='flex-1 btn btn-neutral btn-sm'
              >
                Regenerate
              </button>
              <button
                type='button'
                onClick={() => setConfirmAction('revoke')}
                disabled={loading}
                className='flex-1 btn btn-error btn-sm'
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Setup instructions */}
        <div className='border-t border-base-300 pt-4 bg-transparent'>
          <button
            type='button'
            onClick={() => setInstructionsOpen((prev) => !prev)}
            className='w-full flex items-center justify-between text-sm font-medium text-base-content/80 hover:text-base-content pr-4'
            aria-expanded={instructionsOpen}
          >
            Setup instructions
            <ChevronDown
              size={16}
              strokeWidth={2}
              className={`transition-transform duration-300 ${instructionsOpen ? 'rotate-180' : ''}`}
              aria-hidden='true'
            />
          </button>
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${instructionsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          >
            <div className='overflow-hidden'>
              <div className='space-y-4 pt-2'>
                <section className='space-y-3'>
                  <p className='text-xs text-base-content/60'>
                    Connect any MCP client that supports the Streamable HTTP transport. Use the URL
                    below and the bearer token for this notebook as the
                    <code className='text-base-content/70 bg-base-100 px-1 py-0.5 rounded mx-1'>
                      Authorization
                    </code>
                    header value. If you no longer have the token, regenerate a new one (the
                    previous token will be invalidated).
                  </p>

                  <div>
                    <h4 className='text-xs font-semibold text-base-content/80 mb-1'>Server URL</h4>
                    <CodeBlock code={backendUrl} />
                  </div>

                  <div>
                    <h4 className='text-xs font-semibold text-base-content/80 mb-1'>
                      Authorization header
                    </h4>
                    <CodeBlock code='Authorization: Bearer YOUR_TOKEN' />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction === 'regenerate' ? 'Regenerate token?' : 'Discard token?'}
          message={
            confirmAction === 'regenerate'
              ? 'A new token will be generated and the old one will be invalidated immediately. Any clients using the old token will lose access.'
              : 'This will remove the token from the server. The panel will return to the "Generate token" state. Any clients using the current token will lose access.'
          }
          confirmLabel={confirmAction === 'regenerate' ? 'Regenerate' : 'Discard'}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
