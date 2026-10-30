import { useState, useEffect } from 'react'
import {
  X,
  User,
  Clock,
  Award,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MessageSquare,
  Save,
  Loader2,
} from 'lucide-react'
import ChessgroundView from '../ChessBoard/ChessgroundView'
import {
  listAssignmentSubmissions,
  gradeAssignmentSubmission,
  getObjectiveById,
  type AssignmentWithProblems,
  type AssignmentSubmissionDetail,
} from '../../lib/assignmentApi'

export interface AssignmentSubmissionsModalProps {
  isOpen: boolean
  onClose: () => void
  assignment: AssignmentWithProblems
}

export default function AssignmentSubmissionsModal({
  isOpen,
  onClose,
  assignment,
}: AssignmentSubmissionsModalProps) {
  const [submissions, setSubmissions] = useState<AssignmentSubmissionDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null)

  // Grading form state
  const [scoreInput, setScoreInput] = useState<number>(0)
  const [feedbackInput, setFeedbackInput] = useState<string>('')
  const [gradingLoading, setGradingLoading] = useState(false)
  const [gradeSuccessMsg, setGradeSuccessMsg] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    listAssignmentSubmissions(undefined, assignment.id)
      .then(({ submissions: data, error }) => {
        if (!error && data) {
          setSubmissions(data)
          if (data.length > 0) {
            setSelectedSubId(data[0].id)
            setScoreInput(data[0].score ?? 0)
            setFeedbackInput(data[0].teacher_feedback || '')
          }
        }
      })
      .finally(() => setLoading(false))
  }, [isOpen, assignment.id])

  const selectedSub = submissions.find(s => s.id === selectedSubId)

  // When selected student changes, update grading inputs
  function handleSelectStudent(sub: AssignmentSubmissionDetail) {
    setSelectedSubId(sub.id)
    setScoreInput(sub.score ?? 0)
    setFeedbackInput(sub.teacher_feedback || '')
    setGradeSuccessMsg(false)
  }

  async function handleSaveGrade(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSub) return
    setGradingLoading(true)
    try {
      const { success, error } = await gradeAssignmentSubmission(
        undefined,
        selectedSub.id,
        scoreInput,
        feedbackInput.trim()
      )
      if (error) throw error

      if (success) {
        setSubmissions(prev =>
          prev.map(s =>
            s.id === selectedSub.id
              ? {
                  ...s,
                  score: scoreInput,
                  teacher_feedback: feedbackInput.trim() || null,
                  status: 'graded',
                  graded_at: new Date().toISOString(),
                }
              : s
          )
        )
        setGradeSuccessMsg(true)
        setTimeout(() => setGradeSuccessMsg(false), 3000)
      }
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu điểm.')
    } finally {
      setGradingLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.65)', zIndex: 60 }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card flex flex-col"
        style={{
          width: '100%',
          maxWidth: 1040,
          height: '88vh',
          background: 'var(--surface)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-3)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-(--border)"
          style={{ background: 'var(--surface-2)' }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="pill pill-accent" style={{ fontSize: 11 }}>
                Chấm điểm bài tập
              </span>
              <span className="text-xs text-(--ink-3)">
                Thang điểm tối đa: {assignment.max_score} điểm
              </span>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              {assignment.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-(--ink-3)">
            <Loader2 className="animate-spin" size={24} />
            <span>Đang tải danh sách bài nộp...</span>
          </div>
        ) : submissions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-(--ink-3)">
            <Award size={44} className="mb-3 opacity-40" />
            <h3 className="font-semibold text-(--ink-2) mb-1" style={{ fontSize: 16 }}>
              Chưa có học sinh nào nộp bài
            </h3>
            <p className="text-xs max-w-sm">
              Khi học sinh hoàn thành các thế cờ trong bài tập, kết quả và chi tiết nước đi sẽ xuất hiện tại đây để bạn chấm điểm và nhận xét.
            </p>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
            {/* Left Column: Submissions list */}
            <div
              className="md:col-span-4 border-r border-(--border) overflow-y-auto flex flex-col"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="p-3 border-b border-(--border) text-xs font-semibold uppercase tracking-wider text-(--ink-3)">
                Danh sách nộp ({submissions.length})
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {submissions.map(sub => {
                  const isSelected = sub.id === selectedSubId
                  const isGraded = sub.status === 'graded'
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      data-testid={`student-sub-${sub.id}`}
                      onClick={() => handleSelectStudent(sub)}
                      className="w-full text-left p-3 rounded-(--r-md) border transition-all cursor-pointer flex flex-col gap-1.5"
                      style={{
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        background: isSelected ? 'var(--surface)' : 'transparent',
                        color: isSelected ? 'var(--ink-1)' : 'var(--ink-2)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm truncate">
                          {sub.user_name}
                        </span>
                        <span
                          className="pill"
                          style={{
                            fontSize: 10.5,
                            background: isGraded ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                            color: isGraded ? 'var(--success)' : 'var(--warning)',
                          }}
                        >
                          {isGraded ? 'Đã chấm' : 'Chờ chấm'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-(--ink-3)">
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          <span>{new Date(sub.submitted_at).toLocaleDateString('vi-VN')}</span>
                        </div>
                        <span className="font-semibold text-(--ink-1)">
                          {sub.score !== null ? `${sub.score}/${assignment.max_score} đ` : '—'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Right Column: Selected Submission Detail & Grading */}
            {selectedSub && (
              <div className="md:col-span-8 overflow-y-auto p-6 flex flex-col gap-6">
                {/* Student header info */}
                <div
                  className="card p-4 flex items-center justify-between"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ background: 'var(--accent)' }}
                    >
                      {selectedSub.user_name?.charAt(0).toUpperCase() || 'H'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-(--ink-1)" style={{ fontSize: 16, margin: 0 }}>
                        {selectedSub.user_name}
                      </h3>
                      <p className="text-xs text-(--ink-3)" style={{ margin: 0 }}>
                        Nộp lúc: {new Date(selectedSub.submitted_at).toLocaleString('vi-VN')}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-(--ink-3)">Điểm hiện tại</div>
                    <div
                      className="font-bold text-xl text-(--accent)"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {selectedSub.score !== null ? selectedSub.score : '—'}
                      <span className="text-xs text-(--ink-3) font-normal"> / {assignment.max_score} điểm</span>
                    </div>
                  </div>
                </div>

                {/* Problems and Answers review */}
                <div>
                  <h4 className="font-semibold text-sm text-(--ink-1) mb-3 uppercase tracking-wider">
                    Chi tiết bài làm từng thế cờ
                  </h4>

                  <div className="space-y-4">
                    {assignment.problems.map((prob, idx) => {
                      const answer = selectedSub.answers.find(a => a.problem_id === prob.id)
                      const isCorrect = answer?.is_correct ?? false

                      return (
                        <div
                          key={prob.id}
                          className="card p-4 rounded-(--r-md) border"
                          style={{
                            borderColor: isCorrect ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                            background: 'var(--surface)',
                          }}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="pill"
                                style={{
                                  fontSize: 11,
                                  background: isCorrect ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                  color: isCorrect ? 'var(--success)' : 'var(--danger)',
                                }}
                              >
                                {isCorrect ? '✓ Giải đúng' : '✗ Chưa giải được'}
                              </span>
                              <span className="pill" style={{ fontSize: 10.5, background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                                {getObjectiveById(prob.objective).badge} {getObjectiveById(prob.objective).label}
                              </span>
                              <span className="font-semibold text-sm text-(--ink-1)">
                                Câu {idx + 1}: {prob.title}
                              </span>
                            </div>

                            <span className="text-xs text-(--ink-3)">
                              Điểm: {prob.points} • Số lần thử: {answer?.attempts ?? 0}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                            {/* Mini Chessboard */}
                            <div className="sm:col-span-5 flex justify-center">
                              <ChessgroundView
                                fen={prob.fen}
                                orientation={prob.player_side}
                                viewOnly
                                size={190}
                              />
                            </div>

                            {/* Move details & Explanation */}
                            <div className="sm:col-span-7 flex flex-col gap-2 text-xs">
                              <div>
                                <span className="text-(--ink-3) block">Nước đi đáp án:</span>
                                <div className="font-mono font-semibold text-(--ink-1) mt-0.5">
                                  {prob.solution_moves.join(' ') || 'Chưa có'}
                                </div>
                              </div>

                              {answer && answer.user_moves.length > 0 && (
                                <div>
                                  <span className="text-(--ink-3) block">Nước đi học sinh đã chọn:</span>
                                  <div className="font-mono text-(--ink-2) mt-0.5">
                                    {answer.user_moves.join(' ')}
                                  </div>
                                </div>
                              )}

                              {prob.explanation && (
                                <div
                                  className="p-2.5 rounded-(--r-sm) mt-1"
                                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                                >
                                  <span className="font-semibold text-(--ink-1) block mb-0.5">
                                    Lời giải thích từ giáo viên:
                                  </span>
                                  <span className="text-(--ink-2)">{prob.explanation}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Grading Form */}
                <form
                  onSubmit={handleSaveGrade}
                  className="card p-5 rounded-(--r-md) border border-(--border)"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <h4 className="font-semibold text-sm text-(--ink-1) mb-3 flex items-center gap-2">
                    <Award size={16} className="text-(--accent)" />
                    <span>Chấm điểm & Nhận xét của giáo viên</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-3">
                    <div>
                      <label className="label">Điểm số</label>
                      <input
                        type="number"
                        data-testid="grade-score-input"
                        className="input w-full"
                        min={0}
                        max={assignment.max_score}
                        step={0.5}
                        value={scoreInput}
                        onChange={e => setScoreInput(Number(e.target.value))}
                        required
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="label">Nhận xét bài làm</label>
                      <textarea
                        data-testid="grade-feedback-input"
                        className="input w-full text-xs"
                        rows={2}
                        placeholder="Nhập lời khen ngợi, nhắc nhở hoặc hướng dẫn thêm cho học viên..."
                        value={feedbackInput}
                        onChange={e => setFeedbackInput(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    {gradeSuccessMsg ? (
                      <span className="text-xs text-(--success) flex items-center gap-1 font-semibold">
                        <CheckCircle2 size={14} />
                        Đã lưu điểm và nhận xét thành công!
                      </span>
                    ) : (
                      <span className="text-xs text-(--ink-3)">
                        Học sinh sẽ nhận được điểm và phản hồi này ngay lập tức.
                      </span>
                    )}

                    <button
                      type="submit"
                      data-testid="save-grade-btn"
                      disabled={gradingLoading}
                      className="btn btn-accent btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Save size={14} />
                      <span>{gradingLoading ? 'Đang lưu...' : 'Lưu đánh giá'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

