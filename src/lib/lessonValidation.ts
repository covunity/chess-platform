/**
 * lessonValidation — PRD-0004 Slice 9a (issue #196)
 *
 * Pure validation functions for lesson review submission.
 * Returns an array of i18n key strings (blockers/warnings).
 */

import { parsePgn } from '../utils/parsePgn'
import type { RichTextDoc } from '../utils/parsePgn'

export interface LessonForValidation {
  type?: 'chess' | 'video' | 'puzzle'
  puzzle_player_side?: 'white' | 'black' | null
  pgn_data?: string
}

/** Returns true if a RichTextDoc has any non-empty text content. */
function noteHasText(note: RichTextDoc | null): boolean {
  if (!note) return false
  for (const block of note.content) {
    if (block.type === 'paragraph' || block.type === 'heading') {
      if ((block.content ?? []).some((s) => s.text.trim().length > 0)) return true
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      for (const item of block.content ?? []) {
        if ((item.content ?? []).some((p) =>
          (p.content ?? []).some((s) => s.text.trim().length > 0)
        )) return true
      }
    }
  }
  return false
}

/**
 * Validate a lesson before it can be submitted for review.
 *
 * @returns Array of i18n key strings. Empty array = no blockers.
 */
export function validateLessonForReview(lesson: LessonForValidation): string[] {
  const errors: string[] = []

  // Only validate puzzle-specific rules for puzzle lessons
  if (lesson.type !== 'puzzle') {
    return errors
  }

  // Puzzle must have playerSide set
  if (lesson.puzzle_player_side == null) {
    errors.push('creator.lessonEditor.puzzleMissingPlayerSide')
  }

  // Any mistake node must have a non-empty note
  if (lesson.pgn_data && lesson.pgn_data.trim()) {
    try {
      const parsed = parsePgn(lesson.pgn_data)
      if (parsed.valid && parsed.mistakeNodes.length > 0) {
        const hasMistakeWithoutNote = parsed.mistakeNodes.some(
          (node) => !noteHasText(node.note)
        )
        if (hasMistakeWithoutNote) {
          errors.push('creator.lessonEditor.mistakeMissingNoteWarning')
        }
      }
    } catch {
      // Parse error — don't add validation errors for malformed PGN
    }
  }

  return errors
}
