import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import RoleRedirect from './components/RoleRedirect'
import Login from './pages/Login'
import SipLogin from './pages/SipLogin'
import Agent from './pages/Agent'
import Manager from './pages/Manager'
import Reports from './pages/Reports'
import Admin from './pages/Admin'
import SipAgent from './pages/SipAgent'
import SipManager from './pages/SipManager'
import Unauthorized from './pages/Unauthorized'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<RoleRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/login/sip-agent" element={<SipLogin mode="agent" />} />
        <Route path="/login/sip-manager" element={<SipLogin mode="manager" />} />
        <Route
          path="/agent"
          element={
            <ProtectedRoute allowedRoles={['AGENTE', 'AGENTE_SIP']}>
              <Agent />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sip/agent"
          element={
            <ProtectedRoute allowedRoles={['AGENTE_SIP']}>
              <SipAgent />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sip/manager"
          element={
            <ProtectedRoute allowedRoles={['GESTOR_SIP']}>
              <SipManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/manager"
          element={
            <ProtectedRoute allowedRoles={['GERENTE', 'ADMIN']}>
              <Manager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute allowedRoles={['GERENTE', 'ADMIN']}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <Reports adminMode />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <Admin />
            </ProtectedRoute>
          }
        />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  )
}
