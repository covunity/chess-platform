import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Unread-orders dot indicator for the Learner's TopNav `/account/orders`
 * entry — PRD-0005 D12c.
 *
 * Because email notifications are deferred (D-14), this is the sole in-product
 * surface that tells a Learner their order has flipped to active / refunded /
 * expired since they last opened the page.
 *
 * Surface contract:
 *   - localStorage key `last_seen_orders_at` holds an ISO timestamp.
 *   - On every TopNav mount (while logged in) we run a single count query
 *     against `orders` filtered by an OR of `confirmed_at | refunded_at |
 *     expired_at > last_seen`. RLS scopes to the caller — no `user_id` filter
 *     needed in the query.
 *   - Opening `/account/orders` writes the current time to localStorage,
 *     clearing the dot on the next TopNav render.
 */

export const LAST_SEEN_ORDERS_KEY = 'last_seen_orders_at'

// Epoch-ish floor used when the user has never opened /account/orders.
// Any historical order with a confirmed/refunded/expired timestamp will
// satisfy "> EPOCH" and surface the dot.
const EPOCH = '1970-01-01T00:00:00Z'

export async function hasUnreadOrderUpdates(
  client: SupabaseClient,
  since: string | null
): Promise<{ hasUpdates: boolean; error: Error | null }> {
  const sinceIso = since ?? EPOCH
  const { count, error } = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .or(
      `confirmed_at.gt.${sinceIso},refunded_at.gt.${sinceIso},expired_at.gt.${sinceIso}`
    )

  return {
    hasUpdates: (count ?? 0) > 0,
    error: (error as Error | null) ?? null,
  }
}

export function readLastSeenOrdersAt(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_ORDERS_KEY)
  } catch {
    // Private browsing, disabled storage, or strict-mode iframes.
    // Treat as "never seen" — the dot may show until storage becomes
    // available, which is the safer default.
    return null
  }
}

export function writeLastSeenOrdersAt(now: Date = new Date()): void {
  try {
    window.localStorage.setItem(LAST_SEEN_ORDERS_KEY, now.toISOString())
  } catch {
    // Same rationale as above. Swallow — no UX-visible action available.
  }
}
