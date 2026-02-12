import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { getLatePausesSummary, markAllLatePausesAsRead } from '../services/apiPauses'
import { supabase } from '../services/supabaseClient'
import { formatDateTime, formatDuration, startOfToday } from '../utils/format'

export default function TopNav({ agentControls }) {
  const { profile, signOut } = useAuth()
  const [latePauses, setLatePauses] = useState([])
  const [lateCount, setLateCount] = useState(0)
  const [bellOpen, setBellOpen] = useState(false)

  const showAgent = profile?.role === 'AGENTE'
  const showManager = profile?.role === 'GERENTE' || profile?.role === 'ADMIN'
  const showAdmin = profile?.role === 'ADMIN'
  const showBell = profile?.role === 'GERENTE'

  const loadLatePauses = async () => {
    try {
      const { items, count } = await getLatePausesSummary({ fromDate: startOfToday(), limit: 5 })
      setLatePauses(items)
      setLateCount(count)
    } catch (err) {
      console.error('[notifications] failed to load late pauses', err?.message || err, err?.details || '')
    }
  }

  useEffect(() => {
    if (!showBell) return
    loadLatePauses()
  }, [showBell])

  useEffect(() => {
    if (!showBell || !profile?.id) return
    const channel = supabase
      .channel(`late-pauses-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pause_notifications',
          filter: `manager_id=eq.${profile.id}`
        },
        () => {
          loadLatePauses()
        }
      )
      .subscribe()

    const pausesChannel = supabase
      .channel(`late-pauses-updates-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pauses',
          filter: 'atraso=eq.true'
        },
        (payload) => {
          if (payload?.new?.ended_at) {
            loadLatePauses()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(pausesChannel)
    }
  }, [showBell, profile?.id])

  useEffect(() => {
    if (!bellOpen || !showBell) return
    loadLatePauses()
  }, [bellOpen, showBell])

  useEffect(() => {
    if (!showBell) return
    const interval = setInterval(() => {
      loadLatePauses()
    }, 15000)
    return () => clearInterval(interval)
  }, [showBell])

  const handleMarkAllAsRead = async () => {
    try {
      await markAllLatePausesAsRead({ fromDate: startOfToday() })
      await loadLatePauses()
    } catch (err) {
      console.error('[notifications] failed to mark all as read', err)
    }
  }

  return (
    <div className="px-6 py-5">
      <div className="card">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Controle de Pausas</p>
            <h1 className="font-display text-2xl font-semibold text-slate-900">Olá, {profile?.full_name || '...'}</h1>
            <span className="chip mt-2">{profile?.role || 'Sem role'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showAgent ? (
              <div className="flex flex-wrap items-center gap-2">
                {agentControls ? agentControls : null}
                <NavLink
                  to="/agent"
                  className={({ isActive }) =>
                    `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                  }
                >
                  Minha pausa
                </NavLink>
              </div>
            ) : null}
            {showManager ? (
              <div className="flex items-center gap-2">
                <NavLink
                  to="/manager"
                  className={({ isActive }) =>
                    `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                  }
                >
                  Dashboard
                </NavLink>
                {showBell ? (
                  <button
                    type="button"
                    className="btn-ghost relative h-10 w-10 px-0"
                    onClick={() => setBellOpen((prev) => !prev)}
                  >
                    <span className="sr-only">Notificacoes</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M15 17H9c-1.1 0-2-.9-2-2V10a5 5 0 1110 0v5c0 1.1-.9 2-2 2z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M13.73 21a2 2 0 01-3.46 0"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {lateCount > 0 ? (
                      <span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">
                        {lateCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
              </div>
            ) : null}
            {showManager ? (
              <NavLink
                to="/reports"
                className={({ isActive }) =>
                  `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                }
              >
                Relatorios
              </NavLink>
            ) : null}
            {showAdmin ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                }
              >
                Admin
              </NavLink>
            ) : null}
            <button type="button" onClick={signOut} className="btn-secondary h-10">
              Sair
            </button>
          </div>
        </div>

        {showBell && bellOpen ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Atrasos de pausa</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{lateCount} hoje</span>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={handleMarkAllAsRead}
                  disabled={!lateCount}
                >
                  Marcar todas como lidas
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {latePauses.map((pause) => (
                <div key={pause.pause_id} className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-2">
                  <p className="text-xs font-semibold text-slate-900">
                    {pause.agent_name} - {pause.pause_type_label}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {formatDuration(pause.duration_seconds || 0)} • {formatDateTime(pause.ended_at)}
                  </p>
                </div>
              ))}
              {!latePauses.length ? <p className="text-xs text-slate-500">Sem atrasos hoje.</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
