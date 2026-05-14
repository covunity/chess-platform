import type { SupabaseClient } from '@supabase/supabase-js'

export interface CreatorFeeRow {
  user_id: string
  name: string | null
  email: string
  account_tier_id: string
  tier_name_vi: string | null
  tier_fee_pct: number
  platform_fee_pct_override: number | null
  effective_fee_pct: number
}

export interface ListCreatorFeesOptions {
  search?: string
  overrides_only?: boolean
  limit?: number
  offset?: number
}

export type OverrideValidationError = 'required' | 'numeric' | 'range'

export function validateOverridePct(raw: string): OverrideValidationError | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'required'
  // Reject anything that isn't a plain decimal number — Number() accepts '12,5'
  // as NaN but also accepts '12.5e10', so guard with a regex first.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return 'numeric'
  const n = Number(trimmed)
  if (Number.isNaN(n)) return 'numeric'
  if (n < 0 || n > 100) return 'range'
  return null
}

export async function listCreatorFees(
  client: SupabaseClient,
  options: ListCreatorFeesOptions
): Promise<{ creators: CreatorFeeRow[]; total: number; error: Error | null }> {
  const { data, error } = await client.rpc('admin_list_creator_fees', {
    p_search: options.search?.trim() ? options.search.trim() : null,
    p_overrides_only: options.overrides_only ?? false,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  })

  if (error) {
    return { creators: [], total: 0, error: error as unknown as Error }
  }

  const rows = (data ?? []) as Array<CreatorFeeRow & { total_count: number | string }>
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0
  const creators: CreatorFeeRow[] = rows.map(r => ({
    user_id: r.user_id,
    name: r.name,
    email: r.email,
    account_tier_id: r.account_tier_id,
    tier_name_vi: r.tier_name_vi,
    tier_fee_pct: Number(r.tier_fee_pct),
    platform_fee_pct_override:
      r.platform_fee_pct_override == null ? null : Number(r.platform_fee_pct_override),
    effective_fee_pct: Number(r.effective_fee_pct),
  }))
  return { creators, total, error: null }
}

export interface UserWithOverride {
  id: string
  platform_fee_pct_override: number | null
}

export async function setCreatorFeeOverride(
  client: SupabaseClient,
  userId: string,
  pct: number
): Promise<{ user: UserWithOverride | null; error: Error | null }> {
  const { data, error } = await client.rpc('admin_set_creator_fee_override', {
    p_user_id: userId,
    p_pct: pct,
  })
  return {
    user: (data as UserWithOverride) ?? null,
    error: error as unknown as Error | null,
  }
}

export async function clearCreatorFeeOverride(
  client: SupabaseClient,
  userId: string
): Promise<{ user: UserWithOverride | null; error: Error | null }> {
  const { data, error } = await client.rpc('admin_clear_creator_fee_override', {
    p_user_id: userId,
  })
  return {
    user: (data as UserWithOverride) ?? null,
    error: error as unknown as Error | null,
  }
}
