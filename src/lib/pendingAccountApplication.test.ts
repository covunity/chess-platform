import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  savePendingAccountApplication,
  getPendingAccountApplication,
  clearPendingAccountApplication,
  getPendingApplicationFromUserMetadata,
  clearPendingApplicationFromMetadata,
} from './pendingAccountApplication'

describe('pendingAccountApplication', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('returns null when nothing is saved', () => {
    expect(getPendingAccountApplication()).toBeNull()
  })

  it('saves and retrieves a payload with expiry', () => {
    savePendingAccountApplication({
      requested_tier_code: 'individual',
      motivation: 'I love chess',
      experience: 'ELO 2000',
      sample_url: 'https://example.com',
    })
    const result = getPendingAccountApplication()
    expect(result).toMatchObject({
      requested_tier_code: 'individual',
      motivation: 'I love chess',
      experience: 'ELO 2000',
      sample_url: 'https://example.com',
    })
    expect(result?.expires_at).toBeGreaterThan(Date.now())
  })

  it('stores with key pendingAccountApplication', () => {
    savePendingAccountApplication({ requested_tier_code: 'individual' })
    expect(localStorage.getItem('pendingAccountApplication')).not.toBeNull()
  })

  it('clears the saved payload', () => {
    savePendingAccountApplication({ requested_tier_code: 'individual' })
    clearPendingAccountApplication()
    expect(getPendingAccountApplication()).toBeNull()
    expect(localStorage.getItem('pendingAccountApplication')).toBeNull()
  })

  it('returns null when stored value is invalid JSON', () => {
    localStorage.setItem('pendingAccountApplication', 'not-json')
    expect(getPendingAccountApplication()).toBeNull()
  })

  it('saves partial payload (only required field)', () => {
    savePendingAccountApplication({ requested_tier_code: 'business' })
    const result = getPendingAccountApplication()
    expect(result?.requested_tier_code).toBe('business')
  })

  it('returns null and clears entry when payload is expired', () => {
    vi.useFakeTimers()
    savePendingAccountApplication({ requested_tier_code: 'individual' })
    vi.advanceTimersByTime(25 * 60 * 60 * 1000) // 25h > 24h expiry
    expect(getPendingAccountApplication()).toBeNull()
    expect(localStorage.getItem('pendingAccountApplication')).toBeNull()
  })

  it('returns payload within the 24h window', () => {
    vi.useFakeTimers()
    savePendingAccountApplication({ requested_tier_code: 'individual' })
    vi.advanceTimersByTime(23 * 60 * 60 * 1000) // 23h < 24h
    expect(getPendingAccountApplication()).not.toBeNull()
  })
})

describe('getPendingApplicationFromUserMetadata', () => {
  it('returns null for null/undefined metadata', () => {
    expect(getPendingApplicationFromUserMetadata(null)).toBeNull()
    expect(getPendingApplicationFromUserMetadata(undefined)).toBeNull()
  })

  it('returns null when pending_application is absent', () => {
    expect(getPendingApplicationFromUserMetadata({ name: 'Alice' })).toBeNull()
  })

  it('returns null when pending_application has no requested_tier_code', () => {
    expect(getPendingApplicationFromUserMetadata({ pending_application: { motivation: 'hi' } })).toBeNull()
  })

  it('returns the application when valid', () => {
    const result = getPendingApplicationFromUserMetadata({
      pending_application: {
        requested_tier_code: 'business',
        motivation: 'grow',
        expires_at: Date.now() + 10_000,
      },
    })
    expect(result).toMatchObject({ requested_tier_code: 'business', motivation: 'grow' })
  })

  it('returns null when metadata application is expired', () => {
    const result = getPendingApplicationFromUserMetadata({
      pending_application: {
        requested_tier_code: 'individual',
        expires_at: Date.now() - 1,
      },
    })
    expect(result).toBeNull()
  })

  it('returns the application when expires_at is absent (no expiry set)', () => {
    const result = getPendingApplicationFromUserMetadata({
      pending_application: { requested_tier_code: 'athlete' },
    })
    expect(result?.requested_tier_code).toBe('athlete')
  })
})

describe('clearPendingApplicationFromMetadata', () => {
  it('calls supabase.auth.updateUser with pending_application null', async () => {
    const updateUser = vi.fn().mockResolvedValue({})
    const client = { auth: { updateUser } } as unknown as Parameters<typeof clearPendingApplicationFromMetadata>[0]
    await clearPendingApplicationFromMetadata(client)
    expect(updateUser).toHaveBeenCalledWith({ data: { pending_application: null } })
  })

  it('does not throw when updateUser rejects', async () => {
    const updateUser = vi.fn().mockRejectedValue(new Error('network'))
    const client = { auth: { updateUser } } as unknown as Parameters<typeof clearPendingApplicationFromMetadata>[0]
    await expect(clearPendingApplicationFromMetadata(client)).resolves.toBeUndefined()
  })
})
