import { describe, it, expect, beforeEach } from 'vitest'
import {
  savePendingAccountApplication,
  getPendingAccountApplication,
  clearPendingAccountApplication,
} from './pendingAccountApplication'

describe('pendingAccountApplication', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is saved', () => {
    expect(getPendingAccountApplication()).toBeNull()
  })

  it('saves and retrieves a payload', () => {
    savePendingAccountApplication({
      requested_tier_code: 'individual',
      motivation: 'I love chess',
      experience: 'ELO 2000',
      sample_url: 'https://example.com',
    })
    const result = getPendingAccountApplication()
    expect(result).toEqual({
      requested_tier_code: 'individual',
      motivation: 'I love chess',
      experience: 'ELO 2000',
      sample_url: 'https://example.com',
    })
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
    expect(getPendingAccountApplication()).toEqual({ requested_tier_code: 'business' })
  })
})
