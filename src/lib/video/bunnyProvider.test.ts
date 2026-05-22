import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UploadCallbacks } from './types'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock the supabase module
const mockInvoke = vi.fn()
const mockFrom = vi.fn()
vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}))

// Mock tus-js-client.
// IMPORTANT: vitest 4.x requires mockImplementation to use regular functions
// (not arrow functions) when the mock will be called with `new`. Arrow functions
// cannot be constructors and Reflect.construct will throw if an arrow function is
// used as the target.
const mockTusStart = vi.fn()
const mockTusAbort = vi.fn()
const mockTusUpload = vi.fn()

vi.mock('tus-js-client', () => ({
  Upload: vi.fn().mockImplementation(function (file: unknown, opts: unknown) {
    mockTusUpload(file, opts)
    return {
      start: mockTusStart,
      abort: mockTusAbort,
    }
  }),
}))

// Helper to reset all mocks
beforeEach(async () => {
  mockInvoke.mockReset()
  mockFrom.mockReset()
  mockTusStart.mockReset()
  mockTusAbort.mockReset()
  mockTusAbort.mockResolvedValue(undefined)
  mockTusUpload.mockReset()

  // Re-apply Upload mock with a regular function so `new Upload(...)` works.
  const { Upload } = await import('tus-js-client')
  vi.mocked(Upload).mockImplementation(function (file: unknown, opts: unknown) {
    mockTusUpload(file, opts)
    return {
      start: mockTusStart,
      abort: mockTusAbort,
    }
  })
})

