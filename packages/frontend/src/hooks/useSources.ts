import { useCallback, useEffect, useState } from 'react'
import type { Source } from '../components/SourceList'

/** Map API status string to Source.status union. */
function mapSourceStatus(apiStatus: string): Source['status'] {
  switch (apiStatus) {
    case 'ready':
    case 'completed':
      return 'ready'
    case 'processing':
      return 'processing'
    case 'error':
      return 'error'
    default:
      return 'pending'
  }
}

interface NotebookUpdate {
  title?: string
  description?: string
}

interface UseSourcesReturn {
  sources: Source[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  deleteSource: (id: string) => Promise<void>
  renameSource: (id: string, name: string) => Promise<void>
  reorderSources: (sourceIds: string[]) => Promise<void>
  updateNotebook: (id: string, update: NotebookUpdate) => Promise<void>
  deleteNotebook: (id: string) => Promise<void>
}

export function useSources(notebookId: string): UseSourcesReturn {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/sources`)

      if (!res.ok) {
        throw new Error(`Failed to load sources: ${res.status}`)
      }

      const data = (await res.json()) as Array<{
        id: string
        name: string
        type: string
        status: string
        created_at: string
        size?: number | null
      }>

      setSources(
        data.map((s) => ({
          id: s.id,
          fileName: s.name,
          type: s.type,
          status: mapSourceStatus(s.status),
          updatedAt: s.created_at,
          size: s.size ?? undefined,
        })),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  const deleteSource = useCallback(
    async (id: string) => {
      try {
        setError(null)
        // Optimistic UI Update: immediately remove from local state
        setSources((prev) => prev.filter((s) => s.id !== id))

        const res = await fetch(`/api/sources/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || `Delete failed: ${res.status}`)
        }

        // Run refresh in background to align state
        refresh()
      } catch (err) {
        // Rollback state by refreshing from server on failure
        await refresh()
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
        throw err
      }
    },
    [refresh],
  )

  const renameSource = useCallback(
    async (id: string, name: string) => {
      try {
        setError(null)
        const res = await fetch(`/api/sources/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
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

  const reorderSources = useCallback(
    async (sourceIds: string[]) => {
      const currentMap = new Map(sources.map((s) => [s.id, s]))
      const optimistic = sourceIds
        .map((id) => currentMap.get(id))
        .filter((s): s is Source => s !== undefined)
      // Append any sources not in the provided order at the end
      for (const source of sources) {
        if (!sourceIds.includes(source.id)) {
          optimistic.push(source)
        }
      }

      try {
        setError(null)
        setSources(optimistic)
        const res = await fetch(
          `/api/notebooks/${encodeURIComponent(notebookId)}/sources/reorder`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceIds }),
          },
        )

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || `Reorder failed: ${res.status}`)
        }

        await refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
        throw err
      }
    },
    [notebookId, sources, refresh],
  )

  const updateNotebook = useCallback(async (id: string, update: NotebookUpdate) => {
    try {
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || `Update failed: ${res.status}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      throw err
    }
  }, [])

  const deleteNotebook = useCallback(async (id: string) => {
    try {
      setError(null)
      const res = await fetch(`/api/notebooks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || `Delete failed: ${res.status}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      throw err
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    sources,
    loading,
    error,
    refresh,
    deleteSource,
    renameSource,
    reorderSources,
    updateNotebook,
    deleteNotebook,
  }
}
