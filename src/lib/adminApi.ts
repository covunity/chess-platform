import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTierCode } from './accountTiers'

export type UserRole = 'learner' | 'creator' | 'admin'

export interface AdminUser {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  role: UserRole
  account_tier_id: AccountTierCode
  created_at: string
}

export interface ListUsersResult {
  users: AdminUser[]
  total: number
  error: Error | null
}

export async function listUsers(
  client: SupabaseClient,
  options: { page?: number; pageSize?: number; search?: string } = {}
): Promise<ListUsersResult> {
  const { page = 1, pageSize = 20, search = '' } = options
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = client
    .from('users')
    .select('id, email, name, avatar_url, role, account_tier_id, created_at', { count: 'exact' })
    .range(from, to)
    .order('created_at', { ascending: false })

  if (search.trim()) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data, count, error } = await query
  return { users: (data as AdminUser[]) ?? [], total: count ?? 0, error: error as Error | null }
}

export async function changeUserAccountTier(
  client: SupabaseClient,
  userId: string,
  tierCode: AccountTierCode
): Promise<{ user: AdminUser | null; error: Error | null }> {
  const { data, error } = await client.rpc('change_user_account_tier', {
    target_user_id: userId,
    new_tier: tierCode,
  })
  return { user: (data as AdminUser) ?? null, error: error as Error | null }
}

export async function changeUserRole(
  client: SupabaseClient,
  userId: string,
  newRole: UserRole
): Promise<{ user: AdminUser | null; error: Error | null }> {
  const { data, error } = await client
    .from('users')
    .update({ role: newRole })
    .eq('id', userId)
    .select('id, email, name, avatar_url, role, account_tier_id, created_at')
    .single()

  return { user: (data as AdminUser) ?? null, error: error as Error | null }
}
