import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const SCHEDULE_ALERT_KEY = 'pause-control.schedule-alerts'
const NOTIFICATION_PREF_KEY = 'pause-control.notifications-pref'

const getLocalDateKey = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseScheduleMinutes = (value) => {
  if (!value) return null
  const match = String(value).match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return hours * 60 + minutes
}

const readAlertedScheduleIds = (dayKey) => {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SCHEDULE_ALERT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const ids = parsed[dayKey]
    return Array.isArray(ids) ? ids : []
  } catch (err) {
    console.warn('[agent] failed to read schedule alert cache', err)
    return []
  }
}

const writeAlertedScheduleIds = (dayKey, ids) => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SCHEDULE_ALERT_KEY, JSON.stringify({ [dayKey]: ids }))
  } catch (err) {
    console.warn('[agent] failed to write schedule alert cache', err)
  }
}

const readNotificationPref = () => {
  if (typeof window === 'undefined') return 'auto'
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREF_KEY)
    if (!raw) return 'auto'
    if (raw === 'on' || raw === 'off' || raw === 'auto') return raw
    return 'auto'
  } catch (err) {
    console.warn('[agent] failed to read notification pref', err)
    return 'auto'
  }
}

const writeNotificationPref = (value) => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(NOTIFICATION_PREF_KEY, value)
  } catch (err) {
    console.warn('[agent] failed to write notification pref', err)
  }
}

