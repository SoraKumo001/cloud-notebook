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

export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

interface UseNotesReturn {
  notes: Note[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createNote: (title: string, content: string) => Promise<Note>
  updateNote: (id: string, update: { title?: string; content?: string }) => Promise<Note>
  deleteNote: (id: string) => Promise<void>
}

export function useNotes(notebookId: string): UseNotesReturn {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchJson<Note[]>(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`)
      setNotes(data)
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

  const createNote = useCallback(
    async (title: string, content: string) => {
      try {
        setError(null)
        const created = await fetchJson<Note>(
          `/api/notebooks/${encodeURIComponent(notebookId)}/notes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content }),
          },
        )
        await refresh()
        return created
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
    [notebookId, refresh],
  )

  const updateNote = useCallback(
    async (id: string, update: { title?: string; content?: string }) => {
      try {
        setError(null)
        const updated = await fetchJson<Note>(`/api/notes/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
        })
        await refresh()
        return updated
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

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        setError(null)
        await fetchJson<unknown>(`/api/notes/${encodeURIComponent(id)}`, {
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

  useEffect(() => {
    refresh()
  }, [refresh])

  return { notes, loading, error, refresh, createNote, updateNote, deleteNote }
}
