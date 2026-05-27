/**
 * RichNoteEditor — PRD-0004 Slice 7
 *
 * TipTap wrapper for per-node rich-text annotation editing.
 * Schema: doc → paragraph | heading (H3/H4) | bulletList | orderedList
 * Props: value, onChange, placeholder, disabled.
 *
 * Editor-only. Player uses NoteView (no TipTap dep) to keep bundle light.
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

function fromTipTapDoc(json: Record<string, unknown>): RichTextDoc {
  return json as unknown as RichTextDoc
}

// ── Toolbar button styles ──────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid transparent',
  borderRadius: 'var(--r-sm)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--ink-2)',
  userSelect: 'none',
}

const btnActive: React.CSSProperties = {
  background: 'var(--accent-soft)',
  color: 'var(--accent-ink)',
  borderColor: 'var(--accent-border)',
}

const btnDisabled: React.CSSProperties = {
  cursor: 'default',
  opacity: 0.4,
}

function ToolbarBtn({
  active,
  disabled,
  onClick,
  title,
  testId,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  title: string
  testId: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        ...btnBase,
        ...(active ? btnActive : {}),
        ...(disabled ? btnDisabled : {}),
      }}
    >
      {children}
    </button>
  )
}

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 16,
        background: 'var(--border-strong)',
        margin: '0 2px',
        alignSelf: 'center',
      }}
    />
  )
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconBulletList() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="2" cy="3.5" r="1.2" fill="currentColor" />
      <rect x="5" y="2.8" width="8" height="1.4" rx="0.7" fill="currentColor" />
      <circle cx="2" cy="7" r="1.2" fill="currentColor" />
      <rect x="5" y="6.3" width="8" height="1.4" rx="0.7" fill="currentColor" />
      <circle cx="2" cy="10.5" r="1.2" fill="currentColor" />
      <rect x="5" y="9.8" width="8" height="1.4" rx="0.7" fill="currentColor" />
    </svg>
  )
}

function IconOrderedList() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <text x="0.5" y="5" fontSize="5" fontWeight="600" fill="currentColor" fontFamily="inherit">1.</text>
      <rect x="5" y="2.8" width="8" height="1.4" rx="0.7" fill="currentColor" />
      <text x="0.5" y="8.5" fontSize="5" fontWeight="600" fill="currentColor" fontFamily="inherit">2.</text>
      <rect x="5" y="6.3" width="8" height="1.4" rx="0.7" fill="currentColor" />
      <text x="0.5" y="12" fontSize="5" fontWeight="600" fill="currentColor" fontFamily="inherit">3.</text>
      <rect x="5" y="9.8" width="8" height="1.4" rx="0.7" fill="currentColor" />
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RichNoteEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
}: RichNoteEditorProps) {
  const isProgrammaticUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
        bulletList: {},
        orderedList: {},
        listItem: {},
        // Disabled — not needed in note context
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        hardBreak: false,
        strike: false,
      }),
    ],
    content: value ?? '',
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticUpdate.current) return
      onChange(fromTipTapDoc(ed.getJSON() as Record<string, unknown>))
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

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

  if (!editor) return null

  const isBoldActive = editor.isActive('bold')
  const isItalicActive = editor.isActive('italic')
  const isH3Active = editor.isActive('heading', { level: 3 })
  const isH4Active = editor.isActive('heading', { level: 4 })
  const isBulletActive = editor.isActive('bulletList')
  const isOrderedActive = editor.isActive('orderedList')

  const act = (fn: () => void) => () => { if (!disabled) fn() }

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
          alignItems: 'center',
          gap: 1,
          padding: '3px 5px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        {/* Inline formatting */}
        <ToolbarBtn
          active={isBoldActive}
          disabled={disabled}
          onClick={act(() => editor.chain().focus().toggleBold().run())}
          title="Bold"
          testId="rich-note-toolbar-bold"
        >
          <span style={{ fontWeight: 700, fontStyle: 'normal' }}>B</span>
        </ToolbarBtn>
        <ToolbarBtn
          active={isItalicActive}
          disabled={disabled}
          onClick={act(() => editor.chain().focus().toggleItalic().run())}
          title="Italic"
          testId="rich-note-toolbar-italic"
        >
          <span style={{ fontStyle: 'italic' }}>I</span>
        </ToolbarBtn>

        <Separator />

        {/* Block formatting */}
        <ToolbarBtn
          active={isH3Active}
          disabled={disabled}
          onClick={act(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
          title="Heading 3"
          testId="rich-note-toolbar-h3"
        >
          H3
        </ToolbarBtn>
        <ToolbarBtn
          active={isH4Active}
          disabled={disabled}
          onClick={act(() => editor.chain().focus().toggleHeading({ level: 4 }).run())}
          title="Heading 4"
          testId="rich-note-toolbar-h4"
        >
          H4
        </ToolbarBtn>

        <Separator />

        {/* Lists */}
        <ToolbarBtn
          active={isBulletActive}
          disabled={disabled}
          onClick={act(() => editor.chain().focus().toggleBulletList().run())}
          title="Bullet list"
          testId="rich-note-toolbar-bullet-list"
        >
          <IconBulletList />
        </ToolbarBtn>
        <ToolbarBtn
          active={isOrderedActive}
          disabled={disabled}
          onClick={act(() => editor.chain().focus().toggleOrderedList().run())}
          title="Ordered list"
          testId="rich-note-toolbar-ordered-list"
        >
          <IconOrderedList />
        </ToolbarBtn>
      </div>

      {/* Editor content */}
      <div
        style={{ padding: '8px 10px', minHeight: 64, fontSize: 13 }}
        data-placeholder={placeholder}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
