import { describe, it, expect, vi } from 'vitest'
import { getBankConfig, updateBankConfig } from './configApi'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── getBankConfig ──────────────────────────────────────────────────────────

describe('getBankConfig', () => {
  it('reads the 4 bank keys from config and returns a typed object', async () => {
    const rows = [
      { key: 'bank_short_name',     value: 'MBBANK' },
      { key: 'bank_bin',            value: '970422' },
      { key: 'bank_account_number', value: '0123456789' },
      { key: 'bank_account_name',   value: 'CHESS COURSE' },
    ]
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { bank, error } = await getBankConfig(client)

    expect(error).toBeNull()
    expect(client.from).toHaveBeenCalledWith('config')
    expect(chain.select).toHaveBeenCalledWith('key, value')
    expect(chain.in).toHaveBeenCalledWith('key', [
      'bank_short_name',
      'bank_bin',
      'bank_account_number',
      'bank_account_name',
    ])
    expect(bank).toEqual({
      short_name: 'MBBANK',
      bin: '970422',
      account_number: '0123456789',
      account_name: 'CHESS COURSE',
    })
  })

  it('returns nulls for missing keys without erroring', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [
        { key: 'bank_short_name', value: 'MBBANK' },
      ], error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { bank, error } = await getBankConfig(client)
    expect(error).toBeNull()
    expect(bank).toEqual({
      short_name: 'MBBANK',
      bin: null,
      account_number: null,
      account_name: null,
    })
  })

  it('returns error and null bank when DB fails', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { bank, error } = await getBankConfig(client)
    expect(error).toBeTruthy()
    expect(bank).toBeNull()
  })
})

// ── updateBankConfig ───────────────────────────────────────────────────────

describe('updateBankConfig', () => {
  it('calls update_bank_config RPC with mapped param names', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { error } = await updateBankConfig(client, {
      short_name: 'MBBANK',
      bin: '970422',
      account_number: '0123456789',
      account_name: 'CHESS COURSE',
    })

    expect(error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('update_bank_config', {
      p_short_name: 'MBBANK',
      p_bin: '970422',
      p_account_number: '0123456789',
      p_account_name: 'CHESS COURSE',
    })
  })

  it('forwards RPC errors verbatim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } })
    const client = { rpc } as unknown as SupabaseClient

    const { error } = await updateBankConfig(client, {
      short_name: 'MBBANK',
      bin: '970422',
      account_number: '0123456789',
      account_name: 'CHESS COURSE',
    })

    expect(error).toBeTruthy()
    expect((error as { message?: string }).message).toBe('forbidden')
  })
})
