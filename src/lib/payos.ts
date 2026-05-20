import type { SupabaseClient } from '@supabase/supabase-js'

export interface PayosCheckoutData {
  qrCode: string | null
  accountNumber: string | null
  accountName: string | null
  bin: string | null
  amount: number | null
  description: string | null
  checkoutUrl: string | null
  error: Error | null
}

/**
 * Calls the `payos-create-payment` Edge Function to obtain the embedded PayOS
 * checkout data (QR string + bank info) for the given order.
 *
 * Returns a flat shape rather than nesting `data` so callers can destructure
 * directly; on error every field is `null` except `error`.
 */
export async function createPayosPayment(
  client: SupabaseClient,
  orderId: string
): Promise<PayosCheckoutData> {
  const { data, error } = await client.functions.invoke('payos-create-payment', {
    body: { order_id: orderId },
  })

  if (error || !data) {
    return {
      qrCode: null,
      accountNumber: null,
      accountName: null,
      bin: null,
      amount: null,
      description: null,
      checkoutUrl: null,
      error: (error as Error | null) ?? new Error('payos-create-payment returned no data'),
    }
  }

  return {
    qrCode: (data.qrCode as string | null) ?? null,
    accountNumber: (data.accountNumber as string | null) ?? null,
    accountName: (data.accountName as string | null) ?? null,
    bin: (data.bin as string | null) ?? null,
    amount: (data.amount as number | null) ?? null,
    description: (data.description as string | null) ?? null,
    checkoutUrl: (data.checkoutUrl as string | null) ?? null,
    error: null,
  }
}
