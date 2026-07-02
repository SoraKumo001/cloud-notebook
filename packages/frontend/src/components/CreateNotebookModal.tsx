import { X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export interface CreateNotebookFormData {
  title: string
  description: string
}

interface CreateNotebookModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateNotebookFormData) => void
  isSubmitting: boolean
}

export function CreateNotebookModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: CreateNotebookModalProps) {
  const { t } = useTranslation('common')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setTouched(false)
    }
  }, [isOpen])

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen && !isSubmitting) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose])

  if (!isOpen) return null

  const isTitleEmpty = title.trim() === ''
  const showError = touched && isTitleEmpty

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)

    if (isTitleEmpty) return

    onSubmit({ title: title.trim(), description: description.trim() })
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isSubmitting) {
      onClose()
    }
  }

  return (
    <div
      className='modal modal-open'
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      role='dialog'
      aria-modal='true'
      aria-labelledby='create-notebook-title'
    >
      <div className='modal-box max-w-md overflow-hidden'>
        <div className='px-6 py-5 border-b border-base-300 bg-base-200 flex items-center justify-between'>
          <h2 id='create-notebook-title' className='text-lg font-semibold text-base-content'>
            {t('createNotebook.title')}
          </h2>
          <button
            type='button'
            onClick={onClose}
            disabled={isSubmitting}
            className='btn btn-ghost btn-circle'
            aria-label={t('common.close')}
          >
            <X size={20} strokeWidth={2} aria-hidden='true' />
          </button>
        </div>

        <form onSubmit={handleSubmit} className='p-6 space-y-5'>
          <div className='space-y-2'>
            <label
              htmlFor='notebook-title'
              className='block text-sm font-medium text-base-content/70'
            >
              {t('createNotebook.titleLabel')} <span className='text-secondary'>*</span>
            </label>
            <input
              id='notebook-title'
              type='text'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t('createNotebook.titlePlaceholder')}
              disabled={isSubmitting}
              className={`w-full input input-bordered ${showError ? 'border-error' : ''}`}
            />
            {showError && (
              <p className='text-xs text-error'>{t('errors.validation.titleRequired')}</p>
            )}
          </div>

          <div className='space-y-2'>
            <label
              htmlFor='notebook-description'
              className='block text-sm font-medium text-base-content/70'
            >
              {t('createNotebook.descriptionLabel')}
            </label>
            <textarea
              id='notebook-description'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('createNotebook.descriptionPlaceholder')}
              disabled={isSubmitting}
              rows={3}
              className='w-full textarea textarea-bordered resize-none'
            />
          </div>

          <div className='flex items-center justify-end gap-3 pt-2'>
            <button
              type='button'
              onClick={onClose}
              disabled={isSubmitting}
              className='btn btn-ghost'
            >
              {t('common.cancel')}
            </button>
            <button
              type='submit'
              disabled={isSubmitting || isTitleEmpty}
              className='btn btn-primary'
            >
              {isSubmitting ? (
                <>
                  <span className='loading loading-spinner loading-sm text-white' />
                  {t('common.creating')}
                </>
              ) : (
                t('createNotebook.submit')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
