/**
 * BoardEditor — PRD-0004 Slice 6
 *
 * Modal/panel for setting a custom starting position for a chess or puzzle lesson.
 * Two tabs:
 *   Tab 1 — "Dán FEN": paste a FEN string; validates with chess.js.
 *   Tab 2 — "Chỉnh bàn cờ": click-to-place piece editor with 12-piece palette.
 *
 * On "Áp dụng": writes the resulting FEN to treeStore.setStartingFen() and resets
 * the tree to a new root at that FEN. "Hủy" discards changes and calls onClose.
 */

import React, { useState } from 'react'
import { Chess } from 'chess.js'
import { useTranslation } from 'react-i18next'
import type { TreeStore } from '../treeStore'

// ── Constants ─────────────────────────────────────────────────────────────────

const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** All 12 pieces: 6 white + 6 black */
const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'] as const
type PieceType = typeof PIECE_TYPES[number]
type Side = 'w' | 'b'

interface PieceDefinition {
  type: PieceType
  side: Side
}

const PIECES: PieceDefinition[] = [
  { type: 'p', side: 'w' },
  { type: 'n', side: 'w' },
  { type: 'b', side: 'w' },
  { type: 'r', side: 'w' },
  { type: 'q', side: 'w' },
  { type: 'k', side: 'w' },
  { type: 'p', side: 'b' },
  { type: 'n', side: 'b' },
  { type: 'b', side: 'b' },
  { type: 'r', side: 'b' },
  { type: 'q', side: 'b' },
  { type: 'k', side: 'b' },
]

const PIECE_CLASS: Record<PieceType, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}
const SIDE_CLASS: Record<Side, string> = { w: 'white', b: 'black' }

/** Renders a piece using the same Chessground Cburnett SVG images as the main board. */
function CgPieceIcon({ type, side, size }: { type: PieceType; side: Side; size: number }) {
  return (
    <div className="cg-wrap" style={{ position: 'relative', width: size, height: size, pointerEvents: 'none' }}>
      {React.createElement('piece', {
        className: `${PIECE_CLASS[type]} ${SIDE_CLASS[side]}`,
        style: { position: 'absolute', width: '100%', height: '100%', top: 0, left: 0 },
      })}
    </div>
  )
}

// ── FEN validation ────────────────────────────────────────────────────────────

/**
 * Attempt to validate a FEN string with chess.js.
 * Returns null if valid, or an error string if invalid.
 */
function validateFen(fen: string): string | null {
  if (!fen.trim()) return 'FEN trống'
  try {
    const chess = new Chess(fen)
    // chess.js constructor succeeds if FEN is syntactically valid.
    // Additional semantic checks:
    const board = chess.board()
    // Count kings
    let whiteKings = 0
    let blackKings = 0
    for (const row of board) {
      for (const sq of row) {
        if (sq && sq.type === 'k' && sq.color === 'w') whiteKings++
        if (sq && sq.type === 'k' && sq.color === 'b') blackKings++
      }
    }
    if (whiteKings !== 1) return 'Phải có đúng một vua trắng'
    if (blackKings !== 1) return 'Phải có đúng một vua đen'
    // Check pawns not on rank 1 or 8
    for (const row of board) {
      for (const sq of row) {
        if (sq && sq.type === 'p') {
          const rankChar = sq.square[1]
          if (rankChar === '1' || rankChar === '8') {
            return 'Không thể có tốt trên hàng 1 hoặc hàng 8'
          }
        }
      }
    }
    return null
  } catch {
    return 'FEN không hợp lệ'
  }
}

// ── Piece editor helpers ──────────────────────────────────────────────────────

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] // top-to-bottom display

/** Build a FEN string from a board state map (square → piece). */
function buildFenFromBoard(
  board: Map<string, { type: PieceType; side: Side }>,
  sideToMove: Side,
  castling: string,
  enPassant: string,
  halfMove: number,
  fullMove: number
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
        if (empty > 0) { row += empty; empty = 0 }
        const ch = piece.side === 'w' ? piece.type.toUpperCase() : piece.type
        row += ch
      }
    }
    if (empty > 0) row += empty
    rows.push(row)
  }
  return `${rows.join('/')} ${sideToMove} ${castling || '-'} ${enPassant || '-'} ${halfMove} ${fullMove}`
}

/** Parse a FEN string into a board map. */
function parseFenToBoard(fen: string): Map<string, { type: PieceType; side: Side }> {
  const board = new Map<string, { type: PieceType; side: Side }>()
  try {
    const chess = new Chess(fen)
    const cgBoard = chess.board()
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = cgBoard[r][f]
        if (sq) {
          board.set(sq.square, { type: sq.type as PieceType, side: sq.color as Side })
        }
      }
    }
  } catch {
    // Invalid FEN — return empty board
  }
  return board
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface BoardEditorProps {
  store: TreeStore
  onClose: () => void
}

