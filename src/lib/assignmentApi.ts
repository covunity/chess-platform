import type { SupabaseClient } from '@supabase/supabase-js'
import { Chess } from 'chess.js'
import { supabase as defaultClient } from './supabase'

export interface ProblemChainValidationResult {
  isValid: boolean
  error: string | null
}

/**
 * Clean/normalize a SAN move string:
 * - Trims whitespace
 * - Strips trailing PGN annotation glyphs like !, ?, !?, ?!
 * - Preserves check '+' or checkmate '#'
 */
export function normalizeSan(san: string): string {
  if (!san || typeof san !== 'string') return ''
  const trimmed = san.trim()
  return trimmed.replace(/[!?]+$/, '')
}

/**
 * Validate that a chess problem configuration and solution move sequence are valid according to chess rules.
 * 1. FEN is valid according to chess.js.
 * 2. Initial FEN turn matches player_side ('w' for white, 'b' for black).
 * 3. solution_moves has at least 1 move.
 * 4. solution_moves.length is odd (ends on student's move, not opponent's reply).
 * 5. Replaying moves from initial FEN is 100% legal.
 * 6. No moves occur after game is over (isGameOver()).
 */
export function validateAssignmentProblemChain(problem: {
  fen: string
  player_side: 'white' | 'black'
  solution_moves: string[]
  title?: string
}): ProblemChainValidationResult {
  if (!problem.fen || typeof problem.fen !== 'string') {
    return { isValid: false, error: 'Thế cờ không có chuỗi FEN hợp lệ.' }
  }

  let game: Chess
  try {
    game = new Chess(problem.fen.trim())
  } catch {
    return { isValid: false, error: 'Chuỗi FEN thế cờ không đúng định dạng cờ vua quốc tế.' }
  }

  const fenTurn = game.turn() // 'w' | 'b'
  const expectedTurn = problem.player_side === 'white' ? 'w' : 'b'
  if (fenTurn !== expectedTurn) {
    return {
      isValid: false,
      error: `Lượt đi trong thế cờ (${fenTurn === 'w' ? 'Trắng đi' : 'Đen đi'}) không khớp với bên học sinh giải (${problem.player_side === 'white' ? 'Trắng' : 'Đen'}).`,
    }
  }

  if (!Array.isArray(problem.solution_moves) || problem.solution_moves.length === 0) {
    return { isValid: false, error: 'Thế cờ chưa có nước đi đáp án nào.' }
  }

  if (problem.solution_moves.length % 2 === 0) {
    return {
      isValid: false,
      error: `Chuỗi đáp án có ${problem.solution_moves.length} nước (kết thúc ở nước đối thủ đáp trả). Chuỗi đáp án phải kết thúc ở nước của học sinh (số nước đi phải là số lẻ: 1, 3, 5...).`,
    }
  }

  for (let i = 0; i < problem.solution_moves.length; i++) {
    const rawMove = problem.solution_moves[i]
    // A move cannot be made if the game was already checkmated or stalemated in the previous step
    if (game.isCheckmate() || game.isStalemate() || game.moves().length === 0) {
      return {
        isValid: false,
        error: `Nước thứ ${i + 1} (${rawMove}) không thể thực hiện vì ván cờ đã kết thúc ở nước trước đó (chiếu bí hoặc hết nước đi).`,
      }
    }

    try {
      const cleanMove = normalizeSan(rawMove)
      const moveRes = game.move(cleanMove)
      if (!moveRes) {
        return {
          isValid: false,
          error: `Nước thứ ${i + 1} (${rawMove}) không phải là nước đi hợp lệ tại thế cờ này.`,
        }
      }
    } catch {
      return {
        isValid: false,
        error: `Nước thứ ${i + 1} (${rawMove}) không hợp lệ theo luật cờ vua.`,
      }
    }
  }

  return { isValid: true, error: null }
}

export interface AssignmentProblem {
  id: string
  assignment_id: string
  order_index: number
  title: string
  fen: string
  player_side: 'white' | 'black'
  objective?: string
  solution_moves: string[]
  explanation: string
  hint?: string
  points: number
  created_at?: string
}

