import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendLiveChatMessage, getLiveChatMessages } from '../liveChatApi'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('liveChatApi — Client API Unit Tests (TASK 8.1 / 8.1.1 Hardening)', () => {
  const mockRpc = vi.fn()
  const mockClient = {
    rpc: mockRpc,
  } as unknown as SupabaseClient

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sendLiveChatMessage', () => {
    it('successfully calls send_live_chat_message RPC with proper parameters', async () => {
      const mockResult = {
        id: 'msg-1',
        live_session_id: 'session-1',
        scope: 'MAIN',
        board_id: null,
        sender_user_id: 'user-1',
        message: 'Hello class',
        created_at: '2026-10-06T12:00:00Z',
      }
      mockRpc.mockResolvedValueOnce({ data: mockResult, error: null })

      const { message, error } = await sendLiveChatMessage(mockClient, {
        sessionId: 'session-1',
        scope: 'MAIN',
        message: 'Hello class',
        clientMessageId: 'client-123',
        senderDisplayName: 'Alice',
      })

      expect(error).toBeNull()
      expect(message).toEqual(mockResult)
      expect(mockRpc).toHaveBeenCalledWith('send_live_chat_message', {
        p_session_id: 'session-1',
        p_scope: 'MAIN',
        p_message: 'Hello class',
        p_board_id: null,
        p_client_message_id: 'client-123',
        p_sender_display_name: 'Alice',
      })
    })

    it('missing sessionId does not falsely report persistence success', async () => {
      const { message, error } = await sendLiveChatMessage(mockClient, {
        sessionId: '',
        scope: 'MAIN',
        message: 'Hello without session',
      })

      expect(message).toBeNull()
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toContain('sessionId is required')
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('empty/whitespace message is rejected upfront and does not call RPC', async () => {
      const { message, error } = await sendLiveChatMessage(mockClient, {
        sessionId: 'session-1',
        scope: 'MAIN',
        message: '     ',
      })

      expect(message).toBeNull()
      expect(error?.message).toContain('message cannot be empty')
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('PRACTICE scope requires boardId and fails fast if missing', async () => {
      const { message, error } = await sendLiveChatMessage(mockClient, {
        sessionId: 'session-1',
        scope: 'PRACTICE',
        message: 'Practice text',
      })

      expect(message).toBeNull()
      expect(error?.message).toContain('boardId is required for PRACTICE scope')
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('MAIN scope rejects boardId and fails fast if provided', async () => {
      const { message, error } = await sendLiveChatMessage(mockClient, {
        sessionId: 'session-1',
        scope: 'MAIN',
        boardId: 'board-1',
        message: 'Main text with illegal board',
      })

      expect(message).toBeNull()
      expect(error?.message).toContain('boardId must be null for MAIN scope')
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('handles RPC errors gracefully and returns error object', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: new Error('Session cancelled') })

      const { message, error } = await sendLiveChatMessage(mockClient, {
        sessionId: 'session-1',
        scope: 'MAIN',
        message: 'Hello class',
      })

      expect(message).toBeNull()
      expect(error?.message).toContain('Session cancelled')
    })
  })

  describe('getLiveChatMessages', () => {
    it('successfully calls get_live_chat_messages RPC with default and custom options', async () => {
      const mockRows = [
        { id: '1', message: 'First' },
        { id: '2', message: 'Second' },
      ]
      mockRpc.mockResolvedValueOnce({ data: mockRows, error: null })

      const { messages, error } = await getLiveChatMessages(mockClient, {
        sessionId: 'session-1',
        scope: 'PRACTICE',
        boardId: 'board-7',
        limit: 25,
        beforeCreatedAt: '2026-10-06T11:00:00Z',
        beforeId: 'cursor-id',
      })

      expect(error).toBeNull()
      expect(messages).toEqual(mockRows)
      expect(mockRpc).toHaveBeenCalledWith('get_live_chat_messages', {
        p_session_id: 'session-1',
        p_scope: 'PRACTICE',
        p_board_id: 'board-7',
        p_limit: 25,
        p_before_created_at: '2026-10-06T11:00:00Z',
        p_before_id: 'cursor-id',
      })
    })

    it('missing sessionId fails fast and does not call RPC', async () => {
      const { messages, error } = await getLiveChatMessages(mockClient, {
        sessionId: '',
      })

      expect(messages).toEqual([])
      expect(error?.message).toContain('sessionId is required')
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns empty array on RPC failure', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: new Error('Unauthorized') })

      const { messages, error } = await getLiveChatMessages(mockClient, {
        sessionId: 'session-1',
      })

      expect(messages).toEqual([])
      expect(error?.message).toContain('Unauthorized')
    })
  })
})