type ActiveTab = 'fen' | 'editor'

export default function BoardEditor({ store, onClose }: BoardEditorProps) {
  const { t } = useTranslation()

  // Initial FEN from the store's current root
  const initialFen = store.getState().tree.fen || STANDARD_FEN

  const [activeTab, setActiveTab] = useState<ActiveTab>('fen')
  const [fenInput, setFenInput] = useState(initialFen)
  const [fenError, setFenError] = useState<string | null>(null)

  // ── Piece editor state ───────────────────────────────────────────────────
  const [pieceBoard, setPieceBoard] = useState<Map<string, { type: PieceType; side: Side }>>(() =>
    parseFenToBoard(initialFen)
  )
  const [selectedPiece, setSelectedPiece] = useState<PieceDefinition | null>(null)
  const [sideToMove, setSideToMove] = useState<Side>(() => {
    const parts = initialFen.split(' ')
    return (parts[1] as Side) ?? 'w'
  })
  const [castling, setCastling] = useState<string>(() => {
    const parts = initialFen.split(' ')
    return parts[2] ?? 'KQkq'
  })
  const [enPassant, setEnPassant] = useState<string>(() => {
    const parts = initialFen.split(' ')
    return parts[3] ?? '-'
  })

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleFenChange = (value: string) => {
    setFenInput(value)
    if (fenError) setFenError(null)
  }

  const handleApply = () => {
    let fenToApply: string

    if (activeTab === 'fen') {
      const error = validateFen(fenInput.trim())
      if (error) {
        setFenError(error)
        return
      }
      // Normalise FEN through chess.js
      try {
        const chess = new Chess(fenInput.trim())
        fenToApply = chess.fen()
      } catch {
        setFenError('FEN không hợp lệ')
        return
      }
    } else {
      // Build FEN from piece editor board
      fenToApply = buildFenFromBoard(pieceBoard, sideToMove, castling, enPassant, 0, 1)
      const error = validateFen(fenToApply)
      if (error) {
        setFenError(error)
        return
      }
    }

    store.getState().setStartingFen(fenToApply)
    onClose()
  }

  const handleCancel = () => {
    onClose()
  }

  const handleReset = () => {
    setFenInput(STANDARD_FEN)
    setPieceBoard(parseFenToBoard(STANDARD_FEN))
    setSideToMove('w')
    setCastling('KQkq')
    setEnPassant('-')
    setFenError(null)
  }

  const handleClearAll = () => {
    setPieceBoard(new Map())
  }

  const handleSquareClick = (square: string) => {
    if (!selectedPiece) {
      // Remove piece if no piece is selected
      const newBoard = new Map(pieceBoard)
      newBoard.delete(square)
      setPieceBoard(newBoard)
    } else {
      // Place selected piece
      const newBoard = new Map(pieceBoard)
      newBoard.set(square, { type: selectedPiece.type, side: selectedPiece.side })
      setPieceBoard(newBoard)
    }
  }

  // ── Piece editor board render ─────────────────────────────────────────────

  const renderPieceEditorBoard = () => {
    const squares: React.ReactNode[] = []
    for (const rank of RANKS) {
      for (const file of FILES) {
        const square = `${file}${rank}`
        const piece = pieceBoard.get(square)
        const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0
        squares.push(
          <button
            key={square}
            type="button"
            data-testid={`board-editor-square-${square}`}
            onClick={() => handleSquareClick(square)}
            style={{
              width: 40,
              height: 40,
              background: isLight ? 'var(--amber-2, #f7f0d8)' : 'var(--amber-9, #b45309)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {piece && <CgPieceIcon type={piece.type} side={piece.side} size={36} />}
          </button>
        )
      }
    }
    return squares
  }

  return (
    <div
      data-testid="board-editor"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
      }}
    >
      {/* Heading */}
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-1)' }}>
        {t('creator.lessonEditor.startingPositionLabel', { defaultValue: 'Vị trí bắt đầu' })}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          data-testid="board-editor-tab-fen"
          onClick={() => setActiveTab('fen')}
          style={{
            padding: '5px 12px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: activeTab === 'fen' ? 'var(--ink-1)' : 'var(--surface)',
            color: activeTab === 'fen' ? 'var(--on-ink-1)' : 'var(--ink-2)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {t('creator.lessonEditor.startingPositionFromFen', { defaultValue: 'Dán FEN' })}
        </button>
        <button
          type="button"
          data-testid="board-editor-tab-editor"
          onClick={() => setActiveTab('editor')}
          style={{
            padding: '5px 12px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: activeTab === 'editor' ? 'var(--ink-1)' : 'var(--surface)',
            color: activeTab === 'editor' ? 'var(--on-ink-1)' : 'var(--ink-2)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {t('creator.lessonEditor.startingPositionFromEditor', { defaultValue: 'Chỉnh bàn cờ' })}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'fen' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            data-testid="board-editor-fen-input"
            value={fenInput}
            onChange={(e) => handleFenChange(e.target.value)}
            rows={2}
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              padding: '6px 8px',
              border: `1px solid ${fenError ? 'var(--red-9, #dc2626)' : 'var(--border)'}`,
              borderRadius: 'var(--r-sm)',
              resize: 'vertical',
              background: 'var(--surface)',
              color: 'var(--ink-1)',
            }}
          />
          {fenError && (
            <span
              data-testid="board-editor-fen-error"
              style={{ fontSize: 12, color: 'var(--red-9, #dc2626)' }}
            >
              {fenError}
            </span>
          )}
          <button
            type="button"
            data-testid="board-editor-reset"
            onClick={handleReset}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 10px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
            }}
          >
            Vị trí ban đầu
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Piece palette */}
          <div
            data-testid="board-editor-piece-palette"
            style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 0' }}
          >
            {PIECES.map((p, i) => (
              <button
                key={i}
                type="button"
                data-piece={`${p.side}${p.type}`}
                onClick={() => setSelectedPiece(selectedPiece?.type === p.type && selectedPiece?.side === p.side ? null : p)}
                style={{
                  width: 36,
                  height: 36,
                  border: `2px solid ${selectedPiece?.type === p.type && selectedPiece?.side === p.side ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--r-sm)',
                  background: selectedPiece?.type === p.type && selectedPiece?.side === p.side ? 'var(--surface-3)' : 'var(--surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <CgPieceIcon type={p.type} side={p.side} size={28} />
              </button>
            ))}
          </div>

          {/* Clear all button */}
          <button
            type="button"
            data-testid="board-editor-clear-all"
            onClick={handleClearAll}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 10px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
            }}
          >
            Xóa tất cả
          </button>

          {/* Board grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 40px)', gap: 0 }}>
            {renderPieceEditorBoard()}
          </div>

          {/* Side to move toggle */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--ink-2)' }}>Lượt đi:</span>
            <button
              type="button"
              data-testid="board-editor-side-white"
              onClick={() => setSideToMove('w')}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                border: `1px solid var(--border)`,
                borderRadius: 'var(--r-sm)',
                background: sideToMove === 'w' ? 'var(--ink-1)' : 'var(--surface)',
                color: sideToMove === 'w' ? 'var(--on-ink-1)' : 'var(--ink-2)',
                cursor: 'pointer',
              }}
            >
              Trắng
            </button>
            <button
              type="button"
              data-testid="board-editor-side-black"
              onClick={() => setSideToMove('b')}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                border: `1px solid var(--border)`,
                borderRadius: 'var(--r-sm)',
                background: sideToMove === 'b' ? 'var(--ink-1)' : 'var(--surface)',
                color: sideToMove === 'b' ? 'var(--on-ink-1)' : 'var(--ink-2)',
                cursor: 'pointer',
              }}
            >
              Đen
            </button>
          </div>

          {/* Castling rights */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--ink-2)' }}>Nhập thành:</span>
            {(['K', 'Q', 'k', 'q'] as const).map((right) => (
              <label key={right} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  type="checkbox"
                  data-testid={`board-editor-castling-${right}`}
                  checked={castling.includes(right)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setCastling((prev) => {
                        const newRights = 'KQkq'.split('').filter((r) => prev.includes(r) || r === right).join('')
                        return newRights || '-'
                      })
                    } else {
                      setCastling((prev) => {
                        const newRights = prev.replace(right, '')
                        return newRights || '-'
                      })
                    }
                  }}
                />
                <span>{right}</span>
              </label>
            ))}
          </div>

          {/* En passant target */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--ink-2)' }}>En passant:</span>
            <input
              type="text"
              data-testid="board-editor-en-passant"
              value={enPassant}
              maxLength={2}
              onChange={(e) => setEnPassant(e.target.value || '-')}
              style={{
                width: 40,
                padding: '2px 6px',
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface)',
                color: 'var(--ink-1)',
              }}
            />
          </div>

          {fenError && (
            <span
              data-testid="board-editor-fen-error"
              style={{ fontSize: 12, color: 'var(--red-9, #dc2626)' }}
            >
              {fenError}
            </span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          data-testid="board-editor-apply"
          onClick={handleApply}
          style={{
            padding: '7px 16px',
            fontSize: 13,
            fontWeight: 500,
            border: 'none',
            borderRadius: 'var(--r-sm)',
            background: 'var(--ink-1)',
            color: 'var(--on-ink-1)',
            cursor: 'pointer',
          }}
        >
          {t('creator.lessonEditor.startingPositionApply', { defaultValue: 'Áp dụng' })}
        </button>
        <button
          type="button"
          data-testid="board-editor-cancel"
          onClick={handleCancel}
          style={{
            padding: '7px 16px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--surface)',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          {t('creator.lessonEditor.cancel', { defaultValue: 'Hủy' })}
        </button>
      </div>
    </div>
  )
}
