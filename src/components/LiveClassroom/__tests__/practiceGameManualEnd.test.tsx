import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ConnectionState, RoomEvent } from 'livekit-client'
import PracticeMode from '../PracticeMode'
import LiveBoardSync, { type LiveBoardSyncHandle, type GameEndDetails } from '../Board/LiveBoardSync'
import { liveClassroomStore, START_FEN } from '../liveClassroomStore'
import * as liveGameApi from '../../../lib/liveGameApi'
import {
  type ChessMovePayload,
  getPracticeChessTopic,
} from '../../../types/liveClassroom'
import { type LiveKitMessageLike } from '../liveClassroomSecurity'
import { createRef } from 'react'

// Mock ChessgroundView to prevent canvas/DOM dependency
vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: () => <div data-testid="chessground-view" />,
}))

// Mock ClassroomChat
vi.mock('../Chat/ClassroomChat', () => ({
  default: () => <div data-testid="classroom-chat" />,
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      opts?.winner ? `${key} ${opts.winner}` : opts?.num ? `${key} ${opts.num}` : key,
  }),
}))

// Mock finalizeLiveGame
vi.mock('../../../lib/liveGameApi', async (importOriginal) => {
  const actual = await importOriginal<typeof liveGameApi>()
  return {
    ...actual,
    finalizeLiveGame: vi.fn().mockResolvedValue({ game: { id: 'finalized-game' }, error: null }),
  }
})

// Mock Supabase
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// LiveKit room and hooks mocks
interface MockRoom {
  state: ConnectionState
  listeners: Record<string, ((...args: any[]) => void)[]>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  localParticipant: {
    identity: string
    name: string
    publishData: ReturnType<typeof vi.fn>
    setTrackSubscriptionPermissions: ReturnType<typeof vi.fn>
  }
}

let mockRoom: MockRoom
const channelCallbacks: Record<string, ((msg: any) => void)[]> = {}

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => mockRoom,
  useParticipants: () => [
    { identity: 'teacher-1', name: 'Teacher Dave' },
    { identity: 'student-1', name: 'Alice' },
    { identity: 'student-2', name: 'Bob' },
  ],
  useDataChannel: (topic: string, cb: (msg: any) => void) => {
    channelCallbacks[topic] = channelCallbacks[topic] || []
    channelCallbacks[topic].push(cb)
  },
}))

function createMockRoom(): MockRoom {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {}
  return {
    state: ConnectionState.Connected,
    listeners,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners[event] = listeners[event] || []
      listeners[event].push(handler)
    }),
    off: vi.fn(),
    localParticipant: {
      identity: 'teacher-1',
      name: 'Teacher Dave',
      publishData: vi.fn().mockResolvedValue(undefined),
      setTrackSubscriptionPermissions: vi.fn().mockResolvedValue(undefined),
    },
  }
}

// Minimal known FEN 1 move away from checkmate (Scholar's mate: White plays Qxf7#)
const SCHOLARS_MATE_PRE_FEN = 'r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
const SCHOLARS_MATE_POST_FEN = 'r1bqkb1r/pppp1Qpp/2n5/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4'

