import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSuggestedQuestionsReturn {
  questions: string[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useSuggestedQuestions(notebookId: string): UseSuggestedQuestionsReturn {
  const [questions, setQuestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchQuestions = useCallback(() => {
    if (!notebookId) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/suggested-questions`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(
            (body as { error?: string }).error || 'Failed to fetch suggested questions',
          )
        }
        return res.json() as Promise<{ questions: string[] }>
      })
      .then((data) => {
        setQuestions(data.questions)
        setLoading(false)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
  }, [notebookId])

  useEffect(() => {
    fetchQuestions()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchQuestions])

  return { questions, loading, error, refresh: fetchQuestions }
}
