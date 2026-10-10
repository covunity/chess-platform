import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLiveClassroomStore,
  START_FEN,
  type LiveClassroomStore,
} from '../liveClassroomStore'
import type { PracticeAssignment, ChessMovePayload } from '../../../types/liveClassroom'

describe('liveClassroomStore', () => {
  let store: LiveClassroomStore

  beforeEach(() => {
    store = createLiveClassroomStore('student')
  })

  it('initializes with expected default values', () => {
    const state = store.getState()
    expect(state.classMode).toBe('MAIN')
    expect(state.myRole).toBe('student')
    expect(state.currentFen).toBe(START_FEN)
    expect(state.lectureInteractionUserId).toBeNull()
    expect(state.raisedHandUserIds).toEqual([])
    expect(state.activePracticeBoardId).toBeNull()
    expect(state.practiceAssignments).toEqual([])
    expect(state.boardFens).toEqual({})
    expect(state.boardPlies).toEqual({})
    expect(state.boardMoves).toEqual({})
  })

  it('updates class mode immutably', () => {
    store.getState().setClassMode('PRACTICE')
    expect(store.getState().classMode).toBe('PRACTICE')
    store.getState().setClassMode('MAIN')
    expect(store.getState().classMode).toBe('MAIN')
  })

  it('updates user role', () => {
    store.getState().setMyRole('teacher')
    expect(store.getState().myRole).toBe('teacher')
  })

  it('updates lecture FEN', () => {
    const customFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
    store.getState().updateFen(customFen)
    expect(store.getState().currentFen).toBe(customFen)
  })

  it('sets practice assignments and initializes board FENs and plies', () => {
    const assignments: PracticeAssignment[] = [
      {
        boardId: '1',
        whiteUserId: 'user-w1',
        blackUserId: 'user-b1',
        status: 'PLAYING',
      },
      {
        boardId: '2',
        whiteUserId: 'user-w2',
        blackUserId: 'user-b2',
        status: 'WAITING',
      },
    ]

    store.getState().setAssignments(assignments)
    const state = store.getState()

    expect(state.practiceAssignments).toHaveLength(2)
    expect(state.boardFens['1']).toBe(START_FEN)
    expect(state.boardFens['2']).toBe(START_FEN)
    expect(state.boardPlies['1']).toBe(0)
    expect(state.boardPlies['2']).toBe(0)
  })

  it('updates assignment status and saves final PGN', () => {
    const assignments: PracticeAssignment[] = [
      {
        boardId: '1',
        whiteUserId: 'user-w1',
        blackUserId: 'user-b1',
        status: 'PLAYING',
      },
    ]
    store.getState().setAssignments(assignments)

    const finalPgn = '1. e4 e5 2. Nf3 Nc6'
    store.getState().updateAssignmentStatus('1', 'FINISHED', finalPgn)

    const updated = store.getState().practiceAssignments[0]
    expect(updated.status).toBe('FINISHED')
    expect(updated.finalPgn).toBe(finalPgn)
  })

  it('manages lecture interaction user and raised hands list', () => {
    store.getState().addRaisedHand('student-1')
    store.getState().addRaisedHand('student-2')
    expect(store.getState().raisedHandUserIds).toEqual(['student-1', 'student-2'])

    // No duplicate hands
    store.getState().addRaisedHand('student-1')
    expect(store.getState().raisedHandUserIds).toHaveLength(2)

    // Grant control automatically removes from raised hand list
    store.getState().setLectureInteractionUser('student-1')
    expect(store.getState().lectureInteractionUserId).toBe('student-1')
    expect(store.getState().raisedHandUserIds).toEqual(['student-2'])

    // Remove hand manually
    store.getState().removeRaisedHand('student-2')
    expect(store.getState().raisedHandUserIds).toEqual([])

    // Revoke control
    store.getState().setLectureInteractionUser(null)
    expect(store.getState().lectureInteractionUserId).toBeNull()
  })

  it('records board moves and ignores duplicates', () => {
    const move: ChessMovePayload = {
      type: 'CHESS_MOVE',
      boardId: '1',
      senderId: 'user-1',
      messageId: 'msg-1',
      ply: 1,
      uci: 'e2e4',
      san: 'e4',
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      timestamp: Date.now(),
    }

    store.getState().recordBoardMove('1', move)
    expect(store.getState().boardMoves['1']).toHaveLength(1)

    // Attempt duplicate ply / messageId
    store.getState().recordBoardMove('1', move)
    expect(store.getState().boardMoves['1']).toHaveLength(1)
  })

  it('tracks processed message IDs', () => {
    expect(store.getState().hasProcessedMessage('msg-abc')).toBe(false)
    store.getState().markMessageProcessed('msg-abc')
    expect(store.getState().hasProcessedMessage('msg-abc')).toBe(true)
  })

  it('resets classroom state cleanly', () => {
    store.getState().setClassMode('PRACTICE')
    store.getState().addRaisedHand('user-x')
    store.getState().setActivePracticeBoard('1')

    store.getState().resetLiveClass()
    const state = store.getState()
    expect(state.classMode).toBe('MAIN')
    expect(state.raisedHandUserIds).toEqual([])
    expect(state.activePracticeBoardId).toBeNull()
  })
})
