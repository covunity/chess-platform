import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Swords,
  GraduationCap,
  Clock,
  CheckCircle2,
  XCircle,
  HelpCircle,
  X,
  Eye,
  ListOrdered,
  Layers,
} from 'lucide-react'
import { supabase as defaultSupabase } from '../../../lib/supabase'
import { getLiveGamesForSession } from '../../../lib/liveGameApi'
import type { LiveGame, LiveGameResult, LiveGameScope } from '../../../types/liveGame'
import ChessgroundView from '../../ChessBoard/ChessgroundView'
import {
  parseGamePgnForReplay,
  type ReplayMove,
  type ReplayMovePair,
  START_FEN,
} from './replayPgnParser'
import { renderSanWithIcon } from '../../../utils/renderSanWithIcon'

export interface SessionGameReplayProps {
  sessionId: string
  supabaseClient?: SupabaseClient
  initialGameId?: string
  initialBoardId?: string
  onClose?: () => void
  className?: string
  title?: string
}

export default function SessionGameReplay({
  sessionId,
  supabaseClient = defaultSupabase,
  initialGameId,
  initialBoardId,
  onClose,
  className = '',
  title,
}: SessionGameReplayProps) {
  // ── Session Tracking & Request Ownership Refs ───────────────────────────
  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const requestIdRef = useRef<number>(0)
  const latestSessionIdRef = useRef<string>(sessionId)
  const isMountedRef = useRef<boolean>(true)

  // ── Session Games State ───────────────────────────────────────────────────
  const [games, setGames] = useState<LiveGame[]>([])
  const [loadingGames, setLoadingGames] = useState(true)
  const [errorGames, setErrorGames] = useState<string | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<string | null>(initialGameId ?? null)
  const [selectedBoardFilter, setSelectedBoardFilter] = useState<string | null>(initialBoardId ?? null)

  useEffect(() => {
    if (initialBoardId) {
      setSelectedBoardFilter(initialBoardId)
    }
  }, [initialBoardId])

  // ── Replay Viewer State ───────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(0) // 0 = start FEN; 1..N = after move index 0..N-1
  const [isPlaying, setIsPlaying] = useState(false)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState<number>(1000)
  const [activeTab, setActiveTab] = useState<'moves' | 'games'>('moves')

  // ── Playback Timers & Ownership Token Refs ────────────────────────────────
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerTokenRef = useRef<number>(0)
  const activeGameIdRef = useRef<string | null>(selectedGameId)
  const currentStepRef = useRef<number>(0)
  const totalMovesRef = useRef<number>(0)
  const moveLogContainerRef = useRef<HTMLDivElement>(null)

  // ── Session Mismatch & Derived Pure Display State ─────────────────────────
  const isSessionMismatch = sessionId !== activeSessionId

  const effectiveGames = isSessionMismatch ? [] : games
  const effectiveSelectedGameId = isSessionMismatch ? null : selectedGameId
  const effectiveLoadingGames = isSessionMismatch ? true : loadingGames
  const effectiveErrorGames = isSessionMismatch ? null : errorGames
  const effectiveCurrentStep = isSessionMismatch ? 0 : currentStep
  const effectiveIsPlaying = isSessionMismatch ? false : isPlaying

  // Synchronously handle session transition side effects in useLayoutEffect before paint
  useLayoutEffect(() => {
    if (sessionId !== activeSessionId) {
      // 1. Cancel playback timers and invalidate timer callbacks
      if (playbackTimerRef.current !== null) {
        clearInterval(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
      timerTokenRef.current++
      setIsPlaying(false)

      // 2. Update session ownership and invalidate in-flight requests
      requestIdRef.current++
      latestSessionIdRef.current = sessionId

      // 3. Clear prior session state and sync activeSessionId
      setActiveSessionId(sessionId)
      setGames([])
      setSelectedGameId(null)
      setCurrentStep(0)
      setErrorGames(null)
      setLoadingGames(true)
    }
  }, [sessionId, activeSessionId])

  // Fetch games for the given session with strict request ownership
  const fetchGames = useCallback(async (forcedSessionId?: string) => {
    const targetSessionId = forcedSessionId || latestSessionIdRef.current
    if (!targetSessionId) {
      setLoadingGames(false)
      setGames([])
      setSelectedGameId(null)
      setErrorGames(null)
      return
    }

    const currentRequestId = ++requestIdRef.current
    setLoadingGames(true)
    setErrorGames(null)

    try {
      const { games: fetchedGames, error } = await getLiveGamesForSession(supabaseClient, targetSessionId)

      if (!isMountedRef.current) return

      // Guard 1: Stale request check (newer fetch or retry in flight)
      if (currentRequestId !== requestIdRef.current) {
        return
      }

      // Guard 2: Stale session check (session prop changed while in flight)
      if (targetSessionId !== latestSessionIdRef.current) {
        return
      }

      if (error) {
        setErrorGames(error.message || 'Không thể tải danh sách ván đấu của buổi học.')
        setGames([])
        setSelectedGameId(null)
      } else {
        setGames(fetchedGames)
        setErrorGames(null)
        // Automatically select initialGameId, initialBoardId game, or the first game if none selected
        setSelectedGameId((prev) => {
          if (prev && fetchedGames.some((g) => g.id === prev)) {
            return prev
          }
          if (initialGameId && fetchedGames.some((g) => g.id === initialGameId)) {
            return initialGameId
          }
          if (initialBoardId) {
            const boardGame = fetchedGames.find((g) => g.board_id === initialBoardId)
            if (boardGame) {
              return boardGame.id
            }
          }
          return fetchedGames.length > 0 ? fetchedGames[0].id : null
        })
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || currentRequestId !== requestIdRef.current || targetSessionId !== latestSessionIdRef.current) {
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setErrorGames(message || 'Lỗi không xác định khi tải ván đấu.')
      setGames([])
      setSelectedGameId(null)
    } finally {
      if (isMountedRef.current && currentRequestId === requestIdRef.current && targetSessionId === latestSessionIdRef.current) {
        setLoadingGames(false)
      }
    }
  }, [supabaseClient, initialGameId, initialBoardId])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    latestSessionIdRef.current = sessionId
    fetchGames(sessionId)
  }, [sessionId, fetchGames])

  // Derive the currently selected game from effective state
  const effectiveSelectedGame = useMemo(() => {
    if (isSessionMismatch) return null
    return games.find((g) => g.id === effectiveSelectedGameId) ?? null
  }, [isSessionMismatch, games, effectiveSelectedGameId])

  // Keep activeGameIdRef in sync with effectiveSelectedGame
  useEffect(() => {
    activeGameIdRef.current = effectiveSelectedGame?.id ?? null
  }, [effectiveSelectedGame?.id])

  // Parse PGN of selected game
  const parsedPgn = useMemo(() => {
    if (!effectiveSelectedGame) {
      return {
        valid: false,
        error: null,
        startingFen: START_FEN,
        moves: [] as ReplayMove[],
        movePairs: [] as ReplayMovePair[],
      }
    }
    return parseGamePgnForReplay(effectiveSelectedGame.pgn, effectiveSelectedGame.starting_fen)
  }, [effectiveSelectedGame])

  const moves = parsedPgn.moves
  const movePairs = parsedPgn.movePairs
  const startingFen = parsedPgn.startingFen

  // Update totalMovesRef
  useEffect(() => {
    totalMovesRef.current = moves.length
  }, [moves.length])

  // Update currentStepRef
  useEffect(() => {
    currentStepRef.current = effectiveCurrentStep
  }, [effectiveCurrentStep])

  // Calculate current FEN and last move squares based on effectiveCurrentStep
  const { currentFen, lastMoveSquares } = useMemo(() => {
    if (isSessionMismatch || !parsedPgn.valid || moves.length === 0 || effectiveCurrentStep === 0) {
      return {
        currentFen: startingFen,
        lastMoveSquares: null as [string, string] | null,
      }
    }

    const currentMoveIndex = Math.min(effectiveCurrentStep - 1, moves.length - 1)
    const move = moves[currentMoveIndex]

    return {
      currentFen: move?.fen || startingFen,
      lastMoveSquares: move ? ([move.from, move.to] as [string, string]) : null,
    }
  }, [isSessionMismatch, parsedPgn.valid, moves, startingFen, effectiveCurrentStep])

  // ── Stop Playback Helper ──────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      clearInterval(playbackTimerRef.current)
      playbackTimerRef.current = null
    }
    timerTokenRef.current++
    setIsPlaying(false)
  }, [])

  // ── Start Playback Helper ─────────────────────────────────────────────────
  const startPlayback = useCallback(() => {
    if (!parsedPgn.valid || moves.length === 0) return

    // Stop any existing timer to prevent duplicates
    if (playbackTimerRef.current !== null) {
      clearInterval(playbackTimerRef.current)
      playbackTimerRef.current = null
    }

    const token = ++timerTokenRef.current
    const targetGameId = effectiveSelectedGame?.id

    // If currently at or beyond the last move, wrap around to start
    if (currentStepRef.current >= totalMovesRef.current) {
      setCurrentStep(0)
      currentStepRef.current = 0
    }

    setIsPlaying(true)

    playbackTimerRef.current = setInterval(() => {
      // Guard 1: Verify token ownership (prevent duplicate / stale timers)
      if (timerTokenRef.current !== token) {
        return
      }

      // Guard 2: Verify game identity (prevent modifying newly selected game)
      if (activeGameIdRef.current !== targetGameId) {
        if (playbackTimerRef.current !== null) {
          clearInterval(playbackTimerRef.current)
          playbackTimerRef.current = null
        }
        return
      }

      const next = currentStepRef.current + 1

      if (next >= totalMovesRef.current) {
        setCurrentStep(totalMovesRef.current)
        currentStepRef.current = totalMovesRef.current
        // Reached end: stop timer and pause
        if (playbackTimerRef.current !== null) {
          clearInterval(playbackTimerRef.current)
          playbackTimerRef.current = null
        }
        setIsPlaying(false)
      } else {
        setCurrentStep(next)
        currentStepRef.current = next
      }
    }, playbackSpeedMs)
  }, [parsedPgn.valid, moves.length, effectiveSelectedGame?.id, playbackSpeedMs])

  // ── Cleanup on Game Change ────────────────────────────────────────────────
  useEffect(() => {
    stopPlayback()
    setCurrentStep(0)
    currentStepRef.current = 0
  }, [effectiveSelectedGame?.id, stopPlayback])

  // ── Cleanup on Unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (playbackTimerRef.current !== null) {
        clearInterval(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
      timerTokenRef.current++
    }
  }, [])

  // ── Navigation Action Handlers ────────────────────────────────────
  const handleFirstMove = () => {
    stopPlayback()
    setCurrentStep(0)
  }

  const handlePrevMove = () => {
    stopPlayback()
    setCurrentStep((prev) => Math.max(0, prev - 1))
  }

  const handleNextMove = () => {
    stopPlayback()
    setCurrentStep((prev) => Math.min(moves.length, prev + 1))
  }

  const handleLastMove = () => {
    stopPlayback()
    setCurrentStep(moves.length)
  }

  const handleTogglePlayPause = () => {
    if (effectiveIsPlaying) {
      stopPlayback()
    } else {
      startPlayback()
    }
  }

  const handleJumpToStep = (step: number) => {
    stopPlayback()
    setCurrentStep(Math.max(0, Math.min(moves.length, step)))
  }

  const handleSelectGame = (gameId: string) => {
    if (gameId === effectiveSelectedGameId) return
    stopPlayback()
    setSelectedGameId(gameId)
    setActiveTab('moves')
  }

  // Auto-scroll active move into view in notation list
  useEffect(() => {
    if (!moveLogContainerRef.current) return
    const activeElem = moveLogContainerRef.current.querySelector('[aria-current="step"]')
    if (activeElem && typeof activeElem.scrollIntoView === 'function') {
      activeElem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [effectiveCurrentStep])

  // Format Helper for Results
  const renderResultBadge = (result: LiveGameResult) => {
    switch (result) {
      case '1-0':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            1-0 (Trắng thắng)
          </span>
        )
      case '0-1':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30">
            0-1 (Đen thắng)
          </span>
        )
      case '1/2-1/2':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
            ½-½ (Hòa)
          </span>
        )
      case '*':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-500/15 text-(--ink-2) border border-(--border)">
            * (Chưa kết thúc)
          </span>
        )
    }
  }

  // Format Helper for Scope
  const renderScopeBadge = (scope: LiveGameScope, boardId: string) => {
    if (scope === 'MAIN') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-(--accent-soft) text-(--accent) border border-(--accent-border)">
          <GraduationCap className="w-3 h-3" />
          Bàn chính
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-(--surface-2) text-(--ink-2) border border-(--border)">
        <Swords className="w-3 h-3" />
        Bàn đấu #{boardId}
      </span>
    )
  }

  return (
    <div
      data-testid="session-game-replay"
      role="region"
      aria-label="Session Chess Game Replay"
      className={`bg-(--surface) border border-(--border) rounded-xl shadow-lg flex flex-col overflow-hidden text-(--ink-1) ${className}`}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 sm:px-6 border-b border-(--border) bg-(--surface-2)/40 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-(--accent-soft) flex items-center justify-center text-(--accent)">
            <Eye className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-(--ink-1)">
                {title || 'Xem lại ván đấu buổi học'}
              </h2>
              <span
                data-testid="replay-mode-badge"
                className="px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-wide uppercase bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              >
                Chỉ xem (Read-only)
              </span>
            </div>
            <p className="text-xs text-(--ink-3)">
              Buổi học ID: <span className="font-mono">{sessionId.slice(0, 8)}...</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-(--ink-3) hover:text-(--ink-1) hover:bg-(--surface-2) transition-colors cursor-pointer"
              aria-label="Đóng xem lại"
              data-testid="replay-close-btn"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* LEFT / CENTER: Chessboard & Playback Controls */}
        <div className="flex-1 flex flex-col items-center justify-between p-4 sm:p-6 overflow-y-auto min-h-0 bg-(--bg)/40">
          {/* Selected Game Info Banner */}
          {effectiveSelectedGame && (
            <div className="w-full max-w-120 mb-3 p-3 rounded-lg bg-(--surface) border border-(--border) flex flex-col gap-2 shrink-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div
                  className="flex items-center gap-2"
                  data-testid="replay-active-game-badges"
                  data-board-id={effectiveSelectedGame.board_id}
                >
                  {renderScopeBadge(effectiveSelectedGame.game_scope, effectiveSelectedGame.board_id)}
                  {renderResultBadge(effectiveSelectedGame.result)}
                </div>
                <div className="text-xs text-(--ink-3) flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {effectiveSelectedGame.ended_at
                      ? new Date(effectiveSelectedGame.ended_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : new Date(effectiveSelectedGame.started_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                  </span>
                </div>
              </div>

              {/* Player Metadata (using fields that actually exist) */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-(--border)">
                <div className="flex items-center gap-1.5 truncate max-w-[48%]">
                  <span className="w-2.5 h-2.5 rounded-full bg-white border border-gray-400 inline-block shrink-0" />
                  <span className="text-(--ink-3)">Trắng:</span>
                  <span className="font-semibold text-(--ink-1) truncate font-mono">
                    {effectiveSelectedGame.white_user_id ? effectiveSelectedGame.white_user_id.slice(0, 8) : 'Chưa chỉ định'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 truncate max-w-[48%] justify-end">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-900 border border-gray-600 inline-block shrink-0" />
                  <span className="text-(--ink-3)">Đen:</span>
                  <span className="font-semibold text-(--ink-1) truncate font-mono">
                    {effectiveSelectedGame.black_user_id ? effectiveSelectedGame.black_user_id.slice(0, 8) : 'Chưa chỉ định'}
                  </span>
                </div>
              </div>

              {effectiveSelectedGame.termination_reason && (
                <div className="text-[11px] text-(--ink-3) italic">
                  Lý do kết thúc: {effectiveSelectedGame.termination_reason}
                </div>
              )}
            </div>
          )}

          {/* Board Container */}
          <div className="relative flex flex-col items-center justify-center shrink-0 my-auto">
            <div
              data-testid="replay-board-wrapper"
              className="border-2 border-(--border-strong) rounded-sm overflow-hidden shadow-md bg-(--surface)"
            >
              <ChessgroundView
                fen={currentFen}
                orientation={orientation}
                lastMove={lastMoveSquares}
                viewOnly={true}
                size={340}
                ariaLabel={`Replay chess board - ${orientation} perspective`}
              />
            </div>

            {/* Error or Empty PGN Overlay Banner */}
            {effectiveSelectedGame && !parsedPgn.valid && (
              <div
                data-testid="replay-pgn-error"
                className="mt-3 max-w-85 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs text-center flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
                <span>{parsedPgn.error || 'Biên bản ván đấu không hợp lệ hoặc bị lỗi.'}</span>
              </div>
            )}
          </div>

          {/* ── Playback Controls Toolbar ───────────────────────────────── */}
          <div
            data-testid="replay-controls"
            className="w-full max-w-120 mt-4 p-2.5 rounded-xl bg-(--surface) border border-(--border) flex items-center justify-between gap-2 shrink-0"
          >
            {/* Left: Flip orientation button */}
            <button
              type="button"
              onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
              className="p-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-(--ink-2) hover:text-(--ink-1) transition-colors cursor-pointer"
              aria-label="Xoay bàn cờ"
              title="Xoay góc nhìn bàn cờ"
              data-testid="replay-flip-btn"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>

            {/* Center: Step Navigation Buttons */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {/* First move */}
              <button
                type="button"
                onClick={handleFirstMove}
                disabled={effectiveCurrentStep === 0 || !parsedPgn.valid || moves.length === 0}
                className="p-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-(--ink-1) disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                aria-label="First move"
                title="Về đầu ván (Nước 0)"
                data-testid="replay-first-btn"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              {/* Prev move */}
              <button
                type="button"
                onClick={handlePrevMove}
                disabled={effectiveCurrentStep === 0 || !parsedPgn.valid || moves.length === 0}
                className="p-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-(--ink-1) disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                aria-label="Previous move"
                title="Nước trước"
                data-testid="replay-prev-btn"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Play / Pause */}
              <button
                type="button"
                onClick={handleTogglePlayPause}
                disabled={!parsedPgn.valid || moves.length === 0}
                className="px-3.5 py-2 rounded-lg bg-(--accent) hover:opacity-90 text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-opacity cursor-pointer flex items-center gap-1.5"
                aria-label={effectiveIsPlaying ? 'Pause' : 'Play'}
                title={effectiveIsPlaying ? 'Tạm dừng phát lại' : 'Tự động phát lại'}
                data-testid="replay-play-pause-btn"
              >
                {effectiveIsPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span className="text-xs">{effectiveIsPlaying ? 'Dừng' : 'Phát'}</span>
              </button>

              {/* Next move */}
              <button
                type="button"
                onClick={handleNextMove}
                disabled={effectiveCurrentStep >= moves.length || !parsedPgn.valid || moves.length === 0}
                className="p-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-(--ink-1) disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                aria-label="Next move"
                title="Nước tiếp theo"
                data-testid="replay-next-btn"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Last move */}
              <button
                type="button"
                onClick={handleLastMove}
                disabled={effectiveCurrentStep >= moves.length || !parsedPgn.valid || moves.length === 0}
                className="p-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-(--ink-1) disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                aria-label="Last move"
                title="Đến cuối ván"
                data-testid="replay-last-btn"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Right: Step Counter & Speed Selector */}
            <div className="flex items-center gap-2">
              <span
                data-testid="replay-step-indicator"
                className="font-mono text-xs text-(--ink-2) px-1.5 py-0.5 rounded bg-(--surface-2)"
              >
                {effectiveCurrentStep} / {moves.length}
              </span>

              {/* Playback speed toggle */}
              <button
                type="button"
                onClick={() => setPlaybackSpeedMs((s) => (s === 1000 ? 500 : s === 500 ? 1500 : 1000))}
                className="text-[11px] font-mono px-2 py-1 rounded bg-(--surface-2) hover:bg-(--surface-3) text-(--ink-2) cursor-pointer"
                title="Tốc độ phát lại"
                data-testid="replay-speed-btn"
              >
                {playbackSpeedMs === 1000 ? '1x' : playbackSpeedMs === 500 ? '2x' : '0.7x'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Game List & Move Notation Panel */}
        <div className="w-full lg:w-84 xl:w-96 border-t lg:border-t-0 lg:border-l border-(--border) bg-(--surface) flex flex-col min-h-0 shrink-0">
          {/* Tab Selector */}
          <div className="flex border-b border-(--border) bg-(--surface-2)/50 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('moves')}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                activeTab === 'moves'
                  ? 'bg-(--surface) text-(--ink-1) shadow-xs'
                  : 'text-(--ink-3) hover:text-(--ink-1)'
              }`}
              data-testid="replay-tab-moves"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Nước đi ({moves.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('games')}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                activeTab === 'games'
                  ? 'bg-(--surface) text-(--ink-1) shadow-xs'
                  : 'text-(--ink-3) hover:text-(--ink-1)'
              }`}
              data-testid="replay-tab-games"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Ván đấu ({effectiveGames.length})</span>
            </button>
          </div>

          {/* TAB 1: Move Notation History */}
          {activeTab === 'moves' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-3 border-b border-(--border) text-xs text-(--ink-2) flex items-center justify-between shrink-0 bg-(--surface-2)/20">
                <span className="font-semibold">Biên bản ván đấu</span>
                <span className="text-[11px] text-(--ink-3)">
                  {moves.length > 0 ? `${moves.length} nước đi` : '0 nước đi'}
                </span>
              </div>

              <div
                ref={moveLogContainerRef}
                data-testid="replay-move-list"
                className="flex-1 overflow-y-auto p-2 min-h-48"
              >
                {!parsedPgn.valid || moves.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-(--ink-3)">
                    <HelpCircle className="w-6 h-6 mb-2 opacity-50" />
                    <span>Chưa có nước đi nào để hiển thị</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {movePairs.map((pair) => {
                      const whiteActive = pair.white && effectiveCurrentStep === pair.white.index + 1
                      const blackActive = pair.black && effectiveCurrentStep === pair.black.index + 1

                      return (
                        <div
                          key={pair.moveNumber}
                          className="flex items-center text-xs py-1 px-2 rounded-md hover:bg-(--surface-2)/50 transition-colors"
                          data-testid={`replay-move-pair-${pair.moveNumber}`}
                        >
                          <span className="w-9 font-mono text-(--ink-3) shrink-0">
                            {pair.moveNumber}.
                          </span>

                          {/* White Move */}
                          <div className="flex-1">
                            {pair.white && (
                              <button
                                type="button"
                                onClick={() => handleJumpToStep(pair.white!.index + 1)}
                                className={`px-2 py-0.5 rounded text-left font-mono cursor-pointer transition-colors ${
                                  whiteActive
                                    ? 'bg-(--accent) text-white font-bold shadow-xs'
                                    : 'text-(--ink-1) hover:bg-(--surface-2)'
                                }`}
                                data-testid={`replay-move-${pair.white.index}`}
                                aria-current={whiteActive ? 'step' : undefined}
                              >
                                {renderSanWithIcon(pair.white.san)}
                              </button>
                            )}
                          </div>

                          {/* Black Move */}
                          <div className="flex-1">
                            {pair.black && (
                              <button
                                type="button"
                                onClick={() => handleJumpToStep(pair.black!.index + 1)}
                                className={`px-2 py-0.5 rounded text-left font-mono cursor-pointer transition-colors ${
                                  blackActive
                                    ? 'bg-(--accent) text-white font-bold shadow-xs'
                                    : 'text-(--ink-1) hover:bg-(--surface-2)'
                                }`}
                                data-testid={`replay-move-${pair.black.index}`}
                                aria-current={blackActive ? 'step' : undefined}
                              >
                                {renderSanWithIcon(pair.black.san)}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Session Game List */}
          {activeTab === 'games' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-3 border-b border-(--border) text-xs text-(--ink-2) flex items-center justify-between shrink-0 bg-(--surface-2)/20">
                <span className="font-semibold">Ván đấu trong buổi học</span>
                <button
                  type="button"
                  onClick={() => fetchGames()}
                  className="p-1 rounded text-(--ink-3) hover:text-(--ink-1) hover:bg-(--surface-2) transition-colors cursor-pointer"
                  title="Tải lại danh sách"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div
                data-testid="replay-games-list"
                className="flex-1 overflow-y-auto p-2 min-h-48"
              >
                {/* Loading State */}
                {effectiveLoadingGames && (
                  <div
                    data-testid="replay-games-loading"
                    className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-(--ink-3) gap-2"
                  >
                    <Loader2 className="w-5 h-5 animate-spin text-(--accent)" />
                    <span>Đang tải danh sách ván đấu...</span>
                  </div>
                )}

                {/* Error State */}
                {!effectiveLoadingGames && effectiveErrorGames && (
                  <div
                    data-testid="replay-games-error"
                    className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Lỗi tải ván đấu</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{effectiveErrorGames}</p>
                    <button
                      type="button"
                      onClick={() => fetchGames()}
                      className="self-start px-3 py-1 rounded bg-red-500 text-white font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Thử lại
                    </button>
                  </div>
                )}

                {/* Empty State */}
                {!effectiveLoadingGames && !effectiveErrorGames && effectiveGames.length === 0 && (
                  <div
                    data-testid="replay-games-empty"
                    className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-(--ink-3) gap-2"
                  >
                    <Swords className="w-8 h-8 opacity-40 text-(--ink-3)" />
                    <span className="font-semibold text-(--ink-2)">Chưa có ván đấu nào</span>
                    <span className="text-[11px] max-w-xs leading-relaxed">
                      Không có ván cờ nào được ghi lại hoặc hoàn thành trong buổi học này.
                    </span>
                  </div>
                )}

                {/* Success Games List */}
                {!effectiveLoadingGames && !effectiveErrorGames && effectiveGames.length > 0 && (() => {
                  const displayedGames = selectedBoardFilter
                    ? effectiveGames.filter((g) => g.board_id === selectedBoardFilter)
                    : effectiveGames

                  return (
                    <div className="flex flex-col gap-1.5">
                      {selectedBoardFilter && (
                        <div
                          data-testid="replay-board-filter-badge"
                          className="px-2.5 py-1.5 mb-1 rounded-lg bg-(--accent-soft) border border-(--accent-border) text-[11px] text-(--accent) flex items-center justify-between"
                        >
                          <span>
                            Lọc theo bàn: <strong data-testid="active-board-filter-id">{selectedBoardFilter}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedBoardFilter(null)}
                            className="text-[10px] underline hover:opacity-80 cursor-pointer font-medium"
                            data-testid="clear-board-filter-btn"
                          >
                            Xem tất cả bàn
                          </button>
                        </div>
                      )}

                      {displayedGames.length === 0 ? (
                        <div
                          data-testid="replay-games-board-empty"
                          className="py-8 flex flex-col items-center justify-center text-center text-xs text-(--ink-3) gap-2"
                        >
                          <Swords className="w-6 h-6 opacity-40 text-(--ink-3)" />
                          <span className="font-semibold text-(--ink-2)">
                            Không có ván đấu nào cho bàn &quot;{selectedBoardFilter}&quot;
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedBoardFilter(null)}
                            className="mt-1 px-3 py-1 rounded bg-(--surface-2) text-(--ink-1) border border-(--border) hover:bg-(--surface-3) text-xs cursor-pointer"
                          >
                            Xem tất cả bàn
                          </button>
                        </div>
                      ) : (
                        displayedGames.map((g) => {
                          const isSelected = g.id === effectiveSelectedGameId
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => handleSelectGame(g.id)}
                              data-testid={`replay-game-card-${g.id}`}
                              data-board-id={g.board_id}
                              aria-selected={isSelected}
                              className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer flex flex-col gap-1.5 ${
                                isSelected
                                  ? 'bg-(--accent-soft) border-(--accent) shadow-xs'
                                  : 'bg-(--surface) border-(--border) hover:border-(--border-strong) hover:bg-(--surface-2)/60'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 flex-wrap">
                                {renderScopeBadge(g.game_scope, g.board_id)}
                                {renderResultBadge(g.result)}
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-(--ink-3) pt-1 border-t border-(--border)/60">
                                <span>
                                  Trắng: <strong className="text-(--ink-1)">{g.white_user_id ? g.white_user_id.slice(0, 8) : '—'}</strong>
                                </span>
                                <span>
                                  Đen: <strong className="text-(--ink-1)">{g.black_user_id ? g.black_user_id.slice(0, 8) : '—'}</strong>
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-(--ink-3)">
                                <span>{g.move_count} nước</span>
                                <span>
                                  {g.ended_at
                                    ? new Date(g.ended_at).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : new Date(g.started_at).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                </span>
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
