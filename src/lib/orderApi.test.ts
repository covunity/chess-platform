import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createOrder, confirmOrder, cancelOrder, listMyOrders, previewPurchase } from './orderApi'

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
  manual_confirm_reason: null,
  original_price: 480000,
  campaign_id: null,
  campaign_discount_amount: 0,
  created_at: '2026-05-09T11:00:00Z',
  updated_at: '2026-05-09T12:00:00Z',
}

// ── createOrder (existing — sanity) ────────────────────────────────────────

describe('createOrder', () => {
  it('calls create_order_with_fee_snapshot RPC with course id and null voucher by default', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleOrder, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await createOrder(client, 'c-1')
    expect(error).toBeNull()
    expect(order?.id).toBe('ord-1')
    expect(rpc).toHaveBeenCalledWith('create_order_with_fee_snapshot', {
      p_course_id: 'c-1',
      p_voucher_code: null,
    })
  })

  it('forwards voucher code when provided (slice 3b wiring)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleOrder, error: null })
    const client = { rpc } as unknown as SupabaseClient

    await createOrder(client, 'c-1', 'WELCOME10')
    expect(rpc).toHaveBeenCalledWith('create_order_with_fee_snapshot', {
      p_course_id: 'c-1',
      p_voucher_code: 'WELCOME10',
    })
  })

  it('returns null order when RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await createOrder(client, 'c-1')
    expect(order).toBeNull()
    expect(error).toBeTruthy()
  })

  // PRD-0006 slice 3b: voucher errcodes raised by atomic re-validation in
  // create_order_with_fee_snapshot bubble through unchanged so the page can
  // toast the right i18n key.
  it.each([
    ['voucher_not_found'],
    ['voucher_inactive'],
    ['voucher_expired'],
    ['voucher_quota_exceeded'],
    ['voucher_user_limit'],
    ['voucher_course_not_eligible'],
  ])('forwards %s errcode unchanged when creating an order with a voucher', async message => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message, code: '22023' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await createOrder(client, 'c-1', 'BADCODE')
    expect(order).toBeNull()
    expect((error as { message?: string }).message).toBe(message)
    expect((error as { code?: string }).code).toBe('22023')
  })
})

// ── previewPurchase ───────────────────────────────────────────────────────
// PRD-0006 §5.2. Slice 2 returns voucher fields as null/0 because the
// voucher table doesn't exist yet — slice 3b wires them.

