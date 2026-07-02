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

/**
 * Fetch notebook vector statistics.
 *
 * Auto-refetches whenever `notebookId` or `sourcesVersion` change, so the
 * SourceList can simply pass `sources.length` as the version and the stats
 * will stay in sync with source mutations.
 *
 * Callers may also invoke `refresh()` manually for events that don't change
 * the source count (e.g. ingest completion, where the source exists but its
 * vectors are still being generated server-side).
 */
export function useNotebookStats(
  notebookId: string,
  sourcesVersion?: number,
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
    if (!notebookId) return
    let cancelled = false
    // Reference sourcesVersion so it's a real dependency; the value itself
    // just signals "something changed, refetch".
    void sourcesVersion
    setLoading(true)
    setError(null)
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/stats`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load stats: ${res.status}`)
        return res.json() as Promise<NotebookStats>
      })
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [notebookId, sourcesVersion])

  return {
    stats,
    loading,
    error,
    refresh,
  }
}
