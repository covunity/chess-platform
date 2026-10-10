import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useLocalParticipant,
  useParticipants,
  useTracks,
  VideoTrack,
  isTrackReference,
  useRoomContext,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  LogOut,
  GraduationCap,
  Swords,
  Volume2,
} from 'lucide-react'
import { useLiveClassroomStore } from '../useLiveClassroomStore'
import {
  type ClassroomControlPayload,
  LIVEKIT_TOPICS,
  type ClassMode,
} from '../../../types/liveClassroom'

export interface ClassroomMediaBarProps {
  currentUserId: string
  isTeacher: boolean
  onLeave: () => void
  hideBottomControls?: boolean
}

export default function ClassroomMediaBar({
  currentUserId,
  isTeacher,
  onLeave,
  hideBottomControls = false,
}: ClassroomMediaBarProps) {
  const { t } = useTranslation()
  const room = useRoomContext()
  const { isMicrophoneEnabled, isCameraEnabled, localParticipant } = useLocalParticipant()
  const participants = useParticipants()
  const [showParticipantList, setShowParticipantList] = useState(false)

  // Class Mode from Zustand
  const classMode = useLiveClassroomStore((s) => s.classMode)
  const setClassMode = useLiveClassroomStore((s) => s.setClassMode)

  // Query camera tracks with placeholders for video tiles
  const trackRefs = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])

  // Toggle Microphone
  const handleToggleMic = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch (err) {
      console.warn('ClassroomMediaBar: Failed to toggle microphone', err)
    }
  }

  // Toggle Camera
  const handleToggleCam = async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    } catch (err) {
      console.warn('ClassroomMediaBar: Failed to toggle camera', err)
    }
  }

  // Teacher switches class mode
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

  return (
    <div className={`flex flex-col bg-(--surface) overflow-hidden ${hideBottomControls ? '' : 'rounded-lg border border-(--border) shadow-xs'}`}>
      {/* Top Header: Participant count & Mode badge */}
      <div className="px-3 py-2 bg-(--surface-2) border-b border-(--border) flex items-center justify-between">
        <button
          onClick={() => setShowParticipantList(!showParticipantList)}
          className="flex items-center gap-1.5 text-xs font-semibold text-(--ink-1) hover:text-(--accent) transition-colors cursor-pointer"
        >
          <Users className="w-3.5 h-3.5 text-(--accent)" />
          <span>{t('liveClassroom.participants', { count: participants.length })}</span>
        </button>

        {isTeacher ? (
          <button
            onClick={handleToggleClassMode}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
              classMode === 'MAIN'
                ? 'bg-(--accent) text-white hover:opacity-90'
                : 'bg-indigo-600 text-white hover:opacity-90'
            }`}
          >
            {classMode === 'MAIN' ? (
              <>
                <GraduationCap className="w-3.5 h-3.5" /> {t('liveClassroom.lectureMode')}
              </>
            ) : (
              <>
                <Swords className="w-3.5 h-3.5" /> {t('liveClassroom.practiceMode')}
              </>
            )}
          </button>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-(--surface-3) text-(--ink-2)">
            {classMode === 'MAIN' ? t('liveClassroom.lectureMode') : t('liveClassroom.practiceMode')}
          </span>
        )}
      </div>

      {/* Participant List dropdown/popover if toggled */}
      {showParticipantList && (
        <div className="p-3 bg-(--surface-2) border-b border-(--border) max-h-40 overflow-y-auto space-y-1.5 text-xs">
          {participants.map((p) => (
            <div
              key={p.identity}
              className="flex items-center justify-between py-1 px-2 rounded bg-(--surface) border border-(--border)"
            >
              <div className="flex items-center gap-1.5 truncate">
                {p.isSpeaking && <Volume2 className="w-3.5 h-3.5 text-(--success) animate-pulse" />}
                <span className="truncate font-medium text-(--ink-1)">
                  {p.name || p.identity.slice(0, 8)}
                  {p.identity === currentUserId ? ` (${t('liveClassroom.you')})` : ''}
                </span>
              </div>
              <div className="flex items-center gap-1 text-(--ink-3)">
                {p.isMicrophoneEnabled ? (
                  <Mic className="w-3 h-3 text-(--success)" />
                ) : (
                  <MicOff className="w-3 h-3 text-(--danger)" />
                )}
                {p.isCameraEnabled ? (
                  <Video className="w-3 h-3 text-(--success)" />
                ) : (
                  <VideoOff className="w-3 h-3 text-(--ink-4)" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Strip / Carousel */}
      <div className="p-2 bg-neutral-900 grid grid-cols-2 gap-2 min-h-36 max-h-56 overflow-y-auto">
        {trackRefs.length === 0 ? (
          <div className="col-span-2 flex items-center justify-center text-xs text-neutral-400 py-6">
            {t('liveClassroom.noCameras')}
          </div>
        ) : (
          trackRefs.map((trackRef) => {
            const isSpeaking = trackRef.participant?.isSpeaking
            const hasVideo = trackRef.publication?.isSubscribed && !trackRef.publication?.isMuted

            return (
              <div
                key={`${trackRef.participant.identity}-${trackRef.source}`}
                className={`relative rounded-md overflow-hidden bg-neutral-800 aspect-video flex items-center justify-center border ${
                  isSpeaking ? 'border-(--success) ring-2 ring-(--success)/40' : 'border-neutral-700'
                }`}
              >
                {isTrackReference(trackRef) && hasVideo ? (
                  <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-neutral-300 text-xs">
                    <div className="w-8 h-8 rounded-full bg-(--accent) text-white flex items-center justify-center font-bold text-xs mb-1">
                      {(trackRef.participant.name || trackRef.participant.identity)[0]?.toUpperCase()}
                    </div>
                    <span className="text-[10px] text-neutral-400 truncate max-w-[80px]">
                      {trackRef.participant.name || trackRef.participant.identity.slice(0, 6)}
                    </span>
                  </div>
                )}

                {/* Participant name tag overlay */}
                <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] truncate max-w-[90%]">
                  {trackRef.participant.name || trackRef.participant.identity.slice(0, 6)}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Control Buttons Footer */}
      {!hideBottomControls && (
        <div className="p-2.5 bg-(--surface) border-t border-(--border) flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Mic Toggle */}
            <button
              onClick={handleToggleMic}
              title={isMicrophoneEnabled ? t('liveClassroom.muteMic') : t('liveClassroom.unmuteMic')}
              className={`p-2 rounded-md transition-colors cursor-pointer ${
                isMicrophoneEnabled
                  ? 'bg-(--surface-2) text-(--ink-1) hover:bg-(--surface-3)'
                  : 'bg-(--danger-soft) text-(--danger) hover:opacity-90'
              }`}
            >
              {isMicrophoneEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            {/* Camera Toggle */}
            <button
              onClick={handleToggleCam}
              title={isCameraEnabled ? t('liveClassroom.turnOffCam') : t('liveClassroom.turnOnCam')}
              className={`p-2 rounded-md transition-colors cursor-pointer ${
                isCameraEnabled
                  ? 'bg-(--surface-2) text-(--ink-1) hover:bg-(--surface-3)'
                  : 'bg-(--danger-soft) text-(--danger) hover:opacity-90'
              }`}
            >
              {isCameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>
          </div>

          {/* Leave Class */}
          <button
            onClick={onLeave}
            title={t('liveClassroom.leave')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-(--danger-soft) text-(--danger) hover:bg-(--danger) hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('liveClassroom.leave')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
