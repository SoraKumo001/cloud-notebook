import { AlertTriangle, ChevronDown, MessageSquare, Send } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useChatSessions } from '../hooks/useChatSessions'
import { type ChatMessage, useChatStream } from '../hooks/useChatStream'
import { CitationChip, type CitationChunk } from './CitationChip'
import { SessionList } from './SessionList'

interface ChatPanelProps {
  notebookId: string
  userId?: string
}

function renderMessageContent(
  content: string,
  chunks: CitationChunk[] = [],
  valid: number[] = [],
  invalid: number[] = [],
) {
  const parts = content.split(/(\[\d+\])/g)

  return parts.map((part) => {
    const match = part.match(/^\[(\d+)\]$/)
    if (!match) return <span key={part}>{part}</span>

    const index = parseInt(match[1], 10)
    const chunk = chunks[index - 1]
    const isInvalid = invalid.includes(index)
    const isValid = valid.includes(index)

    // Only render as a chip if this citation index appears in valid/invalid lists,
    // otherwise show plain text so arbitrary brackets don't become chips.
    if (!isValid && !isInvalid) {
      return <span key={part}>{part}</span>
    }

    return <CitationChip key={part} index={index} chunk={chunk} invalid={isInvalid} />
  })
}

function RiskBanner({
  risk,
  reasons,
  t,
}: {
  risk: 'medium' | 'high'
  reasons?: string[]
  t: (key: string) => string
}) {
  const isHigh = risk === 'high'

  return (
    <div className={`alert text-xs ${isHigh ? 'alert-error' : 'alert-warning'}`}>
      <div className='flex items-center gap-2 font-semibold'>
        <AlertTriangle size={14} strokeWidth={2} aria-hidden='true' />
        {isHigh ? t('chat.highRiskBadge') : t('chat.potentialUnreliable')}
      </div>
      {reasons && reasons.length > 0 && (
        <ul
          className={`mt-1.5 list-disc list-inside space-y-0.5 text-xs ${isHigh ? 'text-red-200/80' : 'text-amber-200/80'}`}
        >
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TypingIndicator() {
  return <span className='loading loading-dots loading-sm text-base-content/50' />
}

function ChatMessageItem({
  message,
  isStreaming,
  t,
}: {
  message: ChatMessage
  isStreaming: boolean
  t: (key: string) => string
}) {
  const isUser = message.role === 'user'
  const isEmptyAssistant = !isUser && message.content === ''

  return (
    <div className={`chat ${isUser ? 'chat-end' : 'chat-start'}`}>
      <div
        className={`chat-bubble max-w-[85%] sm:max-w-[75%] ${
          isUser ? 'chat-bubble-primary' : 'bg-base-200 text-base-content'
        }`}
      >
        {!isUser && message.risk && (message.risk === 'medium' || message.risk === 'high') && (
          <RiskBanner risk={message.risk} reasons={message.reasons} t={t} />
        )}

        <div className='text-sm leading-relaxed whitespace-pre-wrap'>
          {isEmptyAssistant && isStreaming ? (
            <TypingIndicator />
          ) : (
            renderMessageContent(
              message.content,
              message.chunks,
              message.citations?.valid,
              message.citations?.invalid,
            )
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatPanel({ notebookId, userId }: ChatPanelProps) {
  const { t } = useTranslation('common')
  const { messages, isStreaming, error, activeSessionId, sendQuery, reset, loadSession } =
    useChatStream(notebookId, userId)
  const {
    sessions,
    error: sessionsError,
    refresh,
    deleteSession,
    renameSession,
  } = useChatSessions(notebookId)
  const [input, setInput] = React.useState('')
  const [sessionsExpanded, setSessionsExpanded] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/isStreaming are intentionally used only as effect triggers for auto-scroll.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, isStreaming])

  async function handleSubmit() {
    const query = input.trim()
    if (!query || isStreaming) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.overflowY = 'hidden'
    }
    await sendQuery(query)
    // Refresh session list so a new session appears after first message
    await refresh()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  function handleInput(event: React.FormEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget
    setInput(target.value)
    target.style.height = 'auto'
    const newHeight = Math.min(target.scrollHeight, 160)
    target.style.height = `${newHeight}px`
    target.style.overflowY = target.scrollHeight > 160 ? 'auto' : 'hidden'
  }

  async function handleSelectSession(id: string) {
    await loadSession(id)
  }

  async function handleNewChat() {
    reset()
    await refresh()
  }

  async function handleDeleteSession(id: string) {
    await deleteSession(id)
    if (id === activeSessionId) {
      reset()
    }
    await refresh()
  }

  async function handleRenameSession(id: string, title: string) {
    await renameSession(id, title)
  }

  return (
    <div className='card card-border bg-base-100 h-full overflow-hidden'>
      {/* Header */}
      <div className='px-5 py-4 border-b border-base-300 bg-base-200 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div className='w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500/20 to-emerald-500/20 border border-teal-500/20 flex items-center justify-center text-teal-400'>
            <MessageSquare size={16} strokeWidth={2} aria-hidden='true' />
          </div>
          <h2 className='text-base font-semibold text-base-content'>{t('chat.title')}</h2>
        </div>
        <button
          type='button'
          onClick={handleNewChat}
          disabled={messages.length === 0 && !error}
          className='btn btn-primary btn-sm'
        >
          {t('chat.newChat')}
        </button>
      </div>

      {/* Session list (collapsible) */}
      <div className='border-b border-base-300 bg-base-100/30'>
        <button
          type='button'
          onClick={() => setSessionsExpanded((prev) => !prev)}
          className='btn btn-ghost w-full justify-between px-5 py-2.5'
        >
          <span>{t('chat.conversations', { count: sessions.length })}</span>
          <ChevronDown
            size={16}
            strokeWidth={2}
            className={`transition-transform ${sessionsExpanded ? 'rotate-180' : ''}`}
            aria-hidden='true'
          />
        </button>

        {sessionsExpanded && (
          <div className='px-4 pb-4 space-y-3'>
            {sessionsError && <div className='alert alert-error text-xs'>{sessionsError}</div>}
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
              onRename={handleRenameSession}
            />
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className='flex-1 overflow-y-auto p-4 space-y-4'>
        {messages.length === 0 ? (
          <div className='h-full flex flex-col items-center justify-center text-center px-4'>
            <div className='w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-4'>
              <MessageSquare size={24} strokeWidth={2} aria-hidden='true' />
            </div>
            <p className='text-base-content/90 font-medium mb-1'>{t('chat.emptyTitle')}</p>
            <p className='text-sm text-base-content/50 max-w-xs'>{t('chat.emptyBody')}</p>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessageItem key={message.id} message={message} isStreaming={isStreaming} t={t} />
          ))
        )}
      </div>

      {/* Input */}
      <div className='border-t border-base-300 bg-base-100/60 p-4'>
        {error && <div className='alert alert-error text-xs'>{error}</div>}

        <div className='flex items-end gap-3'>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.inputPlaceholder')}
            disabled={isStreaming}
            rows={1}
            className='flex-1 min-h-[44px] max-h-40 textarea textarea-bordered resize-none overflow-hidden'
          />
          <button
            type='button'
            onClick={() => void handleSubmit()}
            disabled={isStreaming || input.trim() === ''}
            className='btn btn-primary btn-circle hover:scale-[1.02] active:scale-[0.98]'
            aria-label={t('chat.sendAria')}
          >
            {isStreaming ? (
              <span className='loading loading-spinner loading-sm text-white' />
            ) : (
              <Send size={18} strokeWidth={2} aria-hidden='true' />
            )}
          </button>
        </div>
        <p className='mt-2 text-[11px] text-base-content/40'>{t('chat.sendHint')}</p>
      </div>
    </div>
  )
}
