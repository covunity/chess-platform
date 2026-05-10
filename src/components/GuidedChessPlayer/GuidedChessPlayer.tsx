import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chess } from 'chess.js'
import { parsePgn } from '../../utils/parsePgn'
import type { PgnNode } from '../../utils/parsePgn'
import PromotionPicker from './PromotionPicker'
import type { PromotionPiece } from './PromotionPicker'

export interface GuidedLesson {
  id: string
  title: string
  pgn_data: string
  board_perspective: 'white' | 'black'
  coach_note?: string | null
}

export interface GuidedChessPlayerProps {
  lesson: GuidedLesson
  lessonNumber: number
  totalLessons: number
  onComplete?: () => void
  onBookmark?: (nodeId: string, currentFen: string, depth: number, totalDepth: number) => void
}

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const OPPONENT_DELAY_MS = 600

interface InteractiveBoardProps {
  fen: string
  perspective: 'white' | 'black'
  size?: number
  lastMove?: { from: string; to: string }
  wrongMoveSquare?: string | null
  hintSquares?: { from: string; to: string } | null
  onSquareClick?: (square: string) => void
}

function InteractiveBoard({
  fen,
  perspective,
  size = 480,
  lastMove,
  wrongMoveSquare,
  hintSquares,
  onSquareClick,
}: InteractiveBoardProps) {
  const chess = new Chess(fen)
  const squareSize = size / 8

  const ranks = perspective === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = perspective === 'white' ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']

  return (
    <div
      data-testid="guided-player-board"
      role="grid"
      aria-label={`Chess board — ${perspective} perspective`}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(8, ${squareSize}px)`,
        gridTemplateRows: `repeat(8, ${squareSize}px)`,
        width: size,
        height: size,
        userSelect: 'none',
      }}
    >
      {ranks.map((rank) =>
        files.map((file) => {
          const square = `${file}${rank}` as const
          const fileIndex = file.charCodeAt(0) - 97
          const isLight = (fileIndex + rank) % 2 === 1
          const piece = chess.get(square as Parameters<Chess['get']>[0])
          const symbol = piece
            ? PIECE_UNICODE[piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()]
            : ''
          const isLastMove = lastMove && (lastMove.from === square || lastMove.to === square)
          const isWrongMove = wrongMoveSquare === square
          const isHint = hintSquares && (hintSquares.from === square || hintSquares.to === square)
          return (
            <div
              key={square}
              role="gridcell"
              data-square={square}
              data-last-move={isLastMove ? 'true' : undefined}
              data-wrong-move={isWrongMove ? 'true' : undefined}
              data-hint={isHint ? 'true' : undefined}
              onClick={() => onSquareClick?.(square)}
              style={{
                background: isLight ? 'var(--board-light)' : 'var(--board-dark)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: squareSize * 0.78,
                lineHeight: 1,
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              {symbol}
              {isLastMove && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--board-move)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {isWrongMove && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--board-error)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {isHint && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--board-highlight)',
                    boxShadow: 'inset 0 0 0 3px oklch(0.7 0.18 95)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

export default function GuidedChessPlayer({
  lesson,
  lessonNumber,
  totalLessons,
  onComplete,
  onBookmark,
}: GuidedChessPlayerProps) {
  const { t } = useTranslation()
  const parsed = useMemo(() => parsePgn(lesson.pgn_data), [lesson.pgn_data])
  const totalPlies = parsed.mainLine.length

  const [currentNodeId, setCurrentNodeId] = useState<string>('root')
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [wrongMoveSquare, setWrongMoveSquare] = useState<string | null>(null)
  const [hintActive, setHintActive] = useState(false)
  const [viewPerspective, setViewPerspective] = useState<'white' | 'black'>(lesson.board_perspective)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [promotionCandidates, setPromotionCandidates] = useState<PgnNode[]>([])

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
    } else {
      playedFullMoves[idx].black = node.san
    }
  }

  // Annotations from path (covers main line and variations)
  const annotationsByMove = useMemo(() => {
    const map = new Map<number, string>()
    for (const node of pathFromRoot) {
      if (node.annotation !== undefined) {
        map.set(node.moveNumber, node.annotation)
      }
    }
    return map
  }, [pathFromRoot])

  const hintSquares = hintActive && hasPendingMoves && currentNode
    ? { from: currentNode.children[0].from, to: currentNode.children[0].to }
    : null

  const sideToMove = upcomingSide === 'white' ? t('guidedPlayer.sideWhite') : t('guidedPlayer.sideBlack')
  const learnerColorLabel = learnerColor === 'white' ? t('guidedPlayer.sideWhite') : t('guidedPlayer.sideBlack')
  const depthFromRoot = currentNode?.depthFromRoot ?? 0

  return (
    <div data-testid="guided-player-root">
      <div data-testid="guided-player-eyebrow">
        {t('guidedPlayer.eyebrow', { current: lessonNumber, total: totalLessons })}
      </div>
      <h2 data-testid="guided-player-title">{lesson.title}</h2>
      <p data-testid="guided-player-helper">
        {t('guidedPlayer.helper')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          data-testid="guided-player-side-to-move"
          aria-label={t('guidedPlayer.sideToMoveAria', { side: sideToMove })}
        >
          {sideToMove}
        </span>
        <span data-testid="guided-player-perspective-label">
          {t('guidedPlayer.perspectiveSubLabel', { color: learnerColorLabel })}
        </span>
      </div>
      <div data-testid="guided-player-move-counter">
        {t('guidedPlayer.moveCounter', { current: Math.min(depthFromRoot + 1, totalPlies), total: totalPlies })}
      </div>

      {currentNode && currentNode.children.length > 1 && (
        <span data-testid="variation-count-pill" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {t('guidedPlayer.variationCountPill', { n: currentNode.children.length - 1 })}
        </span>
      )}

      <InteractiveBoard
        fen={currentFen}
        perspective={viewPerspective}
        lastMove={lastMove}
        wrongMoveSquare={wrongMoveSquare}
        hintSquares={hintSquares}
        onSquareClick={handleSquareClick}
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

      <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center' }}>
        <button
          type="button"
          data-testid="guided-player-hint-btn"
          disabled={awaitingOpponent || upcomingSide !== learnerColor}
          onClick={() => setHintActive((h) => !h)}
          style={{
            opacity: awaitingOpponent || upcomingSide !== learnerColor ? 0.5 : undefined,
            cursor: awaitingOpponent || upcomingSide !== learnerColor ? 'not-allowed' : undefined,
          }}
        >
          {t('guidedPlayer.hint')}
        </button>
        <button
          type="button"
          data-testid="guided-player-flip-btn"
          onClick={() => setViewPerspective((p) => (p === 'white' ? 'black' : 'white'))}
        >
          {t('guidedPlayer.flipBoard')}
        </button>
        <button
          type="button"
          data-testid="guided-player-reset-btn"
          onClick={() => setResetDialogOpen(true)}
        >
          {t('guidedPlayer.resetLesson')}
        </button>
      </div>

      {resetDialogOpen && (
        <div data-testid="guided-player-reset-dialog" role="dialog" aria-modal="true">
          <p>{t('guidedPlayer.resetDialogBody')}</p>
          <button
            type="button"
            data-testid="guided-player-reset-cancel"
            onClick={() => setResetDialogOpen(false)}
          >
            {t('guidedPlayer.resetCancel')}
          </button>
          <button
            type="button"
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
      )}

      <div data-testid="guided-player-move-log">
        {playedFullMoves.map((entry) => {
          const annotation = annotationsByMove.get(entry.moveNumber)
          return (
            <div key={entry.moveNumber} data-testid={`move-block-${entry.moveNumber}`}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {entry.moveNumber}. {entry.white ?? ''}
                {entry.black ? ` ${entry.black}` : ''}
              </span>
              {annotation && (
                <p data-testid={`move-log-annotation-${entry.moveNumber}`}>
                  {annotation}
                </p>
              )}
            </div>
          )
        })}
        {hasPendingMoves && !awaitingOpponent && (
          <div data-testid="your-turn-prompt">
            <strong>{t('guidedPlayer.yourTurnHeading')}</strong> {t('guidedPlayer.yourTurnBody')}
          </div>
        )}
        {hasPendingMoves && awaitingOpponent && (
          <div
            data-testid="opponent-thinking-indicator"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            {t('guidedPlayer.opponentThinking')}
          </div>
        )}
      </div>

      {lesson.coach_note && (
        <aside data-testid="guided-player-coach-note">
          <p>{lesson.coach_note}</p>
        </aside>
      )}
    </div>
  )
}
