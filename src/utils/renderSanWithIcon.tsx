import type { ReactNode } from 'react'
import { formatSanForDisplay } from './parsePgn'

/**
 * Renders a SAN move string with an enlarged, bold, high-contrast chess piece icon
 * optimized for both light and dark backgrounds.
 *
 * Examples:
 * - "Nc3" / "Mc3" -> ♘c3 (with enlarged 1.28em bold icon ♘)
 * - "Bg7" / "Tg7" -> ♗g7 (with enlarged 1.28em bold icon ♗)
 * - "e4" / "c5" -> e4 / c5 (pawns unchanged, no icon prefix)
 */
export function renderSanWithIcon(san: string | null | undefined): ReactNode {
  if (!san) return san
  const formatted = formatSanForDisplay(san)
  if (!formatted) return formatted
  const first = formatted[0]
  if (['♘', '♗', '♖', '♕', '♔', '♞', '♝', '♜', '♛', '♚'].includes(first)) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <span
          className="chess-piece-glyph"
          style={{
            fontSize: '1.28em',
            fontWeight: 800,
            lineHeight: 1,
            marginRight: 2,
            display: 'inline-block',
            verticalAlign: 'middle',
            color: 'var(--ink-1)',
            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
          }}
        >
          {first}
        </span>
        <span>{formatted.slice(1)}</span>
      </span>
    )
  }
  return formatted
}
