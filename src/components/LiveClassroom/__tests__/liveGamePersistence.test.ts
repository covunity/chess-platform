import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  recordLiveGameStart,
  finalizeLiveGame,
  getLiveGamesForSession,
} from '../../../lib/liveGameApi'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('TASK 8 — Live Game Persistence API & Logic (Frontend / Client)', () => {
  let mockSupabase: SupabaseClient
  let rpcMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    rpcMock = vi.fn()
    mockSupabase = {
      rpc: rpcMock,
    } as unknown as SupabaseClient
  })

  describe('1. recordLiveGameStart API', () => {
    it('invokes record_live_game_start RPC with proper parameters', async () => {
      const mockGameRow = {
        id: 'game-uuid-1',
        live_session_id: 'session-uuid-1',
        board_id: 'main',
        game_scope: 'MAIN',
        status: 'IN_PROGRESS',
        starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      }
      rpcMock.mockResolvedValueOnce({ data: mockGameRow, error: null })

      const { game, error } = await recordLiveGameStart(mockSupabase, {
        gameId: 'game-uuid-1',
        sessionId: 'session-uuid-1',
        boardId: 'main',
        gameScope: 'MAIN',
        whiteUserId: 'teacher-uuid',
      })

      expect(error).toBeNull()
      expect(game).toEqual(mockGameRow)
      expect(rpcMock).toHaveBeenCalledWith('record_live_game_start', {
        p_game_id: 'game-uuid-1',
        p_session_id: 'session-uuid-1',
        p_board_id: 'main',
        p_game_scope: 'MAIN',
        p_white_user_id: 'teacher-uuid',
        p_black_user_id: null,
        p_starting_fen: undefined,
        p_started_at: undefined,
      })
    })

    it('returns error when record_live_game_start RPC fails', async () => {
      const failureErr = new Error('session_not_active')
      rpcMock.mockResolvedValueOnce({ data: null, error: failureErr })

      const { game, error } = await recordLiveGameStart(mockSupabase, {
        gameId: 'game-uuid-2',
        sessionId: 'session-uuid-2',
        boardId: 'practice-1',
        gameScope: 'PRACTICE',
      })

      expect(game).toBeNull()
      expect(error).toBe(failureErr)
    })
  })

  describe('2. finalizeLiveGame API', () => {
    it('invokes finalize_live_game RPC with all final game properties', async () => {
      const mockFinalGame = {
        id: 'game-uuid-3',
        live_session_id: 'session-uuid-3',
        board_id: 'practice-1',
        game_scope: 'PRACTICE',
        white_user_id: 'user-white',
        black_user_id: 'user-black',
        starting_fen: 'start-fen',
        final_fen: 'final-fen',
        pgn: '1. e4 e5 1-0',
        result: '1-0',
        termination_reason: 'checkmate',
        status: 'COMPLETED',
        move_count: 2,
        started_at: '2026-10-05T00:00:00Z',
        ended_at: '2026-10-05T00:05:00Z',
      }
      rpcMock.mockResolvedValueOnce({ data: mockFinalGame, error: null })

      const { game, error } = await finalizeLiveGame(mockSupabase, {
        gameId: 'game-uuid-3',
        sessionId: 'session-uuid-3',
        boardId: 'practice-1',
        gameScope: 'PRACTICE',
        whiteUserId: 'user-white',
        blackUserId: 'user-black',
        startingFen: 'start-fen',
        finalFen: 'final-fen',
        pgn: '1. e4 e5 1-0',
        result: '1-0',
        terminationReason: 'checkmate',
        status: 'COMPLETED',
        moveCount: 2,
        startedAt: '2026-10-05T00:00:00Z',
        endedAt: '2026-10-05T00:05:00Z',
      })

      expect(error).toBeNull()
      expect(game).toEqual(mockFinalGame)
      expect(rpcMock).toHaveBeenCalledWith('finalize_live_game', {
        p_game_id: 'game-uuid-3',
        p_session_id: 'session-uuid-3',
        p_board_id: 'practice-1',
        p_game_scope: 'PRACTICE',
        p_white_user_id: 'user-white',
        p_black_user_id: 'user-black',
        p_starting_fen: 'start-fen',
        p_final_fen: 'final-fen',
        p_pgn: '1. e4 e5 1-0',
        p_result: '1-0',
        p_termination_reason: 'checkmate',
        p_status: 'COMPLETED',
        p_move_count: 2,
        p_started_at: '2026-10-05T00:00:00Z',
        p_ended_at: '2026-10-05T00:05:00Z',
      })
    })

    it('returns error when finalize_live_game RPC fails with conflict', async () => {
      const conflictErr = new Error('conflicting_final_game_state')
      rpcMock.mockResolvedValueOnce({ data: null, error: conflictErr })

      const { game, error } = await finalizeLiveGame(mockSupabase, {
        gameId: 'game-uuid-3',
        sessionId: 'session-uuid-3',
        boardId: 'practice-1',
        gameScope: 'PRACTICE',
        result: '0-1',
      })

      expect(game).toBeNull()
      expect(error).toBe(conflictErr)
    })
  })

  describe('3. getLiveGamesForSession API', () => {
    it('invokes get_live_session_games RPC and returns game array', async () => {
      const mockGames = [
        { id: 'game-1', live_session_id: 'session-1', board_id: 'main', result: '1-0' },
        { id: 'game-2', live_session_id: 'session-1', board_id: 'practice-1', result: '0-1' },
      ]
      rpcMock.mockResolvedValueOnce({ data: mockGames, error: null })

      const { games, error } = await getLiveGamesForSession(mockSupabase, 'session-1')

      expect(error).toBeNull()
      expect(games).toHaveLength(2)
      expect(games[0].id).toBe('game-1')
      expect(rpcMock).toHaveBeenCalledWith('get_live_session_games', {
        p_session_id: 'session-1',
      })
    })
  })
})
