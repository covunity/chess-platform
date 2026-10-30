import { describe, it, expect, vi } from 'vitest'
import {
  listTeacherAssignments,
  createAssignmentWithProblems,
  updateAssignmentWithProblems,
  deleteAssignment,
  getAssignmentWithProblems,
  listAssignmentSubmissions,
  gradeAssignmentSubmission,
  submitAssignmentAttempt,
  validateAssignmentProblemChain,
  normalizeSan,
} from './assignmentApi'
import type { SupabaseClient } from '@supabase/supabase-js'

const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const SCHOLAR_MATE_FEN = 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4'

describe('assignmentApi', () => {
  describe('normalizeSan', () => {
    it('strips annotation glyphs like ! and ?', () => {
      expect(normalizeSan('e4!')).toBe('e4')
      expect(normalizeSan('Nf3??')).toBe('Nf3')
      expect(normalizeSan('Qh7+')).toBe('Qh7+')
      expect(normalizeSan('Qxf7#')).toBe('Qxf7#')
    })
  })

  describe('validateAssignmentProblemChain', () => {
    it('accepts valid 1-move problem for white', () => {
      const res = validateAssignmentProblemChain({
        fen: STANDARD_FEN,
        player_side: 'white',
        solution_moves: ['e4'],
      })
      expect(res.isValid).toBe(true)
      expect(res.error).toBeNull()
    })

    it('accepts valid 1-move problem for black', () => {
      const blackToMoveFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
      const res = validateAssignmentProblemChain({
        fen: blackToMoveFen,
        player_side: 'black',
        solution_moves: ['e5'],
      })
      expect(res.isValid).toBe(true)
      expect(res.error).toBeNull()
    })

    it('accepts valid 3-move alternating problem (White -> Black -> White)', () => {
      const res = validateAssignmentProblemChain({
        fen: STANDARD_FEN,
        player_side: 'white',
        solution_moves: ['e4', 'e5', 'Nf3'],
      })
      expect(res.isValid).toBe(true)
      expect(res.error).toBeNull()
    })

    it('rejects problem ending on opponent move (even number of moves: 2)', () => {
      const res = validateAssignmentProblemChain({
        fen: STANDARD_FEN,
        player_side: 'white',
        solution_moves: ['e4', 'e5'],
      })
      expect(res.isValid).toBe(false)
      expect(res.error).toContain('Chuỗi đáp án có 2 nước (kết thúc ở nước đối thủ đáp trả)')
    })

    it('rejects problem when FEN turn does not match player_side', () => {
      const res = validateAssignmentProblemChain({
        fen: STANDARD_FEN, // White to move
        player_side: 'black',
        solution_moves: ['e5'],
      })
      expect(res.isValid).toBe(false)
      expect(res.error).toContain('không khớp')
    })

    it('rejects illegal move in position', () => {
      const res = validateAssignmentProblemChain({
        fen: STANDARD_FEN,
        player_side: 'white',
        solution_moves: ['e5'], // Pawn cannot jump to e5 on move 1
      })
      expect(res.isValid).toBe(false)
      expect(res.error).toContain('không hợp lệ')
    })

    it('rejects moves attempted after checkmate has occurred', () => {
      const res = validateAssignmentProblemChain({
        fen: SCHOLAR_MATE_FEN,
        player_side: 'white',
        // Qxf7# is checkmate, so playing another move after it is invalid
        solution_moves: ['Qxf7#', 'Kxf7', 'd4'],
      })
      expect(res.isValid).toBe(false)
      expect(res.error).toContain('ván cờ đã kết thúc ở nước trước đó')
    })

    it('accepts multi-move sequence even when intermediate position has insufficient material (e.g. K+N vs K)', () => {
      // 4k3/8/8/4N3/8/8/4q3/4K3 w - - 0 1
      // 1. Kxe2 (White captures Q, now K+N vs K - insufficient material draw in normal game)
      // 2. Ke7 (Black responds)
      // 3. Nd3 (White student plays best knight reposition)
      const res = validateAssignmentProblemChain({
        fen: '4k3/8/8/4N3/8/8/4q3/4K3 w - - 0 1',
        player_side: 'white',
        solution_moves: ['Kxe2', 'Ke7', 'Nd3'],
      })
      expect(res.isValid).toBe(true)
      expect(res.error).toBeFalsy()
    })

    it('rejects malformed FEN', () => {
      const res = validateAssignmentProblemChain({
        fen: 'not-a-valid-fen',
        player_side: 'white',
        solution_moves: ['e4'],
      })
      expect(res.isValid).toBe(false)
      expect(res.error).toContain('Chuỗi FEN thế cờ không đúng định dạng')
    })
  })

  describe('listTeacherAssignments', () => {
    it('returns assignments with sorted problems and submission stats', async () => {
      const mockAssignmentsData = [
        {
          id: 'as-1',
          course_id: 'course-1',
          title: 'Bài tập tuần 1',
          description: 'Luyện tập đòn ghim',
          due_date: '2026-11-01T00:00:00Z',
          max_score: 10,
          created_at: '2026-10-20T00:00:00Z',
          updated_at: '2026-10-20T00:00:00Z',
          problems: [
            { id: 'p-2', order_index: 1, title: 'Thế cờ 2', fen: 'fen-2', solution_moves: ['e4'] },
            { id: 'p-1', order_index: 0, title: 'Thế cờ 1', fen: 'fen-1', solution_moves: ['d4'] },
          ],
          submissions: [{ id: 'sub-1' }, { id: 'sub-2' }],
        },
      ]

      const client = {
        from: vi.fn((table: string) => {
          if (table === 'live_assignments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: mockAssignmentsData, error: null }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
              }),
            }
          }
          return {}
        }),
      } as unknown as SupabaseClient

      const { assignments, error } = await listTeacherAssignments(client, 'course-1')
      expect(error).toBeNull()
      expect(assignments).toHaveLength(1)
      expect(assignments[0].id).toBe('as-1')
      expect(assignments[0].problems[0].id).toBe('p-1')
      expect(assignments[0].problems[1].id).toBe('p-2')
      expect(assignments[0].submissions_count).toBe(2)
      expect(assignments[0].enrolled_students_count).toBe(5)
    })
  })

  describe('createAssignmentWithProblems', () => {
    it('creates assignment and inserts problems', async () => {
      const mockAssignmentCreated = {
        id: 'new-as-id',
        course_id: 'c-1',
        title: 'Chiếu hết 1 nước',
        due_date: '2026-12-01T00:00:00Z',
        max_score: 10,
      }

      const mockProblemsCreated = [
        {
          id: 'new-p-1',
          assignment_id: 'new-as-id',
          order_index: 0,
          title: 'Thế cờ 1',
          fen: SCHOLAR_MATE_FEN,
          player_side: 'white',
          solution_moves: ['Qxf7#'],
          points: 10,
        },
      ]

      const client = {
        from: vi.fn((table: string) => {
          if (table === 'live_assignments') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockAssignmentCreated, error: null }),
                }),
              }),
            }
          }
          if (table === 'live_assignment_problems') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: mockProblemsCreated, error: null }),
              }),
            }
          }
          return {}
        }),
      } as unknown as SupabaseClient

      const { assignment, error } = await createAssignmentWithProblems(
        client,
        'c-1',
        {
          title: 'Chiếu hết 1 nước',
          due_date: '2026-12-01T00:00:00Z',
          max_score: 10,
        },
        [
          {
            order_index: 0,
            title: 'Thế cờ 1',
            fen: SCHOLAR_MATE_FEN,
            player_side: 'white',
            solution_moves: ['Qxf7#'],
            explanation: 'Chiếu bí',
            points: 10,
          },
        ]
      )

      expect(error).toBeNull()
      expect(assignment?.id).toBe('new-as-id')
      expect(assignment?.problems).toHaveLength(1)
      expect(assignment?.problems[0].solution_moves).toEqual(['Qxf7#'])
    })

    it('rejects creation when solution moves sequence is invalid', async () => {
      const client = { from: vi.fn() } as unknown as SupabaseClient
      const { assignment, error } = await createAssignmentWithProblems(
        client,
        'c-1',
        {
          title: 'Bài tập lỗi',
          due_date: '2026-12-01T00:00:00Z',
          max_score: 10,
        },
        [
          {
            order_index: 0,
            title: 'Thế cờ lỗi',
            fen: STANDARD_FEN,
            player_side: 'white',
            solution_moves: ['e4', 'e5'], // Even number of moves
            explanation: '',
            points: 10,
          },
        ]
      )

      expect(assignment).toBeNull()
      expect(error).not.toBeNull()
      expect(error?.message).toContain('kết thúc ở nước đối thủ đáp trả')
    })
  })

  describe('updateAssignmentWithProblems', () => {
    it('updates metadata, deletes old problems, and inserts new problems', async () => {
      const deleteMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const insertMock = vi.fn().mockResolvedValue({ error: null })
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      const client = {
        from: vi.fn((table: string) => {
          if (table === 'live_assignments') {
            return { update: updateMock }
          }
          if (table === 'live_assignment_problems') {
            return { delete: deleteMock, insert: insertMock }
          }
          return {}
        }),
      } as unknown as SupabaseClient

      const { success, error } = await updateAssignmentWithProblems(
        client,
        'as-1',
        {
          title: 'Bài tập mới',
          due_date: '2026-11-20T00:00:00Z',
          max_score: 10,
        },
        [
          {
            order_index: 0,
            title: 'Thế cờ A',
            fen: STANDARD_FEN,
            player_side: 'white',
            solution_moves: ['Nf3'],
            explanation: 'Phát triển mã',
            points: 5,
          },
        ]
      )

      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(updateMock).toHaveBeenCalled()
      expect(deleteMock).toHaveBeenCalled()
      expect(insertMock).toHaveBeenCalled()
    })
  })

  describe('deleteAssignment', () => {
    it('deletes assignment by id', async () => {
      const deleteMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const client = {
        from: vi.fn().mockReturnValue({ delete: deleteMock }),
      } as unknown as SupabaseClient

      const { success, error } = await deleteAssignment(client, 'as-1')
      expect(error).toBeNull()
      expect(success).toBe(true)
    })
  })

  describe('gradeAssignmentSubmission', () => {
    it('updates score and teacher feedback', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const client = {
        from: vi.fn().mockReturnValue({ update: updateMock }),
      } as unknown as SupabaseClient

      const { success, error } = await gradeAssignmentSubmission(
        client,
        'sub-1',
        10,
        'Rất xuất sắc!'
      )
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          score: 10,
          teacher_feedback: 'Rất xuất sắc!',
          status: 'graded',
        })
      )
    })
  })

  describe('submitAssignmentAttempt', () => {
    it('upserts submission with answers JSON and totalScore', async () => {
      const upsertMock = vi.fn().mockResolvedValue({ error: null })
      const client = {
        from: vi.fn().mockReturnValue({ upsert: upsertMock }),
      } as unknown as SupabaseClient

      const mockAnswers = [
        {
          problem_id: 'p-1',
          user_moves: ['Qxf7#'],
          attempts: 1,
          is_correct: true,
          earned_points: 5,
        },
      ]

      const { success, error } = await submitAssignmentAttempt(
        client,
        'as-1',
        'u-student',
        mockAnswers,
        5
      )

      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assignment_id: 'as-1',
          user_id: 'u-student',
          score: 5,
          answers: mockAnswers,
          status: 'submitted',
        }),
        { onConflict: 'assignment_id,user_id' }
      )
    })
  })
})

