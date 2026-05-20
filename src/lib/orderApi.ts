import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTierCode } from './accountTiers'

export type OrderStatus =
  | 'pending'
  | 'active'
  | 'cancelled'
  | 'expired'
  | 'refund_pending'
  | 'refunded'

export interface Order {
  id: string
  course_id: string
  user_id: string
  status: OrderStatus
  amount: number
  code: string
  notes: string | null
  platform_fee_pct: number
  platform_fee_amount: number
  creator_payout_amount: number
  creator_payout: number
  account_tier_code: AccountTierCode | null
  confirmed_at: string | null
  confirmed_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancelled_reason: string | null
  manual_confirm_reason: string | null
  created_at: string
  updated_at: string
}

export interface MyOrderRow extends Order {
  course: { id: string; title: string; thumbnail_url: string | null } | null
}

export async function createOrder(
  client: SupabaseClient,
  courseId: string
): Promise<{ order: Order | null; error: Error | null }> {
  const { data, error } = await client.rpc('create_order_with_fee_snapshot', {
    p_course_id: courseId,
  })

  return { order: (data as Order) ?? null, error: error as Error | null }
}

export async function confirmOrder(
  client: SupabaseClient,
  orderId: string,
  reason: string
): Promise<{ order: Order | null; error: Error | null }> {
  const { data, error } = await client.rpc('confirm_order', {
    p_order_id: orderId,
    p_reason: reason,
  })
  return { order: (data as Order) ?? null, error: error as Error | null }
}

export async function cancelOrder(
  client: SupabaseClient,
  orderId: string,
  reason: string
): Promise<{ order: Order | null; error: Error | null }> {
  const { data, error } = await client.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason,
  })
  return { order: (data as Order) ?? null, error: error as Error | null }
}

export interface OrderWithCourse extends Order {
  course: { id: string; title: string; thumbnail_url: string | null } | null
}

export async function getOrder(
  client: SupabaseClient,
  orderId: string
): Promise<{ order: OrderWithCourse | null; error: Error | null }> {
  const { data, error } = await client
    .from('orders')
    .select(
      `
      id, course_id, user_id, status, amount, code, notes,
      platform_fee_pct, platform_fee_amount, creator_payout_amount, creator_payout,
      account_tier_code, confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancelled_reason,
      manual_confirm_reason, created_at, updated_at,
      course:course_id(id, title, thumbnail_url)
    `
    )
    .eq('id', orderId)
    .single()

  return {
    order: (data as unknown as OrderWithCourse) ?? null,
    error: error as Error | null,
  }
}

export async function getPendingOrderForCourse(
  client: SupabaseClient,
  courseId: string,
  userId: string
): Promise<{ order: Order | null; error: Error | null }> {
  const { data, error } = await client
    .from('orders')
    .select('id, course_id, user_id, status, amount, code, created_at, updated_at')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle()

  return {
    order: (data as Order) ?? null,
    error: error as Error | null,
  }
}

export async function listMyOrders(
  client: SupabaseClient,
  options: { status?: OrderStatus; page?: number; pageSize?: number } = {}
): Promise<{ orders: MyOrderRow[]; total: number; error: Error | null }> {
  const { status, page = 1, pageSize = 20 } = options
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = client
    .from('orders')
    .select(
      `
      id, course_id, user_id, status, amount, code, notes,
      platform_fee_pct, platform_fee_amount, creator_payout_amount, creator_payout,
      account_tier_code, confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancelled_reason,
      manual_confirm_reason, created_at, updated_at,
      course:course_id(id, title, thumbnail_url)
    `,
      { count: 'exact' }
    )

  if (status) query = query.eq('status', status)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    orders: (data as unknown as MyOrderRow[]) ?? [],
    total: count ?? 0,
    error: error as Error | null,
  }
}
