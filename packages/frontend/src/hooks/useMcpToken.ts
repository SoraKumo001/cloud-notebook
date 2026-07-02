import { useCallback, useEffect, useState } from 'react'

// ── Shared fetch helper ──────────────────────────────────────────────────────

interface ApiError {
  code: string
  fallbackMessage: string
  status: number
}

function mapStatusToCode(status: number): string {
  if (status === 401) return 'auth.unauthorized'
  if (status === 403) return 'auth.forbidden'
  if (status === 404) return 'errors.generic'
  if (status === 409) return 'resource.conflict'
  if (status === 413) return 'request.tooLarge'
  if (status === 500) return 'server.internalError'
  return 'errors.generic'
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string; code?: string })
    const code = typeof body.code === 'string' ? body.code : undefined
    throw {
      code: code ?? mapStatusToCode(res.status),
      fallbackMessage: body.error ?? res.statusText ?? res.status.toString(),
      status: res.status,
    } satisfies ApiError
  }
  return res.json() as Promise<T>
}

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
        const body = await res.json().catch(() => ({}) as { error?: string; code?: string })
        const code = typeof body.code === 'string' ? body.code : undefined
        throw {
          code: code ?? mapStatusToCode(res.status),
          fallbackMessage: body.error ?? res.statusText ?? res.status.toString(),
          status: res.status,
        } satisfies ApiError
      }

      const data = (await res.json()) as { has_token: boolean }
      setHasToken(data.has_token)
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.code && apiErr.status !== undefined) {
        setError(`${apiErr.code}:${apiErr.status}`)
      } else {
        setError('generic')
      }
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
      const data = await fetchJson<{ token?: string }>(
        `/api/notebooks/${encodeURIComponent(notebookId)}/mcp-token`,
        {
          method: 'POST',
        },
      )
      setLastGeneratedToken(typeof data.token === 'string' ? data.token : null)
      setHasToken(true)
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.code && apiErr.status !== undefined) {
        setError(`${apiErr.code}:${apiErr.status}`)
      } else {
        setError('generic')
      }
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  const revokeToken = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      await fetchJson<unknown>(`/api/notebooks/${encodeURIComponent(notebookId)}/mcp-token`, {
        method: 'DELETE',
      })
      setHasToken(false)
      setLastGeneratedToken(null)
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.code && apiErr.status !== undefined) {
        setError(`${apiErr.code}:${apiErr.status}`)
      } else {
        setError('generic')
      }
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
