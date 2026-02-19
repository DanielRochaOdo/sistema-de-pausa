import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import { useAuth } from '../contexts/useAuth'
import { fetchPauses } from '../services/apiReports'
import { listAgents, listManagerSectors, listSectors } from '../services/apiAdmin'
import { getPauseTypes, listPauseSchedules } from '../services/apiPauses'
import { exportCsv, exportPdf, exportXlsx } from '../utils/export'
import { formatDateTime, formatDuration, formatInputDate, startOfMonth } from '../utils/format'

export default function Reports({ adminMode = false }) {
  const { profile } = useAuth()
  const isManager = profile?.role === 'GERENTE'
  const restrictScope = isManager && !adminMode
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [sectors, setSectors] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])
  const [managerSectorIds, setManagerSectorIds] = useState([])
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
    if (restrictScope && !profile?.id) return
    const init = async () => {
      try {
        const requests = [
          listAgents(),
          getPauseTypes(false),
          listSectors(),
          listPauseSchedules()
        ]
        if (restrictScope) {
          requests.push(listManagerSectors())
        }
        const results = await Promise.all(requests)
        const [agentsData, typesData, sectorsData, schedulesData] = results
        const managerSectorsData = restrictScope ? results[4] : []
        setAgents(agentsData)
        setPauseTypes(typesData)
        setSectors(sectorsData)
        setPauseSchedules(schedulesData || [])
        if (restrictScope) {
          const ownSectors = (managerSectorsData || [])
            .filter((row) => row.manager_id === profile?.id)
            .map((row) => row.sector_id)
            .filter(Boolean)
          const fallback = profile?.team_id ? [profile.team_id] : []
          const nextIds = ownSectors.length ? ownSectors : fallback
          setManagerSectorIds(Array.from(new Set(nextIds)))
        } else {
          setManagerSectorIds([])
        }
      } catch (err) {
        console.error(err)
      }
    }
    init()
  }, [restrictScope, profile?.id, profile?.team_id])

  const allowedSectorIds = useMemo(() => {
    if (!restrictScope) return []
    if (managerSectorIds.length) return managerSectorIds
    const fallback = agents
      .filter((agent) => agent.manager_id === profile?.id)
      .map((agent) => agent.team_id)
      .filter(Boolean)
    return Array.from(new Set(fallback))
  }, [restrictScope, managerSectorIds, agents, profile?.id])

  const scopedAgents = useMemo(() => {
    if (!restrictScope) return agents
    if (!profile?.id) return []
    const allowedSectors = new Set(allowedSectorIds)
    return agents.filter(
      (agent) =>
        agent.manager_id === profile.id || (agent.team_id && allowedSectors.has(agent.team_id))
    )
  }, [agents, restrictScope, allowedSectorIds, profile?.id])

  const scopedSectors = useMemo(() => {
    if (!restrictScope) return sectors
    const allowed = new Set(allowedSectorIds)
    return sectors.filter((sector) => allowed.has(sector.id))
  }, [sectors, restrictScope, allowedSectorIds])

  const scopedAgentIds = useMemo(() => scopedAgents.map((agent) => agent.id), [scopedAgents])
  const visibleAgents = useMemo(
    () => (restrictScope ? scopedAgents : agents),
    [restrictScope, scopedAgents, agents]
  )
  const visibleSectors = useMemo(
    () => (restrictScope ? scopedSectors : sectors),
    [restrictScope, scopedSectors, sectors]
  )

  const loadReport = async () => {
    setLoading(true)
    setError('')
    try {
      if (restrictScope && !scopedAgentIds.length) {
        setRows([])
        return
      }
      if (restrictScope && agentId && !scopedAgentIds.includes(agentId)) {
        setRows([])
        return
      }
      if (restrictScope && sectorId && !allowedSectorIds.includes(sectorId)) {
        setRows([])
        return
      }
      const allowedAgentIds = restrictScope && !agentId ? scopedAgentIds : null
      const data = await fetchPauses({
        from: fromDate,
        to: toDate,
        agentId: agentId || null,
        pauseTypeId: pauseTypeId || null,
        sectorId: sectorId || null,
        agentIds: allowedAgentIds
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
  }, [fromDate, toDate, agentId, pauseTypeId, sectorId, restrictScope, scopedAgentIds, allowedSectorIds])

  useEffect(() => {
    if (!restrictScope) return
    if (agentId && !scopedAgentIds.includes(agentId)) {
      setAgentId('')
    }
  }, [restrictScope, agentId, scopedAgentIds])

  useEffect(() => {
    if (!restrictScope) return
    if (sectorId && !allowedSectorIds.includes(sectorId)) {
      setSectorId('')
    }
  }, [restrictScope, sectorId, allowedSectorIds])

  const formatLimit = (minutes) => {
    if (minutes === null || minutes === undefined) return ''
    const safeMinutes = Math.max(0, Number(minutes))
    const hours = String(Math.floor(safeMinutes / 60)).padStart(2, '0')
    const mins = String(safeMinutes % 60).padStart(2, '0')
    return `${hours}:${mins}`
  }

  const scopedPauseSchedules = useMemo(() => {
    if (!restrictScope) return pauseSchedules
    if (!scopedAgentIds.length) return []
    const allowed = new Set(scopedAgentIds)
    return (pauseSchedules || []).filter((schedule) => allowed.has(schedule.agent_id))
  }, [pauseSchedules, restrictScope, scopedAgentIds])

  const scheduleMinutesByKey = useMemo(() => {
    const map = new Map()
    ;(scopedPauseSchedules || []).forEach((schedule) => {
      const key = `${schedule.agent_id}:${schedule.pause_type_id}`
      const time = schedule.scheduled_time
      if (!time) return
      const [h, m] = String(time).split(':').map(Number)
      if (Number.isNaN(h) || Number.isNaN(m)) return
      const minutes = h * 60 + m
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(minutes)
    })
    map.forEach((list) => list.sort((a, b) => a - b))
    return map
  }, [scopedPauseSchedules])

  const getToleranceStatus = (row) => {
    if (row.atraso) return 'Atraso'
    const tolStart = row.pause_types?.tolerance_start_minutes ?? null
    const tolEnd = row.pause_types?.tolerance_end_minutes ?? null
    if ((!tolStart || tolStart <= 0) && (!tolEnd || tolEnd <= 0)) return 'OK'

    const key = `${row.agent_id}:${row.pause_type_id}`
    const scheduleMinutes = scheduleMinutesByKey.get(key) || []
    if (!scheduleMinutes.length) return 'OK'

    const toMinutesOfDay = (value) => {
      if (!value) return null
      const date = new Date(value)
      return date.getHours() * 60 + date.getMinutes()
    }

    const minDiff = (minutes) => {
      if (minutes === null) return null
      let best = null
      scheduleMinutes.forEach((scheduleMinute) => {
        const diff = Math.abs(minutes - scheduleMinute)
        if (best === null || diff < best) best = diff
      })
      return best
    }

    const startDiff = minDiff(toMinutesOfDay(row.started_at))
    const endDiff = minDiff(toMinutesOfDay(row.ended_at))
    const withinStart = tolStart && startDiff !== null && startDiff <= tolStart
    const withinEnd = tolEnd && endDiff !== null && endDiff <= tolEnd
    if (withinStart || withinEnd) return 'Tolerancia'
    return 'OK'
  }

  const rowsWithStatus = useMemo(() => {
    return rows.map((row) => ({ ...row, status: getToleranceStatus(row) }))
  }, [rows, scheduleMinutesByKey])

  const handleExport = (format) => {
    if (!rowsWithStatus.length) return
    const sectorMap = new Map(visibleSectors.map((sector) => [sector.id, sector.label]))
    const mapped = rowsWithStatus.map((row) => ({
      agente: row.profiles?.full_name,
      setor: sectorMap.get(row.profiles?.team_id) || '',
      tipo: row.pause_types?.label,
      tempo_limite: formatLimit(row.pause_types?.limit_minutes),
      inicio: formatDateTime(row.started_at),
      fim: formatDateTime(row.ended_at),
      duracao: formatDuration(row.duration_seconds || 0),
      atraso: row.status === 'Atraso' ? 'Atraso' : row.status === 'Tolerancia' ? 'Tolerancia' : 'Nao'
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
                {visibleAgents.map((agent) => (
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
                {visibleSectors.map((sector) => (
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
                  disabled={!rowsWithStatus.length || loading}
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
            <span className="text-sm text-slate-500">{rowsWithStatus.length} registros</span>
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
                {rowsWithStatus.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-slate-100 ${row.status === 'Atraso' ? 'bg-amber-50' : row.status === 'Tolerancia' ? 'bg-blue-50' : ''}`}
                  >
                    <td className="py-2">{row.profiles?.full_name}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.pause_types?.label}</span>
                        {row.status !== 'OK' ? (
                          <span
                            className={`chip ${row.status === 'Atraso' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}
                          >
                            {row.status === 'Atraso' ? 'Atraso' : 'Tolerancia'}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2">{formatDateTime(row.started_at)}</td>
                    <td className="py-2">{formatDateTime(row.ended_at)}</td>
                    <td className="py-2">{formatDuration(row.duration_seconds || 0)}</td>
                  </tr>
                ))}
                {!rowsWithStatus.length ? (
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
