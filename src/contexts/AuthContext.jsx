import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import { touchSipSession } from '../services/apiSip'
import AuthContext from './authContextStore'

const PROFILE_CACHE_KEY = 'pause-control.profile'
const AUTH_STORAGE_KEY = 'pause-control.auth'
const SESSION_TOKEN_KEY = 'pause-control.session-token'
const SESSION_LOGIN_AT_KEY = 'pause-control.session-login-at'
const SLOW_SESSION_MS = 6000
const SLOW_PROFILE_MS = 6000
const SESSION_TIMEOUT_MS = 8000
const PROFILE_TIMEOUT_MS = 8000
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000

const readCachedProfile = (userId) => {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.id !== userId) return null
    return parsed
  } catch (err) {
    console.error('[auth] failed to read profile cache', err)
    return null
  }
}

const writeCachedProfile = (profile) => {
  try {
    if (profile && profile.id) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY)
    }
  } catch (err) {
    console.error('[auth] failed to write profile cache', err)
  }
}

const readCachedSession = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const session = (parsed && (parsed.currentSession || parsed.session)) || parsed
    if (!session || !session.access_token || !session.user || !session.user.id) return null
    if (session.expires_at && Date.now() / 1000 > session.expires_at) return null
    return session
  } catch (err) {
    console.error('[auth] failed to read auth storage', err)
    return null
  }
}

const readSessionToken = () => {
  try {
    const token = localStorage.getItem(SESSION_TOKEN_KEY)
    return token || null
  } catch (err) {
    console.error('[auth] failed to read session token', err)
    return null
  }
}

const writeSessionToken = (token) => {
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token)
    else localStorage.removeItem(SESSION_TOKEN_KEY)
  } catch (err) {
    console.error('[auth] failed to write session token', err)
  }
}

const readSessionLoginAt = () => {
  try {
    const value = localStorage.getItem(SESSION_LOGIN_AT_KEY)
    return value || null
  } catch (err) {
    console.error('[auth] failed to read session login_at', err)
    return null
  }
}

const writeSessionLoginAt = (value) => {
  try {
    if (value) localStorage.setItem(SESSION_LOGIN_AT_KEY, value)
    else localStorage.removeItem(SESSION_LOGIN_AT_KEY)
  } catch (err) {
    console.error('[auth] failed to write session login_at', err)
  }
}

const clearAuthStorage = () => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch (err) {
    console.error('[auth] failed to clear auth storage', err)
  }
}

