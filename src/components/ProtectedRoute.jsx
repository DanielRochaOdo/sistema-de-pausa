import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import Loading from './Loading'

function ProfileMissing({ onRetry, onSignOut }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Perfil ausente</p>
        <h1 className="font-display text-2xl font-semibold text-slate-900 mt-2">Perfil nao encontrado</h1>
        <p className="text-sm text-slate-600 mt-2">
          Nao foi possivel localizar seu perfil. Clique em recarregar ou saia e entre novamente.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button className="btn-primary" type="button" onClick={onRetry}>
            Recarregar perfil
          </button>
          <button className="btn-ghost" type="button" onClick={onSignOut}>
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}

function AuthError({ message, onRetry, onSignOut }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg text-center border-red-200 bg-red-50 text-red-700">
        <p className="text-xs uppercase tracking-[0.25em] text-red-500">Erro de autenticacao</p>
        <h1 className="font-display text-2xl font-semibold mt-2">Nao foi possivel validar sua sessao</h1>
        <p className="text-sm mt-2">{message || 'Tente sair e entrar novamente.'}</p>
        <div className="mt-6 flex flex-col gap-2">
          <button className="btn-primary" type="button" onClick={onRetry}>
            Tentar novamente
          </button>
          <button className="btn-secondary" type="button" onClick={onSignOut}>
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}

function SlowConnection({ onRetry }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Conexao lenta</p>
        <h1 className="font-display text-2xl font-semibold text-slate-900 mt-2">Ainda carregando...</h1>
        <p className="text-sm text-slate-600 mt-2">
          Sua conexao esta lenta. Aguarde mais alguns segundos ou tente novamente.
        </p>
        <button className="btn-primary mt-6" type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    </div>
  )
}

export default function ProtectedRoute({ allowedRoles, children }) {
  const {
    session,
    profile,
    loading,
    profileLoading,
    profileFetched,
    slowSession,
    slowProfile,
    error,
    refreshProfile,
    signOut,
    retry
  } = useAuth()

  useEffect(() => {
    if (session && profileFetched && !profile) {
      refreshProfile()
    }
  }, [session, profileFetched, profile, refreshProfile])

  if (error) {
    return <AuthError message={error} onRetry={retry} onSignOut={signOut} />
  }

  if (slowSession || slowProfile) {
    return <SlowConnection onRetry={retry} />
  }

  if (loading || profileLoading) return <Loading />
  if (!session) return <Navigate to="/login" replace />

  if (profileFetched && !profile) {
    return <ProfileMissing onRetry={refreshProfile} onSignOut={signOut} />
  }

  if (allowedRoles && profile?.role && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return children
}