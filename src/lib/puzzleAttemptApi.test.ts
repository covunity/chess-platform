import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordPuzzleAttempt, getBestPuzzleAttempt } from './puzzleAttemptApi'

describe('recordPuzzleAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a row into puzzle_attempts with correct fields', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'pa1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    const client = { from } as never

    const result = await recordPuzzleAttempt(client, {
      lesson_id: 'lesson-1',
      wrong_attempts: 3,
      duration_seconds: 45,
    })

    expect(from).toHaveBeenCalledWith('puzzle_attempts')
    expect(insert).toHaveBeenCalledWith({
      lesson_id: 'lesson-1',
      wrong_attempts: 3,
      duration_seconds: 45,
      gave_up: false,
    })
    expect(result.error).toBeNull()
  })

  it('returns error when insert fails', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    const client = { from } as never

    const result = await recordPuzzleAttempt(client, {
      lesson_id: 'lesson-1',
      wrong_attempts: 0,
      duration_seconds: 10,
    })

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe('insert failed')
  })

  it('returns error when data is null', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    const client = { from } as never

    const result = await recordPuzzleAttempt(client, {
      lesson_id: 'lesson-1',
      wrong_attempts: 1,
      duration_seconds: 20,
    })

    expect(result.error).toBeInstanceOf(Error)
  })
})

describe('getBestPuzzleAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns best wrong_attempts when view has a row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { lesson_id: 'lesson-1', wrong_attempts: 2 },
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const client = { from } as never

    const result = await getBestPuzzleAttempt(client, 'lesson-1')

    expect(from).toHaveBeenCalledWith('puzzle_best_attempt')
    expect(eq).toHaveBeenCalledWith('lesson_id', 'lesson-1')
    expect(result).toEqual({ wrong_attempts: 2 })
  })

  it('returns null when no row exists yet (first-ever play)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const client = { from } as never

    const result = await getBestPuzzleAttempt(client, 'lesson-1')

    expect(result).toBeNull()
  })

  it('returns null when query errors (safe fallback)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'query error' } })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const client = { from } as never

    const result = await getBestPuzzleAttempt(client, 'lesson-1')

    expect(result).toBeNull()
  })
})
