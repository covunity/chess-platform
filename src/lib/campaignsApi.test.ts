import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createCampaign,
  updateCampaign,
  deactivateCampaign,
  getActiveCampaignForCourse,
  getCurrentActiveCampaign,
  campaignAppliesToCourse,
  listCampaigns,
  listAdminCourses,
  computeCampaignDiscount,
  type Campaign,
} from './campaignsApi'

const sampleCampaign: Campaign = {
  id: 'cmp-1',
  name: 'Tết Sale 2026',
  description: null,
  discount_type: 'percentage',
  discount_value: 20,
  max_discount_amount: null,
  applicable_courses: null,
  starts_at: '2026-01-15T00:00:00Z',
  ends_at: '2026-02-15T00:00:00Z',
  is_active: true,
  created_by: 'admin-1',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
  orders_count: 0,
}

// ── createCampaign ─────────────────────────────────────────────────────────

describe('createCampaign', () => {
  it('calls create_campaign RPC with the provided fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleCampaign, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { campaign, error } = await createCampaign(client, {
      name: 'Tết Sale 2026',
      description: null,
      discount_type: 'percentage',
      discount_value: 20,
      max_discount_amount: null,
      applicable_courses: null,
      starts_at: '2026-01-15T00:00:00Z',
      ends_at: '2026-02-15T00:00:00Z',
    })

    expect(error).toBeNull()
    expect(campaign?.id).toBe('cmp-1')
    expect(rpc).toHaveBeenCalledWith('create_campaign', {
      p_name: 'Tết Sale 2026',
      p_description: null,
      p_discount_type: 'percentage',
      p_discount_value: 20,
      p_max_discount_amount: null,
      p_applicable_courses: null,
      p_starts_at: '2026-01-15T00:00:00Z',
      p_ends_at: '2026-02-15T00:00:00Z',
    })
  })

  it('surfaces campaign_overlap_with_existing error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'campaign_overlap_with_existing', code: '23P01' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { campaign, error } = await createCampaign(client, {
      name: 'X',
      description: null,
      discount_type: 'percentage',
      discount_value: 10,
      max_discount_amount: null,
      applicable_courses: null,
      starts_at: '2026-01-15T00:00:00Z',
      ends_at: '2026-02-15T00:00:00Z',
    })
    expect(campaign).toBeNull()
    expect((error as { message: string }).message).toContain('campaign_overlap_with_existing')
  })
})

// ── updateCampaign ─────────────────────────────────────────────────────────

describe('updateCampaign', () => {
  it('calls update_campaign RPC with id + fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleCampaign, error: null })
    const client = { rpc } as unknown as SupabaseClient

    await updateCampaign(client, 'cmp-1', {
      name: 'Tết Sale 2026 (v2)',
      description: 'Updated',
      discount_type: 'fixed_amount',
      discount_value: 50000,
      max_discount_amount: null,
      applicable_courses: ['c-1', 'c-2'],
      starts_at: '2026-01-15T00:00:00Z',
      ends_at: '2026-02-15T00:00:00Z',
    })

    expect(rpc).toHaveBeenCalledWith('update_campaign', {
      p_id: 'cmp-1',
      p_name: 'Tết Sale 2026 (v2)',
      p_description: 'Updated',
      p_discount_type: 'fixed_amount',
      p_discount_value: 50000,
      p_max_discount_amount: null,
      p_applicable_courses: ['c-1', 'c-2'],
      p_starts_at: '2026-01-15T00:00:00Z',
      p_ends_at: '2026-02-15T00:00:00Z',
    })
  })
})

// ── deactivateCampaign ─────────────────────────────────────────────────────

describe('deactivateCampaign', () => {
  it('calls deactivate_campaign RPC with the id', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...sampleCampaign, is_active: false },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { campaign, error } = await deactivateCampaign(client, 'cmp-1')
    expect(error).toBeNull()
    expect(campaign?.is_active).toBe(false)
    expect(rpc).toHaveBeenCalledWith('deactivate_campaign', { p_id: 'cmp-1' })
  })
})

