import { describe, it, expect } from 'vitest'
import {
  LIVEKIT_TOPICS,
  getPracticeChessTopic,
  getPracticeChatTopic,
  isPracticeChessTopic,
  isPracticeChatTopic,
  parseBoardIdFromTopic,
} from '../../../types/liveClassroom'

describe('liveClassroom protocol & topics', () => {
  it('generates correct topics for main and practice channels', () => {
    expect(LIVEKIT_TOPICS.CHESS_MAIN).toBe('chess:main')
    expect(LIVEKIT_TOPICS.CHAT_MAIN).toBe('chat:main')
    expect(LIVEKIT_TOPICS.CLASSROOM_CONTROL).toBe('classroom:control')

    expect(getPracticeChessTopic('1')).toBe('chess:practice:1')
    expect(getPracticeChatTopic('1')).toBe('chat:practice:1')
    expect(getPracticeChessTopic('board-xyz')).toBe('chess:practice:board-xyz')
  })

  it('correctly identifies practice topics', () => {
    expect(isPracticeChessTopic('chess:practice:1')).toBe(true)
    expect(isPracticeChessTopic('chess:main')).toBe(false)
    expect(isPracticeChatTopic('chat:practice:3')).toBe(true)
    expect(isPracticeChatTopic('chat:main')).toBe(false)
  })

  it('correctly parses board IDs from practice topics', () => {
    expect(parseBoardIdFromTopic('chess:practice:board-42', LIVEKIT_TOPICS.CHESS_PRACTICE_PREFIX)).toBe('board-42')
    expect(parseBoardIdFromTopic('chat:practice:99', LIVEKIT_TOPICS.CHAT_PRACTICE_PREFIX)).toBe('99')
    expect(parseBoardIdFromTopic('chess:main', LIVEKIT_TOPICS.CHESS_PRACTICE_PREFIX)).toBeNull()
  })
})
