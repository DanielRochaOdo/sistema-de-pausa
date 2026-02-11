import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import AuthContext from './authContextStore'

const PROFILE_CACHE_KEY = 'pause-control.profile'
const SLOW_SESSION_MS = 6000
const SLOW_PROFILE_MS = 6000

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
  const profileRequestIdRef = useRef(0)
  const lastProfileUserIdRef = useRef(null)
  const slowSessionTimerRef = useRef(null)
  const slowProfileTimerRef = useRef(null)

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

  const startSlowSessionTimer = () => {
    setSlowSession(false)
    slowSessionTimerRef.current = setTimeout(() => {
      console.info('[auth] slowSession true after 6s')
      setSlowSession(true)
    }, SLOW_SESSION_MS)
  }

  const startSlowProfileTimer = () => {
    setSlowProfile(false)
    slowProfileTimerRef.current = setTimeout(() => {
      console.info('[auth] slowProfile true after 6s')
      setSlowProfile(true)
    }, SLOW_PROFILE_MS)
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
    setProfileLoading(true)
    setError(null)
    startSlowProfileTimer()

    try {
      console.info('[auth] loadProfile start userId=', userId)
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, team_id, manager_id')
        .eq('id', userId)
        .maybeSingle()

      if (requestId !== profileRequestIdRef.current) {
        return null
      }

      if (profileError) {
        console.error('[auth] loadProfile error', profileError)
        setProfile(null)
        setError(JSON.stringify(profileError))
        writeCachedProfile(null)
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
      console.error('[auth] loadProfile exception', err)
      setProfile(null)
      setError(String(err?.message || err))
      writeCachedProfile(null)
      return null
    } finally {
      if (requestId === profileRequestIdRef.current) {
        setProfileLoading(false)
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
    startSlowSessionTimer()

    try {
      console.info('[auth] init start')
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) {
        console.error('[auth] getSession error', sessionError)
        setError(JSON.stringify(sessionError))
      }

      const currentSession = data?.session ?? null
      setSession(currentSession)

      const userId = currentSession?.user?.id || null
      if (userId) {
        if (lastProfileUserIdRef.current !== userId) {
          const cached = readCachedProfile(userId)
          if (cached) setProfile(cached)
        }
        await loadProfile(userId)
        lastProfileUserIdRef.current = userId
      } else {
        setProfile(null)
        writeCachedProfile(null)
      }
      console.info('[auth] session loaded')
    } catch (err) {
      console.error('[auth] init exception', err)
      setSession(null)
      setProfile(null)
      writeCachedProfile(null)
      setError(String(err?.message || err))
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
      if (event === 'INITIAL_SESSION') return

      const nextUserId = nextSession?.user?.id || null
      setSession(nextSession)

      if (!nextUserId) {
        setProfile(null)
        writeCachedProfile(null)
        setProfileFetched(false)
        setLoading(false)
        setError(null)
        return
      }

      if (nextUserId === lastProfileUserIdRef.current && profile) {
        return
      }

      await loadProfile(nextUserId)
      lastProfileUserIdRef.current = nextUserId
    })

    return () => {
      clearSlowTimers()
      subscription.unsubscribe()
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
      const message = error?.context?.error || error.message || 'Falha ao resolver login'
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
      setSession(currentSession)
      const userId = currentSession?.user?.id || null
      if (userId) {
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
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setProfileFetched(false)
    setError(null)
    setSlowSession(false)
    setSlowProfile(false)
    clearSlowTimers()
    writeCachedProfile(null)
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
