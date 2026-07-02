import * as React from 'react'
import { useTranslation } from 'react-i18next'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  name: string
  isAdmin: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common')
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchUser = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/me')

      if (res.status === 401) {
        setUser(null)
        return
      }

      if (!res.ok) {
        throw new Error(t('errors.fetchUserFailed', { status: res.status }))
      }

      const data = (await res.json()) as AuthUser
      setUser(data)
    } catch (err) {
      setUser(null)
      setError(err instanceof Error ? err.message : t('errors.authenticateFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, loading, error, refresh: fetchUser }),
    [user, loading, error, fetchUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>')
  }
  return ctx
}
