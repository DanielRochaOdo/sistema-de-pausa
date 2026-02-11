import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'

export default function Login() {
  const { session, profile, loading, signIn, signOut, refreshProfile, error } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && session && profile?.role) {
      if (profile.role === 'ADMIN') navigate('/admin', { replace: true })
      if (profile.role === 'GERENTE') navigate('/manager', { replace: true })
      if (profile.role === 'AGENTE') navigate('/agent', { replace: true })
    }
  }, [session, profile, loading, navigate])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLocalError('')
    setBusy(true)
    try {
      await signIn(identifier, password)
    } catch (err) {
      setLocalError(err.message || 'Falha no login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card animate-fade-in">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Controle de Pausas</p>
        <h1 className="font-display text-3xl font-semibold text-slate-900 mt-2">Bem-vindo de volta</h1>
        <p className="text-sm text-slate-600 mt-2">Entre com seu e-mail ou nome completo para registrar suas pausas.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="label">Email ou nome completo</label>
            <input
              className="input mt-1"
              type="text"
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <input
              className="input mt-1"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {session && !loading && !profile?.role ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              Seu perfil ainda nao foi criado. Contate o admin ou aguarde a sincronizacao.
              <button type="button" className="btn-ghost w-full mt-2" onClick={refreshProfile}>
                Recarregar perfil
              </button>
            </div>
          ) : null}

          {(localError || error) ? (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {localError || error}
            </div>
          ) : null}

          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? 'Entrando...' : 'Entrar'}
          </button>

          {session ? (
            <button className="btn-ghost w-full" type="button" onClick={signOut} disabled={busy}>
              Sair da sessao
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
