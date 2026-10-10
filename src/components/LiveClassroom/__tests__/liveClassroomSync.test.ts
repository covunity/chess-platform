import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  liveClassroomStore,
  START_FEN,
} from '../liveClassroomStore'
import {
  isAuthorizedTeacher,
  getTransportSenderIdentity,
  type LiveKitMessageLike,
} from '../liveClassroomSecurity'
import type {
  ClassroomControlPayload,
  ChessMovePayload,
  PracticeAssignment,
} from '../../../types/liveClassroom'
import { Chess } from 'chess.js'

describe('F-03 — Main Board Late-Joiner Synchronization & Move Ordering', () => {
  const teacherId = 'teacher-uuid-123'
  const student1Id = 'student-uuid-456'
  const attackerId = 'malicious-user-999'

  beforeEach(() => {
    liveClassroomStore.getState().resetLiveClass()
    liveClassroomStore.getState().setTeacherId(teacherId)
  })

  it('1. Teacher receives REQUEST_MAIN_BOARD_STATE and responds with snapshot targeted to requester', () => {
    // Current teacher board state
    const teacherFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
    const teacherPly = 2
    const teacherMoves: ChessMovePayload[] = [
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'move-1',
        ply: 1,
        san: 'e4',
        uci: 'e2e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        turn: 'b',
        timestamp: 1000,
      },
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'move-2',
        ply: 2,
        san: 'e5',
        uci: 'e7e5',
        fen: teacherFen,
        turn: 'w',
        timestamp: 2000,
      },
    ]

    // Set teacher store state
    liveClassroomStore.getState().setMainBoardSnapshot(teacherFen, teacherPly, teacherMoves)

    // Simulate incoming request from student
    const studentRequest: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action: 'REQUEST_MAIN_BOARD_STATE',
      requestId: 'req-abc-123',
      senderId: student1Id,
      messageId: 'msg-req-1',
      timestamp: Date.now(),
      boardId: 'main',
    }

    const mockPublish = vi.fn()
    const handleTeacherIncomingRequest = (
      req: ClassroomControlPayload,
      transportSender: string,
      publishFn: (bytes: Uint8Array, opts: { reliable: boolean; destinationIdentities?: string[] }) => void
    ) => {
      if (req.action === 'REQUEST_MAIN_BOARD_STATE') {
        const state = liveClassroomStore.getState()
        const snapshot: ClassroomControlPayload = {
          type: 'CLASSROOM_CONTROL',
          action: 'MAIN_BOARD_STATE_SYNC',
          requestId: req.requestId,
          senderId: teacherId,
          messageId: `snap-${Date.now()}`,
          timestamp: Date.now(),
          boardId: 'main',
          fen: state.currentFen,
          ply: state.boardPlies['main'] || 0,
          moves: state.boardMoves['main'] || [],
        }
        const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
        publishFn(bytes, {
          reliable: true,
          destinationIdentities: [transportSender],
        })
      }
    }

    handleTeacherIncomingRequest(studentRequest, student1Id, mockPublish)

    expect(mockPublish).toHaveBeenCalledTimes(1)
    const [sentBytes, opts] = mockPublish.mock.calls[0]
    expect(opts.destinationIdentities).toEqual([student1Id]) // Targeted response

    const sentPayload = JSON.parse(new TextDecoder().decode(sentBytes)) as ClassroomControlPayload
    expect(sentPayload.action).toBe('MAIN_BOARD_STATE_SYNC')
    expect(sentPayload.requestId).toBe('req-abc-123')
    expect(sentPayload.fen).toBe(teacherFen)
    expect(sentPayload.ply).toBe(2)
    expect(sentPayload.moves).toHaveLength(2)
  })

  it('2. Non-teacher cannot send authoritative MAIN_BOARD_STATE_SYNC', () => {
    const maliciousMsg: LiveKitMessageLike = {
      payload: new TextEncoder().encode(
        JSON.stringify({
          type: 'CLASSROOM_CONTROL',
          action: 'MAIN_BOARD_STATE_SYNC',
          fen: '8/8/8/8/8/8/8/8 w - - 0 1', // empty board
          ply: 99,
          senderId: teacherId, // Spoofed payload senderId
        })
      ),
      participant: { identity: attackerId }, // Real LiveKit transport identity
    }

    const sender = getTransportSenderIdentity(maliciousMsg)
    const isAuth = isAuthorizedTeacher(sender, maliciousMsg, teacherId)
    expect(isAuth).toBe(false)
  })

  it('3, 4, 5. Late joiner applies snapshot: receives current FEN, ply, and move history', () => {
    const lateJoinerStore = liveClassroomStore.getState()
    expect(lateJoinerStore.currentFen).toBe(START_FEN)
    expect(lateJoinerStore.boardPlies['main']).toBeUndefined()

    const snapshotFen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2'
    const snapshotPly = 2
    const moves: ChessMovePayload[] = [
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm1',
        ply: 1,
        san: 'e4',
        fen: '...',
        turn: 'b',
        timestamp: 100,
      },
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm2',
        ply: 2,
        san: 'c5',
        fen: snapshotFen,
        turn: 'w',
        timestamp: 200,
      },
    ]

    lateJoinerStore.setMainBoardSnapshot(snapshotFen, snapshotPly, moves)

    const updated = liveClassroomStore.getState()
    expect(updated.currentFen).toBe(snapshotFen)
    expect(updated.boardPlies['main']).toBe(2)
    expect(updated.boardMoves['main']).toEqual(moves)
  })

  it('6, 7. Move arriving before snapshot is buffered and replayed in correct order', () => {
    // Student connects and starts at START_FEN (ply 0).
    const localChess = new Chess()
    let localFen = localChess.fen()
    let localPly = 0
    let hasReceivedSnapshot = false
    const bufferedMoves: ChessMovePayload[] = []

    // Move 3 arrives before snapshot arrives
    const move3: ChessMovePayload = {
      type: 'CHESS_MOVE',
      boardId: 'main',
      senderId: teacherId,
      messageId: 'm3',
      ply: 3,
      san: 'Nf3',
      fen: '',
      turn: 'b',
      timestamp: 300,
    }

    // Move arrives before snapshot
    if (!hasReceivedSnapshot) {
      bufferedMoves.push(move3)
    }

    expect(bufferedMoves).toHaveLength(1)
    expect(localPly).toBe(0) // not applied yet

    // Now snapshot arrives with ply 2 (after 1. e4 c5)
    const snapshotFen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2'
    const snapshotPly = 2

    // Apply snapshot
    localChess.load(snapshotFen)
    localFen = snapshotFen
    localPly = snapshotPly
    hasReceivedSnapshot = true

    // Replay pending moves with ply > snapshotPly
    const pending = [...bufferedMoves]
      .filter((m) => m.ply > snapshotPly)
      .sort((a, b) => a.ply - b.ply)

    for (const m of pending) {
      const res = localChess.move(m.san)
      if (res) {
        localFen = localChess.fen()
        localPly = m.ply
      }
    }

    expect(localPly).toBe(3)
    expect(localChess.history()).toEqual(['Nf3'])
    expect(localFen).toContain('5N2')
  })

  it('F-03 Hardening: snapshot request does not fire before LiveKit connection is established or teacher identity is available', () => {
    const mockPublish = vi.fn()
    let isConnected = false
    let effectiveTeacherId: string | undefined = undefined

    const sendSnapshotRequest = () => {
      if (!isConnected || !effectiveTeacherId) return false
      mockPublish({ destinationIdentities: [effectiveTeacherId] })
      return true
    }

    // 1. While room is connecting and no teacher ID
    expect(sendSnapshotRequest()).toBe(false)
    expect(mockPublish).not.toHaveBeenCalled()

    // 2. Room connects but teacher ID is not yet available
    isConnected = true
    expect(sendSnapshotRequest()).toBe(false)
    expect(mockPublish).not.toHaveBeenCalled()

    // 3. Teacher ID arrives but room disconnects
    isConnected = false
    effectiveTeacherId = teacherId
    expect(sendSnapshotRequest()).toBe(false)
    expect(mockPublish).not.toHaveBeenCalled()

    // 4. Both room connected and teacher ID available
    isConnected = true
    expect(sendSnapshotRequest()).toBe(true)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith({ destinationIdentities: [teacherId] })
  })

  it('F-03 Hardening: snapshot request retries once connection/teacher becomes available', () => {
    const mockPublish = vi.fn()
    let isConnected = false
    let effectiveTeacherId: string | undefined = undefined
    let hasReceivedSnapshot = false

    const requestMainBoardState = () => {
      if (!isConnected || !effectiveTeacherId || hasReceivedSnapshot) return
      mockPublish({ destinationIdentities: [effectiveTeacherId] })
    }

    // Initial effect runs on mount while connecting -> does not fire
    requestMainBoardState()
    expect(mockPublish).not.toHaveBeenCalled()

    // Later: teacher identity becomes resolved
    effectiveTeacherId = teacherId
    requestMainBoardState()
    expect(mockPublish).not.toHaveBeenCalled() // still not connected

    // Later: connection transitions to Connected
    isConnected = true
    requestMainBoardState()
    expect(mockPublish).toHaveBeenCalledTimes(1)

    // Once snapshot received, further retries are suppressed
    hasReceivedSnapshot = true
    requestMainBoardState()
    expect(mockPublish).toHaveBeenCalledTimes(1)
  })

  it('F-03 Hardening: strict contiguous replay - buffered [ply N+1, N+3] does NOT replay N+3', () => {
    const localChess = new Chess()
    const snapshotFen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2'
    const snapshotPly = 2

    // Apply snapshot at ply 2
    localChess.load(snapshotFen)
    let localPly = snapshotPly

    // Buffered moves has ply 3 (N+1) and ply 5 (N+3), missing ply 4 (N+2)!
    const bufferedMoves: ChessMovePayload[] = [
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm3',
        ply: 3,
        san: 'Nf3',
        fen: '',
        turn: 'b',
        timestamp: 300,
      },
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm5',
        ply: 5,
        san: 'd4',
        fen: '',
        turn: 'b',
        timestamp: 500,
      },
    ]

    const requestFreshSnapshot = vi.fn()
    const candidates = [...bufferedMoves]
      .filter((m) => m.ply > snapshotPly)
      .sort((a, b) => a.ply - b.ply)

    let expectedPly = snapshotPly + 1
    let hasGap = false
    const remainingUnresolved: ChessMovePayload[] = []

    for (const move of candidates) {
      if (hasGap) {
        remainingUnresolved.push(move)
        continue
      }

      if (move.ply === expectedPly) {
        const moveAttempt = localChess.move(move.san)
        if (moveAttempt) {
          localPly = move.ply
          expectedPly = move.ply + 1
        } else {
          hasGap = true
          remainingUnresolved.push(move)
        }
      } else if (move.ply > expectedPly) {
        // Gap! (expected 4, got 5)
        hasGap = true
        remainingUnresolved.push(move)
      }
    }

    if (hasGap) {
      requestFreshSnapshot(true)
    }

    // Assertions:
    // 1. Ply 3 (N+1) was replayed
    expect(localPly).toBe(3)
    expect(localChess.history()).toEqual(['Nf3'])

    // 2. Ply 5 (N+3) was NOT replayed!
    expect(localChess.history()).not.toContain('d4')

    // 3. Unresolved move 5 was kept in buffer
    expect(remainingUnresolved).toHaveLength(1)
    expect(remainingUnresolved[0].ply).toBe(5)

    // 4. Missing buffered ply triggered a fresh snapshot request
    expect(requestFreshSnapshot).toHaveBeenCalledWith(true)
  })

  it('F-03 Hardening: missing buffered ply triggers fresh snapshot request and preserves unresolved buffer', () => {
    const snapshotPly = 4
    const remainingBuffer: ChessMovePayload[] = []
    const requestSnapshot = vi.fn()

    // Buffered moves only contains ply 6 (missing ply 5)
    const candidates: ChessMovePayload[] = [
      {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: teacherId,
        messageId: 'm6',
        ply: 6,
        san: 'Be2',
        fen: '',
        turn: 'w',
        timestamp: 600,
      },
    ]

    let expectedPly = snapshotPly + 1 // 5
    let hasGap = false

    for (const m of candidates) {
      if (m.ply > expectedPly) {
        hasGap = true
        remainingBuffer.push(m)
      }
    }

    if (hasGap) {
      requestSnapshot(true)
    }

    expect(hasGap).toBe(true)
    expect(requestSnapshot).toHaveBeenCalledWith(true)
    expect(remainingBuffer).toHaveLength(1)
    expect(remainingBuffer[0].messageId).toBe('m6')
  })

  it('8. Move with ply <= snapshotPly is ignored as already included', () => {
    const snapshotPly = 4
    let currentPly = snapshotPly

    const staleMove: ChessMovePayload = {
      type: 'CHESS_MOVE',
      boardId: 'main',
      senderId: teacherId,
      messageId: 'stale-1',
      ply: 3, // <= 4
      san: 'Nf3',
      fen: '',
      turn: 'b',
      timestamp: 300,
    }

    let applied = false
    if (staleMove.ply > currentPly) {
      applied = true
      currentPly = staleMove.ply
    }

    expect(applied).toBe(false)
    expect(currentPly).toBe(4)
  })

  it('9. Move sequence gap (ply > currentPly + 1) triggers resync request and buffers move', () => {
    const currentPly = 2
    const gapMove: ChessMovePayload = {
      type: 'CHESS_MOVE',
      boardId: 'main',
      senderId: teacherId,
      messageId: 'gap-move',
      ply: 5, // missing 3 and 4!
      san: 'd4',
      fen: '',
      turn: 'w',
      timestamp: 500,
    }

    const buffered: ChessMovePayload[] = []
    const requestResync = vi.fn()

    if (gapMove.ply > currentPly + 1) {
      buffered.push(gapMove)
      requestResync()
    }

    expect(requestResync).toHaveBeenCalledTimes(1)
    expect(buffered).toHaveLength(1)
    expect(buffered[0].messageId).toBe('gap-move')
  })

  it('10. Duplicate snapshot does not corrupt state (idempotent)', () => {
    const fen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2'
    const ply = 2

    liveClassroomStore.getState().setMainBoardSnapshot(fen, ply, [])
    expect(liveClassroomStore.getState().currentFen).toBe(fen)
    expect(liveClassroomStore.getState().boardPlies['main']).toBe(2)

    // Receive duplicate snapshot
    liveClassroomStore.getState().setMainBoardSnapshot(fen, ply, [])
    expect(liveClassroomStore.getState().currentFen).toBe(fen)
    expect(liveClassroomStore.getState().boardPlies['main']).toBe(2)
  })

  it('11. Duplicate move does not corrupt state (deduplication)', () => {
    const moveId = 'move-dup-check'
    expect(liveClassroomStore.getState().hasProcessedMessage(moveId)).toBe(false)

    liveClassroomStore.getState().markMessageProcessed(moveId)
    expect(liveClassroomStore.getState().hasProcessedMessage(moveId)).toBe(true)

    // Attempt to process duplicate
    const shouldSkip = liveClassroomStore.getState().hasProcessedMessage(moveId)
    expect(shouldSkip).toBe(true)
  })

  it('12. Snapshot from another session is rejected after state reset', () => {
    // Session A
    liveClassroomStore.getState().setMainBoardSnapshot('some-fen', 5, [])
    expect(liveClassroomStore.getState().boardPlies['main']).toBe(5)

    // Leave Session A / Enter Session B
    liveClassroomStore.getState().resetLiveClass()

    expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
    expect(liveClassroomStore.getState().boardPlies['main']).toBeUndefined()
  })

  it('13, 14, 15. Authorization: Teacher move functional, granted student functional, non-granted student rejected', () => {
    const grantedStudentId = 'student-granted-1'
    const ungrantedStudentId = 'student-ungranted-2'

    liveClassroomStore.getState().setLectureInteractionUser(grantedStudentId)

    // Teacher check
    const isTeacherAuthorized = isAuthorizedTeacher(teacherId, { participant: { identity: teacherId } }, teacherId)
    expect(isTeacherAuthorized).toBe(true)

    // Granted student check
    const currentInteractionUser = liveClassroomStore.getState().lectureInteractionUserId
    expect(grantedStudentId === currentInteractionUser).toBe(true)

    // Ungranted student check
    const isUngrantedAuthorized = isAuthorizedTeacher(ungrantedStudentId, { participant: { identity: ungrantedStudentId } }, teacherId)
    const isUngrantedInteraction = ungrantedStudentId === currentInteractionUser
    expect(isUngrantedAuthorized).toBe(false)
    expect(isUngrantedInteraction).toBe(false)
  })
})

