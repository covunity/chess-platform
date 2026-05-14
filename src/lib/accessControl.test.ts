import { describe, it, expect } from 'vitest'
import { canAccessLesson } from './accessControl'

describe('canAccessLesson', () => {
  const freePrev = { free_preview: true }
  const paidLesson = { free_preview: false }

  it('returns "allow" for a free-preview lesson regardless of enrollment or role', () => {
    expect(canAccessLesson(null, false, freePrev, false)).toBe('allow')
    expect(canAccessLesson('learner', false, freePrev, false)).toBe('allow')
    expect(canAccessLesson('admin', false, freePrev, false)).toBe('allow')
  })

  it('returns "allow" for an enrolled user on any lesson', () => {
    expect(canAccessLesson('learner', true, paidLesson, false)).toBe('allow')
    expect(canAccessLesson(null, true, paidLesson, false)).toBe('allow')
  })

  it('returns "allow-admin" for an admin who is not enrolled on a paid lesson', () => {
    expect(canAccessLesson('admin', false, paidLesson, false)).toBe('allow-admin')
    expect(canAccessLesson('admin', false, paidLesson, true)).toBe('allow-admin')
  })

  it('returns "pending-paywall" for a non-enrolled, non-admin user with a pending order', () => {
    expect(canAccessLesson('learner', false, paidLesson, true)).toBe('pending-paywall')
    expect(canAccessLesson(null, false, paidLesson, true)).toBe('pending-paywall')
  })

  it('returns "paywall" for a non-enrolled, non-admin user with no pending order', () => {
    expect(canAccessLesson('learner', false, paidLesson, false)).toBe('paywall')
    expect(canAccessLesson(null, false, paidLesson, false)).toBe('paywall')
  })

  it('returns "allow-creator" for the course creator on a paid lesson regardless of enrollment', () => {
    expect(canAccessLesson('creator', false, paidLesson, false, true)).toBe('allow-creator')
    expect(canAccessLesson('creator', true, paidLesson, false, true)).toBe('allow-creator')
    expect(canAccessLesson('creator', false, paidLesson, true, true)).toBe('allow-creator')
  })

  it('returns "allow" (not "allow-creator") when free_preview is true even for the creator', () => {
    expect(canAccessLesson('creator', false, freePrev, false, true)).toBe('allow')
  })
})
