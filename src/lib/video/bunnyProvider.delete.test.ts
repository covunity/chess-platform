import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockFrom = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}))

// Also need tus-js-client mock to allow bunnyProvider.ts to import cleanly
vi.mock('tus-js-client', () => ({
  Upload: vi.fn(),
}))

beforeEach(() => {
  mockInvoke.mockReset()
  mockFrom.mockReset()
})

// ── Import after mocks ────────────────────────────────────────────────────────
const { bunnyProvider } = await import('./bunnyProvider')

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bunnyProvider.delete()', () => {
  it('looks up lessonId by providerId from DB then calls delete-video edge function', async () => {
    // Arrange: DB returns a lesson row with the expected lessonId
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: 'lesson-id-42' },
      error: null,
    })
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    mockFrom.mockReturnValue(mockChain)
    mockInvoke.mockResolvedValue({ data: null, error: null })

    // Act
    await bunnyProvider.delete('provider-guid-abc')

    // Assert: DB was queried with provider and providerId
    expect(mockChain.eq).toHaveBeenCalledWith('video_provider', 'bunny')
    expect(mockChain.eq).toHaveBeenCalledWith('video_provider_id', 'provider-guid-abc')

    // Assert: edge function called with the lessonId retrieved from DB
    expect(mockInvoke).toHaveBeenCalledWith('delete-video', {
      body: { lessonId: 'lesson-id-42' },
    })
  })

  it('throws Vietnamese error when edge function fails', async () => {
    // Arrange: DB returns a lesson row successfully
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: 'lesson-id-42' },
      error: null,
    })
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    mockFrom.mockReturnValue(mockChain)

    // Edge function returns an error
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'some error', status: 500 } })

    // Act + Assert: should throw Vietnamese error
    await expect(bunnyProvider.delete('provider-guid-abc')).rejects.toThrow(
      'Xóa video thất bại. Vui lòng thử lại.',
    )
  })
})