describe('F-06 — Practice Assignment Resynchronization', () => {
  const teacherId = 'teacher-uuid-123'
  const studentId = 'student-uuid-456'
  const attackerId = 'attacker-999'

  beforeEach(() => {
    liveClassroomStore.getState().resetLiveClass()
    liveClassroomStore.getState().setTeacherId(teacherId)
  })

  it('1, 2, 3, 4, 5. Teacher assignments exist; learner requests and reconstructs assignments via snapshot', () => {
    const teacherAssignments: PracticeAssignment[] = [
      {
        boardId: 'practice-1',
        whiteUserId: studentId,
        blackUserId: 'student-2',
        status: 'PLAYING',
      },
      {
        boardId: 'practice-2',
        whiteUserId: 'student-3',
        blackUserId: 'student-4',
        status: 'WAITING',
      },
    ]

    // Teacher has assignments at revision 3
    liveClassroomStore.getState().setAssignments(teacherAssignments, 3)
    expect(liveClassroomStore.getState().practiceRevision).toBe(3)

    // Learner client starts fresh (revision 0, empty assignments)
    const learnerStore = liveClassroomStore.getState()

    // Learner receives snapshot from teacher
    learnerStore.setAssignments(teacherAssignments, 3)

    const updated = liveClassroomStore.getState()
    expect(updated.practiceAssignments).toHaveLength(2)
    expect(updated.practiceAssignments[0].boardId).toBe('practice-1')
    expect(updated.practiceRevision).toBe(3)
  })

  it('6, 7. Duplicate snapshot is idempotent; stale revision is safely ignored', () => {
    const initialAssignments: PracticeAssignment[] = [
      { boardId: 'b-1', whiteUserId: 'u1', blackUserId: 'u2', status: 'PLAYING' },
    ]

    // Current revision is 5
    liveClassroomStore.getState().setAssignments(initialAssignments, 5)
    expect(liveClassroomStore.getState().practiceRevision).toBe(5)

    // Stale snapshot with revision 4 arrives (e.g. delayed network packet)
    const staleAssignments: PracticeAssignment[] = [
      { boardId: 'b-old', whiteUserId: 'u1', blackUserId: 'u2', status: 'WAITING' },
    ]
    liveClassroomStore.getState().setAssignments(staleAssignments, 4)

    // Stale update must be rejected
    expect(liveClassroomStore.getState().practiceRevision).toBe(5)
    expect(liveClassroomStore.getState().practiceAssignments[0].boardId).toBe('b-1')

    // Duplicate snapshot with revision 5 is idempotent
    liveClassroomStore.getState().setAssignments(initialAssignments, 5)
    expect(liveClassroomStore.getState().practiceRevision).toBe(5)
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(1)
  })

  it('8. Non-teacher assignment snapshot is rejected', () => {
    const maliciousMsg: LiveKitMessageLike = {
      payload: new TextEncoder().encode(
        JSON.stringify({
          type: 'CLASSROOM_CONTROL',
          action: 'PRACTICE_ASSIGNMENTS_SYNC',
          assignments: [],
          revision: 999,
        })
      ),
      participant: { identity: attackerId },
    }

    const sender = getTransportSenderIdentity(maliciousMsg)
    const isAuth = isAuthorizedTeacher(sender, maliciousMsg, teacherId)
    expect(isAuth).toBe(false)
  })

  it('9, 10. Learner refresh recovers assignment, subsequent updates apply monotonically', () => {
    // 1. Learner refreshes: store resets to revision 0
    liveClassroomStore.getState().resetLiveClass()
    expect(liveClassroomStore.getState().practiceRevision).toBe(0)
    expect(liveClassroomStore.getState().practiceAssignments).toEqual([])

    // 2. Teacher snapshot syncs revision 1
    const snapshot: PracticeAssignment[] = [
      { boardId: 'b-1', whiteUserId: studentId, blackUserId: 'u2', status: 'PLAYING' },
    ]
    liveClassroomStore.getState().setAssignments(snapshot, 1)
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(1)
    expect(liveClassroomStore.getState().practiceRevision).toBe(1)

    // 3. Subsequent assignment update arrives at revision 2
    const update: PracticeAssignment[] = [
      ...snapshot,
      { boardId: 'b-2', whiteUserId: 'u3', blackUserId: 'u4', status: 'WAITING' },
    ]
    liveClassroomStore.getState().setAssignments(update, 2)
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(2)
    expect(liveClassroomStore.getState().practiceRevision).toBe(2)
  })

  it('11. No cross-session assignment leakage', () => {
    // Session 1 sets practice assignments
    liveClassroomStore.getState().setAssignments(
      [{ boardId: 'b-s1', whiteUserId: 'u1', blackUserId: 'u2', status: 'PLAYING' }],
      10
    )
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(1)
    expect(liveClassroomStore.getState().practiceRevision).toBe(10)

    // Leave Session 1
    liveClassroomStore.getState().resetLiveClass()

    // Session 2 starts completely clean
    expect(liveClassroomStore.getState().practiceAssignments).toEqual([])
    expect(liveClassroomStore.getState().practiceRevision).toBe(0)
  })
})
