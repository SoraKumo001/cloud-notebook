import { useCallback, useEffect, useState } from 'react'

interface NotebookStats {
  notebookVectorCount: number
  globalVectorCount: number
}

interface UseNotebookStatsReturn {
  stats: NotebookStats | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useNotebookStats(
  notebookId: string,
  _refreshTrigger?: any,
): UseNotebookStatsReturn {
  const [stats, setStats] = useState<NotebookStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!notebookId) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/stats`)

      if (!res.ok) {
        throw new Error(`Failed to load stats: ${res.status}`)
      }

      const data = (await res.json()) as NotebookStats
      setStats(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    stats,
    loading,
    error,
    refresh,
  }
}
