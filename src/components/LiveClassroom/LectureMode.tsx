import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoomContext, useDataChannel } from '@livekit/components-react'
import { Hand, UserCheck, ShieldAlert, CheckCircle2, RotateCcw } from 'lucide-react'
import LiveBoardSync, { type GameEndDetails } from './Board/LiveBoardSync'
import { useLiveClassroomStore } from './useLiveClassroomStore'
import {
  type ClassroomControlPayload,
  LIVEKIT_TOPICS,
} from '../../types/liveClassroom'
import { START_FEN } from './liveClassroomStore'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from './liveClassroomSecurity'
import { finalizeLiveGame } from '../../lib/liveGameApi'
import { supabase } from '../../lib/supabase'

export interface LectureModeProps {
  currentUserId: string
  currentUserName?: string
  isTeacher: boolean
  teacherId?: string
  sessionId?: string
  orientation?: 'white' | 'black'
}

export default function LectureMode({
  currentUserId,
  currentUserName,
  isTeacher,
  teacherId: propTeacherId,
  sessionId,
  orientation = 'white',
}: LectureModeProps) {
  const { t } = useTranslation()
  const room = useRoomContext()

  // Store state
  const storeTeacherId = useLiveClassroomStore((s) => s.teacherId)
  const effectiveTeacherId = propTeacherId || storeTeacherId || undefined
  const currentFen = useLiveClassroomStore((s) => s.currentFen)
  const lectureInteractionUserId = useLiveClassroomStore((s) => s.lectureInteractionUserId)
  const raisedHandUserIds = useLiveClassroomStore((s) => s.raisedHandUserIds)
  const setLectureInteractionUser = useLiveClassroomStore((s) => s.setLectureInteractionUser)
  const addRaisedHand = useLiveClassroomStore((s) => s.addRaisedHand)
  const removeRaisedHand = useLiveClassroomStore((s) => s.removeRaisedHand)
  const updateFen = useLiveClassroomStore((s) => s.updateFen)

  const isGrantedStudent = lectureInteractionUserId === currentUserId
  const canInteract = isTeacher || isGrantedStudent
  const hasRaisedHand = raisedHandUserIds.includes(currentUserId)

  // Listen to classroom control events
  const handleControlMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ClassroomControlPayload

        if (payload.type !== 'CLASSROOM_CONTROL') return

        const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)

        switch (payload.action) {
          case 'RAISE_HAND':
            // Bind to transport sender identity to prevent impersonation
            addRaisedHand(senderIdentity)
            break
          case 'LOWER_HAND':
            if (isSenderTeacher && payload.targetUserId) {
              removeRaisedHand(payload.targetUserId)
            } else {
              removeRaisedHand(senderIdentity)
            }
            break
          case 'GRANT_MAIN_BOARD_CONTROL':
            if (!isSenderTeacher) {
              if (import.meta.env.DEV) {
                console.warn('LectureMode: Unauthorized GRANT_MAIN_BOARD_CONTROL from', senderIdentity)
              }
              return
            }
            if (payload.targetUserId) {
              setLectureInteractionUser(payload.targetUserId)
            }
            break
          case 'REVOKE_MAIN_BOARD_CONTROL':
            if (!isSenderTeacher) {
              if (import.meta.env.DEV) {
                console.warn('LectureMode: Unauthorized REVOKE_MAIN_BOARD_CONTROL from', senderIdentity)
              }
              return
            }
            setLectureInteractionUser(null)
            break
          default:
            break
        }
      } catch (err) {
        console.warn('LectureMode: Failed to parse control message', err)
      }
    },
    [addRaisedHand, removeRaisedHand, setLectureInteractionUser, effectiveTeacherId]
  )

  useDataChannel(LIVEKIT_TOPICS.CLASSROOM_CONTROL, handleControlMessage)

  // Publish a control event to the entire classroom
  const publishControlEvent = (action: ClassroomControlPayload['action'], targetUserId?: string) => {
    const payload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action,
      senderId: currentUserId,
      messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      targetUserId,
    }

    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
    room.localParticipant.publishData(payloadBytes, {
      reliable: true,
      topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
    })
  }

  // Student toggle hand
  const handleToggleHand = () => {
    if (hasRaisedHand) {
      removeRaisedHand(currentUserId)
      publishControlEvent('LOWER_HAND')
    } else {
      addRaisedHand(currentUserId)
      publishControlEvent('RAISE_HAND')
    }
  }

  // Teacher grant control to student
  const handleGrantControl = (studentId: string) => {
    setLectureInteractionUser(studentId)
    publishControlEvent('GRANT_MAIN_BOARD_CONTROL', studentId)
  }

  // Teacher revoke control
  const handleRevokeControl = () => {
    setLectureInteractionUser(null)
    publishControlEvent('REVOKE_MAIN_BOARD_CONTROL')
  }

  // Teacher reset board to start
  const handleResetBoard = () => {
    updateFen(START_FEN)
  }

  // Authoritative game completion persistence for main board (teacher only)
  const handleMainGameEnd = useCallback(
    async (finalPgn: string, details?: GameEndDetails) => {
      if (!sessionId || !isTeacher || !details) return

      try {
        await finalizeLiveGame(supabase, {
          gameId: details.gameId,
          sessionId,
          boardId: 'main',
          gameScope: 'MAIN',
          whiteUserId: effectiveTeacherId || currentUserId,
          blackUserId: lectureInteractionUserId || null,
          startingFen: START_FEN,
          finalFen: details.finalFen,
          pgn: details.finalPgn,
          result: details.result,
          terminationReason: details.terminationReason,
          status: 'COMPLETED',
          moveCount: details.moveCount,
          startedAt: details.startedAt,
          endedAt: details.endedAt,
        })
      } catch (err) {
        console.warn('LectureMode: Failed to finalize main board game', err)
      }
    },
    [sessionId, isTeacher, effectiveTeacherId, currentUserId, lectureInteractionUserId]
  )

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Lecture Control Bar */}
      <div className="w-full max-w-[560px] flex items-center justify-between px-4 py-2 bg-(--surface) border border-(--border) rounded-lg shadow-xs">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-(--ink-1)">{t('liveClassroom.boardControl')}</span>
          {lectureInteractionUserId ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-(--accent-soft) text-(--accent-ink) font-medium">
              <UserCheck className="w-3.5 h-3.5 text-(--accent)" />
              {isGrantedStudent
                ? t('liveClassroom.youGranted')
                : t('liveClassroom.studentGranted', { id: lectureInteractionUserId.slice(0, 6) })}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-(--surface-2) text-(--ink-2) font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-(--success)" />
              {t('liveClassroom.teacherControlled')}
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Teacher: Revoke Button & Reset Button */}
          {isTeacher && (
            <>
              {lectureInteractionUserId && (
                <button
                  onClick={handleRevokeControl}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-(--danger-soft) text-(--danger) hover:opacity-90 transition-opacity border border-(--danger)/20 cursor-pointer"
                >
                  {t('liveClassroom.revokeControl')}
                </button>
              )}
              <button
                onClick={handleResetBoard}
                title={t('liveClassroom.resetBoard')}
                className="p-1 text-(--ink-3) hover:text-(--ink-1) rounded-md hover:bg-(--surface-2) transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Student: Raise Hand Button */}
          {!isTeacher && (
            <button
              onClick={handleToggleHand}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                hasRaisedHand
                  ? 'bg-amber-500 text-white shadow-xs animate-pulse'
                  : 'bg-(--surface-2) text-(--ink-2) hover:bg-(--surface-3) border border-(--border)'
              }`}
            >
              <Hand className="w-3.5 h-3.5" />
              {hasRaisedHand ? t('liveClassroom.lowerHand') : t('liveClassroom.raiseHand')}
            </button>
          )}
        </div>
      </div>

      {/* Teacher: Raised Hands Queue */}
      {isTeacher && raisedHandUserIds.length > 0 && (
        <div className="w-full max-w-[560px] p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <Hand className="w-4 h-4 text-amber-600" />
            <span>{t('liveClassroom.handRaiseList', { count: raisedHandUserIds.length })}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {raisedHandUserIds.map((studentId) => (
              <div
                key={studentId}
                className="flex items-center gap-2 px-2.5 py-1 bg-(--surface) rounded-md border border-amber-300 dark:border-amber-800 text-xs shadow-2xs"
              >
                <span className="font-mono text-[11px] text-(--ink-2)">
                  {t('liveClassroom.studentGranted', { id: studentId.slice(0, 6) })}
                </span>
                <button
                  onClick={() => handleGrantControl(studentId)}
                  className="px-2 py-0.5 text-[11px] font-semibold bg-(--accent) text-white rounded hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {t('liveClassroom.grant')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Student Interaction Alert */}
      {isGrantedStudent && (
        <div className="w-full max-w-[560px] px-3 py-2 rounded-md bg-(--success-soft) border border-(--success)/30 text-(--success) text-xs font-medium flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          <span>{t('liveClassroom.grantedBanner')}</span>
        </div>
      )}

      {/* Synchronized Lecture Board */}
      <LiveBoardSync
        initialFen={currentFen}
        isTeacher={isTeacher}
        teacherId={effectiveTeacherId}
        boardId="main"
        canInteract={canInteract}
        orientation={orientation}
        currentUserId={currentUserId}
        onGameEnd={handleMainGameEnd}
        size={520}
      />
    </div>
  )
}
