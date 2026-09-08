import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AppRole } from './schema'
import { supabase } from './supabase'

type AuthState = {
  session: Session | null
  role: AppRole | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

async function fetchRole(userId: string): Promise<AppRole | null> {
  // RLS: a user may read their own profiles row (profiles_select_self_or_admin).
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.warn('could not read profile role:', error.message)
    return null
  }
  return (data?.role as AppRole | undefined) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      setRole(data.session ? await fetchRole(data.session.user.id) : null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return
      setSession(next)
      setRole(next ? await fetchRole(next.user.id) : null)
      setLoading(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      role,
      loading,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, role, loading],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
