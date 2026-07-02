import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { t } = useTranslation('common')
  return (
    <div className='min-h-screen bg-base-200 text-base-content flex flex-col font-sans'>
      {/* Header */}
      <header className='border-b border-base-300 bg-base-100/50 backdrop-blur-md sticky top-0 z-50'>
        <div className='max-w-7xl mx-auto px-6 h-16 flex items-center justify-between'>
          <div className='flex items-center space-x-3'>
            <div className='w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-teal-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20'>
              N
            </div>
            <span className='font-semibold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-base-content to-base-content/60'>
              {t('app.name')}
            </span>
          </div>
          <div className='flex items-center space-x-4'>
            <Link to='/notebooks' className='btn btn-neutral'>
              {t('common.signIn')}
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className='flex-1 max-w-7xl w-full mx-auto px-6 py-12 flex flex-col items-center justify-center text-center'>
        <div className='max-w-3xl space-y-8'>
          <div className='inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-semibold tracking-wide uppercase'>
            <span>{t('landing.cfBadge')}</span>
          </div>

          <h1 className='text-5xl md:text-6xl font-extrabold tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-r from-base-content via-base-content/90 to-secondary'>
            {t('app.tagline')}
          </h1>

          <p className='text-lg md:text-xl text-base-content/60 max-w-2xl mx-auto font-normal leading-relaxed'>
            {t('landing.heroBody')}
          </p>

          <div className='flex flex-col sm:flex-row items-center justify-center gap-4 pt-4'>
            <Link to='/notebooks' className='btn btn-primary'>
              {t('landing.cta')}
            </Link>
          </div>
        </div>

        {/* Feature Grid */}
        <section className='grid grid-cols-1 md:grid-cols-3 gap-8 mt-24 w-full'>
          <div className='card card-border bg-base-100/30 border-base-200 p-8 text-left space-y-4 transition-all'>
            <div className='w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-xl font-bold'>
              📚
            </div>
            <h3 className='text-xl font-semibold text-base-content/90'>
              {t('landing.featureMultimodalTitle')}
            </h3>
            <p className='text-base-content/60 text-sm leading-relaxed'>
              {t('landing.featureMultimodalBody')}
            </p>
          </div>
          <div className='card card-border bg-base-100/30 border-base-200 p-8 text-left space-y-4 transition-all'>
            <div className='w-12 h-12 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center text-xl font-bold'>
              💬
            </div>
            <h3 className='text-xl font-semibold text-base-content/90'>
              {t('landing.featureSmartTitle')}
            </h3>
            <p className='text-base-content/60 text-sm leading-relaxed'>
              {t('landing.featureSmartBody')}
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className='border-t border-base-300 py-8 text-center text-sm text-base-content/40'>
        <p>{t('app.footer', { year: new Date().getFullYear() })}</p>
      </footer>
    </div>
  )
}
