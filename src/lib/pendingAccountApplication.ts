import type { AccountTierCode } from './accountTiers'

export interface PendingAccountApplication {
  requested_tier_code: AccountTierCode
  motivation?: string
  experience?: string
  sample_url?: string
  metadata?: Record<string, unknown>
}

const KEY = 'pendingAccountApplication'

export function savePendingAccountApplication(payload: PendingAccountApplication): void {
  localStorage.setItem(KEY, JSON.stringify(payload))
}

export function getPendingAccountApplication(): PendingAccountApplication | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as PendingAccountApplication
  } catch {
    return null
  }
}

export function clearPendingAccountApplication(): void {
  localStorage.removeItem(KEY)
}
