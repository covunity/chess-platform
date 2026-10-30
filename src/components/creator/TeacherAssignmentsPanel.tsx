import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  BookOpen,
  Calendar,
  Clock,
  Edit2,
  Trash2,
  Users,
  Award,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import {
  listTeacherAssignments,
  createAssignmentWithProblems,
  updateAssignmentWithProblems,
  deleteAssignment,
  type AssignmentWithProblems,
  type AssignmentProblem,
} from '../../lib/assignmentApi'
import AssignmentEditorModal from './AssignmentEditorModal'
import AssignmentSubmissionsModal from './AssignmentSubmissionsModal'

export interface TeacherAssignmentsPanelProps {
  courseId: string
  courseTitle?: string
}

export default function TeacherAssignmentsPanel({
  courseId,
  courseTitle,
}: TeacherAssignmentsPanelProps) {
  const [assignments, setAssignments] = useState<AssignmentWithProblems[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modals state
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<AssignmentWithProblems | null>(null)

  const [isSubmissionsOpen, setIsSubmissionsOpen] = useState(false)
  const [viewingAssignment, setViewingAssignment] = useState<AssignmentWithProblems | null>(null)

  const [deletingAssignment, setDeletingAssignment] = useState<AssignmentWithProblems | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const loadAssignments = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { assignments: data, error: err } = await listTeacherAssignments(undefined, courseId)
    if (err) {
      setError(err.message)
    } else {
      setAssignments(data)
    }
    setLoading(false)
  }, [courseId])

  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])

  // Save handler for Create & Edit
  async function handleSaveAssignment(
    assignmentData: {
      title: string
      description: string | null
      due_date: string
      max_score: number
    },
    problems: Omit<AssignmentProblem, 'id' | 'assignment_id'>[]
  ) {
    if (editingAssignment) {
      const { success, error: err } = await updateAssignmentWithProblems(
        undefined,
        editingAssignment.id,
        assignmentData,
        problems
      )
      if (err) throw err
      if (success) {
        await loadAssignments()
      }
    } else {
      const { assignment: created, error: err } = await createAssignmentWithProblems(
        undefined,
        courseId,
        assignmentData,
        problems
      )
      if (err) throw err
      if (created) {
        await loadAssignments()
      }
    }
  }

  // Delete handler
  async function handleConfirmDelete() {
    if (!deletingAssignment) return
    setActionLoading(true)
    try {
      const { success, error: err } = await deleteAssignment(undefined, deletingAssignment.id)
      if (err) throw err
      if (success) {
        setAssignments(prev => prev.filter(a => a.id !== deletingAssignment.id))
        setDeletingAssignment(null)
      }
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xóa bài tập.')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div
      data-testid="teacher-assignments-panel"
      className="flex-1 flex flex-col p-6 overflow-y-auto"
      style={{ background: 'var(--bg)' }}
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="pill pill-accent" style={{ fontSize: 11 }}>
              Giáo viên
            </span>
            <span className="text-xs text-(--ink-3)">{courseTitle || 'Khóa học'}</span>
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 24,
              fontWeight: 600,
              color: 'var(--ink-1)',
              margin: 0,
            }}
          >
            Quản lý & Giao bài tập
          </h1>
          <p className="text-xs text-(--ink-2) mt-1">
            Tạo thế cờ, thiết lập đáp án và lời giải thích để học viên luyện tập tương tác trên bàn cờ.
          </p>
        </div>

        <button
          type="button"
          data-testid="create-assignment-btn"
          onClick={() => {
            setEditingAssignment(null)
            setIsEditorOpen(true)
          }}
          className="btn btn-accent"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        >
          <Plus size={16} />
          <span>Giao bài tập mới</span>
        </button>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-(--ink-3) py-16">
          <Loader2 className="animate-spin" size={24} />
          <span>Đang tải danh sách bài tập...</span>
        </div>
      ) : error ? (
        <div className="card p-6 text-center text-(--danger)" style={{ background: 'var(--surface)' }}>
          <AlertCircle size={32} className="mx-auto mb-2 opacity-80" />
          <p className="font-semibold mb-1">Lỗi khi tải bài tập</p>
          <span className="text-xs">{error}</span>
        </div>
      ) : assignments.length === 0 ? (
        <div
          className="card p-12 text-center flex flex-col items-center justify-center my-auto"
          style={{
            background: 'var(--surface)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--r-xl)',
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <BookOpen size={28} />
          </div>
          <h3 className="font-semibold text-(--ink-1) mb-2" style={{ fontSize: 18 }}>
            Chưa có bài tập nào được giao
          </h3>
          <p className="text-xs text-(--ink-2) max-w-md mb-6 leading-relaxed">
            Bạn có thể tạo các bài tập thế cờ (chiếu bí, chiến thuật, đòn phối hợp) kèm đáp án và lời giải thích chi tiết cho học viên lớp học.
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingAssignment(null)
              setIsEditorOpen(true)
            }}
            className="btn btn-accent btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={15} />
            <span>Tạo bài tập đầu tiên</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {assignments.map(item => (
            <div
              key={item.id}
              data-testid={`assignment-card-${item.id}`}
              className="card p-5 rounded-(--r-lg) border border-(--border) flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all hover:border-(--accent-border)"
              style={{ background: 'var(--surface)' }}
            >
              {/* Assignment Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                  <span
                    className="pill"
                    style={{
                      fontSize: 11,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-ink)',
                      border: '1px solid var(--accent-border)',
                      fontWeight: 600,
                    }}
                  >
                    {item.problems.length} thế cờ
                  </span>
                  <span className="text-xs text-(--ink-3)">
                    Thang điểm: <strong>{item.max_score} điểm</strong>
                  </span>
                </div>

                <h3
                  className="font-semibold text-(--ink-1) mb-1"
                  style={{ fontSize: 16 }}
                >
                  {item.title}
                </h3>

                {item.description && (
                  <p className="text-xs text-(--ink-2) mb-2 line-clamp-2">
                    {item.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-(--ink-3) flex-wrap mt-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-(--accent)" />
                    <span>Hạn nộp: <strong>{new Date(item.due_date).toLocaleString('vi-VN')}</strong></span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Users size={13} className="text-(--success)" />
                    <span>
                      Đã nộp:{' '}
                      <strong style={{ color: 'var(--success)' }}>
                        {item.submissions_count ?? 0}
                      </strong>
                      {typeof item.enrolled_students_count === 'number' && item.enrolled_students_count > 0 && (
                        <span> / {item.enrolled_students_count} học viên</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  data-testid={`view-submissions-btn-${item.id}`}
                  onClick={() => {
                    setViewingAssignment(item)
                    setIsSubmissionsOpen(true)
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Users size={14} />
                  <span>Bài nộp ({item.submissions_count ?? 0})</span>
                </button>

                <button
                  type="button"
                  data-testid={`edit-assignment-btn-${item.id}`}
                  onClick={() => {
                    setEditingAssignment(item)
                    setIsEditorOpen(true)
                  }}
                  className="btn btn-ghost btn-sm"
                  title="Chỉnh sửa bài tập"
                >
                  <Edit2 size={14} />
                  <span>Sửa</span>
                </button>

                <button
                  type="button"
                  data-testid={`delete-assignment-btn-${item.id}`}
                  onClick={() => setDeletingAssignment(item)}
                  className="btn btn-ghost btn-sm text-(--danger) hover:bg-red-500/10"
                  title="Xóa bài tập"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {isEditorOpen && (
        <AssignmentEditorModal
          isOpen={isEditorOpen}
          onClose={() => {
            setIsEditorOpen(false)
            setEditingAssignment(null)
          }}
          onSave={handleSaveAssignment}
          initialAssignment={editingAssignment}
        />
      )}

      {/* Submissions & Grading Modal */}
      {isSubmissionsOpen && viewingAssignment && (
        <AssignmentSubmissionsModal
          isOpen={isSubmissionsOpen}
          onClose={() => {
            setIsSubmissionsOpen(false)
            setViewingAssignment(null)
            loadAssignments() // Refresh count when grading modal closes
          }}
          assignment={viewingAssignment}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deletingAssignment && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.6)', zIndex: 70 }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-6"
            style={{ width: '100%', maxWidth: 440, background: 'var(--surface)' }}
          >
            <h3 className="font-semibold text-(--ink-1) text-lg mb-2">
              Xác nhận xóa bài tập?
            </h3>
            <p className="text-xs text-(--ink-2) mb-4 leading-relaxed">
              Bạn có chắc chắn muốn xóa bài tập <strong>"{deletingAssignment.title}"</strong> không? Toàn bộ các thế cờ và kết quả bài làm của học viên sẽ bị xóa vĩnh viễn.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingAssignment(null)}
                className="btn btn-ghost btn-sm"
                disabled={actionLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="confirm-delete-assignment-btn"
                onClick={handleConfirmDelete}
                className="btn btn-danger btn-sm"
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang xóa...' : 'Xóa bài tập'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

