import type { SupabaseClient } from '@supabase/supabase-js'

export type CampaignDiscountType = 'percentage' | 'fixed_amount'

export interface Campaign {
  id: string
  name: string
  description: string | null
  discount_type: CampaignDiscountType
  discount_value: number
  max_discount_amount: number | null
  /** jsonb array of course id strings, or NULL for platform-wide. */
  applicable_courses: string[] | null
  starts_at: string
  ends_at: string
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
  /**
   * Count of `orders` where `campaign_id = campaign.id` AND status is one of
   * ('active', 'refund_pending', 'refunded') — i.e. orders that contributed
   * (or will contribute, pending refund settlement) to revenue. Populated by
   * the `list_campaigns_with_orders_count` RPC; defaults to 0 on rows fetched
   * via other paths (e.g. create/update RPCs that return a single row).
   */
  orders_count: number
}

export interface CampaignInput {
  name: string
  description: string | null
  discount_type: CampaignDiscountType
  discount_value: number
  max_discount_amount: number | null
  applicable_courses: string[] | null
  starts_at: string
  ends_at: string
}

export async function createCampaign(
  client: SupabaseClient,
  input: CampaignInput
): Promise<{ campaign: Campaign | null; error: Error | null }> {
  const { data, error } = await client.rpc('create_campaign', {
    p_name: input.name,
    p_description: input.description,
    p_discount_type: input.discount_type,
    p_discount_value: input.discount_value,
    p_max_discount_amount: input.max_discount_amount,
    p_applicable_courses: input.applicable_courses,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
  })
  return { campaign: (data as Campaign) ?? null, error: error as Error | null }
}

export async function updateCampaign(
  client: SupabaseClient,
  id: string,
  input: CampaignInput
): Promise<{ campaign: Campaign | null; error: Error | null }> {
  const { data, error } = await client.rpc('update_campaign', {
    p_id: id,
    p_name: input.name,
    p_description: input.description,
    p_discount_type: input.discount_type,
    p_discount_value: input.discount_value,
    p_max_discount_amount: input.max_discount_amount,
    p_applicable_courses: input.applicable_courses,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
  })
  return { campaign: (data as Campaign) ?? null, error: error as Error | null }
}

export async function deactivateCampaign(
  client: SupabaseClient,
  id: string
): Promise<{ campaign: Campaign | null; error: Error | null }> {
  const { data, error } = await client.rpc('deactivate_campaign', { p_id: id })
  return { campaign: (data as Campaign) ?? null, error: error as Error | null }
}

export async function getActiveCampaignForCourse(
  client: SupabaseClient,
  courseId: string
): Promise<{ campaign: Campaign | null; error: Error | null }> {
  const { data, error } = await client.rpc('get_active_campaign_for_course', {
    p_course_id: courseId,
  })
  return { campaign: (data as Campaign) ?? null, error: error as Error | null }
}

// Anon-safe lookup for the single currently-active campaign. The migration-064
// exclusion constraint guarantees ≤1 active campaign at any moment; `.limit(1)`
// keeps the client defensive. RLS on `campaigns` (064) lets anon SELECT when
// `is_active=true AND now() BETWEEN starts_at AND ends_at` — no auth needed.
export async function getCurrentActiveCampaign(
  client: SupabaseClient
): Promise<{ campaign: Campaign | null; error: Error | null }> {
  const nowIso = new Date().toISOString()
  const { data, error } = await client
    .from('campaigns')
    .select('*')
    .eq('is_active', true)
    .lte('starts_at', nowIso)
    .gte('ends_at', nowIso)
    .limit(1)
    .maybeSingle()
  return { campaign: (data as Campaign) ?? null, error: error as Error | null }
}

// Pure helper: does this campaign apply to the given course id?
// `applicable_courses === null` means platform-wide. Otherwise must be in array.
export function campaignAppliesToCourse(
  campaign: Campaign | null,
  courseId: string
): boolean {
  if (!campaign) return false
  if (campaign.applicable_courses === null) return true
  return campaign.applicable_courses.includes(courseId)
}

export interface ListCampaignsOptions {
  status?: 'all' | 'active' | 'inactive'
  search?: string
}

export async function listCampaigns(
  client: SupabaseClient,
  options: ListCampaignsOptions
): Promise<{ campaigns: Campaign[]; error: Error | null }> {
  // Routes through the `list_campaigns_with_orders_count` RPC (migration 071)
  // so the admin table can render a real `Số đơn` column without an N+1 fan-out
  // from the client. The RPC aggregates the orders count server-side, filtered
  // to revenue-bearing statuses (`active`, `refund_pending`, `refunded`).
  const trimmedSearch = options.search?.trim() ?? ''
  const p_status =
    options.status === 'active' || options.status === 'inactive' ? options.status : null
  const p_search = trimmedSearch.length > 0 ? trimmedSearch : null

  const { data, error } = await client.rpc('list_campaigns_with_orders_count', {
    p_status,
    p_search,
  })

  // The RPC returns `orders_count` per row. Default to 0 if a stale proxy or
  // alternate code path drops the field so the UI never renders `undefined`.
  const rows = ((data as Array<Partial<Campaign> & { orders_count?: number | string }>) ?? []).map(
    row => ({
      ...row,
      orders_count: Number(row.orders_count ?? 0),
    })
  ) as Campaign[]

  return { campaigns: rows, error: error as Error | null }
}

// Lightweight course list for the multi-select picker. Admin policy on
// `courses` already allows full reads, so a thin `from()` is enough — no RPC
// needed. We page in one shot because the picker filters client-side anyway.
export interface CoursePickerRow {
  id: string
  title: string
}

export async function listAdminCourses(
  client: SupabaseClient
): Promise<{ courses: CoursePickerRow[]; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .select('id, title')
    .order('title', { ascending: true })
  return { courses: (data as CoursePickerRow[]) ?? [], error: error as Error | null }
}

// Pure pricing helper — duplicate of the SQL formula in ADR-0007. Same floor
// arithmetic. Voucher application is layered on top in slice 2; this slice
// only cares about the campaign leg.
export function computeCampaignDiscount(
  price: number,
  campaign: Campaign | null
): number {
  if (!campaign) return 0
  if (campaign.discount_type === 'percentage') {
    const raw = Math.floor((price * campaign.discount_value) / 100)
    if (campaign.max_discount_amount == null) return raw
    return Math.min(raw, campaign.max_discount_amount)
  }
  // fixed_amount
  return Math.min(campaign.discount_value, price)
}
