import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chess } from 'chess.js'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import ChessgroundView from '../ChessBoard/ChessgroundView'
import { parsePgn } from '../../utils/parsePgn'
import type { PgnNode, Shape, RichTextDoc } from '../../utils/parsePgn'
import PromotionPicker from './PromotionPicker'
import type { PromotionPiece } from './PromotionPicker'
import type { DrawShape } from 'chessground/draw'
import NoteView from './NoteView'
import { recordPuzzleAttempt, getBestPuzzleAttempt } from '../../lib/puzzleAttemptApi'
import type { BestPuzzleAttempt } from '../../lib/puzzleAttemptApi'

export interface GuidedLesson {
  id: string
  title: string
  pgn_data: string
  board_perspective: 'white' | 'black'
  coach_note?: string | null
  /** Custom starting FEN — when set, the board starts from this position (also encoded in pgn_data [FEN "..."] tag). */
  starting_fen?: string | null
  /** Puzzle mode: which side the learner plays. */
  puzzle_player_side?: 'white' | 'black' | null
  /** Lesson type — 'puzzle' activates puzzle mode logic. */
  type?: 'chess' | 'video' | 'puzzle'
  /** When true the lesson supports a Study (viewer) ↔ Rewind (lesson) toggle. */
  has_rewind_mode?: boolean
}

export interface GuidedChessPlayerProps {
  lesson: GuidedLesson
  lessonNumber: number
  totalLessons: number
  initialNodeId?: string
  /** Controls play mode. Defaults to 'lesson'. */
  mode?: 'lesson' | 'puzzle' | 'viewer'
  /**
   * Called when the learner reaches any leaf node.
   * In puzzle mode: `gaveUp` is true when the learner used "Xem đáp án".
   */
  onComplete?: (gaveUp?: boolean) => void
  onBookmark?: (nodeId: string, currentFen: string, depth: number, totalDepth: number) => void
  /** Called (debounced 2 s) when the current node changes — used to persist resume position. */
  onResumeNodeChange?: (nodeId: string) => void
  /** Supabase client — required in puzzle mode to record attempts and read best attempts. */
  supabaseClient?: SupabaseClient
  /**
   * When present, the player renders a Study ↔ Rewind toggle button. The parent
   * owns the active mode state; clicking the button calls this back so the
   * parent can swap mode + remount the player at root (issue #226).
   */
  onToggleMode?: () => void
}

const MISTAKE_REVERT_MS = 1500

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const OPPONENT_DELAY_MS = 600

function shapesToDrawShapes(shapes: Shape[]): DrawShape[] {
  return shapes.map((s) =>
    s.kind === 'arrow'
      ? { orig: s.from as import('chessground/types').Key, dest: s.to as import('chessground/types').Key, brush: s.color }
      : { orig: s.square as import('chessground/types').Key, brush: s.color }
  )
}

interface InteractiveBoardProps {
  fen: string
  perspective: 'white' | 'black'
  size?: number
  lastMove?: { from: string; to: string }
  wrongMoveSquare?: string | null
  hintSquares?: { from: string; to: string } | null
  selectedSquare?: string | null
  validDestinations?: Set<string>
  autoShapes?: DrawShape[]
  viewOnly?: boolean
  /** When true, the learner can draw their own arrows/circles via right-click. */
  drawableEnabled?: boolean
  /** Map from origin square to list of destination squares — drives Chessground drag/click. */
  dests?: Map<string, string[]>
  onSquareClick?: (square: string) => void
  onPieceDrop?: (from: string, to: string) => boolean
  onDragStart?: (square: string) => void
  canDrag?: (square: string) => boolean
}

function InteractiveBoard({
  fen,
  perspective,
  size = 480,
  lastMove,
  wrongMoveSquare,
  hintSquares,
  selectedSquare,
  autoShapes,
  viewOnly = false,
  drawableEnabled = false,
  dests,
  onSquareClick,
  onPieceDrop,
}: InteractiveBoardProps) {
  const lastMoveSquares: [string, string] | null = lastMove
    ? [lastMove.from, lastMove.to]
    : null
  const hintSquarePair: [string, string] | null = hintSquares
    ? [hintSquares.from, hintSquares.to]
    : null

  return (
    <div
      data-testid="guided-player-board"
      aria-label={`Chess board — ${perspective} perspective`}
      style={{ width: size, userSelect: 'none' }}
    >
      <ChessgroundView
        fen={fen}
        orientation={perspective}
        size={size}
        lastMove={lastMoveSquares}
        hintSquares={hintSquarePair}
        selectedSquare={selectedSquare}
        wrongMoveSquare={wrongMoveSquare}
        movable={viewOnly ? null : perspective}
        dests={viewOnly ? undefined : dests}
        viewOnly={viewOnly}
        drawable={{ enabled: drawableEnabled, autoShapes: autoShapes ?? [] }}
        onSquareSelect={viewOnly ? undefined : (square) => onSquareClick?.(square)}
        onMove={viewOnly ? undefined : (from, to) => onPieceDrop?.(from, to) ?? false}
      />
    </div>
  )
}

