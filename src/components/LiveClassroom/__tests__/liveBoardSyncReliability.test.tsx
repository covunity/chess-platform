import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ConnectionState, RoomEvent } from 'livekit-client'
import LiveBoardSync from '../Board/LiveBoardSync'
import { liveClassroomStore, START_FEN } from '../liveClassroomStore'
import {
  LIVEKIT_TOPICS,
  type ClassroomControlPayload,
  type ChessMovePayload,
} from '../../../types/liveClassroom'

// Mock ChessgroundView to prevent canvas/DOM dependency
vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: () => <div data-testid="chessground-view" />,
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      opts?.winner ? `${key} ${opts.winner}` : opts?.num ? `${key} ${opts.num}` : key,
  }),
}))

// LiveKit room and data channel callback mocks
interface MockRoom {
  state: ConnectionState
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  listeners: Record<string, ((...args: any[]) => void)[]>
  emitStateChange: (state: ConnectionState) => void
  localParticipant: {
    identity: string
    publishData: ReturnType<typeof vi.fn>
  }
}

let mockRoom: MockRoom
let controlMessageCallback: ((msg: any) => void) | null = null
let moveMessageCallback: ((msg: any) => void) | null = null

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => mockRoom,
  useDataChannel: (topic: string, cb: (msg: any) => void) => {
    if (topic === LIVEKIT_TOPICS.CLASSROOM_CONTROL) {
      controlMessageCallback = cb
    } else if (topic === LIVEKIT_TOPICS.CHESS_MAIN) {
      moveMessageCallback = cb
    }
  },
}))

function createMockRoom(initialState: ConnectionState = ConnectionState.Connected): MockRoom {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {}
  return {
    state: initialState,
    listeners,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners[event] = listeners[event] || []
      listeners[event].push(handler)
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler)
      }
    }),
    emitStateChange(state: ConnectionState) {
      this.state = state
      listeners[RoomEvent.ConnectionStateChanged]?.forEach((h) => h(state))
    },
    localParticipant: {
      identity: 'student-uuid-456',
      publishData: vi.fn(),
    },
  }
}

function dispatchControlMessage(teacherId: string, payload: ClassroomControlPayload) {
  if (!controlMessageCallback) throw new Error('Control message callback not registered')
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  controlMessageCallback({
    participant: { identity: teacherId },
    payload: bytes,
  })
}

function dispatchMoveMessage(senderId: string, payload: ChessMovePayload) {
  if (!moveMessageCallback) throw new Error('Move message callback not registered')
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  moveMessageCallback({
    participant: { identity: senderId },
    payload: bytes,
  })
}

function getPublishedControlPackets(): { payload: ClassroomControlPayload; options: any }[] {
  return mockRoom.localParticipant.publishData.mock.calls.map(([bytes, options]: [Uint8Array, any]) => {
    const text = new TextDecoder().decode(bytes)
    return {
      payload: JSON.parse(text) as ClassroomControlPayload,
      options,
    }
  })
}

