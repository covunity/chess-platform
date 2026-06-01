import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchPendingPayouts,
  fetchCreatorsWithoutPayoutInfo,
  createWeeklyPayouts,
  markPayoutComplete,
  buildPayoutsCsv,
  isoWeek,
} from './adminPayoutsApi'
import type { PendingPayout } from './adminPayoutsApi'

describe('fetchPendingPayouts', () => {
  it('selects payouts with reference_note IS NULL joined with creator name + email', async () => {
    const row = {
      id: 'pay-1',
      creator_id: 'creator-1',
      admin_id: 'admin-1',
      amount: 1_536_000,
      bank_code: 'VCB',
      bank_name: 'Vietcombank',
      account_number: '1234567890',
      account_holder: 'ALICE NGUYEN',
      order_ids: ['ord-1', 'ord-2'],
      transferred_at: '2026-05-19T08:00:00Z',
      reference_note: null,
      creator: { id: 'creator-1', name: 'Alice', email: 'alice@x.io' },
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [row], error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payouts, error } = await fetchPendingPayouts(client)

    expect(error).toBeNull()
    expect(payouts).toHaveLength(1)
    expect(payouts[0]).toMatchObject({
      id: 'pay-1',
      creatorId: 'creator-1',
      creatorName: 'Alice',
      creatorEmail: 'alice@x.io',
      amount: 1_536_000,
      bankName: 'Vietcombank',
      accountNumber: '1234567890',
      accountHolder: 'ALICE NGUYEN',
      orderCount: 2,
    })
    expect(client.from).toHaveBeenCalledWith('payouts')
    expect(chain.is).toHaveBeenCalledWith('reference_note', null)
    expect(chain.order).toHaveBeenCalledWith('transferred_at', { ascending: false })
  })

  it('returns empty + error on failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payouts, error } = await fetchPendingPayouts(client)
    expect(payouts).toEqual([])
    expect(error).toBeTruthy()
  })
})

describe('buildPayoutsCsv', () => {
  const payout: PendingPayout = {
    id: 'pay-1',
    creatorId: 'c-1',
    creatorName: 'Alice Nguyễn',
    creatorEmail: 'alice@x.io',
    adminId: 'a-1',
    amount: 1_536_000,
    bankCode: 'VCB',
    bankName: 'Vietcombank',
    accountNumber: '1234567890',
    accountHolder: 'ALICE NGUYEN',
    orderIds: ['o-1', 'o-2'],
    orderCount: 2,
    transferredAt: '2026-05-19T08:00:00Z',
    referenceNote: null,
  }

  it('emits UTF-8 BOM as first character', () => {
    const csv = buildPayoutsCsv([payout], new Date('2026-05-19T00:00:00Z'))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('emits the PRD-specified header row in order', () => {
    const csv = buildPayoutsCsv([payout], new Date('2026-05-19T00:00:00Z'))
    const lines = csv.replace(/^\uFEFF/, '').split('\n')
    expect(lines[0]).toBe(
      'STT,Người nhận,Ngân hàng,Số tài khoản,Số tiền (VND),Nội dung CK,Email creator,Số đơn,Payout ID'
    )
  })

  it('writes one row per payout with sequential STT starting at 1', () => {
    const second: PendingPayout = { ...payout, id: 'pay-2', creatorName: 'Bob', amount: 100_000 }
    const csv = buildPayoutsCsv([payout, second], new Date('2026-05-19T00:00:00Z'))
    const lines = csv.replace(/^\uFEFF/, '').split('\n')
    expect(lines[1].startsWith('1,')).toBe(true)
    expect(lines[2].startsWith('2,')).toBe(true)
  })

  it('formats memo as "Counity payout T<MM>-<YYYY> [creator_name]"', () => {
    const csv = buildPayoutsCsv([payout], new Date('2026-05-19T00:00:00Z'))
    expect(csv).toContain('Counity payout T05-2026 Alice Nguyễn')
  })

  it('escapes quotes and commas in creator names', () => {
    const tricky: PendingPayout = { ...payout, creatorName: 'O"Hara, Inc' }
    const csv = buildPayoutsCsv([tricky], new Date('2026-05-19T00:00:00Z'))
    // Field with comma must be quoted; embedded quote doubled
    expect(csv).toContain('"O""Hara, Inc"')
  })

  it('uses email as fallback when creator name is missing', () => {
    const noName: PendingPayout = { ...payout, creatorName: null }
    const csv = buildPayoutsCsv([noName], new Date('2026-05-19T00:00:00Z'))
    expect(csv).toContain('alice@x.io')
  })
})

describe('isoWeek', () => {
  it('returns ISO week 21 for 2026-05-19 (Tuesday)', () => {
    expect(isoWeek(new Date('2026-05-19T00:00:00Z'))).toEqual({ year: 2026, week: 21 })
  })

  it('returns previous-year week for early January dates that belong to last ISO year', () => {
    // 2027-01-01 is a Friday → ISO week 53 of 2026
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toEqual({ year: 2026, week: 53 })
  })

  it('returns week 1 for first ISO week dates', () => {
    // 2026-01-05 is a Monday → ISO week 2 of 2026 (since Jan 1 2026 is Thursday → wk 1)
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toEqual({ year: 2026, week: 1 })
  })
})

describe('createWeeklyPayouts', () => {
  it('invokes the create_weekly_payouts RPC and maps result rows', async () => {
    const data = [
      {
        id: 'pay-new',
        creator_id: 'creator-1',
        admin_id: 'admin-1',
        amount: 200_000,
        bank_code: 'VCB',
        bank_name: 'Vietcombank',
        account_number: '111',
        account_holder: 'ALICE',
        order_ids: ['o-1'],
        transferred_at: '2026-05-19T08:00:00Z',
        reference_note: null,
      },
    ]
    const client = {
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    } as unknown as SupabaseClient

    const { payouts, error } = await createWeeklyPayouts(client)

    expect(error).toBeNull()
    expect(client.rpc).toHaveBeenCalledWith('create_weekly_payouts')
    expect(payouts).toHaveLength(1)
    expect(payouts[0].id).toBe('pay-new')
    expect(payouts[0].amount).toBe(200_000)
    expect(payouts[0].orderCount).toBe(1)
  })

  it('returns empty + error on RPC failure', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } }),
    } as unknown as SupabaseClient
    const { payouts, error } = await createWeeklyPayouts(client)
    expect(payouts).toEqual([])
    expect(error).toBeTruthy()
  })
})

