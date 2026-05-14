/**
 * RichNoteEditor — PRD-0004 Slice 7
 *
 * Thin TipTap wrapper for per-node rich-text annotation editing.
 * Schema: doc → paragraph → text (with bold + italic marks only).
 * Props: value, onChange, placeholder, disabled.
 *
 * This component is editor-only. The player uses NoteView (hand-written
 * read-only renderer) to keep @tiptap/* out of the player bundle.
 */

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useCallback, useRef } from 'react'
import type { RichTextDoc } from '../../utils/parsePgn'

export interface RichNoteEditorProps {
  value: RichTextDoc | null
  onChange: (doc: RichTextDoc) => void
  placeholder?: string
  disabled?: boolean
}

/** Convert our RichTextDoc JSON to TipTap-compatible JSON. They share the same shape. */
function toTipTapDoc(note: RichTextDoc | null): object | undefined {
  if (!note) return undefined
  return note
}

/** Convert TipTap editor JSON output to our RichTextDoc type. */
function fromTipTapDoc(json: Record<string, unknown>): RichTextDoc {
  // TipTap's JSON is ProseMirror-shaped — same as our RichTextDoc
  return json as unknown as RichTextDoc
}

export default function RichNoteEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
}: RichNoteEditorProps) {
  // Guard flag: skip onChange during programmatic content updates to avoid loops
  const isProgrammaticUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Only keep doc, paragraph, text, bold, italic — disable everything else
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        hardBreak: false,
        strike: false,
      }),
    ],
    content: value ? toTipTapDoc(value) : '',
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticUpdate.current) return
      const json = ed.getJSON() as Record<string, unknown>
      onChange(fromTipTapDoc(json))
    },
  })

  // Update editable state when disabled prop changes
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  // Update content when value changes externally (e.g., node switch)
  // We compare serialized to avoid infinite loops
  const handleValueChange = useCallback(() => {
    if (!editor) return
    const currentJson = JSON.stringify(editor.getJSON())
    const newJson = JSON.stringify(value ?? { type: 'doc', content: [{ type: 'paragraph' }] })
    if (currentJson !== newJson) {
      isProgrammaticUpdate.current = true
      editor.commands.setContent(value ?? '')
      isProgrammaticUpdate.current = false
    }
  }, [editor, value])

  useEffect(() => {
    handleValueChange()
  }, [handleValueChange])

  const toggleBold = () => editor?.chain().focus().toggleBold().run()
  const toggleItalic = () => editor?.chain().focus().toggleItalic().run()

  const isBoldActive = editor?.isActive('bold') ?? false
  const isItalicActive = editor?.isActive('italic') ?? false

  return (
    <div
      data-testid="rich-note-editor"
      aria-disabled={disabled ? 'true' : undefined}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        background: disabled ? 'var(--surface-2)' : 'var(--surface)',
        opacity: disabled ? 0.6 : 1,
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: '4px 6px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <button
          type="button"
          data-testid="rich-note-toolbar-bold"
          disabled={disabled}
          onClick={toggleBold}
          title="Bold"
          aria-label="Bold"
          aria-pressed={isBoldActive}
          style={{
            width: 26,
            height: 26,
            fontWeight: 700,
            fontSize: 13,
            border: '1px solid transparent',
            borderRadius: 'var(--r-sm)',
            cursor: disabled ? 'default' : 'pointer',
            background: isBoldActive ? 'var(--surface-3)' : 'transparent',
            color: 'var(--ink-1)',
          }}
        >
          B
        </button>
        <button
          type="button"
          data-testid="rich-note-toolbar-italic"
          disabled={disabled}
          onClick={toggleItalic}
          title="Italic"
          aria-label="Italic"
          aria-pressed={isItalicActive}
          style={{
            width: 26,
            height: 26,
            fontStyle: 'italic',
            fontSize: 13,
            border: '1px solid transparent',
            borderRadius: 'var(--r-sm)',
            cursor: disabled ? 'default' : 'pointer',
            background: isItalicActive ? 'var(--surface-3)' : 'transparent',
            color: 'var(--ink-1)',
          }}
        >
          I
        </button>
      </div>

      {/* Editor content area */}
      <div
        style={{ padding: '8px 10px', minHeight: 64, fontSize: 13 }}
        data-placeholder={placeholder}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