export interface ChessObjectiveDefinition {
  id: string
  label: string
  category: 'checkmate' | 'capture' | 'tactic' | 'endgame' | 'defense'
  badge: string
  defaultTitle: (side: 'white' | 'black') => string
  description: string
}

export const CHESS_OBJECTIVES: ChessObjectiveDefinition[] = [
  // Nhóm 1: Chiếu bí
  {
    id: 'mate_in_1',
    label: 'Chiếu bí trong 1 nước',
    category: 'checkmate',
    badge: '👑',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi và chiếu bí trong 1 nước`,
    description: 'Tìm nước cờ chiếu hết vua đối phương ngay trong 1 nước đi duy nhất.',
  },
  {
    id: 'mate_in_2',
    label: 'Chiếu bí trong 2 nước',
    category: 'checkmate',
    badge: '👑',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi và chiếu bí sau 2 nước`,
    description: 'Tìm đòn phối hợp chiếu bí đối phương sau 2 nước đi chính xác.',
  },
  {
    id: 'mate_in_3',
    label: 'Chiếu bí trong 3+ nước',
    category: 'checkmate',
    badge: '👑',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi và chiếu bí sau 3 nước`,
    description: 'Chuỗi nước cờ chiếu dồn ép dẫn tới chiếu hết đối phương.',
  },

  // Nhóm 2: Bắt quân / Đòn chiến thuật
  {
    id: 'capture_queen',
    label: 'Bắt Hậu đối phương',
    category: 'capture',
    badge: '👸',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Bắt Hậu đối phương`,
    description: 'Tìm nước cờ hoặc đòn chiến thuật để bắt gọn quân Hậu của đối phương.',
  },
  {
    id: 'capture_piece',
    label: 'Bắt quân hơn chất',
    category: 'capture',
    badge: '⚔️',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Bắt quân hơn chất`,
    description: 'Tìm nước ăn quân không bảo vệ hoặc bẫy bắt Xe, Tượng, Mã.',
  },
  {
    id: 'fork',
    label: 'Đòn chĩa đôi (Fork)',
    category: 'tactic',
    badge: '🔱',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Tung đòn chĩa đôi`,
    description: 'Dùng một quân cờ tấn công đồng thời hai mục tiêu giá trị của đối phương.',
  },
  {
    id: 'pin',
    label: 'Đòn ghim quân (Pin)',
    category: 'tactic',
    badge: '📌',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Thực hiện đòn ghim quân`,
    description: 'Ghim quân cờ của đối thủ trước quân có giá trị lớn hơn hoặc trước Vua.',
  },
  {
    id: 'skewer',
    label: 'Đòn xiên (Skewer)',
    category: 'tactic',
    badge: '🗡️',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Thực hiện đòn xiên`,
    description: 'Tấn công quân giá trị lớn hơn ở phía trước, buộc đối phương chạy để ăn quân phía sau.',
  },
  {
    id: 'discovered_attack',
    label: 'Đòn tấn công mở / Chiếu mở',
    category: 'tactic',
    badge: '⚡',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Đòn tấn công mở`,
    description: 'Di chuyển một quân để mở đường cho quân phía sau tấn công hoặc chiếu tướng.',
  },

  // Nhóm 3: Nước cờ tối ưu
  {
    id: 'best_move',
    label: 'Tìm nước cờ tối ưu nhất',
    category: 'tactic',
    badge: '🎯',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Tìm nước cờ mạnh nhất`,
    description: 'Quan sát toàn diện thế trận và tìm nước cờ mạnh nhất trong tình huống này.',
  },

  // Nhóm 4: Phong cấp & Tàn cuộc
  {
    id: 'promotion',
    label: 'Phong cấp tốt an toàn',
    category: 'endgame',
    badge: '♟️',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Đưa tốt vào phong cấp`,
    description: 'Tìm đường đưa tốt vượt qua sự ngăn cản của đối thủ để phong cấp Hậu thành công.',
  },
  {
    id: 'endgame_technique',
    label: 'Kỹ thuật tàn cuộc',
    category: 'endgame',
    badge: '🏁',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Xử lý tàn cuộc chuẩn xác`,
    description: 'Áp dụng các nguyên lý tàn cuộc cơ bản (Vua + Xe, Vua + Tốt, dồn ép Vua đối phương).',
  },

  // Nhóm 5: Phòng thủ / Cầu hòa
  {
    id: 'escape_check',
    label: 'Thoát hiểm & Phòng thủ',
    category: 'defense',
    badge: '🛡️',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Thoát khỏi đòn nguy hiểm`,
    description: 'Tìm nước cờ phòng thủ chính xác nhất để tránh bị mất quân hoặc bị chiếu bí.',
  },
  {
    id: 'stalemate_draw',
    label: 'Cầu hòa / Bẫy pat (Stalemate)',
    category: 'defense',
    badge: '🤝',
    defaultTitle: (side) => `${side === 'white' ? 'Trắng' : 'Đen'} đi - Tìm nước thủ hòa`,
    description: 'Tìm nước cờ đưa ván cờ về thế hòa cờ (hết nước đi, chiếu vĩnh viễn hoặc bất biến).',
  },
]

export function getObjectiveById(id?: string): ChessObjectiveDefinition {
  return CHESS_OBJECTIVES.find(o => o.id === id) || CHESS_OBJECTIVES[9] // default: best_move
}

export interface AssignmentWithProblems {
  id: string
  course_id: string
  title: string
  description: string | null
  due_date: string
  max_score: number
  created_at: string
  updated_at?: string
  problems: AssignmentProblem[]
  submissions_count?: number
  enrolled_students_count?: number
}

export interface ProblemAnswer {
  problem_id: string
  user_moves: string[]
  attempts: number
  is_correct: boolean
  earned_points: number
  time_spent_seconds?: number
}

export interface AssignmentSubmissionDetail {
  id: string
  assignment_id: string
  user_id: string
  user_name?: string
  user_avatar_url?: string | null
  submitted_at: string
  content: string
  score: number | null
  max_score?: number
  teacher_feedback: string | null
  graded_at: string | null
  status: 'submitted' | 'graded' | 'returned'
  answers: ProblemAnswer[]
}

/**
 * List all assignments with problems and submission counts for a course (Teacher view)
 */
export async function listTeacherAssignments(
  client: SupabaseClient = defaultClient,
  courseId: string
): Promise<{ assignments: AssignmentWithProblems[]; error: Error | null }> {
  try {
    const [assignmentsRes, enrolledRes] = await Promise.all([
      client
        .from('live_assignments')
        .select(`
          id,
          course_id,
          title,
          description,
          due_date,
          max_score,
          created_at,
          updated_at,
          problems:live_assignment_problems(
            id,
            assignment_id,
            order_index,
            title,
            fen,
            player_side,
            objective,
            solution_moves,
            explanation,
            hint,
            points,
            created_at
          ),
          submissions:live_assignment_submissions(id)
        `)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false }),
      client
        .from('enrollments')
        .select('user_id', { count: 'exact', head: true })
        .eq('course_id', courseId),
    ])

    if (assignmentsRes.error) throw assignmentsRes.error

    const enrolledCount = enrolledRes.count ?? 0

    const assignments: AssignmentWithProblems[] = (assignmentsRes.data || []).map((row: any) => {
      const rawProblems = row.problems || []
      const sortedProblems = [...rawProblems].sort((a, b) => a.order_index - b.order_index)
      return {
        id: row.id,
        course_id: row.course_id,
        title: row.title,
        description: row.description,
        due_date: row.due_date,
        max_score: Number(row.max_score) || 10,
        created_at: row.created_at,
        updated_at: row.updated_at,
        problems: sortedProblems,
        submissions_count: Array.isArray(row.submissions) ? row.submissions.length : 0,
        enrolled_students_count: enrolledCount,
      }
    })

    return { assignments, error: null }
  } catch (err: any) {
    return { assignments: [], error: err }
  }
}

/**
 * Create a new assignment with chess problems
 */
export async function createAssignmentWithProblems(
  client: SupabaseClient = defaultClient,
  courseId: string,
  data: {
    title: string
    description?: string | null
    due_date: string
    max_score: number
  },
  problems: Omit<AssignmentProblem, 'id' | 'assignment_id'>[]
): Promise<{ assignment: AssignmentWithProblems | null; error: Error | null }> {
  try {
    // Client-service validation for chess problem chain before submitting to DB
    if (problems && problems.length > 0) {
      for (let i = 0; i < problems.length; i++) {
        const val = validateAssignmentProblemChain(problems[i])
        if (!val.isValid) {
          throw new Error(
            `Lỗi ở thế cờ #${i + 1} (${problems[i].title || 'Chưa đặt tên'}): ${val.error}`
          )
        }
      }
    }

    const { data: assignmentData, error: assignmentError } = await client
      .from('live_assignments')
      .insert({
        course_id: courseId,
        title: data.title,
        description: data.description ?? null,
        due_date: data.due_date,
        max_score: data.max_score,
      })
      .select()
      .single()

    if (assignmentError) throw assignmentError

    let insertedProblems: AssignmentProblem[] = []

    if (problems && problems.length > 0) {
      const problemRows = problems.map((p, idx) => ({
        assignment_id: assignmentData.id,
        order_index: p.order_index ?? idx,
        title: p.title || `Thế cờ #${idx + 1}`,
        fen: p.fen,
        player_side: p.player_side,
        objective: p.objective || 'best_move',
        solution_moves: p.solution_moves,
        explanation: p.explanation || '',
        hint: p.hint || '',
        points: p.points ?? 1,
      }))

      const { data: probsData, error: probsError } = await client
        .from('live_assignment_problems')
        .insert(problemRows)
        .select()

      if (probsError) throw probsError
      insertedProblems = (probsData || []).sort((a: any, b: any) => a.order_index - b.order_index)
    }

    const completeAssignment: AssignmentWithProblems = {
      ...assignmentData,
      problems: insertedProblems,
      submissions_count: 0,
    }

    return { assignment: completeAssignment, error: null }
  } catch (err: any) {
    return { assignment: null, error: err }
  }
}

