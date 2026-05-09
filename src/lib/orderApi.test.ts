import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createOrder, confirmOrder, cancelOrder } from './orderApi'

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
