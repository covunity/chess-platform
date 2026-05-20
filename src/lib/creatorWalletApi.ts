import type { SupabaseClient } from '@supabase/supabase-js'

export interface CreatorWallet {
  pendingBalance: number
  totalPaidOut: number
  lifetimeEarnings: number
}

export interface RecentEarning {
  orderId: string
  amount: number
  creatorPayout: number
  courseTitle: string
  buyerEmail: string
  confirmedAt: string
}

export interface PayoutHistoryEntry {
  id: string
  amount: number
  bankName: string
  accountNumber: string
  accountHolder: string
  transferredAt: string
  referenceNote: string | null
}

const EMPTY_WALLET: CreatorWallet = {
  pendingBalance: 0,
  totalPaidOut: 0,
  lifetimeEarnings: 0,
}

export async function fetchCreatorWallet(
  client: SupabaseClient,
  creatorId: string
): Promise<{ wallet: CreatorWallet; error: Error | null }> {
  const { data, error } = await client
    .from('creator_wallet')
    .select('pending_balance, total_paid_out, lifetime_earnings')
    .eq('creator_id', creatorId)
    .maybeSingle()

  if (error) {
    return { wallet: EMPTY_WALLET, error: error as Error }
  }

  if (!data) {
    return { wallet: EMPTY_WALLET, error: null }
  }

  return {
    wallet: {
      pendingBalance: Number(data.pending_balance) || 0,
      totalPaidOut: Number(data.total_paid_out) || 0,
      lifetimeEarnings: Number(data.lifetime_earnings) || 0,
    },
    error: null,
  }
}

export async function fetchRecentEarnings(
  client: SupabaseClient,
  creatorId: string,
  limit: number
): Promise<{ earnings: RecentEarning[]; error: Error | null }> {
  const { data: courses, error: coursesError } = await client
    .from('courses')
    .select('id')
    .eq('creator_id', creatorId)

  if (coursesError) {
    return { earnings: [], error: coursesError as Error }
  }

  const courseIds = (courses ?? []).map((c: { id: string }) => c.id)
  if (courseIds.length === 0) {
    return { earnings: [], error: null }
  }

  const { data, error } = await client
    .from('orders')
    .select(
      'id, amount, creator_payout, confirmed_at, course:course_id(id, title), buyer:user_id(id, email)'
    )
    .eq('status', 'active')
    .is('paid_out_in', null)
    .in('course_id', courseIds)
    .order('confirmed_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { earnings: [], error: error as Error }
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    amount: number
    creator_payout: number
    confirmed_at: string
    course: { id: string; title: string } | null
    buyer: { id: string; email: string } | null
  }>

  return {
    earnings: rows.map((r) => ({
      orderId: r.id,
      amount: r.amount,
      creatorPayout: r.creator_payout,
      courseTitle: r.course?.title ?? '',
      buyerEmail: r.buyer?.email ?? '',
      confirmedAt: r.confirmed_at,
    })),
    error: null,
  }
}

export async function fetchPayoutHistory(
  client: SupabaseClient,
  creatorId: string
): Promise<{ payouts: PayoutHistoryEntry[]; error: Error | null }> {
  const { data, error } = await client
    .from('payouts')
    .select('id, amount, bank_code, bank_name, account_number, account_holder, transferred_at, reference_note')
    .eq('creator_id', creatorId)
    .order('transferred_at', { ascending: false })

  if (error) {
    return { payouts: [], error: error as Error }
  }

  const rows = (data ?? []) as Array<{
    id: string
    amount: number
    bank_code: string
    bank_name: string
    account_number: string
    account_holder: string
    transferred_at: string
    reference_note: string | null
  }>

  return {
    payouts: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      bankName: r.bank_name,
      accountNumber: r.account_number,
      accountHolder: r.account_holder,
      transferredAt: r.transferred_at,
      referenceNote: r.reference_note,
    })),
    error: null,
  }
}
