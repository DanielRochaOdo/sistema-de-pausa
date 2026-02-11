import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import Loading from './Loading'

export default function RoleRedirect() {
  const { session, profile, loading } = useAuth()

  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" replace />

  switch (profile?.role) {
    case 'ADMIN':
      return <Navigate to="/admin" replace />
    case 'GERENTE':
      return <Navigate to="/manager" replace />
    case 'AGENTE':
      return <Navigate to="/agent" replace />
    default:
      return <Navigate to="/unauthorized" replace />
  }
}