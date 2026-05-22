/**
 * VideoLessonEditor tests — UX improvements
 *
 * Tests for:
 * 1. Upload success toast (shows after upload, auto-hides after 3s)
 * 2. beforeunload guard (registered when uploading, unregistered when done)
 * 3. onIsUploadingChange callback (true on start, false on complete/error/cancel)
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSetLessonVideo = vi.fn()
const mockSetLessonVideoStatus = vi.fn()
const mockClearLessonVideo = vi.fn()
const mockValidateVideoFile = vi.fn()
const mockGetDefaultProvider = vi.fn()
const mockGetProvider = vi.fn()

vi.mock('../../../lib/creatorApi', () => ({
  setLessonVideo: (...args: unknown[]) => mockSetLessonVideo(...args),
  setLessonVideoStatus: (...args: unknown[]) => mockSetLessonVideoStatus(...args),
  clearLessonVideo: (...args: unknown[]) => mockClearLessonVideo(...args),
}))

vi.mock('../../../lib/video', () => ({
  getDefaultProvider: () => mockGetDefaultProvider(),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  validateVideoFile: (...args: unknown[]) => mockValidateVideoFile(...args),
  VIDEO_LIMITS: {
    maxBytes: 50 * 1024 * 1024,
    maxBytesLabel: '50 MB',
    allowedMime: ['video/mp4'],
    allowedExtensionsLabel: 'MP4',
  },
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {},
}))

import VideoLessonEditor from '../VideoLessonEditor'
import type { VideoLessonEditorLesson } from '../VideoLessonEditor'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_LESSON: VideoLessonEditorLesson = {
  id: 'lesson-1',
  is_free_preview: false,
  video_status: 'idle',
  video_provider: null,
  video_provider_id: null,
  video_filename: null,
  video_size_bytes: null,
  duration_seconds: 0,
}

const READY_LESSON: VideoLessonEditorLesson = {
  ...BASE_LESSON,
  video_status: 'ready',
  video_provider: 'bunny',
  video_provider_id: 'vid-123',
  video_filename: 'lecture.mp4',
  video_size_bytes: 10 * 1024 * 1024,
  duration_seconds: 300,
}

/** Creates a mock upload provider and returns helpers to trigger callbacks. */
function makeUploadProvider() {
  let capturedCallbacks: {
    onProgress: (p: { pct: number; bytesPerSec: number }) => void
    onSuccess: (r: { providerId: string }) => void
    onError: (e: Error) => void
  } | null = null
  const handleRef = { abort: vi.fn() }

  const provider = {
    name: 'bunny' as const,
    upload: vi.fn((_file: File, _lessonId: string, cb: typeof capturedCallbacks) => {
      capturedCallbacks = cb
      return Promise.resolve(handleRef)
    }),
    getPlaybackInfo: vi.fn(),
    delete: vi.fn(),
    pollStatus: vi.fn(),
  }

  return {
    provider,
    handleRef,
    triggerSuccess: async () => {
      await act(async () => {
        capturedCallbacks?.onSuccess({ providerId: 'vid-new-123' })
      })
    },
    triggerError: async (msg = 'Network error') => {
      await act(async () => {
        capturedCallbacks?.onError(new Error(msg))
      })
    },
    triggerProgress: (pct: number) => {
      act(() => {
        capturedCallbacks?.onProgress({ pct, bytesPerSec: 1000 })
      })
    },
  }
}

/** Start an upload by picking a file via the hidden file input. */
async function startFileUpload(inputEl: HTMLElement, filename = 'test.mp4') {
  const file = new File(['videocontent'], filename, { type: 'video/mp4' })
  await act(async () => {
    await userEvent.upload(inputEl, file)
  })
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockValidateVideoFile.mockResolvedValue({ ok: true })
  mockSetLessonVideoStatus.mockResolvedValue({ error: null })
  mockSetLessonVideo.mockResolvedValue({ error: null })
  mockClearLessonVideo.mockResolvedValue({ error: null })
  mockGetProvider.mockReturnValue({ delete: vi.fn() })

  // Patch document.createElement so video elements fire onloadedmetadata
  // immediately (via queueMicrotask) when their src is set. This makes
  // readVideoDuration resolve in microseconds instead of 8 seconds in jsdom.
  const origCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const el = origCreate(tagName)
    if (tagName.toLowerCase() === 'video') {
      let _src = ''
      Object.defineProperty(el, 'src', {
        get: () => _src,
        set: (url: string) => {
          _src = url
          queueMicrotask(() => {
            const videoEl = el as HTMLVideoElement
            if (typeof videoEl.onloadedmetadata === 'function') {
              videoEl.onloadedmetadata(new Event('loadedmetadata'))
            }
          })
        },
        configurable: true,
      })
    }
    return el
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  // Restore real timers in case any test called vi.useFakeTimers()
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VideoLessonEditor — upload success toast', () => {
  it('shows success toast after successful upload', async () => {
    const { provider, triggerSuccess } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    await triggerSuccess()

    await waitFor(() => {
      expect(screen.getByTestId('upload-success-toast')).toBeInTheDocument()
    })
    expect(screen.getByTestId('upload-success-toast')).toHaveTextContent('Upload video thành công')
  })

  it('hides success toast after 3 seconds', async () => {
    const { provider, triggerSuccess } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    // Capture the 3-second auto-hide callback without using fake timers
    let hideCallback: (() => void) | null = null
    const origSetTimeout = global.setTimeout
    vi.spyOn(global, 'setTimeout').mockImplementation(
      (cb: TimerHandler, ms?: number, ...args: unknown[]) => {
        if (ms === 3000) {
          hideCallback = cb as () => void
          return 0 as unknown as ReturnType<typeof setTimeout>
        }
        return origSetTimeout(cb, ms, ...args)
      }
    )

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    await triggerSuccess()

    await waitFor(() => {
      expect(screen.getByTestId('upload-success-toast')).toBeInTheDocument()
    })

    // Fire the captured auto-hide callback
    await act(async () => { hideCallback?.() })

    expect(screen.queryByTestId('upload-success-toast')).not.toBeInTheDocument()
  })

  it('does NOT show success toast when starting from ready state', () => {
    render(
      <VideoLessonEditor
        lesson={READY_LESSON}
        onLessonChange={vi.fn()}
      />
    )
    expect(screen.queryByTestId('upload-success-toast')).not.toBeInTheDocument()
  })
})

