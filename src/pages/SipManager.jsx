
import { useEffect, useMemo, useRef, useState } from 'react'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import {
  createSipAgent,
  createSipQueue,
  listSipAgentStatuses,
  listSipAgents,
  listSipCalls,
  listSipQueueLinks,
  listSipQueues,
  listSipRecordings,
  setSipAgentQueues
} from '../services/apiSip'
import { deletePauseSchedule, getPauseTypes, listPauseSchedules, upsertPauseSchedule } from '../services/apiPauses'
import { fetchPauses } from '../services/apiReports'
import { supabase } from '../services/supabaseClient'
import { formatDateTime, formatDuration, formatInputDate, startOfMonth } from '../utils/format'

const toInputDateTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

const parseInputDateTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

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

const extractRecordingUrl = (row) => {
  const metadata = row?.metadata || {}
  if (typeof metadata.recording_url === 'string' && metadata.recording_url) return metadata.recording_url
  if (typeof metadata.recordingUrl === 'string' && metadata.recordingUrl) return metadata.recordingUrl
  if (typeof metadata.audio_url === 'string' && metadata.audio_url) return metadata.audio_url
  if (typeof metadata.url === 'string' && metadata.url) return metadata.url
  return ''
}

const getCallDate = (row) => row?.started_at || row?.answered_at || row?.ended_at || row?.created_at || null
const getCallKey = (row) => row?.call_id || row?.id || ''
const NEW_CALL_BADGE_TTL_MS = 15000

