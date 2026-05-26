import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createVoucher,
  updateVoucher,
  deactivateVoucher,
  deleteVoucher,
  listVouchers,
  getVoucherUsages,
  formatVoucherDiscount,
  computeVoucherDiscount,
  voucherErrorKey,
  type Voucher,
  type VoucherUsage,
} from './vouchersApi'

const sampleVoucher: Voucher = {
  id: 'v-1',
  code: 'WELCOME10',
  discount_type: 'percentage',
  discount_value: 10,
  max_discount_amount: null,
  applicable_courses: null,
  total_quota: 100,
  total_uses: 0,
  per_user_limit: 1,
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2026-12-31T23:59:00Z',
  is_active: true,
  campaign_id: null,
  created_by: 'admin-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// ── createVoucher ───────────────────────────────────────────────────────────

describe('createVoucher', () => {
  it('calls create_voucher RPC with all fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleVoucher, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { voucher, error } = await createVoucher(client, {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 10,
      max_discount_amount: null,
      applicable_courses: null,
      total_quota: 100,
      per_user_limit: 1,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-12-31T23:59:00Z',
      campaign_id: null,
    })

    expect(error).toBeNull()
    expect(voucher?.id).toBe('v-1')
    expect(rpc).toHaveBeenCalledWith('create_voucher', {
      p_code: 'WELCOME10',
      p_discount_type: 'percentage',
      p_discount_value: 10,
      p_max_discount_amount: null,
      p_applicable_courses: null,
      p_total_quota: 100,
      p_per_user_limit: 1,
      p_starts_at: '2026-01-01T00:00:00Z',
      p_ends_at: '2026-12-31T23:59:00Z',
      p_campaign_id: null,
    })
  })

  it('surfaces voucher_code_already_exists error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'voucher_code_already_exists', code: '23505' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { voucher, error } = await createVoucher(client, {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 10,
      max_discount_amount: null,
      applicable_courses: null,
      total_quota: 100,
      per_user_limit: 1,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-12-31T23:59:00Z',
      campaign_id: null,
    })
    expect(voucher).toBeNull()
    expect((error as { message: string }).message).toContain('voucher_code_already_exists')
  })

  it('surfaces voucher_code_invalid_format error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'voucher_code_invalid_format' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { voucher, error } = await createVoucher(client, {
      code: 'low',
      discount_type: 'percentage',
      discount_value: 10,
      max_discount_amount: null,
      applicable_courses: null,
      total_quota: 100,
      per_user_limit: 1,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-12-31T23:59:00Z',
      campaign_id: null,
    })
    expect(voucher).toBeNull()
    expect((error as { message: string }).message).toContain('voucher_code_invalid_format')
  })
})

// ── updateVoucher ───────────────────────────────────────────────────────────

describe('updateVoucher', () => {
  it('calls update_voucher RPC with id + fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleVoucher, error: null })
    const client = { rpc } as unknown as SupabaseClient

    await updateVoucher(client, 'v-1', {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 15,
      max_discount_amount: null,
      applicable_courses: ['c-1'],
      total_quota: 200,
      per_user_limit: 2,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-12-31T23:59:00Z',
      campaign_id: null,
    })

    expect(rpc).toHaveBeenCalledWith('update_voucher', {
      p_id: 'v-1',
      p_code: 'WELCOME10',
      p_discount_type: 'percentage',
      p_discount_value: 15,
      p_max_discount_amount: null,
      p_applicable_courses: ['c-1'],
      p_total_quota: 200,
      p_per_user_limit: 2,
      p_starts_at: '2026-01-01T00:00:00Z',
      p_ends_at: '2026-12-31T23:59:00Z',
      p_campaign_id: null,
    })
  })

  it('surfaces voucher_locked_after_use error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'voucher_locked_after_use' },
    })
    const client = { rpc } as unknown as SupabaseClient
    const { voucher, error } = await updateVoucher(client, 'v-1', {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 99,
      max_discount_amount: null,
      applicable_courses: null,
      total_quota: 100,
      per_user_limit: 1,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-12-31T23:59:00Z',
      campaign_id: null,
    })
    expect(voucher).toBeNull()
    expect((error as { message: string }).message).toContain('voucher_locked_after_use')
  })
})

