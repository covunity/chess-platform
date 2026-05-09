import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTierCode } from './accountTiers'

const EXPIRY_MS = 24 * 60 * 60 * 1000 // 24h

export interface PendingAccountApplication {
  requested_tier_code: AccountTierCode
  motivation?: string
  experience?: string
  sample_url?: string
  metadata?: Record<string, unknown>
  expires_at?: number
}

const KEY = 'pendingAccountApplication'

export function savePendingAccountApplication(payload: PendingAccountApplication): void {
  const withExpiry: PendingAccountApplication = {
    ...payload,
    expires_at: Date.now() + EXPIRY_MS,
  }
  localStorage.setItem(KEY, JSON.stringify(withExpiry))
}

export function getPendingAccountApplication(): PendingAccountApplication | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingAccountApplication
    if (parsed.expires_at && Date.now() > parsed.expires_at) {
      clearPendingAccountApplication()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearPendingAccountApplication(): void {
  localStorage.removeItem(KEY)
}

export function getPendingApplicationFromUserMetadata(
  userMetadata: Record<string, unknown> | undefined | null
): PendingAccountApplication | null {
  if (!userMetadata?.pending_application) return null
  try {
    const p = userMetadata.pending_application as PendingAccountApplication
    if (!p.requested_tier_code) return null
    if (p.expires_at && Date.now() > p.expires_at) return null
    return p
  } catch {
    return null
  }
}

export async function clearPendingApplicationFromMetadata(client: SupabaseClient): Promise<void> {
  try {
    await client.auth.updateUser({ data: { pending_application: null } })
  } catch {
    // best-effort
  }
}
