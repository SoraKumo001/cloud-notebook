import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotebookSettingsModal, type NotebookSettingsNotebook } from './NotebookSettingsModal'

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

function mockApiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function renderModal(props: {
  notebookId: string
  notebook: NotebookSettingsNotebook
  isOpen: boolean
  onClose?: () => void
  onSaved?: (notebook: NotebookSettingsNotebook) => void
}): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  root.render(React.createElement(NotebookSettingsModal, props))
  return {
    container,
    unmount: () => {
      root.unmount()
      document.body.removeChild(container)
    },
  }
}

describe('NotebookSettingsModal', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render when closed', () => {
    const { container, unmount } = renderModal({
      notebookId: 'nb-1',
      notebook: {
        id: 'nb-1',
        title: 'Test',
        description: null,
      },
      isOpen: false,
    })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    unmount()
  })

  it('renders all fields and submits a PATCH request', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/connections') {
        return Promise.resolve(
          mockApiResponse([{ id: 'conn-1', name: 'My Connection', provider: 'custom' }]),
        )
      }
      if (url.startsWith('/api/connections/')) {
        return Promise.resolve(
          mockApiResponse({ models: ['embedding-model', 'chat-model', 'summary-model'] }),
        )
      }
      return Promise.resolve(
        mockApiResponse({
          id: 'nb-1',
          title: 'Updated title',
          description: 'Updated description',
          ai_embedding_model: 'embedding-model',
          model_chat: 'chat-model',
          model_summarization: 'summary-model',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        }),
      )
    })

    const onSaved = vi.fn()
    const onClose = vi.fn()

    const { container, unmount } = renderModal({
      notebookId: 'nb-1',
      notebook: {
        id: 'nb-1',
        title: 'Updated title',
        description: 'Updated description',
        ai_embedding_model: 'embedding-model',
        model_chat: 'chat-model',
        model_summarization: 'summary-model',
      },
      isOpen: true,
      onClose,
      onSaved,
    })

    // Wait for /api/connections and /api/connections/conn-1/models fetches to resolve (model grouping)
    await flushMicrotasks()
    await flushMicrotasks()
    await flushMicrotasks()

    // Fields should be populated
    expect((container.querySelector('#settings-title') as HTMLInputElement).value).toBe(
      'Updated title',
    )
    expect((container.querySelector('#settings-description') as HTMLTextAreaElement).value).toBe(
      'Updated description',
    )

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save changes',
    )
    expect(saveButton).toBeDefined()
    saveButton?.click()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated title',
        description: 'Updated description',
        ai_embedding_model: 'embedding-model',
        model_chat: 'chat-model',
        model_summarization: 'summary-model',
        model_ocr: null,
        system_prompt: null,
      }),
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    unmount()
  })

  it('shows an error banner when save fails', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/connections') {
        return Promise.resolve(mockApiResponse([]))
      }
      return Promise.resolve(mockApiResponse({ error: 'Update failed' }, 500))
    })

    const { container, unmount } = renderModal({
      notebookId: 'nb-1',
      notebook: {
        id: 'nb-1',
        title: 'Test',
        description: null,
      },
      isOpen: true,
      onClose: () => {},
    })

    // Wait for /api/connections fetch to resolve
    await flushMicrotasks()

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save changes',
    )
    saveButton?.click()
    await flushMicrotasks()

    expect(container.textContent).toContain('Update failed')

    unmount()
  })
})
