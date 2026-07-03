import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { LogIn, Mail, UserPlus } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
  }),
})

type Mode = 'login' | 'register'

function LoginPage() {
  const { t } = useTranslation('common')
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const { invite } = useSearch({ from: '/login' })
  const isInviteFlow = Boolean(invite)

  // Invite tokens always start in register mode; otherwise default to sign-in.
  const [mode, setMode] = React.useState<Mode>(isInviteFlow ? 'register' : 'login')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [name, setName] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const url = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const body: Record<string, unknown> =
        mode === 'register'
          ? { email, password, name: name.trim() || undefined }
          : { email, password }
      if (mode === 'register' && invite) {
        body.inviteToken = invite
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || t('errors.signInFailedGeneric'))
      }
      await refresh()
      await navigate({ to: '/notebooks' })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.signInFailedGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='min-h-screen bg-base-200 text-base-content flex flex-col font-sans'>
      <header className='border-b border-base-300 bg-base-100/50 backdrop-blur-md sticky top-0 z-40'>
        <div className='max-w-7xl mx-auto px-6 h-16 flex items-center'>
          <Link to='/' className='flex items-center space-x-3 group'>
            <div className='w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-teal-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/30 transition-shadow'>
              N
            </div>
            <span className='font-semibold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-base-content to-base-content/60'>
              {t('app.name')}
            </span>
          </Link>
        </div>
      </header>

      <main className='flex-1 flex items-center justify-center px-6 py-12'>
        <div className='w-full max-w-md space-y-6'>
          <div className='text-center space-y-2'>
            <h1 className='text-2xl font-bold tracking-tight'>
              {mode === 'login' ? t('common.signInShort') : t('common.createAccount')}
            </h1>
            <p className='text-sm text-base-content/60'>
              {isInviteFlow
                ? t('login.bodyInvited')
                : mode === 'login'
                  ? t('login.bodyLogin')
                  : t('login.bodyRegister')}
            </p>
            {isInviteFlow && mode === 'register' && (
              <div className='inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-300'>
                <Mail size={14} aria-hidden='true' />
                {t('login.invitationDetected')}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className='space-y-4 rounded-2xl border border-base-300 bg-base-100/40 p-6 shadow-sm'
          >
            {mode === 'register' && (
              <label className='form-control w-full'>
                <span className='label-text mb-1 block'>{t('login.displayNameLabel')}</span>
                <input
                  type='text'
                  autoComplete='name'
                  className='input input-bordered w-full'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
              </label>
            )}

            <label className='form-control w-full'>
              <span className='label-text mb-1 block'>{t('login.emailLabel')}</span>
              <input
                type='email'
                required
                autoComplete='email'
                className='input input-bordered w-full'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
              />
            </label>

            <label className='form-control w-full'>
              <span className='label-text mb-1 block'>{t('login.passwordLabel')}</span>
              <input
                type='password'
                required
                minLength={mode === 'register' ? 8 : 1}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className='input input-bordered w-full'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={200}
              />
              {mode === 'register' && (
                <span className='text-xs text-base-content/50 mt-1 mb-2 block'>
                  {t('login.passwordHint')}
                </span>
              )}
            </label>

            {error && (
              <div className='alert alert-error text-sm py-2' role='alert'>
                {error}
              </div>
            )}

            <button type='submit' disabled={submitting} className='btn btn-primary w-full mt-4'>
              {mode === 'login' ? (
                <LogIn size={20} strokeWidth={2} aria-hidden='true' />
              ) : (
                <UserPlus size={20} strokeWidth={2} aria-hidden='true' />
              )}
              {submitting
                ? t('common.pleaseWait')
                : mode === 'login'
                  ? t('common.signInShort')
                  : t('common.createAccount')}
            </button>
          </form>

          {!isInviteFlow && (
            <div className='text-center text-sm text-base-content/60'>
              {mode === 'login' ? (
                <>
                  {t('common.noAccount')}{' '}
                  <Button
                    type='button'
                    variant='link'
                    iconLeft={UserPlus}
                    onClick={() => {
                      setError(null)
                      setMode('register')
                    }}
                  >
                    {t('common.register')}
                  </Button>
                </>
              ) : (
                <>
                  {t('common.haveAccount')}{' '}
                  <Button
                    type='button'
                    variant='link'
                    iconLeft={LogIn}
                    onClick={() => {
                      setError(null)
                      setMode('login')
                    }}
                  >
                    {t('common.signInShort')}
                  </Button>
                </>
              )}
            </div>
          )}

          <div className='text-center'>
            <Link
              to='/'
              className='text-sm text-base-content/50 hover:text-base-content/70 transition-colors'
            >
              {t('common.backToHome')}
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
