import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCreatorWallet, fetchRecentEarnings, fetchPayoutHistory } from './creatorWalletApi'

describe('fetchCreatorWallet', () => {
  it('returns pending_balance, total_paid_out, lifetime_earnings for caller', async () => {
    // 2 unpaid orders (1_536_000) + 1 paid-out order (768_000) = 2_304_000 lifetime
    const coursesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'c-1' }], error: null }),
    }
    const ordersChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [
          { creator_payout: 768_000, paid_out_in: null },
          { creator_payout: 768_000, paid_out_in: null },
          { creator_payout: 768_000, paid_out_in: 'payout-1' },
        ],
        error: null,
      }),
    }
    const client = {
      from: vi.fn().mockImplementation((table: string) =>
        table === 'courses' ? coursesChain : ordersChain
      ),
    } as unknown as SupabaseClient

    const { wallet, error } = await fetchCreatorWallet(client, 'creator-1')

    expect(error).toBeNull()
    expect(wallet).toEqual({
      pendingBalance: 1_536_000,
      totalPaidOut: 768_000,
      lifetimeEarnings: 2_304_000,
    })
    expect(client.from).toHaveBeenCalledWith('courses')
    expect(client.from).toHaveBeenCalledWith('orders')
    expect(coursesChain.eq).toHaveBeenCalledWith('creator_id', 'creator-1')
    expect(ordersChain.eq).toHaveBeenCalledWith('status', 'active')
    expect(ordersChain.in).toHaveBeenCalledWith('course_id', ['c-1'])
  })

  it('returns zero balances when creator has no courses', async () => {
    const coursesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(coursesChain) } as unknown as SupabaseClient

    const { wallet, error } = await fetchCreatorWallet(client, 'creator-2')

    expect(error).toBeNull()
    expect(wallet).toEqual({
      pendingBalance: 0,
      totalPaidOut: 0,
      lifetimeEarnings: 0,
    })
  })

  it('returns zero balances + error when courses query fails', async () => {
    const coursesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } }),
    }
    const client = { from: vi.fn().mockReturnValue(coursesChain) } as unknown as SupabaseClient

    const { wallet, error } = await fetchCreatorWallet(client, 'creator-3')

    expect(error).toBeTruthy()
    expect(wallet).toEqual({
      pendingBalance: 0,
      totalPaidOut: 0,
      lifetimeEarnings: 0,
    })
  })
})

describe('fetchRecentEarnings', () => {
  it('fetches last 20 active orders contributing to pending balance', async () => {
    const row = {
      id: 'ord-1',
      amount: 480_000,
      creator_payout: 384_000,
      confirmed_at: '2026-05-15T11:00:00Z',
      course: { id: 'c-1', title: 'Tấn công kiểu Sicilian' },
      buyer: { id: 'u-1', email: 'alice@test.com' },
    }
    const ordersChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
    }
    const coursesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'c-1' }], error: null }),
    }
    const client = {
      from: vi.fn().mockImplementation((table: string) =>
        table === 'courses' ? coursesChain : ordersChain
      ),
    } as unknown as SupabaseClient

    const { earnings, error } = await fetchRecentEarnings(client, 'creator-1', 20)

    expect(error).toBeNull()
    expect(earnings).toHaveLength(1)
    expect(earnings[0]).toMatchObject({
      orderId: 'ord-1',
      amount: 480_000,
      creatorPayout: 384_000,
      courseTitle: 'Tấn công kiểu Sicilian',
      buyerEmail: 'alice@test.com',
      confirmedAt: '2026-05-15T11:00:00Z',
    })
    expect(coursesChain.eq).toHaveBeenCalledWith('creator_id', 'creator-1')
    expect(ordersChain.eq).toHaveBeenCalledWith('status', 'active')
    expect(ordersChain.is).toHaveBeenCalledWith('paid_out_in', null)
    expect(ordersChain.in).toHaveBeenCalledWith('course_id', ['c-1'])
    expect(ordersChain.order).toHaveBeenCalledWith('confirmed_at', { ascending: false })
    expect(ordersChain.limit).toHaveBeenCalledWith(20)
  })

  it('returns empty array when creator has no courses', async () => {
    const coursesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const client = {
      from: vi.fn().mockReturnValue(coursesChain),
    } as unknown as SupabaseClient

    const { earnings, error } = await fetchRecentEarnings(client, 'creator-0', 20)

    expect(error).toBeNull()
    expect(earnings).toEqual([])
  })
})

describe('fetchPayoutHistory', () => {
  it('returns payouts ordered by transferred_at desc for the caller', async () => {
    const row = {
      id: 'pay-1',
      amount: 768_000,
      bank_code: 'MBBANK',
      bank_name: 'MB Bank',
      account_number: '0987654321',
      account_holder: 'NGUYEN VAN A',
      transferred_at: '2026-05-13T09:00:00Z',
      reference_note: 'TXN-2026-05-13-001',
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [row], error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payouts, error } = await fetchPayoutHistory(client, 'creator-1')

    expect(error).toBeNull()
    expect(payouts).toHaveLength(1)
    expect(payouts[0]).toMatchObject({
      id: 'pay-1',
      amount: 768_000,
      bankName: 'MB Bank',
      accountNumber: '0987654321',
      accountHolder: 'NGUYEN VAN A',
      transferredAt: '2026-05-13T09:00:00Z',
      referenceNote: 'TXN-2026-05-13-001',
    })
    expect(client.from).toHaveBeenCalledWith('payouts')
    expect(chain.eq).toHaveBeenCalledWith('creator_id', 'creator-1')
    expect(chain.order).toHaveBeenCalledWith('transferred_at', { ascending: false })
  })

  it('returns empty array when no payouts exist (pre-slice-7 state)', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { payouts, error } = await fetchPayoutHistory(client, 'creator-1')

    expect(error).toBeNull()
    expect(payouts).toEqual([])
  })
})
