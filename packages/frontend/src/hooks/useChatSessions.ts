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
  if (res.status === 204) {
    return {} as T
  }
  if (typeof res.text !== 'function') {
    return res.json() as Promise<T>
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

export interface ChatSession {
  id: string
  title: string
  created_at: string
}

interface UseChatSessionsReturn {
  sessions: ChatSession[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
}

export function useChatSessions(notebookId: string): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchJson<ChatSession[]>(
        `/api/notebooks/${encodeURIComponent(notebookId)}/sessions`,
      )
      setSessions(data)
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

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        setError(null)
        await fetchJson<unknown>(`/api/sessions/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        await refresh()
      } catch (err) {
        const apiErr = err as ApiError
        if (apiErr.code && apiErr.status !== undefined) {
          setError(`${apiErr.code}:${apiErr.status}`)
        } else {
          setError('generic')
        }
        throw err
      }
    },
    [refresh],
  )

  const renameSession = useCallback(
    async (id: string, title: string) => {
      try {
        setError(null)
        await fetchJson<unknown>(`/api/sessions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        await refresh()
      } catch (err) {
        const apiErr = err as ApiError
        if (apiErr.code && apiErr.status !== undefined) {
          setError(`${apiErr.code}:${apiErr.status}`)
        } else {
          setError('generic')
        }
        throw err
      }
    },
    [refresh],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  return { sessions, loading, error, refresh, deleteSession, renameSession }
}
