export type LiveChatScope = 'MAIN' | 'PRACTICE'

export interface LiveChatMessage {
  id: string
  live_session_id: string
  scope: LiveChatScope
  board_id: string | null
  sender_user_id: string
  sender_display_name: string | null
  client_message_id: string | null
  message: string
  created_at: string
}

export interface SendLiveChatMessageParams {
  sessionId: string
  scope: LiveChatScope
  message: string
  boardId?: string | null
  clientMessageId?: string | null
  senderDisplayName?: string | null
}

export interface GetLiveChatMessagesOptions {
  sessionId: string
  scope?: LiveChatScope
  boardId?: string | null
  limit?: number
  beforeCreatedAt?: string | null
  beforeId?: string | null
}
