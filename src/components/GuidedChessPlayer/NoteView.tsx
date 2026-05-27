/**
 * NoteView — PRD-0004 Slice 7
 *
 * Pure read-only renderer for a RichTextDoc. Does NOT use TipTap — keeps
 * @tiptap/* out of the player bundle (the editor lazy-imports it instead).
 *
 * Supports: paragraph, heading (H3/H4), bulletList, orderedList, bold, italic.
 * Any other node types are silently ignored.
 */

import type { RichTextDoc, RichTextSpan } from '../../utils/parsePgn'

export interface NoteViewProps {
  note: RichTextDoc | null
  /** Optional className applied to the wrapper div. */
  className?: string
}

function renderSpans(spans: RichTextSpan[] | undefined, keyPrefix: string) {
  return (spans ?? []).map((span, i) => {
    const isBold = span.marks?.some((m) => m.type === 'bold') ?? false
    const isItalic = span.marks?.some((m) => m.type === 'italic') ?? false
    const key = `${keyPrefix}-${i}`

    let el: React.ReactNode = span.text
    if (isItalic) el = <em key={key}>{el}</em>
    if (isBold) el = <strong key={key}>{el}</strong>
    if (!isBold && !isItalic) el = <span key={key}>{span.text}</span>
    return el
  })
}

export default function NoteView({ note, className }: NoteViewProps) {
  if (!note) return null

  return (
    <div className={className} data-testid="note-view">
      {note.content.map((block, bIdx) => {
        if (block.type === 'paragraph') {
          return (
            <p key={bIdx} style={{ margin: '0 0 6px' }}>
              {renderSpans(block.content, `b${bIdx}`)}
            </p>
          )
        }

        if (block.type === 'heading') {
          const Tag = block.attrs.level === 3 ? 'h3' : 'h4'
          return (
            <Tag key={bIdx} style={{ margin: '0 0 4px', fontWeight: 600 }}>
              {renderSpans(block.content, `b${bIdx}`)}
            </Tag>
          )
        }

        if (block.type === 'bulletList') {
          return (
            <ul key={bIdx} style={{ margin: '0 0 6px', paddingLeft: 20 }}>
              {(block.content ?? []).map((item, iIdx) =>
                (item.content ?? []).map((para, pIdx) => (
                  <li key={`${bIdx}-${iIdx}-${pIdx}`}>
                    {renderSpans(para.content, `b${bIdx}i${iIdx}p${pIdx}`)}
                  </li>
                ))
              )}
            </ul>
          )
        }

        if (block.type === 'orderedList') {
          return (
            <ol key={bIdx} style={{ margin: '0 0 6px', paddingLeft: 20 }} start={block.attrs?.start}>
              {(block.content ?? []).map((item, iIdx) =>
                (item.content ?? []).map((para, pIdx) => (
                  <li key={`${bIdx}-${iIdx}-${pIdx}`}>
                    {renderSpans(para.content, `b${bIdx}i${iIdx}p${pIdx}`)}
                  </li>
                ))
              )}
            </ol>
          )
        }

        return null
      })}
    </div>
  )
}
