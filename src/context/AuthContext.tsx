import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../lib/adminApi'
import type { AccountTierCode } from '../lib/accountTiers'

export interface UserProfile {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  role: UserRole
  account_tier_id: AccountTierCode
  created_at: string
}

export interface AuthContextValue {
  user: User | null
  loading: boolean
  profile: UserProfile | null
  profileLoading: boolean
  signUp: (name: string, email: string, password: string, extraData?: Record<string, unknown>, emailRedirectTo?: string) => Promise<{ error: Error | null; session: Session | null }>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (password: string) => Promise<{ error: Error | null }>
  updateProfile: (updates: Partial<Pick<UserProfile, 'name' | 'avatar_url'>>) => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileState, setProfileState] = useState<{ userId: string; profile: UserProfile | null } | null>(null)
  const profile = user && profileState?.userId === user.id ? profileState.profile : null
  const profileLoading = !!user && (!profileState || profileState.userId !== user.id)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('users')
      .select('id, email, name, avatar_url, role, account_tier_id, created_at')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) setProfileState({ userId: user.id, profile: (data as UserProfile) ?? null })
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function signUp(name: string, email: string, password: string, extraData?: Record<string, unknown>, emailRedirectTo?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, ...extraData }, emailRedirectTo },
    })
    return { error, session: data?.session ?? null }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    return { error }
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    return { error }
  }

  function updateProfile(updates: Partial<Pick<UserProfile, 'name' | 'avatar_url'>>) {
    setProfileState(prev => prev ? { ...prev, profile: prev.profile ? { ...prev.profile, ...updates } : prev.profile } : prev)
  }

  return (
    <AuthContext.Provider value={{ user, loading, profile, profileLoading, signUp, signIn, signOut, resetPassword, updatePassword, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
