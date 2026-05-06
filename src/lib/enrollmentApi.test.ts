import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enrollForFree, getFirstLesson, getLastViewedLesson } from './enrollmentApi'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockHead = vi.fn()

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    from: vi.fn().mockReturnValue({
      select: mockSelect.mockReturnThis(),
      insert: mockInsert.mockReturnThis(),
      eq: mockEq.mockReturnThis(),
      single: mockSingle,
      ...overrides,
    }),
    ...overrides,
  }
}

describe('enrollForFree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when course is not free (price > 0)', async () => {
    const client = makeMockClient()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockSingle.mockResolvedValue({
      data: { id: 'c1', price: 50000, status: 'published' },
      error: null,
    })

    const result = await enrollForFree(client as never, 'c1', 'u1')
    expect(result.error?.message).toMatch(/không miễn phí|not free/i)
    expect(result.enrollmentId).toBeNull()
  })

  it('returns error when course does not exist', async () => {
    const client = makeMockClient()
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const result = await enrollForFree(client as never, 'missing-course', 'u1')
    expect(result.error).not.toBeNull()
    expect(result.enrollmentId).toBeNull()
  })

  it('creates order with status active and amount 0 for free course', async () => {
    const mockFrom = vi.fn()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'courses') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'c1', price: 0, status: 'published' },
            error: null,
          }),
        }
      }
      if (table === 'orders') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'o1', status: 'active', amount: 0 },
            error: null,
          }),
        }
      }
      if (table === 'enrollments') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'e1' },
            error: null,
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn() }
    })

    const client = { from: mockFrom }
    const result = await enrollForFree(client as never, 'c1', 'u1')

    expect(result.error).toBeNull()
    expect(result.enrollmentId).toBe('e1')
    expect(result.orderId).toBe('o1')
  })

  it('returns error when already enrolled', async () => {
    const mockFrom = vi.fn()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'courses') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'c1', price: 0, status: 'published' },
            error: null,
          }),
        }
      }
      if (table === 'enrollments') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key' },
          }),
        }
      }
      if (table === 'orders') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'o1', status: 'active', amount: 0 },
            error: null,
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn() }
    })

    const client = { from: mockFrom }
    const result = await enrollForFree(client as never, 'c1', 'u1')
    expect(result.error?.message).toMatch(/đã đăng ký|already enrolled/i)
  })
})

describe('getFirstLesson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the first lesson of the first chapter', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'l1' }],
        error: null,
      }),
    })

    const client = { from: mockFrom }
    const result = await getFirstLesson(client as never, 'c1')
    expect(result.lessonId).toBe('l1')
    expect(result.error).toBeNull()
  })

  it('returns error when no lessons found', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    })

    const client = { from: mockFrom }
    const result = await getFirstLesson(client as never, 'c1')
    expect(result.lessonId).toBeNull()
    expect(result.error).not.toBeNull()
  })
})

describe('getLastViewedLesson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns last viewed lesson for a user', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ lesson_id: 'l3', viewed_at: '2026-01-10T00:00:00Z' }],
        error: null,
      }),
    })

    const client = { from: mockFrom }
    const result = await getLastViewedLesson(client as never, 'c1', 'u1')
    expect(result.lessonId).toBe('l3')
    expect(result.error).toBeNull()
  })

  it('returns null lessonId when no history', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    })

    const client = { from: mockFrom }
    const result = await getLastViewedLesson(client as never, 'c1', 'u1')
    expect(result.lessonId).toBeNull()
    expect(result.error).toBeNull()
  })
})
