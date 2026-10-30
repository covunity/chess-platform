import React, { useState, useEffect, useRef } from 'react'
import { Chess } from 'chess.js'
import {
  Trash2,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Shuffle,
} from 'lucide-react'

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type Side = 'w' | 'b'

export interface PieceItem {
  type: PieceType
  side: Side
}

const PIECE_CLASS: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}
const SIDE_CLASS: Record<Side, string> = { w: 'white', b: 'black' }

export function CgPieceIcon({
  type,
  side,
  size = 36,
}: {
  type: PieceType
  side: Side
  size?: number
}) {
  return (
    <div
      className="cg-wrap"
      style={{
        position: 'relative',
        width: size,
        height: size,
        pointerEvents: 'none',
        display: 'inline-block',
      }}
    >
      {React.createElement('piece', {
        className: `${PIECE_CLASS[type]} ${SIDE_CLASS[side]}`,
        style: { position: 'absolute', width: '100%', height: '100%', top: 0, left: 0 },
      })}
    </div>
  )
}

const WHITE_PIECES: PieceItem[] = [
  { type: 'k', side: 'w' },
  { type: 'q', side: 'w' },
  { type: 'r', side: 'w' },
  { type: 'b', side: 'w' },
  { type: 'n', side: 'w' },
  { type: 'p', side: 'w' },
]

const BLACK_PIECES: PieceItem[] = [
  { type: 'k', side: 'b' },
  { type: 'q', side: 'b' },
  { type: 'r', side: 'b' },
  { type: 'b', side: 'b' },
  { type: 'n', side: 'b' },
  { type: 'p', side: 'b' },
]

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface BoardPreset {
  id: string
  name: string
  fen: string
  side: 'white' | 'black'
}

export const COMMON_PRESETS: BoardPreset[] = [
  {
    id: 'back_rank',
    name: 'Chiếu bí hàng ngang (Back-rank)',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    side: 'white',
  },
  {
    id: 'knight_fork',
    name: 'Đòn chĩa đôi của Mã (Knight Fork)',
    fen: '4k3/8/8/4N3/8/8/4q3/4K3 w - - 0 1',
    side: 'white',
  },
  {
    id: 'smothered_mate',
    name: 'Chiếu bí thắt cổ (Smothered Mate)',
    fen: '6rk/5Npp/8/8/8/8/8/4K3 w - - 0 1',
    side: 'white',
  },
  {
    id: 'endgame_rook',
    name: 'Tàn cuộc Vua + Xe vs Vua',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    side: 'white',
  },
  {
    id: 'pawn_endgame',
    name: 'Tàn cuộc Tốt chuẩn bị phong cấp',
    fen: '8/4P3/8/3k4/8/8/8/4K3 w - - 0 1',
    side: 'white',
  },
]

function parseFenToBoard(fen: string): Map<string, PieceItem> {
  const map = new Map<string, PieceItem>()
  try {
    const chess = new Chess(fen)
    const board = chess.board()
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = board[r][f]
        if (sq) {
          map.set(sq.square, { type: sq.type as PieceType, side: sq.color as Side })
        }
      }
    }
  } catch {
    // If invalid or empty
    const parts = fen.split(' ')[0]
    if (parts) {
      const rows = parts.split('/')
      for (let r = 0; r < Math.min(8, rows.length); r++) {
        let f = 0
        for (const ch of rows[r]) {
          if (ch >= '1' && ch <= '8') {
            f += parseInt(ch, 10)
          } else {
            const side: Side = ch === ch.toUpperCase() ? 'w' : 'b'
            const type = ch.toLowerCase() as PieceType
            const sq = `${FILES[f]}${RANKS[r]}`
            map.set(sq, { type, side })
            f++
          }
        }
      }
    }
  }
  return map
}

function buildFenFromBoard(
  board: Map<string, PieceItem>,
  sideToMove: 'white' | 'black'
): string {
  const rows: string[] = []
  for (const rank of RANKS) {
    let empty = 0
    let row = ''
    for (const file of FILES) {
      const sq = `${file}${rank}`
      const piece = board.get(sq)
      if (!piece) {
        empty++
      } else {
        if (empty > 0) {
          row += empty
          empty = 0
        }
        const ch = piece.side === 'w' ? piece.type.toUpperCase() : piece.type
        row += ch
      }
    }
    if (empty > 0) row += empty
    rows.push(row)
  }
  const turn = sideToMove === 'white' ? 'w' : 'b'
  return `${rows.join('/')} ${turn} - - 0 1`
}

