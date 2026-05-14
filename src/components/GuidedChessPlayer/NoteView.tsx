/**
 * NoteView — PRD-0004 Slice 7
 *
 * Pure read-only renderer for a RichTextDoc. Does NOT use TipTap — keeps
 * @tiptap/* out of the player bundle (the editor lazy-imports it instead).
 *
 * Supports: paragraph, bold, italic marks — matching the schema of
 * RichNoteEditor. Any other node types are silently ignored.
 */

import type { RichTextDoc } from '../../utils/parsePgn'

export interface NoteViewProps {
  note: RichTextDoc | null
  /** Optional className applied to the wrapper div. */
  className?: string
}

export default function NoteView({ note, className }: NoteViewProps) {
  if (!note) return null

  return (
    <div className={className} data-testid="note-view">
      {note.content.map((para, pIdx) => {
        const spans = para.content ?? []
        return (
          <p key={pIdx} style={{ margin: '0 0 6px' }}>
            {spans.map((span, sIdx) => {
              const isBold = span.marks?.some((m) => m.type === 'bold') ?? false
              const isItalic = span.marks?.some((m) => m.type === 'italic') ?? false

              let element: React.ReactNode = span.text

              if (isItalic) element = <em key={sIdx}>{element}</em>
              if (isBold) element = <strong key={sIdx}>{element}</strong>

              // If no marks, return plain text with a key
              if (!isBold && !isItalic) element = <span key={sIdx}>{span.text}</span>

              return element
            })}
          </p>
        )
      })}
    </div>
  )
}
