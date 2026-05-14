import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listCreatorFees,
  setCreatorFeeOverride,
  clearCreatorFeeOverride,
  validateOverridePct,
} from './adminCreatorFeesApi'

// ── validateOverridePct ────────────────────────────────────────────────────

describe('validateOverridePct', () => {
  it('returns null for valid values', () => {
    expect(validateOverridePct('0')).toBeNull()
    expect(validateOverridePct('12.5')).toBeNull()
    expect(validateOverridePct('100')).toBeNull()
  })
  it('rejects empty / whitespace', () => {
    expect(validateOverridePct('')).toBe('required')
    expect(validateOverridePct('   ')).toBe('required')
  })
  it('rejects non-numeric strings', () => {
    expect(validateOverridePct('abc')).toBe('numeric')
    expect(validateOverridePct('12,5')).toBe('numeric')
  })
  it('rejects out-of-range values', () => {
    expect(validateOverridePct('-1')).toBe('range')
    expect(validateOverridePct('100.01')).toBe('range')
    expect(validateOverridePct('200')).toBe('range')
  })
})

// ── listCreatorFees ────────────────────────────────────────────────────────

describe('listCreatorFees', () => {
  it('calls admin_list_creator_fees RPC with all params + parses rows + total', async () => {
    const rows = [
      {
        user_id: 'u1',
        name: 'Alice',
        email: 'alice@x.io',
        account_tier_id: 'individual',
        tier_name_vi: 'Cá nhân',
        tier_fee_pct: 20,
        platform_fee_pct_override: 12.5,
        effective_fee_pct: 12.5,
        total_count: 2,
      },
      {
        user_id: 'u2',
        name: 'Bob',
        email: 'bob@x.io',
        account_tier_id: 'business',
        tier_name_vi: 'Doanh nghiệp',
        tier_fee_pct: 15,
        platform_fee_pct_override: null,
        effective_fee_pct: 15,
        total_count: 2,
      },
    ]
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { creators, total, error } = await listCreatorFees(client, {
      search: 'alice',
      overrides_only: true,
      limit: 25,
      offset: 50,
    })

    expect(error).toBeNull()
    expect(total).toBe(2)
    expect(creators).toHaveLength(2)
    expect(creators[0].effective_fee_pct).toBe(12.5)
    expect(creators[1].platform_fee_pct_override).toBeNull()
    expect(rpc).toHaveBeenCalledWith('admin_list_creator_fees', {
      p_search: 'alice',
      p_overrides_only: true,
      p_limit: 25,
      p_offset: 50,
    })
  })

  it('defaults search to null, overrides_only false, limit 50, offset 0', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient

    await listCreatorFees(client, {})

    expect(rpc).toHaveBeenCalledWith('admin_list_creator_fees', {
      p_search: null,
      p_overrides_only: false,
      p_limit: 50,
      p_offset: 0,
    })
  })

  it('returns total=0 + empty creators when RPC returns no rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { creators, total, error } = await listCreatorFees(client, {})
    expect(error).toBeNull()
    expect(total).toBe(0)
    expect(creators).toEqual([])
  })

  it('forwards RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    const client = { rpc } as unknown as SupabaseClient

    const { creators, error } = await listCreatorFees(client, {})
    expect(error).toBeTruthy()
    expect(creators).toEqual([])
  })
})

// ── setCreatorFeeOverride ──────────────────────────────────────────────────

describe('setCreatorFeeOverride', () => {
  it('calls admin_set_creator_fee_override RPC with numeric pct', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: 'u1', platform_fee_pct_override: 12.5 },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { user, error } = await setCreatorFeeOverride(client, 'u1', 12.5)
    expect(error).toBeNull()
    expect(user?.platform_fee_pct_override).toBe(12.5)
    expect(rpc).toHaveBeenCalledWith('admin_set_creator_fee_override', {
      p_user_id: 'u1',
      p_pct: 12.5,
    })
  })

  it('returns null user + error when RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    const client = { rpc } as unknown as SupabaseClient

    const { user, error } = await setCreatorFeeOverride(client, 'u1', 50)
    expect(user).toBeNull()
    expect(error).toBeTruthy()
  })
})

// ── clearCreatorFeeOverride ────────────────────────────────────────────────

describe('clearCreatorFeeOverride', () => {
  it('calls admin_clear_creator_fee_override RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: 'u1', platform_fee_pct_override: null },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { user, error } = await clearCreatorFeeOverride(client, 'u1')
    expect(error).toBeNull()
    expect(user?.platform_fee_pct_override).toBeNull()
    expect(rpc).toHaveBeenCalledWith('admin_clear_creator_fee_override', {
      p_user_id: 'u1',
    })
  })
})
