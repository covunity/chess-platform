import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createCampaign,
  updateCampaign,
  deactivateCampaign,
  getActiveCampaignForCourse,
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

// ── listCampaigns ──────────────────────────────────────────────────────────

describe('listCampaigns', () => {
  it('lists all campaigns ordered by created_at desc', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [sampleCampaign],
      count: 1,
      error: null,
    })
    const select = vi.fn().mockReturnValue({ order })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { campaigns, error } = await listCampaigns(client, {})
    expect(error).toBeNull()
    expect(campaigns).toHaveLength(1)
    expect(client.from).toHaveBeenCalledWith('campaigns')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('filters by is_active when status=active', async () => {
    const eq = vi.fn().mockReturnThis()
    const order = vi.fn().mockResolvedValue({ data: [sampleCampaign], count: 1, error: null })
    const chain = { eq, order }
    const select = vi.fn().mockReturnValue(chain)
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    await listCampaigns(client, { status: 'active' })
    expect(eq).toHaveBeenCalledWith('is_active', true)
  })

  it('filters by name via ilike when search is provided', async () => {
    const ilike = vi.fn().mockReturnThis()
    const order = vi.fn().mockResolvedValue({ data: [], count: 0, error: null })
    const chain = { ilike, order }
    const select = vi.fn().mockReturnValue(chain)
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    await listCampaigns(client, { search: 'Tết' })
    expect(ilike).toHaveBeenCalledWith('name', '%Tết%')
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
})
