import { useState, useEffect, useCallback, useContext } from 'react'
import {
  Plus,
  Calendar,
  Clock,
  ExternalLink,
  Play,
  Square,
  Edit2,
  Trash2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  BookOpen,
  Users,
  Video,
  ListOrdered,
  XCircle,
  Eye,
  Swords,
  BarChart2,
} from 'lucide-react'
import { SessionGameReplayModal } from '../LiveClassroom/Replay'
import { LiveSessionAnalyticsModal } from '../LiveClassroom/Analytics'
import {
  type LiveSession,
  type LiveSessionStatus,
  type CreateLiveSessionInput,
  type UpdateLiveSessionInput,
} from '../../types/liveSession'
import {
  listLiveSessions,
  createLiveSession,
  updateLiveSession,
  deleteLiveSession,
  startLiveSession,
  endLiveSession,
  cancelLiveSession,
} from '../../lib/liveSessionApi'
import type { Chapter, CourseType } from '../../lib/creatorApi'
import { AuthContext } from '../../context/AuthContext'
import SessionModal from './SessionModal'
import SessionStaffModal from './SessionStaffModal'

interface LiveSessionsPanelProps {
  courseId: string
  courseType?: CourseType
  chapters: Chapter[]
  creatorId?: string
  onOpenLiveRoomLegacy?: () => void
}

import {
  formatSessionDate,
  formatSessionTime,
  getDurationMinutes,
  resolveSessionTimezone,
} from '../../lib/liveSessionTime'

