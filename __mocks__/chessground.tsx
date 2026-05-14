/**
 * Test mock for chessground.
 * Implements Chessground(el, config) imperatively:
 * - Renders data-square divs with Unicode pieces
 * - Translates highlight CSS-var class names to data-* attributes
 * - Fires config.events.select on square click
 * - api.set(config) re-renders the board
 */

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function parseFen(fen: string): Record<string, string> {
  const position: Record<string, string> = {}
  const rows = (fen || STARTING_FEN).split(' ')[0].split('/')
  for (let r = 0; r < 8; r++) {
    let col = 0
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        col += parseInt(ch, 10)
      } else {
        position[`${String.fromCharCode(97 + col)}${8 - r}`] = ch
        col++
      }
    }
  }
  return position
}

// Map chessground CSS class names to data-* attribute names
const CLASS_TO_ATTR: Record<string, string> = {
  'last-move': 'data-last-move',
  'hint': 'data-hint',
  'selected': 'data-selected',
  'wrong-move': 'data-wrong-move',
}

interface MockDrawShape {
  orig: string
  dest?: string
  brush?: string
}

interface MockDrawable {
  enabled?: boolean
  visible?: boolean
  autoShapes?: MockDrawShape[]
  shapes?: MockDrawShape[]
  onChange?: (shapes: MockDrawShape[]) => void
}

interface MockConfig {
  fen?: string
  orientation?: 'white' | 'black'
  highlight?: {
    custom?: Map<string, string>
  }
  events?: {
    select?: (key: string) => void
    move?: (orig: string, dest: string) => void
  }
  movable?: {
    events?: {
      after?: (orig: string, dest: string) => void
    }
  }
  drawable?: MockDrawable
  [key: string]: unknown
}

function render(el: HTMLElement, config: MockConfig) {
  const fen = config.fen || STARTING_FEN
  const orientation = config.orientation || 'white'
  const pieces = parseFen(fen)
  const squareClasses: Map<string, string> = config.highlight?.custom ?? new Map()

  const files: string[] = orientation === 'white'
    ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
  const ranks: number[] = orientation === 'white'
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8]

  // Build set of squares with autoShapes for quick lookup
  const autoShapeOrigins = new Set<string>()
  const autoShapeDests = new Set<string>()
  for (const s of config.drawable?.autoShapes ?? []) {
    autoShapeOrigins.add(s.orig)
    if (s.dest) autoShapeDests.add(s.dest)
  }

  // Remove previous children
  while (el.firstChild) el.removeChild(el.firstChild)

  for (const rank of ranks) {
    for (const file of files) {
      const square = `${file}${rank}`
      const piece = pieces[square]
      const div = document.createElement('div')
      div.setAttribute('data-square', square)

      // Apply highlight data attributes
      const cls = squareClasses.get(square)
      if (cls) {
        const attr = CLASS_TO_ATTR[cls]
        if (attr) div.setAttribute(attr, 'true')
      }

      // Mark squares that have autoShapes (circles on orig, arrows from orig to dest)
      if (autoShapeOrigins.has(square)) div.setAttribute('data-autoshape', 'true')
      if (autoShapeDests.has(square)) div.setAttribute('data-autoshape-dest', 'true')

      div.textContent = piece ? (PIECE_UNICODE[piece] ?? '') : ''

      // Register click handler
      div.addEventListener('click', () => {
        config.events?.select?.(square)
      })

      el.appendChild(div)
    }
  }
}

export function Chessground(element: HTMLElement, config?: MockConfig) {
  let currentConfig: MockConfig = config ?? {}
  render(element, currentConfig)

  const api = {
    set(newConfig: MockConfig) {
      // Deep merge: newConfig overrides currentConfig
      currentConfig = { ...currentConfig, ...newConfig }
      if (newConfig.highlight !== undefined) {
        currentConfig.highlight = newConfig.highlight
      }
      if (newConfig.events !== undefined) {
        currentConfig.events = { ...currentConfig.events, ...newConfig.events }
      }
      if (newConfig.movable !== undefined) {
        currentConfig.movable = newConfig.movable
      }
      if (newConfig.drawable !== undefined) {
        currentConfig.drawable = { ...currentConfig.drawable, ...newConfig.drawable }
      }
      render(element, currentConfig)
    },
    destroy() {
      while (element.firstChild) element.removeChild(element.firstChild)
    },
    state: {},
    getFen: () => currentConfig.fen || STARTING_FEN,
    toggleOrientation: () => {},
    move: (orig: string, dest: string) => {
      currentConfig.movable?.events?.after?.(orig, dest)
    },
    setPieces: () => {},
    selectSquare: () => {},
    newPiece: () => {},
    playPremove: () => false,
    cancelPremove: () => {},
    playPredrop: () => false,
    cancelPredrop: () => {},
    cancelMove: () => {},
    stop: () => {},
    explode: () => {},
    setShapes: () => {},
    setAutoShapes: () => {},
    getKeyAtDomPos: () => undefined,
    redrawAll: () => {},
    dragNewPiece: () => {},
  }
  return api
}

export function initModule({ el, config }: { el: HTMLElement; config?: MockConfig }) {
  return Chessground(el, config)
}
