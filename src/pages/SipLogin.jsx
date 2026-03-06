import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { startSipSession } from '../services/apiSip'

const friendlySipError = (message) => {
  const value = String(message || '')
  if (/agent_without_queue/i.test(value)) {
    return 'Seu usuario SIP nao esta vinculado a nenhuma fila ativa.'
  }
  if (/missing_extension/i.test(value)) {
    return 'Informe o ramal SIP.'
  }
  if (/not_allowed/i.test(value)) {
    return 'Este acesso nao possui permissao para o modulo SIP.'
  }
  return value || 'Falha no login SIP'
}

export default function SipLogin({ mode = 'agent' }) {
  const navigate = useNavigate()
  const { session, profile, loading, signIn, signOut, error } = useAuth()

  const config = useMemo(() => {
    if (mode === 'manager') {
      return {
        role: 'GESTOR_SIP',
        title: 'Login Gestor SIP',
        subtitle: 'Acesse o painel SIP para criar filas, agentes e acompanhar operacao.',
        cta: 'Entrar no Gestor SIP',
        redirectTo: '/sip/manager',
        requireExtension: false
      }
    }

    return {
      role: 'AGENTE_SIP',
      title: 'Login Agente SIP',
      subtitle: 'Entre com nome/email, senha e ramal SIP para operar atendimento.',
      cta: 'Entrar no Agente SIP',
      redirectTo: '/sip/agent',
      requireExtension: true
    }
  }, [mode])

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [extension, setExtension] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!loading && session && profile?.role) {
      if (profile.role === config.role) {
        navigate(config.redirectTo, { replace: true })
        return
      }

      if (profile.role === 'ADMIN') navigate('/admin', { replace: true })
      if (profile.role === 'GERENTE') navigate('/manager', { replace: true })
      if (profile.role === 'AGENTE') navigate('/agent', { replace: true })
      if (profile.role === 'AGENTE_SIP') navigate('/sip/agent', { replace: true })
      if (profile.role === 'GESTOR_SIP') navigate('/sip/manager', { replace: true })
    }
  }, [config.redirectTo, config.role, loading, navigate, profile?.role, session])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setLocalError('')

    try {
      const normalizedExtension = String(extension || '').trim()
      if (config.requireExtension && !normalizedExtension) {
        throw new Error('Informe o ramal SIP')
      }

      await signIn(identifier, password, { expectedRoles: [config.role] })

      if (config.requireExtension) {
        await startSipSession(normalizedExtension, typeof navigator !== 'undefined' ? navigator.userAgent : null)
      }

      navigate(config.redirectTo, { replace: true })
    } catch (err) {
      const message = friendlySipError(err?.message || err)
      setLocalError(message)
      if (session) {
        try {
          await signOut()
        } catch (_) {
          // ignore logout errors
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50">
      <div className="w-full max-w-md card animate-fade-in">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Controle SIP</p>
        <h1 className="font-display text-3xl font-semibold text-slate-900 mt-2">{config.title}</h1>
        <p className="text-sm text-slate-600 mt-2">{config.subtitle}</p>

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

          {config.requireExtension ? (
            <div>
              <label className="label">Ramal SIP</label>
              <input
                className="input mt-1"
                type="text"
                required
                value={extension}
                onChange={(event) => setExtension(event.target.value)}
                placeholder="Ex: 203"
              />
            </div>
          ) : null}

          {(localError || error) ? (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {localError || error}
            </div>
          ) : null}

          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? 'Entrando...' : config.cta}
          </button>
        </form>

        <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <p>
            Se voce precisa do sistema padrao de pausas, acesse{' '}
            <Link className="text-brand-700 underline" to="/login">
              login comum
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