const createSessionToken = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const withTimeout = (promise, ms, label) => {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${label}_TIMEOUT`)
      err.code = 'TIMEOUT'
      reject(err)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

const detectDeviceType = () => {
  const isMobile =
    (navigator.userAgentData && navigator.userAgentData.mobile) ||
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  return isMobile ? 'mobile' : 'desktop'
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileFetched, setProfileFetched] = useState(false)
  const [slowSession, setSlowSession] = useState(false)
  const [slowProfile, setSlowProfile] = useState(false)
  const [error, setError] = useState(null)

  const didInitRef = useRef(false)
  const profileRef = useRef(null)
  const sessionRef = useRef(null)
  const errorRef = useRef(null)
  const sessionTokenRef = useRef(null)
  const sessionTokenPendingRef = useRef(null)
  const forcedSignOutRef = useRef(false)
  const sessionGuardBusyRef = useRef(false)
  const profileRequestIdRef = useRef(0)
  const lastProfileUserIdRef = useRef(null)
  const slowSessionTimerRef = useRef(null)
  const slowProfileTimerRef = useRef(null)

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    errorRef.current = error
  }, [error])

  useEffect(() => {
    sessionTokenRef.current = readSessionToken()
  }, [])

  const clearSlowTimers = () => {
    if (slowSessionTimerRef.current) {
      clearTimeout(slowSessionTimerRef.current)
      slowSessionTimerRef.current = null
    }
    if (slowProfileTimerRef.current) {
      clearTimeout(slowProfileTimerRef.current)
      slowProfileTimerRef.current = null
    }
  }

  const startSlowSessionTimer = (shouldStart = true) => {
    setSlowSession(false)
    if (!shouldStart) return
    slowSessionTimerRef.current = setTimeout(() => {
      console.info('[auth] slowSession true after 6s')
      setSlowSession(true)
    }, SLOW_SESSION_MS)
  }

  const startSlowProfileTimer = (shouldStart = true) => {
    setSlowProfile(false)
    if (!shouldStart) return
    slowProfileTimerRef.current = setTimeout(() => {
      console.info('[auth] slowProfile true after 6s')
      setSlowProfile(true)
    }, SLOW_PROFILE_MS)
  }

  const beginSessionTokenRegistration = (token, loginAt) => {
    if (!token) return
    if (sessionTokenPendingRef.current === token) return
    sessionTokenPendingRef.current = token
    sessionTokenRef.current = null
    writeSessionToken(null)
    if (loginAt) writeSessionLoginAt(loginAt)
    else writeSessionLoginAt(null)
  }

  const finalizeSessionTokenRegistration = (token, loginAt) => {
    sessionTokenPendingRef.current = null
    sessionTokenRef.current = token || null
    writeSessionToken(token || null)
    if (loginAt) writeSessionLoginAt(loginAt)
  }

  // ✅ utilitário: quando “passou 12h”, limpar só marcadores locais (sem derrubar login)
  const clearLocalSessionMarkers = (reason) => {
    console.info('[auth] clearLocalSessionMarkers:', reason)
    writeSessionToken(null)
    writeSessionLoginAt(null)
    clearAuthStorage()
    sessionTokenRef.current = null
    sessionTokenPendingRef.current = null
    forcedSignOutRef.current = false
  }

  const isSessionExpired = (loginAt) => {
    if (!loginAt) return false
    const loginTime = new Date(loginAt).getTime()
    if (Number.isNaN(loginTime)) return false
    return Date.now() - loginTime > MAX_SESSION_AGE_MS
  }

  const resolveSessionLoginAt = (sess, cachedLoginAt) => {
    if (cachedLoginAt) return cachedLoginAt
    const candidate = sess && sess.user && sess.user.last_sign_in_at
    if (!candidate) return null
    const normalized = String(candidate)
    writeSessionLoginAt(normalized)
    return normalized
  }

  const isAuthFailure = (err) => {
    if (!err) return false
    const status = err.status ?? err.code
    if (status === 401 || status === '401') return true
    const message = String((err && err.message) || '')
    return /invalid jwt|jwt expired|refresh token|token has expired|not authorized/i.test(message)
  }

  const loadProfile = async (userId) => {
    if (!userId) {
      setProfile(null)
      setProfileFetched(true)
      setProfileLoading(false)
      setSlowProfile(false)
      setError(null)
      writeCachedProfile(null)
      return null
    }

    const requestId = ++profileRequestIdRef.current
    const cached = readCachedProfile(userId)
    const hasCached = !!cached

    if (!hasCached) setProfileLoading(true)
    else setProfileLoading(false)

    setError(null)
    startSlowProfileTimer(!hasCached)

    if (cached) {
      setProfile(cached)
      writeCachedProfile(cached)
    }

    try {
      console.info('[auth] loadProfile start userId=', userId)
      const { data, error: profileError } = await withTimeout(
        supabase
          .from('profiles')
          .select('id, full_name, role, team_id, manager_id, is_admin, sip_default_extension')
          .eq('id', userId)
          .maybeSingle(),
        PROFILE_TIMEOUT_MS,
        'PROFILE'
      )

      if (requestId !== profileRequestIdRef.current) return null

      if (profileError) {
        console.error('[auth] loadProfile error', profileError)
        if (!hasCached) setError(JSON.stringify(profileError))
        return null
      }

      if (!data) {
        console.warn('[auth] profile not found')
        setProfile(null)
        setError('PROFILE_NOT_FOUND')
        writeCachedProfile(null)
        return null
      }

      setProfile(data)
      writeCachedProfile(data)
      setError(null)
      console.info('[auth] loadProfile done role=', data.role)
      return data
    } catch (err) {
      if (requestId !== profileRequestIdRef.current) return null
      const message = String((err && err.message) || err)
      if (message.includes('_TIMEOUT')) {
        console.warn('[auth] loadProfile timeout, keeping cached profile')
      } else {
        console.error('[auth] loadProfile exception', err)
        if (!hasCached) setError(message)
      }
      return null
    } finally {
      if (requestId === profileRequestIdRef.current) {
        if (!hasCached) setProfileLoading(false)
        setProfileFetched(true)
        setSlowProfile(false)
      }
      if (slowProfileTimerRef.current) {
        clearTimeout(slowProfileTimerRef.current)
        slowProfileTimerRef.current = null
      }
    }
  }

  const ensureSessionToken = async (userId) => {
    const pending = sessionTokenPendingRef.current
    if (pending) return pending

    const existing = sessionTokenRef.current || readSessionToken()
    if (existing) {
      sessionTokenRef.current = existing
      return existing
    }
    if (!userId) return null

    try {
      const { data, error: tokenError } = await supabase
        .from('user_sessions')
        .select('session_token, login_at')
        .eq('user_id', userId)
        .order('login_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (tokenError) {
        console.warn('[auth] failed to load session token', tokenError)
        return null
      }

      if (data && data.login_at && !readSessionLoginAt()) {
        writeSessionLoginAt(data.login_at)
      }

      if (data && data.session_token) {
        sessionTokenRef.current = data.session_token
        writeSessionToken(data.session_token)
        return data.session_token
      }
    } catch (err) {
      console.warn('[auth] failed to ensure session token', err)
    }

    return null
  }

  const registerSession = async (userId, { closeOthers = true, token: forcedToken } = {}) => {
    if (!userId) return null
    const token = forcedToken || createSessionToken()
    const nowIso = new Date().toISOString()

    beginSessionTokenRegistration(token)

    if (closeOthers) {
      await supabase
        .from('user_sessions')
        .update({ logout_at: nowIso })
        .eq('user_id', userId)
        .is('logout_at', null)
    }

    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .insert({
          user_id: userId,
          session_token: token,
          device_type: detectDeviceType(),
          user_agent: navigator.userAgent
        })
        .select('session_token, login_at')
        .single()

      if (error) throw error

      const storedToken = (data && data.session_token) || token
      const loginAt = (data && data.login_at) || nowIso
      finalizeSessionTokenRegistration(storedToken, loginAt)
      return { token: storedToken, login_at: loginAt }
    } catch (err) {
      const message = String((err && err.message) || err)
      if (message.includes('session_token') && message.includes('does not exist')) {
        const { data, error } = await supabase
          .from('user_sessions')
          .insert({
            user_id: userId,
            device_type: detectDeviceType(),
            user_agent: navigator.userAgent
          })
          .select('login_at')
          .single()

        if (error) throw error

        finalizeSessionTokenRegistration(null, (data && data.login_at) || nowIso)
        return { token: null, login_at: (data && data.login_at) || nowIso }
      }

      finalizeSessionTokenRegistration(null, null)
      throw err
    }
  }

  const signOut = async () => {
    try {
      const currentRole = profileRef.current && profileRef.current.role
      if (currentRole === 'AGENTE_SIP') {
        const { error: sipEndError } = await supabase.rpc('sip_end_session')
        if (sipEndError && sessionRef.current?.user?.id) {
          await supabase
            .from('sip_sessions')
            .update({ logout_at: new Date().toISOString() })
            .eq('agent_id', sessionRef.current.user.id)
            .is('logout_at', null)
        }
      }
    } catch (sipErr) {
      console.warn('[auth] failed to end sip session on sign out', sipErr)
    }

    try {
      const userId = sessionRef.current && sessionRef.current.user && sessionRef.current.user.id
      const token = sessionTokenRef.current || readSessionToken()
      if (userId) {
        let query = supabase
          .from('user_sessions')
          .update({ logout_at: new Date().toISOString() })
          .eq('user_id', userId)
          .is('logout_at', null)

        if (token) query = query.eq('session_token', token)
        await query
      }
    } catch (sessionErr) {
      console.warn('[auth] failed to close session', sessionErr)
    }

    try {
      await supabase.auth.signOut()
    } catch (signOutErr) {
      console.warn('[auth] failed to sign out', signOutErr)
    }

    setSession(null)
    setProfile(null)
    setProfileFetched(false)
    setError(null)
    setSlowSession(false)
    setSlowProfile(false)
    clearSlowTimers()
    clearAuthStorage()
    writeCachedProfile(null)
    writeSessionToken(null)
    writeSessionLoginAt(null)
    sessionTokenRef.current = null
    sessionTokenPendingRef.current = null
    forcedSignOutRef.current = false
  }

  const bootstrapSession = async () => {
    setLoading(true)
    setError(null)
    setProfileFetched(false)

    // evita pending preso por crash
    sessionTokenPendingRef.current = null

    const cachedSession = readCachedSession()
    const cachedUserId = cachedSession && cachedSession.user ? cachedSession.user.id : null
    const cachedProfile = cachedUserId ? readCachedProfile(cachedUserId) : null
    const cachedLoginAt = readSessionLoginAt()

    // ✅ CORREÇÃO: não derruba login por 12h. Só limpa marcadores locais.
    if (cachedLoginAt && isSessionExpired(cachedLoginAt)) {
      clearLocalSessionMarkers('bootstrap: cachedLoginAt expired')
    }

    if (cachedSession) {
      setSession(cachedSession)
      if (cachedProfile) setProfile(cachedProfile)
      await ensureSessionToken(cachedUserId)
    }

    startSlowSessionTimer(!cachedSession)

    try {
      console.info('[auth] init start')
      const { data, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_TIMEOUT_MS,
        'SESSION'
      )

      if (sessionError) {
        console.error('[auth] getSession error', sessionError)
        if (!cachedSession) setError(JSON.stringify(sessionError))
      }

      if (sessionError && isAuthFailure(sessionError)) {
        console.warn('[auth] invalid session detected, signing out')
        await signOut()
        return
      }

      const currentSession = (data && data.session) || null

      if (currentSession) {
        const effectiveLoginAt = resolveSessionLoginAt(currentSession, readSessionLoginAt())

        // ✅ CORREÇÃO: não signOut por max age; só limpa marcadores
        if (effectiveLoginAt && isSessionExpired(effectiveLoginAt)) {
          clearLocalSessionMarkers('bootstrap: currentSession exceeded max age')
        }
      }

      if (currentSession || !cachedSession) {
        setSession(currentSession)
      }

      const userId =
        (currentSession && currentSession.user && currentSession.user.id) ||
        cachedUserId ||
        null

      if (userId) {
        if (lastProfileUserIdRef.current !== userId) {
          const cached = cachedProfile || readCachedProfile(userId)
          if (cached) setProfile(cached)
        }

        if (currentSession || !cachedProfile) {
          await loadProfile(userId)
        } else {
          setProfileFetched(true)
        }

        lastProfileUserIdRef.current = userId

        if (!sessionTokenRef.current && !readSessionToken()) {
          try {
            await registerSession(userId, { closeOthers: true })
          } catch (sessionErr) {
            console.warn('[auth] failed to register session on init', sessionErr)
          }
        }
      } else if (!cachedSession) {
        setProfile(null)
        writeCachedProfile(null)
      }

      console.info('[auth] session loaded')
    } catch (err) {
      const message = String((err && err.message) || err)
      if (message.includes('_TIMEOUT')) {
        console.warn('[auth] getSession timeout, keeping cached session')
      } else {
        console.error('[auth] init exception', err)
        if (!cachedSession) setError(message)
      }

      if (!cachedSession) {
        setSession(null)
        setProfile(null)
        writeCachedProfile(null)
      }
    } finally {
      setLoading(false)
      setSlowSession(false)
      if (slowSessionTimerRef.current) {
        clearTimeout(slowSessionTimerRef.current)
        slowSessionTimerRef.current = null
      }
      console.info('[auth] init end')
    }
  }

  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    bootstrapSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      console.info('[auth] onAuthStateChange event=', event)

      setLoading(true)
      setError(null)
      startSlowSessionTimer()

      try {
        const nextUserId = nextSession && nextSession.user ? nextSession.user.id : null
        const cachedLoginAt = readSessionLoginAt()
        const effectiveLoginAt = resolveSessionLoginAt(nextSession, cachedLoginAt)

        // ✅ CORREÇÃO: não signOut automático por max age
        if (nextSession && effectiveLoginAt && isSessionExpired(effectiveLoginAt)) {
          clearLocalSessionMarkers('authState: exceeded max age')
        }

        setSession(nextSession)

        if (!nextUserId) {
          setProfile(null)
          writeCachedProfile(null)
          setProfileFetched(false)
          lastProfileUserIdRef.current = null
          sessionTokenPendingRef.current = null
          writeSessionToken(null)
          writeSessionLoginAt(null)
          sessionTokenRef.current = null
          forcedSignOutRef.current = false
        } else {
          const currentProfile = profileRef.current
          if (nextUserId !== lastProfileUserIdRef.current || !currentProfile || currentProfile.id !== nextUserId) {
            await loadProfile(nextUserId)
            lastProfileUserIdRef.current = nextUserId
          } else {
            setProfileFetched(true)
          }
        }
      } catch (err) {
        console.error('[auth] auth state change error', err)
        setError(String((err && err.message) || err))
      } finally {
        setLoading(false)
        setSlowSession(false)
        if (slowSessionTimerRef.current) {
          clearTimeout(slowSessionTimerRef.current)
          slowSessionTimerRef.current = null
        }
      }
    })

    return () => {
      clearSlowTimers()
      subscription.unsubscribe()
    }
  }, [])

  // Realtime: expulsa se outra sessão inserir token diferente, ou se logout_at do token atual for setado
  useEffect(() => {
    const userId = session && session.user ? session.user.id : null
    if (!userId) return

    let isMounted = true

    const forceSignOut = async () => {
      if (forcedSignOutRef.current) return
      forcedSignOutRef.current = true
      await signOut()
    }

    const init = async () => {
      await ensureSessionToken(userId)
      if (!isMounted) return

      const channel = supabase
        .channel(`user-sessions-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_sessions',
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            if (forcedSignOutRef.current) return
            if (sessionTokenPendingRef.current) return

            const token = sessionTokenRef.current || readSessionToken()
            if (!token) return

            if (payload.eventType === 'INSERT') {
              if (payload.new && payload.new.session_token && payload.new.session_token !== token) {
                forceSignOut()
              }
            }

            if (payload.eventType === 'UPDATE') {
              if (payload.new && payload.new.session_token === token && payload.new.logout_at) {
                forceSignOut()
              }
            }
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    let cleanup
    init().then((dispose) => {
      cleanup = dispose
    })

    return () => {
      isMounted = false
      if (cleanup) cleanup()
    }
  }, [session && session.user ? session.user.id : null])

  useEffect(() => {
    const userId = session && session.user ? session.user.id : null
    const role = profile && profile.role ? profile.role : null
    if (!userId || role !== 'AGENTE_SIP') return

    let disposed = false
    const tick = async () => {
      if (disposed) return
      try {
        await touchSipSession()
      } catch (err) {
        console.warn('[auth] sip heartbeat failed', err)
      }
    }

    tick()
    const interval = setInterval(tick, 20000)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [session && session.user ? session.user.id : null, profile && profile.role ? profile.role : null])

  // Guard: verifica no banco a sessão mais recente
  useEffect(() => {
    const userId = session && session.user ? session.user.id : null
    if (!userId) return

    let alive = true

    const forceSignOut = async () => {
      if (forcedSignOutRef.current) return
      forcedSignOutRef.current = true
      await signOut()
    }

    const checkLatestSession = async () => {
      if (!alive || sessionGuardBusyRef.current || forcedSignOutRef.current) return
      if (sessionTokenPendingRef.current) return

      const effectiveLoginAt = resolveSessionLoginAt(sessionRef.current, readSessionLoginAt())

      // ✅ CORREÇÃO: NÃO derrubar por 12h no guard.
      // Se quiser “forçar re-login” por 12h, faça via UI/aviso, não via signOut automático.
      if (effectiveLoginAt && isSessionExpired(effectiveLoginAt)) {
        clearLocalSessionMarkers('sessionGuard: exceeded max age')
        // continua o guard sem forçar logout
      }

      sessionGuardBusyRef.current = true
      try {
        const { data, error } = await supabase
          .from('user_sessions')
          .select('session_token, login_at, logout_at')
          .eq('user_id', userId)
          .order('login_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (error) {
          console.warn('[auth] session guard failed', error)
          return
        }
        if (!data) return

        const localToken = sessionTokenRef.current || readSessionToken()
        const localLoginAt = readSessionLoginAt()

        if (localToken && data.session_token && data.session_token !== localToken) {
          await forceSignOut()
          return
        }

        if (localToken && data.session_token === localToken && data.logout_at) {
          await forceSignOut()
          return
        }

        if (!localToken && localLoginAt && data.login_at) {
          const localTime = new Date(localLoginAt).getTime()
          const remoteTime = new Date(data.login_at).getTime()
          if (remoteTime > localTime + 1000) {
            await forceSignOut()
            return
          }
        }

        if (!localToken && !localLoginAt && data.login_at) {
          writeSessionLoginAt(data.login_at)
        }
      } catch (err) {
        console.warn('[auth] session guard exception', err)
      } finally {
        sessionGuardBusyRef.current = false
      }
    }

    checkLatestSession()
    const interval = setInterval(checkLatestSession, 15000)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [session && session.user ? session.user.id : null])

  const resolveLoginIdentifier = async (identifier, expectedRoles = []) => {
    const value = String(identifier || '').trim()
    if (!value) throw new Error('Informe seu email ou nome completo')
    if (value.includes('@')) return value

    const normalizedExpectedRoles = Array.isArray(expectedRoles)
      ? expectedRoles
          .map((item) => String(item || '').trim().toUpperCase())
          .filter(Boolean)
      : []

    const { data, error } = await supabase.functions.invoke('resolve-login', {
      body: { identifier: value, expected_roles: normalizedExpectedRoles }
    })

    if (error) {
      let message = error.message || 'Falha ao resolver login'
      const context = error.context
      if (context && typeof context.json === 'function') {
        try {
          const parsed = await context.json()
          if (parsed && parsed.error) message = parsed.error
        } catch (_) {
          // ignore parse errors
        }
      }
      throw new Error(message)
    }

    if (!data || !data.email) throw new Error('Nome nao encontrado')
    return data.email
  }

  const signIn = async (identifier, password, options = {}) => {
    const expectedRoles = Array.isArray(options?.expectedRoles)
      ? options.expectedRoles
          .map((item) => String(item || '').trim().toUpperCase())
          .filter(Boolean)
      : []
    setLoading(true)
    setError(null)
    startSlowSessionTimer()

    try {
      const email = await resolveLoginIdentifier(identifier, expectedRoles)
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (signInError) throw signInError

      try {
        await supabase.auth.signOut({ scope: 'others' })
      } catch (signOutErr) {
        console.warn('[auth] failed to sign out other sessions', signOutErr)
      }

      const currentSession = (data && data.session) || null
      const userId = currentSession && currentSession.user ? currentSession.user.id : null

      let pendingToken = null
      if (userId) {
        const loginAt = new Date().toISOString()
        pendingToken = createSessionToken()
        beginSessionTokenRegistration(pendingToken, loginAt)
      }

      setSession(currentSession)

      if (userId) {
        try {
          await registerSession(userId, { closeOthers: true, token: pendingToken })
        } catch (sessionErr) {
          console.warn('[auth] failed to register session', sessionErr)
        }
        const loadedProfile = await loadProfile(userId)
        if (expectedRoles.length) {
          const role = String(loadedProfile?.role || '').toUpperCase()
          if (!role || !expectedRoles.includes(role)) {
            await signOut()
            throw new Error('Esse acesso nao e permitido neste painel de login')
          }
        }
        lastProfileUserIdRef.current = userId
      }
    } catch (err) {
      console.error('[auth] signIn error', err)
      setError(String((err && err.message) || err))
      throw err
    } finally {
      setLoading(false)
      setSlowSession(false)
      if (slowSessionTimerRef.current) {
        clearTimeout(slowSessionTimerRef.current)
        slowSessionTimerRef.current = null
      }
    }
  }

  const refreshProfile = async () => {
    if (!session || !session.user || !session.user.id) return null
    return loadProfile(session.user.id)
  }

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      profileLoading,
      profileFetched,
      slowSession,
      slowProfile,
      error,
      signIn,
      signOut,
      refreshProfile,
      retry: bootstrapSession
    }),
    [session, profile, loading, profileLoading, profileFetched, slowSession, slowProfile, error]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
