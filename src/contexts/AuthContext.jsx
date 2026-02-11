import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../services/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        console.error(error)
        return null
      }
      setProfile(data ?? null)
      return data ?? null
    } catch (err) {
      console.error(err)
      return null
    }
  }

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) console.error(error)
        if (!isMounted) return
        const currentSession = data?.session ?? null
        setSession(currentSession)
        if (currentSession?.user?.id) {
          await fetchProfile(currentSession.user.id)
        } else {
          setProfile(null)
        }
      } catch (err) {
        console.error(err)
        setSession(null)
        setProfile(null)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    init()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession)
      if (nextSession?.user?.id) {
        setLoading(true)
        try {
          await fetchProfile(nextSession.user.id)
        } finally {
          if (isMounted) setLoading(false)
        }
      } else {
        setProfile(null)
        if (isMounted) setLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email, password) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      if (data?.session?.user?.id) {
        await fetchProfile(data.session.user.id)
      }
    } finally {
      setLoading(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      signIn,
      signOut,
      refreshProfile: async () => {
        if (!session?.user?.id) return null
        setLoading(true)
        try {
          return await fetchProfile(session.user.id)
        } finally {
          setLoading(false)
        }
      }
    }),
    [session, profile, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
