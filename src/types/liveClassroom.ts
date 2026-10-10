/**
 * Live Chess Classroom — Protocol Definitions & Types
 *
 * All realtime communication uses reliable LiveKit Data Channels.
 * Identities strictly use authenticated Supabase user IDs.
 */

export type ClassroomRole = 'teacher' | 'assistant' | 'student'
export type ClassMode = 'MAIN' | 'PRACTICE'
export type PracticeBoardStatus = 'WAITING' | 'PLAYING' | 'FINISHED'

export interface PracticeAssignment {
  boardId: string
  whiteUserId: string
  blackUserId: string
  status: PracticeBoardStatus
  whiteUserName?: string
  blackUserName?: string
  finalPgn?: string
}

export interface ChessMovePayload {
  type: 'CHESS_MOVE'
  boardId: string
  senderId: string
  messageId: string
  ply: number
  uci: string
  san: string
  fen: string
  timestamp: number
}

export interface ChatMessagePayload {
  type: 'CHAT_MESSAGE'
  senderId: string
  senderName?: string
  messageId: string
  text: string
  timestamp: number
  boardId?: string
}

export type ClassroomControlAction =
  | 'RAISE_HAND'
  | 'LOWER_HAND'
  | 'GRANT_MAIN_BOARD_CONTROL'
  | 'REVOKE_MAIN_BOARD_CONTROL'
  | 'SET_CLASS_MODE'
  | 'ASSIGN_PRACTICE_BOARDS'
  | 'UPDATE_PRACTICE_BOARD_STATUS'
  | 'END_CLASS'
  | 'REQUEST_MAIN_BOARD_STATE'
  | 'MAIN_BOARD_STATE_SYNC'
  | 'REQUEST_PRACTICE_ASSIGNMENTS'
  | 'PRACTICE_ASSIGNMENTS_SYNC'

export interface ClassroomControlPayload {
  type: 'CLASSROOM_CONTROL'
  action: ClassroomControlAction
  senderId: string
  messageId: string
  timestamp: number
  targetUserId?: string
  classMode?: ClassMode
  assignments?: PracticeAssignment[]
  boardId?: string
  boardStatus?: PracticeBoardStatus
  // F-03 Main Board snapshot fields
  requestId?: string
  fen?: string
  ply?: number
  moves?: ChessMovePayload[]
  // F-06 Practice Assignments sync revision
  revision?: number
}

export const LIVEKIT_TOPICS = {
  CHESS_MAIN: 'chess:main',
  CHESS_PRACTICE_PREFIX: 'chess:practice:',
  CHAT_MAIN: 'chat:main',
  CHAT_PRACTICE_PREFIX: 'chat:practice:',
  CLASSROOM_CONTROL: 'classroom:control',
} as const

export function getPracticeChessTopic(boardId: string): string {
  return `${LIVEKIT_TOPICS.CHESS_PRACTICE_PREFIX}${boardId}`
}

export function getPracticeChatTopic(boardId: string): string {
  return `${LIVEKIT_TOPICS.CHAT_PRACTICE_PREFIX}${boardId}`
}

export function isPracticeChessTopic(topic: string): boolean {
  return topic.startsWith(LIVEKIT_TOPICS.CHESS_PRACTICE_PREFIX)
}

export function isPracticeChatTopic(topic: string): boolean {
  return topic.startsWith(LIVEKIT_TOPICS.CHAT_PRACTICE_PREFIX)
}

export function parseBoardIdFromTopic(topic: string, prefix: string): string | null {
  if (topic.startsWith(prefix)) {
    return topic.slice(prefix.length)
  }
  return null
}
