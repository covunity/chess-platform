import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  liveClassroomStore,
  createLiveClassroomStore,
  START_FEN,
  type LiveClassroomStore,
} from '../liveClassroomStore'
import type { PracticeAssignment, ChessMovePayload } from '../../../types/liveClassroom'

describe('Live Classroom Session State Isolation & Cleanup (F-02)', () => {
  beforeEach(() => {
    liveClassroomStore.getState().resetLiveClass()
  })

  it('A. Session A -> moves -> leave -> Session B: Session B starts clean with no FEN or move leakage', () => {
    // 1. Session A is active and has moves and custom FEN
    const sessionAFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
    const moveA: ChessMovePayload = {
      type: 'CHESS_MOVE',
      boardId: 'main',
      senderId: 'teacher-1',
      messageId: 'move-session-a-1',
      ply: 1,
      san: 'e4',
      uci: 'e2e4',
      fen: sessionAFen,
      turn: 'b',
      timestamp: Date.now(),
    }

    liveClassroomStore.getState().updateFen(sessionAFen)
    liveClassroomStore.getState().recordBoardMove('main', moveA)
    liveClassroomStore.getState().markMessageProcessed('move-session-a-1')

    expect(liveClassroomStore.getState().currentFen).toBe(sessionAFen)
    expect(liveClassroomStore.getState().boardMoves['main']).toHaveLength(1)
    expect(liveClassroomStore.getState().hasProcessedMessage('move-session-a-1')).toBe(true)

    // 2. User leaves Session A (unmount / leave hook triggered)
    liveClassroomStore.getState().resetLiveClass()

    // 3. User enters Session B
    const stateB = liveClassroomStore.getState()
    expect(stateB.currentFen).toBe(START_FEN)
    expect(stateB.boardMoves).toEqual({})
    expect(stateB.hasProcessedMessage('move-session-a-1')).toBe(false)
  })

  it('B. Session A -> practice assignment -> leave -> Session B: assignments and practice boards reset', () => {
    // Session A assigns practice boards
    const assignmentsA: PracticeAssignment[] = [
      {
        boardId: 'b-1',
        whiteUserId: 'user-w1',
        blackUserId: 'user-b1',
        status: 'PLAYING',
      },
      {
        boardId: 'b-2',
        whiteUserId: 'user-w2',
        blackUserId: 'user-b2',
        status: 'WAITING',
      },
    ]

    liveClassroomStore.getState().setClassMode('PRACTICE')
    liveClassroomStore.getState().setAssignments(assignmentsA)
    liveClassroomStore.getState().setActivePracticeBoard('b-1')
    liveClassroomStore.getState().setBoardFen('b-1', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    liveClassroomStore.getState().setBoardPly('b-1', 1)

    expect(liveClassroomStore.getState().classMode).toBe('PRACTICE')
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(2)
    expect(liveClassroomStore.getState().activePracticeBoardId).toBe('b-1')
    expect(liveClassroomStore.getState().boardPlies['b-1']).toBe(1)

    // Leave Session A
    liveClassroomStore.getState().resetLiveClass()

    // Session B initialized
    const stateB = liveClassroomStore.getState()
    expect(stateB.classMode).toBe('MAIN')
    expect(stateB.practiceAssignments).toEqual([])
    expect(stateB.activePracticeBoardId).toBeNull()
    expect(stateB.boardFens).toEqual({})
    expect(stateB.boardPlies).toEqual({})
  })

  it('C. Session A -> raised hands & control state -> leave -> Session B: control state reset', () => {
    liveClassroomStore.getState().addRaisedHand('student-alpha')
    liveClassroomStore.getState().addRaisedHand('student-beta')
    liveClassroomStore.getState().setLectureInteractionUser('student-alpha')
    liveClassroomStore.getState().setTeacherId('teacher-session-a')

    expect(liveClassroomStore.getState().lectureInteractionUserId).toBe('student-alpha')
    expect(liveClassroomStore.getState().raisedHandUserIds).toEqual(['student-beta'])
    expect(liveClassroomStore.getState().teacherId).toBe('teacher-session-a')

    // Leave Session A
    liveClassroomStore.getState().resetLiveClass()

    // Session B
    const stateB = liveClassroomStore.getState()
    expect(stateB.lectureInteractionUserId).toBeNull()
    expect(stateB.raisedHandUserIds).toEqual([])
    expect(stateB.teacherId).toBeNull()
  })

  it('D. Mount/unmount repeatedly: A -> leave -> B -> leave -> A -> leave without stale state or duplicate leaks', () => {
    const sequence = ['session-A', 'session-B', 'session-A']

    for (const sessionId of sequence) {
      // Mount / Enter session
      liveClassroomStore.getState().resetLiveClass()
      liveClassroomStore.getState().setTeacherId(`teacher-for-${sessionId}`)
      liveClassroomStore.getState().addRaisedHand(`student-for-${sessionId}`)
      liveClassroomStore.getState().updateFen(`fen-for-${sessionId}`)

      expect(liveClassroomStore.getState().teacherId).toBe(`teacher-for-${sessionId}`)
      expect(liveClassroomStore.getState().raisedHandUserIds).toEqual([`student-for-${sessionId}`])
      expect(liveClassroomStore.getState().currentFen).toBe(`fen-for-${sessionId}`)

      // Leave session
      liveClassroomStore.getState().resetLiveClass()

      // Verify clean slate immediately on leave
      expect(liveClassroomStore.getState().teacherId).toBeNull()
      expect(liveClassroomStore.getState().raisedHandUserIds).toEqual([])
      expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
    }
  })

  it('E. Async race: Session A token request starts -> navigate to B -> A request resolves late -> B state remains untouched', async () => {
    let sessionAIsCancelled = false
    const cancelCheckA = () => sessionAIsCancelled

    let sessionBIsCancelled = false
    const cancelCheckB = () => sessionBIsCancelled

    // Simulated async fetchToken implementation with cancellation check
    const runAsyncFetch = async (
      sessionId: string,
      cancelCheck: () => boolean,
      delayMs: number
    ) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (cancelCheck()) {
        // Cancelled! Must drop results and do nothing
        return
      }
      // If not cancelled, writes state
      liveClassroomStore.getState().setTeacherId(`teacher-${sessionId}`)
      liveClassroomStore.getState().updateFen(`fen-${sessionId}`)
    }

    // Step 1: User mounts Session A -> token fetch starts (slow, 50ms)
    const promiseA = runAsyncFetch('session-A', cancelCheckA, 50)

    // Step 2: User leaves Session A before it resolves (after 10ms)
    await new Promise((resolve) => setTimeout(resolve, 10))
    sessionAIsCancelled = true
    liveClassroomStore.getState().resetLiveClass()

    // Step 3: User mounts Session B -> token fetch starts (fast, 20ms)
    const promiseB = runAsyncFetch('session-B', cancelCheckB, 20)

    // Await both promises
    await Promise.all([promiseA, promiseB])

    // State in store MUST belong to Session B, Session A's late callback had zero effect!
    expect(liveClassroomStore.getState().teacherId).toBe('teacher-session-B')
    expect(liveClassroomStore.getState().currentFen).toBe('fen-session-B')
  })

  it('F. MULTI-SESSION SAME TAB: All Session A state reset when navigating to Session B in same tab', () => {
    // Populate rich Session A state
    liveClassroomStore.getState().setClassMode('PRACTICE')
    liveClassroomStore.getState().setTeacherId('teacher-a')
    liveClassroomStore.getState().updateFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    liveClassroomStore.getState().setLectureInteractionUser('student-interaction')
    liveClassroomStore.getState().addRaisedHand('student-hand-1')
    liveClassroomStore.getState().setAssignments([
      { boardId: '1', whiteUserId: 'p1', blackUserId: 'p2', status: 'PLAYING' },
    ])
    liveClassroomStore.getState().setActivePracticeBoard('1')
    liveClassroomStore.getState().recordBoardMove('1', {
      type: 'CHESS_MOVE',
      boardId: '1',
      senderId: 'p1',
      messageId: 'm1',
      ply: 1,
      san: 'e4',
      uci: 'e2e4',
      fen: 'custom',
      turn: 'b',
      timestamp: 12345,
    })
    liveClassroomStore.getState().markMessageProcessed('m1')

    // Navigate to Session B in same tab: resetLiveClass() is called deterministically
    liveClassroomStore.getState().resetLiveClass()

    // Verify each and every single field is reset
    const s = liveClassroomStore.getState()
    expect(s.classMode).toBe('MAIN')
    expect(s.myRole).toBe('student')
    expect(s.teacherId).toBeNull()
    expect(s.currentFen).toBe(START_FEN)
    expect(s.lectureInteractionUserId).toBeNull()
    expect(s.raisedHandUserIds).toEqual([])
    expect(s.activePracticeBoardId).toBeNull()
    expect(s.practiceAssignments).toEqual([])
    expect(s.boardFens).toEqual({})
    expect(s.boardPlies).toEqual({})
    expect(s.boardMoves).toEqual({})
    expect(s.hasProcessedMessage('m1')).toBe(false)
  })
})
