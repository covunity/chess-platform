import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LiveKitRoom, RoomAudioRenderer, useDataChannel } from '@livekit/components-react'
import { Loader2, AlertCircle, RefreshCw, ArrowLeft, LogOut, StopCircle, Eye, BarChart2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { checkLiveClassroomAccess } from '../../lib/coursesApi'
import { endLiveSession } from '../../lib/liveSessionApi'
import { useAuth } from '../../context/AuthContext'
import { useLiveClassroomStore } from './useLiveClassroomStore'
import LectureMode from './LectureMode'
import PracticeMode from './PracticeMode'
import ClassroomMediaBar from './Media/ClassroomMediaBar'
import ClassroomChat from './Chat/ClassroomChat'
import ThemeToggle from '../ThemeToggle'
import LanguageToggle from '../LanguageToggle'
import ClassroomBottomBar from './ClassroomBottomBar'
import { SessionGameReplayModal } from './Replay'
import { LiveSessionAnalyticsModal } from './Analytics'
import { START_FEN } from './liveClassroomStore'
import {
  type ClassroomControlPayload,
  LIVEKIT_TOPICS,
  type ClassroomRole,
} from '../../types/liveClassroom'
import { isValidUuid } from '../../lib/liveAttendanceApi'
import { useLiveAttendance } from './useLiveAttendance'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from './liveClassroomSecurity'

export interface LiveClassroomViewProps {
  roomId: string
  preferredRole?: ClassroomRole
}

interface TokenResponse {
  token: string
  serverUrl: string
  role: ClassroomRole
  identity: string
}

/** Inner component rendered inside LiveKitRoom to access LiveKit context */
function ClassroomContent({
  currentUserId,
  currentUserName,
  isTeacher,
  teacherId,
  sessionId,
  onLeave,
  onEndClass,
  onSessionTerminated,
}: {
  currentUserId: string
  currentUserName?: string
  isTeacher: boolean
  teacherId?: string
  sessionId?: string
  onLeave: () => void
  onEndClass?: () => Promise<void>
  onSessionTerminated?: (status: 'ENDED' | 'CANCELLED') => void
}) {
  const classMode = useLiveClassroomStore((s) => s.classMode)
  const setClassMode = useLiveClassroomStore((s) => s.setClassMode)
  const updateFen = useLiveClassroomStore((s) => s.updateFen)

  const [showRightPanel, setShowRightPanel] = useState(true)
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const [showLiveReplayModal, setShowLiveReplayModal] = useState(false)

  const { leave: leaveAttendance } = useLiveAttendance({
    sessionId,
    userId: currentUserId,
  })

  const handleLeaveClassroom = useCallback(async () => {
    await leaveAttendance()
    onLeave()
  }, [leaveAttendance, onLeave])

  // Listen to classroom control for class mode switches and class end
  const handleControlMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ClassroomControlPayload

        if (payload.type !== 'CLASSROOM_CONTROL') return

        const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, teacherId)

        if (payload.action === 'SET_CLASS_MODE' && payload.classMode) {
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn('ClassroomContent: Unauthorized SET_CLASS_MODE from', senderIdentity)
            }
            return
          }
          setClassMode(payload.classMode)
        } else if (payload.action === 'END_CLASS') {
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn('ClassroomContent: Unauthorized END_CLASS from', senderIdentity)
            }
            return
          }
          if (onSessionTerminated) {
            onSessionTerminated('ENDED')
          } else {
            handleLeaveClassroom()
          }
        }
      } catch (err) {
        console.warn('ClassroomContent: Failed to parse control message', err)
      }
    },
    [setClassMode, handleLeaveClassroom, onSessionTerminated, teacherId]
  )

  useDataChannel(LIVEKIT_TOPICS.CLASSROOM_CONTROL, handleControlMessage)

  return (
    <div className="flex-1 flex flex-col w-full h-full overflow-hidden min-h-0">
      {/* Upper area: Workspace (Left/Center) + Khung người dùng các thứ (SÁT BÊN PHẢI) */}
      <div className="flex-1 flex flex-col lg:flex-row w-full overflow-hidden min-h-0">
        {/* CENTER / LEFT: Chess Workspace (Lecture or Practice) */}
        <div className="flex-1 h-full min-w-0 flex flex-col items-center justify-center p-2 sm:p-4 overflow-y-auto">
          {classMode === 'MAIN' ? (
            <LectureMode
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              isTeacher={isTeacher}
              teacherId={teacherId}
              sessionId={sessionId}
              orientation={boardOrientation}
            />
          ) : (
            <PracticeMode
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              isTeacher={isTeacher}
              teacherId={teacherId}
              sessionId={sessionId}
            />
          )}
        </div>

        {/* RIGHT: Khung người dùng các thứ SÁT BÊN PHẢI */}
        {showRightPanel && (
          <aside
            data-testid="classroom-right-panel"
            className="w-full lg:w-84 xl:w-96 h-full flex flex-col border-t lg:border-t-0 lg:border-l border-(--border) bg-(--surface) shrink-0 overflow-hidden z-10"
          >
            {/* Top part: Participant header & Video tiles */}
            <div className="shrink-0">
              <ClassroomMediaBar
                currentUserId={currentUserId}
                isTeacher={isTeacher}
                onLeave={handleLeaveClassroom}
                hideBottomControls={true}
              />
            </div>

            {/* Bottom part: Global Classroom Chat filling remainder of height */}
            <div className="flex-1 flex flex-col min-h-0">
              <ClassroomChat
                isPrivate={false}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                teacherId={teacherId}
                sessionId={sessionId}
                embedded={true}
              />
            </div>
          </aside>
        )}
      </div>

      {/* BOTTOM: Thanh công cụ các thứ ĐỂ Ở DƯỚI */}
      <ClassroomBottomBar
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        isTeacher={isTeacher}
        teacherId={teacherId}
        onLeave={handleLeaveClassroom}
        onEndClass={onEndClass}
        showRightPanel={showRightPanel}
        onToggleRightPanel={() => setShowRightPanel((prev) => !prev)}
        onResetBoard={() => updateFen(START_FEN)}
        orientation={boardOrientation}
        onToggleOrientation={() => setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))}
        onOpenReplay={sessionId ? () => setShowLiveReplayModal(true) : undefined}
      />

      {sessionId && (
        <SessionGameReplayModal
          sessionId={sessionId}
          isOpen={showLiveReplayModal}
          onClose={() => setShowLiveReplayModal(false)}
        />
      )}
    </div>
  )
}

