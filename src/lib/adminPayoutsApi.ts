import type { SupabaseClient } from '@supabase/supabase-js'

export interface PendingPayout {
  id: string
  creatorId: string
  creatorName: string | null
  creatorEmail: string
  adminId: string
  amount: number
  bankCode: string
  bankName: string
  accountNumber: string
  accountHolder: string
  orderIds: string[]
  orderCount: number
  transferredAt: string
  referenceNote: string | null
}

interface PayoutRow {
  id: string
  creator_id: string
  admin_id: string
  amount: number
  bank_code: string
  bank_name: string
  account_number: string
  account_holder: string
  order_ids: string[]
  transferred_at: string
  reference_note: string | null
  creator: { id: string; name: string | null; email: string } | null
}

function mapRow(r: PayoutRow): PendingPayout {
  return {
    id: r.id,
    creatorId: r.creator_id,
    creatorName: r.creator?.name ?? null,
    creatorEmail: r.creator?.email ?? '',
    adminId: r.admin_id,
    amount: r.amount,
    bankCode: r.bank_code,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    accountHolder: r.account_holder,
    orderIds: r.order_ids ?? [],
    orderCount: (r.order_ids ?? []).length,
    transferredAt: r.transferred_at,
    referenceNote: r.reference_note,
  }
}

const CSV_HEADERS = [
  'STT',
  'Người nhận',
  'Ngân hàng',
  'Số tài khoản',
  'Số tiền (VND)',
  'Nội dung CK',
  'Email creator',
  'Số đơn',
  'Payout ID',
] as const

function csvEscape(value: string | number): string {
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function memoFor(creatorDisplay: string, when: Date): string {
  const mm = pad2(when.getUTCMonth() + 1)
  const yyyy = when.getUTCFullYear()
  return `Covunity payout T${mm}-${yyyy} ${creatorDisplay}`
}

/**
 * Builds the admin payouts reference CSV per PRD-0005 §4 US3.2.
 * Returned string is prefixed with a UTF-8 BOM so Excel honours diacritics.
 * @param at Reference date used to format the memo (defaults to now).
 */
export function buildPayoutsCsv(payouts: PendingPayout[], at: Date = new Date()): string {
  const lines: string[] = [CSV_HEADERS.join(',')]
  payouts.forEach((p, idx) => {
    const display = p.creatorName ?? p.creatorEmail
    const memo = memoFor(display, at)
    const row = [
      String(idx + 1),
      csvEscape(display),
      csvEscape(p.bankName),
      csvEscape(p.accountNumber),
      String(p.amount),
      csvEscape(memo),
      csvEscape(p.creatorEmail),
      String(p.orderCount),
      p.id,
    ]
    lines.push(row.join(','))
  })
  return '\uFEFF' + lines.join('\n')
}

/**
 * Computes the ISO-8601 week-numbering year + week number for a given date.
 * Used to name the CSV download (e.g. gambitly-payouts-2026-W21.csv).
 * Returns { year, week } where year is the ISO week-year (may differ from UTC year).
 */
export function isoWeek(date: Date): { year: number; week: number } {
  // Copy date so don't modify original
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // Make Sunday's day number 7 (ISO: Mon=1..Sun=7)
  const dayNum = d.getUTCDay() || 7
  // Set to nearest Thursday: current date + 4 - current day number
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  // Year of that Thursday is the ISO week-year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

export interface CreatorMissingPayoutInfo {
  creatorId: string
  name: string | null
  email: string
  pendingBalance: number
}

export async function fetchCreatorsWithoutPayoutInfo(
  client: SupabaseClient
): Promise<{ creators: CreatorMissingPayoutInfo[]; error: Error | null }> {
  const { data, error } = await client.rpc('list_creators_missing_payout_info')
  if (error) {
    return { creators: [], error: error as Error }
  }
  const rows = (data ?? []) as Array<{
    creator_id: string
    name: string | null
    email: string
    pending_balance: number
  }>
  return {
    creators: rows.map((r) => ({
      creatorId: r.creator_id,
      name: r.name,
      email: r.email,
      pendingBalance: Number(r.pending_balance) || 0,
    })),
    error: null,
  }
}

export async function fetchPendingPayouts(
  client: SupabaseClient
): Promise<{ payouts: PendingPayout[]; error: Error | null }> {
  const { data, error } = await client
    .from('payouts')
    .select(
      'id, creator_id, admin_id, amount, bank_code, bank_name, account_number, account_holder, order_ids, transferred_at, reference_note, creator:creator_id(id, name, email)'
    )
    .is('reference_note', null)
    .order('transferred_at', { ascending: false })

  if (error) {
    return { payouts: [], error: error as Error }
  }

  const rows = (data ?? []) as unknown as PayoutRow[]
  return { payouts: rows.map(mapRow), error: null }
}

/**
 * Generates pending payouts for the current ISO week. Idempotent: if a pending
 * payout (reference_note IS NULL) already exists for a creator in the current
 * Mon-Sun window, it is returned instead of duplicated. See migration 052.
 */
export async function createWeeklyPayouts(
  client: SupabaseClient
): Promise<{ payouts: PendingPayout[]; error: Error | null }> {
  const { data, error } = await client.rpc('create_weekly_payouts')
  if (error) {
    return { payouts: [], error: error as Error }
  }
  const rows = (data ?? []) as unknown as Array<Omit<PayoutRow, 'creator'>>
  return {
    payouts: rows.map((r) => mapRow({ ...r, creator: null })),
    error: null,
  }
}

/**
 * Marks a payout as transferred. Atomically sets reference_note + flips every
 * order in order_ids to paid_out_in = payout_id. Idempotent at the RPC layer:
 * a second call on the same row raises.
 */
export async function markPayoutComplete(
  client: SupabaseClient,
  payoutId: string,
  referenceNote: string
): Promise<{ payout: PendingPayout | null; error: Error | null }> {
  const { data, error } = await client.rpc('mark_payout_complete', {
    p_payout_id: payoutId,
    p_reference_note: referenceNote,
  })
  if (error || !data) {
    return { payout: null, error: (error ?? new Error('no payout returned')) as Error }
  }
  const row = data as unknown as Omit<PayoutRow, 'creator'>
  return { payout: mapRow({ ...row, creator: null }), error: null }
}
