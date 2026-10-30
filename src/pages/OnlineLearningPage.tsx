import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Video,
  Calendar,
  Clock,
  User,
  BookOpen,
  FileText,
  MessageSquare,
  Bell,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Send,
  Download,
  Pin,
  ChevronRight,
  ExternalLink,
  PlusCircle,
  X,
  FileCheck,
  FolderOpen,
  Users,
  Award,
  Lock,
  Eye,
} from 'lucide-react'
import AssignmentSolverModal from '../components/online/AssignmentSolverModal'
import { useAuth } from '../context/AuthContext'
import {
  getEnrolledLiveCourses,
  getCourseLiveSessions,
  getCourseAssignments,
  submitAssignment,
  getCourseAnnouncements,
  getCourseMaterials,
  getCourseDiscussions,
  createDiscussion,
  createDiscussionReply,
  getCourseTuition,
  getCourseChatMessages,
  sendCourseChatMessage,
  subscribeToCourseChat,
  type EnrolledLiveCourse,
  type LiveUpcomingSession,
  type AssignmentItem,
  type LiveAnnouncementItem,
  type LiveMaterialItem,
  type LiveDiscussionItem,
  type LiveTuitionItem,
  type LivePortalChatMessage,
} from '../lib/livePortalApi'
import { formatPrice } from '../lib/utils'

type MainTab = 'assignments' | 'chat' | 'announcements' | 'materials' | 'discussions' | 'tuition'
type AssignmentSubTab = 'upcoming' | 'overdue' | 'completed'

