import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from './supabase'
import type {
  LiveGame,
  RecordLiveGameStartParams,
  FinalizeLiveGameParams,
} from '../types/liveGame'

/**
 * Live Game Persistence Client API
 * TASK 8: Live Game Persistence Foundation
 *
 * NOTE ON V1 PERSISTENCE:
 * Realtime moves are transmitted ephemerally via LiveKit DataChannels into in-memory chess.js/Zustand.
 * Database persistence occurs only once at game end (or explicit game start/stop) as a single DB operation.
 * "If the browser crashes or disconnects before game end, the in-memory game that has not yet been persisted may be lost in v1."
 */

/**
 * Record the start of a live chess game in a live session (optional step before finalization).
 */
export async function recordLiveGameStart(
  client: SupabaseClient = defaultSupabase,
  params: RecordLiveGameStartParams
): Promise<{ game: LiveGame | null; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('record_live_game_start', {
      p_game_id: params.gameId,
      p_session_id: params.sessionId,
      p_board_id: params.boardId,
      p_game_scope: params.gameScope,
      p_white_user_id: params.whiteUserId || null,
      p_black_user_id: params.blackUserId || null,
      p_starting_fen: params.startingFen || undefined,
      p_started_at: params.startedAt || undefined,
    })

    if (error) throw error

    return { game: (data as unknown as LiveGame) || null, error: null }
  } catch (err: unknown) {
    return { game: null, error: err as Error }
  }
}

/**
 * Idempotently finalize a live chess game.
 * If the game was not previously recorded via recordLiveGameStart,
 * this inserts the finalized game directly in one database operation.
 * Duplicate submissions with matching result/state return the existing row idempotently.
 */
export async function finalizeLiveGame(
  client: SupabaseClient = defaultSupabase,
  params: FinalizeLiveGameParams
): Promise<{ game: LiveGame | null; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('finalize_live_game', {
      p_game_id: params.gameId,
      p_session_id: params.sessionId,
      p_board_id: params.boardId,
      p_game_scope: params.gameScope,
      p_white_user_id: params.whiteUserId || null,
      p_black_user_id: params.blackUserId || null,
      p_starting_fen: params.startingFen || undefined,
      p_final_fen: params.finalFen || null,
      p_pgn: params.pgn || null,
      p_result: params.result,
      p_termination_reason: params.terminationReason || null,
      p_status: params.status || 'COMPLETED',
      p_move_count: params.moveCount ?? 0,
      p_started_at: params.startedAt || undefined,
      p_ended_at: params.endedAt || undefined,
    })

    if (error) throw error

    return { game: (data as unknown as LiveGame) || null, error: null }
  } catch (err: unknown) {
    return { game: null, error: err as Error }
  }
}

/**
 * Retrieve all persistent live games for a given live session.
 */
export async function getLiveGamesForSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ games: LiveGame[]; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('get_live_session_games', {
      p_session_id: sessionId,
    })

    if (error) throw error

    return { games: (data as unknown as LiveGame[]) || [], error: null }
  } catch (err: unknown) {
    return { games: [], error: err as Error }
  }
}
