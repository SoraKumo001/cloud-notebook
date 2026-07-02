import { Link } from '@tanstack/react-router'
import { BookOpen, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatLongDate } from '../i18n/formatters'
import { useLocale } from '../i18n/useLocale'

export interface Notebook {
  id: string
  title: string
  description: string | null
  sourceCount?: number
  updatedAt?: string
  created_at?: string
  [key: string]: unknown
}

interface NotebookCardProps {
  notebook: Notebook
}

export function NotebookCard({ notebook }: NotebookCardProps) {
  const { t } = useTranslation('common')
  const { locale } = useLocale()
  return (
    <Link
      to='/notebooks/$notebookId'
      params={{ notebookId: notebook.id }}
      className='card card-border bg-base-100 group block p-6 hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-1'
    >
      <div className='flex items-start justify-between gap-4 mb-4'>
        <div className='w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-teal-500/20 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:text-teal-300 transition-colors'>
          <BookOpen size={20} strokeWidth={2} aria-hidden='true' />
        </div>
        <span className='badge badge-ghost'>
          {t(
            notebook.sourceCount === 1
              ? 'notebookCard.sourceCountOne'
              : 'notebookCard.sourceCountOther',
            { count: notebook.sourceCount ?? 0 },
          )}
        </span>
      </div>

      <h3 className='text-lg font-semibold text-base-content mb-2 line-clamp-1 group-hover:text-secondary transition-colors'>
        {notebook.title}
      </h3>

      {notebook.description ? (
        <p className='text-sm text-base-content/60 line-clamp-2 mb-4 leading-relaxed'>
          {notebook.description}
        </p>
      ) : (
        <p className='text-sm text-base-content/50 italic line-clamp-2 mb-4'>
          {t('notebookCard.noDescription')}
        </p>
      )}

      <div className='flex items-center text-xs text-base-content/50 group-hover:text-base-content/60 transition-colors'>
        <Clock size={14} strokeWidth={2} className='mr-1.5' aria-hidden='true' />
        {t('notebookList.updated', {
          date: formatLongDate(
            locale,
            notebook.updatedAt ?? notebook.created_at ?? new Date().toISOString(),
          ),
        })}
      </div>
    </Link>
  )
}