describe('TASK 8.0.1 / 8.0.2 — Practice Game Identity, Natural Game-Over & Remount Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))

    mockRoom = createMockRoom()
    Object.keys(channelCallbacks).forEach((k) => delete channelCallbacks[k])

    // Reset Zustand store
    liveClassroomStore.setState({
      sessionId: 'session-101',
      courseId: 'course-101',
      teacherId: 'teacher-1',
      sessionStatus: 'ACTIVE',
      practiceAssignments: [],
      practiceRevision: 0,
      activePracticeBoardId: null,
      boardFens: {},
      boardPlies: {},
      boardMoves: {},
      currentFen: START_FEN,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('1. LiveBoardSyncHandle Imperative Control & Game Identity', () => {
    it('initializes game identity and preserves it through manual board stop', () => {
      const handleRef = createRef<LiveBoardSyncHandle>()
      let initializedGameId = ''
      let initializedStartedAt = ''

      act(() => {
        render(
          <LiveBoardSync
            ref={handleRef}
            initialFen={START_FEN}
            isTeacher={true}
            currentUserId="teacher-1"
            boardId="practice-board-1"
            onGameInit={(meta) => {
              initializedGameId = meta.gameId
              initializedStartedAt = meta.startedAt
            }}
          />
        )
      })

      expect(initializedGameId).toBeTruthy()
      expect(initializedStartedAt).toBe('2026-10-06T12:00:00.000Z')

      // Advance clock by 45 seconds to simulate gameplay duration
      act(() => {
        vi.advanceTimersByTime(45_000)
      })

      // Teacher manually stops the board via imperative handle
      expect(handleRef.current).toBeDefined()
      let endDetails!: any
      act(() => {
        endDetails = handleRef.current!.endGameManually('board_stopped_by_teacher')
      })

      // Invariant: Uses the same active game identity and original start time
      expect(endDetails.gameId).toBe(initializedGameId)
      expect(endDetails.startedAt).toBe('2026-10-06T12:00:00.000Z')
      expect(endDetails.endedAt).toBe('2026-10-06T12:00:45.000Z')
      expect(new Date(endDetails.startedAt).getTime()).toBeLessThan(new Date(endDetails.endedAt).getTime())
      expect(endDetails.result).toBe('*')
      expect(endDetails.terminationReason).toBe('board_stopped_by_teacher')
    })

    it('prevents duplicate finalization on repeated endGameManually calls', () => {
      const handleRef = createRef<LiveBoardSyncHandle>()

      act(() => {
        render(
          <LiveBoardSync
            ref={handleRef}
            initialFen={START_FEN}
            isTeacher={true}
            currentUserId="teacher-1"
            boardId="practice-board-1"
          />
        )
      })

      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      let firstDetails!: any
      act(() => {
        firstDetails = handleRef.current!.endGameManually('board_stopped_by_teacher')
      })

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      let secondDetails!: any
      act(() => {
        secondDetails = handleRef.current!.endGameManually('board_stopped_by_teacher')
      })

      // Returns the exact cached details without regenerating end time or identity
      expect(secondDetails).toEqual(firstDetails)
      expect(secondDetails.endedAt).toBe(firstDetails.endedAt)
    })

    it('generates a fresh distinct gameId when resetGame is called', () => {
      const handleRef = createRef<LiveBoardSyncHandle>()
      let latestGameId = ''

      act(() => {
        render(
          <LiveBoardSync
            ref={handleRef}
            initialFen={START_FEN}
            isTeacher={true}
            currentUserId="teacher-1"
            boardId="practice-board-1"
            onGameInit={(meta) => {
              latestGameId = meta.gameId
            }}
          />
        )
      })

      const firstGameId = latestGameId
      expect(firstGameId).toBeTruthy()

      // Reset for game 2
      act(() => {
        const nextId = handleRef.current!.resetGame()
        expect(nextId).not.toBe(firstGameId)
      })

      expect(latestGameId).not.toBe(firstGameId)
    })
  })

  describe('2. Manual Practice Board End Flow (PracticeMode Integration)', () => {
    it('finalizes currently active game as ABORTED with original startedAt and active gameId when teacher clicks End Board', async () => {
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
          ],
          activePracticeBoardId: '1',
        })
      })

      render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
        />
      )

      // Time passes: game has been running for 90 seconds
      act(() => {
        vi.advanceTimersByTime(90_000)
      })

      // Teacher clicks "End Board"
      const endBoardButton = screen.getByRole('button', { name: /liveClassroom\.endBoard/i })
      expect(endBoardButton).toBeDefined()

      await act(async () => {
        fireEvent.click(endBoardButton)
      })

      // Verify finalizeLiveGame was called
      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      const finalizeCallArg = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1]

      // Invariant checks:
      expect(finalizeCallArg.gameId).toBeDefined()
      expect(typeof finalizeCallArg.gameId).toBe('string')
      expect(finalizeCallArg.gameId.length).toBeGreaterThan(0)

      expect(finalizeCallArg.startedAt).toBe('2026-10-06T12:00:00.000Z')
      expect(finalizeCallArg.endedAt).toBe('2026-10-06T12:01:30.000Z')
      expect(new Date(finalizeCallArg.startedAt).getTime()).toBeLessThan(new Date(finalizeCallArg.endedAt).getTime())

      expect(finalizeCallArg.result).toBe('*')
      expect(finalizeCallArg.status).toBe('ABORTED')
      expect(finalizeCallArg.terminationReason).toBe('board_stopped_by_teacher')
      expect(finalizeCallArg.boardId).toBe('1')
      expect(finalizeCallArg.sessionId).toBe('session-101')
      expect(finalizeCallArg.whiteUserId).toBe('student-1')
      expect(finalizeCallArg.blackUserId).toBe('student-2')

      // Verify board status in store is updated to FINISHED
      const updatedAssignments = liveClassroomStore.getState().practiceAssignments
      expect(updatedAssignments[0].status).toBe('FINISHED')
    })
  })

  describe('3. Natural Game-Over Execution & Callback Path (TASK 8.0.2 Item 1)', () => {
    it('executes chess.js natural checkmate branch in LiveBoardSync and invokes onGameEnd with exact metadata and reason', async () => {
      const handleRef = createRef<LiveBoardSyncHandle>()
      let receivedDetails: GameEndDetails | null = null
      let receivedPgn: string | null = null
      const onGameEndMock = vi.fn((pgn: string, details?: GameEndDetails) => {
        receivedPgn = pgn
        receivedDetails = details || null
      })

      act(() => {
        render(
          <LiveBoardSync
            ref={handleRef}
            initialFen={SCHOLARS_MATE_PRE_FEN}
            isTeacher={false}
            canInteract={true}
            orientation="white"
            currentUserId="student-1"
            boardId="practice-1"
            teacherId="teacher-1"
            onGameEnd={onGameEndMock}
          />
        )
      })

      const initialGameDetails = handleRef.current!.getGameDetails()
      const originalGameId = initialGameDetails.gameId
      const originalStartedAt = initialGameDetails.startedAt
      expect(originalGameId).toBeTruthy()

      // 40 seconds elapse in match
      act(() => {
        vi.advanceTimersByTime(40_000)
      })

      // Deliver authoritative checkmate move (Qxf7#) via DataChannel
      const checkmatePayload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: 'practice-1',
        senderId: 'teacher-1',
        messageId: 'move-mate-1',
        ply: 1,
        uci: 'h5f7',
        san: 'Qxf7#',
        fen: SCHOLARS_MATE_POST_FEN,
        timestamp: Date.now(),
      }

      const msg: LiveKitMessageLike = {
        payload: new TextEncoder().encode(JSON.stringify(checkmatePayload)),
        from: { identity: 'teacher-1' },
      }

      act(() => {
        const topic = getPracticeChessTopic('practice-1')
        channelCallbacks[topic]?.forEach((cb) => cb(msg))
      })

      // Invariants:
      // 1. Natural game-over callback was executed
      expect(onGameEndMock).toHaveBeenCalledTimes(1)
      expect(receivedDetails).not.toBeNull()
      expect(receivedPgn).toContain('Qxf7#')

      // 2. Receives original gameId and original startedAt
      expect(receivedDetails!.gameId).toBe(originalGameId)
      expect(receivedDetails!.startedAt).toBe(originalStartedAt)
      expect(receivedDetails!.endedAt).toBe('2026-10-06T12:00:40.000Z')
      expect(new Date(receivedDetails!.startedAt).getTime()).toBeLessThan(new Date(receivedDetails!.endedAt).getTime())

      // 3. Receives correct result ('1-0') and terminationReason ('checkmate')
      expect(receivedDetails!.result).toBe('1-0')
      expect(receivedDetails!.terminationReason).toBe('checkmate')
      expect(receivedDetails!.moveCount).toBe(1)

      // 4. Invariant: Callback happens only once even if another message arrives
      const duplicateMsg: LiveKitMessageLike = {
        payload: new TextEncoder().encode(
          JSON.stringify({
            ...checkmatePayload,
            messageId: 'move-mate-2',
            ply: 2,
          })
        ),
        from: { identity: 'teacher-1' },
      }

      act(() => {
        const topic = getPracticeChessTopic('practice-1')
        channelCallbacks[topic]?.forEach((cb) => cb(duplicateMsg))
      })

      expect(onGameEndMock).toHaveBeenCalledTimes(1)
    })

    it('integrates natural checkmate through PracticeMode and finalizes game as COMPLETED with original identity', async () => {
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
          ],
          boardFens: { '1': SCHOLARS_MATE_PRE_FEN },
          activePracticeBoardId: '1',
        })
      })

      const boardRef = createRef<LiveBoardSyncHandle>()
      render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
          boardSyncRef={boardRef}
        />
      )

      expect(boardRef.current).toBeDefined()
      const initialMeta = boardRef.current!.getGameDetails()
      const originalGameId = initialMeta.gameId
      const originalStartedAt = initialMeta.startedAt
      expect(originalGameId).toBeTruthy()

      // 60 seconds elapse
      act(() => {
        vi.advanceTimersByTime(60_000)
      })

      // Student 1 (White) plays checkmate move Qxf7#
      const checkmatePayload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: '1',
        senderId: 'student-1',
        messageId: 'student-mate-action',
        ply: 1,
        uci: 'h5f7',
        san: 'Qxf7#',
        fen: SCHOLARS_MATE_POST_FEN,
        timestamp: Date.now(),
      }

      const msg: LiveKitMessageLike = {
        payload: new TextEncoder().encode(JSON.stringify(checkmatePayload)),
        from: { identity: 'student-1' },
      }

      await act(async () => {
        const topic = getPracticeChessTopic('1')
        channelCallbacks[topic]?.forEach((cb) => cb(msg))
      })

      // Invariant: finalizeLiveGame receives exact in-memory gameId and original startedAt
      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      const finalizeArg = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1]

      expect(finalizeArg.gameId).toBe(originalGameId)
      expect(finalizeArg.startedAt).toBe(originalStartedAt)
      expect(finalizeArg.endedAt).toBe('2026-10-06T12:01:00.000Z')
      expect(finalizeArg.result).toBe('1-0')
      expect(finalizeArg.status).toBe('COMPLETED')
      expect(finalizeArg.terminationReason).toBe('checkmate')
      expect(finalizeArg.boardId).toBe('1')
      expect(finalizeArg.sessionId).toBe('session-101')
      expect(finalizeArg.whiteUserId).toBe('student-1')
      expect(finalizeArg.blackUserId).toBe('student-2')
    })
  })

  describe('4. Duplicate Finalization Safeguards (TASK 8.0.2 Item 3)', () => {
    it('prevents double-finalization when natural game-over is followed by teacher End Board', async () => {
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
          ],
          boardFens: { '1': SCHOLARS_MATE_PRE_FEN },
          activePracticeBoardId: '1',
        })
      })

      const boardRef = createRef<LiveBoardSyncHandle>()
      render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
          boardSyncRef={boardRef}
        />
      )

      vi.advanceTimersByTime(20_000)

      // 1. Natural checkmate executes first
      const checkmatePayload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: '1',
        senderId: 'student-1',
        messageId: 'mate-event-1',
        ply: 1,
        uci: 'h5f7',
        san: 'Qxf7#',
        fen: SCHOLARS_MATE_POST_FEN,
        timestamp: Date.now(),
      }

      const msg: LiveKitMessageLike = {
        payload: new TextEncoder().encode(JSON.stringify(checkmatePayload)),
        from: { identity: 'student-1' },
      }

      await act(async () => {
        channelCallbacks[getPracticeChessTopic('1')]?.forEach((cb) => cb(msg))
      })

      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      const firstFinalizedGameId = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1].gameId

      // 2. Subsequent manual termination attempt
      await act(async () => {
        boardRef.current?.endGameManually('board_stopped_by_teacher')
      })

      // Invariant: Must NOT make duplicate finalization call
      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      expect(vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1].gameId).toBe(firstFinalizedGameId)
    })

    it('prevents double-finalization when teacher End Board is followed by late natural game-over', async () => {
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
          ],
          boardFens: { '1': SCHOLARS_MATE_PRE_FEN },
          activePracticeBoardId: '1',
        })
      })

      render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
        />
      )

      vi.advanceTimersByTime(30_000)

      // 1. Teacher manually ends the board
      const endBoardButton = screen.getByRole('button', { name: /liveClassroom\.endBoard/i })
      await act(async () => {
        fireEvent.click(endBoardButton)
      })

      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      const firstCallArg = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1]
      expect(firstCallArg.status).toBe('ABORTED')
      expect(firstCallArg.result).toBe('*')

      // 2. Late natural checkmate arrives over the wire
      const checkmatePayload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: '1',
        senderId: 'student-1',
        messageId: 'late-mate-event',
        ply: 1,
        uci: 'h5f7',
        san: 'Qxf7#',
        fen: SCHOLARS_MATE_POST_FEN,
        timestamp: Date.now(),
      }

      const msg: LiveKitMessageLike = {
        payload: new TextEncoder().encode(JSON.stringify(checkmatePayload)),
        from: { identity: 'student-1' },
      }

      await act(async () => {
        channelCallbacks[getPracticeChessTopic('1')]?.forEach((cb) => cb(msg))
      })

      // Invariant: Finalize must NOT be called again
      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      expect(vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1].gameId).toBe(firstCallArg.gameId)
    })
  })

  describe('5. LiveBoardSync Remount & Active Game Identity Persistence (TASK 8.0.2 Item 2)', () => {
    it('restores exact gameId A and startedAt T0 when LiveBoardSync instance is recreated and finalized', async () => {
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
            {
              boardId: '2',
              whiteUserId: 'student-2',
              blackUserId: 'student-1',
              whiteUserName: 'Bob',
              blackUserName: 'Alice',
              status: 'PLAYING',
            },
          ],
          activePracticeBoardId: '1',
        })
      })

      const boardRef = createRef<LiveBoardSyncHandle>()
      const { rerender } = render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
          boardSyncRef={boardRef}
        />
      )

      // Step 1: Capture initial LiveBoardSync instance, gameId A, and startedAt T0 on Board 1
      const instance1 = boardRef.current!
      expect(instance1).toBeDefined()
      const meta1 = instance1.getGameDetails()
      const gameIdA = meta1.gameId
      const startedAtT0 = meta1.startedAt
      expect(gameIdA).toBeTruthy()
      expect(startedAtT0).toBe('2026-10-06T12:00:00.000Z')

      // 20 seconds elapse on Board 1
      act(() => {
        vi.advanceTimersByTime(20_000)
      })

      // Step 2: Teacher switches to Board 2. Board 1 LiveBoardSync instance is UNMOUNTED.
      act(() => {
        liveClassroomStore.setState({ activePracticeBoardId: '2' })
      })

      rerender(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
          boardSyncRef={boardRef}
        />
      )

      const instance2 = boardRef.current!
      expect(instance2).toBeDefined()
      // Instance 2 is for Board 2, distinct from Instance 1
      expect(instance2).not.toBe(instance1)
      const meta2 = instance2.getGameDetails()
      expect(meta2.gameId).not.toBe(gameIdA)

      // 30 seconds elapse on Board 2
      act(() => {
        vi.advanceTimersByTime(30_000)
      })

      // Step 3: Teacher switches back to Board 1. A NEW LiveBoardSync instance is RECREATED.
      act(() => {
        liveClassroomStore.setState({ activePracticeBoardId: '1' })
      })

      rerender(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
          boardSyncRef={boardRef}
        />
      )

      const instance3 = boardRef.current!
      expect(instance3).toBeDefined()
      // Invariant: Instance 3 is a freshly mounted component instance (recreated LiveBoardSync)
      expect(instance3).not.toBe(instance1)
      expect(instance3).not.toBe(instance2)

      // Invariant: The recreated LiveBoardSync restored the original gameId A and startedAt T0
      const recreatedMeta = instance3.getGameDetails()
      expect(recreatedMeta.gameId).toBe(gameIdA)
      expect(recreatedMeta.startedAt).toBe(startedAtT0)

      // 10 more seconds elapse on Board 1
      act(() => {
        vi.advanceTimersByTime(10_000)
      })

      // Step 4: Teacher manually ends Board 1 on the recreated instance
      const endBoardButton = screen.getByRole('button', { name: /liveClassroom\.endBoard/i })
      await act(async () => {
        fireEvent.click(endBoardButton)
      })

      // Invariant: finalizeLiveGame receives original gameId A and startedAt T0, NOT a newly generated UUID
      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      const callArg = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1]

      expect(callArg.gameId).toBe(gameIdA)
      expect(callArg.startedAt).toBe(startedAtT0)
      expect(callArg.endedAt).toBe('2026-10-06T12:01:00.000Z')
      expect(callArg.boardId).toBe('1')
      expect(callArg.status).toBe('ABORTED')
      expect(callArg.result).toBe('*')
      expect(callArg.terminationReason).toBe('board_stopped_by_teacher')
    })
  })

  describe('6. Sequential Games on Same Board', () => {
    it('creates distinct game IDs for successive games and never reuses previous finalized game ID', async () => {
      // Game 1
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
          ],
          activePracticeBoardId: '1',
        })
      })

      const { unmount } = render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
        />
      )

      vi.advanceTimersByTime(30_000)

      // End Game 1
      const endBoardButton = screen.getByRole('button', { name: /liveClassroom\.endBoard/i })
      await act(async () => {
        fireEvent.click(endBoardButton)
      })

      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(1)
      const game1Id = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[0][1].gameId
      expect(game1Id).toBeTruthy()

      unmount()

      // Reset board to PLAYING for Game 2 (new game on same board)
      act(() => {
        liveClassroomStore.setState({
          practiceAssignments: [
            {
              boardId: '1',
              whiteUserId: 'student-1',
              blackUserId: 'student-2',
              whiteUserName: 'Alice',
              blackUserName: 'Bob',
              status: 'PLAYING',
            },
          ],
          activePracticeBoardId: '1',
          boardFens: { '1': START_FEN },
        })
      })

      vi.advanceTimersByTime(10_000)

      render(
        <PracticeMode
          sessionId="session-101"
          isTeacher={true}
          currentUserId="teacher-1"
          teacherId="teacher-1"
        />
      )

      vi.advanceTimersByTime(40_000)

      // End Game 2
      const endBoardButton2 = screen.getByRole('button', { name: /liveClassroom\.endBoard/i })
      await act(async () => {
        fireEvent.click(endBoardButton2)
      })

      expect(liveGameApi.finalizeLiveGame).toHaveBeenCalledTimes(2)
      const game2Id = vi.mocked(liveGameApi.finalizeLiveGame).mock.calls[1][1].gameId

      // Invariant: Game 1 and Game 2 have distinct identities
      expect(game2Id).toBeTruthy()
      expect(game2Id).not.toBe(game1Id)
    })
  })
})
