import { createRootRoute, Outlet } from '@tanstack/react-router'
import '../styles.css'
import NotFound from '../components/NotFound'
import { AuthProvider } from '../contexts/AuthContext'
import { I18nProvider } from '../i18n/I18nProvider'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </I18nProvider>
  )
}
