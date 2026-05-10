import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createOrder, confirmOrder, cancelOrder, listMyOrders } from './orderApi'

const sampleOrder = {
  id: 'ord-1',
  course_id: 'c-1',
  user_id: 'u-1',
  status: 'active' as const,
  amount: 480000,
  code: 'ORD-2026-000142',
  notes: null,
  platform_fee_pct: 20,
  platform_fee_amount: 96000,
  creator_payout_amount: 384000,
  creator_payout: 384000,
  account_tier_code: 'individual' as const,
  confirmed_at: '2026-05-09T12:00:00Z',
  confirmed_by: 'admin-1',
  cancelled_at: null,
  cancelled_by: null,
  cancelled_reason: null,
  created_at: '2026-05-09T11:00:00Z',
  updated_at: '2026-05-09T12:00:00Z',
}

// ── createOrder (existing — sanity) ────────────────────────────────────────

describe('createOrder', () => {
  it('calls create_order_with_fee_snapshot RPC with course id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleOrder, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await createOrder(client, 'c-1')
    expect(error).toBeNull()
    expect(order?.id).toBe('ord-1')
    expect(rpc).toHaveBeenCalledWith('create_order_with_fee_snapshot', { p_course_id: 'c-1' })
  })

  it('returns null order when RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await createOrder(client, 'c-1')
    expect(order).toBeNull()
    expect(error).toBeTruthy()
  })
})

// ── confirmOrder ───────────────────────────────────────────────────────────

describe('confirmOrder', () => {
  it('calls confirm_order RPC with order id and returns the order', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleOrder, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await confirmOrder(client, 'ord-1')
    expect(error).toBeNull()
    expect(order?.status).toBe('active')
    expect(rpc).toHaveBeenCalledWith('confirm_order', { p_order_id: 'ord-1' })
  })

  it('forwards RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await confirmOrder(client, 'ord-1')
    expect(order).toBeNull()
    expect((error as { message?: string }).message).toBe('forbidden')
  })
})

// ── cancelOrder ────────────────────────────────────────────────────────────

describe('cancelOrder', () => {
  it('calls cancel_order RPC with order id + reason', async () => {
    const cancelled = { ...sampleOrder, status: 'cancelled' as const, cancelled_reason: 'wrong amount' }
    const rpc = vi.fn().mockResolvedValue({ data: cancelled, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await cancelOrder(client, 'ord-1', 'wrong amount')
    expect(error).toBeNull()
    expect(order?.status).toBe('cancelled')
    expect(order?.cancelled_reason).toBe('wrong amount')
    expect(rpc).toHaveBeenCalledWith('cancel_order', {
      p_order_id: 'ord-1',
      p_reason: 'wrong amount',
    })
  })

  it('forwards RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'order_already_cancelled' } })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await cancelOrder(client, 'ord-1', 'duplicate')
    expect(order).toBeNull()
    expect((error as { message?: string }).message).toBe('order_already_cancelled')
  })
})

// ── getOrder ───────────────────────────────────────────────────────────────

describe('getOrder', () => {
  it('fetches single order with course join by order id', async () => {
    const row = {
      ...sampleOrder,
      course: { id: 'c-1', title: 'Chess Basics', thumbnail_url: '/t.jpg' },
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { order, error } = await (await import('./orderApi')).getOrder(client, 'ord-1')
    expect(error).toBeNull()
    expect(order?.id).toBe('ord-1')
    expect(client.from).toHaveBeenCalledWith('orders')
    expect(chain.eq).toHaveBeenCalledWith('id', 'ord-1')
  })

  it('returns null when not found', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { order, error } = await (await import('./orderApi')).getOrder(client, 'ord-missing')
    expect(order).toBeNull()
    expect(error).toBeTruthy()
  })
})

// ── getPendingOrderForCourse ────────────────────────────────────────────────

describe('getPendingOrderForCourse', () => {
  it('returns pending order for given course and user', async () => {
    const pending = { ...sampleOrder, status: 'pending' as const }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: pending, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { order, error } = await (await import('./orderApi')).getPendingOrderForCourse(client, 'c-1', 'u-1')
    expect(error).toBeNull()
    expect(order?.status).toBe('pending')
    expect(chain.eq).toHaveBeenCalledWith('course_id', 'c-1')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u-1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('returns null when no pending order exists', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { order, error } = await (await import('./orderApi')).getPendingOrderForCourse(client, 'c-no-order', 'u-1')
    expect(order).toBeNull()
    expect(error).toBeNull()
  })

  it('admin browsing course with another user pending order sees null — filtered by own userId', async () => {
    // Admin's userId is 'admin-1'. Only 'u-2' has a pending order. Query returns null.
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { order, error } = await (await import('./orderApi')).getPendingOrderForCourse(client, 'c-1', 'admin-1')
    expect(order).toBeNull()
    expect(error).toBeNull()
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'admin-1')
  })

  it('does not throw when multiple users have pending orders for same course — filters by userId', async () => {
    // With user_id filter, maybeSingle() always gets 0 or 1 row — no multi-row error
    const adminPending = { ...sampleOrder, user_id: 'admin-1', status: 'pending' as const }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: adminPending, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { order, error } = await (await import('./orderApi')).getPendingOrderForCourse(client, 'c-1', 'admin-1')
    expect(error).toBeNull()
    expect(order?.user_id).toBe('admin-1')
  })
})

// ── listMyOrders ───────────────────────────────────────────────────────────

describe('listMyOrders', () => {
  function makeChain(data: unknown[] = [], total = 0, error: unknown = null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data, count: total, error }),
    }
  }

  const row = {
    ...sampleOrder,
    course: { id: 'c-1', title: 'Chess Basics', thumbnail_url: '/t.jpg' },
  }

  it('returns rows joined with course thumbnail and orders by created_at desc', async () => {
    const chain = makeChain([row], 1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listMyOrders(client, { page: 1, pageSize: 20 })
    expect(error).toBeNull()
    expect(total).toBe(1)
    expect(orders[0].course?.thumbnail_url).toBe('/t.jpg')
    expect(client.from).toHaveBeenCalledWith('orders')
    expect(chain.eq).not.toHaveBeenCalled()
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.range).toHaveBeenCalledWith(0, 19)
  })

  it('applies status filter when provided', async () => {
    const chain = makeChain([row], 1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listMyOrders(client, { status: 'pending', page: 1, pageSize: 20 })
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('paginates correctly for page 3 / pageSize 10', async () => {
    const chain = makeChain([], 0)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listMyOrders(client, { page: 3, pageSize: 10 })
    expect(chain.range).toHaveBeenCalledWith(20, 29)
  })
})
