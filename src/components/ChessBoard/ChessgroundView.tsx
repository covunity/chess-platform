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

  return {
    fen: props.fen,
    orientation: color,
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

  const handleMove = (from: string, to: string) => {
    props.onMove?.(from, to)
  }

  const handleSelect = (sq: string) => {
    props.onSquareSelect?.(sq)
  }

  const handleShapes = (shapes: DrawShape[]) => {
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
  // On FEN change (node navigation), reinitialise shapes from the stored autoShapes.
  useEffect(() => {
    if (!apiRef.current) return
    const config = toConfig(props, handleMove, handleSelect, handleShapes)
    if (props.onShapesChange && config.drawable) {
      const fenChanged = props.fen !== prevFenRef.current
      config.drawable.shapes = fenChanged
        ? (props.drawable?.autoShapes ?? [])        // new node: init from stored shapes
        : apiRef.current.state.drawable.shapes       // same node: preserve user-drawn shapes
      config.drawable.autoShapes = []               // avoid double-rendering with shapes
    }
    prevFenRef.current = props.fen
    apiRef.current.set(config)
  })

  return (
    <div
      ref={containerRef}
      aria-label={props.ariaLabel}
      style={{ width: props.size, height: props.size }}
    />
  )
}