export function validateBoardPieces(board: Map<string, PieceItem>): {
  isValid: boolean
  error: string | null
} {
  let whiteKings = 0
  let blackKings = 0
  let invalidPawns = 0

  for (const [sq, piece] of board.entries()) {
    if (piece.type === 'k') {
      if (piece.side === 'w') whiteKings++
      if (piece.side === 'b') blackKings++
    }
    if (piece.type === 'p') {
      const rank = sq[1]
      if (rank === '1' || rank === '8') {
        invalidPawns++
      }
    }
  }

  if (whiteKings === 0 && blackKings === 0) {
    return { isValid: false, error: 'Hãy đặt Vua Trắng và Vua Đen lên bàn cờ' }
  }
  if (whiteKings === 0) {
    return { isValid: false, error: 'Thiếu Vua Trắng trên bàn cờ' }
  }
  if (whiteKings > 1) {
    return { isValid: false, error: 'Chỉ được có đúng 1 Vua Trắng' }
  }
  if (blackKings === 0) {
    return { isValid: false, error: 'Thiếu Vua Đen trên bàn cờ' }
  }
  if (blackKings > 1) {
    return { isValid: false, error: 'Chỉ được có đúng 1 Vua Đen' }
  }
  if (invalidPawns > 0) {
    return { isValid: false, error: 'Quân Tốt không thể nằm ở hàng 1 hoặc hàng 8' }
  }

  return { isValid: true, error: null }
}

export interface BoardSetupSurfaceProps {
  initialFen?: string
  initialPlayerSide?: 'white' | 'black'
  onChange: (fen: string, playerSide: 'white' | 'black', isValid: boolean) => void
}