export default function GuidedChessPlayer({
  lesson,
  lessonNumber,
  totalLessons,
  initialNodeId,
  mode = 'lesson',
  onComplete,
  onBookmark,
  onResumeNodeChange,
  supabaseClient,
  onToggleMode,
}: GuidedChessPlayerProps) {
  const { t } = useTranslation()
  const parsed = useMemo(() => parsePgn(lesson.pgn_data), [lesson.pgn_data])
  const totalPlies = parsed.mainLine.length

  const isPuzzleMode = mode === 'puzzle'

  const [currentNodeId, setCurrentNodeId] = useState<string>(initialNodeId ?? 'root')
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [wrongMoveSquare, setWrongMoveSquare] = useState<string | null>(null)
  const [hintActive, setHintActive] = useState(false)
  const [viewPerspective, setViewPerspective] = useState<'white' | 'black'>(lesson.board_perspective)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [promotionCandidates, setPromotionCandidates] = useState<PgnNode[]>([])
  const [draggingSquare, setDraggingSquare] = useState<string | null>(null)
  const [helperVisible, setHelperVisible] = useState(
    () => localStorage.getItem('guidedPlayer.helperHidden') !== 'true'
  )
  // Puzzle mode: mistake banner state
  const [mistakeBannerNode, setMistakeBannerNode] = useState<PgnNode | null>(null)
  // Puzzle mode: wrong attempts per node
  const wrongAttemptsAt = useRef<Record<string, number>>({})
  // Puzzle mode: best attempt from previous sessions
  const [bestPuzzleAttempt, setBestPuzzleAttempt] = useState<BestPuzzleAttempt | null>(null)
  // Puzzle mode: completion state
  const [puzzleCompletionInfo, setPuzzleCompletionInfo] = useState<{ wrongAttempts: number; prevBest: BestPuzzleAttempt | null } | null>(null)
  // Puzzle mode: session start time for duration_seconds
  const puzzleStartTime = useRef<number>(Date.now())
  // Puzzle mode: gaveUp flag (set when "Xem đáp án" is clicked)
  const gaveUpRef = useRef(false)
  const [gaveUp, setGaveUp] = useState(false)
  // Timers for show-answer animation
  const showAnswerTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  function dismissHelper() {
    setHelperVisible(false)
    localStorage.setItem('guidedPlayer.helperHidden', 'true')
  }

  // Load best puzzle attempt on mount (puzzle mode only)
  useEffect(() => {
    if (!isPuzzleMode || !supabaseClient) return
    puzzleStartTime.current = Date.now()
    getBestPuzzleAttempt(supabaseClient, lesson.id)
      .then((best) => {
        setBestPuzzleAttempt(best)
      })
      .catch(() => {
        // silently ignore — no badge shown
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const completedFiredRef = useRef(false)
  const opponentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrongMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mistakeBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isViewer = mode === 'viewer'
  // A two-mode lesson (has_rewind_mode=true) routes through this player twice:
  // once in 'viewer' = Study, once in 'lesson' = Rewind. The Rewind side hides
  // the notes + Hint so the learner is forced to play from memory (#226).
  const isRewindMode = mode === 'lesson' && !!onToggleMode
  const showAnnotationNotes = !isRewindMode

  // Resume debounce — save currentNodeId 2 s after last change
  useEffect(() => {
    if (!onResumeNodeChange) return
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => {
      onResumeNodeChange(currentNodeId)
      resumeTimer.current = null
    }, 2000)
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNodeId])

  const learnerColor = lesson.board_perspective
  const learnerSide: 'w' | 'b' = learnerColor === 'white' ? 'w' : 'b'

  // Derive current node from tree; fall back to root
  const currentNode: PgnNode | null = parsed.root
    ? (parsed.nodeMap.get(currentNodeId) ?? parsed.root)
    : null

  const atLeaf = !currentNode || currentNode.children.length === 0
  const hasPendingMoves = !atLeaf
  const nextChild = currentNode?.children[0]
  const awaitingOpponent = hasPendingMoves && nextChild!.side !== learnerSide
  const upcomingSide: 'white' | 'black' = nextChild?.side === 'w' ? 'white' : 'black'

  // Path from root to currentNode (for move log)
  const pathFromRoot = useMemo<PgnNode[]>(() => {
    if (!currentNode || currentNode.parentId === null) return []
    const path: PgnNode[] = []
    let node: PgnNode | undefined = currentNode
    while (node && node.parentId !== null) {
      path.unshift(node)
      node = parsed.nodeMap.get(node.parentId)
    }
    return path
  }, [currentNode, parsed.nodeMap])

  const currentFen = currentNode?.fen ?? STARTING_FEN
  const lastMove = currentNode && currentNode.parentId !== null
    ? { from: currentNode.from, to: currentNode.to }
    : undefined

  // Legal-move destinations from chess.js — required by Chessground (free=false) so the
  // learner can pick up pieces. handlePieceDrop then validates against the lesson tree
  // and snap-backs wrong moves (D-10).
  //
  // Returns an empty map when the lesson tree has no more authored moves
  // (atLeaf) or it's the opponent's turn (awaitingOpponent). Chessground
  // commits the drag in its own state before firing events.after, so an
  // early-return inside handlePieceDrop alone leaves the piece visually on
  // the destination square: emptying dests blocks the drag at the source
  // and keeps the board pinned to the last authored position.
  const legalDests = useMemo(() => {
    if (atLeaf || awaitingOpponent) return new Map<string, string[]>()
    try {
      const chess = new Chess(currentFen)
      const map = new Map<string, string[]>()
      for (const move of chess.moves({ verbose: true })) {
        const existing = map.get(move.from)
        if (existing) existing.push(move.to)
        else map.set(move.from, [move.to])
      }
      return map
    } catch {
      return new Map<string, string[]>()
    }
  }, [currentFen, atLeaf, awaitingOpponent])

  // onComplete when leaf reached
  useEffect(() => {
    // In puzzle mode with mistake banner active, don't fire complete on the mistake leaf
    if (isPuzzleMode && mistakeBannerNode) return
    // Fire onComplete when at a non-root leaf
    if (atLeaf && currentNode && currentNode.parentId !== null && !completedFiredRef.current) {
      completedFiredRef.current = true

      if (isPuzzleMode) {
        // Compute aggregated wrong attempts (sum across all nodes)
        const totalWrong = Object.values(wrongAttemptsAt.current).reduce((sum, n) => sum + n, 0)
        const durationSeconds = Math.round((Date.now() - puzzleStartTime.current) / 1000)
        const prevBest = bestPuzzleAttempt

        // Show completion screen only for genuine solves (not give-ups — banner shows instead)
        if (!gaveUpRef.current) {
          setPuzzleCompletionInfo({ wrongAttempts: totalWrong, prevBest })
        }

        // Record attempt with gave_up flag — errors logged but do not block completion UI
        if (supabaseClient) {
          recordPuzzleAttempt(supabaseClient, {
            lesson_id: lesson.id,
            wrong_attempts: totalWrong,
            duration_seconds: durationSeconds,
            gave_up: gaveUpRef.current,
          }).catch((err: unknown) => {
            console.error('[GuidedChessPlayer] recordPuzzleAttempt failed:', err)
          })
        }
      }

      onComplete?.(gaveUpRef.current)
    }
    if (!atLeaf) {
      completedFiredRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atLeaf, currentNodeId, mistakeBannerNode])

  // Keyboard bookmark
  useEffect(() => {
    if (!onBookmark) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'b' && e.key !== 'B') return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      const depth = currentNode?.depthFromRoot ?? 0
      onBookmark!(currentNodeId, currentFen, depth, totalPlies)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBookmark, currentNodeId, currentFen, currentNode, totalPlies])

  // Viewer keyboard navigation (←/→)
  useEffect(() => {
    if (!isViewer) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        const next = currentNode?.children[0]
        if (next) setCurrentNodeId(next.id)
      } else if (e.key === 'ArrowLeft') {
        if (currentNode?.parentId) setCurrentNodeId(currentNode.parentId)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewer, currentNodeId, currentNode])

  // Clear wrong-move, mistake-banner, and show-answer timers on unmount
  useEffect(() => {
    return () => {
      if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
      if (mistakeBannerTimer.current) clearTimeout(mistakeBannerTimer.current)
      for (const t of showAnswerTimers.current) clearTimeout(t)
    }
  }, [])

  // Opponent auto-play
  useEffect(() => {
    // Viewer (Study) mode is manual stepping — every click of ←/→ should move
    // exactly one ply, regardless of side. Auto-play here fights both intents:
    // forward-click jumps two plies, and back-click is immediately undone (#229
    // follow-up). The interactive lesson + puzzle modes keep auto-play so the
    // learner only ever plays one side.
    if (isViewer) return
    // In puzzle mode with an active mistake banner, skip auto-play until banner clears
    if (isPuzzleMode && mistakeBannerNode) return
    // During "Xem đáp án" animation, we step all nodes manually — skip auto-play
    if (gaveUpRef.current) return
    if (!awaitingOpponent || !currentNode) return
    const next = currentNode.children[0]
    opponentTimer.current = setTimeout(() => {
      opponentTimer.current = null
      setCurrentNodeId(next.id)
    }, OPPONENT_DELAY_MS)
    return () => {
      if (opponentTimer.current) {
        clearTimeout(opponentTimer.current)
        opponentTimer.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingOpponent, currentNodeId, mistakeBannerNode, isViewer])

  function commitNode(next: PgnNode) {
    setCurrentNodeId(next.id)
  }

  /**
   * Puzzle mode: handle a move attempt.
   * Returns true if the move was accepted, false otherwise.
   */
  function handlePuzzleMove(from: string, to: string): boolean {
    const candidates = (currentNode?.children ?? []).filter(c => c.from === from && c.to === to)

    if (candidates.length === 0) {
      // No match at all — snap-back + red square + increment wrongAttempts
      const nodeId = currentNodeId
      wrongAttemptsAt.current[nodeId] = (wrongAttemptsAt.current[nodeId] ?? 0) + 1
      setWrongMoveSquare(from)
      if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
      wrongMoveTimer.current = setTimeout(() => {
        setWrongMoveSquare(null)
        wrongMoveTimer.current = null
      }, 1000)
      return false
    }

    // Check if it's a mistake candidate
    const mistakeCandidate = candidates.find(c => c.purpose === 'mistake')
    if (mistakeCandidate && candidates.length === 1) {
      // Show banner with note text for MISTAKE_REVERT_MS, then revert
      // Do NOT increment wrongAttemptsAt, do NOT mark wrong-move square
      setMistakeBannerNode(mistakeCandidate)
      // Temporarily advance to show the move
      setCurrentNodeId(mistakeCandidate.id)
      if (mistakeBannerTimer.current) clearTimeout(mistakeBannerTimer.current)
      const parentId = currentNodeId
      mistakeBannerTimer.current = setTimeout(() => {
        mistakeBannerTimer.current = null
        setMistakeBannerNode(null)
        // Revert to parent
        setCurrentNodeId(parentId)
      }, MISTAKE_REVERT_MS)
      return true
    }

    // Accepted: main line OR purpose='correct' candidate
    if (candidates.length === 1) {
      commitNode(candidates[0])
      return true
    }

    // Multiple candidates (e.g. promotions) — show picker
    setPromotionCandidates(candidates)
    return false
  }

  function handlePieceDrop(from: string, to: string): boolean {
    if (atLeaf || awaitingOpponent) return false
    if (mistakeBannerNode) return false
    setSelectedSquare(null)
    setDraggingSquare(null)

    if (isPuzzleMode) {
      return handlePuzzleMove(from, to)
    }

    const candidates = (currentNode?.children ?? []).filter(c => c.from === from && c.to === to)

    if (candidates.length === 0) {
      setWrongMoveSquare(from)
      if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
      wrongMoveTimer.current = setTimeout(() => {
        setWrongMoveSquare(null)
        wrongMoveTimer.current = null
      }, 1000)
      return false
    } else if (candidates.length === 1) {
      commitNode(candidates[0])
      return true
    } else {
      setPromotionCandidates(candidates)
      return false
    }
  }

  function canDrag(square: string): boolean {
    if (atLeaf || awaitingOpponent) return false
    if (mistakeBannerNode) return false
    return (currentNode?.children ?? []).some(c => c.from === square)
  }

  // ── Puzzle hint escalation ────────────────────────────────────────────────

  const currentWrongAttempts = isPuzzleMode ? (wrongAttemptsAt.current[currentNodeId] ?? 0) : 0
  const hintLevel = currentWrongAttempts >= 3 ? 2 : currentWrongAttempts >= 2 ? 1 : 0

  const puzzleHintShapes: DrawShape[] = isPuzzleMode && hintLevel > 0 && currentNode && currentNode.children.length > 0
    ? (() => {
        const mainMove = currentNode.children[0]
        const orig = mainMove.from as import('chessground/types').Key
        const dest = mainMove.to as import('chessground/types').Key
        const shapes: DrawShape[] = [{ orig, brush: 'paleGrey' }]
        if (hintLevel >= 2) shapes.push({ orig, dest, brush: 'paleGrey' })
        return shapes
      })()
    : []

  // ── "Xem đáp án" — play main line to leaf ────────────────────────────────

  function playAnswer() {
    // Suppress further interaction
    gaveUpRef.current = true
    setGaveUp(true)
    // Clear any pending opponent timer
    if (opponentTimer.current) {
      clearTimeout(opponentTimer.current)
      opponentTimer.current = null
    }
    // Clear any active mistake banner
    if (mistakeBannerTimer.current) {
      clearTimeout(mistakeBannerTimer.current)
      mistakeBannerTimer.current = null
    }
    setMistakeBannerNode(null)

    // Build main-line path from currentNodeId to leaf
    const nodesToPlay: string[] = []
    let node = parsed.nodeMap.get(currentNodeId)
    while (node && node.children.length > 0) {
      node = node.children[0]
      nodesToPlay.push(node.id)
    }

    // Schedule each step with OPPONENT_DELAY_MS gap
    for (const t of showAnswerTimers.current) clearTimeout(t)
    showAnswerTimers.current = []
    nodesToPlay.forEach((nodeId, i) => {
      const timer = setTimeout(() => {
        setCurrentNodeId(nodeId)
      }, (i + 1) * OPPONENT_DELAY_MS)
      showAnswerTimers.current.push(timer)
    })
  }

  function handleSquareClick(square: string) {
    if (hintActive) setHintActive(false)
    if (atLeaf) return
    if (awaitingOpponent) return
    if (mistakeBannerNode) return

    if (selectedSquare === null) {
      setSelectedSquare(square)
      return
    }

    const from = selectedSquare
    const to = square
    setSelectedSquare(null)

    if (isPuzzleMode) {
      handlePuzzleMove(from, to)
      return
    }

    // Re-select if clicking another own piece that has moves in the variation tree
    const boardState = new Chess(currentFen)
    const clickedPiece = boardState.get(square as Parameters<Chess['get']>[0])
    if (clickedPiece && clickedPiece.color === learnerSide) {
      const isValidFromSquare = (currentNode?.children ?? []).some(c => c.from === square)
      if (isValidFromSquare) {
        setSelectedSquare(square)
        return
      }
    }

    const candidates = (currentNode?.children ?? []).filter(c => c.from === from && c.to === to)

    if (candidates.length === 0) {
      setWrongMoveSquare(from)
      if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
      wrongMoveTimer.current = setTimeout(() => {
        setWrongMoveSquare(null)
        wrongMoveTimer.current = null
      }, 1000)
    } else if (candidates.length === 1) {
      commitNode(candidates[0])
    } else {
      // Multiple candidates = promotion picker
      setPromotionCandidates(candidates)
    }
  }

  // Build move log. In Study (viewer) mode we show the whole main line so the
  // learner sees the full lesson at a glance; in every other mode we show only
  // what's been played so far. The current node is tracked separately for the
  // highlight pill in the JSX.
  interface FullMoveEntry {
    moveNumber: number
    white?: string
    whiteId?: string
    black?: string
    blackId?: string
    note?: RichTextDoc | null
  }
  const moveLogSourceNodes: PgnNode[] = isViewer ? parsed.mainLine : pathFromRoot
  const playedFullMoves: FullMoveEntry[] = []
  for (const node of moveLogSourceNodes) {
    const idx = node.moveNumber - 1
    if (idx < 0) continue
    if (!playedFullMoves[idx]) {
      playedFullMoves[idx] = { moveNumber: node.moveNumber }
    }
    if (node.side === 'w') {
      playedFullMoves[idx].white = node.san
      playedFullMoves[idx].whiteId = node.id
    } else {
      playedFullMoves[idx].black = node.san
      playedFullMoves[idx].blackId = node.id
    }
    if (node.note && !playedFullMoves[idx].note) {
      playedFullMoves[idx].note = node.note
    }
  }

  // Annotations from path (covers main line and variations)

  const hintSquares = hintActive && hasPendingMoves && currentNode
    ? { from: currentNode.children[0].from, to: currentNode.children[0].to }
    : null

  const validDestinations = useMemo<Set<string> | undefined>(() => {
    const activeSquare = selectedSquare ?? draggingSquare
    if (!activeSquare || atLeaf || awaitingOpponent) return undefined
    try {
      const chess = new Chess(currentFen)
      const moves = chess.moves({ square: activeSquare as Parameters<Chess['moves']>[0]['square'], verbose: true })
      const dests = new Set(moves.map(m => m.to))
      return dests.size > 0 ? dests : undefined
    } catch {
      return undefined
    }
  }, [selectedSquare, draggingSquare, currentFen, atLeaf, awaitingOpponent])

  const sideToMove = upcomingSide === 'white' ? t('guidedPlayer.sideWhite') : t('guidedPlayer.sideBlack')
  const learnerColorLabel = learnerColor === 'white' ? t('guidedPlayer.sideWhite') : t('guidedPlayer.sideBlack')
  const depthFromRoot = currentNode?.depthFromRoot ?? 0

  return (
    <div data-testid="guided-player-root" className="guided-player-root">
      {/* Board column */}
      <div className="guided-player-board-col">
        {/* Study ↔ Rewind switcher — only for two-mode lessons. Placed above
            the board so the active mode is immediately obvious. */}
        {onToggleMode && (
          <div
            data-testid="mode-switcher"
            role="group"
            aria-label={t('guidedPlayer.modeSwitcherAria')}
            className="guided-player-mode-switcher"
          >
            <button
              type="button"
              data-testid="mode-switch-study"
              aria-pressed={isViewer}
              className={`guided-player-mode-switch-btn${isViewer ? ' guided-player-mode-switch-btn-active' : ''}`}
              onClick={() => { if (!isViewer) onToggleMode() }}
            >
              <span className="guided-player-mode-switch-title">{t('guidedPlayer.modeStudyTitle')}</span>
              <span className="guided-player-mode-switch-subtitle">{t('guidedPlayer.modeStudySubtitle')}</span>
            </button>
            <button
              type="button"
              data-testid="mode-switch-rewind"
              aria-pressed={!isViewer}
              className={`guided-player-mode-switch-btn${!isViewer ? ' guided-player-mode-switch-btn-active' : ''}`}
              onClick={() => { if (isViewer) onToggleMode() }}
            >
              <span className="guided-player-mode-switch-title">{t('guidedPlayer.modeRewindTitle')}</span>
              <span className="guided-player-mode-switch-subtitle">{t('guidedPlayer.modeRewindSubtitle')}</span>
            </button>
          </div>
        )}

        {/* Meta row: side badge + move counter */}
        <div className="guided-player-board-meta">
          <div className="guided-player-board-meta-left">
            <span
              data-testid="guided-player-side-to-move"
              className="guided-player-side-badge"
              aria-label={t('guidedPlayer.sideToMoveAria', { side: sideToMove })}
            >
              {sideToMove}
            </span>
            <span data-testid="guided-player-perspective-label" className="guided-player-status-label">
              {t('guidedPlayer.perspectiveSubLabel', { color: learnerColorLabel })}
            </span>
            {currentNode && currentNode.children.length > 1 && (
              <span data-testid="variation-count-pill" className="guided-player-variation-pill">
                {t('guidedPlayer.variationCountPill', { n: currentNode.children.length - 1 })}
              </span>
            )}
          </div>
          <span data-testid="guided-player-move-counter" className="guided-player-move-counter">
            {t('guidedPlayer.moveCounter', { current: Math.min(depthFromRoot + 1, totalPlies), total: totalPlies })}
          </span>
        </div>

        {/* Board (relative parent for the wrong-move overlay) */}
        <div className="guided-player-board-wrap">
          <InteractiveBoard
            fen={currentFen}
            perspective={viewPerspective}
            size={480}
            lastMove={lastMove}
            wrongMoveSquare={wrongMoveSquare}
            hintSquares={hintSquares}
            selectedSquare={selectedSquare}
            validDestinations={validDestinations}
            autoShapes={
              // Rewind is a "play it back from memory" surface — strip every
              // shape the creator anchored to the node so the learner has a
              // clean board to reason on. Puzzle hint shapes never fire in
              // Rewind mode (different mode prop) so this branch is fine to
              // empty out entirely.
              isRewindMode
                ? []
                : [...shapesToDrawShapes(currentNode?.shapes ?? []), ...puzzleHintShapes]
            }
            viewOnly={isViewer}
            // Let learners draw their own arrows/circles for reasoning while
            // they're actually playing (Rewind, regular lesson, puzzle). The
            // Study/viewer half is read-only so we keep it off there.
            drawableEnabled={!isViewer}
            dests={legalDests}
            onSquareClick={isViewer ? undefined : handleSquareClick}
            onPieceDrop={isViewer ? undefined : handlePieceDrop}
            onDragStart={isViewer ? undefined : setDraggingSquare}
            canDrag={isViewer ? undefined : canDrag}
          />

          {/* Wrong-move banner — overlay so showing/hiding it does NOT reflow
              the board (#231 follow-up). Stays out of the layout flow. */}
          {!isViewer && !isPuzzleMode && wrongMoveSquare && (
            <div
              data-testid="wrong-move-banner"
              role="alert"
              className="guided-player-wrong-move-banner"
            >
              {t('guidedPlayer.wrongMoveBanner')}
            </div>
          )}
        </div>
        {!isViewer && promotionCandidates.length > 0 && (
          <PromotionPicker
            offered={promotionCandidates.map(c => c.promotion as PromotionPiece)}
            onPick={(piece) => {
              const chosen = promotionCandidates.find(c => c.promotion === piece)
              setPromotionCandidates([])
              if (chosen) commitNode(chosen)
            }}
            onDismiss={() => setPromotionCandidates([])}
          />
        )}

      </div>

      {/* Annotation column */}
      <div className="guided-player-annotation-col">
        {/* Header: eyebrow + title + helper */}
        <div className="guided-player-annotation-header">
          <div data-testid="guided-player-eyebrow" className="guided-player-eyebrow">
            {t('guidedPlayer.eyebrow', { current: lessonNumber, total: totalLessons })}
          </div>
          <h2 data-testid="guided-player-title" className="guided-player-title">{lesson.title}</h2>
          {isPuzzleMode && bestPuzzleAttempt !== null && (
            <span
              data-testid="puzzle-best-badge"
              className="guided-player-puzzle-best-badge"
              style={{
                display: 'inline-block',
                fontSize: 12,
                color: 'var(--green-9)',
                background: 'var(--green-2)',
                border: '1px solid var(--green-6)',
                borderRadius: 'var(--r-sm)',
                padding: '2px 8px',
                marginBottom: 4,
              }}
            >
              {t('guidedPlayer.puzzleBestBadge', { count: bestPuzzleAttempt.wrong_attempts })}
            </span>
          )}
          {helperVisible && (
            <div className="guided-player-helper-wrap">
              <ul data-testid="guided-player-helper" className="guided-player-helper">
                {(t('guidedPlayer.helperItems', { returnObjects: true }) as string[]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button
                type="button"
                className="guided-player-helper-dismiss"
                aria-label={t('guidedPlayer.helperDismiss')}
                onClick={dismissHelper}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Scrollable body: move log + your-turn + coach note */}
        <div data-testid="guided-player-move-log" className="guided-player-annotation-body">
          {playedFullMoves.map((entry, idx) => {
            const isLast = idx === playedFullMoves.length - 1
            const whiteIsCurrent = !!entry.whiteId && entry.whiteId === currentNodeId
            const blackIsCurrent = !!entry.blackId && entry.blackId === currentNodeId
            const containsCurrent = whiteIsCurrent || blackIsCurrent
            // In viewer mode the move log is also a navigator; in other modes
            // we keep the existing "last played highlight" semantics.
            const shouldHighlight = isViewer ? containsCurrent : isLast
            return (
              <div
                key={entry.moveNumber}
                data-testid={`move-block-${entry.moveNumber}`}
                className={`guided-player-move-block${shouldHighlight ? ' guided-player-move-block-highlight' : ''}`}
              >
                <div className="guided-player-move-san-row">
                  <span className="guided-player-move-num">{entry.moveNumber}.</span>
                  {entry.white ? (
                    isViewer && entry.whiteId ? (
                      <button
                        type="button"
                        data-testid={`move-jump-${entry.whiteId}`}
                        aria-current={whiteIsCurrent ? 'true' : undefined}
                        className={`guided-player-move-san guided-player-move-san-jump${whiteIsCurrent ? ' guided-player-move-san-current' : ''}`}
                        onClick={() => entry.whiteId && setCurrentNodeId(entry.whiteId)}
                      >
                        {entry.white}
                      </button>
                    ) : (
                      <span className={`guided-player-move-san${whiteIsCurrent ? ' guided-player-move-san-current' : ''}`}>{entry.white}</span>
                    )
                  ) : (
                    <span className="guided-player-move-san" />
                  )}
                  {entry.black && (
                    isViewer && entry.blackId ? (
                      <button
                        type="button"
                        data-testid={`move-jump-${entry.blackId}`}
                        aria-current={blackIsCurrent ? 'true' : undefined}
                        className={`guided-player-move-san guided-player-move-san-jump${blackIsCurrent ? ' guided-player-move-san-current' : ''}`}
                        onClick={() => entry.blackId && setCurrentNodeId(entry.blackId)}
                      >
                        {entry.black}
                      </button>
                    ) : (
                      <span className={`guided-player-move-san${blackIsCurrent ? ' guided-player-move-san-current' : ''}`}>{entry.black}</span>
                    )
                  )}
                </div>
                {entry.note && showAnnotationNotes && (
                  <div
                    data-testid={`move-log-annotation-${entry.moveNumber}`}
                    className="guided-player-move-annotation"
                  >
                    <NoteView note={entry.note} />
                  </div>
                )}
              </div>
            )
          })}

          {/* Puzzle gave-up completion message */}
          {isPuzzleMode && gaveUp && atLeaf && (
            <div
              data-testid="puzzle-gave-up-complete"
              role="alert"
              style={{
                background: 'var(--amber-2, #fef3c7)',
                border: '1px solid var(--amber-6, #d97706)',
                borderRadius: 'var(--r-sm)',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--amber-9, #92400e)',
                marginBottom: 8,
              }}
            >
              {t('guidedPlayer.puzzleGaveUpComplete')}
            </div>
          )}

          {/* Puzzle mistake banner */}
          {isPuzzleMode && mistakeBannerNode && (
            <div
              data-testid="puzzle-mistake-banner"
              role="alert"
              style={{
                background: 'var(--red-2, #fee2e2)',
                border: '1px solid var(--red-6, #f87171)',
                borderRadius: 'var(--r-sm)',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--red-9, #991b1b)',
                marginBottom: 8,
              }}
            >
              {mistakeBannerNode.note ? (
                <NoteView note={mistakeBannerNode.note} />
              ) : (
                t('guidedPlayer.puzzleMistakeBanner')
              )}
            </div>
          )}

          {hasPendingMoves && !awaitingOpponent && !mistakeBannerNode && !isViewer && (
            <div data-testid="your-turn-prompt" className="guided-player-your-turn">
              <svg className="guided-player-your-turn-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 1L9.8 6.2H15.5L10.9 9.5L12.7 14.6L8 11.3L3.3 14.6L5.1 9.5L0.5 6.2H6.2L8 1Z" />
              </svg>
              <div>
                <strong>{t('guidedPlayer.yourTurnHeading')}</strong> {t('guidedPlayer.yourTurnBody')}
              </div>
            </div>
          )}

          {hasPendingMoves && awaitingOpponent && (
            <div data-testid="opponent-thinking-indicator" className="guided-player-opponent-thinking">
              {t('guidedPlayer.opponentThinking')}
            </div>
          )}

          {lesson.coach_note && showAnnotationNotes && (
            <aside data-testid="guided-player-coach-note" className="guided-player-coach-note">
              <p>{lesson.coach_note}</p>
            </aside>
          )}

          {/* Puzzle completion screen */}
          {isPuzzleMode && puzzleCompletionInfo !== null && (
            <div
              data-testid="puzzle-completion-screen"
              role="status"
              style={{
                marginTop: 16,
                padding: '12px 16px',
                background: 'var(--green-2)',
                border: '1px solid var(--green-6)',
                borderRadius: 'var(--r-sm)',
                fontSize: 14,
                color: 'var(--green-9)',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {t('guidedPlayer.puzzleCompleteTitle')}
              </div>
              <div data-testid="puzzle-completion-wrong-attempts">
                {t('guidedPlayer.puzzleCompleteWrongAttempts', { count: puzzleCompletionInfo.wrongAttempts })}
              </div>
              {puzzleCompletionInfo.prevBest !== null && (
                <div data-testid="puzzle-completion-best">
                  {t('guidedPlayer.puzzleCompleteBest', { count: puzzleCompletionInfo.prevBest.wrong_attempts })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action footer — pinned to the bottom of the annotation column so it
            never gets pushed off-screen by a long move log. The move-log body
            above is the scrollable region. */}
        <div className="guided-player-actions">
          {isViewer ? (() => {
            const mainLineEndId = parsed.mainLine[parsed.mainLine.length - 1]?.id
            const atMainLineEnd = mainLineEndId !== undefined && currentNodeId === mainLineEndId
            const atRoot = currentNodeId === 'root' || !currentNode?.parentId
            return (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="viewer-begin-btn"
                aria-label={t('guidedPlayer.viewerBeginMove')}
                title={t('guidedPlayer.viewerBeginMove')}
                disabled={atRoot}
                onClick={() => setCurrentNodeId('root')}
              >
                <ChevronsLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="viewer-prev-btn"
                aria-label={t('guidedPlayer.viewerPrevMove')}
                title={t('guidedPlayer.viewerPrevMove')}
                disabled={atRoot}
                onClick={() => {
                  if (currentNode?.parentId) setCurrentNodeId(currentNode.parentId)
                }}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="viewer-next-btn"
                aria-label={t('guidedPlayer.viewerNextMove')}
                title={t('guidedPlayer.viewerNextMove')}
                disabled={atMainLineEnd || atLeaf}
                onClick={() => {
                  const next = currentNode?.children[0]
                  if (next) setCurrentNodeId(next.id)
                }}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="viewer-end-btn"
                aria-label={t('guidedPlayer.viewerEndMove')}
                title={t('guidedPlayer.viewerEndMove')}
                disabled={atMainLineEnd || !mainLineEndId}
                onClick={() => {
                  if (mainLineEndId) setCurrentNodeId(mainLineEndId)
                }}
              >
                <ChevronsRight size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="guided-player-flip-btn"
                onClick={() => setViewPerspective((p) => (p === 'white' ? 'black' : 'white'))}
              >
                {t('guidedPlayer.flipBoard')}
              </button>
            </>
            )
          })() : (
            <>
              {!isRewindMode && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  data-testid="guided-player-hint-btn"
                  disabled={awaitingOpponent || upcomingSide !== learnerColor}
                  onClick={() => setHintActive((h) => !h)}
                >
                  {t('guidedPlayer.hint')}
                </button>
              )}
              {isPuzzleMode && hintLevel >= 2 && !gaveUp && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  data-testid="puzzle-show-answer-btn"
                  onClick={playAnswer}
                >
                  {t('guidedPlayer.puzzleShowAnswer')}
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="guided-player-flip-btn"
                onClick={() => setViewPerspective((p) => (p === 'white' ? 'black' : 'white'))}
              >
                {t('guidedPlayer.flipBoard')}
              </button>
              <div className="guided-player-actions-divider" aria-hidden="true" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                data-testid="guided-player-reset-btn"
                onClick={() => setResetDialogOpen(true)}
              >
                {t('guidedPlayer.resetLesson')}
              </button>
            </>
          )}
        </div>

      </div>

      {/* Reset dialog */}
      {resetDialogOpen && (
        <div data-testid="guided-player-reset-dialog" className="guided-player-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="guided-player-dialog-box">
            <p className="guided-player-dialog-body">{t('guidedPlayer.resetDialogBody')}</p>
            <div className="guided-player-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="guided-player-reset-cancel"
                onClick={() => setResetDialogOpen(false)}
              >
                {t('guidedPlayer.resetCancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="guided-player-reset-confirm"
                onClick={() => {
                  if (opponentTimer.current) {
                    clearTimeout(opponentTimer.current)
                    opponentTimer.current = null
                  }
                  if (mistakeBannerTimer.current) {
                    clearTimeout(mistakeBannerTimer.current)
                    mistakeBannerTimer.current = null
                  }
                  setCurrentNodeId('root')
                  setSelectedSquare(null)
                  setWrongMoveSquare(null)
                  setHintActive(false)
                  setPromotionCandidates([])
                  setMistakeBannerNode(null)
                  wrongAttemptsAt.current = {}
                  gaveUpRef.current = false
                  setGaveUp(false)
                  for (const t of showAnswerTimers.current) clearTimeout(t)
                  showAnswerTimers.current = []
                  setPuzzleCompletionInfo(null)
                  puzzleStartTime.current = Date.now()
                  setResetDialogOpen(false)
                }}
              >
                {t('guidedPlayer.resetConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
