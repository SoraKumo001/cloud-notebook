import { useCallback, useEffect, useState } from 'react'

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
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`)

      if (!res.ok) {
        throw new Error(`Failed to load notes: ${res.status}`)
      }

      const data = (await res.json()) as Note[]
      setNotes(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [notebookId])

  const createNote = useCallback(
    async (title: string, content: string) => {
      try {
        setError(null)
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || `Create failed: ${res.status}`)
        }

        const created = (await res.json()) as Note
        await refresh()
        return created
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
        throw err
      }
    },
    [notebookId, refresh],
  )

  const updateNote = useCallback(
    async (id: string, update: { title?: string; content?: string }) => {
      try {
        setError(null)
        const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || `Update failed: ${res.status}`)
        }

        const updated = (await res.json()) as Note
        await refresh()
        return updated
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setError(message)
        throw err
      }
    },
    [refresh],
  )

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        setError(null)
        const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
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

  useEffect(() => {
    refresh()
  }, [refresh])

  return { notes, loading, error, refresh, createNote, updateNote, deleteNote }
}