export default function Agent() {
  const { profile } = useAuth()
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window
  const notificationIcon = `${import.meta.env.BASE_URL || '/'}logo-odontoart.png`
  const [notificationPermission, setNotificationPermission] = useState(() =>
    notificationsSupported ? Notification.permission : 'unsupported'
  )
  const [notificationPref, setNotificationPref] = useState(() => readNotificationPref())
  const resolvedPermission = useMemo(() => {
    if (!notificationsSupported) return 'unsupported'
    const live = Notification.permission
    if (live === 'granted' || live === 'denied') return live
    if (notificationPermission === 'granted' || notificationPermission === 'denied') {
      return notificationPermission
    }
    return 'default'
  }, [notificationsSupported, notificationPermission])
  const notificationsEnabled = resolvedPermission === 'granted' && notificationPref !== 'off'
  const persistNotificationPref = (nextPref) => {
    setNotificationPref(nextPref)
    writeNotificationPref(nextPref)
  }
  const [pauseTypes, setPauseTypes] = useState([])
  const [selectedCode, setSelectedCode] = useState('')
  const [activePause, setActivePause] = useState(null)
  const [recentPauses, setRecentPauses] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])
  const [error, setError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [pauseModalOpen, setPauseModalOpen] = useState(false)
  const [scheduleAlert, setScheduleAlert] = useState(null)
  const [notificationModal, setNotificationModal] = useState(null)
  const scheduleAlertRef = useRef(null)
  const alertedScheduleIdsRef = useRef(new Set())
  const scheduleAlertNotifiedRef = useRef(new Set())
  const alertDayKeyRef = useRef(getLocalDateKey())
  const syncNotificationPermission = useCallback(() => {
    if (!notificationsSupported) return
    setNotificationPermission(Notification.permission)
  }, [notificationsSupported])

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

  useEffect(() => {
    if (activePause) {
      setPauseModalOpen(true)
    } else {
      setPauseModalOpen(false)
    }
  }, [activePause])

  useEffect(() => {
    scheduleAlertRef.current = scheduleAlert
  }, [scheduleAlert])

  useEffect(() => {
    if (!notificationsSupported) return
    syncNotificationPermission()
    if (!navigator.permissions?.query) return
    let active = true
    let status
    navigator.permissions
      .query({ name: 'notifications' })
      .then((result) => {
        if (!active) return
        status = result
        syncNotificationPermission()
        result.onchange = () => {
          syncNotificationPermission()
        }
      })
      .catch(() => {
        // ignore permissions query errors
      })
    return () => {
      active = false
      if (status) status.onchange = null
    }
  }, [notificationsSupported, syncNotificationPermission])

  useEffect(() => {
    const dayKey = getLocalDateKey()
    alertDayKeyRef.current = dayKey
    alertedScheduleIdsRef.current = new Set(readAlertedScheduleIds(dayKey))
    scheduleAlertNotifiedRef.current = new Set()
  }, [])

  const ensureAlertDay = useCallback(() => {
    const dayKey = getLocalDateKey()
    if (alertDayKeyRef.current !== dayKey) {
      alertDayKeyRef.current = dayKey
      alertedScheduleIdsRef.current = new Set()
      scheduleAlertNotifiedRef.current = new Set()
      writeAlertedScheduleIds(dayKey, [])
    }
  }, [])

  const requestNotificationPermission = useCallback(async () => {
    if (!notificationsSupported) return 'denied'
    if (Notification.permission === 'default') {
      try {
        const result = await Notification.requestPermission()
        setNotificationPermission(result)
        return result
      } catch (err) {
        setNotificationPermission(Notification.permission)
        return Notification.permission
      }
    }
    setNotificationPermission(Notification.permission)
    return Notification.permission
  }, [notificationsSupported])

  const showBasicNotification = useCallback(
    (title, body) => {
      if (!notificationsSupported) return
      if (resolvedPermission !== 'granted') return
      try {
        new Notification(title, {
          body,
          icon: notificationIcon
        })
      } catch (err) {
        console.warn('[agent] failed to show notification', err)
      }
    },
    [notificationsSupported, notificationIcon, resolvedPermission]
  )

  const showScheduleNotification = useCallback(
    (schedule) => {
      if (!schedule) return
      const label = schedule.pause_types?.label || 'Pausa programada'
      const time = normalizeTime(schedule.scheduled_time)
      showBasicNotification('Horario de pausa', `${label} - ${time}`)
    },
    [showBasicNotification]
  )

  const markScheduleAlerted = useCallback(
    (scheduleId) => {
      if (!scheduleId) return
      ensureAlertDay()
      const set = alertedScheduleIdsRef.current
      if (set.has(scheduleId)) return
      set.add(scheduleId)
      writeAlertedScheduleIds(alertDayKeyRef.current, Array.from(set))
    },
    [ensureAlertDay]
  )

  const checkScheduleAlert = useCallback(() => {
    if (!pauseSchedules.length) return

    ensureAlertDay()

    const nowDate = new Date()
    const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
    const alertedIds = alertedScheduleIdsRef.current

    let nextAlert = null
    let nextMinutes = null

    pauseSchedules.forEach((schedule) => {
      const minutes = parseScheduleMinutes(schedule?.scheduled_time)
      if (minutes === null) return
      if (minutes > nowMinutes) return
      if (alertedIds.has(schedule.id)) return
      if (nextAlert && nextMinutes !== null && minutes >= nextMinutes) return
      nextAlert = schedule
      nextMinutes = minutes
    })

    if (nextAlert) {
      if (!pauseModalOpen && scheduleAlertRef.current?.id !== nextAlert.id) {
        setScheduleAlert(nextAlert)
      }
      if (notificationsEnabled && !scheduleAlertNotifiedRef.current.has(nextAlert.id)) {
        scheduleAlertNotifiedRef.current.add(nextAlert.id)
        showScheduleNotification(nextAlert)
      }
    }
  }, [pauseSchedules, pauseModalOpen, ensureAlertDay, notificationsEnabled, showScheduleNotification])

  useEffect(() => {
    checkScheduleAlert()
    if (!pauseSchedules.length) return
    const interval = setInterval(checkScheduleAlert, 20000)
    return () => clearInterval(interval)
  }, [checkScheduleAlert, pauseSchedules.length])


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
      await endPause()
      await loadAll()
    } catch (err) {
      setError(friendlyError(err, 'Nao foi possivel encerrar a pausa'))
    } finally {
      setEnding(false)
    }
  }

  const handleScheduleAlertClose = () => {
    if (!scheduleAlert) return
    markScheduleAlerted(scheduleAlert.id)
    scheduleAlertRef.current = null
    setScheduleAlert(null)
    setTimeout(checkScheduleAlert, 0)
  }

  const activeLabel = activePause?.pause_types?.label || 'Em pausa'
  const handleNotificationAction = async () => {
    if (!notificationsSupported) return
    if (resolvedPermission === 'default') {
      const result = await requestNotificationPermission()
      if (result === 'granted') {
        persistNotificationPref('on')
        showBasicNotification('Notificacoes ativadas', 'Os avisos estao prontos para uso.')
        setNotificationModal({
          title: 'Notificacoes ativadas',
          message: 'Voce recebera avisos mesmo quando estiver em outra aba.'
        })
      } else if (result === 'denied') {
        persistNotificationPref(notificationPref === 'off' ? 'off' : 'auto')
        setNotificationModal({
          title: 'Notificacoes bloqueadas',
          message: 'Ative nas configuracoes do navegador para receber avisos.'
        })
      }
      return
    }
    if (resolvedPermission === 'granted') {
      if (notificationsEnabled) {
        persistNotificationPref('off')
      } else {
        persistNotificationPref('on')
        showBasicNotification('Notificacoes ativadas', 'Os avisos estao prontos para uso.')
      }
      setNotificationModal({
        title: notificationsEnabled ? 'Notificacoes desativadas' : 'Notificacoes ativadas',
        message: notificationsEnabled
          ? 'Os avisos foram desativados. Clique novamente para ativar.'
          : 'Voce recebera avisos quando o horario chegar.'
      })
      return
    }
    setNotificationModal({
      title: 'Notificacoes bloqueadas',
      message: 'Ative nas configuracoes do navegador para receber avisos.'
    })
  }
  const notificationTone = !notificationsSupported
    ? 'text-slate-400'
    : resolvedPermission === 'denied'
      ? 'text-slate-400'
      : resolvedPermission === 'default'
        ? 'text-amber-600'
        : notificationsEnabled
          ? 'text-emerald-600'
          : 'text-slate-400'
  const notificationTitle = !notificationsSupported
    ? 'Notificacoes indisponiveis'
    : resolvedPermission === 'denied'
      ? 'Notificacoes bloqueadas (clique para ver como ativar)'
      : resolvedPermission === 'default'
        ? 'Ativar notificacoes'
        : notificationsEnabled
          ? 'Notificacoes ativas (clique para desativar)'
          : 'Notificacoes desativadas (clique para ativar)'
  const agentNotificationAction = notificationsSupported ? (
    <button
      type="button"
      className={`btn-ghost h-10 w-10 px-0 ${notificationTone}`}
      onClick={handleNotificationAction}
      aria-label="Notificacoes"
      title={notificationTitle}
    >
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
    </button>
  ) : null

  return (
    <div className="min-h-screen">
      <TopNav
        agentNotificationAction={agentNotificationAction}
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

      {scheduleAlert ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6 py-10">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Aviso de pausa</p>
            <h2 className="mt-2 font-display text-xl font-semibold text-slate-900">Horario de pausa</h2>
            <p className="mt-3 text-sm text-slate-600">
              Sua pausa de{' '}
              <span className="font-semibold text-slate-900">
                {scheduleAlert.pause_types?.label || 'Pausa programada'}
              </span>{' '}
              esta programada para {normalizeTime(scheduleAlert.scheduled_time)}.
            </p>
            <p className="mt-2 text-xs text-slate-500">Este aviso nao inicia a pausa automaticamente.</p>
            <div className="mt-6 flex justify-end">
              <button type="button" className="btn-primary h-10" onClick={handleScheduleAlertClose}>
                Ok
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {notificationModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6 py-10">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Notificacoes</p>
            <h2 className="mt-2 font-display text-xl font-semibold text-slate-900">{notificationModal.title}</h2>
            <p className="mt-3 text-sm text-slate-600">{notificationModal.message}</p>
            <div className="mt-6 flex justify-end">
              <button type="button" className="btn-primary h-10" onClick={() => setNotificationModal(null)}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pauseModalOpen && activePause ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-6 py-10 text-white">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-200">Pausa em andamento</p>
            <h2 className="mt-2 text-2xl font-semibold">{activeLabel}</h2>
            <div className="mt-6 text-center">
              <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">Cronometro</p>
              <p className="mt-2 text-5xl font-semibold">{formatDuration(elapsedSeconds)}</p>
            </div>
            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.2em] text-white/70">Pausa em andamento</p>
              <p className="mt-2 text-sm text-white/70">Finalize a pausa quando concluir.</p>
            </div>
            <div className="mt-6 flex justify-center">
              <button
                className="btn-secondary h-11 px-8 text-base"
                onClick={handleEnd}
                disabled={ending}
              >
                {ending ? 'Encerrando...' : 'Finalizar pausa'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
