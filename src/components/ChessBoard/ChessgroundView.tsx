import { useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { Key, Dests } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'

export type { DrawShape }

export interface DrawableConfig {
  enabled?: boolean
  autoShapes?: DrawShape[]
}

export interface ChessgroundViewProps {
  fen: string
  orientation?: 'white' | 'black'
  /** Last move squares for highlighting [from, to] */
  lastMove?: [string, string] | null
  /** Squares to highlight with hint colour */
  hintSquares?: [string, string] | null
  /** Square to highlight with selected colour */
  selectedSquare?: string | null
  /** Valid destination squares to show dots on */
  validDestinations?: Set<string>
  /** Square to mark with error colour */
  wrongMoveSquare?: string | null
  /** If true, no interaction allowed */
  viewOnly?: boolean
  /** Which side can move */
  movable?: 'white' | 'black' | 'both' | null
  /** Valid destinations map for drag/click validation */
  dests?: Map<string, string[]>
  /** Drawable config: { enabled, autoShapes } */
  drawable?: DrawableConfig
  /** Called when user draws/removes shapes (editor mode) */
  onShapesChange?: (shapes: DrawShape[]) => void
  onMove?: (from: string, to: string) => boolean
  onSquareSelect?: (square: string) => void
  size?: number
  /** aria-label for the wrapper div */
  ariaLabel?: string
}

function buildSquareClasses(props: ChessgroundViewProps): Map<Key, string> {
  const m = new Map<Key, string>()
  if (props.lastMove) {
    const [from, to] = props.lastMove
    if (from) m.set(from as Key, 'last-move')
    if (to) m.set(to as Key, 'last-move')
  }
  if (props.hintSquares) {
    const [from, to] = props.hintSquares
    if (from) m.set(from as Key, 'hint')
    if (to) m.set(to as Key, 'hint')
  }
  if (props.selectedSquare) {
    m.set(props.selectedSquare as Key, 'selected')
  }
  if (props.wrongMoveSquare) {
    m.set(props.wrongMoveSquare as Key, 'wrong-move')
  }
  return m
}

function buildDests(props: ChessgroundViewProps): Dests | undefined {
  if (props.dests) return props.dests as unknown as Dests
  // validDestinations are valid squares for the selected piece;
  // chessground needs dests from origin — pass undefined and use free movement.
  return undefined
}

function toConfig(
  props: ChessgroundViewProps,
  onMove: (from: string, to: string) => void,
  onSelect: (sq: string) => void,
  onShapes: (shapes: DrawShape[]) => void,
): Config {
  const squareClasses = buildSquareClasses(props)
  const color = props.orientation ?? 'white'
  const movableColor: 'white' | 'black' | 'both' | undefined =
    props.viewOnly ? undefined :
    props.movable ?? undefined
  const drawableEnabled = props.drawable?.enabled ?? false
  // Chessground's isMovable() requires state.turnColor === piece.color, but its
  // configure() never derives turnColor from a fen — we must pass it explicitly,
  // otherwise drag-and-drop is rejected after the side-to-move flips between
  // renders (click-to-move bypasses the check, hence the inconsistency).
  const fenTurnField = props.fen.split(/\s+/)[1]
  const turnColor: 'white' | 'black' = fenTurnField === 'b' ? 'black' : 'white'

  return {
    fen: props.fen,
    orientation: color,
    turnColor,
    viewOnly: props.viewOnly ?? false,
    highlight: {
      lastMove: false, // we manage highlights manually via squareClasses
      check: false,
      custom: squareClasses,
    },
    animation: { enabled: false },
    movable: {
      free: false,
      color: movableColor,
      dests: buildDests(props),
      events: {
        after: (orig, dest) => onMove(orig, dest),
      },
    },
    selectable: { enabled: true },
    events: {
      select: (key) => onSelect(key),
    },
    draggable: { enabled: !props.viewOnly },
    drawable: {
      enabled: drawableEnabled,
      visible: true,
      autoShapes: props.drawable?.autoShapes ?? [],
      onChange: drawableEnabled ? onShapes : undefined,
    },
  }
}

export default function ChessgroundView(props: ChessgroundViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)
  const prevFenRef = useRef(props.fen)

  // Track the last non-empty shapes reported by Chessground's onChange.
  // When left-clicking a piece to move, Chessground fires onChange([]) before the
  // move completes (via drawable.cancel). We save the shapes here so handleMove
  // can restore them to the store for the node being left.
  const prevUserShapesRef = useRef<DrawShape[]>(props.drawable?.autoShapes ?? [])
  const shapesBeforeMoveRef = useRef<DrawShape[] | null>(null)

  const handleMove = (from: string, to: string) => {
    // Restore shapes cleared by the left-click that initiated this move
    if (shapesBeforeMoveRef.current !== null) {
      props.onShapesChange?.(shapesBeforeMoveRef.current)
      shapesBeforeMoveRef.current = null
    }
    props.onMove?.(from, to)
  }

  const handleSelect = (sq: string) => {
    props.onSquareSelect?.(sq)
  }

  const handleShapes = (shapes: DrawShape[]) => {
    if (props.onShapesChange) {
      if (shapes.length > 0) {
        prevUserShapesRef.current = shapes
        shapesBeforeMoveRef.current = null
      } else if (prevUserShapesRef.current.length > 0) {
        // Shapes just cleared — save them; handleMove will decide whether to restore
        shapesBeforeMoveRef.current = prevUserShapesRef.current
        prevUserShapesRef.current = []
      }
    }
    props.onShapesChange?.(shapes)
  }

  // Mount chessground
  useEffect(() => {
    if (!containerRef.current) return
    const config = toConfig(props, handleMove, handleSelect, handleShapes)
    apiRef.current = Chessground(containerRef.current, config)
    return () => {
      apiRef.current?.destroy()
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync config on every render.
  // When onShapesChange is provided (authoring mode), api.set() must never reset
  // drawable.shapes to [] — Chessground does this whenever drawable is in the config
  // but shapes is omitted. Fix: pass the current user-drawn shapes back explicitly.
  // On FEN change (node navigation), reinitialise shapes from the stored autoShapes
  // and reset the shape-tracking refs for the new node.
  useEffect(() => {
    if (!apiRef.current) return
    const config = toConfig(props, handleMove, handleSelect, handleShapes)
    if (props.onShapesChange && config.drawable) {
      const fenChanged = props.fen !== prevFenRef.current
      if (fenChanged) {
        prevUserShapesRef.current = props.drawable?.autoShapes ?? []
        shapesBeforeMoveRef.current = null
      }
      config.drawable.shapes = fenChanged
        ? (props.drawable?.autoShapes ?? [])        // new node: init from stored shapes
        : (apiRef.current.state as { drawable?: { shapes?: DrawShape[] } }).drawable?.shapes ?? []  // same node: preserve user-drawn shapes
      config.drawable.autoShapes = []               // avoid double-rendering with shapes
    }
    prevFenRef.current = props.fen
    apiRef.current.set(config)
    // Belt + braces in player mode: api.set() applies autoShapes via configure(),
    // but right after a piece-drop chessground has already mutated state via its
    // own move handling, and the deep merge can race the SVG redraw. Explicitly
    // re-applying autoShapes via the dedicated API forces a clean render so node
    // shapes (e.g. learner-side arrows on Rewind moves) actually appear.
    if (!props.onShapesChange) {
      apiRef.current.setAutoShapes(props.drawable?.autoShapes ?? [])
    }
  })

  return (
    <div
      ref={containerRef}
      aria-label={props.ariaLabel}
      style={{ width: props.size, height: props.size }}
    />
  )
}
