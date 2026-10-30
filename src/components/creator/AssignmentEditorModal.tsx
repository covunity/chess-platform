import { useState, useMemo } from 'react'
import { Chess } from 'chess.js'
import {
  X,
  Plus,
  Trash2,
  RotateCcw,
  Undo2,
  Redo2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Target,
  Sparkles,
} from 'lucide-react'
import ChessgroundView from '../ChessBoard/ChessgroundView'
import BoardSetupSurface, { validateBoardPieces } from './BoardSetupSurface'
import {
  CHESS_OBJECTIVES,
  getObjectiveById,
  validateAssignmentProblemChain,
  type AssignmentProblem,
  type AssignmentWithProblems,
} from '../../lib/assignmentApi'

export interface AssignmentEditorModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (
    assignmentData: {
      title: string
      description: string | null
      due_date: string
      max_score: number
    },
    problems: Omit<AssignmentProblem, 'id' | 'assignment_id'>[]
  ) => Promise<void>
  initialAssignment?: AssignmentWithProblems | null
}

const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

interface DraftProblem {
  id?: string
  title: string
  fen: string
  player_side: 'white' | 'black'
  objective: string
  solution_moves: string[]
  explanation: string
  hint: string
  points: number
}

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

export default function AssignmentEditorModal({
  isOpen,
  onClose,
  onSave,
  initialAssignment,
}: AssignmentEditorModalProps) {
  // Assignment metadata
  const [title, setTitle] = useState(initialAssignment?.title || '')
  const [description, setDescription] = useState(initialAssignment?.description || '')
  const [dueDate, setDueDate] = useState(
    initialAssignment?.due_date
      ? new Date(initialAssignment.due_date).toISOString().slice(0, 16)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
  )
  const [maxScore, setMaxScore] = useState(initialAssignment?.max_score || 10)

  // Problems state
  const [problems, setProblems] = useState<DraftProblem[]>(() => {
    if (initialAssignment?.problems && initialAssignment.problems.length > 0) {
      return initialAssignment.problems.map(p => ({
        id: p.id,
        title: p.title,
        fen: p.fen,
        player_side: p.player_side,
        objective: p.objective || 'best_move',
        solution_moves: [...p.solution_moves],
        explanation: p.explanation || '',
        hint: p.hint || '',
        points: p.points || 2,
      }))
    }
    return [
      {
        title: 'Trắng đi - Tìm nước cờ mạnh nhất',
        fen: DEFAULT_FEN,
        player_side: 'white',
        objective: 'best_move',
        solution_moves: [],
        explanation: '',
        hint: '',
        points: 5,
      },
    ]
  })

  const [activeProblemIndex, setActiveProblemIndex] = useState(0)
  // Each problem has 2 stages: 'setup' (Xếp cờ kéo thả) and 'solution' (Đi nước cờ đáp án)
  const [problemStage, setProblemStage] = useState<'setup' | 'solution'>('setup')
  const [saving, setSaving] = useState(false)
  const [redoMoves, setRedoMoves] = useState<string[]>([])
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string
    to: string
    color: 'w' | 'b'
  } | null>(null)

  const activeProblem = problems[activeProblemIndex] || problems[0]

  // Replay board state based on starting FEN + solution moves (for stage 'solution')
  const currentSolutionBoardState = useMemo(() => {
    if (!activeProblem) {
      return {
        fen: DEFAULT_FEN,
        dests: new Map<string, string[]>(),
        turn: 'white' as const,
        isCheckmate: false,
        isGameOver: false,
      }
    }
    try {
      const game = new Chess(activeProblem.fen)
      for (const san of activeProblem.solution_moves) {
        game.move(san)
      }
      const turnColor: 'white' | 'black' = game.turn() === 'w' ? 'white' : 'black'
      const isTerminal = game.isCheckmate() || game.isStalemate() || game.moves().length === 0
      return {
        fen: game.fen(),
        dests: isTerminal ? new Map<string, string[]>() : computeDests(game.fen()),
        turn: turnColor,
        isCheckmate: game.isCheckmate(),
        isStalemate: game.isStalemate(),
        isTerminal,
      }
    } catch {
      return {
        fen: activeProblem.fen,
        dests: computeDests(activeProblem.fen),
        turn: activeProblem.player_side,
        isCheckmate: false,
        isStalemate: false,
        isTerminal: false,
      }
    }
  }, [activeProblem?.fen, activeProblem?.solution_moves, activeProblem?.player_side])

  if (!isOpen) return null

  // Problem management helpers
  function updateActiveProblem(fields: Partial<DraftProblem>) {
    setProblems(prev =>
      prev.map((p, idx) => (idx === activeProblemIndex ? { ...p, ...fields } : p))
    )
  }

  function handleAddProblem() {
    const newIdx = problems.length + 1
    const newProblem: DraftProblem = {
      title: `Thế cờ #${newIdx}: Tìm đòn chiến thuật`,
      fen: DEFAULT_FEN,
      player_side: 'white',
      objective: 'best_move',
      solution_moves: [],
      explanation: '',
      hint: '',
      points: 2,
    }
    setProblems(prev => [...prev, newProblem])
    setActiveProblemIndex(problems.length)
    setRedoMoves([])
    setPendingPromotion(null)
    setProblemStage('setup')
  }

  function handleDeleteProblem(indexToDelete: number) {
    if (problems.length <= 1) {
      alert('Bài tập cần có ít nhất 1 thế cờ.')
      return
    }
    setProblems(prev => prev.filter((_, idx) => idx !== indexToDelete))
    if (activeProblemIndex >= problems.length - 1) {
      setActiveProblemIndex(Math.max(0, problems.length - 2))
    }
    setRedoMoves([])
    setPendingPromotion(null)
    setProblemStage('setup')
  }

  // Objective change handler
  function handleObjectiveChange(newObjId: string) {
    const objDef = getObjectiveById(newObjId)
    const suggestedTitle = objDef.defaultTitle(activeProblem.player_side)
    updateActiveProblem({
      objective: newObjId,
      // Auto-update title if it was default or empty
      title: suggestedTitle,
    })
  }

  // Board setup updates
  function handleBoardSetupChange(fen: string, playerSide: 'white' | 'black') {
    if (!activeProblem) return
    if (activeProblem.fen === fen && activeProblem.player_side === playerSide) {
      return
    }
    setRedoMoves([])
    setPendingPromotion(null)
    updateActiveProblem({
      fen,
      player_side: playerSide,
      // Reset solution moves if FEN changed
      solution_moves: [],
    })
  }

  // Move recording in 'solution' stage
  function handleBoardMove(
    from: string,
    to: string,
    promotionPiece: 'q' | 'r' | 'b' | 'n' = 'q'
  ): boolean {
    if (!activeProblem) return false
    try {
      const game = new Chess(activeProblem.fen)
      for (const san of activeProblem.solution_moves) {
        game.move(san)
      }

      if (game.isCheckmate() || game.isStalemate() || game.moves().length === 0) return false

      // Check if move is a pawn promotion
      const promoInfo = checkIsPromotionMove(game.fen(), from, to)
      if (promoInfo.isPromo && !pendingPromotion) {
        setPendingPromotion({ from, to, color: promoInfo.color })
        return true
      }

      const move = game.move({ from, to, promotion: promotionPiece })
      if (!move) return false

      const updatedMoves = [...activeProblem.solution_moves, move.san]
      updateActiveProblem({ solution_moves: updatedMoves })
      setRedoMoves([])
      setPendingPromotion(null)
      return true
    } catch {
      return false
    }
  }

  function handleConfirmPromotion(piece: 'q' | 'r' | 'b' | 'n') {
    if (!pendingPromotion) return
    const { from, to } = pendingPromotion
    handleBoardMove(from, to, piece)
  }

  function handleCancelPromotion() {
    setPendingPromotion(null)
  }

  function handleResetMoves() {
    setRedoMoves([])
    setPendingPromotion(null)
    updateActiveProblem({ solution_moves: [] })
  }

  function handleUndoMove() {
    if (!activeProblem || activeProblem.solution_moves.length === 0) return
    setPendingPromotion(null)
    const lastMove = activeProblem.solution_moves[activeProblem.solution_moves.length - 1]
    setRedoMoves(prev => [lastMove, ...prev])
    updateActiveProblem({ solution_moves: activeProblem.solution_moves.slice(0, -1) })
  }

  function handleRedoMove() {
    if (redoMoves.length === 0) return
    setPendingPromotion(null)
    const nextMove = redoMoves[0]
    setRedoMoves(prev => prev.slice(1))
    updateActiveProblem({ solution_moves: [...activeProblem.solution_moves, nextMove] })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      alert('Vui lòng nhập tiêu đề bài tập.')
      return
    }

    // Validate that problems have valid chess solution sequences
    for (let i = 0; i < problems.length; i++) {
      const validation = validateAssignmentProblemChain(problems[i])
      if (!validation.isValid) {
        alert(
          `Thế cờ #${i + 1} (${problems[i].title}): ${validation.error}`
        )
        setActiveProblemIndex(i)
        setProblemStage('solution')
        return
      }
    }

    setSaving(true)
    try {
      await onSave(
        {
          title: title.trim(),
          description: description.trim() || null,
          due_date: new Date(dueDate).toISOString(),
          max_score: Number(maxScore) || 10,
        },
        problems.map((p, idx) => ({
          order_index: idx,
          title: p.title.trim() || `Thế cờ #${idx + 1}`,
          fen: p.fen,
          player_side: p.player_side,
          objective: p.objective || 'best_move',
          solution_moves: p.solution_moves,
          explanation: p.explanation.trim(),
          hint: p.hint.trim(),
          points: Number(p.points) || 1,
        }))
      )
      onClose()
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu bài tập.')
    } finally {
      setSaving(false)
    }
  }

  const selectedObjective = getObjectiveById(activeProblem?.objective)

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-5"
      style={{ background: 'rgba(0, 0, 0, 0.7)', zIndex: 60 }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card flex flex-col"
        style={{
          width: '100%',
          maxWidth: 1080,
          maxHeight: '94vh',
          background: 'var(--surface)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--sh-3)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-(--border)"
          style={{ background: 'var(--surface-2)' }}
        >
          <div className="flex items-center gap-2.5">
            <BookOpen size={20} className="text-(--accent)" />
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
                {initialAssignment ? 'Chỉnh sửa bài tập' : 'Giao bài tập thế cờ mới'}
              </h2>
              <span className="text-xs text-(--ink-3)">
                Xếp thế cờ kéo thả, chọn mục tiêu và tạo chuỗi nước đi đáp án cho học viên.
              </span>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Metadata section */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="label">
                  Tiêu đề bài tập <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  data-testid="assignment-title-input"
                  className="input w-full"
                  placeholder="Ví dụ: Bài tập chiến thuật tuần 3: Đòn chĩa đôi và ghim quân"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">
                  Hạn nộp <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="datetime-local"
                  data-testid="assignment-due-date-input"
                  className="input w-full"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Thang điểm tổng</label>
                <input
                  type="number"
                  data-testid="assignment-max-score-input"
                  className="input w-full"
                  min={1}
                  max={100}
                  value={maxScore}
                  onChange={e => setMaxScore(Number(e.target.value))}
                />
              </div>

              <div className="md:col-span-4">
                <label className="label">Mô tả / Hướng dẫn của giáo viên (Tùy chọn)</label>
                <input
                  type="text"
                  data-testid="assignment-description-input"
                  className="input w-full text-xs"
                  placeholder="Ví dụ: Đọc kỹ mục tiêu của từng câu hỏi và tìm nước cờ tốt nhất."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
            </div>

            <hr style={{ borderColor: 'var(--border)' }} />

            {/* Chess Problems Builder */}
            <div>
              {/* Problem Tabs Navigation */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-(--ink-1)" style={{ fontSize: 16 }}>
                    Danh sách thế cờ ({problems.length})
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="add-problem-btn"
                  onClick={handleAddProblem}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Plus size={15} />
                  <span>Thêm thế cờ</span>
                </button>
              </div>

              {/* Problem Tabs */}
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1" role="tablist">
                {problems.map((prob, idx) => {
                  const isActive = idx === activeProblemIndex
                  const hasMoves = prob.solution_moves.length > 0
                  const probObj = getObjectiveById(prob.objective)

                  return (
                    <div
                      key={idx}
                      className="flex items-center rounded-(--r-md) border transition-all"
                      style={{
                        borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                        background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                        color: isActive ? 'var(--accent-ink)' : 'var(--ink-2)',
                      }}
                    >
                      <button
                        type="button"
                        data-testid={`problem-tab-${idx}`}
                        onClick={() => {
                          setActiveProblemIndex(idx)
                        }}
                        className="px-3 py-1.5 text-xs font-medium flex items-center gap-2 cursor-pointer"
                        style={{ border: 'none', background: 'transparent', color: 'inherit' }}
                      >
                        <span>{probObj.badge}</span>
                        <span>Câu {idx + 1}</span>
                        {hasMoves ? (
                          <span title="Đã có đáp án" style={{ color: 'var(--success)' }}>✓</span>
                        ) : (
                          <span title="Chưa có đáp án" style={{ color: 'var(--warning)' }}>!</span>
                        )}
                      </button>
                      {problems.length > 1 && (
                        <button
                          type="button"
                          title="Xóa thế cờ này"
                          onClick={() => handleDeleteProblem(idx)}
                          className="px-1.5 py-1 text-xs text-(--ink-3) hover:text-(--danger) cursor-pointer"
                          style={{ border: 'none', background: 'transparent' }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Active Problem Multi-stage Editor */}
              {activeProblem && (
                <div
                  className="p-5 rounded-(--r-lg) border border-(--border)"
                  style={{ background: 'var(--surface-2)' }}
                >
                  {/* Problem Top Configuration (Objective & Stage Tabs) */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-(--border)">
                    {/* Objective Picker */}
                    <div className="flex-1 max-w-md">
                      <label className="label flex items-center gap-1.5" style={{ margin: '0 0 4px' }}>
                        <Target size={14} className="text-(--accent)" />
                        <span>Mục tiêu thế cờ (Objective)</span>
                      </label>
                      <select
                        value={activeProblem.objective}
                        onChange={e => handleObjectiveChange(e.target.value)}
                        className="input w-full text-xs font-semibold"
                        style={{ background: 'var(--surface)' }}
                      >
                        <optgroup label="👑 Chiếu bí (Checkmate)">
                          <option value="mate_in_1">👑 Chiếu bí trong 1 nước</option>
                          <option value="mate_in_2">👑 Chiếu bí trong 2 nước</option>
                          <option value="mate_in_3">👑 Chiếu bí trong 3+ nước</option>
                        </optgroup>
                        <optgroup label="⚔️ Bắt quân & Đòn chiến thuật (Tactics)">
                          <option value="capture_queen">👸 Bắt Hậu đối phương</option>
                          <option value="capture_piece">⚔️ Bắt quân hơn chất (Xe, Tượng, Mã)</option>
                          <option value="fork">🔱 Đòn chĩa đôi (Fork)</option>
                          <option value="pin">📌 Đòn ghim quân (Pin)</option>
                          <option value="skewer">🗡️ Đòn xiên (Skewer)</option>
                          <option value="discovered_attack">⚡ Đòn tấn công mở / Chiếu mở</option>
                        </optgroup>
                        <optgroup label="🎯 Nước cờ tối ưu (Best Move)">
                          <option value="best_move">🎯 Tìm nước cờ tối ưu nhất</option>
                        </optgroup>
                        <optgroup label="🏁 Phong cấp & Tàn cuộc (Endgame)">
                          <option value="promotion">♟️ Phong cấp tốt an toàn</option>
                          <option value="endgame_technique">🏁 Kỹ thuật tàn cuộc</option>
                        </optgroup>
                        <optgroup label="🛡️ Phòng thủ & Thoát hiểm (Defense)">
                          <option value="escape_check">🛡️ Thoát hiểm & Phòng thủ</option>
                          <option value="stalemate_draw">🤝 Cầu hòa / Bẫy pat (Stalemate)</option>
                        </optgroup>
                      </select>
                      <span className="text-[11px] text-(--ink-3) mt-1 block">
                        {selectedObjective.description}
                      </span>
                    </div>

                    {/* Step Switcher Tabs (Bước 1: Xếp cờ | Bước 2: Đi nước cờ đáp án) */}
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      <div className="inline-flex rounded-(--r-md) border border-(--border) p-1 bg-(--surface)">
                        <button
                          type="button"
                          onClick={() => setProblemStage('setup')}
                          className="px-3 py-1.5 text-xs font-semibold rounded-(--r-sm) transition-all flex items-center gap-1.5"
                          style={{
                            background: problemStage === 'setup' ? 'var(--accent)' : 'transparent',
                            color: problemStage === 'setup' ? '#fff' : 'var(--ink-2)',
                          }}
                        >
                          <span>1. 🧩 Xếp thế cờ</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setProblemStage('solution')}
                          className="px-3 py-1.5 text-xs font-semibold rounded-(--r-sm) transition-all flex items-center gap-1.5"
                          style={{
                            background: problemStage === 'solution' ? 'var(--accent)' : 'transparent',
                            color: problemStage === 'solution' ? '#fff' : 'var(--ink-2)',
                          }}
                        >
                          <span>2. 🎯 Nước đi đáp án</span>
                          {activeProblem.solution_moves.length > 0 && (
                            <span style={{ fontSize: 10 }}>({activeProblem.solution_moves.length})</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* STAGE 1: BÀN CỜ XẾP QUÂN KÉO THẢ (Board Setup Surface) */}
                  {problemStage === 'setup' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-(--ink-1) uppercase tracking-wider">
                          Bước 1: Bắt đầu từ bàn cờ trống & sắp xếp quân cờ
                        </span>
                        <button
                          type="button"
                          onClick={() => setProblemStage('solution')}
                          className="btn btn-accent btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <span>Tiếp tục: Đi nước cờ đáp án</span>
                          <ArrowRight size={14} />
                        </button>
                      </div>

                      {/* Interactive Drag & Drop Board Setup Surface */}
                      <BoardSetupSurface
                        initialFen={activeProblem.fen}
                        initialPlayerSide={activeProblem.player_side}
                        onChange={handleBoardSetupChange}
                      />
                    </div>
                  )}

                  {/* STAGE 2: GHI NHẬN NƯỚC ĐI ĐÁP ÁN & LỜI GIẢI THÍCH */}
                  {problemStage === 'solution' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      {/* Left: Interactive Board to play solution moves */}
                      <div className="lg:col-span-5 flex flex-col items-center">
                        <div
                          className="card p-2 flex flex-col items-center relative"
                          style={{ background: 'var(--surface)', borderRadius: 'var(--r-md)' }}
                        >
                          <ChessgroundView
                            fen={currentSolutionBoardState.fen}
                            orientation={activeProblem.player_side}
                            movable={
                              currentSolutionBoardState.isTerminal
                                ? undefined
                                : currentSolutionBoardState.turn
                            }
                            dests={currentSolutionBoardState.dests}
                            onMove={handleBoardMove}
                            size={320}
                          />

                          {/* Promotion Choice Dialog Overlay */}
                          {pendingPromotion && (
                            <div
                              className="absolute inset-0 flex flex-col items-center justify-center rounded-(--r-md) p-4"
                              style={{
                                background: 'rgba(0, 0, 0, 0.85)',
                                zIndex: 20,
                              }}
                              data-testid="promotion-dialog"
                            >
                              <div className="text-white text-xs font-semibold mb-3">
                                Chọn quân phong cấp:
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPromotion('q')}
                                  className="btn btn-sm"
                                  data-testid="promote-queen-btn"
                                  style={{ fontSize: 16 }}
                                  title="Phong Hậu"
                                >
                                  {pendingPromotion.color === 'w' ? '♕' : '♛'} Hậu
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPromotion('r')}
                                  className="btn btn-sm"
                                  data-testid="promote-rook-btn"
                                  style={{ fontSize: 16 }}
                                  title="Phong Xe"
                                >
                                  {pendingPromotion.color === 'w' ? '♖' : '♜'} Xe
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPromotion('b')}
                                  className="btn btn-sm"
                                  data-testid="promote-bishop-btn"
                                  style={{ fontSize: 16 }}
                                  title="Phong Tượng"
                                >
                                  {pendingPromotion.color === 'w' ? '♗' : '♝'} Tượng
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPromotion('n')}
                                  className="btn btn-sm"
                                  data-testid="promote-knight-btn"
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

                        {/* Interactive Board Control Toolbar */}
                        <div className="flex items-center gap-2 mt-3 w-full justify-between max-w-[320px]">
                          <div className="text-xs text-(--ink-2) flex items-center gap-1.5">
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                background:
                                  currentSolutionBoardState.turn === 'white' ? '#fff' : '#000',
                                border: '1px solid var(--border-strong)',
                                display: 'inline-block',
                              }}
                            />
                            <span>
                              Lượt:{' '}
                              <strong>
                                {currentSolutionBoardState.turn === 'white'
                                  ? 'Trắng đi'
                                  : 'Đen đi'}{' '}
                                {activeProblem.solution_moves.length % 2 === 0
                                  ? '(Học sinh)'
                                  : '(Đối thủ máy)'}
                              </strong>
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={handleUndoMove}
                              disabled={activeProblem.solution_moves.length === 0}
                              className="btn btn-ghost btn-sm"
                              title="Hoàn tác 1 nước"
                              data-testid="undo-move-btn"
                            >
                              <Undo2 size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={handleRedoMove}
                              disabled={redoMoves.length === 0}
                              className="btn btn-ghost btn-sm"
                              title="Đi lại nước vừa hoàn tác (Redo)"
                              data-testid="redo-move-btn"
                            >
                              <Redo2 size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={handleResetMoves}
                              disabled={activeProblem.solution_moves.length === 0}
                              className="btn btn-ghost btn-sm"
                              title="Làm lại từ đầu"
                              data-testid="reset-moves-btn"
                            >
                              <RotateCcw size={14} />
                              <span>Làm lại</span>
                            </button>
                          </div>
                        </div>

                        {/* Dynamic Step Instruction Banner */}
                        <div
                          className="mt-3 p-2.5 rounded-(--r-md) text-xs w-full max-w-[320px] flex items-center gap-2"
                          style={{
                            background: currentSolutionBoardState.isCheckmate
                              ? 'rgba(34, 197, 94, 0.12)'
                              : activeProblem.solution_moves.length % 2 === 0
                              ? 'rgba(59, 130, 246, 0.12)'
                              : 'rgba(234, 179, 8, 0.12)',
                            border: `1px solid ${
                              currentSolutionBoardState.isCheckmate
                                ? 'var(--success)'
                                : activeProblem.solution_moves.length % 2 === 0
                                ? 'var(--accent)'
                                : 'var(--warning)'
                            }`,
                          }}
                        >
                          {currentSolutionBoardState.isCheckmate ? (
                            <>
                              <CheckCircle2 size={14} className="text-(--success) shrink-0" />
                              <span className="text-(--success) font-medium">
                                👑 Đã chiếu bí! Chuỗi đáp án đã hoàn tất.
                              </span>
                            </>
                          ) : currentSolutionBoardState.isStalemate ? (
                            <>
                              <AlertCircle size={14} className="text-(--warning) shrink-0" />
                              <span className="text-(--warning) font-medium">
                                Hòa cờ (Pat / Không còn nước đi hợp lệ). Chuỗi đáp án đã kết thúc.
                              </span>
                            </>
                          ) : activeProblem.solution_moves.length % 2 === 0 ? (
                            <>
                              <span className="text-base shrink-0">🧑‍🎓</span>
                              <span className="text-(--ink-1)">
                                Hãy đi nước của bên{' '}
                                <strong>
                                  {activeProblem.player_side === 'white' ? 'Trắng' : 'Đen'}
                                </strong>{' '}
                                (Nước học sinh cần giải)
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-base shrink-0">🤖</span>
                              <span className="text-(--ink-1)">
                                Hãy đi nước đáp trả tốt nhất của bên{' '}
                                <strong>
                                  {activeProblem.player_side === 'white' ? 'Đen' : 'Trắng'}
                                </strong>{' '}
                                (Đối thủ máy)
                              </span>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setProblemStage('setup')}
                          className="mt-3 text-xs text-(--accent) hover:underline flex items-center gap-1"
                        >
                          <ArrowLeft size={12} />
                          <span>Quay lại sửa vị trí quân cờ (Bước 1)</span>
                        </button>
                      </div>

                      {/* Right: Recorded Moves, Explanation, Points & Hint */}
                      <div className="lg:col-span-7 flex flex-col gap-4">
                        {/* Title & Points */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="sm:col-span-2">
                            <label className="label">Tiêu đề câu hỏi thế cờ</label>
                            <input
                              type="text"
                              data-testid="problem-title-input"
                              className="input w-full"
                              value={activeProblem.title}
                              onChange={e => updateActiveProblem({ title: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="label">Điểm câu này</label>
                            <input
                              type="number"
                              data-testid="problem-points-input"
                              className="input w-full"
                              min={1}
                              max={50}
                              value={activeProblem.points}
                              onChange={e =>
                                updateActiveProblem({ points: Number(e.target.value) })
                              }
                            />
                          </div>
                        </div>

                        {/* Recorded Moves Banner */}
                        <div
                          className="p-3.5 rounded-(--r-md) border border-(--border)"
                          style={{ background: 'var(--surface)' }}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-(--ink-1) uppercase tracking-wider">
                              Nước đi đáp án:
                            </span>
                            <span className="text-xs text-(--ink-3)">
                              (Đi trực tiếp trên bàn cờ bên trái)
                            </span>
                          </div>

                          {activeProblem.solution_moves.length === 0 ? (
                            <div className="p-3 text-center rounded-(--r-sm) bg-(--surface-2) text-xs text-(--ink-3)">
                              Chưa có nước đi nào. Hãy kéo quân cờ trên bàn cờ bên trái để tạo đáp án!
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2 items-center">
                              {activeProblem.solution_moves.map((move, mIdx) => {
                                const isStudent = mIdx % 2 === 0
                                return (
                                  <span
                                    key={mIdx}
                                    className="pill"
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      background: isStudent ? 'var(--surface-2)' : 'var(--surface)',
                                      color: 'var(--ink-1)',
                                      border: isStudent
                                        ? '1px solid var(--accent)'
                                        : '1px dashed var(--border-strong)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color: isStudent ? 'var(--accent)' : 'var(--ink-3)',
                                        fontSize: 11,
                                      }}
                                    >
                                      {mIdx + 1}. {isStudent ? '🧑‍🎓' : '🤖'}
                                    </span>
                                    <span>{move}</span>
                                  </span>
                                )
                              })}
                              {currentSolutionBoardState.isCheckmate && (
                                <span className="pill pill-success" style={{ fontSize: 11 }}>
                                  # Chiếu bí
                                </span>
                              )}
                            </div>
                          )}

                          {/* Warning if sequence ends on opponent move */}
                          {activeProblem.solution_moves.length > 0 &&
                            activeProblem.solution_moves.length % 2 === 0 && (
                              <div
                                className="mt-2.5 p-2 rounded-(--r-sm) text-xs flex items-center gap-1.5"
                                style={{
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  color: 'var(--danger)',
                                  border: '1px solid rgba(239, 68, 68, 0.25)',
                                }}
                              >
                                <AlertCircle size={14} className="shrink-0" />
                                <span>
                                  Chuỗi đáp án đang kết thúc ở nước đáp trả của đối thủ. Hãy đi tiếp
                                  nước dứt điểm của học sinh (tổng số nước phải là số lẻ: 1, 3, 5...).
                                </span>
                              </div>
                            )}
                        </div>

                        {/* Explanation / Lời giải thích */}
                        <div>
                          <label className="label">
                            Lời giải thích & Phân tích đáp án (Học sinh đọc sau khi giải)
                          </label>
                          <textarea
                            data-testid="problem-explanation-input"
                            className="input w-full text-sm"
                            rows={3}
                            value={activeProblem.explanation}
                            onChange={e => updateActiveProblem({ explanation: e.target.value })}
                            placeholder="Giải thích tại sao nước cờ trên là tối ưu, phân tích ý đồ chiến thuật (ví dụ: 'Thí Xe mở cột cho Hậu chiếu bí')..."
                          />
                        </div>

                        {/* Hint / Gợi ý */}
                        <div>
                          <label className="label">Gợi ý cho học sinh (Tùy chọn)</label>
                          <input
                            type="text"
                            data-testid="problem-hint-input"
                            className="input w-full text-xs"
                            value={activeProblem.hint}
                            onChange={e => updateActiveProblem({ hint: e.target.value })}
                            placeholder="Ví dụ: Chú ý quân Xe đang kiểm soát hàng cuối..."
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div
            className="flex items-center justify-between px-6 py-4 border-t border-(--border)"
            style={{ background: 'var(--surface)' }}
          >
            <div className="text-xs text-(--ink-3)">
              Tổng số thế cờ: <strong>{problems.length}</strong> • Tổng điểm:{' '}
              <strong>{problems.reduce((sum, p) => sum + (Number(p.points) || 0), 0)}</strong>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost"
                disabled={saving}
              >
                Hủy
              </button>
              <button
                type="submit"
                data-testid="save-assignment-btn"
                className="btn btn-accent"
                disabled={saving}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {saving ? (
                  <span>Đang lưu...</span>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Lưu & Giao bài tập</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
