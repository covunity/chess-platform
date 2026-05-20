import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order, OrderStatus } from './orderApi'

// Shape of the `orders.refund_due_to` JSONB snapshot captured by
// `confirm_order_via_payos` on the D9b cancelled-then-paid branch
// (migration 056). Stored as JSONB so the upstream PayOS payload
// shape can round-trip without a column-per-field churn.
export interface RefundDueTo {
  payer_account: string | null
  payer_name: string | null
  payer_bank: string | null
  amount: string | null
  paid_at: string | null
}

export interface AdminOrderRow extends Order {
  buyer: { id: string; name: string | null; email: string; avatar_url: string | null } | null
  course: { id: string; title: string } | null
  refund_due_to?: RefundDueTo | null
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
  manual_confirm_reason, created_at, updated_at,
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

// ── "Cần can thiệp" — stale pending orders (PayOS webhook never arrived) ──
//
// Slice 4 of PRD-0005. Filters status='pending' AND created_at < now() - 1h.
// Hiding manual-confirm during the first hour prevents accidental free-access
// grants on orders still mid-payment (PRD-0005 §10 D12b). The partial index
// `orders_pending_old_idx` (migration 057) supports both this query and the
// slice-2 expire_stale_orders() cron.

const STALE_PENDING_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

export async function listStalePendingOrders(
  client: SupabaseClient,
  options: { page?: number; pageSize?: number } = {}
): Promise<ListResult> {
  const { page = 1, pageSize = 20 } = options
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const cutoff = new Date(Date.now() - STALE_PENDING_THRESHOLD_MS).toISOString()

  const { data, count, error } = await client
    .from('orders')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    orders: (data as unknown as AdminOrderRow[]) ?? [],
    total: count ?? 0,
    error: error as Error | null,
  }
}

export async function getStalePendingOrderCount(
  client: SupabaseClient
): Promise<{ count: number; error: Error | null }> {
  const cutoff = new Date(Date.now() - STALE_PENDING_THRESHOLD_MS).toISOString()
  const { count, error } = await client
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  return { count: count ?? 0, error: error as Error | null }
}

// ── "Cần refund" — refund_pending queue (PRD-0005 slice 5, issue #259) ────
//
// Lists orders flagged for refund by the D9b cancelled-then-paid branch in
// `confirm_order_via_payos` (migration 056). Each row exposes
// `refund_due_to` JSONB so admin can transfer funds back via their personal
// banking app, then call `mark_order_refunded` (migration 058) with the
// bank transaction reference to flip status to terminal `refunded`.
//
// NAPAS instant transfers cannot be programmatically reversed (PRD-0005 §3,
// D9b) — this queue is the system of record for refund completion.

const REFUND_SELECT_COLUMNS = `${SELECT_COLUMNS},
  refund_due_to, refunded_at, refunded_by, refund_reference`

export async function listRefundPendingOrders(
  client: SupabaseClient,
  options: { page?: number; pageSize?: number } = {}
): Promise<ListResult> {
  const { page = 1, pageSize = 20 } = options
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await client
    .from('orders')
    .select(REFUND_SELECT_COLUMNS, { count: 'exact' })
    .eq('status', 'refund_pending')
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    orders: (data as unknown as AdminOrderRow[]) ?? [],
    total: count ?? 0,
    error: error as Error | null,
  }
}

export async function getRefundPendingOrderCount(
  client: SupabaseClient
): Promise<{ count: number; error: Error | null }> {
  const { count, error } = await client
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'refund_pending')

  return { count: count ?? 0, error: error as Error | null }
}

export async function markOrderRefunded(
  client: SupabaseClient,
  orderId: string,
  reference: string
): Promise<{ order: Order | null; error: Error | null }> {
  const { data, error } = await client.rpc('mark_order_refunded', {
    p_order_id: orderId,
    p_refund_reference: reference,
  })
  return { order: (data as Order) ?? null, error: error as Error | null }
}