/**
 * Update an existing assignment and synchronize its problems
 */
export async function updateAssignmentWithProblems(
  client: SupabaseClient = defaultClient,
  assignmentId: string,
  data: {
    title: string
    description?: string | null
    due_date: string
    max_score: number
  },
  problems: (Omit<AssignmentProblem, 'id' | 'assignment_id'> & { id?: string })[]
): Promise<{ success: boolean; error: Error | null }> {
  try {
    // Client-service validation for chess problem chain before submitting to DB
    if (problems && problems.length > 0) {
      for (let i = 0; i < problems.length; i++) {
        const val = validateAssignmentProblemChain(problems[i])
        if (!val.isValid) {
          throw new Error(
            `Lỗi ở thế cờ #${i + 1} (${problems[i].title || 'Chưa đặt tên'}): ${val.error}`
          )
        }
      }
    }

    // 1. Update assignment metadata
    const { error: assignmentError } = await client
      .from('live_assignments')
      .update({
        title: data.title,
        description: data.description ?? null,
        due_date: data.due_date,
        max_score: data.max_score,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignmentId)

    if (assignmentError) throw assignmentError

    // 2. Clear old problems and re-insert new list
    const { error: delError } = await client
      .from('live_assignment_problems')
      .delete()
      .eq('assignment_id', assignmentId)

    if (delError) throw delError

    if (problems && problems.length > 0) {
      const problemRows = problems.map((p, idx) => ({
        assignment_id: assignmentId,
        order_index: p.order_index ?? idx,
        title: p.title || `Thế cờ #${idx + 1}`,
        fen: p.fen,
        player_side: p.player_side,
        objective: p.objective || 'best_move',
        solution_moves: p.solution_moves,
        explanation: p.explanation || '',
        hint: p.hint || '',
        points: p.points ?? 1,
      }))

      const { error: insertError } = await client
        .from('live_assignment_problems')
        .insert(problemRows)

      if (insertError) throw insertError
    }

    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err }
  }
}

