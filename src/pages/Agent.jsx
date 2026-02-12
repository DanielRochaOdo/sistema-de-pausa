import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/useAuth'
import { endPause, getActivePause, getPauseTypes, listRecentPauses, listPauseSchedules, startPause } from '../services/apiPauses'
import { supabase } from '../services/supabaseClient'
import { formatDateTime, formatDuration } from '../utils/format'
import { friendlyError } from '../utils/errors'

const normalizeTime = (value) => {
  if (!value) return '-'
  return value.slice(0, 5)
}

export default function Agent() {
  const { profile } = useAuth()
  const [pauseTypes, setPauseTypes] = useState([])
  const [selectedCode, setSelectedCode] = useState('')
  const [activePause, setActivePause] = useState(null)
  const [recentPauses, setRecentPauses] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(Date.now())

  const loadSchedules = async (userId) => {
    if (!userId) return
    try {
      const schedules = await listPauseSchedules(userId)
      setPauseSchedules(schedules || [])
      setScheduleError('')
    } catch (err) {
      setScheduleError(friendlyError(err, 'Falha ao carregar horarios'))
    }
  }

  const loadAll = async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    try {
      const [types, active, recent, schedules] = await Promise.all([
        getPauseTypes(true),
        getActivePause(profile.id),
        listRecentPauses(profile.id, 7),
        listPauseSchedules(profile.id)
      ])
      setPauseTypes(types)
      setActivePause(active)
      setSelectedCode(types?.[0]?.code || '')
      setRecentPauses(recent)
      setPauseSchedules(schedules || [])
      setScheduleError('')
    } catch (err) {
      if (err?.message?.includes('pause_schedules')) {
        setScheduleError(friendlyError(err, 'Falha ao carregar horarios'))
      } else {
        setError(friendlyError(err, 'Falha ao carregar dados'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase
      .channel(`agent-schedules-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pause_schedules',
          filter: `agent_id=eq.${profile.id}`
        },
        () => {
          loadSchedules(profile.id)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!activePause) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [activePause])

  const elapsedSeconds = useMemo(() => {
    if (!activePause?.started_at) return 0
    return Math.max(0, Math.floor((now - new Date(activePause.started_at).getTime()) / 1000))
  }, [activePause, now])

  const handleStart = async () => {
    setError('')
    if (!selectedCode) {
      setError('Selecione um tipo de pausa.')
      return
    }
    setStarting(true)
    try {
      await startPause(selectedCode)
      await loadAll()
    } catch (err) {
      setError(friendlyError(err, 'Nao foi possivel iniciar a pausa'))
    } finally {
      setStarting(false)
    }
  }

  const handleEnd = async () => {
    setError('')
    setEnding(true)
    try {
      await endPause(notes)
      setNotes('')
      await loadAll()
    } catch (err) {
      setError(friendlyError(err, 'Nao foi possivel encerrar a pausa'))
    } finally {
      setEnding(false)
    }
  }

  const activeLabel = activePause?.pause_types?.label || 'Em pausa'

  return (
    <div className="min-h-screen">
      <TopNav
        agentControls={
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Controle de pausa</p>
              <p className="text-xs text-slate-600">{activePause ? activeLabel : 'Pronto para iniciar'}</p>
            </div>
            {!activePause ? (
              <div className="flex items-center gap-2">
                <select
                  className="input h-10"
                  value={selectedCode}
                  onChange={(event) => setSelectedCode(event.target.value)}
                  disabled={loading}
                >
                  {pauseTypes.map((type) => (
                    <option key={type.id} value={type.code}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-primary h-10 whitespace-nowrap"
                  onClick={handleStart}
                  disabled={starting || loading}
                >
                  {starting ? 'Iniciando...' : 'Iniciar pausa'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  className="input h-10 min-w-[200px]"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Notas (opcional)"
                />
                <button className="btn-secondary h-10 whitespace-nowrap" onClick={handleEnd} disabled={ending}>
                  {ending ? 'Encerrando...' : 'Encerrar pausa'}
                </button>
              </div>
            )}
          </div>
        }
      />
      <div className="px-6 pb-10 space-y-6">
        {error ? (
          <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Status" value={activePause ? 'Em pausa' : 'Disponivel'} sub={activeLabel} />
          <StatCard label="Tempo atual" value={formatDuration(elapsedSeconds)} sub="Atualizado em tempo real" />
          <StatCard label="Ultimos 7 dias" value={`${recentPauses.length} pausas`} sub="Registradas" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <div className="card">
            <h2 className="font-display text-xl font-semibold text-slate-900">Horarios de pausa</h2>
            <p className="text-sm text-slate-600 mt-1">Agenda definida pelo gerente.</p>

            {scheduleError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {scheduleError}
              </div>
            ) : null}

            {loading ? (
              <p className="text-sm text-slate-500 mt-4">Carregando...</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-2">Tipo</th>
                      <th className="text-left py-2">Horario</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-900">
                    {pauseSchedules.map((schedule) => (
                      <tr key={schedule.id} className="border-t border-slate-100">
                        <td className="py-2">{schedule.pause_types?.label}</td>
                        <td className="py-2">{normalizeTime(schedule.scheduled_time)}</td>
                      </tr>
                    ))}
                    {!pauseSchedules.length ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan="2">
                          Nenhuma pausa programada.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="font-display text-xl font-semibold text-slate-900">Historico recente</h2>
            <p className="text-sm text-slate-600 mt-1">Ultimas pausas dos ultimos 7 dias.</p>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-2">Tipo</th>
                    <th className="text-left py-2">Inicio</th>
                    <th className="text-left py-2">Fim</th>
                    <th className="text-left py-2">Duracao</th>
                  </tr>
                </thead>
                <tbody className="text-slate-900">
                  {recentPauses.map((pause) => (
                    <tr key={pause.id} className="border-t border-slate-100">
                      <td className="py-2">{pause.pause_types?.label}</td>
                      <td className="py-2">{formatDateTime(pause.started_at)}</td>
                      <td className="py-2">{formatDateTime(pause.ended_at)}</td>
                      <td className="py-2">{formatDuration(pause.duration_seconds || 0)}</td>
                    </tr>
                  ))}
                  {!recentPauses.length ? (
                    <tr>
                      <td className="py-3 text-slate-500" colSpan="4">
                        Nenhuma pausa registrada recentemente.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