export default function LiveSessionsPanel({
  courseId,
  courseType: _courseType,
  chapters,
  creatorId,
}: LiveSessionsPanelProps) {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Status Filter
  const [statusFilter, setStatusFilter] = useState<'ALL' | LiveSessionStatus>('ALL')

  // Modal State
  const [modalOpen, setModalOpen] = useState(false)
  const [sessionToEdit, setSessionToEdit] = useState<LiveSession | null>(null)

  const authCtx = useContext(AuthContext)
  const effectiveCreatorId = creatorId || authCtx?.user?.id
  const [sessionToDelete, setSessionToDelete] = useState<LiveSession | null>(null)
  const [sessionForStaff, setSessionForStaff] = useState<LiveSession | null>(null)
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null)
  const [replayBoardId, setReplayBoardId] = useState<string | null>(null)
  const [analyticsSessionId, setAnalyticsSessionId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { sessions: data, error: err } = await listLiveSessions(undefined, courseId)
    if (err) {
      setError(err.message)
    } else {
      setSessions(data)
    }
    setLoading(false)
  }, [courseId])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const handleCreateOrUpdate = async (
    input: CreateLiveSessionInput | UpdateLiveSessionInput
  ) => {
    if (sessionToEdit) {
      const { session: updated, error: err } = await updateLiveSession(
        undefined,
        sessionToEdit.id,
        input as UpdateLiveSessionInput,
        sessionToEdit.status
      )
      if (err) throw err
      if (updated) {
        setSessions((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s))
        )
      }
    } else {
      const { session: created, error: err } = await createLiveSession(
        undefined,
        input as CreateLiveSessionInput
      )
      if (err) throw err
      if (created) {
        setSessions((prev) => [...prev, created])
      }
    }
    loadSessions()
  }

  const handleStartSession = async (session: LiveSession) => {
    if (!confirm(`Bạn có chắc muốn bắt đầu buổi học "${session.title}" ngay bây giờ?`)) {
      return
    }
    setActionLoadingId(session.id)
    const { success, error: err } = await startLiveSession(undefined, session.id)
    setActionLoadingId(null)
    if (err) {
      alert(`Không thể bắt đầu buổi học: ${err.message}`)
    } else if (success) {
      loadSessions()
      // Open live room in new tab
      window.open(`/live/${session.id}`, '_blank')
    }
  }

  const handleEndSession = async (session: LiveSession) => {
    if (!confirm(`Bạn có chắc muốn kết thúc buổi học "${session.title}"?`)) {
      return
    }
    setActionLoadingId(session.id)
    const { success, error: err } = await endLiveSession(undefined, session.id)
    setActionLoadingId(null)
    if (err) {
      alert(`Không thể kết thúc buổi học: ${err.message}`)
    } else if (success) {
      loadSessions()
    }
  }

  const handleCancelSession = async (session: LiveSession) => {
    if (!confirm(`Bạn có chắc muốn hủy buổi học "${session.title}"? Buổi học đã hủy sẽ không thể mở lại.`)) {
      return
    }
    setActionLoadingId(session.id)
    const { success, error: err } = await cancelLiveSession(undefined, session.id)
    setActionLoadingId(null)
    if (err) {
      alert(`Không thể hủy buổi học: ${err.message}`)
    } else if (success) {
      loadSessions()
    }
  }

  const handleDeleteConfirm = async () => {
    if (!sessionToDelete) return
    setActionLoadingId(sessionToDelete.id)
    const { success, error: err } = await deleteLiveSession(undefined, sessionToDelete.id, sessionToDelete.status)
    setActionLoadingId(null)
    setSessionToDelete(null)
    if (err) {
      alert(`Không thể xóa buổi học: ${err.message}`)
    } else if (success) {
      setSessions((prev) => prev.filter((s) => s.id !== sessionToDelete.id))
    }
  }

  const filteredSessions = sessions.filter((s) => {
    if (statusFilter === 'ALL') return true
    return s.status === statusFilter
  })

  const getStatusBadge = (status: LiveSessionStatus) => {
    switch (status) {
      case 'LIVE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            ĐANG DIỄN RA
          </span>
        )
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
            <Clock size={11} /> SẮP DIỄN RA
          </span>
        )
      case 'ENDED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 border border-gray-500/20 text-(--ink-3)">
            <CheckCircle2 size={11} /> ĐÃ KẾT THÚC
          </span>
        )
      case 'DRAFT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
            BẢN NHÁP
          </span>
        )
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 line-through">
            ĐÃ HỦY
          </span>
        )
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-(--surface)" data-testid="live-sessions-panel">
      {/* Top Banner & Header */}
      <div className="p-6 border-b border-(--border) bg-(--surface-2)">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <h1 className="text-lg font-bold text-(--ink-1)">Lịch học trực tuyến (Live Sessions)</h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-(--accent-soft) text-(--accent-ink) border border-(--accent-border)">
                {sessions.length} buổi học
              </span>
            </div>
            <p className="text-xs text-(--ink-3) mt-1 max-w-2xl">
              Mỗi buổi học trực tiếp sở hữu phòng học LiveKit độc lập, hỗ trợ giảng bài trực tiếp trên bàn cờ chính,
              chia cặp đấu luyện tập 1v1 trong phòng ảo và lưu trữ lịch sử buổi học.
            </p>
          </div>

          <button
            type="button"
            data-testid="create-session-btn"
            onClick={() => {
              setSessionToEdit(null)
              setModalOpen(true)
            }}
            className="px-4 py-2 rounded-md bg-(--accent) text-white font-semibold text-xs flex items-center gap-2 hover:opacity-90 transition-opacity shrink-0 cursor-pointer shadow-xs"
          >
            <Plus size={15} />
            <span>Tạo buổi học</span>
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mt-5 overflow-x-auto pb-1">
          {(
            [
              { key: 'ALL', label: 'Tất cả' },
              { key: 'SCHEDULED', label: 'Sắp diễn ra' },
              { key: 'LIVE', label: 'Đang diễn ra' },
              { key: 'ENDED', label: 'Đã kết thúc' },
              { key: 'DRAFT', label: 'Bản nháp' },
              { key: 'CANCELLED', label: 'Đã hủy' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                statusFilter === tab.key
                  ? 'bg-(--accent) text-white font-semibold'
                  : 'bg-(--surface) text-(--ink-2) border border-(--border) hover:bg-(--surface-3)'
              }`}
            >
              {tab.label}{' '}
              <span className="opacity-80 text-[10px]">
                ({tab.key === 'ALL' ? sessions.length : sessions.filter((s) => s.status === tab.key).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-6 flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Loader2 className="w-7 h-7 text-(--accent) animate-spin mb-2" />
            <p className="text-xs text-(--ink-3)">Đang tải danh sách buổi học...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-center gap-2 text-xs">
            <AlertCircle size={16} />
            <span>Lỗi tải danh sách: {error}</span>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-10 border border-dashed border-(--border-strong) rounded-(--r-lg) flex flex-col items-center justify-center text-center max-w-lg mx-auto my-8">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-3">
              <Video size={24} />
            </div>
            <h3 className="text-sm font-bold text-(--ink-1) mb-1">Chưa có buổi học trực tuyến nào</h3>
            <p className="text-xs text-(--ink-3) mb-5 max-w-md">
              {statusFilter === 'ALL'
                ? 'Hãy lên lịch các buổi học live theo tuần hoặc theo lộ trình cho khóa học của bạn để học viên có thể đăng ký và tham gia.'
                : `Không có buổi học nào ở trạng thái ${statusFilter}.`}
            </p>
            <button
              type="button"
              onClick={() => {
                setSessionToEdit(null)
                setModalOpen(true)
              }}
              className="px-4 py-2 rounded-md bg-(--accent) text-white font-semibold text-xs flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus size={14} />
              <span>Tạo buổi học đầu tiên</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredSessions.map((session, index) => {
              const duration = getDurationMinutes(session.scheduledStartAt, session.scheduledEndAt)
              const isActionLoading = actionLoadingId === session.id

              return (
                <div
                  key={session.id}
                  data-testid={`session-card-${session.id}`}
                  className="p-5 rounded-(--r-md) border border-(--border) bg-(--surface) hover:border-(--border-strong) transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-2xs"
                >
                  {/* Left: Info */}
                  <div className="flex-1 flex flex-col gap-2.5 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-bold text-(--ink-3) uppercase tracking-wider">
                        Buổi {index + 1}
                      </span>
                      <h3 className="text-sm sm:text-base font-bold text-(--ink-1) truncate">
                        {session.title}
                      </h3>
                      {getStatusBadge(session.status)}
                    </div>

                    {/* Schedule / Time Meta */}
                    <div className="flex items-center gap-4 flex-wrap text-xs text-(--ink-2)">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Calendar size={13} className="text-(--accent)" />
                        <span>{formatSessionDate(session.scheduledStartAt, session.timezone)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-medium">
                        <Clock size={13} className="text-(--ink-3)" />
                        <span>
                          {formatSessionTime(session.scheduledStartAt, session.timezone)}
                          {session.scheduledEndAt ? ` - ${formatSessionTime(session.scheduledEndAt, session.timezone)}` : ''}
                        </span>
                      </div>
                      {duration && (
                        <span className="px-2 py-0.5 rounded bg-(--surface-2) border border-(--border) text-[11px] font-semibold">
                          {duration} phút
                        </span>
                      )}
                      <span className="text-[11px] text-(--ink-3)">({resolveSessionTimezone(session.timezone)})</span>
                      {session.maxParticipants && (
                        <div className="flex items-center gap-1 text-(--ink-3)">
                          <Users size={12} />
                          <span>Tối đa {session.maxParticipants} học viên</span>
                        </div>
                      )}
                    </div>

                    {/* Optional Linked Lesson */}
                    {session.lessonTitle && (
                      <div className="flex items-center gap-1.5 text-xs text-(--ink-3)">
                        <BookOpen size={12} className="text-(--accent)" />
                        <span>Giáo trình liên kết: </span>
                        <span className="font-semibold text-(--ink-2)">{session.lessonTitle}</span>
                      </div>
                    )}

                    {/* Agenda summary */}
                    {session.agenda && session.agenda.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <span className="text-[11px] font-semibold text-(--ink-3) flex items-center gap-1">
                          <ListOrdered size={12} /> Lịch trình ({session.agenda.length}):
                        </span>
                        {session.agenda.slice(0, 3).map((item, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-(--surface-2) border border-(--border) text-[11px] text-(--ink-2)"
                          >
                            {item.title} ({item.duration_minutes}m)
                          </span>
                        ))}
                        {session.agenda.length > 3 && (
                          <span className="text-[11px] text-(--ink-3)">
                            +{session.agenda.length - 3} mục nữa
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap lg:self-center">
                    {/* LIVE: Enter room & End session */}
                    {session.status === 'LIVE' && (
                      <>
                        <a
                          href={`/live/${session.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                        >
                          <Video size={13} />
                          <span>Vào lớp</span>
                          <ExternalLink size={11} />
                        </a>
                        <button
                          type="button"
                          disabled={isActionLoading}
                          onClick={() => handleEndSession(session)}
                          className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          {isActionLoading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Square size={13} fill="currentColor" />
                          )}
                          <span>Kết thúc</span>
                        </button>
                      </>
                    )}

                    {/* SCHEDULED: Start, Cancel, Edit */}
                    {session.status === 'SCHEDULED' && (
                      <>
                        <button
                          type="button"
                          disabled={isActionLoading}
                          onClick={() => handleStartSession(session)}
                          className="px-3 py-1.5 rounded-md text-xs font-semibold bg-(--accent) text-white hover:opacity-90 transition-opacity flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          {isActionLoading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Play size={13} fill="currentColor" />
                          )}
                          <span>Bắt đầu</span>
                        </button>
                        <button
                          type="button"
                          disabled={isActionLoading}
                          onClick={() => handleCancelSession(session)}
                          className="px-3 py-1.5 rounded-md text-xs font-semibold border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          title="Hủy buổi học"
                        >
                          {isActionLoading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <XCircle size={13} />
                          )}
                          <span>Hủy</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSessionToEdit(session)
                            setModalOpen(true)
                          }}
                          className="p-2 rounded-md border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors cursor-pointer"
                          title="Chỉnh sửa buổi học"
                        >
                          <Edit2 size={13} />
                        </button>
                      </>
                    )}

                    {/* DRAFT: Edit, Delete */}
                    {session.status === 'DRAFT' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSessionToEdit(session)
                            setModalOpen(true)
                          }}
                          className="p-2 rounded-md border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors cursor-pointer"
                          title="Chỉnh sửa buổi học"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={isActionLoading}
                          onClick={() => setSessionToDelete(session)}
                          className="p-2 rounded-md border border-(--border) text-(--ink-3) hover:text-red-500 hover:border-red-500/30 transition-colors cursor-pointer disabled:opacity-40"
                          title="Xóa buổi học nháp"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}

                    {/* ENDED or CANCELLED: View only (no lifecycle mutation) */}
                    {(session.status === 'ENDED' || session.status === 'CANCELLED') && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSessionToEdit(session)
                            setModalOpen(true)
                          }}
                          className="px-3 py-1.5 rounded-md text-xs font-medium border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors flex items-center gap-1.5 cursor-pointer"
                          title="Xem chi tiết buổi học"
                        >
                          <Eye size={13} />
                          <span>Xem</span>
                        </button>
                        {session.status === 'ENDED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReplayBoardId(null)
                              setReplaySessionId(session.id)
                            }}
                            className="px-3 py-1.5 rounded-md text-xs font-medium border border-(--border) text-(--ink-2) hover:text-(--accent) hover:border-(--accent) hover:bg-(--surface-2) transition-colors flex items-center gap-1.5 cursor-pointer"
                            title="Xem lại các ván đấu của buổi học"
                            data-testid={`creator-replay-btn-${session.id}`}
                          >
                            <Swords size={13} />
                            <span>Ván cờ</span>
                          </button>
                        )}
                      </>
                    )}

                    {/* Manage Staff / Assistants */}
                    <button
                      type="button"
                      onClick={() => setSessionForStaff(session)}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-(--border) text-(--ink-2) hover:text-(--ink-1) hover:bg-(--surface-2) transition-colors flex items-center gap-1 cursor-pointer"
                      title="Quản lý trợ giảng"
                    >
                      <Users size={13} />
                      <span className="hidden sm:inline">Trợ giảng</span>
                    </button>

                    {/* View Analytics Report */}
                    <button
                      type="button"
                      onClick={() => setAnalyticsSessionId(session.id)}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-(--border) text-(--ink-2) hover:text-(--accent) hover:border-(--accent) hover:bg-(--surface-2) transition-colors flex items-center gap-1 cursor-pointer"
                      title="Xem báo cáo phân tích & điểm danh"
                      data-testid={`session-analytics-btn-${session.id}`}
                    >
                      <BarChart2 size={13} />
                      <span className="hidden sm:inline">Báo cáo</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Session Modal */}
      {modalOpen && (
        <SessionModal
          courseId={courseId}
          chapters={chapters}
          sessionToEdit={sessionToEdit}
          sessionNumber={sessions.length + 1}
          onClose={() => {
            setModalOpen(false)
            setSessionToEdit(null)
          }}
          onSave={handleCreateOrUpdate}
        />
      )}

      {/* Session Staff / Assistant Management Modal */}
      {sessionForStaff && (
        <SessionStaffModal
          session={sessionForStaff}
          courseCreatorId={effectiveCreatorId}
          onClose={() => setSessionForStaff(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {sessionToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-(--surface) border border-(--border) rounded-(--r-lg) p-6 max-w-md w-full shadow-xl">
            <h3 className="text-sm font-bold text-(--ink-1) mb-2">Xác nhận xóa buổi học</h3>
            <p className="text-xs text-(--ink-2) mb-5">
              Bạn có chắc chắn muốn xóa buổi học &quot;<strong>{sessionToDelete.title}</strong>&quot;? Hành động này không thể hoàn tác.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                className="px-4 py-2 rounded-md border border-(--border) text-xs font-semibold text-(--ink-2) hover:bg-(--surface-2)"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
              >
                Xóa buổi học
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Game Replay Modal */}
      {replaySessionId && (
        <SessionGameReplayModal
          sessionId={replaySessionId}
          initialBoardId={replayBoardId || undefined}
          isOpen={Boolean(replaySessionId)}
          onClose={() => {
            setReplaySessionId(null)
            setReplayBoardId(null)
          }}
        />
      )}

      {/* Live Session Analytics Modal */}
      {analyticsSessionId && (
        <LiveSessionAnalyticsModal
          sessionId={analyticsSessionId}
          isOpen={Boolean(analyticsSessionId)}
          isSuspended={Boolean(replaySessionId)}
          onClose={() => setAnalyticsSessionId(null)}
          onOpenReplay={(boardId) => {
            setReplayBoardId(boardId || null)
            setReplaySessionId(analyticsSessionId)
          }}
        />
      )}
    </div>
  )
}