describe('previewPurchase', () => {
  it('calls preview_purchase RPC and returns the breakdown', async () => {
    const breakdown = {
      original_price: 1_000_000,
      campaign_id: 'cmp-1',
      campaign_name: 'Tết Sale',
      campaign_discount_amount: 200_000,
      voucher_id: null,
      voucher_code: null,
      voucher_discount_amount: 0,
      final_price: 800_000,
      platform_fee_pct: 20,
      platform_fee_amount: 160_000,
      creator_payout_amount: 640_000,
    }
    const rpc = vi.fn().mockResolvedValue({ data: breakdown, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { preview, error } = await previewPurchase(client, 'c-1')
    expect(error).toBeNull()
    expect(preview?.final_price).toBe(800_000)
    expect(preview?.campaign_discount_amount).toBe(200_000)
    expect(rpc).toHaveBeenCalledWith('preview_purchase', {
      p_course_id: 'c-1',
      p_voucher_code: null,
    })
  })

  it('returns a breakdown with voucher fields null in slice 2', async () => {
    const breakdown = {
      original_price: 480_000,
      campaign_id: null,
      campaign_name: null,
      campaign_discount_amount: 0,
      voucher_id: null,
      voucher_code: null,
      voucher_discount_amount: 0,
      final_price: 480_000,
      platform_fee_pct: 20,
      platform_fee_amount: 96_000,
      creator_payout_amount: 384_000,
    }
    const rpc = vi.fn().mockResolvedValue({ data: breakdown, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { preview } = await previewPurchase(client, 'c-1')
    expect(preview?.voucher_id).toBeNull()
    expect(preview?.voucher_discount_amount).toBe(0)
    expect(preview?.final_price).toBe(preview?.original_price)
  })

  it('surfaces course_not_found errcode from RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'course_not_found', code: 'P0002' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { preview, error } = await previewPurchase(client, 'c-missing')
    expect(preview).toBeNull()
    expect((error as { message?: string }).message).toBe('course_not_found')
  })

  // PRD-0006 slice 3b: 6 voucher errcodes raised by _resolve_voucher_for_purchase
  // bubble through unchanged. The page maps them via voucherErrorKey.
  it.each([
    ['voucher_not_found'],
    ['voucher_inactive'],
    ['voucher_expired'],
    ['voucher_quota_exceeded'],
    ['voucher_user_limit'],
    ['voucher_course_not_eligible'],
  ])('forwards %s errcode unchanged when previewing with a voucher', async message => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message, code: '22023' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { preview, error } = await previewPurchase(client, 'c-1', 'BADCODE')
    expect(preview).toBeNull()
    expect((error as { message?: string }).message).toBe(message)
    expect((error as { code?: string }).code).toBe('22023')
    expect(rpc).toHaveBeenCalledWith('preview_purchase', {
      p_course_id: 'c-1',
      p_voucher_code: 'BADCODE',
    })
  })
})

// ── confirmOrder ───────────────────────────────────────────────────────────

describe('confirmOrder', () => {
  it('calls confirm_order RPC with order id + reason and returns the order', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: sampleOrder, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await confirmOrder(client, 'ord-1', 'bank statement OK')
    expect(error).toBeNull()
    expect(order?.status).toBe('active')
    expect(rpc).toHaveBeenCalledWith('confirm_order', {
      p_order_id: 'ord-1',
      p_reason: 'bank statement OK',
    })
  })

  it('forwards RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await confirmOrder(client, 'ord-1', 'bank statement OK')
    expect(order).toBeNull()
    expect((error as { message?: string }).message).toBe('forbidden')
  })

  it('forwards reason_required errcode 22023 from RPC when reason is empty', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'reason_required', code: '22023' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await confirmOrder(client, 'ord-1', '')
    expect(order).toBeNull()
    expect((error as { message?: string; code?: string }).message).toBe('reason_required')
    expect((error as { code?: string }).code).toBe('22023')
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

  // ── Issue #292: status-allowlist guard from migration 062 ─────────────────
  //
  // cancel_order now refuses any status outside (pending|active) with a
  // distinct message per terminal/in-flight state. The wrapper must forward
  // each one unmodified so the UI can map to a user-facing toast.
  it.each([
    ['cannot_cancel_refund_pending_order'],
    ['cannot_cancel_refunded_order'],
    ['cannot_cancel_expired_order'],
    ['order_already_cancelled'],
  ])('forwards new status-guard error %s with errcode 22023', async message => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message, code: '22023' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await cancelOrder(client, 'ord-1', 'admin attempt')
    expect(order).toBeNull()
    expect((error as { message?: string; code?: string }).message).toBe(message)
    expect((error as { message?: string; code?: string }).code).toBe('22023')
  })

  // ── Issue #308 (slice 4): voucher quota refund on cancel ─────────────────
  //
  // Migration 069 extends cancel_order to refund voucher quota +
  // delete voucher_usages atomically in the same transaction as the
  // status flip. The JS wrapper is a thin forwarder and does NOT
  // need to know about the new SQL side-effects, but these tests
  // document the contract the server now upholds:
  //
  //   * The cancelled order returned still carries voucher_id +
  //     voucher_code + voucher_discount_amount as a snapshot (ADR-0002
  //     E-07 pattern). Cancellation does not blank the snapshot — it
  //     only releases quota.
  //   * No new errcodes are introduced; the voucher block is unconditional
  //     and silent (no-op when voucher_id IS NULL).
  //
  // Behavior verified end-to-end in migration 069 header (7 scenarios).
  it('returns cancelled order with voucher snapshot preserved (quota refunded server-side)', async () => {
    const cancelled = {
      ...sampleOrder,
      status: 'cancelled' as const,
      cancelled_reason: 'learner changed mind',
      voucher_id: 'v-abc',
      voucher_code: 'WELCOME10',
      voucher_discount_amount: 50_000,
    }
    const rpc = vi.fn().mockResolvedValue({ data: cancelled, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await cancelOrder(client, 'ord-1', 'learner changed mind')
    expect(error).toBeNull()
    expect(order?.status).toBe('cancelled')
    // Snapshot survives cancel: the order still records which voucher was used.
    expect(order?.voucher_id).toBe('v-abc')
    expect(order?.voucher_code).toBe('WELCOME10')
    expect(order?.voucher_discount_amount).toBe(50_000)
  })

  it('cancel of an order without a voucher remains a no-op for the voucher block', async () => {
    // Sanity: confirm the wrapper does not invent voucher params and that
    // the returned order's voucher fields stay null. The SQL IF-guard in
    // migration 069 short-circuits on NULL voucher_id, so no regression
    // path for vanilla pending cancels.
    const cancelled = { ...sampleOrder, status: 'cancelled' as const, voucher_id: null }
    const rpc = vi.fn().mockResolvedValue({ data: cancelled, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await cancelOrder(client, 'ord-1', 'duplicate')
    expect(error).toBeNull()
    expect(order?.voucher_id).toBeNull()
    expect(rpc).toHaveBeenCalledWith('cancel_order', {
      p_order_id: 'ord-1',
      p_reason: 'duplicate',
    })
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
