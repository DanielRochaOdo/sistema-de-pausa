import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import { listDashboard, getPauseTypes, listPauseSchedules, upsertPauseSchedule, deletePauseSchedule, listActivePauses } from '../services/apiPauses'
import { listAgents, listManagerSectors, listSectors } from '../services/apiAdmin'
import { listAgentLogins, listAgentLoginHistory, listActiveAgentSessions } from '../services/apiSessions'
import { exportCsv, exportPdf, exportXlsx } from '../utils/export'
import { formatDuration, formatInputDate, startOfMonth, startOfToday, startOfWeek } from '../utils/format'
import { useAuth } from '../contexts/useAuth'
import { supabase } from '../services/supabaseClient'

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
  const [tab, setTab] = useState('dashboard')
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [sectors, setSectors] = useState([])
  const [dashboard, setDashboard] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [logins, setLogins] = useState([])
  const [loginsError, setLoginsError] = useState('')
  const [loginsLoading, setLoginsLoading] = useState(false)
  const [loginsNow, setLoginsNow] = useState(Date.now())
  const [loginsFetchedAt, setLoginsFetchedAt] = useState(Date.now())
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyPage, setHistoryPage] = useState(0)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyExportOpen, setHistoryExportOpen] = useState(false)
  const [historyExporting, setHistoryExporting] = useState(false)
  const [activeSessions, setActiveSessions] = useState([])
  const [activeSessionsLoading, setActiveSessionsLoading] = useState(false)
  const [activePauses, setActivePauses] = useState([])
  const [activePausesLoading, setActivePausesLoading] = useState(false)
  const [agentsModalOpen, setAgentsModalOpen] = useState(false)
  const [loggedModalOpen, setLoggedModalOpen] = useState(false)
  const [pausedModalOpen, setPausedModalOpen] = useState(false)

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
  const [managerSectorIds, setManagerSectorIds] = useState([])
  const [expandedSectorId, setExpandedSectorId] = useState('')
  const [scheduleView, setScheduleView] = useState('sectors')
  const [agentModalOpen, setAgentModalOpen] = useState(false)
  const [agentModalId, setAgentModalId] = useState('')
  const [agentModalName, setAgentModalName] = useState('')
  const [agentModalScheduleForm, setAgentModalScheduleForm] = useState({
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })

  const requiresScheduleTime = (pauseTypeId) => {
    const type = pauseTypes.find((item) => item.id === pauseTypeId)
    return type?.code !== 'BANHEIRO'
  }

  const resetFilters = () => {
    setPeriod('week')
    setFromDate(formatInputDate(startOfWeek()))
    setToDate(formatInputDate(new Date()))
    setAgentId('')
    setPauseTypeId('')
    setSectorId('')
  }

  const loadLogins = async () => {
    setLoginsLoading(true)
    setLoginsError('')
    try {
      const data = await listAgentLogins()
      setLogins(data || [])
      setLoginsFetchedAt(Date.now())
    } catch (err) {
      setLoginsError(err.message || 'Falha ao carregar logins')
    } finally {
      setLoginsLoading(false)
    }
  }

  const HISTORY_PAGE_SIZE = 30

  const loadHistory = async (agent, page = 0) => {
    if (!agent?.agent_id) return
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const data = await listAgentLoginHistory(agent.agent_id, {
        limit: HISTORY_PAGE_SIZE,
        offset: page * HISTORY_PAGE_SIZE
      })
      setHistory(data || [])
      setHistoryHasMore((data || []).length === HISTORY_PAGE_SIZE)
    } catch (err) {
      setHistoryError(err.message || 'Falha ao carregar historico')
    } finally {
      setHistoryLoading(false)
    }
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

  const loadActiveSessions = async () => {
    setActiveSessionsLoading(true)
    try {
      const data = await listActiveAgentSessions()
      setActiveSessions(data || [])
    } catch (err) {
      console.error('[manager] failed to load active sessions', err)
    } finally {
      setActiveSessionsLoading(false)
    }
  }

  const loadActivePauses = async () => {
    setActivePausesLoading(true)
    try {
      const data = await listActivePauses()
      setActivePauses(data || [])
    } catch (err) {
      console.error('[manager] failed to load active pauses', err)
    } finally {
      setActivePausesLoading(false)
    }
  }

  useEffect(() => {
    if (!profile?.id) return
    const init = async () => {
      try {
        const requests = [listAgents(), getPauseTypes(false), listSectors()]
        if (!isAdmin) requests.push(listManagerSectors())
        const results = await Promise.all(requests)
        const agentsData = results[0]
        const typesData = results[1]
        const sectorsData = results[2]
        const managerSectorsData = results[3] || []

        setAgents(agentsData)
        setPauseTypes(typesData)

        setSectors(sectorsData)
        if (isAdmin) {
          setManagerSectorIds([])
        } else {
          const linkedIds = managerSectorsData
            .filter((row) => row.manager_id === profile.id)
            .map((row) => row.sector_id)
          setManagerSectorIds(linkedIds)
        }

        await loadSchedules()
        await Promise.all([loadActiveSessions(), loadActivePauses()])
      } catch (err) {
        console.error(err)
      }
    }
    init()
  }, [isAdmin, profile?.id])

  useEffect(() => {
    if (!profile?.id) return

    loadActiveSessions()
    loadActivePauses()

    const sessionsChannel = supabase
      .channel(`manager-active-sessions-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_sessions' },
        () => loadActiveSessions()
      )
      .subscribe()

    const pausesChannel = supabase
      .channel(`manager-active-pauses-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pauses' },
        () => loadActivePauses()
      )
      .subscribe()

    const interval = setInterval(() => {
      loadActiveSessions()
      loadActivePauses()
    }, 30000)

    return () => {
      clearInterval(interval)
      supabase.removeChannel(sessionsChannel)
      supabase.removeChannel(pausesChannel)
    }
  }, [profile?.id])

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
        sectorId: sectorId || null
      })
      setDashboard(data || [])
    } catch (err) {
      setError(err.message || 'Falha ao carregar dashboard')
    } finally {
      setLoading(false)
    }
  }

  const handleScheduleCreate = async () => {
    const needsTime = requiresScheduleTime(scheduleForm.pause_type_id)
    if (!scheduleForm.agent_id || !scheduleForm.pause_type_id || (needsTime && !scheduleForm.scheduled_time)) {
      setScheduleError('Preencha agente e tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setScheduleError('')
    setScheduleBusy(true)
    try {
      const scheduledTime = needsTime ? scheduleForm.scheduled_time : scheduleForm.scheduled_time || null
      await upsertPauseSchedule({
        agent_id: scheduleForm.agent_id,
        pause_type_id: scheduleForm.pause_type_id,
        scheduled_time: scheduledTime,
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
    const needsTime = requiresScheduleTime(schedule?.pause_type_id)
    if (!schedule?.agent_id || !schedule?.pause_type_id || (needsTime && !schedule?.scheduled_time)) {
      setScheduleError('Preencha agente e tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setScheduleError('')
    setScheduleBusy(true)
    try {
      const scheduledTime = needsTime ? schedule.scheduled_time : schedule.scheduled_time || null
      await upsertPauseSchedule({
        id: schedule.id,
        agent_id: schedule.agent_id,
        pause_type_id: schedule.pause_type_id,
        scheduled_time: scheduledTime,
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

  useEffect(() => {
    if (tab !== 'logins') return
    loadLogins()
    setSelectedAgent(null)
    setHistory([])
    setHistoryPage(0)
    setHistoryHasMore(false)
    setHistoryExportOpen(false)
  }, [tab])

  useEffect(() => {
    if (tab !== 'logins') return
    const interval = setInterval(() => setLoginsNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [tab])

  useEffect(() => {
    if (tab !== 'logins') return
    const interval = setInterval(() => {
      loadLogins()
    }, 30000)
    return () => clearInterval(interval)
  }, [tab])

  const managerSectorScope = useMemo(() => {
    if (isAdmin) return []
    const ids = (managerSectorIds || []).filter(Boolean)
    if (ids.length) return ids
    if (profile?.team_id) return [profile.team_id]
    return []
  }, [isAdmin, managerSectorIds, profile?.team_id])

  const scopedAgents = useMemo(() => {
    if (isAdmin) return agents
    const managerId = profile?.id
    if (!managerSectorScope.length && !managerId) return []
    return agents.filter((agent) => {
      const inSector =
        managerSectorScope.length && agent.team_id && managerSectorScope.includes(agent.team_id)
      const managedById = managerId && agent.manager_id === managerId
      return inSector || managedById
    })
  }, [agents, isAdmin, managerSectorScope, profile?.id])

  const scopedAgentIds = useMemo(() => new Set(scopedAgents.map((agent) => agent.id)), [scopedAgents])

  const scopedLogins = useMemo(() => {
    if (isAdmin) return logins
    if (!scopedAgentIds.size) return []
    return logins.filter((item) => scopedAgentIds.has(item.agent_id))
  }, [isAdmin, logins, scopedAgentIds])

  const scopedDashboard = useMemo(() => {
    if (isAdmin) return dashboard
    if (!scopedAgentIds.size) return []
    return dashboard.filter((row) => scopedAgentIds.has(row.agent_id))
  }, [dashboard, isAdmin, scopedAgentIds])

  const scopedPauseSchedules = useMemo(() => {
    if (isAdmin) return pauseSchedules
    if (!scopedAgentIds.size) return []
    return pauseSchedules.filter((schedule) =>
      scopedAgentIds.has(schedule.agent_id || schedule.profiles?.id)
    )
  }, [pauseSchedules, isAdmin, scopedAgentIds])

  const summary = useMemo(() => {
    const map = new Map()
    const totals = { pauses: 0, duration: 0 }

    scopedDashboard.forEach((row) => {
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
  }, [scopedDashboard])

  const schedulesByAgent = useMemo(() => {
    const map = new Map()
    scopedPauseSchedules.forEach((schedule) => {
      const key = schedule.agent_id || schedule.profiles?.id
      if (!key) return
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(schedule)
    })
    map.forEach((items) => {
      items.sort((a, b) =>
        String(a.scheduled_time || '99:99:99').localeCompare(String(b.scheduled_time || '99:99:99'))
      )
    })
    return map
  }, [scopedPauseSchedules])

  const agentsBySector = useMemo(() => {
    const map = {}
    scopedAgents.forEach((agent) => {
      if (!agent.team_id) return
      if (!map[agent.team_id]) map[agent.team_id] = []
      map[agent.team_id].push(agent)
    })
    Object.values(map).forEach((list) => {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    })
    return map
  }, [scopedAgents])

  const scopedSectors = useMemo(() => {
    if (isAdmin) return sectors
    if (!managerSectorScope.length) return []
    return sectors.filter((sector) => managerSectorScope.includes(sector.id))
  }, [isAdmin, sectors, managerSectorScope])

  useEffect(() => {
    if (sectorId && !scopedSectors.find((sector) => sector.id === sectorId)) {
      setSectorId('')
    }
  }, [scopedSectors, sectorId])

  useEffect(() => {
    if (agentId && !scopedAgents.find((agent) => agent.id === agentId)) {
      setAgentId('')
    }
  }, [agentId, scopedAgents])

  const visibleSectors = useMemo(() => {
    const sectorIds = new Set(Object.keys(agentsBySector))
    return scopedSectors.filter((sector) => sectorIds.has(sector.id))
  }, [scopedSectors, agentsBySector])

  const sectorById = useMemo(() => {
    const map = new Map()
    sectors.forEach((sector) => {
      map.set(sector.id, sector.label)
    })
    return map
  }, [sectors])

  const sortedAgents = useMemo(() => {
    const list = [...scopedAgents]
    const nextTime = (agentId) => {
      const items = schedulesByAgent.get(agentId) || []
      const withTime = items.find((item) => item.scheduled_time)
      return withTime?.scheduled_time || null
    }
    return list.sort((a, b) => {
      const aTime = nextTime(a.id)
      const bTime = nextTime(b.id)
      if (aTime && bTime) return String(aTime).localeCompare(String(bTime))
      if (aTime) return -1
      if (bTime) return 1
      return a.full_name.localeCompare(b.full_name)
    })
  }, [scopedAgents, schedulesByAgent])

  const ranking = useMemo(() => {
    return [...summary.rows]
      .sort((a, b) => b.total_duration_seconds - a.total_duration_seconds)
      .slice(0, 5)
  }, [summary.rows])

  const formatSessionDuration = (loginAt, logoutAt) => {
    if (!loginAt) return '-'
    const end = logoutAt ? new Date(logoutAt).getTime() : loginsNow
    const start = new Date(loginAt).getTime()
    const seconds = Math.max(0, Math.floor((end - start) / 1000))
    const minutes = Math.floor(seconds / 60)
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mins = String(minutes % 60).padStart(2, '0')
    return `${hours}:${mins}`
  }

  const scopedActiveSessions = useMemo(() => {
    if (isAdmin) return activeSessions
    if (!scopedAgentIds.size) return []
    return activeSessions.filter((session) => scopedAgentIds.has(session.user_id))
  }, [activeSessions, isAdmin, scopedAgentIds])

  const scopedActivePauses = useMemo(() => {
    if (isAdmin) return activePauses
    if (!scopedAgentIds.size) return []
    return activePauses.filter((pause) => scopedAgentIds.has(pause.agent_id))
  }, [activePauses, isAdmin, scopedAgentIds])

  const activeSessionsCount = activeSessionsLoading ? '...' : scopedActiveSessions.length
  const activePausesCount = activePausesLoading ? '...' : scopedActivePauses.length

  const Modal = ({ open, title, onClose, children }) => {
    if (!open) return null
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-display text-lg font-semibold text-slate-900">{title}</h3>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Fechar
            </button>
          </div>
          <div className="mt-4 max-h-[60vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    )
  }

  const handleHistoryExport = async (format) => {
    if (!selectedAgent?.agent_id) return
    setHistoryExporting(true)
    try {
      const data = await listAgentLoginHistory(selectedAgent.agent_id, { limit: 10000, offset: 0 })
      const mapped = (data || []).map((item) => ({
        login: item.login_at ? new Date(item.login_at).toLocaleString('pt-BR') : '-',
        logout: item.logout_at ? new Date(item.logout_at).toLocaleString('pt-BR') : '-',
        sessao: formatSessionDuration(item.login_at, item.logout_at),
        dispositivo:
          item.device_type === 'mobile'
            ? 'Mobile'
            : item.device_type === 'desktop'
              ? 'Desktop'
              : '-'
      }))
      const baseName = `historico-login-${selectedAgent.agent_name || 'agente'}`
      if (format === 'csv') exportCsv(mapped, `${baseName}.csv`)
      if (format === 'xlsx') exportXlsx(mapped, `${baseName}.xlsx`)
      if (format === 'pdf') exportPdf(mapped, `${baseName}.pdf`, 'Historico de Login')
      setHistoryExportOpen(false)
    } catch (err) {
      setHistoryError(err.message || 'Falha ao exportar historico')
    } finally {
      setHistoryExporting(false)
    }
  }

  const formatTotalToday = (totalSeconds, loginAt, logoutAt) => {
    let seconds = Math.max(0, Number(totalSeconds || 0))
    if (loginAt && !logoutAt && loginsFetchedAt) {
      seconds += Math.max(0, Math.floor((loginsNow - loginsFetchedAt) / 1000))
    }
    const minutes = Math.floor(seconds / 60)
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mins = String(minutes % 60).padStart(2, '0')
    return `${hours}:${mins}`
  }

  const updateScheduleField = (id, field, value) => {
    setPauseSchedules((prev) =>
      prev.map((schedule) => (schedule.id === id ? { ...schedule, [field]: value } : schedule))
    )
  }

  const openAgentModal = (agent) => {
    setAgentModalId(agent.id)
    setAgentModalName(agent.full_name || '')
    setAgentModalScheduleForm({
      pause_type_id: pauseTypes?.[0]?.id || '',
      scheduled_time: '',
      duration_time: ''
    })
    setAgentModalOpen(true)
  }

  const closeAgentModal = () => {
    setAgentModalOpen(false)
    setAgentModalId('')
    setAgentModalName('')
  }

  const addAgentSchedule = async () => {
    if (!agentModalId) return
    const needsTime = requiresScheduleTime(agentModalScheduleForm.pause_type_id)
    if (!agentModalScheduleForm.pause_type_id || (needsTime && !agentModalScheduleForm.scheduled_time)) {
      setScheduleError('Preencha tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setScheduleError('')
    setScheduleBusy(true)
    try {
      const scheduledTime = needsTime
        ? agentModalScheduleForm.scheduled_time
        : agentModalScheduleForm.scheduled_time || null
      await upsertPauseSchedule({
        agent_id: agentModalId,
        pause_type_id: agentModalScheduleForm.pause_type_id,
        scheduled_time: scheduledTime,
        duration_minutes: timeToMinutes(agentModalScheduleForm.duration_time)
      })
      setAgentModalScheduleForm((prev) => ({ ...prev, scheduled_time: '', duration_time: '' }))
      await loadSchedules()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao adicionar pausa')
    } finally {
      setScheduleBusy(false)
    }
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="px-6 pb-10 space-y-6">
        {error ? (
          <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : null}

        <div className="flex gap-2">
          <button
            className={`btn ${tab === 'dashboard' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`btn ${tab === 'pauseSchedules' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('pauseSchedules')}
          >
            Pausas programadas
          </button>
          <button
            className={`btn ${tab === 'logins' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('logins')}
          >
            Login de agente
          </button>
        </div>

        {tab === 'logins' ? (
          <div className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-slate-900">Login de agente</h2>
              {loginsLoading ? <span className="text-sm text-slate-500">Carregando...</span> : null}
            </div>
            {loginsError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {loginsError}
              </div>
            ) : null}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-2">Agente</th>
                    <th className="text-left py-2">Login</th>
                    <th className="text-left py-2">Ultimo logout</th>
                    <th className="text-left py-2">Sessao</th>
                    <th className="text-left py-2">Tempo hoje</th>
                    <th className="text-left py-2">Dispositivo</th>
                  </tr>
                </thead>
                <tbody className="text-slate-900">
                  {scopedLogins.map((item) => {
                    const isActive = !!item.login_at && !item.logout_at
                    const isSelected = selectedAgent?.agent_id === item.agent_id
                    return (
                      <tr
                        key={item.agent_id}
                        className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-slate-50' : ''}`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedAgent(null)
                            setHistory([])
                            setHistoryPage(0)
                            setHistoryHasMore(false)
                            setHistoryExportOpen(false)
                            return
                          }
                          setSelectedAgent(item)
                          setHistoryPage(0)
                          setHistoryHasMore(false)
                          setHistoryExportOpen(false)
                          loadHistory(item, 0)
                        }}
                      >
                        <td className="py-2 font-medium">{item.agent_name}</td>
                        <td className="py-2">
                          {item.login_at ? new Date(item.login_at).toLocaleString('pt-BR') : '-'}
                        </td>
                        <td className="py-2">
                          {item.last_logout_at ? new Date(item.last_logout_at).toLocaleString('pt-BR') : '-'}
                        </td>
                        <td className="py-2">
                          <span className="font-medium">
                            {formatSessionDuration(item.login_at, item.logout_at)}
                          </span>
                          {isActive ? <span className="ml-2 text-xs text-emerald-600">Atual</span> : null}
                        </td>
                        <td className="py-2">
                          {formatTotalToday(item.total_today_seconds, item.login_at, item.logout_at)}
                        </td>
                        <td className="py-2">
                          {item.device_type === 'mobile'
                            ? 'Mobile'
                            : item.device_type === 'desktop'
                              ? 'Desktop'
                              : '-'}
                        </td>
                      </tr>
                    )
                  })}
                  {!scopedLogins.length ? (
                    <tr>
                      <td className="py-3 text-slate-500" colSpan="6">
                        Nenhum login registrado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {selectedAgent ? (
              <div className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Historico - {selectedAgent.agent_name}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">Pagina {historyPage + 1}</span>
                    <button
                      className="btn-ghost text-xs"
                      type="button"
                      disabled={historyPage === 0 || historyLoading}
                      onClick={() => {
                        const nextPage = Math.max(0, historyPage - 1)
                        setHistoryPage(nextPage)
                        loadHistory(selectedAgent, nextPage)
                      }}
                    >
                      Anterior
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      type="button"
                      disabled={!historyHasMore || historyLoading}
                      onClick={() => {
                        const nextPage = historyPage + 1
                        setHistoryPage(nextPage)
                        loadHistory(selectedAgent, nextPage)
                      }}
                    >
                      Proxima
                    </button>
                    <div className="relative">
                      <button
                        className="btn-primary"
                        type="button"
                        onClick={() => setHistoryExportOpen((prev) => !prev)}
                        disabled={historyExporting}
                      >
                        {historyExporting ? 'Exportando...' : 'Exportar'}
                      </button>
                      {historyExportOpen ? (
                        <div className="absolute right-0 mt-2 w-40 rounded-xl border border-slate-200 bg-white shadow-lg">
                          <button
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => handleHistoryExport('csv')}
                          >
                            CSV
                          </button>
                          <button
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => handleHistoryExport('xlsx')}
                          >
                            XLSX
                          </button>
                          <button
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => handleHistoryExport('pdf')}
                          >
                            PDF
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {historyLoading ? <span className="text-sm text-slate-500">Carregando...</span> : null}
                  </div>
                </div>
                {historyError ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {historyError}
                  </div>
                ) : null}
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left py-2">Login</th>
                        <th className="text-left py-2">Logout</th>
                        <th className="text-left py-2">Sessao</th>
                        <th className="text-left py-2">Dispositivo</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-900">
                      {history.map((item, index) => {
                        const isActive = !!item.login_at && !item.logout_at
                        return (
                          <tr key={`${selectedAgent.agent_id}-${index}`} className="border-t border-slate-100">
                            <td className="py-2">
                              {item.login_at ? new Date(item.login_at).toLocaleString('pt-BR') : '-'}
                            </td>
                            <td className="py-2">
                              {item.logout_at ? new Date(item.logout_at).toLocaleString('pt-BR') : '-'}
                            </td>
                            <td className="py-2">
                              <span className="font-medium">
                                {formatSessionDuration(item.login_at, item.logout_at)}
                              </span>
                              {isActive ? <span className="ml-2 text-xs text-emerald-600">Atual</span> : null}
                            </td>
                            <td className="py-2">
                              {item.device_type === 'mobile'
                                ? 'Mobile'
                                : item.device_type === 'desktop'
                                  ? 'Desktop'
                                  : '-'}
                            </td>
                          </tr>
                        )
                      })}
                      {!history.length ? (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan="4">
                            Nenhum historico encontrado.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab !== 'dashboard' ? null : (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Agentes"
            value={scopedAgents.length}
            sub="Vinculados ao gerente"
            onClick={() => setAgentsModalOpen(true)}
          />
          <StatCard
            label="Agentes logados"
            value={activeSessionsCount}
            sub="Atualizado em tempo real"
            onClick={() => setLoggedModalOpen(true)}
          />
          <StatCard
            label="Agentes em pausa"
            value={activePausesCount}
            sub="Atualizado em tempo real"
            onClick={() => setPausedModalOpen(true)}
          />
        </div>
        )}

        {tab !== 'dashboard' ? null : (
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
                {scopedAgents.map((agent) => (
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
            {scopedSectors.length ? (
              <div>
                <label className="label">Setor</label>
                <select className="input mt-1" value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
                  <option value="">Todos</option>
                  {scopedSectors.map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>
        )}

        {tab === 'pauseSchedules' ? (
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
                  {scopedAgents.map((agent) => (
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-xl font-semibold text-slate-900">Agenda atual</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Clique no agente para editar as pausas cadastradas.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`btn ${scheduleView === 'agents' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
                  onClick={() => setScheduleView('agents')}
                >
                  Agentes
                </button>
                <button
                  type="button"
                  className={`btn ${scheduleView === 'sectors' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
                  onClick={() => setScheduleView('sectors')}
                >
                  Setores
                </button>
              </div>
            </div>

            {scheduleView === 'agents' ? (
              <div className="mt-4 space-y-3">
                {sortedAgents.map((agent) => {
                  const items = schedulesByAgent.get(agent.id) || []
                  const sectorLabel = sectorById.get(agent.team_id) || 'Sem setor'
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left transition hover:bg-slate-50"
                      onClick={() => openAgentModal(agent)}
                    >
                      <p className="text-sm font-semibold text-slate-900">{agent.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {sectorLabel} • {items.length} pausas registradas
                      </p>
                    </button>
                  )
                })}
                {!scopedAgents.length ? <p className="text-sm text-slate-500">Nenhum agente encontrado.</p> : null}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {visibleSectors.map((sector) => {
                  const items = agentsBySector[sector.id] || []
                  const isOpen = expandedSectorId === sector.id
                  return (
                    <div key={sector.id} className="rounded-xl border border-slate-200">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        onClick={() => setExpandedSectorId(isOpen ? '' : sector.id)}
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{sector.label}</p>
                          <p className="text-xs text-slate-500">{items.length} agentes</p>
                        </div>
                        <span className="text-xs text-slate-500">{isOpen ? 'Fechar' : 'Ver agentes'}</span>
                      </button>
                      {isOpen ? (
                        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                          {items.length ? (
                            <div className="space-y-2">
                              {items.map((agent) => (
                                <button
                                  key={agent.id}
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                                  onClick={() => openAgentModal(agent)}
                                >
                                  <span className="text-sm text-slate-900">{agent.full_name}</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">Nenhum agente neste setor.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {!visibleSectors.length ? <p className="text-sm text-slate-500">Nenhum setor encontrado.</p> : null}
              </div>
            )}
          </div>
        </div>
        ) : null}

        {tab !== 'dashboard' ? null : (
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
        )}
      </div>

      {agentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Pausas do agente {agentModalName || ''}
              </h3>
              <button type="button" className="btn-ghost" onClick={closeAgentModal}>
                Fechar
              </button>
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-semibold text-slate-800">Pausas registradas</h4>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-2">Tipo</th>
                      <th className="text-left py-2">Horario</th>
                      <th className="text-left py-2">Duracao</th>
                      <th className="text-left py-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-900">
                    {scopedPauseSchedules
                      .filter((schedule) => schedule.agent_id === agentModalId)
                      .map((schedule) => (
                        <tr key={schedule.id} className="border-t border-slate-100">
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
                                onClick={() => {
                                  const confirmed = window.confirm('Remover esta pausa?')
                                  if (!confirmed) return
                                  handleScheduleDelete(schedule)
                                }}
                                disabled={scheduleBusy}
                              >
                                Remover
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {!scopedPauseSchedules.filter((schedule) => schedule.agent_id === agentModalId).length ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan="4">
                          Nenhuma pausa cadastrada.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h4 className="text-sm font-semibold text-slate-800">Adicionar pausa</h4>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div>
                  <label className="label">Tipo</label>
                  <select
                    className="input mt-1"
                    value={agentModalScheduleForm.pause_type_id}
                    onChange={(e) =>
                      setAgentModalScheduleForm((prev) => ({ ...prev, pause_type_id: e.target.value }))
                    }
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
                  <label className="label">Horario</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={agentModalScheduleForm.scheduled_time}
                    onChange={(e) =>
                      setAgentModalScheduleForm((prev) => ({ ...prev, scheduled_time: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Duracao (hh:mm)</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={agentModalScheduleForm.duration_time}
                    onChange={(e) =>
                      setAgentModalScheduleForm((prev) => ({ ...prev, duration_time: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-ghost" onClick={addAgentSchedule}>
                  Adicionar pausa
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Modal open={agentsModalOpen} title="Agentes vinculados" onClose={() => setAgentsModalOpen(false)}>
        {scopedAgents.length ? (
          <div className="space-y-2">
            {scopedAgents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <span className="text-sm font-medium text-slate-900">{agent.full_name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhum agente encontrado.</p>
        )}
      </Modal>

      <Modal open={loggedModalOpen} title="Agentes logados" onClose={() => setLoggedModalOpen(false)}>
        {scopedActiveSessions.length ? (
          <div className="space-y-2">
            {scopedActiveSessions.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.profiles?.full_name || 'Agente'}</p>
                  <p className="text-xs text-slate-500">
                    {item.login_at ? new Date(item.login_at).toLocaleString('pt-BR') : '-'}
                  </p>
                </div>
                <span className="text-sm text-slate-700">
                  {item.device_type === 'mobile'
                    ? 'Mobile'
                    : item.device_type === 'desktop'
                      ? 'Desktop'
                      : '-'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhum agente logado.</p>
        )}
      </Modal>

      <Modal open={pausedModalOpen} title="Agentes em pausa" onClose={() => setPausedModalOpen(false)}>
        {scopedActivePauses.length ? (
          <div className="space-y-2">
            {scopedActivePauses.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.profiles?.full_name || 'Agente'}</p>
                  <p className="text-xs text-slate-500">
                    {item.started_at ? new Date(item.started_at).toLocaleString('pt-BR') : '-'}
                  </p>
                </div>
                <span className="text-sm text-slate-700">{item.pause_types?.label || '-'}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhum agente em pausa.</p>
        )}
      </Modal>
    </div>
  )
}

