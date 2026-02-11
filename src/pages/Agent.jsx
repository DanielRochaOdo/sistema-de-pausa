import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/AuthContext'
import { endPause, getActivePause, getPauseTypes, listRecentPauses, startPause } from '../services/apiPauses'
import { formatDateTime, formatDuration } from '../utils/format'
import { friendlyError } from '../utils/errors'

export default function Agent() {
  const { profile } = useAuth()
  const [pauseTypes, setPauseTypes] = useState([])
  const [selectedCode, setSelectedCode] = useState('')
  const [activePause, setActivePause] = useState(null)
  const [recentPauses, setRecentPauses] = useState([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(Date.now())

  const loadAll = async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    try {
      const [types, active, recent] = await Promise.all([
        getPauseTypes(true),
        getActivePause(profile.id),
        listRecentPauses(profile.id, 7)
      ])
      setPauseTypes(types)
      setActivePause(active)
      setSelectedCode(types?.[0]?.code || '')
      setRecentPauses(recent)
    } catch (err) {
      setError(friendlyError(err, 'Falha ao carregar dados'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
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
      <TopNav />
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
            <h2 className="font-display text-xl font-semibold text-slate-900">Controle de pausa</h2>
            <p className="text-sm text-slate-600 mt-1">
              Inicie e encerre sua pausa com um clique. O contador continua mesmo se a tela for recarregada.
            </p>

            {loading ? (
              <p className="text-sm text-slate-500 mt-4">Carregando...</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="label">Tipo de pausa</label>
                  <select
                    className="input mt-1"
                    value={selectedCode}
                    onChange={(event) => setSelectedCode(event.target.value)}
                    disabled={!!activePause}
                  >
                    {pauseTypes.map((type) => (
                      <option key={type.id} value={type.code}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {activePause ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-brand-700">Pausa ativa</p>
                      <p className="mt-1 font-semibold text-brand-900">{activeLabel}</p>
                      <p className="text-sm text-brand-800">Inicio: {formatDateTime(activePause.started_at)}</p>
                    </div>
                    <div>
                      <label className="label">Notas</label>
                      <textarea
                        className="input mt-1 min-h-[96px]"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Opcional: registre algum detalhe sobre a pausa."
                      />
                    </div>
                    <button className="btn-secondary w-full" onClick={handleEnd} disabled={ending}>
                      {ending ? 'Encerrando...' : 'Encerrar pausa'}
                    </button>
                  </div>
                ) : (
                  <button className="btn-primary w-full" onClick={handleStart} disabled={starting}>
                    {starting ? 'Iniciando...' : 'Iniciar pausa'}
                  </button>
                )}
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