import { useState, useEffect, useMemo, useRef } from 'react'
import { Chess } from 'chess.js'
import {
  X,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  RotateCcw,
  Award,
  BookOpen,
  Eye,
  ChevronRight,
  ChevronLeft,
  Loader2,
  MessageSquare,
} from 'lucide-react'
import ChessgroundView from '../ChessBoard/ChessgroundView'
import {
  getAssignmentWithProblems,
  submitAssignmentAttempt,
  getObjectiveById,
  normalizeSan,
  type AssignmentWithProblems,
  type AssignmentProblem,
  type ProblemAnswer,
  type AssignmentSubmissionDetail,
} from '../../lib/assignmentApi'

function checkIsPromotionMove(
  fen: string,
  from: string,
  to: string
): { isPromo: boolean; color: 'w' | 'b' } {
  try {
    const game = new Chess(fen)
    const piece = game.get(from as any)
    if (!piece || piece.type !== 'p') return { isPromo: false, color: 'w' }
    const toRank = to[1]
    const isPromo =
      (piece.color === 'w' && toRank === '8') || (piece.color === 'b' && toRank === '1')
    return { isPromo, color: piece.color }
  } catch {
    return { isPromo: false, color: 'w' }
  }
}

export interface AssignmentSolverModalProps {
  assignmentId: string
  userId: string
  isOpen: boolean
  onClose: () => void
  onCompleted?: () => void
}

function computeDests(fen: string): Map<string, string[]> {
  try {
    const chess = new Chess(fen)
    const dests = new Map<string, string[]>()
    for (const move of chess.moves({ verbose: true })) {
      const existing = dests.get(move.from)
      if (existing) {
        existing.push(move.to)
      } else {
        dests.set(move.from, [move.to])
      }
    }
    return dests
  } catch {
    return new Map()
  }
}