// ── Import after mocks ────────────────────────────────────────────────────────
const { bunnyProvider } = await import('./bunnyProvider')

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeFileWithSize(name: string, size: number): File {
  const f = new File(['x'], name, { type: 'video/mp4' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const CREATE_VIDEO_SUCCESS = {
  uploadEndpoint: 'https://video.bunnycdn.com/tusupload',
  videoGuid: 'guid-abc123',
  libraryId: 42,
  authorizationSignature: 'sig-hex',
  authorizationExpire: 1700003600,
}

function makeCallbacks(): UploadCallbacks {
  return {
    onProgress: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bunnyProvider.upload()', () => {
  // Test 1: calls create-video with correct body
  it('calls create-video edge function with { lessonId, filename, sizeBytes }', async () => {
    mockInvoke.mockResolvedValue({ data: CREATE_VIDEO_SUCCESS, error: null })
    mockTusStart.mockImplementation(() => {})

    const file = makeFileWithSize('my-video.mp4', 5_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    expect(mockInvoke).toHaveBeenCalledWith('create-video', {
      body: {
        lessonId: 'lesson-id-1',
        filename: 'my-video.mp4',
        sizeBytes: 5_000_000,
      },
    })
  })

  // Test 2: starts TUS to uploadEndpoint with correct auth headers
  it('starts TUS to uploadEndpoint with correct auth headers', async () => {
    mockInvoke.mockResolvedValue({ data: CREATE_VIDEO_SUCCESS, error: null })
    mockTusStart.mockImplementation(() => {})

    const { Upload } = await import('tus-js-client')

    const file = makeFileWithSize('my-video.mp4', 5_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    expect(Upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        endpoint: 'https://video.bunnycdn.com/tusupload',
        headers: expect.objectContaining({
          AuthorizationSignature: 'sig-hex',
          AuthorizationExpire: '1700003600',
          VideoId: 'guid-abc123',
          LibraryId: '42',
        }),
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: expect.objectContaining({
          filetype: 'video/mp4',
          title: 'my-video.mp4',
        }),
      }),
    )

    expect(mockTusStart).toHaveBeenCalled()
  })

  // Test 3: propagates progress via onProgress
  it('propagates progress via onProgress({ pct, bytesPerSec })', async () => {
    mockInvoke.mockResolvedValue({ data: CREATE_VIDEO_SUCCESS, error: null })

    let capturedOnProgress: ((sent: number, total: number) => void) | null = null

    const { Upload } = await import('tus-js-client')
    // Use regular function here too for vitest 4.x compatibility with `new`
    vi.mocked(Upload).mockImplementationOnce(function (_file, opts) {
      capturedOnProgress = (opts as { onProgress?: (s: number, t: number) => void }).onProgress ?? null
      return { start: mockTusStart, abort: mockTusAbort }
    })

    const file = makeFileWithSize('my-video.mp4', 10_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    // Simulate progress: 5 MB of 10 MB sent
    capturedOnProgress?.(5_000_000, 10_000_000)

    expect(cb.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        pct: 50,
        bytesPerSec: expect.any(Number),
      }),
    )
  })

  // Test 4: calls onSuccess with { providerId, needsProcessing: true }
  it('calls onSuccess({ providerId: videoGuid, needsProcessing: true }) on TUS success', async () => {
    mockInvoke.mockResolvedValue({ data: CREATE_VIDEO_SUCCESS, error: null })

    let capturedOnSuccess: (() => void) | null = null

    const { Upload } = await import('tus-js-client')
    // Use regular function for vitest 4.x `new` compatibility
    vi.mocked(Upload).mockImplementationOnce(function (_file, opts) {
      capturedOnSuccess = (opts as { onSuccess?: () => void }).onSuccess ?? null
      return { start: mockTusStart, abort: mockTusAbort }
    })

    const file = makeFileWithSize('my-video.mp4', 5_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    capturedOnSuccess?.()

    expect(cb.onSuccess).toHaveBeenCalledWith({
      providerId: 'guid-abc123',
      needsProcessing: true,
    })
  })

  // Test 5: calls onError with Vietnamese "quyền" message on 403/forbidden
  it('calls onError with Vietnamese "quyền" message on 403/forbidden from edge function', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'not_authorized', status: 403 },
    })

    const file = makeFileWithSize('my-video.mp4', 5_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    expect(cb.onError).toHaveBeenCalledOnce()
    const err = cb.onError.mock.calls[0][0] as Error
    expect(err.message).toMatch(/quyền/i)
  })

  // Test 6: calls onError with Vietnamese "giới hạn" message on file_too_large
  it('calls onError with Vietnamese "giới hạn" message on file_too_large', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'file_too_large', status: 413 },
    })

    const file = makeFileWithSize('big-video.mp4', 2_000_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    expect(cb.onError).toHaveBeenCalledOnce()
    const err = cb.onError.mock.calls[0][0] as Error
    expect(err.message).toMatch(/giới hạn/i)
  })

  // Test 7: calls onError with generic message on unexpected failure
  it('calls onError with generic message on unexpected failure', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'some_random_error' },
    })

    const file = makeFileWithSize('my-video.mp4', 5_000_000)
    const cb = makeCallbacks()

    await bunnyProvider.upload(file, 'lesson-id-1', cb)

    expect(cb.onError).toHaveBeenCalledOnce()
    const err = cb.onError.mock.calls[0][0] as Error
    // Should be a generic Vietnamese message, not expose internal error
    expect(err.message).toBeTruthy()
    expect(err.message).not.toMatch(/some_random_error/)
  })

  // Test 8: returns abort handle that calls tus.Upload.abort()
  it('returns abort handle that calls tus.Upload.abort()', async () => {
    mockInvoke.mockResolvedValue({ data: CREATE_VIDEO_SUCCESS, error: null })
    mockTusStart.mockImplementation(() => {})

    const file = makeFileWithSize('my-video.mp4', 5_000_000)
    const cb = makeCallbacks()

    const handle = await bunnyProvider.upload(file, 'lesson-id-1', cb)

    handle.abort()

    expect(mockTusAbort).toHaveBeenCalled()
  })
})

describe('bunnyProvider.pollStatus()', () => {
  // Test 9: returns 'ready' when DB has video_status='ready'
  it("returns 'ready' when DB has video_status='ready'", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { video_status: 'ready' },
      error: null,
    })
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await bunnyProvider.pollStatus('guid-abc')

    expect(result).toBe('ready')
    expect(mockChain.eq).toHaveBeenCalledWith('video_provider', 'bunny')
    expect(mockChain.eq).toHaveBeenCalledWith('video_provider_id', 'guid-abc')
  })

  // Test 10: returns 'processing' when DB has video_status='processing' or 'uploading'
  it("returns 'processing' when DB has video_status='processing'", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { video_status: 'processing' },
      error: null,
    })
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await bunnyProvider.pollStatus('guid-abc')
    expect(result).toBe('processing')
  })

  it("returns 'processing' when DB has video_status='uploading'", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { video_status: 'uploading' },
      error: null,
    })
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await bunnyProvider.pollStatus('guid-abc')
    expect(result).toBe('processing')
  })

  // Test 11: returns 'error' when DB has video_status='error'
  it("returns 'error' when DB has video_status='error'", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { video_status: 'error' },
      error: null,
    })
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await bunnyProvider.pollStatus('guid-abc')
    expect(result).toBe('error')
  })
})
