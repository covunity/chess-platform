import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Chess } from 'chess.js'
import { useRoomContext, useDataChannel } from '@livekit/components-react'
import { ConnectionState, RoomEvent } from 'livekit-client'
import ChessgroundView from '../../ChessBoard/ChessgroundView'
import {
  type ChessMovePayload,
  type ClassroomControlPayload,
  LIVEKIT_TOPICS,
  getPracticeChessTopic,
} from '../../../types/liveClassroom'
import { useLiveClassroomStore } from '../useLiveClassroomStore'
import { START_FEN } from '../liveClassroomStore'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from '../liveClassroomSecurity'

export interface GameEndDetails {
  gameId: string
  finalPgn: string
  finalFen: string
  moveCount: number
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  terminationReason: string
  startedAt: string
  endedAt: string
}

export interface LiveBoardSyncHandle {
  endGameManually: (terminationReason?: string) => GameEndDetails
  getGameDetails: (result?: '1-0' | '0-1' | '1/2-1/2' | '*', terminationReason?: string) => GameEndDetails
  resetGame: () => string
}

export interface LiveBoardSyncProps {
  initialFen: string
  isTeacher: boolean
  opponentId?: string
  boardId?: string
  teacherId?: string
  canInteract?: boolean
  orientation?: 'white' | 'black'
  currentUserId: string
  onGameEnd?: (finalPgn: string, details?: GameEndDetails) => void
  onGameInit?: (metadata: { gameId: string; startedAt: string; boardId: string }) => void
  boardRef?: React.Ref<LiveBoardSyncHandle>
  size?: number
  gameId?: string
  initialStartedAt?: string
}

/** Compute legal destinations for each square from a Chess instance. */
function computeDests(chess: Chess): Map<string, string[]> {
  const dests = new Map<string, string[]>()
  try {
    for (const move of chess.moves({ verbose: true })) {
      const existing = dests.get(move.from)
      if (existing) {
        existing.push(move.to)
      } else {
        dests.set(move.from, [move.to])
      }
    }
  } catch {
    // return empty on invalid position
  }
  return dests
}

/** Check if a move is a pawn promotion. */
function isPromotionMove(chess: Chess, from: string, to: string): boolean {
  try {
    const piece = chess.get(from as Parameters<typeof chess.get>[0])
    if (!piece || piece.type !== 'p') return false
    const targetRank = to[1]
    return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')
  } catch {
    return false
  }
}

