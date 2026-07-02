import { useCallback, useEffect, useState } from 'react'

interface UseMcpTokenReturn {
  hasToken: boolean
  /** Plaintext token returned by the most recent generate/regenerate call. Cleared on demand. */
  lastGeneratedToken: string | null
  loading: boolean
  error: string | null
  generateToken: () => Promise<void>
  revokeToken: () => Promise<void>
  /** Clears `lastGeneratedToken`. Call after the user copies the token or dismisses the view. */
  clearLastGeneratedToken: () => void
}

export function useMcpToken(notebookId: string): UseMcpTokenReturn {
  const [hasToken, setHasToken] = useState(false)
  const [lastGeneratedToken, setLastGeneratedToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/mcp-token`, {
        method: 'GET',
      })

      if (res.status === 404) {
        setHasToken(false)
        return
      }

      if (!res.ok) {
        throw new Error(`Failed to load token status: ${res.status}`)
      }

      const data = (await res.json()) as { has_token: boolean }
      setHasToken(data.has_token)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      setHasToken(false)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const generateToken = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/mcp-token`, {
        method: 'POST',
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || `Generate failed: ${res.status}`)
      }

      // Surface the plaintext once, so the user can copy it. Cleared via clearLastGeneratedToken.
      const data = (await res.json().catch(() => ({}))) as { token?: string }
      setLastGeneratedToken(typeof data.token === 'string' ? data.token : null)
      setHasToken(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  const revokeToken = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/mcp-token`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || `Revoke failed: ${res.status}`)
      }

      setHasToken(false)
      setLastGeneratedToken(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  const clearLastGeneratedToken = useCallback(() => {
    setLastGeneratedToken(null)
  }, [])

  return {
    hasToken,
    lastGeneratedToken,
    loading,
    error,
    generateToken,
    revokeToken,
    clearLastGeneratedToken,
  }
}
