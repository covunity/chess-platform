/**
 * lessonValidation tests — PRD-0004 Slice 9a (issue #196)
 */

import { describe, it, expect } from 'vitest'
import { validateLessonForReview } from './lessonValidation'
import { parsePgn } from '../utils/parsePgn'
import type { PgnNode } from '../utils/parsePgn'

// Helper to build a minimal puzzle lesson
function makePuzzleLesson(overrides: {
  type?: 'chess' | 'video' | 'puzzle'
  puzzle_player_side?: 'white' | 'black' | null
  pgn_data?: string
} = {}) {
  return {
    type: 'puzzle' as const,
    puzzle_player_side: 'white' as 'white' | 'black' | null,
    pgn_data: '1. e4 e5',
    ...overrides,
  }
}

describe('validateLessonForReview', () => {
  describe('puzzle lessons', () => {
    it('returns no errors for a valid puzzle with playerSide set', () => {
      const errors = validateLessonForReview(makePuzzleLesson())
      expect(errors).toHaveLength(0)
    })

    it('returns blocker when puzzle_player_side is null', () => {
      const errors = validateLessonForReview(
        makePuzzleLesson({ puzzle_player_side: null })
      )
      expect(errors).toContain('creator.lessonEditor.puzzleMissingPlayerSide')
    })

    it('returns blocker when puzzle_player_side is undefined (missing field)', () => {
      const lesson = {
        type: 'puzzle' as const,
        pgn_data: '1. e4 e5',
        // no puzzle_player_side
      }
      const errors = validateLessonForReview(lesson as Parameters<typeof validateLessonForReview>[0])
      expect(errors).toContain('creator.lessonEditor.puzzleMissingPlayerSide')
    })

    it('returns blocker when a mistake node has no note', () => {
      // PGN with mistake node but empty note
      const pgn =
        '1. e4 {[gambitly:v1]{"p":"correct"}} (1. d4 {[gambitly:v1]{"p":"mistake"}})'
      const errors = validateLessonForReview(makePuzzleLesson({ pgn_data: pgn }))
      expect(errors).toContain('creator.lessonEditor.mistakeMissingNoteWarning')
    })

    it('returns no error when mistake node has non-empty note', () => {
      const pgn =
        '1. e4 {[gambitly:v1]{"p":"correct"}} (1. d4 {[gambitly:v1]{"p":"mistake","n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"That leads to the Queen\'s Gambit!"}]}]}}})'
      const errors = validateLessonForReview(makePuzzleLesson({ pgn_data: pgn }))
      expect(errors).not.toContain('creator.lessonEditor.mistakeMissingNoteWarning')
    })

    it('accumulates multiple errors', () => {
      const pgn =
        '1. e4 {[gambitly:v1]{"p":"correct"}} (1. d4 {[gambitly:v1]{"p":"mistake"}})'
      const errors = validateLessonForReview(
        makePuzzleLesson({ puzzle_player_side: null, pgn_data: pgn })
      )
      expect(errors).toContain('creator.lessonEditor.puzzleMissingPlayerSide')
      expect(errors).toContain('creator.lessonEditor.mistakeMissingNoteWarning')
    })
  })

  describe('non-puzzle lessons', () => {
    it('returns empty array for chess type lesson', () => {
      const errors = validateLessonForReview({
        type: 'chess',
        pgn_data: '1. e4 e5',
      })
      expect(errors).toHaveLength(0)
    })

    it('returns empty array for video type lesson', () => {
      const errors = validateLessonForReview({
        type: 'video',
        pgn_data: '',
      })
      expect(errors).toHaveLength(0)
    })

    it('returns empty array when no type provided', () => {
      const errors = validateLessonForReview({
        pgn_data: '1. e4 e5',
      } as Parameters<typeof validateLessonForReview>[0])
      expect(errors).toHaveLength(0)
    })
  })
})