export default function SipManager() {
  const statusLabels = {
    LIVRE: 'Livres',
    OCUPADO: 'Ocupados',
    PAUSA: 'Em pausa',
    NAO_LOGADO: 'Nao logados'
  }

  const [tab, setTab] = useState('dashboard')
  const [queues, setQueues] = useState([])
  const [agents, setAgents] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])

  const [queueLinks, setQueueLinks] = useState([])
  const [assignments, setAssignments] = useState({})
  const [savingAssignments, setSavingAssignments] = useState('')

  const [queueFilter, setQueueFilter] = useState('')
  const [phoneFilter, setPhoneFilter] = useState('')
  const [fromDateTime, setFromDateTime] = useState(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return toInputDateTime(now)
  })
  const [toDateTime, setToDateTime] = useState(() => toInputDateTime(new Date()))
  const [statuses, setStatuses] = useState([])
  const [calls, setCalls] = useState([])
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  const [scheduleForm, setScheduleForm] = useState({
    agent_id: '',
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })

  const [reportFromDate, setReportFromDate] = useState(formatInputDate(startOfMonth()))
  const [reportToDate, setReportToDate] = useState(formatInputDate(new Date()))
  const [reportAgentId, setReportAgentId] = useState('')
  const [reportPauseTypeId, setReportPauseTypeId] = useState('')
  const [reportRows, setReportRows] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const [recordingFromDateTime, setRecordingFromDateTime] = useState(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return toInputDateTime(now)
  })
  const [recordingToDateTime, setRecordingToDateTime] = useState(() => toInputDateTime(new Date()))
  const [recordingPhone, setRecordingPhone] = useState('')
  const [recordingQueueId, setRecordingQueueId] = useState('')
  const [recordings, setRecordings] = useState([])
  const [recordingLoading, setRecordingLoading] = useState(false)
  const [recordingError, setRecordingError] = useState('')

  const [queueForm, setQueueForm] = useState({ code: '', label: '' })
  const [agentForm, setAgentForm] = useState({
    full_name: '',
    email: '',
    password: '',
    sip_default_extension: '',
    queue_ids: []
  })

  const [busy, setBusy] = useState(false)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('LIVRE')
  const [newCallKeys, setNewCallKeys] = useState({})
  const dashboardRefreshTimerRef = useRef(null)
  const newCallTimeoutsRef = useRef(new Map())

  const requiresScheduleTime = (pauseTypeId) => {
    const type = pauseTypes.find((item) => item.id === pauseTypeId)
    return type?.code !== 'BANHEIRO'
  }

  const reloadConfigData = async () => {
    const [queuesData, agentsData, linksData, pauseTypesData, schedulesData] = await Promise.all([
      listSipQueues(),
      listSipAgents(),
      listSipQueueLinks(),
      getPauseTypes(false),
      listPauseSchedules()
    ])

    setQueues(queuesData || [])
    setAgents(agentsData || [])
    setQueueLinks(linksData || [])
    setPauseTypes(pauseTypesData || [])

    const agentIds = new Set((agentsData || []).map((agent) => agent.id))
    setPauseSchedules((schedulesData || []).filter((row) => agentIds.has(row.agent_id)))

    const nextMap = {}
    ;(linksData || []).forEach((row) => {
      if (!nextMap[row.agent_id]) nextMap[row.agent_id] = []
      nextMap[row.agent_id].push(row.queue_id)
    })
    setAssignments(nextMap)
  }

  const reloadDashboard = async () => {
    setLoadingDashboard(true)
    try {
      const [statusRows, callRows] = await Promise.all([
        listSipAgentStatuses({ queueId: queueFilter || null }),
        listSipCalls({
          queueId: queueFilter || null,
          phone: phoneFilter,
          from: parseInputDateTime(fromDateTime),
          to: parseInputDateTime(toDateTime),
          limit: 300
        })
      ])
      setStatuses(statusRows || [])
      setCalls(callRows || [])
    } catch (err) {
      setError(err.message || 'Falha ao carregar dashboard SIP')
    } finally {
      setLoadingDashboard(false)
    }
  }

  const loadReport = async () => {
    setReportLoading(true)
    setReportError('')
    try {
      const agentIds = agents.map((item) => item.id)
      const rows = await fetchPauses({
        from: reportFromDate,
        to: reportToDate,
        agentId: reportAgentId || null,
        pauseTypeId: reportPauseTypeId || null,
        agentIds
      })
      setReportRows(rows || [])
    } catch (err) {
      setReportError(err.message || 'Falha ao carregar relatorios SIP')
    } finally {
      setReportLoading(false)
    }
  }

  const loadRecordings = async () => {
    setRecordingLoading(true)
    setRecordingError('')
    try {
      const rows = await listSipRecordings({
        queueId: recordingQueueId || null,
        phone: recordingPhone,
        from: parseInputDateTime(recordingFromDateTime),
        to: parseInputDateTime(recordingToDateTime),
        limit: 500
      })
      setRecordings(rows || [])
    } catch (err) {
      setRecordingError(err.message || 'Falha ao buscar gravacoes')
    } finally {
      setRecordingLoading(false)
    }
  }

  const markCallAsNew = (row) => {
    const key = getCallKey(row)
    if (!key) return

    setNewCallKeys((prev) => ({ ...prev, [key]: true }))

    const existingTimeout = newCallTimeoutsRef.current.get(key)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeoutId = setTimeout(() => {
      setNewCallKeys((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      newCallTimeoutsRef.current.delete(key)
    }, NEW_CALL_BADGE_TTL_MS)

    newCallTimeoutsRef.current.set(key, timeoutId)
  }

  useEffect(() => {
    const init = async () => {
      setError('')
      try {
        await reloadConfigData()
      } catch (err) {
        setError(err.message || 'Falha ao carregar configuracoes SIP')
      }
    }
    init()
  }, [])

  useEffect(() => {
    return () => {
      newCallTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId))
      newCallTimeoutsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    reloadDashboard()
  }, [queueFilter])

  useEffect(() => {
    if (tab !== 'dashboard') return
    const interval = setInterval(() => {
      reloadDashboard()
    }, 10000)
    return () => clearInterval(interval)
  }, [tab, queueFilter, phoneFilter, fromDateTime, toDateTime])

  useEffect(() => {
    const dashboardQueueFilter = queueFilter || null
    const dashboardPhoneFilter = String(phoneFilter || '').trim()
    const dashboardFrom = parseInputDateTime(fromDateTime)
    const dashboardTo = parseInputDateTime(toDateTime)

    const callMatchesDashboardFilters = (row) => {
      if (!row || typeof row !== 'object') return false

      if (dashboardQueueFilter && row.queue_id !== dashboardQueueFilter) return false

      const callDateRaw = getCallDate(row)
      const callDateMs = callDateRaw ? new Date(callDateRaw).getTime() : Number.NaN
      const fromMs = dashboardFrom ? new Date(dashboardFrom).getTime() : Number.NaN
      const toMs = dashboardTo ? new Date(dashboardTo).getTime() : Number.NaN
      if (Number.isFinite(fromMs) && (!Number.isFinite(callDateMs) || callDateMs < fromMs)) return false
      if (Number.isFinite(toMs) && (!Number.isFinite(callDateMs) || callDateMs > toMs)) return false

      if (dashboardPhoneFilter) {
        const caller = String(row.caller_number || '')
        const callee = String(row.callee_number || '')
        if (!caller.includes(dashboardPhoneFilter) && !callee.includes(dashboardPhoneFilter)) return false
      }

      return true
    }

    const mergeRealtimeCall = (payload) => {
      if (tab !== 'dashboard') return

      const eventType = payload?.eventType
      const nextRow = payload?.new || null
      const oldRow = payload?.old || null
      const nextKey = nextRow?.call_id || nextRow?.id || null
      const oldKey = oldRow?.call_id || oldRow?.id || null

      if (eventType === 'INSERT' && nextRow && callMatchesDashboardFilters(nextRow)) {
        markCallAsNew(nextRow)
      }

      setCalls((prev) => {
        let next = [...(prev || [])]
        const removeKey = oldKey || nextKey
        if (removeKey) {
          next = next.filter((row) => (row.call_id || row.id) !== removeKey)
        }

        if (eventType !== 'DELETE' && nextRow && callMatchesDashboardFilters(nextRow)) {
          next.unshift(nextRow)
        }

        next.sort((a, b) => {
          const aMs = new Date(getCallDate(a) || 0).getTime()
          const bMs = new Date(getCallDate(b) || 0).getTime()
          return bMs - aMs
        })
        return next.slice(0, 300)
      })
    }

    const scheduleDashboardRefresh = () => {
      if (dashboardRefreshTimerRef.current) return
      dashboardRefreshTimerRef.current = setTimeout(() => {
        dashboardRefreshTimerRef.current = null
        reloadDashboard()
      }, 1000)
    }

    const scheduleConfigRefresh = () => {
      if (tab !== 'config') return
      loadRecordings()
    }

    const sessionChannel = supabase
      .channel('sip-manager-sessions-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sip_sessions' },
        () => {
          scheduleDashboardRefresh()
        }
      )
      .subscribe()

    const callsChannel = supabase
      .channel('sip-manager-calls-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sip_calls' },
        (payload) => {
          mergeRealtimeCall(payload)
          scheduleDashboardRefresh()
          scheduleConfigRefresh()
        }
      )
      .subscribe()

    const pausesChannel = supabase
      .channel('sip-manager-pauses-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pauses' },
        () => {
          scheduleDashboardRefresh()
        }
      )
      .subscribe()

    return () => {
      if (dashboardRefreshTimerRef.current) {
        clearTimeout(dashboardRefreshTimerRef.current)
        dashboardRefreshTimerRef.current = null
      }
      supabase.removeChannel(sessionChannel)
      supabase.removeChannel(callsChannel)
      supabase.removeChannel(pausesChannel)
    }
  }, [queueFilter, phoneFilter, fromDateTime, toDateTime, tab, recordingQueueId, recordingPhone, recordingFromDateTime, recordingToDateTime])

  useEffect(() => {
    if (tab === 'reports') loadReport()
    if (tab === 'config') loadRecordings()
  }, [tab])

  const counts = useMemo(() => {
    const base = { LIVRE: 0, OCUPADO: 0, PAUSA: 0, NAO_LOGADO: 0 }
    statuses.forEach((row) => {
      const key = row.status || 'NAO_LOGADO'
      if (Object.prototype.hasOwnProperty.call(base, key)) base[key] += 1
    })
    return base
  }, [statuses])

  const selectedStatusAgents = useMemo(() => {
    return statuses.filter((row) => (row.status || 'NAO_LOGADO') === selectedStatus)
  }, [statuses, selectedStatus])

  const queueNameById = useMemo(() => {
    const map = new Map()
    queues.forEach((queue) => map.set(queue.id, queue.label))
    return map
  }, [queues])

  const agentNameById = useMemo(() => {
    const map = new Map()
    agents.forEach((agent) => map.set(agent.id, agent.full_name))
    return map
  }, [agents])

  const toggleAgentQueue = (agentId, queueId) => {
    setAssignments((prev) => {
      const current = new Set(prev[agentId] || [])
      if (current.has(queueId)) current.delete(queueId)
      else current.add(queueId)
      return { ...prev, [agentId]: Array.from(current) }
    })
  }

  const saveAgentQueues = async (agentId) => {
    setSavingAssignments(agentId)
    setError('')
    setSuccess('')
    try {
      await setSipAgentQueues(agentId, assignments[agentId] || [])
      setSuccess('Filas do agente SIP atualizadas.')
      const linksData = await listSipQueueLinks()
      setQueueLinks(linksData || [])
    } catch (err) {
      setError(err.message || 'Falha ao salvar filas do agente SIP')
    } finally {
      setSavingAssignments('')
    }
  }

  const handleCreateQueue = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await createSipQueue(queueForm)
      setQueueForm({ code: '', label: '' })
      setSuccess('Fila SIP criada com sucesso.')
      await reloadConfigData()
      await reloadDashboard()
    } catch (err) {
      setError(err.message || 'Falha ao criar fila SIP')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateAgent = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await createSipAgent(agentForm)
      setAgentForm({ full_name: '', email: '', password: '', sip_default_extension: '', queue_ids: [] })
      setSuccess('Agente SIP criado com sucesso.')
      await reloadConfigData()
      await reloadDashboard()
    } catch (err) {
      setError(err.message || 'Falha ao criar agente SIP')
    } finally {
      setBusy(false)
    }
  }

  const handleScheduleCreate = async () => {
    const needsTime = requiresScheduleTime(scheduleForm.pause_type_id)
    if (!scheduleForm.agent_id || !scheduleForm.pause_type_id || (needsTime && !scheduleForm.scheduled_time)) {
      setScheduleError('Preencha agente e tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setScheduleError('')
    setSuccess('')
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
      setSuccess('Pausa SIP programada salva.')
      await reloadConfigData()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao salvar pausa SIP')
    } finally {
      setScheduleBusy(false)
    }
  }

  const updateScheduleField = (id, field, value) => {
    setPauseSchedules((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }

  const handleScheduleUpdate = async (schedule) => {
    const needsTime = requiresScheduleTime(schedule.pause_type_id)
    if (!schedule.agent_id || !schedule.pause_type_id || (needsTime && !schedule.scheduled_time)) {
      setScheduleError('Preencha agente e tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setScheduleError('')
    setSuccess('')
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
      setSuccess('Pausa SIP atualizada.')
      await reloadConfigData()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao atualizar pausa SIP')
    } finally {
      setScheduleBusy(false)
    }
  }

  const handleScheduleDelete = async (schedule) => {
    if (!schedule?.id) return
    if (!window.confirm('Remover esta pausa programada?')) return
    setScheduleBusy(true)
    setScheduleError('')
    setSuccess('')
    try {
      await deletePauseSchedule(schedule.id)
      setSuccess('Pausa SIP removida.')
      await reloadConfigData()
    } catch (err) {
      setScheduleError(err.message || 'Falha ao remover pausa SIP')
    } finally {
      setScheduleBusy(false)
    }
  }

  const toggleSelectedStatus = (status) => {
    setSelectedStatus((prev) => (prev === status ? '' : status))
  }

  return (
    <div className="min-h-screen pb-10">
      <TopNav />
      <div className="max-w-7xl mx-auto px-6 space-y-6">
        <div className="card">
          <div className="flex flex-wrap gap-2">
            <button className={`btn ${tab === 'dashboard' ? 'bg-brand-600 text-white' : 'btn-ghost'}`} onClick={() => setTab('dashboard')}>Dashboard SIP</button>
            <button className={`btn ${tab === 'pauseSchedules' ? 'bg-brand-600 text-white' : 'btn-ghost'}`} onClick={() => setTab('pauseSchedules')}>Pausas programadas</button>
            <button className={`btn ${tab === 'pauseTypes' ? 'bg-brand-600 text-white' : 'btn-ghost'}`} onClick={() => setTab('pauseTypes')}>Tipos de pausa</button>
            <button className={`btn ${tab === 'reports' ? 'bg-brand-600 text-white' : 'btn-ghost'}`} onClick={() => setTab('reports')}>Relatorios</button>
            <button className={`btn ${tab === 'config' ? 'bg-brand-600 text-white' : 'btn-ghost'}`} onClick={() => setTab('config')}>Configuracoes</button>
          </div>
        </div>

        {error ? <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

        {tab === 'dashboard' ? (
          <>
            <div className="card">
              <form className="grid gap-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); reloadDashboard() }}>
                <div><label className="label">Fila</label><select className="input mt-1" value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}><option value="">Todas</option>{queues.map((queue) => <option key={queue.id} value={queue.id}>{queue.label}</option>)}</select></div>
                <div><label className="label">Numero</label><input className="input mt-1" value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value)} /></div>
                <div><label className="label">De</label><input className="input mt-1" type="datetime-local" value={fromDateTime} onChange={(e) => setFromDateTime(e.target.value)} /></div>
                <div><label className="label">Ate</label><input className="input mt-1" type="datetime-local" value={toDateTime} onChange={(e) => setToDateTime(e.target.value)} /></div>
                <div className="flex items-end"><button className="btn-primary w-full" type="submit" disabled={loadingDashboard}>{loadingDashboard ? 'Atualizando...' : 'Filtrar'}</button></div>
              </form>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <StatCard label="Livres" value={counts.LIVRE} sub="Clique para ver agentes" onClick={() => toggleSelectedStatus('LIVRE')} />
              <StatCard label="Ocupados" value={counts.OCUPADO} sub="Clique para ver agentes" onClick={() => toggleSelectedStatus('OCUPADO')} />
              <StatCard label="Em pausa" value={counts.PAUSA} sub="Clique para ver agentes" onClick={() => toggleSelectedStatus('PAUSA')} />
              <StatCard label="Nao logados" value={counts.NAO_LOGADO} sub="Clique para ver agentes" onClick={() => toggleSelectedStatus('NAO_LOGADO')} />
            </div>

            <div className="card">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold text-slate-900">
                  {selectedStatus ? `Agentes ${statusLabels[selectedStatus] || selectedStatus}` : 'Agentes por status'}
                </h2>
                {selectedStatus ? (
                  <button className="btn-ghost" type="button" onClick={() => setSelectedStatus('')}>
                    Limpar selecao
                  </button>
                ) : null}
              </div>
              {!selectedStatus ? (
                <p className="mt-3 text-sm text-slate-600">
                  Clique em um bloco acima para listar agentes e ramais.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left py-2">Agente</th>
                        <th className="text-left py-2">Ramal</th>
                        <th className="text-left py-2">Fila</th>
                        <th className="text-left py-2">Login SIP</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-900">
                      {selectedStatusAgents.map((row) => (
                        <tr key={row.agent_id} className="border-t border-slate-100">
                          <td className="py-2">{row.agent_name || '-'}</td>
                          <td className="py-2">{row.sip_extension || '-'}</td>
                          <td className="py-2">{row.queue_names || '-'}</td>
                          <td className="py-2">{formatDateTime(row.login_at)}</td>
                        </tr>
                      ))}
                      {!selectedStatusAgents.length ? (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan="4">
                            Nenhum agente neste status agora.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Ligacoes SIP</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500"><tr><th className="text-left py-2">Data/Hora</th><th className="text-left py-2">Fila</th><th className="text-left py-2">Agente</th><th className="text-left py-2">Origem</th><th className="text-left py-2">Destino</th><th className="text-left py-2">Duracao</th></tr></thead>
                  <tbody className="text-slate-900">
                    {calls.map((call) => {
                      const callKey = getCallKey(call)
                      const isNew = !!newCallKeys[callKey]
                      return (
                        <tr key={callKey || call.call_id} className="border-t border-slate-100">
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <span>{formatDateTime(call.started_at || call.answered_at || call.ended_at)}</span>
                              {isNew ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                  Novo
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2">{call.queue_label || (call.queue_id ? queueNameById.get(call.queue_id) : '-') || '-'}</td>
                          <td className="py-2">{call.agent_name || (call.agent_id ? agentNameById.get(call.agent_id) : '-') || '-'}</td>
                          <td className="py-2">{call.caller_number || '-'}</td>
                          <td className="py-2">{call.callee_number || '-'}</td>
                          <td className="py-2">{call.duration_seconds ? formatDuration(call.duration_seconds) : '-'}</td>
                        </tr>
                      )
                    })}
                    {!calls.length ? <tr><td className="py-3 text-slate-500" colSpan="6">Nenhuma ligacao encontrada.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        {tab === 'pauseSchedules' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Programar pausa</h2>
              {scheduleError ? <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mt-3">{scheduleError}</div> : null}
              <div className="mt-4 space-y-3">
                <div><label className="label">Agente SIP</label><select className="input mt-1" value={scheduleForm.agent_id} onChange={(e) => setScheduleForm((prev) => ({ ...prev, agent_id: e.target.value }))}><option value="">Selecione</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></div>
                <div><label className="label">Tipo de pausa</label><select className="input mt-1" value={scheduleForm.pause_type_id} onChange={(e) => setScheduleForm((prev) => ({ ...prev, pause_type_id: e.target.value }))}><option value="">Selecione</option>{pauseTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></div>
                <div><label className="label">Horario</label><input className="input mt-1" type="time" step="60" value={scheduleForm.scheduled_time} onChange={(e) => setScheduleForm((prev) => ({ ...prev, scheduled_time: e.target.value }))} /></div>
                <div><label className="label">Duracao (hh:mm)</label><input className="input mt-1" type="time" step="60" value={scheduleForm.duration_time} onChange={(e) => setScheduleForm((prev) => ({ ...prev, duration_time: e.target.value }))} /></div>
                <button className="btn-primary w-full" type="button" onClick={handleScheduleCreate} disabled={scheduleBusy}>{scheduleBusy ? 'Salvando...' : 'Salvar pausa'}</button>
              </div>
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Pausas programadas SIP</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500"><tr><th className="text-left py-2">Agente</th><th className="text-left py-2">Tipo</th><th className="text-left py-2">Horario</th><th className="text-left py-2">Duracao</th><th className="text-left py-2">Acoes</th></tr></thead>
                  <tbody className="text-slate-900">
                    {pauseSchedules.map((schedule) => (
                      <tr key={schedule.id} className="border-t border-slate-100">
                        <td className="py-2">{agentNameById.get(schedule.agent_id) || schedule.profiles?.full_name || '-'}</td>
                        <td className="py-2">{schedule.pause_types?.label || '-'}</td>
                        <td className="py-2"><input className="input" type="time" step="60" value={normalizeTime(schedule.scheduled_time)} onChange={(e) => updateScheduleField(schedule.id, 'scheduled_time', e.target.value)} /></td>
                        <td className="py-2"><input className="input" type="time" step="60" value={minutesToTime(schedule.duration_minutes)} onChange={(e) => updateScheduleField(schedule.id, 'duration_minutes', timeToMinutes(e.target.value))} /></td>
                        <td className="py-2"><div className="flex gap-2"><button className="btn-ghost" type="button" onClick={() => handleScheduleUpdate(schedule)} disabled={scheduleBusy}>Salvar</button><button className="btn-ghost text-red-600" type="button" onClick={() => handleScheduleDelete(schedule)} disabled={scheduleBusy}>Remover</button></div></td>
                      </tr>
                    ))}
                    {!pauseSchedules.length ? <tr><td className="py-3 text-slate-500" colSpan="5">Nenhuma pausa cadastrada.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'pauseTypes' ? (
          <div className="card">
            <h2 className="font-display text-xl font-semibold text-slate-900">Tipos de pausa</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500"><tr><th className="text-left py-2">Codigo</th><th className="text-left py-2">Nome</th><th className="text-left py-2">Limite</th><th className="text-left py-2">Ativo</th></tr></thead>
                <tbody className="text-slate-900">
                  {pauseTypes.map((type) => <tr key={type.id} className="border-t border-slate-100"><td className="py-2">{type.code}</td><td className="py-2">{type.label}</td><td className="py-2">{type.limit_minutes ? minutesToTime(type.limit_minutes) : '-'}</td><td className="py-2">{type.is_active ? 'Sim' : 'Nao'}</td></tr>)}
                  {!pauseTypes.length ? <tr><td className="py-3 text-slate-500" colSpan="4">Nenhum tipo de pausa encontrado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'reports' ? (
          <div className="space-y-6">
            <div className="card">
              <form className="grid gap-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); loadReport() }}>
                <div><label className="label">De</label><input className="input mt-1" type="date" value={reportFromDate} onChange={(e) => setReportFromDate(e.target.value)} /></div>
                <div><label className="label">Ate</label><input className="input mt-1" type="date" value={reportToDate} onChange={(e) => setReportToDate(e.target.value)} /></div>
                <div><label className="label">Agente SIP</label><select className="input mt-1" value={reportAgentId} onChange={(e) => setReportAgentId(e.target.value)}><option value="">Todos</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></div>
                <div><label className="label">Tipo de pausa</label><select className="input mt-1" value={reportPauseTypeId} onChange={(e) => setReportPauseTypeId(e.target.value)}><option value="">Todos</option>{pauseTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></div>
                <div className="flex items-end"><button className="btn-primary w-full" type="submit" disabled={reportLoading}>{reportLoading ? 'Carregando...' : 'Filtrar'}</button></div>
              </form>
              {reportError ? <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mt-3">{reportError}</div> : null}
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Relatorio de pausas SIP</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500"><tr><th className="text-left py-2">Agente</th><th className="text-left py-2">Tipo</th><th className="text-left py-2">Inicio</th><th className="text-left py-2">Fim</th><th className="text-left py-2">Duracao</th><th className="text-left py-2">Atraso</th></tr></thead>
                  <tbody className="text-slate-900">
                    {reportRows.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="py-2">{row.profiles?.full_name || '-'}</td><td className="py-2">{row.pause_types?.label || '-'}</td><td className="py-2">{formatDateTime(row.started_at)}</td><td className="py-2">{formatDateTime(row.ended_at)}</td><td className="py-2">{formatDuration(row.duration_seconds || 0)}</td><td className="py-2">{row.atraso ? 'Sim' : 'Nao'}</td></tr>)}
                    {!reportRows.length ? <tr><td className="py-3 text-slate-500" colSpan="6">Sem dados no periodo.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'config' ? (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card">
                <h2 className="font-display text-xl font-semibold text-slate-900">Criar fila SIP</h2>
                <form className="mt-4 space-y-3" onSubmit={handleCreateQueue}>
                  <div><label className="label">Codigo</label><input className="input mt-1" value={queueForm.code} onChange={(e) => setQueueForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} required /></div>
                  <div><label className="label">Nome da fila</label><input className="input mt-1" value={queueForm.label} onChange={(e) => setQueueForm((prev) => ({ ...prev, label: e.target.value }))} required /></div>
                  <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Criar fila'}</button>
                </form>
              </div>

              <div className="card">
                <h2 className="font-display text-xl font-semibold text-slate-900">Criar agente SIP</h2>
                <form className="mt-4 space-y-3" onSubmit={handleCreateAgent}>
                  <div><label className="label">Nome completo</label><input className="input mt-1" value={agentForm.full_name} onChange={(e) => setAgentForm((prev) => ({ ...prev, full_name: e.target.value }))} required /></div>
                  <div><label className="label">Email</label><input className="input mt-1" type="email" value={agentForm.email} onChange={(e) => setAgentForm((prev) => ({ ...prev, email: e.target.value }))} required /></div>
                  <div><label className="label">Senha inicial</label><input className="input mt-1" type="password" value={agentForm.password} onChange={(e) => setAgentForm((prev) => ({ ...prev, password: e.target.value }))} required /></div>
                  <div><label className="label">Ramal SIP padrao</label><input className="input mt-1" value={agentForm.sip_default_extension} onChange={(e) => setAgentForm((prev) => ({ ...prev, sip_default_extension: e.target.value }))} /></div>
                  <div>
                    <label className="label">Filas</label>
                    <div className="mt-2 space-y-2">
                      {queues.map((queue) => {
                        const checked = agentForm.queue_ids.includes(queue.id)
                        return <label key={queue.id} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={checked} onChange={() => setAgentForm((prev) => { const set = new Set(prev.queue_ids); if (set.has(queue.id)) set.delete(queue.id); else set.add(queue.id); return { ...prev, queue_ids: Array.from(set) } })} />{queue.label}</label>
                      })}
                    </div>
                  </div>
                  <button className="btn-primary w-full" type="submit" disabled={busy || !queues.length}>{busy ? 'Salvando...' : 'Criar agente SIP'}</button>
                </form>
              </div>
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Agentes SIP e filas</h2>
              <div className="mt-4 space-y-3">
                {agents.map((agent) => (
                  <div key={agent.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{agent.full_name}</p>
                      <button className="btn-ghost" type="button" onClick={() => saveAgentQueues(agent.id)} disabled={savingAssignments === agent.id}>{savingAssignments === agent.id ? 'Salvando...' : 'Salvar filas'}</button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {queues.map((queue) => {
                        const checked = (assignments[agent.id] || []).includes(queue.id)
                        return <label key={`${agent.id}-${queue.id}`} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1 text-sm text-slate-700"><input type="checkbox" checked={checked} onChange={() => toggleAgentQueue(agent.id, queue.id)} />{queue.label}</label>
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Conversas gravadas</h2>
              <p className="text-sm text-slate-600 mt-1">Localize por range de data, numero que ligou e horario.</p>
              <form className="mt-4 grid gap-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); loadRecordings() }}>
                <div><label className="label">De</label><input className="input mt-1" type="datetime-local" value={recordingFromDateTime} onChange={(e) => setRecordingFromDateTime(e.target.value)} /></div>
                <div><label className="label">Ate</label><input className="input mt-1" type="datetime-local" value={recordingToDateTime} onChange={(e) => setRecordingToDateTime(e.target.value)} /></div>
                <div><label className="label">Numero</label><input className="input mt-1" value={recordingPhone} onChange={(e) => setRecordingPhone(e.target.value)} /></div>
                <div><label className="label">Fila</label><select className="input mt-1" value={recordingQueueId} onChange={(e) => setRecordingQueueId(e.target.value)}><option value="">Todas</option>{queues.map((queue) => <option key={queue.id} value={queue.id}>{queue.label}</option>)}</select></div>
                <div className="flex items-end"><button className="btn-primary w-full" type="submit" disabled={recordingLoading}>{recordingLoading ? 'Buscando...' : 'Buscar gravacoes'}</button></div>
              </form>
              {recordingError ? <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mt-3">{recordingError}</div> : null}

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500"><tr><th className="text-left py-2">Data/Hora</th><th className="text-left py-2">Origem</th><th className="text-left py-2">Destino</th><th className="text-left py-2">Agente</th><th className="text-left py-2">Fila</th><th className="text-left py-2">Audio</th></tr></thead>
                  <tbody className="text-slate-900">
                    {recordings.map((row) => {
                      const recordingUrl = extractRecordingUrl(row)
                      const recordingName =
                        row?.metadata?.recording_name ||
                        (recordingUrl ? recordingUrl.split('/').pop()?.split('?')[0] : '') ||
                        'gravacao.mp3'
                      return <tr key={row.id} className="border-t border-slate-100"><td className="py-2">{formatDateTime(row.started_at || row.answered_at || row.ended_at)}</td><td className="py-2">{row.caller_number || '-'}</td><td className="py-2">{row.callee_number || '-'}</td><td className="py-2">{row.profiles?.full_name || '-'}</td><td className="py-2">{row.sip_queues?.label || '-'}</td><td className="py-2">{recordingUrl ? <a className="text-brand-700 underline" href={recordingUrl} download={recordingName} target="_blank" rel="noreferrer">Baixar MP3</a> : '-'}</td></tr>
                    })}
                    {!recordings.length ? <tr><td className="py-3 text-slate-500" colSpan="6">Nenhuma gravacao encontrada.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

