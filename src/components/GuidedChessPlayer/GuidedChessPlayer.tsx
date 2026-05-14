import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chess } from 'chess.js'
import ChessgroundView from '../ChessBoard/ChessgroundView'
import { parsePgn } from '../../utils/parsePgn'
import type { PgnNode, Shape } from '../../utils/parsePgn'
import PromotionPicker from './PromotionPicker'
import type { PromotionPiece } from './PromotionPicker'
import type { DrawShape } from 'chessground/draw'

export interface GuidedLesson {
  id: string
  title: string
  pgn_data: string
  board_perspective: 'white' | 'black'
  coach_note?: string | null
  /** Custom starting FEN — when set, the board starts from this position (also encoded in pgn_data [FEN "..."] tag). */
  starting_fen?: string | null
}

export interface GuidedChessPlayerProps {
  lesson: GuidedLesson
  lessonNumber: number
  totalLessons: number
  initialNodeId?: string
  onComplete?: () => void
  onBookmark?: (nodeId: string, currentFen: string, depth: number, totalDepth: number) => void
}

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
        movable={perspective}
        drawable={{ enabled: false, autoShapes: autoShapes ?? [] }}
        onSquareSelect={(square) => onSquareClick?.(square)}
        onMove={(from, to) => onPieceDrop?.(from, to) ?? false}
      />
    </div>
  )
}

export default function GuidedChessPlayer({
  lesson,
  lessonNumber,
  totalLessons,
  initialNodeId,
  onComplete,
  onBookmark,
}: GuidedChessPlayerProps) {
  const { t } = useTranslation()
  const parsed = useMemo(() => parsePgn(lesson.pgn_data), [lesson.pgn_data])
  const totalPlies = parsed.mainLine.length

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

  function dismissHelper() {
    setHelperVisible(false)
    localStorage.setItem('guidedPlayer.helperHidden', 'true')
  }

  const completedFiredRef = useRef(false)
  const opponentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrongMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // onComplete when leaf reached
  useEffect(() => {
    // Fire onComplete when at a non-root leaf
    if (atLeaf && currentNode && currentNode.parentId !== null && !completedFiredRef.current) {
      completedFiredRef.current = true
      onComplete?.()
    }
    if (!atLeaf) {
      completedFiredRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atLeaf, currentNodeId])

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

  // Clear wrong-move timer on unmount
  useEffect(() => {
    return () => {
      if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
    }
  }, [])

  // Opponent auto-play
  useEffect(() => {
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
  }, [awaitingOpponent, currentNodeId])

  function commitNode(next: PgnNode) {
    setCurrentNodeId(next.id)
  }

  function handlePieceDrop(from: string, to: string): boolean {
    if (atLeaf || awaitingOpponent) return false
    setSelectedSquare(null)
    setDraggingSquare(null)

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
    return (currentNode?.children ?? []).some(c => c.from === square)
  }

  function handleSquareClick(square: string) {
    if (hintActive) setHintActive(false)
    if (atLeaf) return
    if (awaitingOpponent) return

    if (selectedSquare === null) {
      setSelectedSquare(square)
      return
    }

    const from = selectedSquare
    const to = square
    setSelectedSquare(null)

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

  // Build move log from path-from-root
  interface FullMoveEntry {
    moveNumber: number
    white?: string
    black?: string
    annotation?: string | null
  }
  const playedFullMoves: FullMoveEntry[] = []
  for (let i = 0; i < pathFromRoot.length; i++) {
    const node = pathFromRoot[i]
    const idx = Math.floor(i / 2)
    if (!playedFullMoves[idx]) {
      playedFullMoves[idx] = { moveNumber: idx + 1 }
    }
    if (i % 2 === 0) {
      playedFullMoves[idx].white = node.san
      if (node.annotation) playedFullMoves[idx].annotation = node.annotation
    } else {
      playedFullMoves[idx].black = node.san
      if (node.annotation) playedFullMoves[idx].annotation = node.annotation
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

        {/* Board */}
        <InteractiveBoard
          fen={currentFen}
          perspective={viewPerspective}
          size={480}
          lastMove={lastMove}
          wrongMoveSquare={wrongMoveSquare}
          hintSquares={hintSquares}
          selectedSquare={selectedSquare}
          validDestinations={validDestinations}
          autoShapes={shapesToDrawShapes(currentNode?.shapes ?? [])}
          onSquareClick={handleSquareClick}
          onPieceDrop={handlePieceDrop}
          onDragStart={setDraggingSquare}
          canDrag={canDrag}
        />
        {promotionCandidates.length > 0 && (
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

        {/* Action buttons below board */}
        <div className="guided-player-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="guided-player-hint-btn"
            disabled={awaitingOpponent || upcomingSide !== learnerColor}
            onClick={() => setHintActive((h) => !h)}
          >
            {t('guidedPlayer.hint')}
          </button>
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
        </div>
      </div>

      {/* Annotation column */}
      <div className="guided-player-annotation-col">
        {/* Header: eyebrow + title + helper */}
        <div className="guided-player-annotation-header">
          <div data-testid="guided-player-eyebrow" className="guided-player-eyebrow">
            {t('guidedPlayer.eyebrow', { current: lessonNumber, total: totalLessons })}
          </div>
          <h2 data-testid="guided-player-title" className="guided-player-title">{lesson.title}</h2>
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
            return (
              <div
                key={entry.moveNumber}
                data-testid={`move-block-${entry.moveNumber}`}
                className={`guided-player-move-block${isLast ? ' guided-player-move-block-highlight' : ''}`}
              >
                <div className="guided-player-move-san-row">
                  <span className="guided-player-move-num">{entry.moveNumber}.</span>
                  <span className="guided-player-move-san">{entry.white ?? ''}</span>
                  {entry.black && <span className="guided-player-move-san">{entry.black}</span>}
                </div>
                {entry.annotation && (
                  <p
                    data-testid={`move-log-annotation-${entry.moveNumber}`}
                    className="guided-player-move-annotation"
                  >
                    {entry.annotation}
                  </p>
                )}
              </div>
            )
          })}

          {hasPendingMoves && !awaitingOpponent && (
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

          {lesson.coach_note && (
            <aside data-testid="guided-player-coach-note" className="guided-player-coach-note">
              <p>{lesson.coach_note}</p>
            </aside>
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
                  setCurrentNodeId('root')
                  setSelectedSquare(null)
                  setWrongMoveSquare(null)
                  setHintActive(false)
                  setPromotionCandidates([])
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