export default function AssignmentSolverModal({
  assignmentId,
  userId,
  isOpen,
  onClose,
  onCompleted,
}: AssignmentSolverModalProps) {
  const [loading, setLoading] = useState(true)
  const [assignment, setAssignment] = useState<AssignmentWithProblems | null>(null)
  const [submission, setSubmission] = useState<AssignmentSubmissionDetail | null>(null)

  // Solver Mode: 'solve' | 'summary' | 'review'
  const [mode, setMode] = useState<'solve' | 'summary' | 'review'>('solve')
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0)

  // In-flight Problem State
  const [currentFen, setCurrentFen] = useState<string>('')
  const [playedMoves, setPlayedMoves] = useState<string[]>([])
  const [moveIndex, setMoveIndex] = useState(0)
  const [isProblemSolved, setIsProblemSolved] = useState(false)
  const [isMistake, setIsMistake] = useState(false)
  const [wrongAttempts, setWrongAttempts] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)

  // All student answers for this assignment
  const [answers, setAnswers] = useState<ProblemAnswer[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Chess instance ref & anti-race-condition refs
  const gameRef = useRef<Chess>(new Chess())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mistakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef<number>(0)
  const [isOpponentMoving, setIsOpponentMoving] = useState(false)
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string
    to: string
    color: 'w' | 'b'
  } | null>(null)

  function clearAllTimers() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (mistakeTimerRef.current) {
      clearTimeout(mistakeTimerRef.current)
      mistakeTimerRef.current = null
    }
    setIsOpponentMoving(false)
    setPendingPromotion(null)
    generationRef.current += 1
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimers()
    }
  }, [])

  // Load assignment and previous submission (if any)
  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    getAssignmentWithProblems(undefined, assignmentId, userId)
      .then(({ assignment: asData, submission: subData, error }) => {
        if (!error && asData) {
          setAssignment(asData)
          setSubmission(subData)
          if (subData) {
            // Already submitted: open in review mode
            setMode('review')
            setAnswers(subData.answers || [])
          } else {
            setMode('solve')
            setAnswers([])
          }
        }
      })
      .finally(() => setLoading(false))
  }, [isOpen, assignmentId, userId])

  const currentProblem: AssignmentProblem | undefined = assignment?.problems[currentProblemIndex]

  // Setup problem whenever currentProblemIndex or problem changes
  useEffect(() => {
    clearAllTimers()
    if (!currentProblem) return
    const newGame = new Chess(currentProblem.fen)
    gameRef.current = newGame
    setCurrentFen(newGame.fen())
    setPlayedMoves([])
    setMoveIndex(0)
    setIsProblemSolved(false)
    setIsMistake(false)
    setWrongAttempts(0)
    setShowHint(false)
    setGaveUp(false)
  }, [currentProblemIndex, currentProblem?.id])

  // Check if student's turn or opponent turn
  const fenTurn = currentFen.split(' ')[1]
  const isStudentTurn =
    !isOpponentMoving &&
    ((currentProblem?.player_side === 'white' && fenTurn === 'w') ||
      (currentProblem?.player_side === 'black' && fenTurn === 'b'))

  const currentDests = useMemo(() => {
    if (isProblemSolved || gaveUp || mode === 'review' || isOpponentMoving || !isStudentTurn) {
      return new Map<string, string[]>()
    }
    return computeDests(currentFen)
  }, [currentFen, isProblemSolved, gaveUp, mode, isOpponentMoving, isStudentTurn])

  if (!isOpen) return null

  // Move validation logic
  function handleMove(
    from: string,
    to: string,
    promotionPiece: 'q' | 'r' | 'b' | 'n' = 'q'
  ): boolean {
    if (
      !currentProblem ||
      isProblemSolved ||
      gaveUp ||
      mode === 'review' ||
      isOpponentMoving
    ) {
      return false
    }

    try {
      const tempGame = new Chess(gameRef.current.fen())

      // Check promotion
      const promoInfo = checkIsPromotionMove(tempGame.fen(), from, to)
      if (promoInfo.isPromo && !pendingPromotion) {
        setPendingPromotion({ from, to, color: promoInfo.color })
        return true
      }

      const move = tempGame.move({ from, to, promotion: promotionPiece })
      if (!move) return false

      const expectedMoveSan = normalizeSan(currentProblem.solution_moves[moveIndex])
      const cleanMoveSan = normalizeSan(move.san)

      // Flexible checkmate acceptance ONLY for mate_in_1
      const isMateInOne = currentProblem.objective === 'mate_in_1'
      const isInstantCheckmate = isMateInOne && tempGame.isCheckmate()

      const isMatch =
        cleanMoveSan === expectedMoveSan ||
        move.lan === expectedMoveSan ||
        isInstantCheckmate

      if (isMatch) {
        // Correct move!
        gameRef.current.move({ from, to, promotion: promotionPiece })
        const nextFen = gameRef.current.fen()
        setCurrentFen(nextFen)
        setPlayedMoves(prev => [...prev, move.san])
        setIsMistake(false)
        setPendingPromotion(null)

        const nextMoveIdx = moveIndex + 1

        if (isInstantCheckmate || nextMoveIdx >= currentProblem.solution_moves.length) {
          // Solved current problem!
          finishCurrentProblem(true, false)
        } else {
          setMoveIndex(nextMoveIdx)
          // Opponent auto-reply if sequence continues
          const opponentMoveSan = currentProblem.solution_moves[nextMoveIdx]
          if (opponentMoveSan) {
            setIsOpponentMoving(true)
            const currentGen = generationRef.current

            timerRef.current = setTimeout(() => {
              if (currentGen !== generationRef.current) return
              try {
                const cleanOpponentMove = normalizeSan(opponentMoveSan)
                gameRef.current.move(cleanOpponentMove)
                setCurrentFen(gameRef.current.fen())
                setPlayedMoves(prev => [...prev, cleanOpponentMove])
                setIsOpponentMoving(false)

                const afterOpponentIdx = nextMoveIdx + 1
                if (afterOpponentIdx >= currentProblem.solution_moves.length) {
                  finishCurrentProblem(true, false)
                } else {
                  setMoveIndex(afterOpponentIdx)
                }
              } catch (err) {
                setIsOpponentMoving(false)
                console.error('Opponent move error:', err)
              }
            }, 400)
          }
        }
        return true
      } else {
        // Wrong move: reject move, piece snaps back
        setIsMistake(true)
        setWrongAttempts(prev => prev + 1)
        setPendingPromotion(null)
        if (mistakeTimerRef.current) clearTimeout(mistakeTimerRef.current)
        mistakeTimerRef.current = setTimeout(() => setIsMistake(false), 1200)
        return false
      }
    } catch {
      return false
    }
  }

  function handleConfirmPromotion(piece: 'q' | 'r' | 'b' | 'n') {
    if (!pendingPromotion) return
    const { from, to } = pendingPromotion
    handleMove(from, to, piece)
  }

  function handleCancelPromotion() {
    setPendingPromotion(null)
  }

  function handleResetCurrentProblem() {
    if (!currentProblem || mode === 'review') return
    clearAllTimers()
    const newGame = new Chess(currentProblem.fen)
    gameRef.current = newGame
    setCurrentFen(newGame.fen())
    setPlayedMoves([])
    setMoveIndex(0)
    setIsProblemSolved(false)
    setIsMistake(false)
    setGaveUp(false)
  }

  function finishCurrentProblem(solved: boolean, surrendered: boolean) {
    if (!currentProblem) return
    setIsProblemSolved(true)
    const earnedPoints = surrendered ? 0 : currentProblem.points

    setAnswers(prev => {
      const filtered = prev.filter(a => a.problem_id !== currentProblem.id)
      return [
        ...filtered,
        {
          problem_id: currentProblem.id,
          user_moves: [...playedMoves],
          attempts: wrongAttempts + 1,
          is_correct: solved && !surrendered,
          earned_points: earnedPoints,
        },
      ]
    })
  }

  function handleGiveUp() {
    if (!currentProblem || isProblemSolved) return
    clearAllTimers()
    setGaveUp(true)
    // Play all solution moves on the board
    try {
      const solutionGame = new Chess(currentProblem.fen)
      for (const m of currentProblem.solution_moves) {
        solutionGame.move(normalizeSan(m))
      }
      gameRef.current = solutionGame
      setCurrentFen(solutionGame.fen())
      setPlayedMoves([...currentProblem.solution_moves])
    } catch {
      // ignore
    }
    finishCurrentProblem(false, true)
  }

  function handleNextProblem() {
    if (!assignment) return
    if (currentProblemIndex < assignment.problems.length - 1) {
      setCurrentProblemIndex(prev => prev + 1)
    } else {
      // Finished all problems -> Save & show summary
      handleCompleteAll()
    }
  }

  async function handleCompleteAll() {
    if (!assignment) return
    setSubmitting(true)
    try {
      const totalScore = answers.reduce((sum, a) => sum + a.earned_points, 0)
      const { success, error } = await submitAssignmentAttempt(
        undefined,
        assignment.id,
        userId,
        answers,
        totalScore
      )
      if (error) throw error
      if (success) {
        setMode('summary')
        onCompleted?.()
      }
    } catch (err: any) {
      alert(err.message || 'Lỗi khi nộp bài tập.')
    } finally {
      setSubmitting(false)
    }
  }

  const totalScoreComputed = answers.reduce((sum, a) => sum + (a.earned_points || 0), 0)
  const correctCount = answers.filter(a => a.is_correct).length

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-5"
      style={{ background: 'rgba(0, 0, 0, 0.75)', zIndex: 60 }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card flex flex-col"
        style={{
          width: '100%',
          maxWidth: 980,
          maxHeight: '92vh',
          background: 'var(--surface)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--sh-3)',
          overflow: 'hidden',
        }}
      >
        {/* Top Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-(--border)"
          style={{ background: 'var(--surface-2)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white"
              style={{ background: 'var(--accent)' }}
            >
              <BookOpen size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="pill pill-accent" style={{ fontSize: 10.5 }}>
                  {mode === 'review' ? 'Xem lại bài làm' : 'Làm bài tập thế cờ'}
                </span>
                {assignment && (
                  <span className="text-xs text-(--ink-3)">
                    Hạn nộp: {new Date(assignment.due_date).toLocaleDateString('vi-VN')}
                  </span>
                )}
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
                {assignment?.title || 'Bài tập cờ vua'}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-(--ink-3) py-24">
            <Loader2 className="animate-spin" size={28} />
            <span>Đang chuẩn bị thế cờ bài tập...</span>
          </div>
        ) : !assignment || assignment.problems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-(--ink-3)">
            <AlertCircle size={40} className="mb-2 opacity-60 text-(--warning)" />
            <h3 className="font-semibold text-(--ink-1) mb-1">Bài tập chưa có thế cờ nào</h3>
            <p className="text-xs">Giáo viên đang cập nhật các thế cờ cho bài tập này. Vui lòng quay lại sau nhé!</p>
          </div>
        ) : mode === 'summary' ? (
          /* SUMMARY COMPLETION SCREEN */
          <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
              style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)' }}
            >
              <Award size={44} />
            </div>

            <h3
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 26,
                fontWeight: 700,
                color: 'var(--ink-1)',
                margin: '0 0 8px',
              }}
            >
              Chúc mừng bạn đã hoàn thành bài tập!
            </h3>

            <p className="text-sm text-(--ink-2) max-w-md mb-6 leading-relaxed">
              Bạn đã hoàn thành <strong>{correctCount} / {assignment.problems.length}</strong> thế cờ. Kết quả đã được tự động lưu và gửi đến giáo viên.
            </p>

            <div
              className="card p-5 mb-8 flex items-center gap-6"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}
            >
              <div>
                <span className="text-xs text-(--ink-3) block mb-1">Điểm số đạt được</span>
                <span
                  className="font-bold text-3xl"
                  style={{ color: 'var(--accent)', fontFamily: 'var(--font-serif)' }}
                >
                  {totalScoreComputed}
                  <span className="text-sm text-(--ink-3) font-normal"> / {assignment.max_score} điểm</span>
                </span>
              </div>

              <div style={{ width: 1, height: 40, background: 'var(--border)' }} />

              <div>
                <span className="text-xs text-(--ink-3) block mb-1">Tỷ lệ chính xác</span>
                <span className="font-bold text-2xl text-(--success)">
                  {Math.round((correctCount / assignment.problems.length) * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('review')}
                className="btn btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Eye size={16} />
                <span>Xem lại bài làm & Lời giải</span>
              </button>
              <button type="button" onClick={onClose} className="btn btn-accent">
                Đóng
              </button>
            </div>
          </div>
        ) : (
          /* SOLVER / REVIEW SCREEN */
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left: Interactive Board Area */}
            <div
              className="md:w-1/2 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-(--border)"
              style={{ background: 'var(--surface-2)' }}
            >
              {/* Turn & Status Indicator */}
              <div className="flex items-center justify-between w-full max-w-[340px] mb-3">
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: currentProblem?.player_side === 'white' ? '#fff' : '#000',
                      border: '1px solid var(--border-strong)',
                      display: 'inline-block',
                    }}
                  />
                  <span className="text-xs font-semibold text-(--ink-1)">
                    Lượt: {currentProblem?.player_side === 'white' ? 'Trắng đi' : 'Đen đi'}
                  </span>
                </div>

                {isProblemSolved && !gaveUp ? (
                  <span className="pill pill-success" style={{ fontSize: 11, fontWeight: 600 }}>
                    ✓ Đã giải xong
                  </span>
                ) : gaveUp ? (
                  <span className="pill pill-danger" style={{ fontSize: 11 }}>
                    Đã xem đáp án
                  </span>
                ) : (
                  <span className="text-xs text-(--ink-3)">
                    {wrongAttempts > 0 && `Sai ${wrongAttempts} lần`}
                  </span>
                )}
              </div>

              {/* Chessboard */}
              <div
                className="relative rounded-(--r-md) overflow-hidden shadow-md"
                style={{
                  border: isMistake
                    ? '3px solid var(--danger)'
                    : isProblemSolved
                    ? '3px solid var(--success)'
                    : '1px solid var(--border-strong)',
                  transition: 'border 0.2s ease',
                }}
              >
                {currentProblem && (
                  <ChessgroundView
                    fen={currentFen}
                    orientation={currentProblem.player_side}
                    movable={
                      isProblemSolved || gaveUp || mode === 'review' || !isStudentTurn
                        ? null
                        : currentProblem.player_side
                    }
                    dests={currentDests}
                    onMove={handleMove}
                    size={330}
                  />
                )}

                {/* Opponent Thinking / Moving Indicator */}
                {isOpponentMoving && (
                  <div
                    className="absolute bottom-2 left-2 right-2 px-3 py-1.5 rounded bg-black/80 text-white text-xs flex items-center justify-center gap-2 shadow-lg"
                    style={{ zIndex: 10 }}
                    data-testid="opponent-moving-indicator"
                  >
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                    <span>🤖 Đối thủ đang suy nghĩ và đi nước đáp trả...</span>
                  </div>
                )}

                {/* Pawn Promotion Dialog Overlay */}
                {pendingPromotion && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center p-4"
                    style={{ background: 'rgba(0, 0, 0, 0.85)', zIndex: 30 }}
                    data-testid="solver-promotion-dialog"
                  >
                    <div className="text-white text-xs font-semibold mb-3">
                      Chọn quân phong cấp:
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleConfirmPromotion('q')}
                        className="btn btn-sm"
                        data-testid="solver-promote-queen"
                        style={{ fontSize: 16 }}
                        title="Phong Hậu"
                      >
                        {pendingPromotion.color === 'w' ? '♕' : '♛'} Hậu
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmPromotion('r')}
                        className="btn btn-sm"
                        data-testid="solver-promote-rook"
                        style={{ fontSize: 16 }}
                        title="Phong Xe"
                      >
                        {pendingPromotion.color === 'w' ? '♖' : '♜'} Xe
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmPromotion('b')}
                        className="btn btn-sm"
                        data-testid="solver-promote-bishop"
                        style={{ fontSize: 16 }}
                        title="Phong Tượng"
                      >
                        {pendingPromotion.color === 'w' ? '♗' : '♝'} Tượng
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmPromotion('n')}
                        className="btn btn-sm"
                        data-testid="solver-promote-knight"
                        style={{ fontSize: 16 }}
                        title="Phong Mã"
                      >
                        {pendingPromotion.color === 'w' ? '♘' : '♞'} Mã
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelPromotion}
                      className="btn btn-ghost btn-xs text-white/70 mt-3"
                    >
                      Hủy
                    </button>
                  </div>
                )}
              </div>

              {/* Mistake Alert */}
              {isMistake && (
                <div
                  className="mt-3 text-xs font-semibold flex items-center gap-1.5 animate-pulse"
                  style={{ color: 'var(--danger)' }}
                >
                  <AlertCircle size={15} />
                  <span>Nước đi chưa chính xác, hãy thử lại!</span>
                </div>
              )}
            </div>

            {/* Right: Problem Questions, Teacher Explanation & Actions */}
            <div className="md:w-1/2 p-6 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-5">
                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-(--ink-3) mb-1.5">
                    <span>
                      Thế cờ <strong>{currentProblemIndex + 1}</strong> / {assignment.problems.length}
                    </span>
                    <span>Điểm câu này: <strong>{currentProblem?.points} điểm</strong></span>
                  </div>
                  <div
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div
                      className="h-full transition-all"
                      style={{
                        background: 'var(--accent)',
                        width: `${((currentProblemIndex + 1) / assignment.problems.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Problem Title & Objective */}
                <div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className="pill"
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-ink)',
                        border: '1px solid var(--accent-border)',
                      }}
                    >
                      {getObjectiveById(currentProblem?.objective).badge} Mục tiêu: {getObjectiveById(currentProblem?.objective).label}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 6px' }}>
                    {currentProblem?.title || `Thế cờ #${currentProblemIndex + 1}`}
                  </h3>
                  <p className="text-xs text-(--ink-2) leading-relaxed">
                    {getObjectiveById(currentProblem?.objective).description}
                  </p>
                </div>

                {/* Problem Solved Success & Teacher Explanation Banner */}
                {(isProblemSolved || gaveUp || mode === 'review') && (
                  <div
                    className="p-4 rounded-(--r-md) border animate-fadeIn"
                    style={{
                      background: isProblemSolved && !gaveUp ? 'rgba(34, 197, 94, 0.08)' : 'var(--surface-2)',
                      borderColor: isProblemSolved && !gaveUp ? 'rgba(34, 197, 94, 0.3)' : 'var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {isProblemSolved && !gaveUp ? (
                        <CheckCircle2 size={18} className="text-(--success)" />
                      ) : (
                        <Eye size={18} className="text-(--warning)" />
                      )}
                      <span className="font-semibold text-sm text-(--ink-1)">
                        {isProblemSolved && !gaveUp ? 'Chính xác! 🎉' : 'Đáp án của thế cờ'}
                      </span>
                    </div>

                    <div className="text-xs text-(--ink-2) mb-2">
                      <span className="text-(--ink-3)">Nước đi đúng: </span>
                      <strong className="font-mono text-(--ink-1)">
                        {currentProblem?.solution_moves.join(' ')}
                      </strong>
                    </div>

                    {/* LỜI GIẢI THÍCH TỪ GIÁO VIÊN */}
                    {currentProblem?.explanation ? (
                      <div
                        className="p-3 rounded-(--r-sm) mt-2"
                        style={{
                          background: 'var(--surface)',
                          borderLeft: '3px solid var(--accent)',
                        }}
                      >
                        <span className="font-semibold text-xs text-(--accent) block mb-1">
                          Phân tích & Lời giải thích từ Thầy/Cô:
                        </span>
                        <p className="text-xs text-(--ink-1) m-0 leading-relaxed">
                          {currentProblem.explanation}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-(--ink-3) italic m-0">
                        Giáo viên chưa để lại phân tích văn bản cho thế cờ này.
                      </p>
                    )}
                  </div>
                )}

                {/* Teacher's Hint */}
                {showHint && currentProblem?.hint && (
                  <div
                    className="p-3 rounded-(--r-md) border text-xs"
                    style={{ background: 'rgba(234, 179, 8, 0.08)', borderColor: 'rgba(234, 179, 8, 0.3)' }}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-(--warning) mb-1">
                      <HelpCircle size={14} />
                      <span>Gợi ý từ giáo viên:</span>
                    </div>
                    <span className="text-(--ink-1)">{currentProblem.hint}</span>
                  </div>
                )}

                {/* Teacher's Global Feedback (In Review Mode) */}
                {mode === 'review' && submission?.teacher_feedback && (
                  <div
                    className="p-3 rounded-(--r-md) border"
                    style={{ background: 'rgba(56, 189, 248, 0.08)', borderColor: 'rgba(56, 189, 248, 0.3)' }}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-(--accent) mb-1">
                      <MessageSquare size={14} />
                      <span>Nhận xét chung của giáo viên cho bài tập này:</span>
                    </div>
                    <p className="text-xs text-(--ink-1) m-0 leading-relaxed">
                      {submission.teacher_feedback}
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="pt-6 border-t border-(--border) flex items-center justify-between gap-3">
                {mode === 'review' ? (
                  /* Review navigation */
                  <>
                    <button
                      type="button"
                      disabled={currentProblemIndex === 0}
                      onClick={() => setCurrentProblemIndex(prev => Math.max(0, prev - 1))}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <ChevronLeft size={16} />
                      <span>Câu trước</span>
                    </button>

                    <span className="text-xs text-(--ink-3)">
                      {currentProblemIndex + 1} / {assignment.problems.length}
                    </span>

                    <button
                      type="button"
                      disabled={currentProblemIndex === assignment.problems.length - 1}
                      onClick={() =>
                        setCurrentProblemIndex(prev => Math.min(assignment.problems.length - 1, prev + 1))
                      }
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>Câu kế</span>
                      <ChevronRight size={16} />
                    </button>
                  </>
                ) : (
                  /* Solve actions */
                  <>
                    <div className="flex items-center gap-2">
                      {!isProblemSolved && !gaveUp && (
                        <>
                          {playedMoves.length > 0 && (
                            <button
                              type="button"
                              onClick={handleResetCurrentProblem}
                              className="btn btn-ghost btn-sm text-xs"
                              title="Chơi lại từ đầu thế cờ này"
                              data-testid="retry-problem-btn"
                            >
                              <RotateCcw size={14} />
                              <span>Làm lại</span>
                            </button>
                          )}
                          {currentProblem?.hint && (
                            <button
                              type="button"
                              onClick={() => setShowHint(prev => !prev)}
                              className="btn btn-ghost btn-sm text-xs"
                            >
                              <HelpCircle size={14} />
                              <span>{showHint ? 'Ẩn gợi ý' : 'Xem gợi ý'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleGiveUp}
                            className="btn btn-ghost btn-sm text-xs text-(--ink-3) hover:text-(--danger)"
                          >
                            <span>Xem đáp án (0 đ)</span>
                          </button>
                        </>
                      )}
                    </div>

                    <div>
                      {isProblemSolved || gaveUp ? (
                        <button
                          type="button"
                          data-testid="next-problem-btn"
                          onClick={handleNextProblem}
                          disabled={submitting}
                          className="btn btn-accent btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          {submitting ? (
                            <span>Đang nộp...</span>
                          ) : currentProblemIndex < assignment.problems.length - 1 ? (
                            <>
                              <span>Thế cờ tiếp theo</span>
                              <ArrowRight size={15} />
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={15} />
                              <span>Hoàn thành bài tập</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-(--ink-3) italic">
                          Hãy đi nước cờ đúng để tiếp tục...
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