describe('markPayoutComplete', () => {
  it('calls mark_payout_complete RPC with payout id + reference and returns updated row', async () => {
    const updated = {
      id: 'pay-1',
      creator_id: 'creator-1',
      admin_id: 'admin-1',
      amount: 200_000,
      bank_code: 'VCB',
      bank_name: 'Vietcombank',
      account_number: '111',
      account_holder: 'ALICE',
      order_ids: ['o-1'],
      transferred_at: '2026-05-19T08:00:00Z',
      reference_note: 'FT26139ABC',
    }
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: updated, error: null }),
    } as unknown as SupabaseClient

    const { payout, error } = await markPayoutComplete(client, 'pay-1', 'FT26139ABC')

    expect(error).toBeNull()
    expect(client.rpc).toHaveBeenCalledWith('mark_payout_complete', {
      p_payout_id: 'pay-1',
      p_reference_note: 'FT26139ABC',
    })
    expect(payout?.id).toBe('pay-1')
    expect(payout?.referenceNote).toBe('FT26139ABC')
  })

  it('returns null payout + error on RPC failure', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'already marked' } }),
    } as unknown as SupabaseClient
    const { payout, error } = await markPayoutComplete(client, 'pay-1', 'FT')
    expect(payout).toBeNull()
    expect(error).toBeTruthy()
  })
})

describe('fetchCreatorsWithoutPayoutInfo', () => {
  it('returns creators with pending_balance > 0 but no creator_payout_info row', async () => {
    const rpcResult = [
      { creator_id: 'creator-2', name: 'Bob', email: 'bob@x.io', pending_balance: 480_000 },
    ]
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: rpcResult, error: null }),
    } as unknown as SupabaseClient

    const { creators, error } = await fetchCreatorsWithoutPayoutInfo(client)

    expect(error).toBeNull()
    expect(creators).toEqual([
      { creatorId: 'creator-2', name: 'Bob', email: 'bob@x.io', pendingBalance: 480_000 },
    ])
    expect(client.rpc).toHaveBeenCalledWith('list_creators_missing_payout_info')
  })

  it('returns empty + error on failure', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } }),
    } as unknown as SupabaseClient
    const { creators, error } = await fetchCreatorsWithoutPayoutInfo(client)
    expect(creators).toEqual([])
    expect(error).toBeTruthy()
  })
})
