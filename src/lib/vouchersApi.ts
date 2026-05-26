import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPrice } from './utils'

export type VoucherDiscountType = 'percentage' | 'fixed_amount'

export interface Voucher {
  id: string
  code: string
  discount_type: VoucherDiscountType
  discount_value: number
  max_discount_amount: number | null
  /** jsonb array of course id strings, or NULL for "applies to every course". */
  applicable_courses: string[] | null
  /** NULL = unlimited quota. */
  total_quota: number | null
  total_uses: number
  per_user_limit: number
  starts_at: string
  ends_at: string
  is_active: boolean
  campaign_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface VoucherInput {
  code: string
  discount_type: VoucherDiscountType
  discount_value: number
  max_discount_amount: number | null
  applicable_courses: string[] | null
  total_quota: number | null
  per_user_limit: number
  starts_at: string
  ends_at: string
  campaign_id: string | null
}

export interface VoucherUsageUser {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
}

export interface VoucherUsageOrder {
  id: string
  code: string | null
}

export interface VoucherUsage {
  id: string
  voucher_id: string
  user_id: string
  order_id: string
  discount_amount: number
  used_at: string
  user: VoucherUsageUser | null
  order: VoucherUsageOrder | null
}

export async function createVoucher(
  client: SupabaseClient,
  input: VoucherInput
): Promise<{ voucher: Voucher | null; error: Error | null }> {
  const { data, error } = await client.rpc('create_voucher', {
    p_code: input.code,
    p_discount_type: input.discount_type,
    p_discount_value: input.discount_value,
    p_max_discount_amount: input.max_discount_amount,
    p_applicable_courses: input.applicable_courses,
    p_total_quota: input.total_quota,
    p_per_user_limit: input.per_user_limit,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_campaign_id: input.campaign_id,
  })
  return { voucher: (data as Voucher) ?? null, error: error as Error | null }
}

export async function updateVoucher(
  client: SupabaseClient,
  id: string,
  input: VoucherInput
): Promise<{ voucher: Voucher | null; error: Error | null }> {
  const { data, error } = await client.rpc('update_voucher', {
    p_id: id,
    p_code: input.code,
    p_discount_type: input.discount_type,
    p_discount_value: input.discount_value,
    p_max_discount_amount: input.max_discount_amount,
    p_applicable_courses: input.applicable_courses,
    p_total_quota: input.total_quota,
    p_per_user_limit: input.per_user_limit,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_campaign_id: input.campaign_id,
  })
  return { voucher: (data as Voucher) ?? null, error: error as Error | null }
}

export async function deactivateVoucher(
  client: SupabaseClient,
  id: string
): Promise<{ voucher: Voucher | null; error: Error | null }> {
  const { data, error } = await client.rpc('deactivate_voucher', { p_id: id })
  return { voucher: (data as Voucher) ?? null, error: error as Error | null }
}

export async function deleteVoucher(
  client: SupabaseClient,
  id: string
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('delete_voucher', { p_id: id })
  return { error: error as Error | null }
}

export interface ListVouchersOptions {
  status?: 'all' | 'active' | 'inactive'
  search?: string
}

export async function listVouchers(
  client: SupabaseClient,
  options: ListVouchersOptions
): Promise<{ vouchers: Voucher[]; error: Error | null }> {
  let chain = client
    .from('vouchers')
    .select(
      'id, code, discount_type, discount_value, max_discount_amount, applicable_courses, total_quota, total_uses, per_user_limit, starts_at, ends_at, is_active, campaign_id, created_by, created_at, updated_at'
    ) as unknown as {
    eq: (col: string, val: unknown) => typeof chain
    ilike: (col: string, val: string) => typeof chain
    order: (col: string, opts: { ascending: boolean }) => Promise<{
      data: Voucher[] | null
      count: number | null
      error: Error | null
    }>
  }

  if (options.status === 'active') chain = chain.eq('is_active', true)
  if (options.status === 'inactive') chain = chain.eq('is_active', false)
  if (options.search && options.search.trim()) {
    chain = chain.ilike('code', `%${options.search.trim()}%`)
  }

  const { data, error } = await chain.order('created_at', { ascending: false })
  return { vouchers: (data as Voucher[]) ?? [], error: error as Error | null }
}

export async function getVoucherUsages(
  client: SupabaseClient,
  voucherId: string
): Promise<{ usages: VoucherUsage[]; error: Error | null }> {
  const { data, error } = await client
    .from('voucher_usages')
    .select(
      'id, voucher_id, user_id, order_id, discount_amount, used_at, user:users(id, email, name, avatar_url), order:orders(id, code)'
    )
    .eq('voucher_id', voucherId)
    .order('used_at', { ascending: false })
  return { usages: (data as unknown as VoucherUsage[]) ?? [], error: error as Error | null }
}

export function formatVoucherDiscount(v: Voucher): string {
  if (v.discount_type === 'percentage') return `-${v.discount_value}%`
  return `-${formatPrice(v.discount_value)}`
}

// PRD-0006 slice 3b: pure JS mirror of the SQL `_voucher_discount_amount`
// helper in migration 068. The SQL function is the source of truth; this
// JS twin exists so React components (e.g. the /confirm-purchase voucher
// preview) and unit tests can reason about stacking math without a round
// trip. Both use floor / integer arithmetic per ADR-0007.
export function computeVoucherDiscount(
  price: number,
  voucher: Pick<Voucher, 'discount_type' | 'discount_value' | 'max_discount_amount'> | null
): number {
  if (!voucher || price <= 0) return 0
  if (voucher.discount_type === 'percentage') {
    const raw = Math.floor((price * voucher.discount_value) / 100)
    if (voucher.max_discount_amount == null) return raw
    return Math.min(raw, voucher.max_discount_amount)
  }
  // fixed_amount
  return Math.min(voucher.discount_value, price)
}

// PRD-0006 slice 3b: maps voucher RPC error message (raised as PG exception
// from create_order_with_fee_snapshot / preview_purchase) to the i18n key
// the toast renders. Unknown / unexpected errors fall through to
// voucher.error.generic so the UI never shows a raw "voucher_..." string.
export type VoucherErrCode =
  | 'voucher_not_found'
  | 'voucher_inactive'
  | 'voucher_expired'
  | 'voucher_quota_exceeded'
  | 'voucher_user_limit'
  | 'voucher_course_not_eligible'

const VOUCHER_ERR_I18N: Record<VoucherErrCode, string> = {
  voucher_not_found:           'voucher.error.notFound',
  voucher_inactive:            'voucher.error.inactive',
  voucher_expired:             'voucher.error.expired',
  voucher_quota_exceeded:      'voucher.error.quotaExceeded',
  voucher_user_limit:          'voucher.error.userLimitReached',
  voucher_course_not_eligible: 'voucher.error.courseNotEligible',
}

export function voucherErrorKey(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? ''
  for (const key of Object.keys(VOUCHER_ERR_I18N) as VoucherErrCode[]) {
    if (msg.includes(key)) return VOUCHER_ERR_I18N[key]
  }
  return 'voucher.error.generic'
}
