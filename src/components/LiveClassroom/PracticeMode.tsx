import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoomContext, useDataChannel, useParticipants } from '@livekit/components-react'
import {
  Users,
  Swords,
  CheckCircle,
  Clock,
  Plus,
  ChevronLeft,
  ChevronRight,
  Eye,
  StopCircle,
} from 'lucide-react'
import LiveBoardSync, { type GameEndDetails, type LiveBoardSyncHandle } from './Board/LiveBoardSync'
import ClassroomChat from './Chat/ClassroomChat'
import { useLiveClassroomStore } from './useLiveClassroomStore'
import { finalizeLiveGame } from '../../lib/liveGameApi'
import { supabase } from '../../lib/supabase'
import {
  type PracticeAssignment,
  type PracticeBoardStatus,
  type ClassroomControlPayload,
  LIVEKIT_TOPICS,
} from '../../types/liveClassroom'
import { START_FEN } from './liveClassroomStore'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from './liveClassroomSecurity'

export interface PracticeModeProps {
  currentUserId: string
  currentUserName?: string
  isTeacher: boolean
  teacherId?: string
  sessionId?: string
  boardSyncRef?: React.Ref<LiveBoardSyncHandle>
}

export default function PracticeMode({
  currentUserId,
  currentUserName,
  isTeacher,
  teacherId,
  sessionId,
  boardSyncRef,
}: PracticeModeProps) {
  const { t } = useTranslation()
  const room = useRoomContext()
  const participants = useParticipants()

  // Zustand Store
  const practiceAssignments = useLiveClassroomStore((s) => s.practiceAssignments)
  const activePracticeBoardId = useLiveClassroomStore((s) => s.activePracticeBoardId)
  const boardFens = useLiveClassroomStore((s) => s.boardFens)
  const boardMoves = useLiveClassroomStore((s) => s.boardMoves)
  const setAssignments = useLiveClassroomStore((s) => s.setAssignments)
  const updateAssignmentStatus = useLiveClassroomStore((s) => s.updateAssignmentStatus)
  const setActivePracticeBoard = useLiveClassroomStore((s) => s.setActivePracticeBoard)

  // Teacher Creation Modal / Form State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newWhiteUserId, setNewWhiteUserId] = useState('')
  const [newBlackUserId, setNewBlackUserId] = useState('')

  // Replay scrubber state for finished boards
  const [replayIndex, setReplayIndex] = useState<number | null>(null)

  // Track live board handle & active game identities
  const liveBoardRef = useRef<LiveBoardSyncHandle | null>(null)
  const activeGamesMetadataRef = useRef<Map<string, { gameId: string; startedAt: string }>>(new Map())
  const finalizedGamesRef = useRef<Set<string>>(new Set())

  const handleBoardSyncRef = useCallback(
    (instance: LiveBoardSyncHandle | null) => {
      liveBoardRef.current = instance
      if (boardSyncRef) {
        if (typeof boardSyncRef === 'function') {
          boardSyncRef(instance)
        } else if ('current' in boardSyncRef) {
          ;(boardSyncRef as React.MutableRefObject<LiveBoardSyncHandle | null>).current = instance
        }
      }
    },
    [boardSyncRef]
  )

  // Find student's assigned board
  const studentAssignment = useMemo(() => {
    return practiceAssignments.find(
      (a) => a.whiteUserId === currentUserId || a.blackUserId === currentUserId
    )
  }, [practiceAssignments, currentUserId])

  // Active board to render:
  // For student: their assigned board (or the board they are spectating if unassigned)
  // For teacher: the board they explicitly clicked "Watching Board X"
  const currentBoardId = useMemo(() => {
    if (isTeacher) {
      if (activePracticeBoardId) return activePracticeBoardId
      return practiceAssignments[0]?.boardId || null
    }
    return studentAssignment?.boardId || activePracticeBoardId || practiceAssignments[0]?.boardId || null
  }, [isTeacher, activePracticeBoardId, studentAssignment, practiceAssignments])

  const currentBoard = useMemo(() => {
    return practiceAssignments.find((a) => a.boardId === currentBoardId) || null
  }, [practiceAssignments, currentBoardId])

  // Determine role & perspective for currentBoard
  const isAssignedPlayer = Boolean(
    currentBoard &&
      (currentBoard.whiteUserId === currentUserId || currentBoard.blackUserId === currentUserId)
  )

  const playerColor: 'white' | 'black' =
    currentBoard?.blackUserId === currentUserId ? 'black' : 'white'

  const opponentId = useMemo(() => {
    if (!currentBoard) return undefined
    return currentBoard.whiteUserId === currentUserId
      ? currentBoard.blackUserId
      : currentBoard.whiteUserId
  }, [currentBoard, currentUserId])

  const canInteract = Boolean(
    isAssignedPlayer &&
      currentBoard?.status === 'PLAYING'
  )

  // Virtual breakout media: Apply publisher-side permissions
  useEffect(() => {
    if (!room?.localParticipant) return

    if (!isTeacher && currentBoard && opponentId) {
      // Student in practice: only opponent and teacher may subscribe to student's tracks
      const allowedTargets = [opponentId, teacherId].filter(
        (id): id is string => Boolean(id && id.trim())
      )

      try {
        room.localParticipant.setTrackSubscriptionPermissions(
          false,
          allowedTargets.map((id) => ({
            participantIdentity: id,
            allowAll: true,
          }))
        )
      } catch (err) {
        console.warn('Failed to set track subscription permissions', err)
      }
    } else {
      // Teacher or unassigned participant allows all
      try {
        room.localParticipant.setTrackSubscriptionPermissions(true)
      } catch (err) {
        console.warn('Failed to reset track subscription permissions', err)
      }
    }

    return () => {
      try {
        room?.localParticipant?.setTrackSubscriptionPermissions(true)
      } catch {
        // ignore on unmount
      }
    }
  }, [room, isTeacher, currentBoard, opponentId, teacherId])

  const storeTeacherId = useLiveClassroomStore((s) => s.teacherId)
  const practiceRevision = useLiveClassroomStore((s) => s.practiceRevision)
  const effectiveTeacherId = teacherId || storeTeacherId || undefined

  // F-06: Student requests practice assignments snapshot on mount/connect
  useEffect(() => {
    if (isTeacher) return
    const payload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action: 'REQUEST_PRACTICE_ASSIGNMENTS',
      senderId: currentUserId,
      messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
    }
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    try {
      room?.localParticipant?.publishData(bytes, {
        reliable: true,
        topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
        destinationIdentities: effectiveTeacherId ? [effectiveTeacherId] : undefined,
      })
    } catch (err) {
      console.warn('PracticeMode: Failed to send REQUEST_PRACTICE_ASSIGNMENTS', err)
    }
  }, [isTeacher, currentUserId, effectiveTeacherId, room])

  // Listen to classroom control messages for board assignments
  const handleControlMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ClassroomControlPayload

        if (payload.type !== 'CLASSROOM_CONTROL') return

        const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)

        if (payload.action === 'REQUEST_PRACTICE_ASSIGNMENTS') {
          // Teacher responds with authoritative assignments snapshot
          if (!isTeacher) return

          const snapshot: ClassroomControlPayload = {
            type: 'CLASSROOM_CONTROL',
            action: 'PRACTICE_ASSIGNMENTS_SYNC',
            senderId: currentUserId,
            messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: Date.now(),
            assignments: practiceAssignments,
            revision: practiceRevision,
          }

          const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
          room?.localParticipant?.publishData(bytes, {
            reliable: true,
            topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
            destinationIdentities: [senderIdentity], // targeted strictly to requesting learner
          })
        } else if (payload.action === 'PRACTICE_ASSIGNMENTS_SYNC' || payload.action === 'ASSIGN_PRACTICE_BOARDS') {
          // Learner applies assignment snapshot / update from authoritative teacher
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn(`PracticeMode: Unauthorized ${payload.action} from`, senderIdentity)
            }
            return
          }

          if (payload.assignments) {
            setAssignments(payload.assignments, payload.revision)
          }
        } else if (payload.action === 'UPDATE_PRACTICE_BOARD_STATUS' && payload.boardId && payload.boardStatus) {
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn('PracticeMode: Unauthorized UPDATE_PRACTICE_BOARD_STATUS from', senderIdentity)
            }
            return
          }
          updateAssignmentStatus(payload.boardId, payload.boardStatus)
        }
      } catch (err) {
        console.warn('PracticeMode: Failed to parse control message', err)
      }
    },
    [isTeacher, currentUserId, practiceAssignments, practiceRevision, effectiveTeacherId, room, setAssignments, updateAssignmentStatus]
  )

  useDataChannel(LIVEKIT_TOPICS.CLASSROOM_CONTROL, handleControlMessage)

  // Broadcast assignment updates
  const publishAssignmentUpdate = (updatedAssignments: PracticeAssignment[], revision: number) => {
    const payload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action: 'ASSIGN_PRACTICE_BOARDS',
      senderId: currentUserId,
      messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      assignments: updatedAssignments,
      revision,
    }

    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    room.localParticipant.publishData(bytes, {
      reliable: true,
      topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
    })
  }

  // Teacher: Create a new practice board
  const handleCreateBoard = () => {
    if (!newWhiteUserId || !newBlackUserId || newWhiteUserId === newBlackUserId) return

    const boardId = String(practiceAssignments.length + 1)
    const whiteParticipant = participants.find((p) => p.identity === newWhiteUserId)
    const blackParticipant = participants.find((p) => p.identity === newBlackUserId)

    const newAssignment: PracticeAssignment = {
      boardId,
      whiteUserId: newWhiteUserId,
      blackUserId: newBlackUserId,
      whiteUserName: whiteParticipant?.name || `Player White (${newWhiteUserId.slice(0, 6)})`,
      blackUserName: blackParticipant?.name || `Player Black (${newBlackUserId.slice(0, 6)})`,
      status: 'PLAYING',
    }

    const nextAssignments = [...practiceAssignments, newAssignment]
    const nextRevision = practiceRevision + 1
    setAssignments(nextAssignments, nextRevision)
    setActivePracticeBoard(boardId)
    publishAssignmentUpdate(nextAssignments, nextRevision)

    setShowCreateModal(false)
    setNewWhiteUserId('')
    setNewBlackUserId('')
  }

  // Teacher manual board stop
  const handleTeacherEndBoard = () => {
    if (!currentBoard) return
    const boardId = currentBoard.boardId

    let details: GameEndDetails | undefined
    if (liveBoardRef.current && currentBoardId === boardId) {
      details = liveBoardRef.current.endGameManually('board_stopped_by_teacher')
    } else {
      const activeMeta = activeGamesMetadataRef.current.get(boardId)
      if (activeMeta) {
        details = {
          gameId: activeMeta.gameId,
          startedAt: activeMeta.startedAt,
          endedAt: new Date().toISOString(),
          finalPgn: '',
          finalFen: boardFens[boardId] || START_FEN,
          moveCount: boardMoves[boardId]?.length || 0,
          result: '*',
          terminationReason: 'board_stopped_by_teacher',
        }
      }
    }

    handleEndBoard(boardId, details?.finalPgn, details)
  }

  // Teacher / Game Completion: End a practice board
  const handleEndBoard = async (boardId: string, finalPgn?: string, details?: GameEndDetails) => {
    // Prevent duplicate finalization calls
    if (details?.gameId && finalizedGamesRef.current.has(details.gameId)) {
      return
    }

    const nextAssignments = practiceAssignments.map((a) =>
      a.boardId === boardId ? { ...a, status: 'FINISHED' as PracticeBoardStatus, finalPgn: finalPgn || a.finalPgn } : a
    )
    const nextRevision = practiceRevision + 1
    setAssignments(nextAssignments, nextRevision)
    publishAssignmentUpdate(nextAssignments, nextRevision)

    const payload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action: 'UPDATE_PRACTICE_BOARD_STATUS',
      senderId: currentUserId,
      messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      boardId,
      boardStatus: 'FINISHED',
    }

    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    room.localParticipant.publishData(bytes, {
      reliable: true,
      topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
    })

    // Persist finalized game to live_games (idempotent)
    if (sessionId) {
      const board = practiceAssignments.find((a) => a.boardId === boardId)
      if (board) {
        const isWhite = board.whiteUserId === currentUserId
        const isBlack = board.blackUserId === currentUserId
        // Teacher or assigned players may submit
        if (isTeacher || isWhite || isBlack) {
          const activeMeta = activeGamesMetadataRef.current.get(boardId)
          const gameId = details?.gameId || activeMeta?.gameId
          if (!gameId) {
            console.warn(`PracticeMode: No active game identity found for board ${boardId}, skipping persistence`)
            return
          }

          if (finalizedGamesRef.current.has(gameId)) {
            return
          }
          finalizedGamesRef.current.add(gameId)
          activeGamesMetadataRef.current.delete(boardId)

          const finalFen = details?.finalFen || boardFens[boardId] || null
          const moves = boardMoves[boardId] || []
          const moveCount = details?.moveCount ?? moves.length
          const result = details?.result || '*'
          const status = details && details.result !== '*' ? 'COMPLETED' : 'ABORTED'
          const reason = details?.terminationReason || 'board_stopped_by_teacher'
          const startedAt = details?.startedAt || activeMeta?.startedAt || new Date().toISOString()
          const endedAt = details?.endedAt || new Date().toISOString()

          try {
            await finalizeLiveGame(supabase, {
              gameId,
              sessionId,
              boardId,
              gameScope: 'PRACTICE',
              whiteUserId: board.whiteUserId,
              blackUserId: board.blackUserId,
              startingFen: START_FEN,
              finalFen,
              pgn: finalPgn || details?.finalPgn || null,
              result,
              terminationReason: reason,
              status,
              moveCount,
              startedAt,
              endedAt,
            })
          } catch (err) {
            console.warn('PracticeMode: Failed to finalize practice live game', err)
          }
        }
      }
    }
  }

  // Replay scrubber for finished games
  const activeMoves = currentBoardId ? boardMoves[currentBoardId] || [] : []
  const displayFen = useMemo(() => {
    if (!currentBoardId) return START_FEN
    if (currentBoard?.status === 'FINISHED' && replayIndex !== null) {
      if (replayIndex === -1) return START_FEN
      return activeMoves[replayIndex]?.fen || boardFens[currentBoardId] || START_FEN
    }
    return boardFens[currentBoardId] || START_FEN
  }, [currentBoardId, currentBoard, replayIndex, activeMoves, boardFens])

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Practice Header / Watching Context */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-(--surface) border border-(--border) rounded-lg shadow-xs">
        <div className="flex items-center gap-2 text-xs">
          <Swords className="w-4 h-4 text-(--accent)" />
          {currentBoard ? (
            <span className="font-semibold text-(--ink-1)">
              {isTeacher
                ? t('liveClassroom.watchingBoard', {
                    id: currentBoard.boardId,
                    white: currentBoard.whiteUserName,
                    black: currentBoard.blackUserName,
                  })
                : isAssignedPlayer
                ? t('liveClassroom.yourBoard', {
                    id: currentBoard.boardId,
                    color: playerColor === 'white' ? t('liveClassroom.white') : t('liveClassroom.black'),
                  })
                : t('liveClassroom.spectatingBoard', {
                    id: currentBoard.boardId,
                    white: currentBoard.whiteUserName,
                    black: currentBoard.blackUserName,
                  })}
            </span>
          ) : (
            <span className="text-(--ink-3)">{t('liveClassroom.noBoards')}</span>
          )}

          {currentBoard && (
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 ${
                currentBoard.status === 'PLAYING'
                  ? 'bg-(--success-soft) text-(--success)'
                  : currentBoard.status === 'FINISHED'
                  ? 'bg-(--surface-3) text-(--ink-3)'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {currentBoard.status === 'PLAYING' ? (
                <>
                  <Clock className="w-3 h-3" /> {t('liveClassroom.playing')}
                </>
              ) : (
                <>
                  <CheckCircle className="w-3 h-3" /> {t('liveClassroom.finished')}
                </>
              )}
            </span>
          )}
        </div>

        {/* Teacher Board Actions */}
        {isTeacher && (
          <div className="flex items-center gap-2">
            {currentBoard && currentBoard.status === 'PLAYING' && (
              <button
                onClick={handleTeacherEndBoard}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-(--danger-soft) text-(--danger) hover:opacity-90 border border-(--danger)/20 transition-opacity cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" /> {t('liveClassroom.endBoard')}
              </button>
            )}
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-(--accent) text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> {t('liveClassroom.newBoard')}
            </button>
          </div>
        )}
      </div>

      {/* Main Practice Workspace: Board on Left, Board List / Chat on Right */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Board Area */}
        <div className="flex-1 flex flex-col items-center">
          {currentBoardId ? (
            <div className="flex flex-col items-center">
              <LiveBoardSync
                key={currentBoardId}
                ref={handleBoardSyncRef}
                initialFen={displayFen}
                isTeacher={isTeacher}
                boardId={currentBoardId}
                opponentId={opponentId}
                teacherId={teacherId}
                canInteract={canInteract && replayIndex === null}
                orientation={isTeacher ? 'white' : playerColor}
                currentUserId={currentUserId}
                gameId={activeGamesMetadataRef.current.get(currentBoardId)?.gameId}
                initialStartedAt={activeGamesMetadataRef.current.get(currentBoardId)?.startedAt}
                onGameInit={(meta) => {
                  activeGamesMetadataRef.current.set(meta.boardId, {
                    gameId: meta.gameId,
                    startedAt: meta.startedAt,
                  })
                }}
                onGameEnd={(finalPgn, details) => handleEndBoard(currentBoardId, finalPgn, details)}
                size={500}
              />

              {/* Replay Controls if game finished */}
              {currentBoard?.status === 'FINISHED' && activeMoves.length > 0 && (
                <div className="mt-3 flex items-center gap-2 p-2 bg-(--surface) border border-(--border) rounded-lg text-xs">
                  <span className="font-semibold text-(--ink-2) mr-1">{t('liveClassroom.replay')}</span>
                  <button
                    onClick={() => setReplayIndex(-1)}
                    disabled={replayIndex === -1}
                    className="px-2 py-1 bg-(--surface-2) rounded hover:bg-(--surface-3) disabled:opacity-40 cursor-pointer text-(--ink-1)"
                  >
                    {t('liveClassroom.start')}
                  </button>
                  <button
                    onClick={() =>
                      setReplayIndex((prev) => (prev === null ? activeMoves.length - 2 : Math.max(-1, prev - 1)))
                    }
                    disabled={replayIndex === -1}
                    className="p-1 bg-(--surface-2) rounded hover:bg-(--surface-3) disabled:opacity-40 cursor-pointer text-(--ink-1)"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-[11px] text-(--ink-1) px-1">
                    {replayIndex === null || replayIndex === -1
                      ? '0'
                      : replayIndex + 1}
                    {' / '}
                    {activeMoves.length}
                  </span>
                  <button
                    onClick={() =>
                      setReplayIndex((prev) =>
                        prev === null ? activeMoves.length - 1 : Math.min(activeMoves.length - 1, prev + 1)
                      )
                    }
                    disabled={replayIndex === activeMoves.length - 1 || replayIndex === null}
                    className="p-1 bg-(--surface-2) rounded hover:bg-(--surface-3) disabled:opacity-40 cursor-pointer text-(--ink-1)"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setReplayIndex(activeMoves.length - 1)}
                    className="px-2 py-1 bg-(--surface-2) rounded hover:bg-(--surface-3) cursor-pointer text-(--ink-1)"
                  >
                    {t('liveClassroom.end')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-80 flex flex-col items-center justify-center border-2 border-dashed border-(--border) rounded-lg text-center p-6 text-(--ink-3)">
              <Swords className="w-10 h-10 text-(--ink-4) mb-2" />
              <p className="font-medium text-(--ink-1)">{t('liveClassroom.noBoards')}</p>
              <p className="text-xs text-(--ink-3) mt-1">
                {isTeacher
                  ? t('liveClassroom.noBoardsDescTeacher')
                  : t('liveClassroom.noBoardsDescStudent')}
              </p>
            </div>
          )}
        </div>

        {/* Sidebar: Boards List + Private Chat */}
        <div className="w-full lg:w-80 flex flex-col gap-3">
          {/* Practice Boards List (Teacher & Spectators) */}
          <div className="p-3 bg-(--surface) border border-(--border) rounded-lg">
            <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold text-(--ink-1)">
              <Users className="w-4 h-4 text-(--accent)" />
              <span>{t('liveClassroom.practiceBoardsCount', { count: practiceAssignments.length })}</span>
            </div>

            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {practiceAssignments.length === 0 ? (
                <div className="text-[11px] text-(--ink-4) italic py-2 text-center">
                  {t('liveClassroom.noBoards')}
                </div>
              ) : (
                practiceAssignments.map((board) => {
                  const isCurrent = board.boardId === currentBoardId
                  return (
                    <button
                      key={board.boardId}
                      onClick={() => {
                        setActivePracticeBoard(board.boardId)
                        setReplayIndex(null)
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-md text-xs transition-colors cursor-pointer border ${
                        isCurrent
                          ? 'bg-(--accent-soft) border-(--accent-border) text-(--accent-ink) font-semibold'
                          : 'bg-(--surface-2) border-(--border) text-(--ink-2) hover:bg-(--surface-3)'
                      }`}
                    >
                      <div className="flex flex-col items-start truncate text-left">
                        <span className="truncate">
                          {t('liveClassroom.boardLabel', { id: board.boardId, white: board.whiteUserName, black: board.blackUserName })}
                        </span>
                        <span className="text-[10px] text-(--ink-4)">
                          {board.status === 'PLAYING' ? t('liveClassroom.playing') : t('liveClassroom.finished')}
                        </span>
                      </div>
                      {isCurrent ? (
                        <Eye className="w-3.5 h-3.5 text-(--accent) shrink-0 ml-1" />
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Private Chat for Current Board */}
          {currentBoardId && (
            <div className="h-72">
              <ClassroomChat
                isPrivate={true}
                boardId={currentBoardId}
                opponentId={opponentId}
                teacherId={teacherId}
                sessionId={sessionId}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
              />
            </div>
          )}
        </div>
      </div>

      {/* Teacher Create Board Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-(--surface) border border-(--border) rounded-xl p-5 w-full max-w-sm shadow-xl animate-in fade-in zoom-in-95">
            <h3 className="text-sm font-bold text-(--ink-1) mb-3 flex items-center gap-2">
              <Swords className="w-4 h-4 text-(--accent)" />
              {t('liveClassroom.createBoardTitle')}
            </h3>

            <div className="flex flex-col gap-3 text-xs mb-4">
              <div>
                <label className="block text-(--ink-2) font-semibold mb-1">{t('liveClassroom.whitePlayer')}</label>
                <select
                  value={newWhiteUserId}
                  onChange={(e) => setNewWhiteUserId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-(--surface-2) border border-(--border) rounded-md text-(--ink-1)"
                >
                  <option value="">{t('liveClassroom.selectParticipant')}</option>
                  {participants
                    .filter((p) => p.identity !== newBlackUserId)
                    .map((p) => (
                      <option key={p.identity} value={p.identity}>
                        {p.name || p.identity}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-(--ink-2) font-semibold mb-1">{t('liveClassroom.blackPlayer')}</label>
                <select
                  value={newBlackUserId}
                  onChange={(e) => setNewBlackUserId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-(--surface-2) border border-(--border) rounded-md text-(--ink-1)"
                >
                  <option value="">{t('liveClassroom.selectParticipant')}</option>
                  {participants
                    .filter((p) => p.identity !== newWhiteUserId)
                    .map((p) => (
                      <option key={p.identity} value={p.identity}>
                        {p.name || p.identity}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 rounded-md border border-(--border) text-(--ink-2) hover:bg-(--surface-2) cursor-pointer"
              >
                {t('liveClassroom.cancel')}
              </button>
              <button
                onClick={handleCreateBoard}
                disabled={!newWhiteUserId || !newBlackUserId || newWhiteUserId === newBlackUserId}
                className="px-3 py-1.5 rounded-md bg-(--accent) text-white font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer"
              >
                {t('liveClassroom.startMatch')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