describe('VideoLessonEditor — beforeunload guard', () => {
  it('registers beforeunload handler when upload starts', async () => {
    const { provider } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    const addSpy = vi.spyOn(window, 'addEventListener')

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    const beforeUnloadCalls = addSpy.mock.calls.filter(([event]) => event === 'beforeunload')
    expect(beforeUnloadCalls.length).toBeGreaterThan(0)
  })

  it('removes beforeunload handler when upload completes', async () => {
    const { provider, triggerSuccess } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    const removeSpy = vi.spyOn(window, 'removeEventListener')

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    await triggerSuccess()

    await waitFor(() => {
      expect(screen.getByTestId('video-ready')).toBeInTheDocument()
    })

    const removeBeforeUnloadCalls = removeSpy.mock.calls.filter(([event]) => event === 'beforeunload')
    expect(removeBeforeUnloadCalls.length).toBeGreaterThan(0)
  })

  it('removes beforeunload handler when upload errors', async () => {
    const { provider, triggerError } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    const removeSpy = vi.spyOn(window, 'removeEventListener')

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    await triggerError('Network error')

    await waitFor(() => {
      expect(screen.getByTestId('video-error')).toBeInTheDocument()
    })

    const removeBeforeUnloadCalls = removeSpy.mock.calls.filter(([event]) => event === 'beforeunload')
    expect(removeBeforeUnloadCalls.length).toBeGreaterThan(0)
  })
})

describe('VideoLessonEditor — onIsUploadingChange callback', () => {
  it('calls onIsUploadingChange(true) when upload starts', async () => {
    const { provider } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    const onIsUploadingChange = vi.fn()

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
        onIsUploadingChange={onIsUploadingChange}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    expect(onIsUploadingChange).toHaveBeenCalledWith(true)
  })

  it('calls onIsUploadingChange(false) when upload completes successfully', async () => {
    const { provider, triggerSuccess } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    const onIsUploadingChange = vi.fn()

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
        onIsUploadingChange={onIsUploadingChange}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    await triggerSuccess()

    await waitFor(() => {
      expect(screen.getByTestId('video-ready')).toBeInTheDocument()
    })

    expect(onIsUploadingChange).toHaveBeenCalledWith(false)
  })

  it('calls onIsUploadingChange(false) when upload errors', async () => {
    const { provider, triggerError } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)
    mockSetLessonVideoStatus.mockResolvedValue({ error: null })

    const onIsUploadingChange = vi.fn()

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
        onIsUploadingChange={onIsUploadingChange}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    await triggerError('Upload failed')

    await waitFor(() => {
      expect(screen.getByTestId('video-error')).toBeInTheDocument()
    })

    expect(onIsUploadingChange).toHaveBeenCalledWith(false)
  })

  it('calls onIsUploadingChange(false) when upload is cancelled', async () => {
    const { provider } = makeUploadProvider()
    mockGetDefaultProvider.mockReturnValue(provider)

    const onIsUploadingChange = vi.fn()

    render(
      <VideoLessonEditor
        lesson={BASE_LESSON}
        onLessonChange={vi.fn()}
        onIsUploadingChange={onIsUploadingChange}
      />
    )

    const fileInput = screen.getByTestId('video-file-input')
    await startFileUpload(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('video-uploading')).toBeInTheDocument()
    })

    // Click cancel button
    await userEvent.click(screen.getByRole('button', { name: /hủy/i }))

    await waitFor(() => {
      expect(screen.getByTestId('video-drop-zone')).toBeInTheDocument()
    })

    expect(onIsUploadingChange).toHaveBeenCalledWith(false)
  })
})
