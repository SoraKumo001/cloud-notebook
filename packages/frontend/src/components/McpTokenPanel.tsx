import { Check, ChevronDown, Copy, Eye, EyeOff, Key, RefreshCw, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useMcpToken } from '../hooks/useMcpToken'
import { Button } from './ui/Button'

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

function CodeBlock({ code, t }: { code: string; t: (key: string) => string }) {
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
      <Button
        type='button'
        size='xs'
        variant='ghost'
        iconLeft={copied ? Check : Copy}
        onClick={() => void handleCopy()}
        className='absolute right-2 top-2'
      >
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
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
  t,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  t: (key: string) => string
}) {
  return (
    <div className='modal modal-open'>
      <div className='modal-box max-w-sm p-6'>
        <h3 className='text-lg font-semibold text-base-content mb-2'>{title}</h3>
        <p className='text-sm text-base-content/60 mb-6'>{message}</p>
        <div className='flex items-center justify-end gap-3'>
          <Button type='button' variant='ghost' iconLeft={X} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            type='button'
            variant='error'
            iconLeft={confirmAction === 'regenerate' ? RefreshCw : Trash2}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function McpTokenPanel({ notebookId }: McpTokenPanelProps) {
  const { t } = useTranslation('common')
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
            {t('common.loading')}
          </div>
        ) : lastGeneratedToken ? (
          // Generated this session — show the plaintext once, with a clear "you won't see it again" cue.
          <div className='space-y-3'>
            <div className='rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning'>
              {t('mcp.savedPrompt')}
            </div>
            <div className='flex items-center gap-2'>
              <div className='flex-1 min-w-0 px-3 py-2 rounded-md bg-base-200 border border-base-300 font-mono text-sm text-base-content/70 truncate'>
                {showToken ? lastGeneratedToken : maskToken(lastGeneratedToken)}
              </div>
              <Button
                type='button'
                size='sm'
                variant='neutral'
                iconLeft={showToken ? EyeOff : Eye}
                onClick={() => setShowToken((prev) => !prev)}
                className='flex-shrink-0'
              >
                {showToken ? t('common.hide') : t('common.show')}
              </Button>
              <Button
                type='button'
                size='sm'
                variant='neutral'
                iconLeft={copied ? Check : Copy}
                onClick={() => void handleCopy()}
                className='flex-shrink-0'
              >
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
            <Button
              type='button'
              size='sm'
              variant='primary'
              iconLeft={Check}
              onClick={clearLastGeneratedToken}
              className='w-full'
            >
              {t('mcp.savedAck')}
            </Button>
          </div>
        ) : !hasToken ? (
          <Button
            type='button'
            variant='primary'
            iconLeft={Key}
            loading={loading}
            onClick={() => void generateToken()}
            className='w-full'
          >
            {t('mcp.generateToken')}
          </Button>
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
              <span className='text-sm text-base-content/80'>{t('mcp.generated')}</span>
            </div>

            <div className='flex items-center gap-2'>
              <Button
                type='button'
                size='sm'
                variant='neutral'
                iconLeft={RefreshCw}
                disabled={loading}
                onClick={() => setConfirmAction('regenerate')}
                className='flex-1'
              >
                {t('mcp.regenerate')}
              </Button>
              <Button
                type='button'
                size='sm'
                variant='error'
                iconLeft={Trash2}
                disabled={loading}
                onClick={() => setConfirmAction('revoke')}
                className='flex-1'
              >
                {t('mcp.discard')}
              </Button>
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
            {t('mcp.setup')}
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
                  <p className='text-xs text-base-content/60'>{t('mcp.setupBody')}</p>

                  <div>
                    <h4 className='text-xs font-semibold text-base-content/80 mb-1'>
                      {t('mcp.serverUrl')}
                    </h4>
                    <CodeBlock code={backendUrl} t={t} />
                  </div>

                  <div>
                    <h4 className='text-xs font-semibold text-base-content/80 mb-1'>
                      {t('mcp.authHeader')}
                    </h4>
                    <CodeBlock code='Authorization: Bearer YOUR_TOKEN' t={t} />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction === 'regenerate'
              ? t('mcp.regenerateDialog.title')
              : t('mcp.discardDialog.title')
          }
          message={
            confirmAction === 'regenerate'
              ? t('mcp.regenerateDialog.regenerateBody')
              : t('mcp.discardDialog.discardBody')
          }
          confirmLabel={confirmAction === 'regenerate' ? t('mcp.regenerate') : t('mcp.discard')}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setConfirmAction(null)}
          t={t}
        />
      )}
    </div>
  )
}
