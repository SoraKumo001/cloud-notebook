import { Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/Button'

export default function NotFound() {
  const { t } = useTranslation('common')
  return (
    <div className='min-h-screen bg-base-200 text-base-content flex flex-col items-center justify-center font-sans px-6'>
      <div className='max-w-md text-center space-y-6'>
        <div
          className='text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-teal-400'
          aria-hidden='true'
        >
          404
        </div>
        <h1 className='text-2xl font-semibold text-base-content/90'>{t('notFound.title')}</h1>
        <p className='text-base-content/60 leading-relaxed'>{t('notFound.body')}</p>
        <Button as='link' to='/' variant='primary' iconLeft={Home}>
          {t('notFound.goHome')}
        </Button>
      </div>
    </div>
  )
}
