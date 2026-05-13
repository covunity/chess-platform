import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getMyCreatorPayoutInfo,
  updateCreatorPayoutInfo,
  findDuplicatePayoutOwners,
  validatePayoutInput,
} from './creatorPayoutInfoApi'

const validInput = {
  bank_code: 'VCB',
  bank_name: 'Vietcombank',
  account_number: '0123456789',
  account_holder: 'NGUYEN VAN A',
  bank_branch: 'Chi nhánh TP HCM',
}

// ── validatePayoutInput ────────────────────────────────────────────────────

describe('validatePayoutInput', () => {
  it('returns null for a valid input', () => {
    expect(validatePayoutInput(validInput)).toBeNull()
  })

  it('rejects missing bank_code', () => {
    expect(validatePayoutInput({ ...validInput, bank_code: '' })).toBe('bank_code')
    expect(validatePayoutInput({ ...validInput, bank_code: '   ' })).toBe('bank_code')
  })

  it('rejects missing bank_name', () => {
    expect(validatePayoutInput({ ...validInput, bank_name: '' })).toBe('bank_name')
  })

  it('rejects account_number that is not 6-19 digits', () => {
    expect(validatePayoutInput({ ...validInput, account_number: '' })).toBe('account_number')
    expect(validatePayoutInput({ ...validInput, account_number: '12345' })).toBe('account_number')
    expect(validatePayoutInput({ ...validInput, account_number: '1'.repeat(20) })).toBe('account_number')
    expect(validatePayoutInput({ ...validInput, account_number: '12345abc' })).toBe('account_number')
  })

  it('accepts account_number at length boundaries', () => {
    expect(validatePayoutInput({ ...validInput, account_number: '123456' })).toBeNull()
    expect(validatePayoutInput({ ...validInput, account_number: '1'.repeat(19) })).toBeNull()
  })

  it('rejects missing account_holder', () => {
    expect(validatePayoutInput({ ...validInput, account_holder: '   ' })).toBe('account_holder')
  })

  it('rejects missing bank_branch', () => {
    expect(validatePayoutInput({ ...validInput, bank_branch: '' })).toBe('bank_branch')
  })
})

// ── getMyCreatorPayoutInfo ─────────────────────────────────────────────────

describe('getMyCreatorPayoutInfo', () => {
  it('selects the caller row from creator_payout_info', async () => {
    const row = { user_id: 'u1', ...validInput, updated_at: '2026-05-13T00:00:00Z' }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payout, error } = await getMyCreatorPayoutInfo(client, 'u1')

    expect(error).toBeNull()
    expect(client.from).toHaveBeenCalledWith('creator_payout_info')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(payout).toEqual(row)
  })

  it('returns null payout when no row exists (no error)', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payout, error } = await getMyCreatorPayoutInfo(client, 'u1')
    expect(error).toBeNull()
    expect(payout).toBeNull()
  })

  it('forwards DB errors', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payout, error } = await getMyCreatorPayoutInfo(client, 'u1')
    expect(error).toBeTruthy()
    expect(payout).toBeNull()
  })
})

// ── updateCreatorPayoutInfo ────────────────────────────────────────────────

describe('updateCreatorPayoutInfo', () => {
  it('calls update_creator_payout_info RPC with payload jsonb', async () => {
    const returned = { user_id: 'u1', ...validInput, updated_at: '2026-05-13T00:00:00Z' }
    const rpc = vi.fn().mockResolvedValue({ data: returned, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { payout, error } = await updateCreatorPayoutInfo(client, validInput)

    expect(error).toBeNull()
    expect(payout).toEqual(returned)
    expect(rpc).toHaveBeenCalledWith('update_creator_payout_info', { payload: validInput })
  })

  it('forwards RPC errors verbatim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    const client = { rpc } as unknown as SupabaseClient

    const { payout, error } = await updateCreatorPayoutInfo(client, validInput)
    expect(payout).toBeNull()
    expect(error).toBeTruthy()
  })
})

// ── findDuplicatePayoutOwners ──────────────────────────────────────────────

describe('findDuplicatePayoutOwners', () => {
  it('calls RPC with prefixed param names', async () => {
    const rows = [{ user_id: 'u2', name: 'Bob', email: 'bob@x.io' }]
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { owners, error } = await findDuplicatePayoutOwners(client, {
      bank_code: 'VCB',
      account_number: '0123456789',
      exclude_user_id: 'u1',
    })

    expect(error).toBeNull()
    expect(owners).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('find_duplicate_payout_owners', {
      p_bank_code: 'VCB',
      p_account_number: '0123456789',
      p_exclude_user_id: 'u1',
    })
  })

  it('omits exclude_user_id when undefined and returns [] on null data', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { owners, error } = await findDuplicatePayoutOwners(client, {
      bank_code: 'VCB',
      account_number: '0123456789',
    })

    expect(error).toBeNull()
    expect(owners).toEqual([])
    expect(rpc).toHaveBeenCalledWith('find_duplicate_payout_owners', {
      p_bank_code: 'VCB',
      p_account_number: '0123456789',
      p_exclude_user_id: null,
    })
  })
})
