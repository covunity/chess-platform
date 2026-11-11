import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import LiveClassroomView from '../LiveClassroomView'
import { liveClassroomStore } from '../liveClassroomStore'

let currentAuthUser: { id: string; email: string; updated_at?: string } | null = {
  id: 'student-123',
  email: 'student@example.com',
  updated_at: '2026-11-11T00:00:00.000Z',
}
let authLoadingState = false

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: currentAuthUser,
    profile: { id: currentAuthUser?.id, name: 'Student 123', role: 'student' },
    loading: authLoadingState,
  }),
}))

const mockInvoke = vi.fn().mockResolvedValue({
  data: {
    token: 'mock-livekit-jwt-token',
    serverUrl: 'wss://livekit.example.com',
    role: 'student',
    identity: 'student-123',
  },
  error: null,
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({
        subscribe: () => ({}),
      }),
    }),
    removeChannel: vi.fn(),
  },
}))

vi.mock('../../../lib/coursesApi', () => ({
  checkLiveClassroomAccess: vi.fn().mockResolvedValue({
    access: {
      is_course_room: true,
      is_session: true,
      session_id: 'session-456',
      course_id: 'course-789',
      course_title: 'Khóa học cờ vua',
      allowed: true,
      role: 'student',
      is_creator: false,
      teacher_id: 'teacher-999',
    },
    error: null,
  }),
}))

vi.mock('../../../lib/liveSessionApi', () => ({
  endLiveSession: vi.fn().mockResolvedValue({ success: true, error: null }),
}))

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="active-livekit-room">{children}</div>
  ),
  RoomAudioRenderer: () => null,
  useDataChannel: vi.fn(),
  useRoomContext: () => ({
    localParticipant: {
      identity: 'student-123',
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      publishData: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
  }),
  useMaybeRoomContext: () => ({
    state: 'connected',
    localParticipant: { identity: 'student-123' },
    on: vi.fn(),
    off: vi.fn(),
  }),
  useParticipants: () => [{ identity: 'student-123', name: 'Student 123' }],
  useTracks: () => [],
  useLocalParticipant: () => ({
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    localParticipant: { identity: 'student-123' },
  }),
}))

vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: () => <div data-testid="mock-chessground" />,
}))

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  </MemoryRouter>
)

describe('LiveClassroom Tab Switching & Connection Retention Bug Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    liveClassroomStore.getState().resetLiveClass()
    currentAuthUser = {
      id: 'student-123',
      email: 'student@example.com',
      updated_at: '2026-11-11T00:00:00.000Z',
    }
    authLoadingState = false
  })

  it('1. Successfully connects and mounts LiveKitRoom on initial load', async () => {
    render(<LiveClassroomView roomId="room-alpha" />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(screen.getByTestId('active-livekit-room')).toBeDefined()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('2. TAB SWITCH FIX: Re-rendering with a new user object reference (same ID) does NOT unmount LiveKitRoom or reset store', async () => {
    let forceParentRender: () => void = () => {}

    function TestParent() {
      const [, setTick] = React.useState(0)
      forceParentRender = () => setTick((t) => t + 1)
      return <LiveClassroomView roomId="room-alpha" />
    }

    render(<TestParent />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(screen.getByTestId('active-livekit-room')).toBeDefined()
    })

    // Modify board state in store to simulate moves during the class
    liveClassroomStore.getState().updateFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')
    expect(liveClassroomStore.getState().currentFen).not.toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')

    // Simulate tab switch: Supabase auth emits a refreshed session, creating a new User object instance
    currentAuthUser = {
      id: 'student-123',
      email: 'student@example.com',
      updated_at: '2026-11-11T00:00:00.000Z',
    }

    // Spy on resetLiveClass to ensure it is NOT invoked on tab switch
    const resetSpy = vi.spyOn(liveClassroomStore.getState(), 'resetLiveClass')

    // Trigger parent re-render as happens when AuthProvider re-renders on tab focus
    act(() => {
      forceParentRender()
    })

    // Verify LiveKitRoom remains active and mounted
    expect(screen.getByTestId('active-livekit-room')).toBeDefined()

    // Verify loading spinner is NOT shown
    expect(screen.queryByText('Đang kết nối vào lớp học...')).toBeNull()

    // Verify invoke was not called again
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    // Verify live store was NOT reset
    expect(resetSpy).not.toHaveBeenCalled()
    expect(liveClassroomStore.getState().currentFen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')

    resetSpy.mockRestore()
  })

  it('3. ROOM SWITCH: Changing roomId cleanly resets store and connects to new room', async () => {
    const { rerender } = render(<LiveClassroomView roomId="room-alpha" />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(screen.getByTestId('active-livekit-room')).toBeDefined()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    // Navigate to room-beta
    rerender(<LiveClassroomView roomId="room-beta" />)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })
  })

  it('4. LOGOUT: When user logs out, cleans up session and shows Login Required screen', async () => {
    const { rerender } = render(<LiveClassroomView roomId="room-alpha" />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(screen.getByTestId('active-livekit-room')).toBeDefined()
    })

    // User logs out
    currentAuthUser = null

    rerender(<LiveClassroomView roomId="room-alpha" />)

    await waitFor(() => {
      expect(screen.getByText('Đăng nhập ngay')).toBeDefined()
    })
  })
})