// ── deactivateVoucher ───────────────────────────────────────────────────────

describe('deactivateVoucher', () => {
  it('calls deactivate_voucher RPC with the id', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...sampleVoucher, is_active: false },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { voucher, error } = await deactivateVoucher(client, 'v-1')
    expect(error).toBeNull()
    expect(voucher?.is_active).toBe(false)
    expect(rpc).toHaveBeenCalledWith('deactivate_voucher', { p_id: 'v-1' })
  })
})

// ── deleteVoucher ───────────────────────────────────────────────────────────

describe('deleteVoucher', () => {
  it('calls delete_voucher RPC with the id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { error } = await deleteVoucher(client, 'v-1')
    expect(error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('delete_voucher', { p_id: 'v-1' })
  })

  it('surfaces voucher_in_use error when total_uses > 0', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'voucher_in_use' },
    })
    const client = { rpc } as unknown as SupabaseClient
    const { error } = await deleteVoucher(client, 'v-1')
    expect((error as { message: string }).message).toContain('voucher_in_use')
  })
})

// ── listVouchers ────────────────────────────────────────────────────────────

describe('listVouchers', () => {
  it('lists all vouchers ordered by created_at desc', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [sampleVoucher],
      count: 1,
      error: null,
    })
    const select = vi.fn().mockReturnValue({ order })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { vouchers, error } = await listVouchers(client, {})
    expect(error).toBeNull()
    expect(vouchers).toHaveLength(1)
    expect(client.from).toHaveBeenCalledWith('vouchers')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('filters by is_active when status=active', async () => {
    const eq = vi.fn().mockReturnThis()
    const order = vi.fn().mockResolvedValue({ data: [sampleVoucher], count: 1, error: null })
    const chain = { eq, order }
    const select = vi.fn().mockReturnValue(chain)
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    await listVouchers(client, { status: 'active' })
    expect(eq).toHaveBeenCalledWith('is_active', true)
  })

  it('filters by code via ilike when search is provided', async () => {
    const ilike = vi.fn().mockReturnThis()
    const order = vi.fn().mockResolvedValue({ data: [], count: 0, error: null })
    const chain = { ilike, order }
    const select = vi.fn().mockReturnValue(chain)
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    await listVouchers(client, { search: 'WEL' })
    expect(ilike).toHaveBeenCalledWith('code', '%WEL%')
  })
})

// ── getVoucherUsages ────────────────────────────────────────────────────────

