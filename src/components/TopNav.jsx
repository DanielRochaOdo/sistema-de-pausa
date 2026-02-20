import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { getLatePausesSummary, listActiveLatePauses, markAllLatePausesAsRead } from '../services/apiPauses'
import { savePushSubscription } from '../services/apiPush'
import { supabase } from '../services/supabaseClient'
import { formatDateTime, formatDuration, startOfToday } from '../utils/format'

export default function TopNav({ agentControls }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const [latePauses, setLatePauses] = useState([])
  const [lateCount, setLateCount] = useState(0)
  const [bellOpen, setBellOpen] = useState(false)
  const [activeLatePauses, setActiveLatePauses] = useState([])
  const [pushReady, setPushReady] = useState(false)
  const prevLateIdsRef = useRef(new Set())
  const prevTotalLateRef = useRef(0)
  const prevActiveLateIdsRef = useRef(new Set())
  const lateInitRef = useRef(false)
  const activeInitRef = useRef(false)
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('theme-dark')
  })

  const showAgent = profile?.role === 'AGENTE'
  const showManager = profile?.role === 'GERENTE' || profile?.role === 'ADMIN'
  const showAdmin = profile?.role === 'ADMIN'
  const isAdminScreen = location?.pathname?.startsWith('/admin')
  const isAdminLike = profile?.role === 'ADMIN' || profile?.is_admin
  const showAdminPanel = profile?.role === 'GERENTE' && profile?.is_admin && !isAdminScreen
  const showManagerPanel = isAdminScreen && isAdminLike
  const showDashboard = showManager && !isAdminScreen
  const reportsLink = isAdminScreen && isAdminLike ? '/admin/reports' : '/reports'
  const showBell = profile?.role === 'GERENTE'
  const activeLateCount = activeLatePauses.length
  const totalLateCount = lateCount + activeLateCount
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window
  const notificationIcon = `${import.meta.env.BASE_URL || '/'}logo-odontoart.png`
  const notificationPermission = notificationsSupported ? Notification.permission : 'unsupported'

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  const requestNotificationPermission = async () => {
    if (!notificationsSupported) return 'denied'
    if (Notification.permission === 'default') {
      try {
        const result = await Notification.requestPermission()
        return result
      } catch (err) {
        return Notification.permission
      }
    }
    return Notification.permission
  }

  const ensurePushSubscription = async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushReady(false)
      return
    }
    const permission = await requestNotificationPermission()
    if (permission !== 'granted') {
      setPushReady(false)
      return
    }

    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!vapidKey) {
      console.warn('[push] VITE_VAPID_PUBLIC_KEY not configured')
      setPushReady(false)
      return
    }

    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      })
    }
    await savePushSubscription(subscription)
    setPushReady(true)
  }

  const refreshPushStatus = async () => {
    if (!notificationsSupported || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      setPushReady(false)
      return
    }
    if (Notification.permission !== 'granted') {
      setPushReady(false)
      return
    }
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setPushReady(!!subscription)
    } catch (err) {
      setPushReady(false)
    }
  }

  const notify = (title, body, tag) => {
    if (!notificationsSupported) return
    if (Notification.permission !== 'granted') return
    try {
      new Notification(title, {
        body,
        icon: notificationIcon,
        tag: tag || title
      })
    } catch (err) {
      console.warn('[notifications] failed to show browser notification', err)
    }
  }

  const loadLatePauses = async () => {
    try {
      const { items, count } = await getLatePausesSummary({ fromDate: startOfToday(), limit: 5 })
      setLatePauses(items)
      setLateCount(count)
    } catch (err) {
      console.error('[notifications] failed to load late pauses', err?.message || err, err?.details || '')
    }
  }

  const loadActiveLatePauses = async () => {
    try {
      const data = await listActiveLatePauses({ limit: 20 })
      setActiveLatePauses(data || [])
    } catch (err) {
      console.error('[notifications] failed to load active late pauses', err?.message || err)
    }
  }

  useEffect(() => {
    if (!showBell) return
    loadLatePauses()
    loadActiveLatePauses()
  }, [showBell])

  useEffect(() => {
    if (!showBell) return
    if (!notificationsSupported) return
    if (Notification.permission === 'granted') {
      ensurePushSubscription()
    }
  }, [showBell])

  useEffect(() => {
    if (!showBell) return
    refreshPushStatus()
  }, [showBell, notificationPermission])

  useEffect(() => {
    if (!showBell || !profile?.id) return
    const channel = supabase
      .channel(`late-pauses-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pause_notifications',
          filter: `manager_id=eq.${profile.id}`
        },
        () => {
          loadLatePauses()
        }
      )
      .subscribe()

    const pausesChannel = supabase
      .channel(`late-pauses-updates-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pauses',
          filter: 'atraso=eq.true'
        },
        (payload) => {
          if (payload?.new?.ended_at) {
            loadLatePauses()
          }
        }
      )
      .subscribe()

    const activePausesChannel = supabase
      .channel(`active-pauses-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pauses'
        },
        () => loadActiveLatePauses()
      )
      .subscribe()

    const schedulesChannel = supabase
      .channel(`pause-schedules-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pause_schedules'
        },
        () => loadActiveLatePauses()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(pausesChannel)
      supabase.removeChannel(activePausesChannel)
      supabase.removeChannel(schedulesChannel)
    }
  }, [showBell, profile?.id])

  useEffect(() => {
    if (!bellOpen || !showBell) return
    loadLatePauses()
  }, [bellOpen, showBell])

  useEffect(() => {
    if (!showBell) return
    const interval = setInterval(() => {
      loadLatePauses()
      loadActiveLatePauses()
    }, 15000)
    return () => clearInterval(interval)
  }, [showBell])

  useEffect(() => {
    if (!showBell) return
    const prev = prevTotalLateRef.current
    if (totalLateCount > 0 && totalLateCount > prev) {
      setBellOpen(true)
    }
    prevTotalLateRef.current = totalLateCount
  }, [showBell, totalLateCount])

  useEffect(() => {
    if (!showBell || pushReady) return
    const currentIds = new Set(activeLatePauses.map((pause) => pause.pause_id))
    if (!activeInitRef.current) {
      activeInitRef.current = true
      prevActiveLateIdsRef.current = currentIds
      return
    }
    const prevIds = prevActiveLateIdsRef.current
    const newItems = activeLatePauses.filter((pause) => !prevIds.has(pause.pause_id))
    if (newItems.length) {
      setBellOpen(true)
      newItems.forEach((pause) => {
        notify(
          'Pausa atrasada em andamento',
          `${pause.agent_name} - ${pause.pause_type_label} • ${formatDuration(pause.elapsed_seconds)} / ${formatDuration(pause.limit_seconds)}`,
          `late-active-${pause.pause_id}`
        )
      })
    }
    prevActiveLateIdsRef.current = currentIds
  }, [showBell, activeLatePauses, pushReady])

  useEffect(() => {
    if (!showBell || pushReady) return
    const currentIds = new Set(latePauses.map((pause) => pause.pause_id))
    if (!lateInitRef.current) {
      lateInitRef.current = true
      prevLateIdsRef.current = currentIds
      return
    }
    const prevIds = prevLateIdsRef.current
    const newItems = latePauses.filter((pause) => !prevIds.has(pause.pause_id))
    if (newItems.length) {
      setBellOpen(true)
      newItems.forEach((pause) => {
        notify(
          'Pausa atrasada finalizada',
          `${pause.agent_name} - ${pause.pause_type_label} • ${formatDuration(pause.duration_seconds || 0)} • ${formatDateTime(pause.ended_at)}`,
          `late-finished-${pause.pause_id}`
        )
      })
    }
    prevLateIdsRef.current = currentIds
  }, [showBell, latePauses, pushReady])

  const handleMarkAllAsRead = async () => {
    try {
      await markAllLatePausesAsRead({ fromDate: startOfToday() })
      await loadLatePauses()
    } catch (err) {
      console.error('[notifications] failed to mark all as read', err)
    }
  }

  const handleToggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('theme-dark', next)
      }
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light')
      } catch (err) {
        console.warn('[theme] failed to persist theme', err)
      }
      return next
    })
  }

  return (
    <div className="px-6 py-5">
      <div className="card">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Controle de Pausas</p>
            <h1 className="font-display text-2xl font-semibold text-slate-900">Olá, {profile?.full_name || '...'}</h1>
            <span className="chip mt-2">{profile?.role || 'Sem role'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showAgent ? (
              <div className="flex flex-wrap items-center gap-2">
                {agentControls ? agentControls : null}
                <NavLink
                  to="/agent"
                  className={({ isActive }) =>
                    `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                  }
                >
                  Minha pausa
                </NavLink>
              </div>
            ) : null}
            {showManager ? (
              <div className="flex items-center gap-2">
                {showManagerPanel ? (
                  <NavLink
                    to="/manager"
                    className={({ isActive }) =>
                      `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                    }
                  >
                    Painel Gerente
                  </NavLink>
                ) : null}
                {showAdminPanel ? (
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                    }
                  >
                    Painel Admin
                  </NavLink>
                ) : null}
                {showDashboard ? (
                  <NavLink
                    to="/manager"
                    className={({ isActive }) =>
                      `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                    }
                  >
                    Dashboard
                  </NavLink>
                ) : null}
                {showBell ? (
                  <button
                    type="button"
                    className="btn-ghost relative h-10 w-10 px-0"
                    onClick={() => {
                      ensurePushSubscription()
                      setBellOpen((prev) => !prev)
                    }}
                  >
                    <span className="sr-only">Notificacoes</span>
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
                    {totalLateCount > 0 ? (
                      <span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">
                        {totalLateCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
              </div>
            ) : null}
            {showManager ? (
              <NavLink
                to={reportsLink}
                className={({ isActive }) =>
                  `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                }
              >
                Relatorios
              </NavLink>
            ) : null}
            {showAdmin ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `btn h-10 ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
                }
              >
                Admin
              </NavLink>
            ) : null}
            <button
              type="button"
              onClick={handleToggleTheme}
              className="btn-ghost h-10 text-slate-700"
              aria-pressed={isDark}
              aria-label={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
            >
              {isDark ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 3v2.5M12 18.5V21M4.22 4.22l1.77 1.77M18.01 18.01l1.77 1.77M3 12h2.5M18.5 12H21M4.22 19.78l1.77-1.77M18.01 5.99l1.77-1.77M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Tema claro</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M21 14.5A8.5 8.5 0 119.5 3a6.5 6.5 0 0011.5 11.5z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Tema escuro</span>
                </>
              )}
            </button>
            <button type="button" onClick={signOut} className="btn-secondary h-10">
              Sair
            </button>
          </div>
        </div>

        {showBell && bellOpen ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Atrasos de pausa</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {activeLateCount} em andamento • {lateCount} finalizadas hoje
                </span>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={ensurePushSubscription}
                  disabled={!notificationsSupported}
                  title={
                    !notificationsSupported
                      ? 'Navegador nao suporta notificacoes'
                      : notificationPermission === 'granted'
                        ? 'Notificacoes ja ativadas'
                        : 'Ativar notificacoes no navegador'
                  }
                >
                  {notificationPermission === 'granted' ? 'Notificacoes ativas' : 'Ativar notificacoes'}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={handleMarkAllAsRead}
                  disabled={!lateCount}
                >
                  Marcar todas como lidas
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {activeLatePauses.map((pause) => (
                <div key={pause.pause_id} className="rounded-lg border border-red-200 bg-red-50 px-2 py-2">
                  <p className="text-xs font-semibold text-slate-900">
                    {pause.agent_name} - {pause.pause_type_label}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Tempo: {formatDuration(pause.elapsed_seconds)} • Limite:{' '}
                    {formatDuration(pause.limit_seconds)} • Em andamento
                  </p>
                </div>
              ))}
              {latePauses.map((pause) => (
                <div key={pause.pause_id} className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-2">
                  <p className="text-xs font-semibold text-slate-900">
                    {pause.agent_name} - {pause.pause_type_label}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {formatDuration(pause.duration_seconds || 0)} • {formatDateTime(pause.ended_at)}
                  </p>
                </div>
              ))}
              {!latePauses.length && !activeLatePauses.length ? (
                <p className="text-xs text-slate-500">Sem atrasos hoje.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

