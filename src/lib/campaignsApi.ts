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

export interface ListCampaignsOptions {
  status?: 'all' | 'active' | 'inactive'
  search?: string
}

export async function listCampaigns(
  client: SupabaseClient,
  options: ListCampaignsOptions
): Promise<{ campaigns: Campaign[]; error: Error | null }> {
  let chain = client
    .from('campaigns')
    .select(
      'id, name, description, discount_type, discount_value, max_discount_amount, applicable_courses, starts_at, ends_at, is_active, created_by, created_at, updated_at'
    ) as unknown as {
    eq: (col: string, val: unknown) => typeof chain
    ilike: (col: string, val: string) => typeof chain
    order: (col: string, opts: { ascending: boolean }) => Promise<{
      data: Campaign[] | null
      count: number | null
      error: Error | null
    }>
  }

  if (options.status === 'active') chain = chain.eq('is_active', true)
  if (options.status === 'inactive') chain = chain.eq('is_active', false)
  if (options.search && options.search.trim()) {
    chain = chain.ilike('name', `%${options.search.trim()}%`)
  }

  const { data, error } = await chain.order('created_at', { ascending: false })
  return { campaigns: (data as Campaign[]) ?? [], error: error as Error | null }
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
