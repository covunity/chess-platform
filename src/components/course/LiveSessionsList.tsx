import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Calendar,
  Clock,
  Video,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  ListOrdered,
  Target,
  Sparkles,
  ArrowRight,
  Loader2,
  Eye,
} from 'lucide-react'
import { listLiveSessions } from '../../lib/liveSessionApi'
import { type LiveSession, type LiveSessionStatus } from '../../types/liveSession'
import { SessionGameReplayModal } from '../LiveClassroom/Replay'

interface LiveSessionsListProps {
  courseId: string
  isEnrolled: boolean
  isCourseCreator: boolean
  coursePrice: number
  onEnrollOrPurchase: () => void
}

import {
  formatSessionDate,
  formatSessionTime,
  getDurationMinutes,
  resolveSessionTimezone,
} from '../../lib/liveSessionTime'

export default function LiveSessionsList({
  courseId,
  isEnrolled,
  isCourseCreator,
  coursePrice,
  onEnrollOrPurchase,
}: LiveSessionsListProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchSessions() {
      setLoading(true)
      const { sessions: data } = await listLiveSessions(undefined, courseId)
      if (!cancelled) {
        setSessions(data)
        // Auto-expand the live session or first upcoming session
        const liveOne = data.find((s) => s.status === 'LIVE')
        const scheduledOne = data.find((s) => s.status === 'SCHEDULED')
        if (liveOne) {
          setExpandedId(liveOne.id)
        } else if (scheduledOne) {
          setExpandedId(scheduledOne.id)
        } else if (data.length > 0) {
          setExpandedId(data[0].id)
        }
        setLoading(false)
      }
    }
    fetchSessions()
    return () => {
      cancelled = true
    }
  }, [courseId])

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const handleJoinSession = (sessionId: string) => {
    if (isEnrolled || isCourseCreator) {
      navigate(`/live/${sessionId}`)
    } else {
      onEnrollOrPurchase()
    }
  }

  if (loading) {
    return (
      <div className="card p-6 bg-(--surface) border border-(--border) flex items-center justify-center gap-3 text-xs text-(--ink-3)">
        <Loader2 className="w-5 h-5 animate-spin text-(--accent)" />
        <span>Đang tải lịch các buổi học trực tuyến...</span>
      </div>
    )
  }

  if (sessions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-4" data-testid="student-live-sessions-list">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-lg sm:text-xl font-bold text-(--ink-1)">
              Lịch các buổi học trực tuyến ({sessions.length} buổi)
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-(--ink-3) mt-1">
            Học trực tiếp cùng giảng viên qua phòng học tương tác LiveKit. Thực hành cờ vua 1v1 tại các bàn đấu ảo ngay trong buổi học.
          </p>
        </div>
      </div>

      {/* Session Cards List */}
      <div className="flex flex-col gap-3">
        {sessions.map((session, index) => {
          const isExpanded = expandedId === session.id
          const duration = getDurationMinutes(session.scheduledStartAt, session.scheduledEndAt)
          const isLive = session.status === 'LIVE'
          const isEnded = session.status === 'ENDED'

          return (
            <div
              key={session.id}
              data-testid={`student-session-item-${session.id}`}
              className={`rounded-(--r-md) border transition-all overflow-hidden ${
                isLive
                  ? 'border-red-500/50 bg-(--surface) shadow-md ring-1 ring-red-500/30'
                  : 'border-(--border) bg-(--surface) hover:border-(--border-strong)'
              }`}
            >
              {/* Header Bar of Card */}
              <div
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer select-none"
                onClick={() => toggleExpand(session.id)}
              >
                {/* Left Meta */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-xs font-black px-2 py-0.5 rounded bg-(--surface-2) text-(--ink-3) uppercase tracking-wide">
                      Buổi {index + 1}
                    </span>
                    <h3 className="text-sm sm:text-base font-bold text-(--ink-1) truncate">
                      {session.title}
                    </h3>
                    {isLive && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        ĐANG DIỄN RA
                      </span>
                    )}
                    {isEnded && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 border border-gray-500/20 text-(--ink-3)">
                        <CheckCircle2 size={11} /> ĐÃ KẾT THÚC
                      </span>
                    )}
                    {session.status === 'SCHEDULED' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
                        <Clock size={11} /> SẮP DIỄN RA
                      </span>
                    )}
                  </div>

                  {/* Schedule time */}
                  <div className="flex items-center gap-3 sm:gap-4 flex-wrap text-xs text-(--ink-2)">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Calendar size={13} className="text-(--accent)" />
                      <span className="capitalize">{formatSessionDate(session.scheduledStartAt, session.timezone)}</span>
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
                  </div>
                </div>

                {/* Right CTA */}
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isLive ? (
                    <button
                      type="button"
                      data-testid={`join-live-session-btn-${session.id}`}
                      onClick={() => handleJoinSession(session.id)}
                      className="px-4 py-2 rounded-md bg-red-600 text-white font-bold text-xs hover:bg-red-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm animate-pulse"
                    >
                      <Video size={14} />
                      <span>{isEnrolled || isCourseCreator ? 'VÀO LỚP NGAY' : 'ĐĂNG KÝ VÀO LỚP'}</span>
                      <ArrowRight size={13} />
                    </button>
                  ) : session.status === 'SCHEDULED' ? (
                    <button
                      type="button"
                      onClick={() => handleJoinSession(session.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                        isEnrolled || isCourseCreator
                          ? 'bg-(--accent-soft) text-(--accent-ink) hover:bg-(--accent) hover:text-white'
                          : 'bg-(--surface-2) text-(--ink-2) border border-(--border) hover:border-(--accent)'
                      }`}
                    >
                      <Video size={13} />
                      <span>{isEnrolled || isCourseCreator ? 'Phòng học' : 'Xem chi tiết'}</span>
                    </button>
                  ) : session.status === 'ENDED' && (isEnrolled || isCourseCreator) ? (
                    <button
                      type="button"
                      onClick={() => setReplaySessionId(session.id)}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors bg-(--surface-2) text-(--ink-1) border border-(--border) hover:border-(--accent)"
                      data-testid={`session-replay-btn-${session.id}`}
                    >
                      <Eye size={13} className="text-(--accent)" />
                      <span>Xem lại ván cờ</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => toggleExpand(session.id)}
                    className="p-1.5 rounded-md text-(--ink-3) hover:text-(--ink-1) hover:bg-(--surface-2) transition-colors cursor-pointer"
                    aria-label="Toggle details"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
              </div>

              {/* Collapsible Details Body */}
              {isExpanded && (
                <div className="px-4 pb-5 pt-1 sm:px-5 border-t border-(--border) bg-(--surface-2)/40 flex flex-col gap-4 text-xs sm:text-sm">
                  {/* Description */}
                  {session.description && (
                    <p className="text-xs sm:text-sm text-(--ink-2) leading-relaxed">
                      {session.description}
                    </p>
                  )}

                  {/* Learning Objectives */}
                  {session.learningObjectives && session.learningObjectives.length > 0 && (
                    <div className="p-3.5 rounded-md bg-(--surface) border border-(--border) flex flex-col gap-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-(--ink-1)">
                        <Target size={14} className="text-(--accent)" />
                        <span>Mục tiêu đạt được</span>
                      </div>
                      <ul className="flex flex-col gap-1.5 pl-2">
                        {session.learningObjectives.map((obj, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-(--ink-2)">
                            <span className="text-(--accent) font-bold">•</span>
                            <span>{obj}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Agenda */}
                  {session.agenda && session.agenda.length > 0 && (
                    <div className="p-3.5 rounded-md bg-(--surface) border border-(--border) flex flex-col gap-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-(--ink-1)">
                        <ListOrdered size={14} className="text-(--accent)" />
                        <span>Nội dung buổi học (Lịch trình chi tiết)</span>
                      </div>
                      <div className="flex flex-col gap-2 pl-2">
                        {session.agenda.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs text-(--ink-2)">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-(--ink-3)">{idx + 1}.</span>
                              <span className="font-medium text-(--ink-1)">{item.title}</span>
                            </div>
                            <span className="text-[11px] text-(--ink-3) font-mono">
                              {item.duration_minutes} phút
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preparation Notes */}
                  {session.preparationNotes && (
                    <div className="p-3.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-start gap-2 text-xs">
                      <Sparkles size={14} className="shrink-0 mt-0.5 text-amber-500" />
                      <div>
                        <strong className="block font-semibold mb-0.5">Chuẩn bị trước buổi học:</strong>
                        <span>{session.preparationNotes}</span>
                      </div>
                    </div>
                  )}

                  {/* Linked Lesson info */}
                  {session.lessonTitle && (
                    <div className="flex items-center gap-1.5 text-xs text-(--ink-3)">
                      <BookOpen size={12} className="text-(--accent)" />
                      <span>Bài học / Giáo trình lý thuyết kèm theo: </span>
                      <span className="font-semibold text-(--ink-2)">{session.lessonTitle}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {replaySessionId && (
        <SessionGameReplayModal
          sessionId={replaySessionId}
          isOpen={!!replaySessionId}
          onClose={() => setReplaySessionId(null)}
        />
      )}
    </div>
  )
}
