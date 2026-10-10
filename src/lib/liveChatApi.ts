import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from './supabase'
import type {
  LiveChatMessage,
  SendLiveChatMessageParams,
  GetLiveChatMessagesOptions,
} from '../types/liveChat'

/**
 * Live Classroom Chat Persistence Client API
 * TASK 8.1 / 8.1.1: Live Chat Persistence & Security Hardening
 *
 * Realtime delivery continues to use LiveKit DataChannel.
 * This API persists logical chat messages and retrieves persisted history.
 */

/**
 * Persist a live chat message to Supabase.
 * Returns the persisted (or idempotently matched) message.
 */
export async function sendLiveChatMessage(
  client: SupabaseClient = defaultSupabase,
  params: SendLiveChatMessageParams
): Promise<{ message: LiveChatMessage | null; error: Error | null }> {
  try {
    if (!params.sessionId || !params.sessionId.trim()) {
      return { message: null, error: new Error('sessionId is required') }
    }

    const trimmedMsg = (params.message || '').trim()
    if (!trimmedMsg) {
      return { message: null, error: new Error('message cannot be empty') }
    }

    if (params.scope === 'PRACTICE' && (!params.boardId || !params.boardId.trim())) {
      return { message: null, error: new Error('boardId is required for PRACTICE scope') }
    }

    if (params.scope === 'MAIN' && params.boardId) {
      return { message: null, error: new Error('boardId must be null for MAIN scope') }
    }

    const { data, error } = await client.rpc('send_live_chat_message', {
      p_session_id: params.sessionId,
      p_scope: params.scope,
      p_message: params.message,
      p_board_id: params.boardId || null,
      p_client_message_id: params.clientMessageId || null,
      p_sender_display_name: params.senderDisplayName || null,
    })

    if (error) throw error

    return { message: (data as unknown as LiveChatMessage) || null, error: null }
  } catch (err: unknown) {
    return { message: null, error: err as Error }
  }
}

/**
 * Retrieve persisted live chat messages with deterministic ordering and optional pagination.
 * Scoped to MAIN or PRACTICE (with boardId).
 */
export async function getLiveChatMessages(
  client: SupabaseClient = defaultSupabase,
  options: GetLiveChatMessagesOptions
): Promise<{ messages: LiveChatMessage[]; error: Error | null }> {
  try {
    if (!options.sessionId || !options.sessionId.trim()) {
      return { messages: [], error: new Error('sessionId is required') }
    }

    if (options.scope === 'PRACTICE' && (!options.boardId || !options.boardId.trim())) {
      return { messages: [], error: new Error('boardId is required for PRACTICE scope') }
    }

    const { data, error } = await client.rpc('get_live_chat_messages', {
      p_session_id: options.sessionId,
      p_scope: options.scope || 'MAIN',
      p_board_id: options.boardId || null,
      p_limit: options.limit ?? 50,
      p_before_created_at: options.beforeCreatedAt || null,
      p_before_id: options.beforeId || null,
    })

    if (error) throw error

    return { messages: ((data as unknown as LiveChatMessage[]) || []), error: null }
  } catch (err: unknown) {
    return { messages: [], error: err as Error }
  }
}
