import { useTranslation } from 'react-i18next'

export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

export interface PromotionPickerProps {
  offered: PromotionPiece[]
  onPick: (piece: PromotionPiece) => void
  onDismiss: () => void
}

const PIECE_SYMBOL: Record<PromotionPiece, string> = {
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
}

const PIECE_NAME_KEY: Record<PromotionPiece, string> = {
  q: 'guidedPlayer.promotionPieceQueen',
  r: 'guidedPlayer.promotionPieceRook',
  b: 'guidedPlayer.promotionPieceBishop',
  n: 'guidedPlayer.promotionPieceKnight',
}

const ALL_PIECES: PromotionPiece[] = ['q', 'r', 'b', 'n']

export default function PromotionPicker({ offered, onPick, onDismiss }: PromotionPickerProps) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="promotion-picker"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(20,22,26,0.4)',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          minWidth: 260,
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
          {t('guidedPlayer.promotionPickerTitle')}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {ALL_PIECES.filter(p => offered.includes(p)).map(piece => (
            <button
              key={piece}
              type="button"
              data-testid={`promotion-piece-${piece}`}
              onClick={() => onPick(piece)}
              aria-label={t(PIECE_NAME_KEY[piece])}
              style={{
                flex: 1,
                height: 56,
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface)',
                fontSize: 28,
                cursor: 'pointer',
              }}
            >
              {PIECE_SYMBOL[piece]}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="promotion-dismiss"
          onClick={onDismiss}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            background: 'transparent',
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--ink-2)',
          }}
        >
          {t('guidedPlayer.promotionPickerDismiss')}
        </button>
      </div>
    </div>
  )
}