describe('getVoucherUsages', () => {
  it('joins usages → users + orders, ordered by used_at desc', async () => {
    const sampleUsage: VoucherUsage = {
      id: 'u-1',
      voucher_id: 'v-1',
      user_id: 'usr-1',
      order_id: 'ord-1',
      discount_amount: 50000,
      used_at: '2026-05-01T00:00:00Z',
      user: { id: 'usr-1', email: 'a@b.com', name: 'Alice', avatar_url: null },
      order: { id: 'ord-1', code: 'ORD-2026-000001' },
    }
    const order = vi.fn().mockResolvedValue({ data: [sampleUsage], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { usages, error } = await getVoucherUsages(client, 'v-1')
    expect(error).toBeNull()
    expect(usages).toHaveLength(1)
    expect(client.from).toHaveBeenCalledWith('voucher_usages')
    expect(eq).toHaveBeenCalledWith('voucher_id', 'v-1')
    expect(order).toHaveBeenCalledWith('used_at', { ascending: false })
  })
})

// ── formatVoucherDiscount ───────────────────────────────────────────────────

describe('formatVoucherDiscount', () => {
  it('renders percentage as -N%', () => {
    expect(formatVoucherDiscount({ ...sampleVoucher, discount_type: 'percentage', discount_value: 20 })).toBe('-20%')
  })

  it('renders fixed_amount with VND formatting', () => {
    expect(formatVoucherDiscount({ ...sampleVoucher, discount_type: 'fixed_amount', discount_value: 50000 })).toBe('-50.000đ')
  })
})

// ── computeVoucherDiscount (PRD-0006 slice 3b) ─────────────────────────────
// Pure mirror of SQL `_voucher_discount_amount` in migration 068. Keeps the
// stacking math testable without a DB round trip; SQL is the source of truth.

describe('computeVoucherDiscount', () => {
  it('returns 0 for a null voucher', () => {
    expect(computeVoucherDiscount(1_000_000, null)).toBe(0)
  })

  it('returns 0 when price is 0 or negative (free course)', () => {
    expect(computeVoucherDiscount(0, { ...sampleVoucher })).toBe(0)
  })

  it('applies percentage discount with floor rounding', () => {
    // 17% of 999 = 169.83 → floor 169
    expect(
      computeVoucherDiscount(999, {
        discount_type: 'percentage',
        discount_value: 17,
        max_discount_amount: null,
      })
    ).toBe(169)
  })

  it('caps percentage discount at max_discount_amount when smaller', () => {
    // 50% of 1_000_000 = 500_000, but cap=300_000
    expect(
      computeVoucherDiscount(1_000_000, {
        discount_type: 'percentage',
        discount_value: 50,
        max_discount_amount: 300_000,
      })
    ).toBe(300_000)
  })

  it('applies fixed_amount discount, clamped at price', () => {
    expect(
      computeVoucherDiscount(80_000, {
        discount_type: 'fixed_amount',
        discount_value: 100_000,
        max_discount_amount: null,
      })
    ).toBe(80_000)
  })

  // ADR-0007 worked example: campaign + voucher stacking.
  // Course 1,000,000 ₫. Campaign -20% (=200,000). Voucher fixed -100,000.
  // Intermediate = 800,000. Voucher = 100,000. Final = 700,000.
  // Creator (80%) = floor(700,000 * 80/100) = 560,000. Platform = 140,000.
  it('matches the ADR-0007 worked example for campaign + voucher stacking', () => {
    const original = 1_000_000
    const campaignDiscount = 200_000 // applied externally (computeCampaignDiscount)
    const intermediate = original - campaignDiscount
    const voucherDiscount = computeVoucherDiscount(intermediate, {
      discount_type: 'fixed_amount',
      discount_value: 100_000,
      max_discount_amount: null,
    })
    expect(voucherDiscount).toBe(100_000)
    const finalPrice = Math.max(intermediate - voucherDiscount, 0)
    expect(finalPrice).toBe(700_000)
    const creator = Math.floor((finalPrice * 80) / 100)
    expect(creator).toBe(560_000)
    expect(finalPrice - creator).toBe(140_000)
  })

  // ADR-0007 free-path edge: if voucher + campaign together exceed original
  // price, final floors at 0. The voucher leg sees intermediate=0 and
  // returns 0 (price <= 0 short-circuit), so no negative discount.
  it('returns 0 when intermediate is already 0 (free path after campaign)', () => {
    expect(
      computeVoucherDiscount(0, {
        discount_type: 'fixed_amount',
        discount_value: 50_000,
        max_discount_amount: null,
      })
    ).toBe(0)
  })
})

// ── voucherErrorKey (PRD-0006 slice 3b) ────────────────────────────────────
// Maps the 6 PG exception messages raised by _resolve_voucher_for_purchase
// to i18n keys. Unknown messages fall through to a generic key — UI never
// shows raw "voucher_..." strings.

describe('voucherErrorKey', () => {
  it.each([
    ['voucher_not_found',           'voucher.error.notFound'],
    ['voucher_inactive',            'voucher.error.inactive'],
    ['voucher_expired',             'voucher.error.expired'],
    ['voucher_quota_exceeded',      'voucher.error.quotaExceeded'],
    ['voucher_user_limit',          'voucher.error.userLimitReached'],
    ['voucher_course_not_eligible', 'voucher.error.courseNotEligible'],
  ])('maps "%s" to i18n key "%s"', (message, expected) => {
    expect(voucherErrorKey({ message })).toBe(expected)
  })

  it('falls back to voucher.error.generic for unknown messages', () => {
    expect(voucherErrorKey({ message: 'something_else' })).toBe('voucher.error.generic')
  })

  it('falls back to voucher.error.generic for null / undefined error', () => {
    expect(voucherErrorKey(null)).toBe('voucher.error.generic')
    expect(voucherErrorKey(undefined)).toBe('voucher.error.generic')
  })

  it('matches when message wraps the code (PG often prefixes)', () => {
    expect(voucherErrorKey({ message: 'ERROR: voucher_expired' })).toBe('voucher.error.expired')
  })
})