// ── getActiveCampaignForCourse ─────────────────────────────────────────────

describe('getActiveCampaignForCourse', () => {
  it('calls get_active_campaign_for_course RPC and returns the row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleCampaign, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { campaign, error } = await getActiveCampaignForCourse(client, 'course-42')
    expect(error).toBeNull()
    expect(campaign?.id).toBe('cmp-1')
    expect(rpc).toHaveBeenCalledWith('get_active_campaign_for_course', {
      p_course_id: 'course-42',
    })
  })

  it('returns null campaign when no active campaign matches', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as unknown as SupabaseClient
    const { campaign, error } = await getActiveCampaignForCourse(client, 'course-42')
    expect(campaign).toBeNull()
    expect(error).toBeNull()
  })
})

// ── getCurrentActiveCampaign ───────────────────────────────────────────────

describe('getCurrentActiveCampaign', () => {
  it('queries campaigns table with is_active + time-window filters and returns the row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: sampleCampaign, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const gte = vi.fn().mockReturnValue({ limit })
    const lte = vi.fn().mockReturnValue({ gte })
    const eq = vi.fn().mockReturnValue({ lte })
    const select = vi.fn().mockReturnValue({ eq })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { campaign, error } = await getCurrentActiveCampaign(client)

    expect(error).toBeNull()
    expect(campaign?.id).toBe('cmp-1')
    expect(client.from).toHaveBeenCalledWith('campaigns')
    expect(select).toHaveBeenCalledWith('*')
    expect(eq).toHaveBeenCalledWith('is_active', true)
    expect(lte).toHaveBeenCalledWith('starts_at', expect.any(String))
    expect(gte).toHaveBeenCalledWith('ends_at', expect.any(String))
    expect(limit).toHaveBeenCalledWith(1)
    expect(maybeSingle).toHaveBeenCalled()
  })

  it('returns null when no active campaign matches', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const gte = vi.fn().mockReturnValue({ limit })
    const lte = vi.fn().mockReturnValue({ gte })
    const eq = vi.fn().mockReturnValue({ lte })
    const select = vi.fn().mockReturnValue({ eq })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { campaign, error } = await getCurrentActiveCampaign(client)
    expect(campaign).toBeNull()
    expect(error).toBeNull()
  })
})

// ── campaignAppliesToCourse ────────────────────────────────────────────────

describe('campaignAppliesToCourse', () => {
  it('returns false when campaign is null', () => {
    expect(campaignAppliesToCourse(null, 'c-1')).toBe(false)
  })

  it('returns true when applicable_courses is null (platform-wide)', () => {
    expect(
      campaignAppliesToCourse({ ...sampleCampaign, applicable_courses: null }, 'c-1')
    ).toBe(true)
  })

  it('returns true when courseId is in applicable_courses array', () => {
    expect(
      campaignAppliesToCourse({ ...sampleCampaign, applicable_courses: ['c-1', 'c-2'] }, 'c-1')
    ).toBe(true)
  })

  it('returns false when courseId is not in applicable_courses array', () => {
    expect(
      campaignAppliesToCourse({ ...sampleCampaign, applicable_courses: ['c-2', 'c-3'] }, 'c-1')
    ).toBe(false)
  })
})

// ── listCampaigns ──────────────────────────────────────────────────────────