export default function OnlineLearningPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [courses, setCourses] = useState<EnrolledLiveCourse[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Course detailed portal data
  const [sessions, setSessions] = useState<LiveUpcomingSession[]>([])
  const [assignments, setAssignments] = useState<AssignmentItem[]>([])
  const [announcements, setAnnouncements] = useState<LiveAnnouncementItem[]>([])
  const [materials, setMaterials] = useState<LiveMaterialItem[]>([])
  const [discussions, setDiscussions] = useState<LiveDiscussionItem[]>([])
  const [tuition, setTuition] = useState<LiveTuitionItem | null>(null)

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<MainTab>('assignments')
  const [assignmentTab, setAssignmentTab] = useState<AssignmentSubTab>('upcoming')

  // Chat persistent state & Realtime
  const [chatMessages, setChatMessages] = useState<LivePortalChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Submit assignment modal
  const [submittingAssignment, setSubmittingAssignment] = useState<AssignmentItem | null>(null)
  const [submissionText, setSubmissionText] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [activeSolverAssignmentId, setActiveSolverAssignmentId] = useState<string | null>(null)

  // New discussion modal / state
  const [showNewDiscussion, setShowNewDiscussion] = useState(false)
  const [newDiscTitle, setNewDiscTitle] = useState('')
  const [newDiscContent, setNewDiscContent] = useState('')
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({})

  // Load enrolled courses
  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    let isMounted = true
    getEnrolledLiveCourses(undefined, user.id).then(({ courses: enrolled }) => {
      if (!isMounted) return
      setCourses(enrolled)
      if (enrolled.length > 0) {
        setSelectedCourseId(enrolled[0].id)
      }
      setLoading(false)
    })

    return () => {
      isMounted = false
    }
  }, [user])

  // Load details for selected course
  useEffect(() => {
    if (!selectedCourseId || !user) return

    let isMounted = true
    setChatLoading(true)
    Promise.all([
      getCourseLiveSessions(undefined, selectedCourseId),
      getCourseAssignments(undefined, selectedCourseId, user.id),
      getCourseAnnouncements(undefined, selectedCourseId),
      getCourseMaterials(undefined, selectedCourseId),
      getCourseDiscussions(undefined, selectedCourseId),
      getCourseTuition(undefined, selectedCourseId, user.id),
      getCourseChatMessages(undefined, selectedCourseId),
    ]).then(([sessRes, assRes, annRes, matRes, discRes, tuiRes, chatRes]) => {
      if (!isMounted) return
      setSessions(sessRes.sessions)
      setAssignments(assRes.assignments)
      setAnnouncements(annRes.announcements)
      setMaterials(matRes.materials)
      setDiscussions(discRes.discussions)
      setTuition(tuiRes.tuition)
      setChatMessages(chatRes.messages)
      setChatLoading(false)
    })

    const unsubscribeChat = subscribeToCourseChat(undefined, selectedCourseId, (newMsg) => {
      if (!isMounted) return
      setChatMessages(prev => {
        if (prev.some(m => m.id === newMsg.id)) return prev
        return [...prev, newMsg]
      })
    })

    return () => {
      isMounted = false
      unsubscribeChat()
    }
  }, [selectedCourseId, user])

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
    }
  }, [chatMessages, activeTab])

  const selectedCourse = courses.find(c => c.id === selectedCourseId) || courses[0]

  // Filter assignments into 3 categories
  const now = new Date()
  const upcomingAssignments = assignments.filter(a => {
    const isDue = new Date(a.due_date) > now
    return !a.submission && isDue
  })
  const overdueAssignments = assignments.filter(a => {
    const isPast = new Date(a.due_date) <= now
    return !a.submission && isPast
  })
  const completedAssignments = assignments.filter(a => !!a.submission)

  // Find next upcoming session
  const nextSession = sessions.find(s => s.status === 'LIVE' || s.status === 'SCHEDULED') || sessions[0]

  async function handleSendChatMessage(e: React.FormEvent) {
    e.preventDefault()
    const text = chatInput.trim()
    if (!text || !user || !selectedCourseId || chatSending) return
    setChatSending(true)
    setChatInput('')

    const { message } = await sendCourseChatMessage(undefined, selectedCourseId, user.id, text)
    setChatSending(false)
    if (message) {
      setChatMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })
    }
  }

  async function handleSubmitAssignmentConfirm() {
    if (!submittingAssignment || !user || !submissionText.trim()) return
    setSubmitLoading(true)
    const { success } = await submitAssignment(undefined, submittingAssignment.id, user.id, submissionText.trim())
    setSubmitLoading(false)
    if (success) {
      // Refresh assignments
      const { assignments: fresh } = await getCourseAssignments(undefined, submittingAssignment.course_id, user.id)
      setAssignments(fresh)
      setSubmittingAssignment(null)
      setSubmissionText('')
      setAssignmentTab('completed')
    }
  }

  async function handleCreateDiscussionSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCourseId || !user || !newDiscTitle.trim() || !newDiscContent.trim()) return
    const { discussion } = await createDiscussion(undefined, selectedCourseId, user.id, newDiscTitle.trim(), newDiscContent.trim())
    if (discussion) {
      setDiscussions(prev => [discussion, ...prev])
      setNewDiscTitle('')
      setNewDiscContent('')
      setShowNewDiscussion(false)
    }
  }

  async function handleSendReply(discussionId: string) {
    const text = replyInputs[discussionId]?.trim()
    if (!text || !user) return
    const { reply } = await createDiscussionReply(undefined, discussionId, user.id, text)
    if (reply) {
      setDiscussions(prev =>
        prev.map(d => (d.id === discussionId ? { ...d, replies: [...d.replies, reply] } : d))
      )
      setReplyInputs(prev => ({ ...prev, [discussionId]: '' }))
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>{t('online.loading', 'Đang tải thông tin lớp học trực tuyến...')}</p>
  </div>
    )
  }

  // Not logged in prompt
  if (!user) {
    return (
      <div style={{ maxWidth: 800, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(220, 38, 38, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: 'oklch(0.6 0.22 25)' }}>
          <Video size={32} />
    </div>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, color: 'var(--ink-1)', marginBottom: 12 }}>
          Lớp học Cờ vua Trực tuyến
        </h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 15, maxWidth: 520, margin: '0 auto 24px', lineHeight: 1.6 }}>
          Vui lòng đăng nhập để xem lịch học, bài tập, thảo luận và vào phòng học trực tiếp với Giảng viên.
        </p>
        <Link to="/login?redirect=/online" className="btn btn-accent btn-lg">
          Đăng nhập ngay
        </Link>
  </div>
    )
  }

  // Empty state: User has not enrolled in any live course yet
  if (courses.length === 0) {
    return (
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div
          className="card"
          style={{
            padding: '56px 32px',
            textAlign: 'center',
            background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-xl)',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'rgba(220, 38, 38, 0.12)',
              color: 'oklch(0.6 0.22 25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}
          >
            <Video size={36} />
      </div>
          <span className="pill pill-danger" style={{ marginBottom: 14, display: 'inline-block' }}>
            🔴 Phòng học tương tác LiveKit
          </span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, color: 'var(--ink-1)', marginBottom: 12 }}>
            Bạn chưa đăng ký khóa học trực tuyến nào
          </h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 15, maxWidth: 620, margin: '0 auto 32px', lineHeight: 1.6 }}>
            Bạn chưa đăng ký khóa học trực tuyến nào, hãy vào mục <strong>Khám phá</strong> để tìm và tham gia các lớp học cờ vua trực tuyến tương tác cùng Kiện tướng nhé!
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/?course_type=live" className="btn btn-accent btn-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>Vào mục Khám phá</span>
              <ChevronRight size={16} />
            </Link>
            <Link to="/dashboard" className="btn btn-secondary btn-lg">
              Về Quản lý học tập
            </Link>
      </div>
    </div>
  </div>
    )
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 80px' }}>
      {/* Top Header / Course Selector & Class Overview */}
      <div
        className="card"
        style={{
          padding: 24,
          marginBottom: 28,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div style={{ flex: 1 }}>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="pill pill-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
                Khóa học Trực tuyến
              </span>
              {courses.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Chọn lớp:</span>
                  <select
                    value={selectedCourseId ?? ''}
                    onChange={e => setSelectedCourseId(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 'var(--r-sm)',
                      border: '1px solid var(--border-strong)',
                      background: 'var(--bg)',
                      color: 'var(--ink-1)',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
            </div>
              )}
        </div>

            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 28,
                fontWeight: 600,
                color: 'var(--ink-1)',
                margin: '0 0 10px',
                lineHeight: 1.25,
              }}
            >
              {selectedCourse?.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-(--ink-2)">
              <div className="flex items-center gap-2">
                <User size={15} className="text-(--accent)" />
                <span>
                  Giảng viên: <strong>{selectedCourse?.creator_name || 'Thầy Dạy Cờ'}</strong>
                </span>
          </div>
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-(--ink-3)" />
                <span>
                  Lịch học định kỳ: <strong>{selectedCourse?.live_schedule || 'Theo thông báo giảng viên'}</strong>
                </span>
          </div>
        </div>
      </div>

          {/* Quick Tuition Badge in Header */}
          {tuition && (
            <div
              style={{
                padding: '12px 18px',
                borderRadius: 'var(--r-md)',
                background: tuition.status === 'paid' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.1)',
                border: `1px solid ${tuition.status === 'paid' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(234, 179, 8, 0.3)'}`,
                minWidth: 200,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CreditCard size={15} style={{ color: tuition.status === 'paid' ? 'var(--success)' : 'var(--warning)' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Thời hạn học phí</span>
          </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: tuition.status === 'paid' ? 'var(--success)' : 'var(--warning)' }}>
                {tuition.status === 'paid' ? '✓ Đã hoàn thành' : 'Chờ thanh toán'}
          </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                Kỳ: {tuition.period} (Hạn: {new Date(tuition.due_date).toLocaleDateString('vi-VN')})
          </div>
        </div>
          )}
    </div>
  </div>

      {/* Banner Lịch học sắp tới & Nút Vào Lớp */}
      {(() => {
        const isSessionLive = nextSession?.status === 'LIVE'
        const sessionStartTime = nextSession?.scheduled_start_at ? new Date(nextSession.scheduled_start_at).getTime() : 0
        const isBeforeClassTime = sessionStartTime > 0 && Date.now() < sessionStartTime
        const isSessionEnded = nextSession?.status === 'ENDED'
        const canJoinClass = isSessionLive

        return (
          <div
            className="card"
            style={{
              padding: 24,
              marginBottom: 32,
              background: isSessionLive
                ? 'linear-gradient(135deg, rgba(220, 38, 38, 0.12) 0%, var(--surface) 100%)'
                : isBeforeClassTime
                ? 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)'
                : !isSessionEnded && nextSession
                ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.08) 0%, var(--surface) 100%)'
                : 'var(--surface)',
              border: isSessionLive
                ? '1px solid rgba(220, 38, 38, 0.35)'
                : !isBeforeClassTime && !isSessionEnded && nextSession
                ? '1px solid rgba(234, 179, 8, 0.3)'
                : '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {isSessionLive ? (
                    <span className="pill pill-danger" style={{ fontSize: 11.5, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'pulse 1.5s infinite' }} />
                      🔴 ĐANG DIỄN RA
                    </span>
                  ) : isBeforeClassTime ? (
                    <span className="pill pill-secondary" style={{ fontSize: 11.5, padding: '2px 8px', background: 'var(--surface-2)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
                      ⏰ BUỔI HỌC SẮP TỚI
                    </span>
                  ) : !isSessionEnded && nextSession ? (
                    <span className="pill pill-warning" style={{ fontSize: 11.5, padding: '2px 8px', background: 'rgba(234, 179, 8, 0.12)', color: 'var(--warning-ink, #eab308)', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                      ⏳ ĐÃ ĐẾN GIỜ HỌC
                    </span>
                  ) : isSessionEnded ? (
                    <span className="pill pill-secondary" style={{ fontSize: 11.5, padding: '2px 8px' }}>
                      ✓ ĐÃ KẾT THÚC
                    </span>
                  ) : (
                    <span className="pill pill-secondary" style={{ fontSize: 11.5, padding: '2px 8px' }}>
                      Chưa có lịch mới
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                    {nextSession ? new Date(nextSession.scheduled_start_at).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Chưa có lịch mới'}
                  </span>
            </div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 6px' }}>
                  {nextSession?.title || 'Buổi học tương tác trực tuyến'}
                </h2>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)' }}>
                  {nextSession?.description || 'Phòng học tương tác trực tuyến LiveKit — Bàn cờ trực tiếp, chữa bài tập và đấu tập cùng Kiện tướng.'}
                </p>
                {nextSession && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, fontSize: 13, color: 'var(--ink-2)' }}>
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} className="text-(--accent)" />
                      {new Date(nextSession.scheduled_start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      {nextSession.scheduled_end_at && ` - ${new Date(nextSession.scheduled_end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <User size={14} className="text-(--ink-3)" />
                      {selectedCourse?.creator_name || 'Thầy Dạy Cờ'}
                    </span>
              </div>
                )}
          </div>

              <div className="flex flex-col items-start sm:items-end shrink-0 gap-1.5 text-left sm:text-right">
                {canJoinClass ? (
                  <button
                    type="button"
                    data-testid="join-classroom-btn"
                    onClick={() => {
                      const target = nextSession?.livekit_room_name || nextSession?.id || selectedCourse?.live_room_id || selectedCourse?.id
                      navigate(`/live/${target}`)
                    }}
                    className="btn btn-accent btn-lg"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '0 28px',
                      height: 48,
                      fontSize: 15,
                      fontWeight: 600,
                      boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
                      cursor: 'pointer',
                    }}
                  >
                    <Video size={20} />
                    <span>Vào lớp học ngay</span>
                  </button>
                ) : isBeforeClassTime ? (
                  <>
                    <button
                      type="button"
                      data-testid="join-classroom-btn"
                      disabled
                      className="btn btn-secondary btn-lg"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '0 24px',
                        height: 48,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'not-allowed',
                        opacity: 0.65,
                        background: 'var(--surface-2)',
                        borderColor: 'var(--border)',
                        color: 'var(--ink-3)',
                      }}
                      title="Chưa đến giờ học. Học viên chỉ có thể vào lớp khi đến giờ học hoặc khi giảng viên bắt đầu buổi học."
                    >
                      <Lock size={18} />
                      <span>Chưa đến giờ học</span>
                    </button>
                    <span className="text-xs text-(--ink-3) text-left sm:text-right max-w-xs">
                      Mở khi đến giờ học hoặc khi giảng viên bắt đầu.
                    </span>
                  </>
                ) : !isSessionEnded && nextSession ? (
                  <>
                    <button
                      type="button"
                      data-testid="join-classroom-btn"
                      disabled
                      className="btn btn-secondary btn-lg"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '0 24px',
                        height: 48,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'not-allowed',
                        opacity: 0.85,
                        background: 'var(--surface-2)',
                        borderColor: 'rgba(234, 179, 8, 0.3)',
                        color: 'var(--warning-ink, #eab308)',
                      }}
                      title="Đã đến giờ học. Vui lòng đợi giảng viên bắt đầu buổi học."
                    >
                      <Clock size={18} />
                      <span>Chờ giảng viên mở lớp</span>
                    </button>
                    <span className="text-xs text-(--ink-3) text-left sm:text-right max-w-xs">
                      Đã đến giờ học, vui lòng đợi giảng viên mở phòng học.
                    </span>
                  </>
                ) : isSessionEnded ? (
                  <button
                    type="button"
                    data-testid="join-classroom-btn"
                    disabled
                    className="btn btn-secondary btn-lg"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '0 24px',
                      height: 48,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'not-allowed',
                      opacity: 0.65,
                    }}
                  >
                    <CheckCircle2 size={18} />
                    <span>Buổi học đã kết thúc</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="join-classroom-btn"
                    disabled
                    className="btn btn-secondary btn-lg"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '0 24px',
                      height: 48,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'not-allowed',
                      opacity: 0.65,
                    }}
                  >
                    <Clock size={18} />
                    <span>Chưa có lịch học</span>
                  </button>
                )}
          </div>
        </div>
      </div>
        )
      })()}

      {/* Main Feature Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          borderBottom: '1px solid var(--border)',
          marginBottom: 28,
          overflowX: 'auto',
          paddingBottom: 2,
        }}
        role="tablist"
      >
        {[
          { key: 'assignments', label: 'Bài tập của tôi', icon: BookOpen, count: upcomingAssignments.length },
          { key: 'chat', label: 'Chat lớp học', icon: MessageSquare },
          { key: 'announcements', label: 'Thông báo', icon: Bell, count: announcements.length },
          { key: 'materials', label: 'Tài liệu', icon: FolderOpen, count: materials.length },
          { key: 'discussions', label: 'Thảo luận', icon: Users, count: discussions.length },
          { key: 'tuition', label: 'Thời hạn học phí', icon: CreditCard },
        ].map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key as MainTab)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 18px',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent',
                color: isActive ? 'var(--ink-1)' : 'var(--ink-3)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 14,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: isActive ? 'var(--accent)' : 'var(--surface-2)',
                    color: isActive ? '#fff' : 'var(--ink-2)',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
  </div>

      {/* TAB 1: BÀI TẬP CỦA TÔI */}
      {activeTab === 'assignments' && (
        <div>
          {/* 3 Sub-tabs: Sắp tới | Quá hạn | Đã hoàn thành */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'upcoming', label: 'Sắp tới', count: upcomingAssignments.length, color: 'var(--accent)' },
              { key: 'overdue', label: 'Quá hạn', count: overdueAssignments.length, color: 'var(--danger)' },
              { key: 'completed', label: 'Đã hoàn thành', count: completedAssignments.length, color: 'var(--success)' },
            ].map(sub => {
              const isActive = assignmentTab === sub.key
              return (
                <button
                  key={sub.key}
                  type="button"
                  data-testid={`assignment-subtab-${sub.key}`}
                  onClick={() => setAssignmentTab(sub.key as AssignmentSubTab)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--r-md)',
                    border: isActive ? `1px solid ${sub.color}` : '1px solid var(--border)',
                    background: isActive ? 'var(--surface-2)' : 'var(--surface)',
                    color: isActive ? 'var(--ink-1)' : 'var(--ink-2)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>{sub.label}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: isActive ? sub.color : 'var(--border)',
                      color: isActive ? '#fff' : 'var(--ink-3)',
                    }}
                  >
                    {sub.count}
                  </span>
                </button>
              )
            })}
      </div>

          {/* Subtab: SẮP TỚI */}
          {assignmentTab === 'upcoming' && (
            <div>
              {upcomingAssignments.length === 0 ? (
                <div className="card p-8 text-center" style={{ color: 'var(--ink-3)' }}>
                  <FileCheck size={36} className="mx-auto mb-2 text-(--border-strong)" />
                  <p style={{ margin: 0, fontSize: 14 }}>Hiện tại không có bài tập nào cần nộp.</p>
            </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {upcomingAssignments.map(item => (
                    <div
                      key={item.id}
                      className="card"
                      style={{
                        padding: 20,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-md)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 16,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="pill" style={{ fontSize: 11.5, background: 'rgba(234, 179, 8, 0.12)', color: 'var(--warning)', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                            Chưa nộp
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                            Thang điểm: {item.max_score}
                          </span>
                    </div>
                        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 6px' }}>
                          {item.title}
                        </h3>
                        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                          {item.description}
                        </p>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} className="text-(--accent)" />
                          <span>Hạn nộp: <strong>{new Date(item.due_date).toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}</strong></span>
                    </div>
                  </div>

                      <button
                        type="button"
                        data-testid={`solve-assignment-btn-${item.id}`}
                        onClick={() => setActiveSolverAssignmentId(item.id)}
                        className="btn btn-accent btn-sm"
                        style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <BookOpen size={14} />
                        <span>Làm bài tập</span>
                      </button>
                </div>
                  ))}
            </div>
              )}
        </div>
          )}

          {/* Subtab: QUÁ HẠN */}
          {assignmentTab === 'overdue' && (
            <div>
              {overdueAssignments.length === 0 ? (
                <div className="card p-8 text-center" style={{ color: 'var(--ink-3)' }}>
                  <CheckCircle2 size={36} className="mx-auto mb-2 text-(--success)" />
                  <p style={{ margin: 0, fontSize: 14 }}>Tuyệt vời! Bạn không có bài tập nào bị quá hạn.</p>
            </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {overdueAssignments.map(item => (
                    <div
                      key={item.id}
                      className="card"
                      style={{
                        padding: 20,
                        background: 'var(--surface)',
                        border: '1px solid rgba(220, 38, 38, 0.3)',
                        borderRadius: 'var(--r-md)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 16,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="pill pill-danger" style={{ fontSize: 11.5 }}>
                            ⚠️ Đã quá hạn
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                            Thang điểm: {item.max_score}
                          </span>
                    </div>
                        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 6px' }}>
                          {item.title}
                        </h3>
                        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                          {item.description}
                        </p>
                        <div style={{ fontSize: 12.5, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} />
                          <span>Hạn chót ban đầu: {new Date(item.due_date).toLocaleDateString('vi-VN')}</span>
                    </div>
                  </div>

                      <button
                        type="button"
                        data-testid={`solve-assignment-btn-${item.id}`}
                        onClick={() => setActiveSolverAssignmentId(item.id)}
                        className="btn btn-secondary btn-sm"
                        style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <BookOpen size={14} />
                        <span>Làm bài nộp muộn</span>
                      </button>
                </div>
                  ))}
            </div>
              )}
        </div>
          )}

          {/* Subtab: ĐÃ HOÀN THÀNH (Có điểm & đánh giá của giáo viên) */}
          {assignmentTab === 'completed' && (
            <div>
              {completedAssignments.length === 0 ? (
                <div className="card p-8 text-center" style={{ color: 'var(--ink-3)' }}>
                  <FileText size={36} className="mx-auto mb-2 text-(--border-strong)" />
                  <p style={{ margin: 0, fontSize: 14 }}>Bạn chưa hoàn thành bài tập nào.</p>
            </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {completedAssignments.map(item => {
                    const sub = item.submission!
                    return (
                      <div
                        key={item.id}
                        className="card"
                        style={{
                          padding: 22,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--r-md)',
                        }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="pill" style={{ background: 'rgba(34, 197, 94, 0.12)', color: 'var(--success)', border: '1px solid rgba(34, 197, 94, 0.3)', fontSize: 11.5 }}>
                                ✓ Đã nộp bài
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                Nộp ngày: {new Date(sub.submitted_at).toLocaleDateString('vi-VN')}
                              </span>
                        </div>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
                              {item.title}
                            </h3>
                      </div>

                          {/* Điểm số */}
                          <div style={{ textAlign: 'right' }}>
                            {typeof sub.score === 'number' ? (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'baseline',
                                  gap: 4,
                                  background: 'rgba(34, 197, 94, 0.1)',
                                  border: '1px solid rgba(34, 197, 94, 0.3)',
                                  padding: '6px 14px',
                                  borderRadius: 'var(--r-md)',
                                }}
                              >
                                <Award size={16} style={{ color: 'var(--success)', transform: 'translateY(2px)' }} />
                                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--success)', fontFamily: 'var(--font-serif)' }}>
                                  {sub.score}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>
                                  /{item.max_score} điểm
                                </span>
                          </div>
                            ) : (
                              <span className="pill" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', fontSize: 12 }}>
                                Đang chờ chấm điểm
                              </span>
                            )}

                            <div className="mt-2">
                              <button
                                type="button"
                                data-testid={`review-assignment-btn-${item.id}`}
                                onClick={() => setActiveSolverAssignmentId(item.id)}
                                className="btn btn-secondary btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              >
                                <Eye size={14} />
                                <span>Xem lại lời giải</span>
                              </button>
                        </div>
                      </div>
                    </div>

                        {/* Nội dung bài nộp của học viên */}
                        <div
                          style={{
                            background: 'var(--bg)',
                            padding: '12px 16px',
                            borderRadius: 'var(--r-sm)',
                            border: '1px solid var(--border)',
                            fontSize: 13,
                            color: 'var(--ink-2)',
                            marginBottom: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          <strong style={{ color: 'var(--ink-1)', display: 'block', marginBottom: 4 }}>
                            Bài làm của bạn:
                          </strong>
                          {sub.content}
                    </div>

                        {/* Đánh giá và nhận xét của giáo viên */}
                        {sub.teacher_feedback ? (
                          <div
                            style={{
                              background: 'rgba(56, 189, 248, 0.08)',
                              borderLeft: '4px solid var(--accent)',
                              padding: '14px 18px',
                              borderRadius: '0 var(--r-md) var(--r-md) 0',
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2">
                                <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-1)' }}>
                                  Nhận xét từ Giáo viên
                                </span>
                                <span className="pill" style={{ fontSize: 10.5, padding: '1px 6px', background: 'var(--accent)', color: '#fff' }}>
                                  Giảng viên
                                </span>
                          </div>
                              {sub.graded_at && (
                                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                                  Chấm ngày {new Date(sub.graded_at).toLocaleDateString('vi-VN')}
                                </span>
                              )}
                        </div>
                            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-1)', lineHeight: 1.5 }}>
                              {sub.teacher_feedback}
                            </p>
                      </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                            Giáo viên đang tiến hành chấm và phản hồi nhận xét cho bài tập này.
                      </div>
                        )}
                  </div>
                    )
                  })}
            </div>
              )}
        </div>
          )}
    </div>
      )}

      {/* TAB 2: CHAT LỚP HỌC */}
      {activeTab === 'chat' && (
        <div
          className="card"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            display: 'flex',
            flexDirection: 'column',
            height: 520,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2.5">
              <MessageSquare size={16} className="text-(--accent)" />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>Kênh trao đổi trực tiếp lớp học</span>
              <span className="pill pill-success" style={{ fontSize: 10, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                Realtime
              </span>
        </div>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{chatMessages.length} tin nhắn</span>
      </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {chatLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', gap: 8, fontSize: 13 }}>
                <span style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <span>Đang tải tin nhắn lớp học...</span>
          </div>
            ) : chatMessages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', gap: 8, padding: 32 }}>
                <MessageSquare size={36} style={{ opacity: 0.35 }} />
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>Chưa có tin nhắn nào</p>
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Hãy gửi lời chào đầu tiên đến giảng viên và các bạn cùng lớp nhé!</span>
          </div>
            ) : (
              chatMessages.map(msg => {
                const isMe = msg.sender_id === user.id
                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: isMe ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMe ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>
                        {isMe ? 'Bạn' : msg.sender_name}
                      </span>
                      {msg.sender_role === 'teacher' && (
                        <span className="pill pill-danger" style={{ fontSize: 10, padding: '0 5px' }}>
                          Giáo viên
                        </span>
                      )}
                      <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                        {new Date(msg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                </div>
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: isMe ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                        background: isMe ? 'var(--accent)' : 'var(--surface-2)',
                        color: isMe ? '#fff' : 'var(--ink-1)',
                        fontSize: 13.5,
                        lineHeight: 1.45,
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                </div>
              </div>
                )
              })
            )}
            <div ref={chatEndRef} />
      </div>

          <form onSubmit={handleSendChatMessage} style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, background: 'var(--bg)' }}>
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Nhập tin nhắn trao đổi với giáo viên và các bạn..."
              className="input"
              style={{ flex: 1 }}
              disabled={chatSending}
            />
            <button type="submit" className="btn btn-accent" disabled={!chatInput.trim() || chatSending} title="Gửi tin nhắn">
              <Send size={15} />
            </button>
          </form>
    </div>
      )}

      {/* TAB 3: THÔNG BÁO */}
      {activeTab === 'announcements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {announcements.length === 0 ? (
            <div className="card p-8 text-center text-(--ink-3)">Không có thông báo mới.</div>
          ) : (
            announcements.map(ann => (
              <div
                key={ann.id}
                className="card"
                style={{
                  padding: 20,
                  background: 'var(--surface)',
                  border: ann.is_pinned ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2">
                    {ann.is_pinned && (
                      <span className="pill pill-accent" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Pin size={11} />
                        Ghim
                      </span>
                    )}
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
                      {ann.title}
                    </h3>
              </div>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {new Date(ann.created_at).toLocaleDateString('vi-VN')}
                  </span>
            </div>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  {ann.content}
                </p>
                {ann.author_name && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)' }}>
                    Người đăng: <strong>{ann.author_name}</strong>
              </div>
                )}
          </div>
            ))
          )}
    </div>
      )}

      {/* TAB 4: TÀI LIỆU */}
      {activeTab === 'materials' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {materials.length === 0 ? (
            <div className="card p-8 text-center text-(--ink-3)">Chưa có tài liệu tải lên cho lớp học này.</div>
          ) : (
            materials.map(mat => (
              <div
                key={mat.id}
                className="card flex items-center justify-between p-4"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 'var(--r-sm)',
                      background: 'rgba(56, 189, 248, 0.1)',
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FileText size={20} />
              </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{mat.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      Định dạng: {mat.category.toUpperCase()} {mat.file_size && `· ${mat.file_size}`} · Ngày tải lên: {new Date(mat.created_at).toLocaleDateString('vi-VN')}
                </div>
              </div>
            </div>

                <a
                  href={mat.file_url || '#'}
                  download
                  onClick={e => {
                    if (!mat.file_url || mat.file_url === '#') {
                      e.preventDefault()
                      alert(`Tải file mẫu: ${mat.title}`)
                    }
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Download size={14} />
                  <span>Tải về</span>
                </a>
          </div>
            ))
          )}
    </div>
      )}

      {/* TAB 5: THẢO LUẬN */}
      {activeTab === 'discussions' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              Diễn đàn hỏi đáp lớp học
            </h2>
            <button
              type="button"
              onClick={() => setShowNewDiscussion(true)}
              className="btn btn-accent btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <PlusCircle size={15} />
              <span>Đặt câu hỏi mới</span>
            </button>
      </div>

          {/* New Discussion Modal */}
          {showNewDiscussion && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 16,
              }}
            >
              <div
                className="card"
                style={{
                  width: '100%',
                  maxWidth: 520,
                  background: 'var(--surface)',
                  padding: 24,
                  borderRadius: 'var(--r-lg)',
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>Đặt câu hỏi mới</h3>
                  <button type="button" onClick={() => setShowNewDiscussion(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}>
                    <X size={20} />
                  </button>
            </div>
                <form onSubmit={handleCreateDiscussionSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="label">Tiêu đề câu hỏi</label>
                    <input
                      type="text"
                      className="input w-full"
                      value={newDiscTitle}
                      onChange={e => setNewDiscTitle(e.target.value)}
                      placeholder="Ví dụ: Em thắc mắc nước cờ 12...Qe7"
                      required
                    />
              </div>
                  <div>
                    <label className="label">Nội dung chi tiết</label>
                    <textarea
                      className="input w-full"
                      rows={4}
                      value={newDiscContent}
                      onChange={e => setNewDiscContent(e.target.value)}
                      placeholder="Mô tả cụ thể thế cờ hoặc vấn đề bạn muốn trao đổi..."
                      required
                    />
              </div>
                  <div className="flex justify-end gap-2 mt-2">
                    <button type="button" onClick={() => setShowNewDiscussion(false)} className="btn btn-ghost">
                      Hủy
                    </button>
                    <button type="submit" className="btn btn-accent">
                      Đăng câu hỏi
                    </button>
              </div>
                </form>
          </div>
        </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {discussions.length === 0 ? (
              <div className="card p-8 text-center text-(--ink-3)">Chưa có câu hỏi thảo luận nào. Hãy đặt câu hỏi đầu tiên!</div>
            ) : (
              discussions.map(disc => (
                <div
                  key={disc.id}
                  className="card p-5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, fontWeight: 600 }}>
                        {disc.user_name.charAt(0).toUpperCase()}
                  </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{disc.user_name}</span>
                </div>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {new Date(disc.created_at).toLocaleDateString('vi-VN')}
                    </span>
              </div>

                  <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 6px' }}>
                    {disc.title}
                  </h3>
                  <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                    {disc.content}
                  </p>

                  {/* Replies list */}
                  {disc.replies.length > 0 && (
                    <div style={{ paddingLeft: 14, borderLeft: '2px solid var(--border)', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {disc.replies.map(rep => (
                        <div key={rep.id} style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--r-sm)' }}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>{rep.user_name}</span>
                            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(rep.created_at).toLocaleDateString('vi-VN')}</span>
                      </div>
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-1)' }}>{rep.content}</p>
                    </div>
                      ))}
                </div>
                  )}

                  {/* Reply Input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input"
                      style={{ flex: 1, fontSize: 13 }}
                      placeholder="Viết câu trả lời hoặc thảo luận..."
                      value={replyInputs[disc.id] || ''}
                      onChange={e => setReplyInputs(prev => ({ ...prev, [disc.id]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSendReply(disc.id)
                      }}
                    />
                    <button type="button" onClick={() => handleSendReply(disc.id)} className="btn btn-secondary btn-sm">
                      Trả lời
                    </button>
              </div>
            </div>
              ))
            )}
      </div>
    </div>
      )}

      {/* TAB 6: THỜI HẠN ĐÓNG HỌC PHÍ */}
      {activeTab === 'tuition' && (
        <div style={{ maxWidth: 720 }}>
          <div
            className="card p-6"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(34, 197, 94, 0.1)',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CreditCard size={22} />
          </div>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
                  Thông tin học phí & Thời hạn
                </h3>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Khóa học: {selectedCourse?.title}</span>
          </div>
        </div>

            {tuition ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="flex justify-between items-center py-2 border-b border-(--border)">
                  <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>Trạng thái thanh toán</span>
                  <span
                    className="pill"
                    style={{
                      background: tuition.status === 'paid' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                      color: tuition.status === 'paid' ? 'var(--success)' : 'var(--warning)',
                      fontWeight: 600,
                    }}
                  >
                    {tuition.status === 'paid' ? '✓ Đã thanh toán đầy đủ' : 'Chờ thanh toán'}
                  </span>
            </div>

                <div className="flex justify-between items-center py-2 border-b border-(--border)">
                  <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>Kỳ học phí</span>
                  <strong style={{ color: 'var(--ink-1)', fontSize: 14 }}>{tuition.period}</strong>
            </div>

                <div className="flex justify-between items-center py-2 border-b border-(--border)">
                  <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>Hạn chót đóng học phí kỳ tới</span>
                  <strong style={{ color: 'var(--ink-1)', fontSize: 14 }}>
                    {new Date(tuition.due_date).toLocaleDateString('vi-VN')}
                  </strong>
            </div>

                <div className="flex justify-between items-center py-2 border-b border-(--border)">
                  <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>Số tiền học phí</span>
                  <strong style={{ color: 'var(--accent)', fontSize: 16 }}>
                    {tuition.amount === 0 ? 'Miễn phí' : formatPrice(tuition.amount)}
                  </strong>
            </div>

                {tuition.note && (
                  <div style={{ background: 'var(--surface-2)', padding: '12px 16px', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--ink-2)', marginTop: 8 }}>
                    <strong>Ghi chú:</strong> {tuition.note}
              </div>
                )}
          </div>
            ) : (
              <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>
                Khóa học hiện đang áp dụng gói truy cập trực tuyến miễn phí hoặc chưa có yêu cầu học phí kỳ mới.
          </div>
            )}
      </div>
    </div>
      )}

      {/* MODAL NỘP BÀI TẬP */}
      {submittingAssignment && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 560,
              background: 'var(--surface)',
              padding: 24,
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--sh-3)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 4px' }}>
                  Nộp bài tập
                </h3>
                <span style={{ fontSize: 13, color: 'var(--accent)' }}>{submittingAssignment.title}</span>
          </div>
              <button
                type="button"
                onClick={() => setSubmittingAssignment(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}
              >
                <X size={20} />
              </button>
        </div>

            <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 14 }}>
              {submittingAssignment.description}
            </p>

            <div style={{ marginBottom: 16 }}>
              <label className="label">Nội dung bài làm (lời giải, nước đi, PGN hoặc link tài liệu)</label>
              <textarea
                className="input w-full"
                rows={5}
                value={submissionText}
                onChange={e => setSubmissionText(e.target.value)}
                placeholder="Nhập chi tiết phân tích hoặc lời giải của bạn..."
                required
              />
        </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubmittingAssignment(null)}
                className="btn btn-ghost"
                disabled={submitLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSubmitAssignmentConfirm}
                disabled={submitLoading || !submissionText.trim()}
                className="btn btn-accent"
              >
                {submitLoading ? 'Đang gửi...' : 'Xác nhận nộp bài'}
              </button>
        </div>
      </div>
    </div>
      )}
      {/* MODAL LÀM BÀI TẬP THẾ CỜ TƯƠNG TÁC */}
      {activeSolverAssignmentId && user && (
        <AssignmentSolverModal
          assignmentId={activeSolverAssignmentId}
          userId={user.id}
          isOpen={!!activeSolverAssignmentId}
          onClose={() => setActiveSolverAssignmentId(null)}
          onCompleted={() => {
            if (selectedCourseId) {
              getCourseAssignments(undefined, selectedCourseId, user.id).then(({ assignments }) => {
                setAssignments(assignments)
              })
            }
          }}
        />
      )}
    </div>
  )
}
