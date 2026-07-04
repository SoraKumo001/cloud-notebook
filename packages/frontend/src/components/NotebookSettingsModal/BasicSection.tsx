import { useTranslation } from 'react-i18next'

interface BasicSectionProps {
  title: string
  setTitle: (v: string) => void
  description: string
  setDescription: (v: string) => void
  isSaving: boolean
}

function sectionTitle(title: string) {
  return (
    <h3 className='text-sm font-semibold text-base-content/90 uppercase tracking-wider'>{title}</h3>
  )
}

export function BasicSection({
  title,
  setTitle,
  description,
  setDescription,
  isSaving,
}: BasicSectionProps) {
  const { t } = useTranslation('common')

  return (
    <div className='space-y-4'>
      {sectionTitle(t('notebookSettings.sectionBasic'))}
      <div className='space-y-2'>
        <label htmlFor='settings-title' className='block text-sm font-medium text-base-content/70'>
          {t('createNotebook.titleLabel')}
        </label>
        <input
          id='settings-title'
          type='text'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSaving}
          className='w-full input input-bordered rounded-xl'
        />
      </div>
      <div className='space-y-2'>
        <label
          htmlFor='settings-description'
          className='block text-sm font-medium text-base-content/70'
        >
          {t('createNotebook.descriptionLabel')}
        </label>
        <textarea
          id='settings-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSaving}
          rows={3}
          className='w-full textarea textarea-bordered resize-none rounded-xl'
        />
      </div>
    </div>
  )
}
