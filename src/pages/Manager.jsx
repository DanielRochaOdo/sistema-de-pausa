import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import { listDashboard, getPauseTypes, listPauseSchedules, upsertPauseSchedule, deletePauseSchedule } from '../services/apiPauses'
import { listAgents, listSectors } from '../services/apiAdmin'
import { formatDuration, formatInputDate, startOfMonth, startOfToday, startOfWeek } from '../utils/format'
import { useAuth } from '../contexts/useAuth'

const minutesToTime = (minutes) => {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return ''
  const safeMinutes = Math.max(0, Number(minutes))
  const hours = String(Math.floor(safeMinutes / 60)).padStart(2, '0')
  const mins = String(safeMinutes % 60).padStart(2, '0')
  return `${hours}:${mins}`
}

const timeToMinutes = (value) => {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

const normalizeTime = (value) => {
  if (!value) return ''
  return value.slice(0, 5)
}

export default function Manager() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'ADMIN'
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [sectors, setSectors] = useState([])
  const [dashboard, setDashboard] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [scheduleBusy, setScheduleBusy] = useState(false)

  const [period, setPeriod] = useState('week')
  const [fromDate, setFromDate] = useState(formatInputDate(startOfWeek()))
  const [toDate, setToDate] = useState(formatInputDate(new Date()))
  const [agentId, setAgentId] = useState('')
  const [pauseTypeId, setPauseTypeId] = useState('')
  const [sectorId, setSectorId] = useState('')
  const [scheduleForm, setScheduleForm] = useState({
    agent_id: '',
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })

  const resetFilters = () => {
    setPeriod('week')
    setFromDate(formatInputDate(startOfWeek()))
    setToDate(formatInputDate(new Date()))
    setAgentId('')
    setPauseTypeId('')
    setSectorId('')
  }

  const loadSchedules = async () => {
    setScheduleError('')
    try {
      const data = await listPauseSchedules()
      setPauseSchedules(data || [])
    } catch (err) {
      setScheduleError(err.message || 'Falha ao carregar pausas programadas')
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const [agentsData, typesData, sectorsData] = await Promise.all([
          listAgents(),
          getPauseTypes(false),
          isAdmin ? listSectors() : Promise.resolve([])
        ])
        setAgents(agentsData)
        setPauseTypes(typesData)
        setSectors(sectorsData)
        await loadSchedules()
      } catch (err) {
        console.error(err)
      }
    }
    init()
  }, [isAdmin])

  useEffect(() => {
    if (period === 'today') {
      setFromDate(formatInputDate(startOfToday()))
      setToDate(formatInputDate(new Date()))
    }
    if (period === 'week') {
      setFromDate(formatInputDate(startOfWeek()))
      setToDate(formatInputDate(new Date()))
    }
    if (period === 'month') {
      setFromDate(formatInputDate(startOfMonth()))
      setToDate(formatInputDate(new Date()))
    }
  }, [period])

  const loadDashboard = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listDashboard({
        from: fromDate,
        to: toDate,
        agentId: agentId || null,
        pauseTypeId: pauseTypeId || null,
        sectorId: isAdmin ? sectorId || null : null
      })
      setDashboard(data || [])
    } catch (err) {
      setError(err.message || 'Falha ao carregar dashboard')
    } finally {
      setLoading(false)
    }
  }

  const handleScheduleCreate = async () => {
    if (!scheduleForm.agent_id || !scheduleForm.pause_type_id || !scheduleForm.scheduled_time) {
      setScheduleError('Preencha agente, tipo e horario da pausa.')
      return
    }
    setScheduleError('')
    setScheduleBusy(true)
    try {
      await upsertPauseSchedule({
        agent_id: scheduleForm.agent_id,
        pause_type_id: scheduleForm.pause_type_id,
        scheduled_time: scheduleForm.scheduled_time,
        duration_minutes: timeToMinutes(scheduleForm.duration_time)
      })
      setScheduleForm({ agent_id: '', pause_type_id: '', scheduled_time: '', duration_time: '' })
      await loadSchedules()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao salvar pausa programada')
    } finally {
      setScheduleBusy(false)
    }
  }

  const handleScheduleUpdate = async (schedule) => {
    if (!schedule?.agent_id || !schedule?.pause_type_id || !schedule?.scheduled_time) {
      setScheduleError('Preencha agente, tipo e horario da pausa.')
      return
    }
    setScheduleError('')
    setScheduleBusy(true)
    try {
      await upsertPauseSchedule({
        agent_id: schedule.agent_id,
        pause_type_id: schedule.pause_type_id,
        scheduled_time: schedule.scheduled_time,
        duration_minutes: schedule.duration_minutes ?? null
      })
      await loadSchedules()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao atualizar pausa programada')
    } finally {
      setScheduleBusy(false)
    }
  }

  const handleScheduleDelete = async (schedule) => {
    if (!schedule?.id) return
    setScheduleError('')
    setScheduleBusy(true)
    try {
      await deletePauseSchedule(schedule.id)
      await loadSchedules()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao remover pausa programada')
    } finally {
      setScheduleBusy(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [fromDate, toDate, agentId, pauseTypeId, sectorId])

  const summary = useMemo(() => {
    const map = new Map()
    const totals = { pauses: 0, duration: 0 }

    dashboard.forEach((row) => {
      const id = row.agent_id
      if (!map.has(id)) {
        map.set(id, {
          agent_id: id,
          agent_name: row.agent_name,
          total_pauses: 0,
          total_duration_seconds: 0,
          types: {}
        })
      }

      const record = map.get(id)
      record.total_pauses += row.total_pauses
      record.total_duration_seconds += row.total_duration_seconds
      record.types[row.pause_type_code] = {
        pauses: row.total_pauses,
        duration: row.total_duration_seconds
      }

      totals.pauses += row.total_pauses
      totals.duration += row.total_duration_seconds
    })

    return { rows: Array.from(map.values()), totals }
  }, [dashboard])

  const ranking = useMemo(() => {
    return [...summary.rows]
      .sort((a, b) => b.total_duration_seconds - a.total_duration_seconds)
      .slice(0, 5)
  }, [summary.rows])

  const updateScheduleField = (id, field, value) => {
    setPauseSchedules((prev) =>
      prev.map((schedule) => (schedule.id === id ? { ...schedule, [field]: value } : schedule))
    )
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="px-6 pb-10 space-y-6">
        {error ? (
          <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Total de pausas" value={summary.totals.pauses} />
          <StatCard label="Tempo total" value={formatDuration(summary.totals.duration)} />
          <StatCard label="Agentes" value={summary.rows.length} />
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-slate-900">Filtros</h2>
            <button type="button" className="btn-ghost" onClick={resetFilters}>
              Limpar filtros
            </button>
          </div>
          <div className={`mt-4 grid gap-4 ${isAdmin ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
            <div>
              <label className="label">Periodo</label>
              <select className="input mt-1" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="today">Hoje</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="label">De</label>
              <input
                type="date"
                className="input mt-1"
                value={fromDate}
                disabled={period !== 'custom'}
                onChange={(e) => {
                  setPeriod('custom')
                  setFromDate(e.target.value)
                }}
              />
            </div>
            <div>
              <label className="label">Ate</label>
              <input
                type="date"
                className="input mt-1"
                value={toDate}
                disabled={period !== 'custom'}
                onChange={(e) => {
                  setPeriod('custom')
                  setToDate(e.target.value)
                }}
              />
            </div>
            <div>
              <label className="label">Agente</label>
              <select className="input mt-1" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Todos</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input mt-1" value={pauseTypeId} onChange={(e) => setPauseTypeId(e.target.value)}>
                <option value="">Todos</option>
                {pauseTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            {isAdmin ? (
              <div>
                <label className="label">Setor</label>
                <select className="input mt-1" value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
                  <option value="">Todos</option>
                  {sectors.map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <div className="card">
            <h2 className="font-display text-xl font-semibold text-slate-900">Pausas programadas</h2>
            <p className="text-sm text-slate-600 mt-1">
              Se o tempo nao for definido, usa o limite configurado em tipos de pausa.
            </p>
            {scheduleError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {scheduleError}
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              <div>
                <label className="label">Agente</label>
                <select
                  className="input mt-1"
                  value={scheduleForm.agent_id}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, agent_id: e.target.value }))}
                >
                  <option value="">Selecione</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Tipo de pausa</label>
                <select
                  className="input mt-1"
                  value={scheduleForm.pause_type_id}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, pause_type_id: e.target.value }))}
                >
                  <option value="">Selecione</option>
                  {pauseTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Horario da pausa</label>
                <input
                  className="input mt-1"
                  type="time"
                  step="60"
                  value={scheduleForm.scheduled_time}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, scheduled_time: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Duracao (hh:mm)</label>
                <input
                  className="input mt-1"
                  type="time"
                  step="60"
                  value={scheduleForm.duration_time}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, duration_time: e.target.value }))}
                />
              </div>
              <button className="btn-primary w-full" type="button" onClick={handleScheduleCreate} disabled={scheduleBusy}>
                {scheduleBusy ? 'Salvando...' : 'Salvar pausa'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 className="font-display text-xl font-semibold text-slate-900">Agenda atual</h2>
            <p className="text-sm text-slate-600 mt-1">
              Para mudar agente ou tipo, remova e crie novamente.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-2">Agente</th>
                    <th className="text-left py-2">Tipo</th>
                    <th className="text-left py-2">Horario</th>
                    <th className="text-left py-2">Duracao</th>
                    <th className="text-left py-2">Acoes</th>
                  </tr>
                </thead>
                <tbody className="text-slate-900">
                  {pauseSchedules.map((schedule) => (
                    <tr key={schedule.id} className="border-t border-slate-100">
                      <td className="py-2">{schedule.profiles?.full_name || '-'}</td>
                      <td className="py-2">{schedule.pause_types?.label || '-'}</td>
                      <td className="py-2">
                        <input
                          className="input"
                          type="time"
                          step="60"
                          value={normalizeTime(schedule.scheduled_time)}
                          onChange={(e) =>
                            updateScheduleField(schedule.id, 'scheduled_time', e.target.value)
                          }
                        />
                      </td>
                      <td className="py-2">
                        <input
                          className="input"
                          type="time"
                          step="60"
                          value={minutesToTime(schedule.duration_minutes)}
                          onChange={(e) =>
                            updateScheduleField(
                              schedule.id,
                              'duration_minutes',
                              timeToMinutes(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => handleScheduleUpdate(schedule)}
                            disabled={scheduleBusy}
                          >
                            Salvar
                          </button>
                          <button
                            className="btn-ghost text-red-600"
                            type="button"
                            onClick={() => handleScheduleDelete(schedule)}
                            disabled={scheduleBusy}
                          >
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!pauseSchedules.length ? (
                    <tr>
                      <td className="py-3 text-slate-500" colSpan="5">
                        Nenhuma pausa programada.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-slate-900">Resumo por agente</h2>
              {loading ? <span className="text-sm text-slate-500">Carregando...</span> : null}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-2">Agente</th>
                    <th className="text-left py-2">Total pausas</th>
                    <th className="text-left py-2">Tempo total</th>
                    {pauseTypes.map((type) => (
                      <th key={type.id} className="text-left py-2">
                        {type.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-slate-900">
                  {summary.rows.map((row) => (
                    <tr key={row.agent_id} className="border-t border-slate-100">
                      <td className="py-2 font-medium">{row.agent_name}</td>
                      <td className="py-2">{row.total_pauses}</td>
                      <td className="py-2">{formatDuration(row.total_duration_seconds)}</td>
                      {pauseTypes.map((type) => (
                        <td key={type.id} className="py-2">
                          {formatDuration(row.types[type.code]?.duration || 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!summary.rows.length ? (
                    <tr>
                      <td className="py-3 text-slate-500" colSpan={3 + pauseTypes.length}>
                        Nenhum dado para o periodo selecionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 className="font-display text-xl font-semibold text-slate-900">Ranking</h2>
            <p className="text-sm text-slate-600 mt-1">Top 5 maior tempo em pausas.</p>
            <div className="mt-4 space-y-3">
              {ranking.map((row, index) => (
                <div key={row.agent_id} className="flex items-center justify-between border border-slate-100 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {index + 1}. {row.agent_name}
                    </p>
                    <p className="text-xs text-slate-500">{row.total_pauses} pausas</p>
                  </div>
                  <span className="text-sm font-medium text-slate-800">
                    {formatDuration(row.total_duration_seconds)}
                  </span>
                </div>
              ))}
              {!ranking.length ? <p className="text-sm text-slate-500">Sem dados.</p> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
