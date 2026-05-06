import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { parsePgn } from '../../utils/parsePgn'

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
  onBookmark?: () => void
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
  const parsed = useMemo(() => parsePgn(lesson.pgn_data), [lesson.pgn_data])
  const expectedMoves = parsed.valid ? parsed.moves : []
  const totalPlies = expectedMoves.length

  const [playedPlies, setPlayedPlies] = useState(0)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [wrongMoveSquare, setWrongMoveSquare] = useState<string | null>(null)
  const [hintActive, setHintActive] = useState(false)
  const [viewPerspective, setViewPerspective] = useState<'white' | 'black'>(lesson.board_perspective)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const completedFiredRef = useRef(false)
  const opponentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const learnerColor = lesson.board_perspective
  const upcomingSide: 'white' | 'black' = playedPlies % 2 === 0 ? 'white' : 'black'
  const awaitingOpponent = playedPlies < totalPlies && upcomingSide !== learnerColor

  useEffect(() => {
    if (totalPlies > 0 && playedPlies >= totalPlies && !completedFiredRef.current) {
      completedFiredRef.current = true
      onComplete?.()
    }
    if (playedPlies < totalPlies) {
      completedFiredRef.current = false
    }
  }, [playedPlies, totalPlies, onComplete])

  useEffect(() => {
    if (!onBookmark) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'b' && e.key !== 'B') return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      onBookmark!()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBookmark])
  const wrongMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!awaitingOpponent) return
    opponentTimer.current = setTimeout(() => {
      opponentTimer.current = null
      setPlayedPlies((p) => p + 1)
    }, OPPONENT_DELAY_MS)
    return () => {
      if (opponentTimer.current) {
        clearTimeout(opponentTimer.current)
        opponentTimer.current = null
      }
    }
  }, [awaitingOpponent, playedPlies])

  const currentFen = playedPlies === 0
    ? STARTING_FEN
    : expectedMoves[playedPlies - 1].fen

  const lastMove = playedPlies === 0
    ? undefined
    : { from: expectedMoves[playedPlies - 1].from, to: expectedMoves[playedPlies - 1].to }

  function handleSquareClick(square: string) {
    if (hintActive) setHintActive(false)
    if (playedPlies >= totalPlies) return
    if (awaitingOpponent) return

    const expected = expectedMoves[playedPlies]

    if (selectedSquare === null) {
      setSelectedSquare(square)
      return
    }

    const from = selectedSquare
    const to = square
    setSelectedSquare(null)

    if (from === expected.from && to === expected.to) {
      setPlayedPlies(playedPlies + 1)
      return
    }

    setWrongMoveSquare(from)
    if (wrongMoveTimer.current) clearTimeout(wrongMoveTimer.current)
    wrongMoveTimer.current = setTimeout(() => {
      setWrongMoveSquare(null)
      wrongMoveTimer.current = null
    }, 1000)
  }

  const sideToMove = playedPlies % 2 === 0 ? 'White' : 'Black'
  const learnerColorLabel = learnerColor === 'white' ? 'White' : 'Black'

  // Build move-log entries grouped by full-move number from played plies
  interface FullMoveEntry {
    moveNumber: number
    white?: string
    black?: string
  }
  const playedFullMoves: FullMoveEntry[] = []
  for (let i = 0; i < playedPlies; i++) {
    const ply = expectedMoves[i]
    const idx = Math.floor(i / 2)
    if (!playedFullMoves[idx]) {
      playedFullMoves[idx] = { moveNumber: idx + 1 }
    }
    if (i % 2 === 0) {
      playedFullMoves[idx].white = ply.san
    } else {
      playedFullMoves[idx].black = ply.san
    }
  }

  const annotationsByMove = new Map<number, string>()
  for (const annotation of parsed.annotations ?? []) {
    annotationsByMove.set(annotation.moveNumber, annotation.text)
  }

  const hasPendingMoves = playedPlies < totalPlies
  const nextExpected = hasPendingMoves ? expectedMoves[playedPlies] : null
  const hintSquares = hintActive && nextExpected
    ? { from: nextExpected.from, to: nextExpected.to }
    : null

  return (
    <div data-testid="guided-player-root">
      <div data-testid="guided-player-eyebrow">
        LESSON {lessonNumber} OF {totalLessons}
      </div>
      <h2 data-testid="guided-player-title">{lesson.title}</h2>
      <p data-testid="guided-player-helper">
        Drag a piece to make your move. Wrong moves snap back.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          data-testid="guided-player-side-to-move"
          aria-label={`${sideToMove} to move`}
        >
          {sideToMove}
        </span>
        <span data-testid="guided-player-perspective-label">
          · you'll play as {learnerColorLabel}
        </span>
      </div>
      <div data-testid="guided-player-move-counter">
        Move {Math.min(playedPlies + 1, totalPlies)} of {totalPlies}
      </div>
      <InteractiveBoard
        fen={currentFen}
        perspective={viewPerspective}
        lastMove={lastMove}
        wrongMoveSquare={wrongMoveSquare}
        hintSquares={hintSquares}
        onSquareClick={handleSquareClick}
      />

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
          Hint
        </button>
        <button
          type="button"
          data-testid="guided-player-flip-btn"
          onClick={() => setViewPerspective((p) => (p === 'white' ? 'black' : 'white'))}
        >
          Flip board
        </button>
        <button
          type="button"
          data-testid="guided-player-reset-btn"
          onClick={() => setResetDialogOpen(true)}
        >
          Reset lesson
        </button>
      </div>

      {resetDialogOpen && (
        <div data-testid="guided-player-reset-dialog" role="dialog" aria-modal="true">
          <p>Reset the lesson and start over?</p>
          <button
            type="button"
            data-testid="guided-player-reset-cancel"
            onClick={() => setResetDialogOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="guided-player-reset-confirm"
            onClick={() => {
              if (opponentTimer.current) {
                clearTimeout(opponentTimer.current)
                opponentTimer.current = null
              }
              setPlayedPlies(0)
              setSelectedSquare(null)
              setWrongMoveSquare(null)
              setHintActive(false)
              setResetDialogOpen(false)
            }}
          >
            Reset
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
        {hasPendingMoves && !awaitingOpponent && upcomingSide === learnerColor && (
          <div data-testid="your-turn-prompt">
            <strong>Your turn.</strong> Play the expected move.
          </div>
        )}
        {hasPendingMoves && (awaitingOpponent || upcomingSide !== learnerColor) && (
          <div
            data-testid="opponent-thinking-indicator"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            Opponent thinking…
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