interface CourseRoomInfo {
  isCourseRoom: boolean
  isSession?: boolean
  sessionId?: string
  sessionTitle?: string
  courseId?: string
  courseTitle?: string
  courseSchedule?: string
  allowed?: boolean
  reason?: string
}

export default function LiveClassroomView({
  roomId,
  preferredRole = 'student',
}: LiveClassroomViewProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user, profile, loading: authLoading } = useAuth()

  const setMyRole = useLiveClassroomStore((s) => s.setMyRole)
  const myRole = useLiveClassroomStore((s) => s.myRole)
  const setTeacherId = useLiveClassroomStore((s) => s.setTeacherId)
  const resetLiveClass = useLiveClassroomStore((s) => s.resetLiveClass)

  const [tokenData, setTokenData] = useState<TokenResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [courseRoomInfo, setCourseRoomInfo] = useState<CourseRoomInfo | null>(null)
  const [accessDenied, setAccessDenied] = useState<{
    courseId?: string
    courseTitle?: string
    sessionTitle?: string
    courseSchedule?: string
  } | null>(null)
  const [resolvedTeacherId, setResolvedTeacherId] = useState<string | undefined>(undefined)
  const [sessionTerminatedStatus, setSessionTerminatedStatus] = useState<'ENDED' | 'CANCELLED' | null>(null)
  const [showTerminatedReplayModal, setShowTerminatedReplayModal] = useState(false)
  const [terminatedReplayBoardId, setTerminatedReplayBoardId] = useState<string | null>(null)
  const [showTerminatedAnalyticsModal, setShowTerminatedAnalyticsModal] = useState(false)
  const isTerminatedRef = useRef<boolean>(false)

  const handleSessionTerminated = useCallback(
    (status: 'ENDED' | 'CANCELLED') => {
      isTerminatedRef.current = true
      setSessionTerminatedStatus(status)
      resetLiveClass()
    },
    [resetLiveClass]
  )

  const handleManualLeave = useCallback(() => {
    resetLiveClass()
    navigate(-1)
  }, [resetLiveClass, navigate])

  const handleRoomDisconnected = useCallback(() => {
    // Distinguish between user-initiated leave/disconnect and server/session termination:
    // When session is terminated, LiveKit disconnect/unmount must NOT navigate(-1).
    // The dedicated session-ended screen must remain visible.
    if (isTerminatedRef.current || sessionTerminatedStatus !== null) {
      resetLiveClass()
      return
    }
    handleManualLeave()
  }, [sessionTerminatedStatus, handleManualLeave, resetLiveClass])

  const handleTeacherEndClass = useCallback(async () => {
    if (!courseRoomInfo?.sessionId) return
    const { success, error } = await endLiveSession(supabase, courseRoomInfo.sessionId)
    if (error || !success) {
      const errorMsg = error?.message || 'Không thể kết thúc buổi học'
      alert(errorMsg)
      throw new Error(errorMsg)
    }
  }, [courseRoomInfo?.sessionId])

  // Realtime subscription for session lifecycle status changes (F-04)
  useEffect(() => {
    const sessionId = courseRoomInfo?.sessionId
    if (!sessionId) return

    const channel = supabase
      .channel(`live_session_status_${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'live_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newStatus = (payload.new as { status?: string })?.status
          if (newStatus === 'ENDED' || newStatus === 'CANCELLED') {
            handleSessionTerminated(newStatus)
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          if (import.meta.env.DEV) {
            console.warn('Realtime channel error for live_session', sessionId)
          }
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [courseRoomInfo?.sessionId, handleSessionTerminated])

  // Fetch LiveKit token from Supabase Edge Function
  const fetchToken = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!user) return
      setLoading(true)
      setError(null)
      setAccessDenied(null)

      try {
        // 1. Check classroom access and enrollment status via RPC
        const { access: accessData } = await checkLiveClassroomAccess(supabase, roomId, user.id)
        if (isCancelled?.()) return

        if (accessData?.is_course_room) {
          setCourseRoomInfo({
            isCourseRoom: true,
            isSession: accessData.is_session,
            sessionId: accessData.session_id,
            sessionTitle: accessData.session_title,
            courseId: accessData.course_id,
            courseTitle: accessData.course_title,
            courseSchedule: accessData.live_schedule,
            allowed: accessData.allowed,
            reason: accessData.reason,
          })

          if (!accessData.allowed) {
            if (accessData.reason === 'not_enrolled') {
              setAccessDenied({
                courseId: accessData.course_id,
                courseTitle: accessData.course_title,
                sessionTitle: accessData.session_title,
                courseSchedule: accessData.live_schedule,
              })
              setLoading(false)
              return
            }
            if (accessData.reason === 'session_not_live') {
              if (accessData.session_status === 'ENDED' || accessData.session_status === 'CANCELLED') {
                isTerminatedRef.current = true
                setSessionTerminatedStatus(accessData.session_status as 'ENDED' | 'CANCELLED')
                setLoading(false)
                return
              }
              setError('Buổi học chưa diễn ra hoặc đã kết thúc. Chỉ buổi học có trạng thái ĐANG DIỄN RA (LIVE) mới có thể vào lớp.')
              setLoading(false)
              return
            }
            setError(accessData.reason || t('liveClassroom.connectionError'))
            setLoading(false)
            return
          }
        }

        // Authoritative teacher ID resolution from DB
        let teacherId =
          accessData?.teacher_id ||
          accessData?.creator_id ||
          (accessData?.is_creator ? user.id : undefined)
        if (!teacherId && accessData?.course_id) {
          const { data: courseRow } = await supabase
            .from('courses')
            .select('creator_id')
            .eq('id', accessData.course_id)
            .maybeSingle()
          if (isCancelled?.()) return
          if (courseRow?.creator_id) {
            teacherId = courseRow.creator_id
          }
        }
        if (isCancelled?.()) return
        setResolvedTeacherId(teacherId)
        setTeacherId(teacherId || null)

        const requestedRole =
          accessData?.is_creator ? 'teacher' : (accessData?.role || preferredRole)

        const { data, error: invokeErr } = await supabase.functions.invoke<TokenResponse>(
          'livekit-token',
          {
            body: {
              roomId,
              userId: user.id,
              role: requestedRole,
              name: profile?.name || user.email?.split('@')[0],
            },
          }
        )
        if (isCancelled?.()) return

        if (invokeErr || !data?.token) {
          let message = invokeErr?.message || t('liveClassroom.connectionError')
          if (invokeErr && typeof invokeErr === 'object' && 'context' in invokeErr) {
            try {
              const res = (invokeErr as { context?: Response }).context
              if (res) {
                if (res.status === 502 || res.status === 503) {
                  message = 'Không thể kết nối đến máy chủ cấp quyền phòng học (Edge Function). Vui lòng đảm bảo dịch vụ Edge Functions đang chạy.'
                } else if (typeof res.json === 'function') {
                  const errJson = await res.json()
                  if (errJson?.reason === 'not_enrolled') {
                    setAccessDenied({
                      courseId: accessData?.course_id,
                      courseTitle: accessData?.course_title,
                      courseSchedule: accessData?.live_schedule,
                    })
                    setLoading(false)
                    return
                  }
                  if (errJson?.error) {
                    message = errJson.error + (errJson.reason ? ` (${errJson.reason})` : '')
                  } else if (errJson?.message) {
                    message = errJson.message
                  }
                }
              }
            } catch {
              // ignore
            }
          }
          throw new Error(message)
        }

        setTokenData(data)
        setMyRole(data.role)
      } catch (err: unknown) {
        if (!isCancelled?.()) {
          console.error('Failed to get LiveKit token:', err)
          setError(err instanceof Error ? err.message : t('liveClassroom.connectionError'))
        }
      } finally {
        if (!isCancelled?.()) {
          setLoading(false)
        }
      }
    },
    [user, profile, roomId, preferredRole, setMyRole, setTeacherId, t]
  )

  useEffect(() => {
    let isCancelled = false
    const cancelCheck = () => isCancelled

    // State isolation: Reset store and local state immediately whenever roomId or user changes
    resetLiveClass()
    setTokenData(null)
    setCourseRoomInfo(null)
    setAccessDenied(null)
    setError(null)
    setResolvedTeacherId(undefined)
    setSessionTerminatedStatus(null)
    isTerminatedRef.current = false

    if (!authLoading && user) {
      fetchToken(cancelCheck)
    } else if (!authLoading && !user) {
      // Check if this room belongs to a course to give proper context
      checkLiveClassroomAccess(supabase, roomId, null)
        .then(({ access: data }) => {
          if (isCancelled) return
          if (data?.is_course_room) {
            setCourseRoomInfo({
              isCourseRoom: true,
              courseId: data.course_id,
              courseTitle: data.course_title,
              courseSchedule: data.live_schedule,
              allowed: false,
              reason: 'unauthenticated',
            })
          }
          setLoading(false)
        })
        .catch(() => {
          if (!isCancelled) setLoading(false)
        })
    }

    return () => {
      isCancelled = true
      resetLiveClass()
    }
  }, [authLoading, user, fetchToken, roomId, resetLiveClass])

  // Loading State
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-8 h-8 text-(--accent) animate-spin mb-3" />
        <h2 className="text-sm font-semibold text-(--ink-1)">{t('liveClassroom.connecting')}</h2>
        <p className="text-xs text-(--ink-3) mt-1">{t('liveClassroom.connectingSubtitle')}</p>
      </div>
    )
  }

  // Unauthenticated State
  if (!user) {
    return (
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6 max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-(--accent-soft) flex items-center justify-center mb-3 text-(--accent)">
          <LogOut className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-(--ink-1) mb-1">{t('liveClassroom.loginRequired')}</h2>
        <p className="text-xs text-(--ink-3) mb-4">
          {courseRoomInfo?.courseTitle
            ? `Vui lòng đăng nhập để tham gia lớp học "${courseRoomInfo.courseTitle}".`
            : 'Vui lòng đăng nhập để tham gia phòng học trực tuyến.'}
        </p>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {t('liveClassroom.backHomeBtn')}
          </Link>
          <Link
            to={`/login?redirect=/live/${roomId}`}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold bg-(--accent) text-white hover:opacity-90 transition-opacity"
          >
            Đăng nhập ngay
          </Link>
        </div>
      </div>
    )
  }

  // Access Denied / Enrollment Required State
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6 max-w-lg mx-auto text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4 text-red-500">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-600 dark:text-red-400 mb-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {t('liveClassroom.courseLiveBadge')}
        </div>
        <h2 className="text-lg font-bold text-(--ink-1) mb-2">
          {t('liveClassroom.enrollRequiredTitle')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-4 max-w-md">
          {t('liveClassroom.enrollRequiredDesc', { title: accessDenied.courseTitle || roomId })}
        </p>
        {accessDenied.courseSchedule && (
          <div className="w-full bg-(--surface-2) border border-(--border) rounded-lg p-3 text-xs text-(--ink-1) mb-6 text-left">
            <span className="font-semibold text-(--ink-3) block mb-1">Lịch học định kỳ:</span>
            <span>{accessDenied.courseSchedule}</span>
          </div>
        )}
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/"
            className="px-4 py-2 rounded-md text-xs font-semibold border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors"
          >
            {t('liveClassroom.backHomeBtn')}
          </Link>
          {accessDenied.courseId && (
            <Link
              to={`/courses/${accessDenied.courseId}`}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-(--accent) text-white hover:opacity-90 transition-opacity"
            >
              {t('liveClassroom.enrollBtn')}
            </Link>
          )}
        </div>
      </div>
    )
  }

  // Session Ended / Terminated State (F-04)
  if (sessionTerminatedStatus) {
    const isCancelled = sessionTerminatedStatus === 'CANCELLED'
    return (
      <div
        className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6 max-w-lg mx-auto text-center"
        data-testid="session-ended-screen"
      >
        <div className="w-14 h-14 rounded-full bg-(--accent-soft) border border-(--accent-border) flex items-center justify-center mb-4 text-(--accent)">
          <StopCircle className="w-7 h-7" />
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-(--surface-2) border border-(--border) text-xs font-bold text-(--ink-2) mb-3">
          <span className="w-2 h-2 rounded-full bg-(--ink-3)" />
          {isCancelled ? 'ĐÃ HỦY' : 'ĐÃ KẾT THÚC'}
        </div>
        <h2 className="text-lg font-bold text-(--ink-1) mb-2">
          {isCancelled ? 'Buổi học đã bị hủy' : 'Buổi học trực tuyến đã kết thúc'}
        </h2>
        <p className="text-sm text-(--ink-2) mb-6 max-w-md">
          {isCancelled
            ? 'Buổi học này đã bị hủy bởi giảng viên hoặc quản trị viên.'
            : 'Giảng viên đã kết thúc buổi học hoặc thời gian phiên đã hết. Cảm ơn bạn đã tham gia!'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to={courseRoomInfo?.courseId ? `/courses/${courseRoomInfo.courseId}` : '/'}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-(--accent) text-white hover:opacity-90 transition-opacity"
          >
            {courseRoomInfo?.courseId ? 'Về trang khóa học' : t('liveClassroom.backHomeBtn')}
          </Link>
          {courseRoomInfo?.sessionId && (
            <>
              <button
                type="button"
                onClick={() => {
                  setTerminatedReplayBoardId(null)
                  setShowTerminatedReplayModal(true)
                }}
                className="px-4 py-2 rounded-md text-xs font-semibold border border-(--border) text-(--ink-1) hover:bg-(--surface-2) transition-colors flex items-center gap-1.5 cursor-pointer"
                data-testid="open-session-replay-btn"
              >
                <Eye className="w-4 h-4 text-(--accent)" />
                <span>Xem lại ván cờ</span>
              </button>
              {(tokenData?.role === 'teacher' || tokenData?.role === 'assistant' || profile?.role === 'admin') && (
                <button
                  type="button"
                  onClick={() => setShowTerminatedAnalyticsModal(true)}
                  className="px-4 py-2 rounded-md text-xs font-semibold border border-(--border) text-(--ink-1) hover:bg-(--surface-2) transition-colors flex items-center gap-1.5 cursor-pointer"
                  data-testid="open-session-analytics-btn"
                >
                  <BarChart2 className="w-4 h-4 text-(--accent)" />
                  <span>Báo cáo buổi học</span>
                </button>
              )}
            </>
          )}
        </div>
        {courseRoomInfo?.sessionId && (
          <>
            <SessionGameReplayModal
              sessionId={courseRoomInfo.sessionId}
              initialBoardId={terminatedReplayBoardId || undefined}
              isOpen={showTerminatedReplayModal}
              onClose={() => {
                setShowTerminatedReplayModal(false)
                setTerminatedReplayBoardId(null)
              }}
            />
            <LiveSessionAnalyticsModal
              sessionId={courseRoomInfo.sessionId}
              isOpen={showTerminatedAnalyticsModal}
              isSuspended={showTerminatedReplayModal}
              onClose={() => setShowTerminatedAnalyticsModal(false)}
              onOpenReplay={(boardId) => {
                setTerminatedReplayBoardId(boardId || null)
                setShowTerminatedReplayModal(true)
              }}
            />
          </>
        )}
      </div>
    )
  }

  // General Connection Error State
  if (error || !tokenData) {
    return (
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6 max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-(--danger-soft) flex items-center justify-center mb-3">
          <AlertCircle className="w-6 h-6 text-(--danger)" />
        </div>
        <h2 className="text-base font-bold text-(--ink-1) mb-1">{t('liveClassroom.connectionError')}</h2>
        <p className="text-xs text-(--ink-3) mb-4">{error}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {t('liveClassroom.back')}
          </button>
          <button
            onClick={() => fetchToken()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-(--accent) text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {t('liveClassroom.retry')}
          </button>
        </div>
      </div>
    )
  }

  const isTeacher = myRole === 'teacher'
  const isAssistant = myRole === 'assistant'

  return (
    <div className="w-full h-screen bg-(--bg) flex flex-col overflow-hidden">
      {/* Top Header Bar: Brand, Room Name, Theme Toggle, Language Toggle, Role, Leave */}
      <header className="w-full bg-(--surface) border-b border-(--border) px-4 py-2.5 flex items-center justify-between shadow-2xs shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-sm text-(--ink-1) hover:text-(--accent) transition-colors"
          >
            <span className="w-6 h-6 rounded-md bg-(--accent) text-white flex items-center justify-center text-xs font-black">
              C
            </span>
            <span>Covunity Live</span>
          </Link>
          <span className="text-(--border-strong) hidden sm:inline">|</span>
          <span className="text-xs font-semibold text-(--ink-2) flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
            <span className="hidden sm:inline">{t('liveClassroom.room')}:</span>
            <span className="text-(--ink-1) font-mono bg-(--surface-2) px-1.5 py-0.5 rounded border border-(--border)">
              {roomId}
            </span>
          </span>
          {courseRoomInfo?.sessionTitle && (
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-600 dark:text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="max-w-[240px] truncate">{courseRoomInfo.sessionTitle}</span>
            </span>
          )}
          {courseRoomInfo?.isCourseRoom && courseRoomInfo.courseTitle && !courseRoomInfo.sessionTitle && (
            <span className="hidden lg:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-600 dark:text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="max-w-[220px] truncate">{courseRoomInfo.courseTitle}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`hidden md:inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              isTeacher
                ? 'bg-(--accent-soft) text-(--accent-ink) border border-(--accent-border)'
                : isAssistant
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                  : 'bg-(--surface-2) text-(--ink-2) border border-(--border)'
            }`}
          >
            {isTeacher
              ? t('liveClassroom.teacherRole')
              : isAssistant
                ? t('liveClassroom.assistantRole', 'Trợ giảng')
                : t('liveClassroom.studentRole')}
          </span>
          <LanguageToggle />
          <ThemeToggle />
          <button
            onClick={handleManualLeave}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-(--danger-soft) text-(--danger) hover:bg-(--danger) hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('liveClassroom.leave')}</span>
          </button>
        </div>
      </header>

      {/* LiveKit Room Canvas */}
      <div className="flex-1 flex flex-col w-full overflow-hidden min-h-0">
        <LiveKitRoom
          token={tokenData.token}
          serverUrl={tokenData.serverUrl}
          connect={true}
          video={false}
          audio={false}
          onDisconnected={handleRoomDisconnected}
          className="flex-1 flex flex-col w-full h-full overflow-hidden"
        >
          <RoomAudioRenderer />
          <ClassroomContent
            currentUserId={user!.id}
            currentUserName={profile?.name || undefined}
            isTeacher={isTeacher}
            teacherId={resolvedTeacherId || (isTeacher ? user!.id : undefined)}
            sessionId={courseRoomInfo?.sessionId}
            onLeave={handleManualLeave}
            onEndClass={handleTeacherEndClass}
            onSessionTerminated={handleSessionTerminated}
          />
        </LiveKitRoom>
      </div>
    </div>
  )
}
