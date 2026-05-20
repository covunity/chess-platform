// Shared bank-account display helpers. Originally lived inline in
// `RevenuePanel`; lifted out for slice 5 of PRD-0005 (admin refund queue)
// so the AdminOrdersPage refund tab can render PayOS payer accounts with
// the same masking treatment.

// Mask all but the trailing 4 digits with bullets, matching Vietnamese
// banking-app conventions. Returns the input unchanged when shorter than 4.
export function maskAccount(accountNumber: string | null | undefined): string {
  if (!accountNumber) return '—'
  const s = String(accountNumber).trim()
  if (s.length === 0) return '—'
  if (s.length <= 4) return s
  return `••••${s.slice(-4)}`
}
