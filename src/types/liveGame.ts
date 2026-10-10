/**
 * Type definitions for persistent Live Games
 * TASK 8: Live Game Persistence Foundation
 */

export type LiveGameScope = 'MAIN' | 'PRACTICE'

export type LiveGameResult = '1-0' | '0-1' | '1/2-1/2' | '*'

export type LiveGameStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED'

export interface LiveGame {
  id: string
  live_session_id: string
  board_id: string
  game_scope: LiveGameScope
  white_user_id: string | null
  black_user_id: string | null
  starting_fen: string
  final_fen: string | null
  pgn: string | null
  result: LiveGameResult
  termination_reason: string | null
  status: LiveGameStatus
  move_count: number
  started_at: string
  ended_at: string | null
  submitted_by: string | null
  created_at: string
  updated_at: string
}

export interface RecordLiveGameStartParams {
  gameId: string
  sessionId: string
  boardId: string
  gameScope: LiveGameScope
  whiteUserId?: string | null
  blackUserId?: string | null
  startingFen?: string
  startedAt?: string
}

export interface FinalizeLiveGameParams {
  gameId: string
  sessionId: string
  boardId: string
  gameScope: LiveGameScope
  whiteUserId?: string | null
  blackUserId?: string | null
  startingFen?: string
  finalFen?: string | null
  pgn?: string | null
  result: LiveGameResult
  terminationReason?: string | null
  status?: LiveGameStatus
  moveCount?: number
  startedAt?: string
  endedAt?: string
}