describe('F-03 — LiveBoardSync Reliability & State Machine (Component-Level)', () => {
  const teacherId = 'teacher-uuid-123'
  const studentId = 'student-uuid-456'

  beforeEach(() => {
    vi.useFakeTimers()
    liveClassroomStore.getState().resetLiveClass()
    liveClassroomStore.getState().setTeacherId(teacherId)
    controlMessageCallback = null
    moveMessageCallback = null
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('1. Initial sync waits for LiveKit Connected + teacherId', () => {
    mockRoom = createMockRoom(ConnectionState.Connecting)

    // Render with teacherId not yet set in props (teacherId undefined in props and store cleared)
    liveClassroomStore.getState().setTeacherId('')
    let rerenderFn: any
    act(() => {
      const { rerender } = render(
        <LiveBoardSync
          initialFen={START_FEN}
          isTeacher={false}
          boardId="main"
          currentUserId={studentId}
        />
      )
      rerenderFn = rerender
    })

    // Room is connecting, teacherId not set -> no request sent
    expect(mockRoom.localParticipant.publishData).not.toHaveBeenCalled()

    // Now teacherId becomes known, but room still connecting
    act(() => {
      liveClassroomStore.getState().setTeacherId(teacherId)
      rerenderFn(
        <LiveBoardSync
          initialFen={START_FEN}
          isTeacher={false}
          boardId="main"
          teacherId={teacherId}
          currentUserId={studentId}
        />
      )
      vi.advanceTimersByTime(5000)
    })
    expect(mockRoom.localParticipant.publishData).not.toHaveBeenCalled()

    // Room transitions to Connected -> request sent immediately!
    act(() => {
      mockRoom.emitStateChange(ConnectionState.Connected)
    })

    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)
    const packets = getPublishedControlPackets()
    expect(packets[0].payload.action).toBe('REQUEST_MAIN_BOARD_STATE')
    expect(packets[0].options.destinationIdentities).toEqual([teacherId])
  })

  it('2. Initial retry cycle works: initial request + up to 3 retries at 3s intervals', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    // Attempt 0: initial request sent immediately
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Retry #1 at 3s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)

    // Retry #2 at 6s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(3)

    // Retry #3 at 9s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(4)

    // Bounded at 3 retries -> no more attempts after 12s
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(4)
  })

  it('3. Snapshot stops initial retry cycle immediately', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Snapshot arrives after 1.5s
    act(() => {
      vi.advanceTimersByTime(1500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-1',
        timestamp: Date.now(),
        boardId: 'main',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        ply: 2,
        moves: [],
      })
    })

    // Advance beyond original retry interval (3s, 6s)
    act(() => {
      vi.advanceTimersByTime(6000)
    })

    // No further retries were sent
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)
  })

  it('4, 5. Sequence gap after received snapshot starts a NEW retry cycle with reset retry counter', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    // Initial request sent (calls = 1)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Advance 3s so Retry #1 is sent (calls = 2)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)

    // Snapshot arrives at t=3500ms (ply 2)
    act(() => {
      vi.advanceTimersByTime(500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-1',
        timestamp: Date.now(),
        boardId: 'main',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        ply: 2,
        moves: [],
      })
    })

    // Initial cycle cancelled. At t=6000ms (>2s throttle since last request at 3000ms):
    // Move arrives with ply 5 (gap! local is 2, expected 3, received 5)
    act(() => {
      vi.advanceTimersByTime(2500)
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'move-gap-5',
        ply: 5,
        san: 'Nf3',
        uci: 'g1f3',
        fen: '',
        turn: 'w',
        timestamp: Date.now(),
      })
    })

    // Forced resync attempt 0 is sent immediately (calls = 3)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(3)

    // Forced cycle Retry #1 at 3s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(4)

    // Forced cycle Retry #2 at 6s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(5)

    // Forced cycle Retry #3 at 9s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(6)

    // Exhausted retries for this cycle: no 4th retry
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(6)
  })

  it('6, 7. Forced resync is not lost because of previous throttle timestamp and retries if lost', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    // Initial request sent at t=0 (calls = 1)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Authoritative snapshot arrives at t=500ms
    act(() => {
      vi.advanceTimersByTime(500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-1',
        timestamp: Date.now(),
        boardId: 'main',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        ply: 2,
        moves: [],
      })
    })

    // At t=1000ms, gap move arrives (ply 5). Only 1000ms since request at t=0 (< 2000ms throttle!)
    act(() => {
      vi.advanceTimersByTime(500)
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm5',
        ply: 5,
        san: 'd4',
        uci: 'd2d4',
        fen: '',
        turn: 'w',
        timestamp: Date.now(),
      })
    })

    // At t=1000ms, the request is throttled -> NOT sent yet! (calls still 1)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Advance 1000ms (t=2000ms, when throttle expires):
    // The scheduled request MUST fire! Do NOT silently lose the request!
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)

    // If no snapshot arrives, retry #1 must fire 3s after the request was sent (at t=5000ms)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(3)
  })

  it('8. Snapshot cancels the forced retry cycle', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    // Initial request (calls = 1)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Snapshot arrives at t=2500ms
    act(() => {
      vi.advanceTimersByTime(2500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-1',
        timestamp: Date.now(),
        boardId: 'main',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        ply: 2,
        moves: [],
      })
    })

    // Gap at t=5000ms: Black move at ply 5 (san: Nc6, uci: b8c6)
    act(() => {
      vi.advanceTimersByTime(2500)
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm5',
        ply: 5,
        san: 'Nc6',
        uci: 'b8c6',
        fen: '',
        turn: 'b',
        timestamp: Date.now(),
      })
    })

    // Forced resync sent at t=5000ms (calls = 2)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)

    // Snapshot arrives at t=5500ms
    act(() => {
      vi.advanceTimersByTime(500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-2',
        timestamp: Date.now(),
        boardId: 'main',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2',
        ply: 4,
        moves: [],
      })
    })

    // Advance 6s: no further retries sent
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)
  })

  it('9. Two simultaneous gap events do not create duplicate retry loops', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    // Initial request at t=0 (calls = 1)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // Snapshot at t=2500ms (ply 2)
    act(() => {
      vi.advanceTimersByTime(2500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-1',
        timestamp: Date.now(),
        boardId: 'main',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        ply: 2,
        moves: [],
      })
    })

    // At t=5000ms, two gap moves arrive almost simultaneously
    act(() => {
      vi.advanceTimersByTime(2500)
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'gap-move-5',
        ply: 5,
        san: 'Nf3',
        uci: 'g1f3',
        fen: '',
        turn: 'w',
        timestamp: Date.now(),
      })
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'gap-move-6',
        ply: 6,
        san: 'Nc6',
        uci: 'b8c6',
        fen: '',
        turn: 'b',
        timestamp: Date.now() + 10,
      })
    })

    // Forced resync attempt 0 is sent (calls = 2)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)

    // Advance 3s -> exactly ONE retry is sent (calls = 3, NOT 4!)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(3)

    // Advance 3s -> exactly ONE retry is sent (calls = 4, NOT 6!)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(4)
  })

  it('10. Buffered [ply N+1, N+3] strictly does NOT apply N+3 and preserves unresolved buffer', () => {
    mockRoom = createMockRoom(ConnectionState.Connected)

    render(
      <LiveBoardSync
        initialFen={START_FEN}
        isTeacher={false}
        boardId="main"
        teacherId={teacherId}
        currentUserId={studentId}
      />
    )

    // Initial request sent (calls = 1)
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1)

    // While waiting for initial snapshot, student receives moves N+1 (ply 3) and N+3 (ply 5)
    // Board starts at FEN after e4 e5 (ply 2)
    const ply2Fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

    act(() => {
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'move-ply-3',
        ply: 3,
        san: 'Nf3',
        uci: 'g1f3',
        fen: '',
        turn: 'b',
        timestamp: 1000,
      })
      dispatchMoveMessage(teacherId, {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'move-ply-5',
        ply: 5,
        san: 'd4',
        uci: 'd2d4',
        fen: '',
        turn: 'b',
        timestamp: 2000,
      })
    })

    // Advance to t=2500ms: snapshot arrives at ply 2
    act(() => {
      vi.advanceTimersByTime(2500)
      dispatchControlMessage(teacherId, {
        type: 'CLASSROOM_CONTROL',
        action: 'MAIN_BOARD_STATE_SYNC',
        senderId: teacherId,
        messageId: 'snap-ply-2',
        timestamp: Date.now(),
        boardId: 'main',
        fen: ply2Fen,
        ply: 2,
        moves: [],
      })
    })

    // Check store state:
    // 1. Ply 3 (N+1) was replayed cleanly!
    expect(liveClassroomStore.getState().boardPlies['main']).toBe(3)
    // 2. Ply 5 (N+3) was NOT applied because ply 4 is missing!
    expect(liveClassroomStore.getState().boardPlies['main']).not.toBe(5)

    // 3. Forced resync was triggered to fetch missing state!
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(2)
  })
})