/**
 * Delete an assignment
 */
export async function deleteAssignment(
  client: SupabaseClient = defaultClient,
  assignmentId: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await client
      .from('live_assignments')
      .delete()
      .eq('id', assignmentId)

    if (error) throw error
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err }
  }
}

/**
 * Get an assignment with all its problems (for student solver or teacher review)
 */
export async function getAssignmentWithProblems(
  client: SupabaseClient = defaultClient,
  assignmentId: string,
  userId?: string
): Promise<{
  assignment: AssignmentWithProblems | null
  submission: AssignmentSubmissionDetail | null
  error: Error | null
}> {
  try {
    const [assignmentRes, problemsRes, submissionRes] = await Promise.all([
      client.from('live_assignments').select('*').eq('id', assignmentId).single(),
      client
        .from('live_assignment_problems')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('order_index', { ascending: true }),
      userId
        ? client
            .from('live_assignment_submissions')
            .select('*')
            .eq('assignment_id', assignmentId)
            .eq('user_id', userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (assignmentRes.error) throw assignmentRes.error
    if (problemsRes.error) throw problemsRes.error

    const assignment: AssignmentWithProblems = {
      ...assignmentRes.data,
      problems: problemsRes.data || [],
    }

    const submission: AssignmentSubmissionDetail | null = submissionRes.data
      ? {
          ...submissionRes.data,
          answers: (submissionRes.data.answers as ProblemAnswer[]) || [],
        }
      : null

    return { assignment, submission, error: null }
  } catch (err: any) {
    return { assignment: null, submission: null, error: err }
  }
}

/**
 * List all submissions for an assignment (Teacher grading view)
 */
export async function listAssignmentSubmissions(
  client: SupabaseClient = defaultClient,
  assignmentId: string
): Promise<{ submissions: AssignmentSubmissionDetail[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_assignment_submissions')
      .select(`
        id,
        assignment_id,
        user_id,
        submitted_at,
        content,
        score,
        teacher_feedback,
        graded_at,
        status,
        answers,
        users:user_id (
          name,
          avatar_url
        )
      `)
      .eq('assignment_id', assignmentId)
      .order('submitted_at', { ascending: false })

    if (error) throw error

    const submissions: AssignmentSubmissionDetail[] = (data || []).map((row: any) => ({
      id: row.id,
      assignment_id: row.assignment_id,
      user_id: row.user_id,
      user_name: row.users?.name || 'Học viên',
      user_avatar_url: row.users?.avatar_url || null,
      submitted_at: row.submitted_at,
      content: row.content || '',
      score: row.score !== null ? Number(row.score) : null,
      teacher_feedback: row.teacher_feedback || null,
      graded_at: row.graded_at || null,
      status: row.status || 'submitted',
      answers: Array.isArray(row.answers) ? row.answers : [],
    }))

    return { submissions, error: null }
  } catch (err: any) {
    return { submissions: [], error: err }
  }
}

/**
 * Grade a student's submission (Teacher feedback & score update)
 */
export async function gradeAssignmentSubmission(
  client: SupabaseClient = defaultClient,
  submissionId: string,
  score: number,
  teacherFeedback: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await client
      .from('live_assignment_submissions')
      .update({
        score,
        teacher_feedback: teacherFeedback,
        status: 'graded',
        graded_at: new Date().toISOString(),
      })
      .eq('id', submissionId)

    if (error) throw error
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err }
  }
}

/**
 * Submit assignment attempt by a student
 */
export async function submitAssignmentAttempt(
  client: SupabaseClient = defaultClient,
  assignmentId: string,
  userId: string,
  answers: ProblemAnswer[],
  totalScore: number,
  contentSummary?: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const summary =
      contentSummary ||
      `Hoàn thành ${answers.filter(a => a.is_correct).length}/${answers.length} thế cờ. Điểm đạt được: ${totalScore}.`

    const { error } = await client
      .from('live_assignment_submissions')
      .upsert(
        {
          assignment_id: assignmentId,
          user_id: userId,
          content: summary,
          answers,
          score: totalScore,
          submitted_at: new Date().toISOString(),
          status: 'submitted',
        },
        { onConflict: 'assignment_id,user_id' }
      )

    if (error) throw error
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err }
  }
}

