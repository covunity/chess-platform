import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPayosPayment } from './payos'

describe('createPayosPayment', () => {
  it('invokes the payos-create-payment edge function with the order id', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        qrCode: 'QR_PAYLOAD',
        accountNumber: '0123456789',
        accountName: 'CONG TY ABC',
        bin: '970422',
        amount: 480000,
        description: 'ORD-2026-000042',
        checkoutUrl: 'https://pay.payos.vn/web/abc',
      },
      error: null,
    })
    const client = { functions: { invoke } } as unknown as SupabaseClient

    const result = await createPayosPayment(client, 'ord-1')

    expect(invoke).toHaveBeenCalledWith('payos-create-payment', {
      body: { order_id: 'ord-1' },
    })
    expect(result.error).toBeNull()
    expect(result.qrCode).toBe('QR_PAYLOAD')
    expect(result.accountNumber).toBe('0123456789')
    expect(result.amount).toBe(480000)
    expect(result.description).toBe('ORD-2026-000042')
  })

  it('returns error when edge function fails', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('boom'),
    })
    const client = { functions: { invoke } } as unknown as SupabaseClient

    const result = await createPayosPayment(client, 'ord-1')
    expect(result.error).toBeInstanceOf(Error)
    expect(result.qrCode).toBeNull()
  })
})
