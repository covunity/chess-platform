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
    expect(formatVoucherDiscount({ ...sampleVoucher, discount_type: 'fixed_amount', discount_value: 50000 })).toBe('-50.000₫')
  })
})
