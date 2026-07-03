import { BookOpen } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/Button'

export interface CitationChunk {
  id: string
  sourceName: string
  pageNumber?: number
  score: number
}

interface CitationChipProps {
  index: number
  chunk?: CitationChunk
  invalid?: boolean
}

export function CitationChip({ index, chunk, invalid }: CitationChipProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = React.useState(false)
  const popoverRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  return (
    <span ref={popoverRef} className='dropdown dropdown-top'>
      <Button
        type='button'
        size='xs'
        tabIndex={0}
        iconLeft={BookOpen}
        onClick={() => setOpen((prev) => !prev)}
        className={`${
          invalid
            ? 'btn-disabled line-through'
            : 'btn-ghost bg-secondary/15 border-secondary/30 text-secondary hover:bg-secondary/25'
        }`}
      >
        [{index}]
      </Button>

      {open && chunk && (
        <div className='dropdown-content z-20 mb-2 w-56 rounded-xl bg-base-100 border border-base-300 shadow-xl shadow-black/40 p-3'>
          <div className='space-y-1.5'>
            <p className='text-xs font-medium text-base-content truncate'>{chunk.sourceName}</p>
            {typeof chunk.pageNumber === 'number' && (
              <p className='text-xs text-base-content/70'>
                {t('citation.page', { n: chunk.pageNumber })}
              </p>
            )}
            <p className='text-xs text-base-content/50'>
              {t('citation.score', { percent: (chunk.score * 100).toFixed(1) })}
            </p>
          </div>
          <div className='absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-base-100 border-r border-b border-base-300 rotate-45' />
        </div>
      )}
    </span>
  )
}
