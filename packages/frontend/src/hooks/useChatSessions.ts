import { useCallback, useEffect, useState } from 'react'

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
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/sessions`)

      if (!res.ok) {
        throw new Error(`Failed to load sessions: ${res.status}`)
      }

      const data = (await res.json()) as ChatSession[]
      setSessions(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        setError(null)
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || `Delete failed: ${res.status}`)
        }

        await refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
        throw err
      }
    },
    [refresh],
  )

  const renameSession = useCallback(
    async (id: string, title: string) => {
      try {
        setError(null)
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || `Rename failed: ${res.status}`)
        }

        await refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
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