describe('listCampaigns', () => {
  it('calls list_campaigns_with_orders_count RPC and returns rows with orders_count', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...sampleCampaign, orders_count: 3 }],
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { campaigns, error } = await listCampaigns(client, {})
    expect(error).toBeNull()
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].orders_count).toBe(3)
    expect(rpc).toHaveBeenCalledWith('list_campaigns_with_orders_count', {
      p_status: null,
      p_search: null,
    })
  })

  it('passes status=active filter through to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [sampleCampaign], error: null })
    const client = { rpc } as unknown as SupabaseClient

    await listCampaigns(client, { status: 'active' })
    expect(rpc).toHaveBeenCalledWith('list_campaigns_with_orders_count', {
      p_status: 'active',
      p_search: null,
    })
  })

  it('passes status=inactive filter through to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient

    await listCampaigns(client, { status: 'inactive' })
    expect(rpc).toHaveBeenCalledWith('list_campaigns_with_orders_count', {
      p_status: 'inactive',
      p_search: null,
    })
  })

  it('passes search through to the RPC (trimmed)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient

    await listCampaigns(client, { search: '  Tết  ' })
    expect(rpc).toHaveBeenCalledWith('list_campaigns_with_orders_count', {
      p_status: null,
      p_search: 'Tết',
    })
  })

  it('defaults orders_count to 0 when the RPC omits it', async () => {
    // Defensive — the RPC always returns 0 via COALESCE, but in case a stale
    // proxy or alternate path drops the field, the client should not break.
    const withoutCount: Record<string, unknown> = { ...sampleCampaign }
    delete withoutCount.orders_count
    const rpc = vi.fn().mockResolvedValue({
      data: [withoutCount],
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { campaigns } = await listCampaigns(client, {})
    expect(campaigns[0].orders_count).toBe(0)
  })

  it('surfaces RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { campaigns, error } = await listCampaigns(client, {})
    expect(campaigns).toEqual([])
    expect((error as { message: string }).message).toBe('boom')
  })
})

// ── listAdminCourses ───────────────────────────────────────────────────────

describe('listAdminCourses', () => {
  it('queries courses table and orders by title asc', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'c-1', title: 'Khai cuộc Italy' }],
      error: null,
    })
    const select = vi.fn().mockReturnValue({ order })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { courses, error } = await listAdminCourses(client)
    expect(error).toBeNull()
    expect(courses).toHaveLength(1)
    expect(client.from).toHaveBeenCalledWith('courses')
    expect(select).toHaveBeenCalledWith('id, title')
    expect(order).toHaveBeenCalledWith('title', { ascending: true })
  })
})

// ── computeCampaignDiscount ────────────────────────────────────────────────
// Pure function — keeps the price-display logic out of the React layer so
// CourseDetailPage can call it synchronously when the API row is loaded.

describe('computeCampaignDiscount', () => {
  it('returns 0 for a null campaign', () => {
    expect(computeCampaignDiscount(1_000_000, null)).toBe(0)
  })

  it('applies percentage discount with floor rounding', () => {
    // 17% of 999 = 169.83 → floor 169
    expect(
      computeCampaignDiscount(999, {
        ...sampleCampaign,
        discount_type: 'percentage',
        discount_value: 17,
        max_discount_amount: null,
      })
    ).toBe(169)
  })

  it('caps percentage discount at max_discount_amount when smaller', () => {
    // 50% of 1_000_000 = 500_000, but cap=300_000
    expect(
      computeCampaignDiscount(1_000_000, {
        ...sampleCampaign,
        discount_type: 'percentage',
        discount_value: 50,
        max_discount_amount: 300_000,
      })
    ).toBe(300_000)
  })

  it('applies fixed_amount discount, clamped at price', () => {
    expect(
      computeCampaignDiscount(80_000, {
        ...sampleCampaign,
        discount_type: 'fixed_amount',
        discount_value: 100_000,
        max_discount_amount: null,
      })
    ).toBe(80_000)
  })

  // ADR-0007 worked example. Slice 2 only stamps the campaign leg of the
  // formula — voucher leg lands in slice 3b. The fee then applies to the
  // FINAL price (post-campaign) per the pro-rata model.
  it('matches the ADR-0007 worked example for campaign + 20% tier', () => {
    const discount = computeCampaignDiscount(1_000_000, {
      ...sampleCampaign,
      discount_type: 'percentage',
      discount_value: 20,
      max_discount_amount: null,
    })
    expect(discount).toBe(200_000)
    const intermediate = 1_000_000 - discount
    expect(intermediate).toBe(800_000)
    // Without a voucher, final = intermediate. Fee on final.
    const creator = Math.floor((intermediate * 80) / 100)
    expect(creator).toBe(640_000)
    expect(intermediate - creator).toBe(160_000)
  })
})
