import { useCallback, useEffect, useState } from 'react'
import type { Source } from '../components/SourceList'

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

// ── Source status mapping ─────────────────────────────────────────────────────

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

interface SourceContent {
  content: string
  type: string
  name: string
}

interface UpdateSourceContentBody {
  content: string
  chunks?: Array<{ content: string; pageNumber?: number }>
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
  getSourceContent: (id: string) => Promise<SourceContent>
  updateSourceContent: (
    id: string,
    content: string,
    chunks?: Array<{ content: string; pageNumber?: number }>,
  ) => Promise<void>
}

export function useSources(notebookId: string): UseSourcesReturn {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchJson<
        Array<{
          id: string
          name: string
          type: string
          status: string
          created_at: string
          size?: number | null
        }>
      >(`/api/notebooks/${encodeURIComponent(notebookId)}/sources`)

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

  const deleteSource = useCallback(
    async (id: string) => {
      try {
        setError(null)
        // Optimistic UI Update: immediately remove from local state
        setSources((prev) => prev.filter((s) => s.id !== id))

        await fetchJson<unknown>(`/api/sources/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })

        // Run refresh in background to align state
        refresh()
      } catch (err) {
        // Rollback state by refreshing from server on failure
        await refresh()
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

  const renameSource = useCallback(
    async (id: string, name: string) => {
      try {
        setError(null)
        await fetchJson<unknown>(`/api/sources/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
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
        await fetchJson<unknown>(
          `/api/notebooks/${encodeURIComponent(notebookId)}/sources/reorder`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceIds }),
          },
        )

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
    [notebookId, sources, refresh],
  )

  const updateNotebook = useCallback(async (id: string, update: NotebookUpdate) => {
    try {
      setError(null)
      await fetchJson<unknown>(`/api/notebooks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.code && apiErr.status !== undefined) {
        setError(`${apiErr.code}:${apiErr.status}`)
      } else {
        setError('generic')
      }
      throw err
    }
  }, [])

  const deleteNotebook = useCallback(async (id: string) => {
    try {
      setError(null)
      await fetchJson<unknown>(`/api/notebooks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.code && apiErr.status !== undefined) {
        setError(`${apiErr.code}:${apiErr.status}`)
      } else {
        setError('generic')
      }
      throw err
    }
  }, [])

  const getSourceContent = useCallback(async (id: string) => {
    try {
      setError(null)
      return await fetchJson<SourceContent>(`/api/sources/${encodeURIComponent(id)}/content`)
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.code && apiErr.status !== undefined) {
        setError(`${apiErr.code}:${apiErr.status}`)
      } else {
        setError('generic')
      }
      throw err
    }
  }, [])

  const updateSourceContent = useCallback(
    async (
      id: string,
      content: string,
      chunks?: Array<{ content: string; pageNumber?: number }>,
    ) => {
      try {
        setError(null)
        const body: UpdateSourceContentBody = { content, chunks }
        await fetchJson<unknown>(`/api/sources/${encodeURIComponent(id)}/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
    getSourceContent,
    updateSourceContent,
  }
}
