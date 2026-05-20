import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  hasUnreadOrderUpdates,
  readLastSeenOrdersAt,
  writeLastSeenOrdersAt,
  LAST_SEEN_ORDERS_KEY,
} from './orderUpdatesApi'

// ── hasUnreadOrderUpdates ──────────────────────────────────────────────────
//
// Runs a count-only query against orders filtered by an OR of three timestamp
// columns (confirmed_at, refunded_at, expired_at) > since. RLS scopes to the
// caller so the helper does not need to filter by user_id itself.

describe('hasUnreadOrderUpdates', () => {
  function makeChain(count: number | null, error: unknown = null) {
    return {
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ count, error, data: null }),
    }
  }

  it('returns hasUpdates=true when count > 0', async () => {
    const chain = makeChain(2)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { hasUpdates, error } = await hasUnreadOrderUpdates(client, '2026-05-01T00:00:00Z')
    expect(error).toBeNull()
    expect(hasUpdates).toBe(true)
    expect(client.from).toHaveBeenCalledWith('orders')
    expect(chain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
  })

  it('returns hasUpdates=false when count is 0', async () => {
    const chain = makeChain(0)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { hasUpdates, error } = await hasUnreadOrderUpdates(client, '2026-05-01T00:00:00Z')
    expect(error).toBeNull()
    expect(hasUpdates).toBe(false)
  })

  it('builds an OR filter across confirmed_at, refunded_at, expired_at against since', async () => {
    const chain = makeChain(1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await hasUnreadOrderUpdates(client, '2026-05-01T00:00:00Z')
    expect(chain.or).toHaveBeenCalledTimes(1)
    const filter = (chain.or.mock.calls[0][0] as string)
    expect(filter).toContain('confirmed_at.gt.2026-05-01T00:00:00Z')
    expect(filter).toContain('refunded_at.gt.2026-05-01T00:00:00Z')
    expect(filter).toContain('expired_at.gt.2026-05-01T00:00:00Z')
  })

  it('uses 1970 epoch when since is null (default for new users)', async () => {
    const chain = makeChain(1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await hasUnreadOrderUpdates(client, null)
    const filter = (chain.or.mock.calls[0][0] as string)
    expect(filter).toContain('confirmed_at.gt.1970-01-01T00:00:00Z')
  })

  it('returns hasUpdates=false and forwards error from supabase', async () => {
    const chain = makeChain(null, { message: 'forbidden' })
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { hasUpdates, error } = await hasUnreadOrderUpdates(client, null)
    expect(hasUpdates).toBe(false)
    expect((error as { message?: string }).message).toBe('forbidden')
  })
})

// ── localStorage helpers ───────────────────────────────────────────────────

describe('readLastSeenOrdersAt / writeLastSeenOrdersAt', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when the key has never been set', () => {
    expect(readLastSeenOrdersAt()).toBeNull()
  })

  it('writeLastSeenOrdersAt stores an ISO string under the well-known key', () => {
    const now = new Date('2026-05-20T10:00:00Z')
    writeLastSeenOrdersAt(now)
    expect(localStorage.getItem(LAST_SEEN_ORDERS_KEY)).toBe('2026-05-20T10:00:00.000Z')
  })

  it('readLastSeenOrdersAt round-trips the written value', () => {
    const now = new Date('2026-05-20T10:00:00Z')
    writeLastSeenOrdersAt(now)
    expect(readLastSeenOrdersAt()).toBe('2026-05-20T10:00:00.000Z')
  })

  it('exposes the storage key as "last_seen_orders_at" (PRD-0005 D12c contract)', () => {
    expect(LAST_SEEN_ORDERS_KEY).toBe('last_seen_orders_at')
  })

  describe('when localStorage is unavailable (private browsing / disabled)', () => {
    let originalLocalStorage: Storage
    beforeEach(() => {
      originalLocalStorage = window.localStorage
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('localStorage disabled')
        },
      })
    })
    afterEach(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      })
    })

    it('readLastSeenOrdersAt returns null without throwing', () => {
      expect(() => readLastSeenOrdersAt()).not.toThrow()
      expect(readLastSeenOrdersAt()).toBeNull()
    })

    it('writeLastSeenOrdersAt does not throw', () => {
      expect(() => writeLastSeenOrdersAt(new Date())).not.toThrow()
    })
  })
})
