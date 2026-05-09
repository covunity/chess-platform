import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTierCode } from './accountTiers'

export type OrderStatus = 'pending' | 'active' | 'cancelled'

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
  created_at: string
  updated_at: string
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
