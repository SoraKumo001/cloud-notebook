import { createRootRoute, Outlet } from '@tanstack/react-router'
import '../styles.css'
import NotFound from '../components/NotFound'
import { AuthProvider } from '../contexts/AuthContext'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}
