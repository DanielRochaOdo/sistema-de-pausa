import { useEffect, useState } from 'react'
import TopNav from '../components/TopNav'
import { fetchPauses } from '../services/apiReports'
import { listAgents } from '../services/apiAdmin'
import { getPauseTypes } from '../services/apiPauses'
import { downloadCsv, toCsv } from '../utils/csv'
import { formatDateTime, formatDuration, formatInputDate, startOfMonth } from '../utils/format'

export default function Reports() {
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [fromDate, setFromDate] = useState(formatInputDate(startOfMonth()))
  const [toDate, setToDate] = useState(formatInputDate(new Date()))
  const [agentId, setAgentId] = useState('')
  const [pauseTypeId, setPauseTypeId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  const loadReport = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchPauses({
        from: fromDate,
        to: toDate,
        agentId: agentId || null,
        pauseTypeId: pauseTypeId || null
      })
      setRows(data || [])
    } catch (err) {
      setError(err.message || 'Falha ao carregar relatorio')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
  }, [fromDate, toDate, agentId, pauseTypeId])

  const handleExport = () => {
    if (!rows.length) return
    const mapped = rows.map((row) => ({
      agente: row.profiles?.full_name,
      tipo: row.pause_types?.label,
      inicio: formatDateTime(row.started_at),
      fim: formatDateTime(row.ended_at),
      duracao: formatDuration(row.duration_seconds || 0),
      notas: row.notes || ''
    }))

    const csv = toCsv(mapped)
    downloadCsv(csv, `relatorio-pausas-${fromDate}-a-${toDate}.csv`)
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="px-6 pb-10 space-y-6">
        {error ? (
          <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : null}

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-slate-900">Relatorios</h2>
          <p className="text-sm text-slate-600 mt-1">Exporte CSV por periodo, agente e tipo.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-5">
            <div>
              <label className="label">De</label>
              <input className="input mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Ate</label>
              <input className="input mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
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
            <div className="flex items-end">
              <button className="btn-primary w-full" onClick={handleExport} disabled={!rows.length || loading}>
                Baixar CSV
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-slate-900">Preview</h3>
            <span className="text-sm text-slate-500">{rows.length} registros</span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left py-2">Agente</th>
                  <th className="text-left py-2">Tipo</th>
                  <th className="text-left py-2">Inicio</th>
                  <th className="text-left py-2">Fim</th>
                  <th className="text-left py-2">Duracao</th>
                </tr>
              </thead>
              <tbody className="text-slate-900">
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2">{row.profiles?.full_name}</td>
                    <td className="py-2">{row.pause_types?.label}</td>
                    <td className="py-2">{formatDateTime(row.started_at)}</td>
                    <td className="py-2">{formatDateTime(row.ended_at)}</td>
                    <td className="py-2">{formatDuration(row.duration_seconds || 0)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan="5">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}