/**
 * Live Chess Classroom — Zustand Vanilla Store
 *
 * Requirements:
 * - strict TypeScript types
 * - immutable Zustand updates
 * - no direct LiveKit dependencies inside the Zustand store
 * - no React dependencies inside the store
 */

import { createStore } from 'zustand/vanilla'
import type {
  ClassroomRole,
  ClassMode,
  PracticeAssignment,
  PracticeBoardStatus,
  ChessMovePayload,
} from '../../types/liveClassroom'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface LiveClassroomState {
  // Mode & User Role
  classMode: 'MAIN' | 'PRACTICE'
  myRole: 'teacher' | 'assistant' | 'student'
  teacherId: string | null

  // Main Lecture Board
  currentFen: string
  lectureInteractionUserId: string | null
  raisedHandUserIds: string[]

  // Practice Boards State
  activePracticeBoardId: string | null
  practiceAssignments: PracticeAssignment[]
  practiceRevision: number
  boardFens: Record<string, string>
  boardPlies: Record<string, number>

  // In-memory move history for replay & PGN reconstruction
  boardMoves: Record<string, ChessMovePayload[]>

  // De-duplication tracking
  processedMessageIds: Record<string, number>

  // Actions
  setClassMode: (mode: ClassMode) => void
  setMyRole: (role: ClassroomRole) => void
  setTeacherId: (teacherId: string | null) => void
  updateFen: (fen: string) => void
  setAssignments: (assignments: PracticeAssignment[], revision?: number) => void
  setPracticeRevision: (revision: number) => void
  updateAssignmentStatus: (boardId: string, status: PracticeBoardStatus, finalPgn?: string) => void
  setActivePracticeBoard: (boardId: string | null) => void
  setBoardFen: (boardId: string, fen: string) => void
  setBoardPly: (boardId: string, ply: number) => void
  setMainBoardSnapshot: (fen: string, ply: number, moves: ChessMovePayload[]) => void
  resetMainBoard: () => void
  setLectureInteractionUser: (userId: string | null) => void
  addRaisedHand: (userId: string) => void
  removeRaisedHand: (userId: string) => void
  recordBoardMove: (boardId: string, move: ChessMovePayload) => void
  markMessageProcessed: (messageId: string) => void
  hasProcessedMessage: (messageId: string) => boolean
  resetLiveClass: () => void
}

export const initialLiveClassroomState = {
  classMode: 'MAIN' as const,
  myRole: 'student' as const,
  teacherId: null as string | null,
  currentFen: START_FEN,
  lectureInteractionUserId: null,
  raisedHandUserIds: [],
  activePracticeBoardId: null,
  practiceAssignments: [],
  practiceRevision: 0,
  boardFens: {},
  boardPlies: {},
  boardMoves: {},
  processedMessageIds: {},
}

export function createLiveClassroomStore(initialRole: ClassroomRole = 'student') {
  return createStore<LiveClassroomState>((set, get) => ({
    ...initialLiveClassroomState,
    myRole: initialRole,

    setClassMode: (mode: ClassMode) => {
      set({ classMode: mode })
    },

    setMyRole: (role: ClassroomRole) => {
      set({ myRole: role })
    },

    setTeacherId: (teacherId: string | null) => {
      set({ teacherId })
    },

    updateFen: (fen: string) => {
      set({ currentFen: fen })
    },

    setAssignments: (assignments: PracticeAssignment[], revision?: number) => {
      // Monotonic revision check: ignore stale snapshots or older updates
      if (revision !== undefined && revision < get().practiceRevision) {
        return
      }

      const currentBoardFens = { ...get().boardFens }
      const currentBoardPlies = { ...get().boardPlies }

      // Initialize FEN & ply for new practice boards if not already set
      for (const assignment of assignments) {
        if (!currentBoardFens[assignment.boardId]) {
          currentBoardFens[assignment.boardId] = START_FEN
        }
        if (currentBoardPlies[assignment.boardId] === undefined) {
          currentBoardPlies[assignment.boardId] = 0
        }
      }

      set({
        practiceAssignments: [...assignments],
        practiceRevision: revision !== undefined ? revision : get().practiceRevision,
        boardFens: currentBoardFens,
        boardPlies: currentBoardPlies,
      })
    },

    setPracticeRevision: (revision: number) => {
      set({ practiceRevision: revision })
    },

    updateAssignmentStatus: (boardId: string, status: PracticeBoardStatus, finalPgn?: string) => {
      set((state) => ({
        practiceAssignments: state.practiceAssignments.map((a) =>
          a.boardId === boardId
            ? { ...a, status, ...(finalPgn ? { finalPgn } : {}) }
            : a
        ),
      }))
    },

    setActivePracticeBoard: (boardId: string | null) => {
      set({ activePracticeBoardId: boardId })
    },

    setBoardFen: (boardId: string, fen: string) => {
      set((state) => ({
        boardFens: {
          ...state.boardFens,
          [boardId]: fen,
        },
      }))
    },

    setBoardPly: (boardId: string, ply: number) => {
      set((state) => ({
        boardPlies: {
          ...state.boardPlies,
          [boardId]: ply,
        },
      }))
    },

    setMainBoardSnapshot: (fen: string, ply: number, moves: ChessMovePayload[]) => {
      set((state) => ({
        currentFen: fen,
        boardPlies: {
          ...state.boardPlies,
          main: ply,
        },
        boardMoves: {
          ...state.boardMoves,
          main: [...moves],
        },
      }))
    },

    resetMainBoard: () => {
      set((state) => ({
        currentFen: START_FEN,
        boardPlies: {
          ...state.boardPlies,
          main: 0,
        },
        boardMoves: {
          ...state.boardMoves,
          main: [],
        },
      }))
    },

    setLectureInteractionUser: (userId: string | null) => {
      set((state) => ({
        lectureInteractionUserId: userId,
        // Remove granted user from raised hand list if present
        raisedHandUserIds: userId
          ? state.raisedHandUserIds.filter((id) => id !== userId)
          : state.raisedHandUserIds,
      }))
    },

    addRaisedHand: (userId: string) => {
      set((state) => {
        if (state.raisedHandUserIds.includes(userId)) return state
        return { raisedHandUserIds: [...state.raisedHandUserIds, userId] }
      })
    },

    removeRaisedHand: (userId: string) => {
      set((state) => ({
        raisedHandUserIds: state.raisedHandUserIds.filter((id) => id !== userId),
      }))
    },

    recordBoardMove: (boardId: string, move: ChessMovePayload) => {
      set((state) => {
        const existingMoves = state.boardMoves[boardId] || []
        // Avoid duplicate plies
        if (existingMoves.some((m) => m.messageId === move.messageId || m.ply === move.ply)) {
          return state
        }
        return {
          boardMoves: {
            ...state.boardMoves,
            [boardId]: [...existingMoves, move],
          },
        }
      })
    },

    markMessageProcessed: (messageId: string) => {
      set((state) => ({
        processedMessageIds: {
          ...state.processedMessageIds,
          [messageId]: Date.now(),
        },
      }))
    },

    hasProcessedMessage: (messageId: string) => {
      return Boolean(get().processedMessageIds[messageId])
    },

    resetLiveClass: () => {
      set({
        ...initialLiveClassroomState,
      })
    },
  }))
}

// Global default singleton store for direct subscriptions
export const liveClassroomStore = createLiveClassroomStore()
export type LiveClassroomStore = ReturnType<typeof createLiveClassroomStore>
