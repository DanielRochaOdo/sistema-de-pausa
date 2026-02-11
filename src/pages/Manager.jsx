import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import { listDashboard, getPauseTypes } from '../services/apiPauses'
import { listAgents } from '../services/apiAdmin'
import { formatDuration, formatInputDate, startOfMonth, startOfToday, startOfWeek } from '../utils/format'

export default function Manager() {
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [dashboard, setDashboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [period, setPeriod] = useState('week')
  const [fromDate, setFromDate] = useState(formatInputDate(startOfWeek()))
  const [toDate, setToDate] = useState(formatInputDate(new Date()))
  const [agentId, setAgentId] = useState('')
  const [pauseTypeId, setPauseTypeId] = useState('')

  useEffect(() => {
    const init = async () => {
      try {
        const [agentsData, typesData] = await Promise.all([listAgents(), getPauseTypes(false)])
        setAgents(agentsData)
        setPauseTypes(typesData)
      } catch (err) {
        console.error(err)
      }
    }
    init()
  }, [])

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
        pauseTypeId: pauseTypeId || null
      })
      setDashboard(data || [])
    } catch (err) {
      setError(err.message || 'Falha ao carregar dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [fromDate, toDate, agentId, pauseTypeId])

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
          <StatCard label="Agentes monitorados" value={summary.rows.length} />
        </div>

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-slate-900">Filtros</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-5">
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