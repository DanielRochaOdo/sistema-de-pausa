import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabaseClient'
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
    if (profile?.id) {
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
    const session = parsed?.currentSession || parsed?.session || parsed
    if (!session?.access_token || !session?.user?.id) return null
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
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token)
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY)
    }
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
    if (value) {
      localStorage.setItem(SESSION_LOGIN_AT_KEY, value)
    } else {
      localStorage.removeItem(SESSION_LOGIN_AT_KEY)
    }
  } catch (err) {
    console.error('[auth] failed to write session login_at', err)
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
  const isMobile = navigator.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
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
    if (loginAt) {
      writeSessionLoginAt(loginAt)
    } else {
      writeSessionLoginAt(null)
    }
  }

  const finalizeSessionTokenRegistration = (token, loginAt) => {
    sessionTokenPendingRef.current = null
    sessionTokenRef.current = token || null
    writeSessionToken(token || null)
    if (loginAt) {
      writeSessionLoginAt(loginAt)
    }
  }

  const isSessionExpired = (loginAt) => {
    if (!loginAt) return false
    const loginTime = new Date(loginAt).getTime()
    if (Number.isNaN(loginTime)) return false
    return Date.now() - loginTime > MAX_SESSION_AGE_MS
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

    if (!hasCached) {
      setProfileLoading(true)
    } else {
      setProfileLoading(false)
    }
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
          .select('id, full_name, role, team_id, manager_id, is_admin')
          .eq('id', userId)
          .maybeSingle(),
        PROFILE_TIMEOUT_MS,
        'PROFILE'
      )

      if (requestId !== profileRequestIdRef.current) {
        return null
      }

      if (profileError) {
        console.error('[auth] loadProfile error', profileError)
        if (!hasCached) {
          setError(JSON.stringify(profileError))
        }
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
      const message = String(err?.message || err)
      if (message.includes('_TIMEOUT')) {
        console.warn('[auth] loadProfile timeout, keeping cached profile')
      } else {
        console.error('[auth] loadProfile exception', err)
        if (!hasCached) {
          setError(message)
        }
      }
      return null
    } finally {
      if (requestId === profileRequestIdRef.current) {
        if (!hasCached) {
          setProfileLoading(false)
        }
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
        .select('session_token')
        .eq('user_id', userId)
        .order('login_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (tokenError) {
        console.warn('[auth] failed to load session token', tokenError)
        return null
      }
      if (data?.session_token) {
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

      const storedToken = data?.session_token || token
      const loginAt = data?.login_at || nowIso
      finalizeSessionTokenRegistration(storedToken, loginAt)
      return { token: storedToken, login_at: loginAt }
    } catch (err) {
      const message = String(err?.message || err)
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
        finalizeSessionTokenRegistration(null, data?.login_at || nowIso)
        return { token: null, login_at: data?.login_at || nowIso }
      }
      finalizeSessionTokenRegistration(null, null)
      throw err
    }
  }

  const bootstrapSession = async () => {
    setLoading(true)
    setError(null)
    setProfileFetched(false)
    const cachedSession = readCachedSession()
    const cachedUserId = cachedSession?.user?.id || null
    const cachedProfile = cachedUserId ? readCachedProfile(cachedUserId) : null
    const cachedLoginAt = readSessionLoginAt()

    if (cachedSession && isSessionExpired(cachedLoginAt)) {
      console.info('[auth] session expired by max age')
      sessionRef.current = cachedSession
      sessionTokenRef.current = readSessionToken()
      await signOut()
      setLoading(false)
      return
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
        if (!cachedSession) {
          setError(JSON.stringify(sessionError))
        }
      }

      const currentSession = data?.session ?? null
      if (currentSession || !cachedSession) {
        setSession(currentSession)
      }

      const userId = currentSession?.user?.id || cachedUserId || null
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
      const message = String(err?.message || err)
      if (message.includes('_TIMEOUT')) {
        console.warn('[auth] getSession timeout, keeping cached session')
      } else {
        console.error('[auth] init exception', err)
        if (!cachedSession) {
          setError(message)
        }
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
        const nextUserId = nextSession?.user?.id || null
        const loginAt = readSessionLoginAt()
        if (nextSession && isSessionExpired(loginAt)) {
          console.info('[auth] session expired by max age (auth state)')
          await signOut()
          return
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

          if (
            nextUserId !== lastProfileUserIdRef.current ||
            currentProfile?.id !== nextUserId
          ) {
            await loadProfile(nextUserId)
            lastProfileUserIdRef.current = nextUserId
          }
        }

      } catch (err) {
        console.error('[auth] auth state change error', err)
        setError(String(err?.message || err))

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

  useEffect(() => {
    const userId = session?.user?.id
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
              if (payload.new?.session_token && payload.new.session_token !== token) {
                forceSignOut()
              }
            }

            if (payload.eventType === 'UPDATE') {
              if (payload.new?.session_token === token && payload.new?.logout_at) {
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
  }, [session?.user?.id])

  useEffect(() => {
    const userId = session?.user?.id
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
  }, [session?.user?.id])

  const resolveLoginIdentifier = async (identifier) => {
    const value = String(identifier || '').trim()
    if (!value) throw new Error('Informe seu email ou nome completo')
    if (value.includes('@')) return value

    const { data, error } = await supabase.functions.invoke('resolve-login', {
      body: { identifier: value }
    })
    if (error) {
      let message = error?.message || 'Falha ao resolver login'
      const context = error?.context
      if (context && typeof context.json === 'function') {
        try {
          const parsed = await context.json()
          if (parsed?.error) message = parsed.error
        } catch (_) {
          // ignore parse errors
        }
      }
      throw new Error(message)
    }
    if (!data?.email) throw new Error('Nome nao encontrado')
    return data.email
  }

  const signIn = async (identifier, password) => {
    setLoading(true)
    setError(null)
    startSlowSessionTimer()
    try {
      const email = await resolveLoginIdentifier(identifier)
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

      const currentSession = data?.session ?? null
      const userId = currentSession?.user?.id || null
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
        await loadProfile(userId)
        lastProfileUserIdRef.current = userId
      }
    } catch (err) {
      console.error('[auth] signIn error', err)
      setError(String(err?.message || err))
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

  const signOut = async () => {
    try {
      const userId = sessionRef.current?.user?.id
      const token = sessionTokenRef.current || readSessionToken()
      if (userId) {
        const query = supabase
          .from('user_sessions')
          .update({ logout_at: new Date().toISOString() })
          .eq('user_id', userId)
          .is('logout_at', null)
        if (token) {
          query.eq('session_token', token)
        }
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
    writeCachedProfile(null)
    writeSessionToken(null)
    writeSessionLoginAt(null)
    sessionTokenRef.current = null
    sessionTokenPendingRef.current = null
    forcedSignOutRef.current = false
  }

  const refreshProfile = async () => {
    if (!session?.user?.id) return null
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
    [
      session,
      profile,
      loading,
      profileLoading,
      profileFetched,
      slowSession,
      slowProfile,
      error
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
