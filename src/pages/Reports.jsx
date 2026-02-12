import { useEffect, useState } from 'react'
import TopNav from '../components/TopNav'
import { fetchPauses } from '../services/apiReports'
import { listAgents, listSectors } from '../services/apiAdmin'
import { getPauseTypes } from '../services/apiPauses'
import { exportCsv, exportPdf, exportXlsx } from '../utils/export'
import { formatDateTime, formatDuration, formatInputDate, startOfMonth } from '../utils/format'

export default function Reports() {
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [sectors, setSectors] = useState([])
  const [fromDate, setFromDate] = useState(formatInputDate(startOfMonth()))
  const [toDate, setToDate] = useState(formatInputDate(new Date()))
  const [agentId, setAgentId] = useState('')
  const [pauseTypeId, setPauseTypeId] = useState('')
  const [sectorId, setSectorId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exportOpen, setExportOpen] = useState(false)

  const resetFilters = () => {
    setFromDate(formatInputDate(startOfMonth()))
    setToDate(formatInputDate(new Date()))
    setAgentId('')
    setPauseTypeId('')
    setSectorId('')
    setExportOpen(false)
  }

  useEffect(() => {
    const init = async () => {
      try {
        const [agentsData, typesData, sectorsData] = await Promise.all([
          listAgents(),
          getPauseTypes(false),
          listSectors()
        ])
        setAgents(agentsData)
        setPauseTypes(typesData)
        setSectors(sectorsData)
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
        pauseTypeId: pauseTypeId || null,
        sectorId: sectorId || null
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
  }, [fromDate, toDate, agentId, pauseTypeId, sectorId])

  const formatLimit = (minutes) => {
    if (minutes === null || minutes === undefined) return ''
    const safeMinutes = Math.max(0, Number(minutes))
    const hours = String(Math.floor(safeMinutes / 60)).padStart(2, '0')
    const mins = String(safeMinutes % 60).padStart(2, '0')
    return `${hours}:${mins}`
  }

  const handleExport = (format) => {
    if (!rows.length) return
    const sectorMap = new Map(sectors.map((sector) => [sector.id, sector.label]))
    const mapped = rows.map((row) => ({
      agente: row.profiles?.full_name,
      setor: sectorMap.get(row.profiles?.team_id) || '',
      tipo: row.pause_types?.label,
      tempo_limite: formatLimit(row.pause_types?.limit_minutes),
      inicio: formatDateTime(row.started_at),
      fim: formatDateTime(row.ended_at),
      duracao: formatDuration(row.duration_seconds || 0),
      atraso: row.atraso ? 'Sim' : 'Nao',
      notas: row.notes || ''
    }))

    const baseName = `relatorio-pausas-${fromDate}-a-${toDate}`
    if (format === 'csv') exportCsv(mapped, `${baseName}.csv`)
    if (format === 'xlsx') exportXlsx(mapped, `${baseName}.xlsx`)
    if (format === 'pdf') exportPdf(mapped, `${baseName}.pdf`, 'Relatorio de Pausas')
    setExportOpen(false)
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="px-6 pb-10 space-y-6">
        {error ? (
          <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : null}

        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-slate-900">Relatorios</h2>
            <button type="button" className="btn-ghost" onClick={resetFilters}>
              Limpar filtros
            </button>
          </div>
          <p className="text-sm text-slate-600 mt-1">Exporte por periodo, agente, tipo e setor.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-6">
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
            <div className="flex items-end">
              <div className="w-full">
                <button
                  className="btn-primary w-full"
                  onClick={() => setExportOpen((prev) => !prev)}
                  disabled={!rows.length || loading}
                >
                  Exportar
                </button>
                {exportOpen ? (
                  <div className="mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
                    <button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => handleExport('csv')}>
                      CSV
                    </button>
                    <button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => handleExport('xlsx')}>
                      XLSX
                    </button>
                    <button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => handleExport('pdf')}>
                      PDF
                    </button>
                  </div>
                ) : null}
              </div>
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
                  <tr
                    key={row.id}
                    className={`border-t border-slate-100 ${row.atraso ? 'bg-amber-50' : ''}`}
                  >
                    <td className="py-2">{row.profiles?.full_name}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.pause_types?.label}</span>
                        {row.atraso ? <span className="chip bg-amber-100 text-amber-700">Atraso</span> : null}
                      </div>
                    </td>
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
