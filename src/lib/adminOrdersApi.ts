import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order, OrderStatus } from './orderApi'

export interface AdminOrderRow extends Order {
  buyer: { id: string; name: string | null; email: string; avatar_url: string | null } | null
  course: { id: string; title: string } | null
}

export interface ListResult {
  orders: AdminOrderRow[]
  total: number
  error: Error | null
}

const SELECT_COLUMNS = `
  id, course_id, user_id, status, amount, code, notes,
  platform_fee_pct, platform_fee_amount, creator_payout_amount, creator_payout,
  account_tier_code, confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancelled_reason,
  created_at, updated_at,
  buyer:user_id(id, name, email, avatar_url),
  course:course_id(id, title)
`

function escapeIlike(s: string): string {
  return s.replace(/[%,]/g, '')
}

export async function listPendingOrders(
  client: SupabaseClient,
  options: { page?: number; pageSize?: number } = {}
): Promise<ListResult> {
  const { page = 1, pageSize = 20 } = options
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await client
    .from('orders')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    orders: (data as unknown as AdminOrderRow[]) ?? [],
    total: count ?? 0,
    error: error as Error | null,
  }
}

export async function listAllOrders(
  client: SupabaseClient,
  options: { status?: OrderStatus; search?: string; page?: number; pageSize?: number } = {}
): Promise<ListResult> {
  const { status, search, page = 1, pageSize = 20 } = options
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = client
    .from('orders')
    .select(SELECT_COLUMNS, { count: 'exact' })

  if (status) {
    query = query.eq('status', status)
  }

  if (search && search.trim()) {
    const term = escapeIlike(search.trim())
    query = query.or(`code.ilike.%${term}%,buyer.email.ilike.%${term}%`)
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    orders: (data as unknown as AdminOrderRow[]) ?? [],
    total: count ?? 0,
    error: error as Error | null,
  }
}

export async function getPendingOrderCount(
  client: SupabaseClient
): Promise<{ count: number; error: Error | null }> {
  const { count, error } = await client
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return { count: count ?? 0, error: error as Error | null }
}
