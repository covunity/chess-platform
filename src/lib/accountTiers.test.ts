import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeFeeFloor, clearAccountTiersCache } from './accountTiers'

// ── computeFeeFloor ───────────────────────────────────────────────────────────

describe('computeFeeFloor', () => {
  it('computes floor(price * pct / 100)', () => {
    expect(computeFeeFloor(100000, 20)).toBe(20000)
  })

  it('floors fractional results', () => {
    expect(computeFeeFloor(99999, 20)).toBe(19999)
    expect(computeFeeFloor(1, 20)).toBe(0)
    expect(computeFeeFloor(5, 20)).toBe(1)
  })

  it('returns 0 for price 0', () => {
    expect(computeFeeFloor(0, 20)).toBe(0)
  })

  it('handles 10% fee', () => {
    expect(computeFeeFloor(480000, 10)).toBe(48000)
  })

  it('handles 15% fee', () => {
    expect(computeFeeFloor(200000, 15)).toBe(30000)
  })

  it('returns 0 for pct 0', () => {
    expect(computeFeeFloor(100000, 0)).toBe(0)
  })
})

// ── fetchAccountTiers ─────────────────────────────────────────────────────────

describe('fetchAccountTiers', () => {
  beforeEach(() => {
    clearAccountTiersCache()
  })

  it('fetches tiers from supabase and returns them', async () => {
    const mockTiers = [
      { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: true, display_order: 1 },
      { code: 'business', name_vi: 'Doanh nghiệp', platform_fee_pct: 15, max_chapters_per_course: 30, is_enterprise: true, requires_approval: true, display_order: 2 },
    ]

    const chain: Record<string, unknown> = {}
    const methods = ['select', 'order']
    methods.forEach(m => { chain[m] = vi.fn(() => chain) })
    ;(chain as { then: (r: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) =>
      Promise.resolve(resolve({ data: mockTiers, error: null }))

    const mockClient = { from: vi.fn(() => chain) }

    const { fetchAccountTiers } = await import('./accountTiers')
    const result = await fetchAccountTiers(mockClient as never)

    expect(result).toEqual(mockTiers)
    expect(mockClient.from).toHaveBeenCalledWith('account_tiers')
  })

  it('caches result so network is called only once per session', async () => {
    clearAccountTiersCache()

    const mockTiers = [
      { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: true, display_order: 1 },
    ]

    let callCount = 0
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'order']
    methods.forEach(m => { chain[m] = vi.fn(() => chain) })
    ;(chain as { then: (r: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) => {
      callCount++
      return Promise.resolve(resolve({ data: mockTiers, error: null }))
    }

    const mockClient = { from: vi.fn(() => chain) }

    const { fetchAccountTiers } = await import('./accountTiers')
    await fetchAccountTiers(mockClient as never)
    await fetchAccountTiers(mockClient as never)

    expect(callCount).toBe(1)
  })

  it('throws when supabase returns an error', async () => {
    clearAccountTiersCache()

    const chain: Record<string, unknown> = {}
    const methods = ['select', 'order']
    methods.forEach(m => { chain[m] = vi.fn(() => chain) })
    ;(chain as { then: (r: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) =>
      Promise.resolve(resolve({ data: null, error: new Error('db error') }))

    const mockClient = { from: vi.fn(() => chain) }

    const { fetchAccountTiers } = await import('./accountTiers')
    await expect(fetchAccountTiers(mockClient as never)).rejects.toThrow('db error')
  })
})
