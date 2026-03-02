import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import AuthContext from './authContextStore'

const PROFILE_CACHE_KEY = 'pause-control.profile'
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

const isSessionExpired = (loginAt) => {
  if (!loginAt) return false
  const t = new Date(loginAt).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t > MAX_SESSION_AGE_MS
}

const resolveSessionLoginAt = (session, cachedLoginAt) => {
  if (cachedLoginAt) return cachedLoginAt
  const candidate = session && session.user && session.user.last_sign_in_at
  if (!candidate) return null
  const normalized = String(candidate)
  writeSessionLoginAt(normalized)
  return normalized
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

const isAuthFailure = (err) => {
  if (!err) return false
  const status = err.status ?? err.code
  if (status === 401 || status === '401') return true
  const msg = String((err && err.message) || '')
  return /invalid jwt|jwt expired|refresh token|token has expired|not authorized/i.test(msg)
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
  const profileReqRef = useRef(0)
  const slowSessionTimerRef = useRef(null)
  const slowProfileTimerRef = useRef(null)

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

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

  const startSlowSessionTimer = (enabled) => {
    setSlowSession(false)
    if (!enabled) return
    slowSessionTimerRef.current = setTimeout(() => {
      setSlowSession(true)
      console.info('[auth] slowSession true after 6s')
    }, SLOW_SESSION_MS)
  }

  const startSlowProfileTimer = (enabled) => {
    setSlowProfile(false)
    if (!enabled) return
    slowProfileTimerRef.current = setTimeout(() => {
      setSlowProfile(true)
      console.info('[auth] slowProfile true after 6s')
    }, SLOW_PROFILE_MS)
  }

  const loadProfile = async (userId) => {
    if (!userId) {
      setProfile(null)
      setProfileFetched(true)
      setProfileLoading(false)
      setSlowProfile(false)
      writeCachedProfile(null)
      return null
    }

    const reqId = ++profileReqRef.current
    const cached = readCachedProfile(userId)
    const hasCached = !!cached

    if (!hasCached) setProfileLoading(true)
    setError(null)
    startSlowProfileTimer(!hasCached)

    if (cached) setProfile(cached)

    try {
      const { data, error: profileError } = await withTimeout(
        supabase
          .from('profiles')
          .select('id, full_name, role, team_id, manager_id')
          .eq('id', userId)
          .maybeSingle(),
        PROFILE_TIMEOUT_MS,
        'PROFILE'
      )

      if (reqId !== profileReqRef.current) return null

      if (profileError) {
        console.error('[auth] loadProfile error', profileError)
        if (!hasCached) setError(JSON.stringify(profileError))
        return null
      }

      if (!data) {
        setProfile(null)
        setError('PROFILE_NOT_FOUND')
        writeCachedProfile(null)
        return null
      }

      setProfile(data)
      writeCachedProfile(data)
      setError(null)
      return data
    } catch (err) {
      if (reqId !== profileReqRef.current) return null
      const msg = String((err && err.message) || err)
      if (msg.includes('_TIMEOUT')) {
        console.warn('[auth] loadProfile timeout (keeping cached)')
      } else {
        console.error('[auth] loadProfile exception', err)
        if (!hasCached) setError(msg)
      }
      return null
    } finally {
      if (reqId === profileReqRef.current) {
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

  const bootstrapSession = async () => {
    setLoading(true)
    setError(null)
    setProfileFetched(false)
    startSlowSessionTimer(true)

    try {
      const cachedLoginAt = readSessionLoginAt()
      if (cachedLoginAt && isSessionExpired(cachedLoginAt)) {
        // ✅ não trava login: só limpa marcador local
        writeSessionLoginAt(null)
      }

      const { data, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_TIMEOUT_MS,
        'SESSION'
      )

      if (sessionError) {
        console.error('[auth] getSession error', sessionError)
        if (isAuthFailure(sessionError)) {
          await supabase.auth.signOut()
        }
      }

      const currentSession = (data && data.session) || null
      setSession(currentSession)

      if (currentSession && currentSession.user && currentSession.user.id) {
        const effectiveLoginAt = resolveSessionLoginAt(currentSession, readSessionLoginAt())
        if (effectiveLoginAt && isSessionExpired(effectiveLoginAt)) {
          // ✅ não forçar signOut automático
          writeSessionLoginAt(null)
        }
        await loadProfile(currentSession.user.id)
      } else {
        setProfile(null)
        writeCachedProfile(null)
        setProfileFetched(true)
      }
    } catch (err) {
      const msg = String((err && err.message) || err)
      console.error('[auth] bootstrap exception', err)
      if (!msg.includes('_TIMEOUT')) setError(msg)
      setSession(null)
      setProfile(null)
      writeCachedProfile(null)
      setProfileFetched(true)
    } finally {
      setLoading(false)
      setSlowSession(false)
      if (slowSessionTimerRef.current) {
        clearTimeout(slowSessionTimerRef.current)
        slowSessionTimerRef.current = null
      }
    }
  }

  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true

    bootstrapSession()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setLoading(true)
      setError(null)
      startSlowSessionTimer(true)

      try {
        setSession(nextSession || null)

        const userId = nextSession && nextSession.user && nextSession.user.id
        if (!userId) {
          setProfile(null)
          writeCachedProfile(null)
          setProfileFetched(true)
          return
        }

        const effectiveLoginAt = resolveSessionLoginAt(nextSession, readSessionLoginAt())
        if (effectiveLoginAt && isSessionExpired(effectiveLoginAt)) {
          // ✅ não forçar signOut
          writeSessionLoginAt(null)
        }

        const currentProfile = profileRef.current
        if (!currentProfile || currentProfile.id !== userId) {
          await loadProfile(userId)
        } else {
          setProfileFetched(true)
        }
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
      if (sub && sub.subscription) sub.subscription.unsubscribe()
    }
  }, [])

  const resolveLoginIdentifier = async (identifier) => {
    const value = String(identifier || '').trim()
    if (!value) throw new Error('Informe seu email ou nome completo')
    if (value.includes('@')) return value

    const { data, error } = await supabase.functions.invoke('resolve-login', {
      body: { identifier: value }
    })

    if (error) {
      const message = error.message || 'Falha ao resolver login'
      throw new Error(message)
    }

    if (!data || !data.email) throw new Error('Nome nao encontrado')
    return data.email
  }

  const signIn = async (identifier, password) => {
    setLoading(true)
    setError(null)
    startSlowSessionTimer(true)

    try {
      const email = await resolveLoginIdentifier(identifier)
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (signInError) throw signInError

      const currentSession = (data && data.session) || null
      setSession(currentSession)

      if (currentSession && currentSession.user && currentSession.user.id) {
        writeSessionLoginAt(new Date().toISOString())
        await loadProfile(currentSession.user.id)
      }
    } catch (err) {
      const msg = String((err && err.message) || err)
      setError(msg)
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
      await supabase.auth.signOut()
    } catch (err) {
      console.warn('[auth] signOut error', err)
    }
    setSession(null)
    setProfile(null)
    setProfileFetched(false)
    setError(null)
    setSlowSession(false)
    setSlowProfile(false)
    clearSlowTimers()
    writeCachedProfile(null)
    writeSessionLoginAt(null)
  }

  const refreshProfile = async () => {
    const userId = sessionRef.current && sessionRef.current.user && sessionRef.current.user.id
    if (!userId) return null
    return loadProfile(userId)
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