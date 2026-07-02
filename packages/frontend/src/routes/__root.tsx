import { createRootRoute, Outlet } from '@tanstack/react-router'
import '../styles.css'
import NotFound from '../components/NotFound'
import { AuthProvider } from '../contexts/AuthContext'
import { LanguageSwitcher } from '../i18n/components/LanguageSwitcher'
import { I18nProvider } from '../i18n/I18nProvider'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent() {
  return (
    <I18nProvider>
      <div className='navbar bg-base-100 border-b border-base-300 min-h-0 h-10 px-4'>
        <div className='flex-1' />
        <div className='flex-none'>
          <LanguageSwitcher />
        </div>
      </div>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </I18nProvider>
  )
}
