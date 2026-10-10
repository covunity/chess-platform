import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalParticipant, useRoomContext, useDataChannel } from '@livekit/components-react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  LogOut,
  GraduationCap,
  Swords,
  RotateCcw,
  ArrowUpDown,
  PanelRightClose,
  PanelRightOpen,
  UserCheck,
  CheckCircle2,
  StopCircle,
  Eye,
} from 'lucide-react'
import { useLiveClassroomStore } from './useLiveClassroomStore'
import {
  type ClassroomControlPayload,
  LIVEKIT_TOPICS,
  type ClassMode,
} from '../../types/liveClassroom'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from './liveClassroomSecurity'

export interface ClassroomBottomBarProps {
  currentUserId: string
  currentUserName?: string
  isTeacher: boolean
  teacherId?: string
  onLeave: () => void
  onEndClass?: () => Promise<void> | void
  showRightPanel: boolean
  onToggleRightPanel: () => void
  onResetBoard?: () => void
  orientation?: 'white' | 'black'
  onToggleOrientation?: () => void
  onOpenReplay?: () => void
}

export default function ClassroomBottomBar({
  currentUserId,
  isTeacher,
  teacherId: propTeacherId,
  onLeave,
  onEndClass,
  showRightPanel,
  onToggleRightPanel,
  onResetBoard,
  orientation,
  onToggleOrientation,
  onOpenReplay,
}: ClassroomBottomBarProps) {
  const { t } = useTranslation()
  const room = useRoomContext()
  const { isMicrophoneEnabled, isCameraEnabled, localParticipant } = useLocalParticipant()

  // Store state
  const storeTeacherId = useLiveClassroomStore((s) => s.teacherId)
  const effectiveTeacherId = propTeacherId || storeTeacherId || undefined
  const classMode = useLiveClassroomStore((s) => s.classMode)
  const setClassMode = useLiveClassroomStore((s) => s.setClassMode)
  const lectureInteractionUserId = useLiveClassroomStore((s) => s.lectureInteractionUserId)
  const setLectureInteractionUser = useLiveClassroomStore((s) => s.setLectureInteractionUser)
  const raisedHandUserIds = useLiveClassroomStore((s) => s.raisedHandUserIds)
  const addRaisedHand = useLiveClassroomStore((s) => s.addRaisedHand)
  const removeRaisedHand = useLiveClassroomStore((s) => s.removeRaisedHand)

  const [showHandQueuePopover, setShowHandQueuePopover] = useState(false)

  const hasRaisedHand = raisedHandUserIds.includes(currentUserId)
  const isGrantedStudent = lectureInteractionUserId === currentUserId

  // Listen to classroom control for hand events
  const handleControlMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ClassroomControlPayload
        if (payload.type !== 'CLASSROOM_CONTROL') return

        const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)

        if (payload.action === 'RAISE_HAND') {
          addRaisedHand(senderIdentity)
        } else if (payload.action === 'LOWER_HAND') {
          if (isSenderTeacher && payload.targetUserId) {
            removeRaisedHand(payload.targetUserId)
          } else {
            removeRaisedHand(senderIdentity)
          }
        } else if (payload.action === 'GRANT_MAIN_BOARD_CONTROL') {
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn('ClassroomBottomBar: Unauthorized GRANT_MAIN_BOARD_CONTROL from', senderIdentity)
            }
            return
          }
          if (payload.targetUserId) setLectureInteractionUser(payload.targetUserId)
        } else if (payload.action === 'REVOKE_MAIN_BOARD_CONTROL') {
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn('ClassroomBottomBar: Unauthorized REVOKE_MAIN_BOARD_CONTROL from', senderIdentity)
            }
            return
          }
          setLectureInteractionUser(null)
        }
      } catch (err) {
        console.warn('ClassroomBottomBar: Failed to parse control message', err)
      }
    },
    [addRaisedHand, removeRaisedHand, setLectureInteractionUser, effectiveTeacherId]
  )

  useDataChannel(LIVEKIT_TOPICS.CLASSROOM_CONTROL, handleControlMessage)

  // Publish control event helper
  const publishControlEvent = (action: ClassroomControlPayload['action'], targetUserId?: string) => {
    const payload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action,
      senderId: currentUserId,
      messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      targetUserId,
    }

    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    room.localParticipant.publishData(bytes, {
      reliable: true,
      topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
    })
  }

  // Toggle Microphone
  const handleToggleMic = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch (err) {
      console.warn('ClassroomBottomBar: Failed to toggle microphone', err)
    }
  }

  // Toggle Camera
  const handleToggleCam = async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    } catch (err) {
      console.warn('ClassroomBottomBar: Failed to toggle camera', err)
    }
  }

  // Student toggle raise hand
  const handleToggleHand = () => {
    if (hasRaisedHand) {
      removeRaisedHand(currentUserId)
      publishControlEvent('LOWER_HAND')
    } else {
      addRaisedHand(currentUserId)
      publishControlEvent('RAISE_HAND')
    }
  }

  // Teacher grant board control
  const handleGrantControl = (studentId: string) => {
    setLectureInteractionUser(studentId)
    publishControlEvent('GRANT_MAIN_BOARD_CONTROL', studentId)
    setShowHandQueuePopover(false)
  }

  // Teacher revoke board control
  const handleRevokeControl = () => {
    setLectureInteractionUser(null)
    publishControlEvent('REVOKE_MAIN_BOARD_CONTROL')
  }

  // Teacher toggle class mode (MAIN / PRACTICE)
  const handleToggleClassMode = () => {
    if (!isTeacher) return
    const nextMode: ClassMode = classMode === 'MAIN' ? 'PRACTICE' : 'MAIN'
    setClassMode(nextMode)

    const payload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action: 'SET_CLASS_MODE',
      senderId: currentUserId,
      messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      classMode: nextMode,
    }

    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    room.localParticipant.publishData(bytes, {
      reliable: true,
      topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
    })
  }

  const [isEnding, setIsEnding] = useState(false)

  // Teacher ends class for all participants
  const handleEndClass = async () => {
    if (!isTeacher || isEnding) return
    setIsEnding(true)
    try {
      if (onEndClass) {
        await onEndClass()
      }
      publishControlEvent('END_CLASS')
      onLeave()
    } catch (err) {
      console.warn('ClassroomBottomBar: Error during end class', err)
    } finally {
      setIsEnding(false)
    }
  }

  return (
    <div
      data-testid="classroom-bottom-toolbar"
      className="w-full h-16 bg-(--surface) border-t border-(--border) px-4 sm:px-6 flex items-center justify-between shadow-lg shrink-0 z-30"
    >
      {/* ── LEFT: Board & Classroom State ───────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Mode pill */}
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
            classMode === 'MAIN'
              ? 'bg-(--accent-soft) text-(--accent-ink) border border-(--accent-border)'
              : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
          }`}
        >
          {classMode === 'MAIN' ? (
            <>
              <GraduationCap className="w-3.5 h-3.5" />
              <span>{t('liveClassroom.lectureMode')}</span>
            </>
          ) : (
            <>
              <Swords className="w-3.5 h-3.5" />
              <span>{t('liveClassroom.practiceMode')}</span>
            </>
          )}
        </span>

        {/* Board control status pill */}
        {classMode === 'MAIN' && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-(--surface-2) text-(--ink-2) border border-(--border) text-xs">
            {lectureInteractionUserId ? (
              <>
                <UserCheck className="w-3.5 h-3.5 text-(--accent)" />
                <span className="font-medium">
                  {isGrantedStudent
                    ? t('liveClassroom.youGranted')
                    : t('liveClassroom.studentGranted', { id: lectureInteractionUserId.slice(0, 6) })}
                </span>
                {isTeacher && (
                  <button
                    onClick={handleRevokeControl}
                    className="ml-1 text-[11px] text-(--danger) hover:underline font-semibold cursor-pointer"
                  >
                    {t('liveClassroom.revokeControl')}
                  </button>
                )}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-(--success)" />
                <span className="font-medium">{t('liveClassroom.teacherControlled')}</span>
              </>
            )}
          </div>
        )}

        {/* Flip Board button */}
        {onToggleOrientation && (
          <button
            onClick={onToggleOrientation}
            title={orientation === 'white' ? 'Đổi sang quân Đen' : 'Đổi sang quân Trắng'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-(--border) bg-(--surface-2) hover:bg-(--surface-3) text-xs font-semibold text-(--ink-1) transition-colors cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-(--ink-3)" />
            <span className="hidden xl:inline">
              {orientation === 'white' ? 'Trắng' : 'Đen'}
            </span>
          </button>
        )}
      </div>

      {/* ── CENTER: Primary Audio/Video & Teaching Actions ─────────────── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Microphone Toggle */}
        <button
          onClick={handleToggleMic}
          title={isMicrophoneEnabled ? t('liveClassroom.muteMic') : t('liveClassroom.unmuteMic')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full font-semibold text-xs transition-all cursor-pointer shadow-xs ${
            isMicrophoneEnabled
              ? 'bg-(--surface-2) text-(--ink-1) hover:bg-(--surface-3) border border-(--border)'
              : 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/20'
          }`}
        >
          {isMicrophoneEnabled ? <Mic className="w-4 h-4 text-emerald-500" /> : <MicOff className="w-4 h-4" />}
          <span className="hidden md:inline">
            {isMicrophoneEnabled ? t('liveClassroom.muteMic') : t('liveClassroom.unmuteMic')}
          </span>
        </button>

        {/* Camera Toggle */}
        <button
          onClick={handleToggleCam}
          title={isCameraEnabled ? t('liveClassroom.turnOffCam') : t('liveClassroom.turnOnCam')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full font-semibold text-xs transition-all cursor-pointer shadow-xs ${
            isCameraEnabled
              ? 'bg-(--surface-2) text-(--ink-1) hover:bg-(--surface-3) border border-(--border)'
              : 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/20'
          }`}
        >
          {isCameraEnabled ? <Video className="w-4 h-4 text-emerald-500" /> : <VideoOff className="w-4 h-4" />}
          <span className="hidden md:inline">
            {isCameraEnabled ? t('liveClassroom.turnOffCam') : t('liveClassroom.turnOnCam')}
          </span>
        </button>

        {/* Student: Raise Hand Button */}
        {!isTeacher && (
          <button
            onClick={handleToggleHand}
            title={hasRaisedHand ? t('liveClassroom.lowerHand') : t('liveClassroom.raiseHand')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full font-semibold text-xs transition-all cursor-pointer shadow-xs ${
              hasRaisedHand
                ? 'bg-amber-500 text-white shadow-amber-500/30 animate-pulse'
                : 'bg-(--surface-2) text-(--ink-1) hover:bg-(--surface-3) border border-(--border)'
            }`}
          >
            <Hand className="w-4 h-4" />
            <span className="hidden sm:inline">
              {hasRaisedHand ? t('liveClassroom.lowerHand') : t('liveClassroom.raiseHand')}
            </span>
          </button>
        )}

        {/* Teacher: Raised Hand Queue popover button */}
        {isTeacher && raisedHandUserIds.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowHandQueuePopover(!showHandQueuePopover)}
              className="flex items-center gap-2 px-3 py-2 rounded-full font-semibold text-xs bg-amber-500 text-white shadow-md shadow-amber-500/30 animate-pulse cursor-pointer"
            >
              <Hand className="w-4 h-4" />
              <span>{t('liveClassroom.handRaiseList', { count: raisedHandUserIds.length })}</span>
            </button>

            {showHandQueuePopover && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 w-64 p-3 bg-(--surface) border border-(--border) rounded-xl shadow-2xl flex flex-col gap-2 z-50">
                <span className="text-xs font-bold text-(--ink-1)">Học viên xin quyền đi cờ:</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {raisedHandUserIds.map((studentId) => (
                    <div
                      key={studentId}
                      className="flex items-center justify-between p-2 rounded-lg bg-(--surface-2) text-xs"
                    >
                      <span className="font-mono text-xs text-(--ink-1)">
                        {t('liveClassroom.studentGranted', { id: studentId.slice(0, 6) })}
                      </span>
                      <button
                        onClick={() => handleGrantControl(studentId)}
                        className="px-2.5 py-1 text-xs font-semibold bg-(--accent) text-white rounded-md hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        {t('liveClassroom.grant')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Teacher: Reset Board Button (Lecture mode) */}
        {isTeacher && classMode === 'MAIN' && onResetBoard && (
          <button
            onClick={onResetBoard}
            title={t('liveClassroom.resetBoard')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-(--surface-2) hover:bg-(--surface-3) border border-(--border) text-xs font-semibold text-(--ink-1) transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-(--ink-3)" />
            <span className="hidden lg:inline">{t('liveClassroom.resetBoard')}</span>
          </button>
        )}

        {/* Teacher: Toggle Class Mode Button */}
        {isTeacher && (
          <button
            onClick={handleToggleClassMode}
            title={classMode === 'MAIN' ? 'Chuyển sang Chế độ Luyện tập' : 'Chuyển sang Chế độ Giảng bài'}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full font-semibold text-xs text-white transition-all cursor-pointer shadow-xs ${
              classMode === 'MAIN'
                ? 'bg-(--accent) hover:opacity-90'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {classMode === 'MAIN' ? (
              <>
                <Swords className="w-4 h-4" />
                <span className="hidden sm:inline">Chuyển sang Luyện tập</span>
              </>
            ) : (
              <>
                <GraduationCap className="w-4 h-4" />
                <span className="hidden sm:inline">Chuyển sang Giảng bài</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* ── RIGHT: Sidebar Toggle & Leave Class ────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Toggle Right Panel (Khung người dùng) */}
        <button
          onClick={onToggleRightPanel}
          title={showRightPanel ? 'Thu gọn khung người dùng' : 'Mở khung người dùng'}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            showRightPanel
              ? 'bg-(--accent-soft) text-(--accent-ink) border-(--accent-border)'
              : 'bg-(--surface-2) text-(--ink-2) border-(--border) hover:bg-(--surface-3)'
          }`}
        >
          {showRightPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          <span className="hidden xl:inline">Khung người dùng</span>
        </button>

        {/* View Game Replay */}
        {onOpenReplay && (
          <button
            type="button"
            onClick={onOpenReplay}
            title="Xem lại các ván đấu đã lưu trong buổi học"
            className="flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-semibold bg-(--surface-2) text-(--ink-2) border-(--border) hover:bg-(--surface-3) transition-colors cursor-pointer"
            data-testid="bottom-bar-replay-btn"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden xl:inline">Ván đã lưu</span>
          </button>
        )}

        {/* Teacher: End Class for all */}
        {isTeacher && (
          <button
            onClick={handleEndClass}
            title="Kết thúc buổi học cho cả lớp"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-all cursor-pointer shadow-xs"
          >
            <StopCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Kết thúc lớp</span>
          </button>
        )}

        {/* Leave Class */}
        <button
          onClick={onLeave}
          title={t('liveClassroom.leave')}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white border border-red-500/30 transition-all cursor-pointer shadow-xs"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">{t('liveClassroom.leave')}</span>
        </button>
      </div>
    </div>
  )
}