export default function BoardSetupSurface({
  initialFen = STANDARD_FEN,
  initialPlayerSide = 'white',
  onChange,
}: BoardSetupSurfaceProps) {
  const [boardMap, setBoardMap] = useState<Map<string, PieceItem>>(() =>
    parseFenToBoard(initialFen)
  )
  const [playerSide, setPlayerSide] = useState<'white' | 'black'>(initialPlayerSide)
  const [selectedPiece, setSelectedPiece] = useState<PieceItem | 'trash' | null>(null)
  const [draggedItem, setDraggedItem] = useState<{
    piece: PieceItem
    fromSquare?: string
  } | null>(null)

  // Sync validation and emit FEN safely without infinite render loops
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const fen = buildFenFromBoard(boardMap, playerSide)
    const { isValid } = validateBoardPieces(boardMap)
    onChangeRef.current(fen, playerSide, isValid)
  }, [boardMap, playerSide])

  const validation = validateBoardPieces(boardMap)

  // Palette piece selection / click
  function handleSelectPalettePiece(piece: PieceItem) {
    if (
      selectedPiece &&
      selectedPiece !== 'trash' &&
      selectedPiece.type === piece.type &&
      selectedPiece.side === piece.side
    ) {
      setSelectedPiece(null)
    } else {
      setSelectedPiece(piece)
    }
  }

  // Square interaction (click to place or delete)
  function handleSquareClick(square: string) {
    const nextMap = new Map(boardMap)
    if (selectedPiece === 'trash') {
      nextMap.delete(square)
    } else if (selectedPiece) {
      nextMap.set(square, { type: selectedPiece.type, side: selectedPiece.side })
    } else {
      // If no piece is currently selected, clicking an existing piece removes it
      if (nextMap.has(square)) {
        nextMap.delete(square)
      }
    }
    setBoardMap(nextMap)
  }

  // Drag and drop from palette or square
  function handleDragStartPalette(e: React.DragEvent, piece: PieceItem) {
    setDraggedItem({ piece })
    e.dataTransfer.setData('text/plain', JSON.stringify(piece))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleDragStartSquare(e: React.DragEvent, square: string, piece: PieceItem) {
    setDraggedItem({ piece, fromSquare: square })
    e.dataTransfer.setData('text/plain', JSON.stringify({ piece, fromSquare: square }))
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDropSquare(e: React.DragEvent, toSquare: string) {
    e.preventDefault()
    if (!draggedItem) return

    const nextMap = new Map(boardMap)
    if (draggedItem.fromSquare) {
      nextMap.delete(draggedItem.fromSquare)
    }
    nextMap.set(toSquare, draggedItem.piece)
    setBoardMap(nextMap)
    setDraggedItem(null)
  }

  function handleDropTrash(e: React.DragEvent) {
    e.preventDefault()
    if (draggedItem?.fromSquare) {
      const nextMap = new Map(boardMap)
      nextMap.delete(draggedItem.fromSquare)
      setBoardMap(nextMap)
    }
    setDraggedItem(null)
  }

  // Presets & Cleanups
  function handleClearBoard() {
    setBoardMap(new Map())
    setSelectedPiece(null)
  }

  function handleStandardBoard() {
    setBoardMap(parseFenToBoard(STANDARD_FEN))
    setPlayerSide('white')
  }

  function handleApplyPreset(preset: BoardPreset) {
    setBoardMap(parseFenToBoard(preset.fen))
    setPlayerSide(preset.side)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top Controls: Clear, Standard, Presets & Turn */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-(--r-md) bg-(--surface) border border-(--border)">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            data-testid="clear-board-btn"
            onClick={handleClearBoard}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Trash2 size={14} className="text-(--danger)" />
            <span>Bàn cờ trống</span>
          </button>

          <button
            type="button"
            data-testid="standard-board-btn"
            onClick={handleStandardBoard}
            className="btn btn-ghost btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={14} />
            <span>Bàn cờ chuẩn</span>
          </button>

          {/* Quick presets dropdown */}
          <div className="relative group inline-block">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Sparkles size={14} className="text-(--accent)" />
              <span>Thế cờ mẫu</span>
            </button>

            <div
              className="absolute left-0 top-full mt-1 hidden group-hover:flex flex-col bg-(--surface) border border-(--border) rounded-(--r-md) shadow-lg p-1.5 z-30 min-w-[240px]"
            >
              {COMMON_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  className="text-left px-3 py-2 text-xs rounded hover:bg-(--surface-2) transition-colors text-(--ink-1)"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Turn Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--ink-3)">Lượt đi:</span>
          <div className="inline-flex rounded-(--r-sm) border border-(--border) p-0.5 bg-(--surface-2)">
            <button
              type="button"
              onClick={() => setPlayerSide('white')}
              className="px-2.5 py-1 text-xs font-semibold rounded-(--r-sm) transition-all"
              style={{
                background: playerSide === 'white' ? 'var(--ink-1)' : 'transparent',
                color: playerSide === 'white' ? 'var(--on-ink-1)' : 'var(--ink-2)',
              }}
            >
              ⚪ Trắng đi
            </button>
            <button
              type="button"
              onClick={() => setPlayerSide('black')}
              className="px-2.5 py-1 text-xs font-semibold rounded-(--r-sm) transition-all"
              style={{
                background: playerSide === 'black' ? 'var(--ink-1)' : 'transparent',
                color: playerSide === 'black' ? 'var(--on-ink-1)' : 'var(--ink-2)',
              }}
            >
              ⚫ Đen đi
            </button>
          </div>
        </div>
      </div>

      {/* Main Board & Palette Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        {/* Left / Center: 8x8 Board */}
        <div className="md:col-span-7 flex flex-col items-center">
          <div
            className="rounded-(--r-md) overflow-hidden shadow-md select-none"
            style={{
              width: 336,
              height: 336,
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 42px)',
              gridTemplateRows: 'repeat(8, 42px)',
              border: '2px solid var(--border-strong)',
            }}
          >
            {RANKS.map((rank, rIdx) =>
              FILES.map((file, fIdx) => {
                const sq = `${file}${rank}`
                const isLight = (rIdx + fIdx) % 2 === 0
                const piece = boardMap.get(sq)

                return (
                  <div
                    key={sq}
                    data-testid={`board-square-${sq}`}
                    onClick={() => handleSquareClick(sq)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDropSquare(e, sq)}
                    style={{
                      width: 42,
                      height: 42,
                      background: isLight ? 'var(--amber-2, #f3edd7)' : 'var(--amber-9, #b86e28)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {piece && (
                      <div
                        draggable
                        onDragStart={e => handleDragStartSquare(e, sq, piece)}
                        style={{ cursor: 'grab' }}
                      >
                        <CgPieceIcon type={piece.type} side={piece.side} size={38} />
                      </div>
                    )}
                    {/* Rank & file coordinate labels */}
                    {fIdx === 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: 3,
                          fontSize: 9,
                          fontWeight: 700,
                          color: isLight ? 'var(--amber-9, #b86e28)' : 'var(--amber-2, #f3edd7)',
                          pointerEvents: 'none',
                        }}
                      >
                        {rank}
                      </span>
                    )}
                    {rIdx === 7 && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 1,
                          right: 3,
                          fontSize: 9,
                          fontWeight: 700,
                          color: isLight ? 'var(--amber-9, #b86e28)' : 'var(--amber-2, #f3edd7)',
                          pointerEvents: 'none',
                        }}
                      >
                        {file}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Validation Feedback Bar */}
          <div className="w-full max-w-[336px] mt-2.5">
            {validation.isValid ? (
              <div className="flex items-center gap-1.5 text-xs text-(--success) font-semibold">
                <CheckCircle2 size={14} />
                <span>Thế cờ hợp lệ ({boardMap.size} quân trên bàn cờ)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-(--warning) font-semibold">
                <AlertCircle size={14} />
                <span>{validation.error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Piece Palette (Trắng, Đen, Thùng rác) */}
        <div className="md:col-span-5 flex flex-col gap-3">
          <div
            className="card p-3 rounded-(--r-md) border border-(--border)"
            style={{ background: 'var(--surface)' }}
          >
            <div className="text-xs font-semibold text-(--ink-1) uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Khay quân cờ</span>
              <span className="text-[11px] text-(--ink-3) normal-case">Kéo thả hoặc click chọn</span>
            </div>

            {/* White pieces */}
            <div className="mb-3">
              <span className="text-xs text-(--ink-3) block mb-1">Quân Trắng (White):</span>
              <div className="flex gap-1.5 flex-wrap">
                {WHITE_PIECES.map(p => {
                  const isSelected =
                    selectedPiece && selectedPiece !== 'trash' && selectedPiece.type === p.type && selectedPiece.side === p.side
                  return (
                    <button
                      key={`w-${p.type}`}
                      type="button"
                      draggable
                      onDragStart={e => handleDragStartPalette(e, p)}
                      onClick={() => handleSelectPalettePiece(p)}
                      title={`Quân Trắng ${p.type.toUpperCase()}`}
                      className="w-10 h-10 rounded border flex items-center justify-center transition-all cursor-pointer"
                      style={{
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        background: isSelected ? 'var(--accent-soft)' : 'var(--surface-2)',
                      }}
                    >
                      <CgPieceIcon type={p.type} side={p.side} size={32} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Black pieces */}
            <div className="mb-3">
              <span className="text-xs text-(--ink-3) block mb-1">Quân Đen (Black):</span>
              <div className="flex gap-1.5 flex-wrap">
                {BLACK_PIECES.map(p => {
                  const isSelected =
                    selectedPiece && selectedPiece !== 'trash' && selectedPiece.type === p.type && selectedPiece.side === p.side
                  return (
                    <button
                      key={`b-${p.type}`}
                      type="button"
                      draggable
                      onDragStart={e => handleDragStartPalette(e, p)}
                      onClick={() => handleSelectPalettePiece(p)}
                      title={`Quân Đen ${p.type}`}
                      className="w-10 h-10 rounded border flex items-center justify-center transition-all cursor-pointer"
                      style={{
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        background: isSelected ? 'var(--accent-soft)' : 'var(--surface-2)',
                      }}
                    >
                      <CgPieceIcon type={p.type} side={p.side} size={32} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Trash tool & Tips */}
            <div className="pt-2 border-t border-(--border) flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelectedPiece(prev => (prev === 'trash' ? null : 'trash'))}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDropTrash}
                className="btn btn-ghost btn-sm text-xs flex items-center gap-1.5"
                style={{
                  color: selectedPiece === 'trash' ? 'var(--danger)' : 'var(--ink-2)',
                  borderColor: selectedPiece === 'trash' ? 'var(--danger)' : 'var(--border)',
                  background: selectedPiece === 'trash' ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                }}
              >
                <Trash2 size={14} />
                <span>Công cụ xóa quân</span>
              </button>

              <span className="text-[11px] text-(--ink-4)">
                Click vào quân trên bàn cờ để xóa
              </span>
            </div>
          </div>

          {/* Quick Guidance Box */}
          <div className="p-3 rounded-(--r-md) bg-(--surface-2) border border-(--border) text-xs text-(--ink-2) leading-relaxed">
            <span className="font-semibold text-(--ink-1) block mb-1">💡 Hướng dẫn xếp thế trận:</span>
            • Bấm <strong>"Bàn cờ trống"</strong> để bắt đầu với bàn cờ không có quân.<br />
            • Kéo thả hoặc click chọn quân từ khay đặt lên các ô mong muốn.<br />
            • Cần có ít nhất 1 Vua Trắng và 1 Vua Đen để thế cờ hợp lệ.
          </div>
        </div>
      </div>
    </div>
  )
}