const LiveBoardSync = forwardRef<LiveBoardSyncHandle, LiveBoardSyncProps>(function LiveBoardSync(
  props,
  ref
) {
  const {
    initialFen,
    isTeacher,
    opponentId,
    boardId = 'main',
    teacherId,
    canInteract = false,
    orientation = 'white',
    currentUserId,
    onGameEnd,
    onGameInit,
    boardRef,
    size = 520,
    gameId,
    initialStartedAt,
  } = props
  const { t } = useTranslation()
  const room = useRoomContext()
  const effectiveBoardId = boardId || 'main'
  const isMainBoard = effectiveBoardId === 'main'

  const onGameInitRef = useRef(onGameInit)
  useEffect(() => {
    onGameInitRef.current = onGameInit
  }, [onGameInit])

  // Track LiveKit connection state
  const [roomState, setRoomState] = useState<string>(room?.state || ConnectionState.Disconnected)

  useEffect(() => {
    if (!room) return
    setRoomState(room.state || ConnectionState.Disconnected)

    const handleStateChange = (state: ConnectionState) => {
      setRoomState(state)
    }

    if (typeof room.on === 'function') {
      room.on(RoomEvent.ConnectionStateChanged, handleStateChange)
      return () => {
        room.off?.(RoomEvent.ConnectionStateChanged, handleStateChange)
      }
    }
  }, [room])

  const isConnected = roomState === ConnectionState.Connected || roomState === 'connected'

  // Topic for this board
  const topic = isMainBoard ? LIVEKIT_TOPICS.CHESS_MAIN : getPracticeChessTopic(effectiveBoardId)

  // Zustand state and actions
  const storeFen = useLiveClassroomStore((s) =>
    isMainBoard ? s.currentFen : s.boardFens[effectiveBoardId] || initialFen
  )
  const storePly = useLiveClassroomStore((s) =>
    isMainBoard ? 0 : s.boardPlies[effectiveBoardId] || 0
  )
  const updateFen = useLiveClassroomStore((s) => s.updateFen)
  const setBoardFen = useLiveClassroomStore((s) => s.setBoardFen)
  const setBoardPly = useLiveClassroomStore((s) => s.setBoardPly)
  const recordBoardMove = useLiveClassroomStore((s) => s.recordBoardMove)
  const markMessageProcessed = useLiveClassroomStore((s) => s.markMessageProcessed)
  const hasProcessedMessage = useLiveClassroomStore((s) => s.hasProcessedMessage)
  const storeBoardMoves = useLiveClassroomStore((s) => s.boardMoves)
  const setMainBoardSnapshot = useLiveClassroomStore((s) => s.setMainBoardSnapshot)

  const lectureInteractionUserId = useLiveClassroomStore((s) => s.lectureInteractionUserId)
  const practiceAssignments = useLiveClassroomStore((s) => s.practiceAssignments)
  const storeTeacherId = useLiveClassroomStore((s) => s.teacherId)
  const effectiveTeacherId = teacherId || storeTeacherId || undefined

  // Local chess.js instance & board state
  const chessRef = useRef<Chess>(new Chess(initialFen || undefined))
  const [currentFen, setCurrentFen] = useState<string>(initialFen)
  const [ply, setPly] = useState<number>(storePly)
  const [lastMove, setLastMove] = useState<[string, string] | null>(null)
  const [gameStatus, setGameStatus] = useState<string>('')

  // Game instance tracking for persistence
  const currentGameIdRef = useRef<string>(
    gameId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `game-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`)
  )
  const gameStartedAtRef = useRef<string>(initialStartedAt || new Date().toISOString())
  const isGameFinalizedRef = useRef<boolean>(false)
  const lastGameEndDetailsRef = useRef<GameEndDetails | null>(null)

  useEffect(() => {
    if (gameId) {
      currentGameIdRef.current = gameId
    }
  }, [gameId])

  useEffect(() => {
    if (initialStartedAt) {
      gameStartedAtRef.current = initialStartedAt
    }
  }, [initialStartedAt])

  // Track boardId changes to update game identity if component is reused
  const prevBoardIdRef = useRef(effectiveBoardId)
  useEffect(() => {
    if (effectiveBoardId !== prevBoardIdRef.current) {
      prevBoardIdRef.current = effectiveBoardId
      const nextGameId =
        gameId ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `game-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`)
      const nextStartedAt = initialStartedAt || new Date().toISOString()
      currentGameIdRef.current = nextGameId
      gameStartedAtRef.current = nextStartedAt
      isGameFinalizedRef.current = false
      lastGameEndDetailsRef.current = null
      onGameInitRef.current?.({
        gameId: nextGameId,
        startedAt: nextStartedAt,
        boardId: effectiveBoardId,
      })
    }
  }, [effectiveBoardId, gameId, initialStartedAt])

  // Initial notification to parent of game metadata
  const hasNotifiedInitRef = useRef(false)
  useEffect(() => {
    if (!hasNotifiedInitRef.current) {
      hasNotifiedInitRef.current = true
      onGameInitRef.current?.({
        gameId: currentGameIdRef.current,
        startedAt: gameStartedAtRef.current,
        boardId: effectiveBoardId,
      })
    }
  }, [effectiveBoardId])

  // Expose methods to end game manually or inspect current game metadata
  const endGameManually = useCallback(
    (terminationReason = 'board_stopped_by_teacher'): GameEndDetails => {
      if (isGameFinalizedRef.current && lastGameEndDetailsRef.current) {
        return lastGameEndDetailsRef.current
      }
      isGameFinalizedRef.current = true
      const details: GameEndDetails = {
        gameId: currentGameIdRef.current,
        finalPgn: chessRef.current.pgn(),
        finalFen: chessRef.current.fen(),
        moveCount: chessRef.current.history().length,
        result: '*',
        terminationReason,
        startedAt: gameStartedAtRef.current,
        endedAt: new Date().toISOString(),
      }
      lastGameEndDetailsRef.current = details
      setGameStatus(t('liveClassroom.gameOver'))
      return details
    },
    [t]
  )

  const getGameDetails = useCallback(
    (
      result: '1-0' | '0-1' | '1/2-1/2' | '*' = '*',
      terminationReason = 'in_progress'
    ): GameEndDetails => {
      if (isGameFinalizedRef.current && lastGameEndDetailsRef.current) {
        return lastGameEndDetailsRef.current
      }
      return {
        gameId: currentGameIdRef.current,
        finalPgn: chessRef.current.pgn(),
        finalFen: chessRef.current.fen(),
        moveCount: chessRef.current.history().length,
        result,
        terminationReason,
        startedAt: gameStartedAtRef.current,
        endedAt: new Date().toISOString(),
      }
    },
    []
  )

  const resetGame = useCallback((): string => {
    const nextGameId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `game-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    const nextStartedAt = new Date().toISOString()
    currentGameIdRef.current = nextGameId
    gameStartedAtRef.current = nextStartedAt
    isGameFinalizedRef.current = false
    lastGameEndDetailsRef.current = null
    try {
      chessRef.current = new Chess(START_FEN)
    } catch {
      // fallback
    }
    setCurrentFen(START_FEN)
    setGameStatus('')
    setPly(0)
    setLastMove(null)
    onGameInitRef.current?.({
      gameId: nextGameId,
      startedAt: nextStartedAt,
      boardId: effectiveBoardId,
    })
    return nextGameId
  }, [effectiveBoardId])

  useImperativeHandle(
    ref,
    () => ({
      endGameManually,
      getGameDetails,
      resetGame,
    }),
    [endGameManually, getGameDetails, resetGame]
  )

  useEffect(() => {
    if (boardRef && typeof boardRef === 'object' && 'current' in boardRef) {
      ;(boardRef as React.MutableRefObject<LiveBoardSyncHandle | null>).current = {
        endGameManually,
        getGameDetails,
        resetGame,
      }
    }
  }, [boardRef, endGameManually, getGameDetails, resetGame])

  // F-03: Explicit Snapshot Synchronization Cycle State & Move Buffering
  const SNAPSHOT_THROTTLE_MS = 2000
  const SNAPSHOT_RETRY_INTERVAL_MS = 3000
  const MAX_SNAPSHOT_RETRIES = 3

  const bufferedMovesRef = useRef<ChessMovePayload[]>([])
  const hasReceivedSnapshotRef = useRef<boolean>(isTeacher || !isMainBoard)
  const syncCycleIdRef = useRef<number>(0)
  const isSyncingRef = useRef<boolean>(false)
  const retryCountRef = useRef<number>(0)
  const lastRequestTimeRef = useRef<number>(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stop any active retry cycle timers
  const cancelSyncCycle = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current)
      throttleTimerRef.current = null
    }
    isSyncingRef.current = false
  }, [])

  // Send raw DataChannel snapshot request packet
  const sendSnapshotPacket = useCallback(() => {
    if (isTeacher || !isMainBoard) return
    if (!effectiveTeacherId) return

    const now = Date.now()
    lastRequestTimeRef.current = now

    const requestPayload: ClassroomControlPayload = {
      type: 'CLASSROOM_CONTROL',
      action: 'REQUEST_MAIN_BOARD_STATE',
      requestId: `${currentUserId}-${now}-${Math.random().toString(36).substring(2, 7)}`,
      senderId: currentUserId,
      messageId: `${currentUserId}-${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      boardId: 'main',
    }

    try {
      const bytes = new TextEncoder().encode(JSON.stringify(requestPayload))
      room?.localParticipant?.publishData(bytes, {
        reliable: true,
        topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
        destinationIdentities: [effectiveTeacherId],
      })
    } catch (err) {
      console.warn('LiveBoardSync: Failed to send REQUEST_MAIN_BOARD_STATE', err)
    }
  }, [isTeacher, isMainBoard, effectiveTeacherId, currentUserId, room])

  // Start a new snapshot synchronization cycle (initial or forced resync after gap)
  const startSyncCycle = useCallback(
    (reason: 'initial' | 'gap') => {
      if (isTeacher || !isMainBoard) return
      if (!isConnected || !effectiveTeacherId) return
      if (reason === 'initial' && hasReceivedSnapshotRef.current) return

      // Requirement 8: Prevent multiple concurrent retry loops
      if (isSyncingRef.current) return

      isSyncingRef.current = true
      syncCycleIdRef.current += 1
      const cycleId = syncCycleIdRef.current
      retryCountRef.current = 0

      // Clear any pending timers
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }

      const scheduleRetry = (activeCycleId: number) => {
        retryTimerRef.current = setTimeout(() => {
          if (!isSyncingRef.current || syncCycleIdRef.current !== activeCycleId) return

          if (retryCountRef.current < MAX_SNAPSHOT_RETRIES) {
            retryCountRef.current += 1
            sendSnapshotPacket()
            scheduleRetry(activeCycleId)
          } else {
            // Retries exhausted for this cycle
            isSyncingRef.current = false
          }
        }, SNAPSHOT_RETRY_INTERVAL_MS)
      }

      const executeAttempt = () => {
        if (!isSyncingRef.current || syncCycleIdRef.current !== cycleId) return
        sendSnapshotPacket()
        scheduleRetry(cycleId)
      }

      const now = Date.now()
      const timeSinceLastRequest = now - lastRequestTimeRef.current

      // Rate limit check
      if (timeSinceLastRequest >= SNAPSHOT_THROTTLE_MS) {
        // Can send immediately
        executeAttempt()
      } else {
        // Requirement 3 & 6: If throttled, schedule to send when throttle expires.
        // Do NOT silently lose the request.
        const delay = SNAPSHOT_THROTTLE_MS - timeSinceLastRequest
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null
          executeAttempt()
        }, delay)
      }
    },
    [isTeacher, isMainBoard, isConnected, effectiveTeacherId, sendSnapshotPacket]
  )

  // Backward-compatible trigger if called as requestMainBoardState(force)
  const requestMainBoardState = useCallback(
    (force = false) => {
      startSyncCycle(force ? 'gap' : 'initial')
    },
    [startSyncCycle]
  )

  // Cleanup on unmount or connection drop; trigger initial sync when connected
  useEffect(() => {
    if (!isConnected) {
      cancelSyncCycle()
      return
    }
    if (!hasReceivedSnapshotRef.current && effectiveTeacherId) {
      startSyncCycle('initial')
    }
  }, [isConnected, effectiveTeacherId, startSyncCycle, cancelSyncCycle])

  useEffect(() => {
    return () => {
      cancelSyncCycle()
    }
  }, [cancelSyncCycle])

  // Listen to CLASSROOM_CONTROL for snapshot request / response
  const handleControlMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ClassroomControlPayload
        if (payload.type !== 'CLASSROOM_CONTROL') return
        if (payload.boardId && payload.boardId !== 'main') return

        if (payload.action === 'REQUEST_MAIN_BOARD_STATE') {
          // Authoritative Teacher responds with current main board state snapshot
          if (!isTeacher || !isMainBoard) return

          const snapshot: ClassroomControlPayload = {
            type: 'CLASSROOM_CONTROL',
            action: 'MAIN_BOARD_STATE_SYNC',
            requestId: payload.requestId,
            senderId: currentUserId,
            messageId: `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: Date.now(),
            boardId: 'main',
            fen: chessRef.current.fen(),
            ply: ply,
            moves: storeBoardMoves['main'] || [],
          }

          const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
          room?.localParticipant?.publishData(bytes, {
            reliable: true,
            topic: LIVEKIT_TOPICS.CLASSROOM_CONTROL,
            destinationIdentities: [senderIdentity], // targeted strictly to requester
          })
        } else if (payload.action === 'MAIN_BOARD_STATE_SYNC') {
          // Student receives authoritative snapshot from teacher
          if (isTeacher || !isMainBoard) return

          const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)
          if (!isSenderTeacher) {
            if (import.meta.env.DEV) {
              console.warn('LiveBoardSync: Unauthorized MAIN_BOARD_STATE_SYNC from non-teacher', senderIdentity)
            }
            return
          }

          const snapshotPly = payload.ply ?? 0
          const snapshotFen = payload.fen || START_FEN

          // Monotonic ordering: apply if snapshot is newer or local state has not yet synced
          if (snapshotPly >= ply || !hasReceivedSnapshotRef.current) {
            cancelSyncCycle()
            try {
              chessRef.current = new Chess(snapshotFen)
              setCurrentFen(snapshotFen)
              setPly(snapshotPly)
              hasReceivedSnapshotRef.current = true
              setMainBoardSnapshot(snapshotFen, snapshotPly, payload.moves || [])

              // Strict contiguous buffered move replay:
              // Candidates: moves arriving during sync with ply > snapshotPly, sorted ascending by ply
              const candidates = [...bufferedMovesRef.current]
                .filter((m) => m.ply > snapshotPly)
                .sort((a, b) => a.ply - b.ply)

              bufferedMovesRef.current = []

              let expectedPly = snapshotPly + 1
              let hasGap = false
              const remainingUnresolved: ChessMovePayload[] = []

              for (const move of candidates) {
                if (hasGap) {
                  remainingUnresolved.push(move)
                  continue
                }

                if (move.ply === expectedPly) {
                  // Duplicate protection
                  if (hasProcessedMessage(move.messageId)) {
                    expectedPly = move.ply + 1
                    continue
                  }

                  const moveAttempt = chessRef.current.move(move.san)
                  if (moveAttempt) {
                    markMessageProcessed(move.messageId)
                    const updatedFen = chessRef.current.fen()
                    setCurrentFen(updatedFen)
                    setPly(move.ply)
                    updateFen(updatedFen)
                    setBoardPly('main', move.ply)
                    recordBoardMove('main', { ...move, senderId: move.senderId })
                    expectedPly = move.ply + 1
                  } else {
                    // Move could not be applied cleanly (corrupted/illegal) -> sequence gap!
                    hasGap = true
                    remainingUnresolved.push(move)
                  }
                } else if (move.ply > expectedPly) {
                  // Sequence gap detected: expected expectedPly, but received move.ply!
                  // DO NOT apply this move or later moves!
                  hasGap = true
                  remainingUnresolved.push(move)
                }
              }

              if (hasGap) {
                // Keep unresolved moves in buffer and request fresh snapshot
                bufferedMovesRef.current = remainingUnresolved
                requestMainBoardState(true)
              }
            } catch (err) {
              console.warn('LiveBoardSync: Failed to apply snapshot FEN', err)
            }
          }
        }
      } catch (err) {
        console.warn('LiveBoardSync: Failed to parse control message in LiveBoardSync', err)
      }
    },
    [
      isTeacher,
      isMainBoard,
      currentUserId,
      ply,
      effectiveTeacherId,
      room,
      storeBoardMoves,
      setMainBoardSnapshot,
      updateFen,
      setBoardPly,
      recordBoardMove,
      hasProcessedMessage,
      markMessageProcessed,
      cancelSyncCycle,
      requestMainBoardState,
    ]
  )

  useDataChannel(LIVEKIT_TOPICS.CLASSROOM_CONTROL, handleControlMessage)

  // Sync chess.js instance when storeFen changes from external action or reset
  useEffect(() => {
    if (storeFen && storeFen !== chessRef.current.fen()) {
      try {
        chessRef.current = new Chess(storeFen)
        setCurrentFen(storeFen)
        if (storeFen === START_FEN) {
          // Board reset to start -> fresh game ID for next game
          const nextGameId =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `game-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
          const nextStartedAt = new Date().toISOString()
          currentGameIdRef.current = nextGameId
          gameStartedAtRef.current = nextStartedAt
          isGameFinalizedRef.current = false
          lastGameEndDetailsRef.current = null
          setGameStatus('')
          setPly(0)
          setLastMove(null)
          onGameInitRef.current?.({
            gameId: nextGameId,
            startedAt: nextStartedAt,
            boardId: effectiveBoardId,
          })
        }
      } catch {
        // preserve current instance if storeFen is invalid
      }
    }
  }, [storeFen, effectiveBoardId])

  // Determine movable sides
  const movableColor = useMemo<'white' | 'black' | 'both' | null>(() => {
    if (!canInteract) return null
    if (isTeacher && isMainBoard) return 'both'
    const turn = chessRef.current.turn() === 'w' ? 'white' : 'black'
    if (orientation === turn) return orientation
    return null
  }, [canInteract, isTeacher, isMainBoard, orientation, currentFen])

  // Compute legal destination squares for Chessground drag-and-drop
  const dests = useMemo(() => {
    if (!canInteract || movableColor === null) {
      return new Map<string, string[]>()
    }
    return computeDests(chessRef.current)
  }, [canInteract, movableColor, currentFen])

  // Handle incoming moves via LiveKit Data Channel
  const handleIncomingMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ChessMovePayload

        if (payload.type !== 'CHESS_MOVE') return
        if (payload.boardId !== effectiveBoardId) return

        // Deduplication
        if (hasProcessedMessage(payload.messageId)) return

        // Authorization check based on authoritative transport identity
        if (isMainBoard) {
          const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)
          const isGrantedStudent = senderIdentity === lectureInteractionUserId
          if (!isSenderTeacher && !isGrantedStudent) {
            if (import.meta.env.DEV) {
              console.warn('LiveBoardSync: Unauthorized main board move from', senderIdentity)
            }
            return
          }
        } else {
          const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)
          const assignment = practiceAssignments.find((a) => a.boardId === effectiveBoardId)
          const isAssignedPlayer = assignment
            ? senderIdentity === assignment.whiteUserId || senderIdentity === assignment.blackUserId
            : senderIdentity === opponentId || senderIdentity === currentUserId

          if (!isSenderTeacher && !isAssignedPlayer) {
            if (import.meta.env.DEV) {
              console.warn(`LiveBoardSync: Unauthorized practice board move for board ${effectiveBoardId} from`, senderIdentity)
            }
            return
          }
        }

        // F-03: If main board student hasn't synced yet, buffer move and trigger request
        if (isMainBoard && !isTeacher && !hasReceivedSnapshotRef.current) {
          if (!bufferedMovesRef.current.some((m) => m.messageId === payload.messageId || m.ply === payload.ply)) {
            bufferedMovesRef.current.push(payload)
          }
          requestMainBoardState(true)
          return
        }

        // Stale ply check: ignore if ply <= current local ply
        if (payload.ply <= ply) {
          markMessageProcessed(payload.messageId)
          return
        }

        // F-03: Sequence gap check: if ply > current local ply + 1, a move was missed
        if (isMainBoard && !isTeacher && payload.ply > ply + 1) {
          if (import.meta.env.DEV) {
            console.warn(`LiveBoardSync: Move sequence gap detected (local ply: ${ply}, incoming ply: ${payload.ply}). Requesting state resync.`)
          }
          if (!bufferedMovesRef.current.some((m) => m.messageId === payload.messageId || m.ply === payload.ply)) {
            bufferedMovesRef.current.push(payload)
          }
          requestMainBoardState(true)
          return
        }

        // Apply move to chess.js
        let moveAttempt: ReturnType<typeof chessRef.current.move> | null = null
        try {
          moveAttempt = chessRef.current.move(payload.san)
        } catch {
          // SAN failed or threw
        }
        if (!moveAttempt) {
          // If SAN fails, attempt UCI move
          try {
            const from = payload.uci.slice(0, 2)
            const to = payload.uci.slice(2, 4)
            const promotion = payload.uci.slice(4, 5) || undefined
            moveAttempt = chessRef.current.move({ from, to, promotion })
          } catch {
            // UCI failed or threw
          }
          if (!moveAttempt) {
            console.warn('LiveBoardSync: Illegal or out-of-sync incoming move rejected', payload)
            // Sequence gap or out-of-sync move: trigger resync
            if (isMainBoard && !isTeacher) {
              requestMainBoardState(true)
            }
            return
          }
        }

        markMessageProcessed(payload.messageId)

        // Sanitize payload with canonical transport identity
        const sanitizedPayload: ChessMovePayload = {
          ...payload,
          senderId: senderIdentity,
        }

        const newFen = chessRef.current.fen()
        setCurrentFen(newFen)
        setPly(payload.ply)

        const from = payload.uci.slice(0, 2)
        const to = payload.uci.slice(2, 4)
        setLastMove([from, to])

        // Update Zustand store
        if (isMainBoard) {
          updateFen(newFen)
          setBoardPly('main', payload.ply)
          recordBoardMove('main', sanitizedPayload)
        } else {
          setBoardFen(effectiveBoardId, newFen)
          setBoardPly(effectiveBoardId, payload.ply)
          recordBoardMove(effectiveBoardId, sanitizedPayload)
        }

        // Game over check
        if (chessRef.current.isGameOver() && !isGameFinalizedRef.current) {
          isGameFinalizedRef.current = true

          let statusDesc = t('liveClassroom.gameOver')
          let result: '1-0' | '0-1' | '1/2-1/2' | '*' = '*'
          let reason = 'game_over'
          if (chessRef.current.isCheckmate()) {
            const winner = chessRef.current.turn() === 'w' ? t('liveClassroom.black') : t('liveClassroom.white')
            statusDesc = t('liveClassroom.checkmate', { winner })
            result = chessRef.current.turn() === 'w' ? '0-1' : '1-0'
            reason = 'checkmate'
          } else if (chessRef.current.isDraw()) {
            statusDesc = t('liveClassroom.draw')
            result = '1/2-1/2'
            if (chessRef.current.isStalemate()) reason = 'stalemate'
            else if (chessRef.current.isThreefoldRepetition()) reason = 'threefold_repetition'
            else if (chessRef.current.isInsufficientMaterial()) reason = 'insufficient_material'
            else reason = 'draw'
          }
          setGameStatus(statusDesc)
          const details: GameEndDetails = {
            gameId: currentGameIdRef.current,
            finalPgn: chessRef.current.pgn(),
            finalFen: chessRef.current.fen(),
            moveCount: chessRef.current.history().length,
            result,
            terminationReason: reason,
            startedAt: gameStartedAtRef.current,
            endedAt: new Date().toISOString(),
          }
          lastGameEndDetailsRef.current = details
          onGameEnd?.(chessRef.current.pgn(), details)
        }
      } catch (err) {
        console.warn('LiveBoardSync: Failed to parse data channel message', err)
      }
    },
    [
      effectiveBoardId,
      hasProcessedMessage,
      ply,
      isMainBoard,
      isTeacher,
      effectiveTeacherId,
      lectureInteractionUserId,
      practiceAssignments,
      opponentId,
      currentUserId,
      markMessageProcessed,
      updateFen,
      recordBoardMove,
      setBoardFen,
      setBoardPly,
      onGameEnd,
      requestMainBoardState,
      t,
    ]
  )

  // Listen to topic
  useDataChannel(topic, handleIncomingMessage)

  // Handle local outgoing moves from Chessground
  const handleMove = useCallback(
    (from: string, to: string): boolean => {
      if (!canInteract) return false

      const chess = chessRef.current
      const isPromo = isPromotionMove(chess, from, to)
      const promotion = isPromo ? 'q' : undefined

      // Attempt move locally in chess.js
      let moveResult: ReturnType<typeof chess.move> | null = null
      try {
        moveResult = chess.move({ from, to, promotion })
      } catch {
        return false
      }

      if (!moveResult) return false

      const newFen = chess.fen()
      const newPly = ply + 1
      const uci = `${from}${to}${moveResult.promotion ?? ''}`
      const messageId = `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

      const payload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: effectiveBoardId,
        senderId: currentUserId,
        messageId,
        ply: newPly,
        uci,
        san: moveResult.san,
        fen: newFen,
        timestamp: Date.now(),
      }

      // Mark locally processed to avoid loopback handling
      markMessageProcessed(messageId)

      setCurrentFen(newFen)
      setPly(newPly)
      setLastMove([from, to])

      // Update store
      if (isMainBoard) {
        updateFen(newFen)
        recordBoardMove('main', payload)
      } else {
        setBoardFen(effectiveBoardId, newFen)
        setBoardPly(effectiveBoardId, newPly)
        recordBoardMove(effectiveBoardId, payload)
      }

      // Check game completion
      if (chess.isGameOver() && !isGameFinalizedRef.current) {
        isGameFinalizedRef.current = true

        let statusDesc = t('liveClassroom.gameOver')
        let result: '1-0' | '0-1' | '1/2-1/2' | '*' = '*'
        let reason = 'game_over'
        if (chess.isCheckmate()) {
          const winner = chess.turn() === 'w' ? t('liveClassroom.black') : t('liveClassroom.white')
          statusDesc = t('liveClassroom.checkmate', { winner })
          result = chess.turn() === 'w' ? '0-1' : '1-0'
          reason = 'checkmate'
        } else if (chess.isDraw()) {
          statusDesc = t('liveClassroom.draw')
          result = '1/2-1/2'
          if (chess.isStalemate()) reason = 'stalemate'
          else if (chess.isThreefoldRepetition()) reason = 'threefold_repetition'
          else if (chess.isInsufficientMaterial()) reason = 'insufficient_material'
          else reason = 'draw'
        }
        setGameStatus(statusDesc)
        const details: GameEndDetails = {
          gameId: currentGameIdRef.current,
          finalPgn: chess.pgn(),
          finalFen: chess.fen(),
          moveCount: chess.history().length,
          result,
          terminationReason: reason,
          startedAt: gameStartedAtRef.current,
          endedAt: new Date().toISOString(),
        }
        lastGameEndDetailsRef.current = details
        onGameEnd?.(chess.pgn(), details)
      }

      // Publish reliably via LiveKit Data Channel
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))

      if (isMainBoard) {
        // Broadcast in MAIN mode (no destinationIdentities)
        room.localParticipant.publishData(payloadBytes, {
          reliable: true,
          topic: LIVEKIT_TOPICS.CHESS_MAIN,
        })
      } else {
        // Target opponent and teacher in PRACTICE mode
        const targets = [opponentId, teacherId].filter(
          (id): id is string => Boolean(id && id.trim() && id !== currentUserId)
        )

        room.localParticipant.publishData(payloadBytes, {
          reliable: true,
          topic: getPracticeChessTopic(effectiveBoardId),
          destinationIdentities: targets.length > 0 ? targets : undefined,
        })
      }

      return true
    },
    [
      canInteract,
      ply,
      currentUserId,
      effectiveBoardId,
      markMessageProcessed,
      isMainBoard,
      room,
      updateFen,
      recordBoardMove,
      setBoardFen,
      setBoardPly,
      onGameEnd,
      opponentId,
      teacherId,
    ]
  )

  return (
    <div className="flex flex-col items-center justify-center">
      {/* Game Status Banner if completed or in check */}
      {gameStatus && (
        <div className="mb-2 px-3 py-1.5 rounded-md bg-(--accent-soft) text-(--accent-ink) text-xs font-semibold border border-(--accent-border) animate-in fade-in">
          {gameStatus}
        </div>
      )}

      {/* Board wrapper with border styling matching design system */}
      <div
        className="rounded-lg overflow-hidden shadow-md border border-(--border-strong) bg-(--surface)"
        style={{ width: size, height: size }}
      >
        <ChessgroundView
          fen={currentFen}
          orientation={orientation}
          movable={movableColor}
          dests={dests}
          lastMove={lastMove}
          viewOnly={!canInteract}
          onMove={handleMove}
          size={size}
        />
      </div>

      {/* Side to move indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs text-(--ink-3)">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full border border-(--border-strong)"
          style={{
            backgroundColor: chessRef.current.turn() === 'w' ? '#FFFFFF' : '#15171A',
          }}
        />
        <span>
          {chessRef.current.turn() === 'w' ? t('liveClassroom.whiteTurn') : t('liveClassroom.blackTurn')} ({t('liveClassroom.move', { num: Math.floor(ply / 2) + 1 })})
        </span>
      </div>
    </div>
  )
})

export default LiveBoardSync
