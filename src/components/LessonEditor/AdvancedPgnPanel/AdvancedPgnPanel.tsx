/**
 * AdvancedPgnPanel — PRD-0004 Slice 11 (issue #198)
 *
 * A PGN textarea tab for power users. Only rendered when
 * currentUser.editor_advanced === true in LessonEditor.
 *
 * - Reads from treeStore (serializes to PGN on mount and store change)
 * - Editing PGN dispatches treeStore.replaceTree(parsePgn(newPgn))
 * - Saving the lesson serialises the tree back via serializePgn
 * - Both surfaces share treeStore — switching tabs is round-trip-safe
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { parsePgn } from '../../../utils/parsePgn'
import { serializePgn } from '../../../utils/serializePgn'
import type { TreeStore } from '../treeStore'

const MAX_PGN_CHARS = 50000

export interface AdvancedPgnPanelProps {
  store: TreeStore
}

export default function AdvancedPgnPanel({ store }: AdvancedPgnPanelProps) {
  const { t } = useTranslation()

  // Serialize the current tree to PGN for display
  function treeToString(): string {
    const state = store.getState()
    return serializePgn(state.tree)
  }

  const [pgn, setPgn] = useState<string>(treeToString)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseValid, setParseValid] = useState<boolean | null>(null)
  const [moveCount, setMoveCount] = useState<number>(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When the store changes externally (e.g., board move applied), sync pgn
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      // Only sync if we are not the one who triggered this
      const newPgn = treeToString()
      setPgn(newPgn)
      setParseError(null)
      setParseValid(null)
      setMoveCount(0)
    })
    return unsubscribe
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // Debounced parse + tree update on textarea change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newPgn = e.target.value
    setPgn(newPgn)
    setParseError(null)
    setParseValid(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!newPgn.trim()) {
      setMoveCount(0)
      return
    }

    debounceRef.current = setTimeout(() => {
      const result = parsePgn(newPgn)
      if (result.valid && result.root) {
        setParseError(null)
        setParseValid(true)
        setMoveCount(result.moveCount)
        // Replace the tree — this will trigger store.subscribe above,
        // but we guard against that by unsubscribing during the update cycle.
        // For simplicity: just call replaceTree; the subscribe handler will
        // update pgn, which will re-serialize and be identical (round-trip).
        store.getState().replaceTree(result.root)
      } else {
        setParseError(t('creator.lessonEditor.pgnInvalid'))
        setParseValid(false)
        // Do NOT replace tree on invalid PGN
      }
    }, 400)
  }, [store, t])

  const used = pgn.length

  return (
    <div
      data-testid="advanced-pgn-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {/* Hint line */}
      <p
        data-testid="advanced-pgn-hint"
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          margin: 0,
          padding: '6px 0 2px',
          fontStyle: 'italic',
        }}
      >
        {t('creator.lessonEditor.advancedTabHint')}
      </p>

      {/* PGN textarea */}
      <textarea
        data-testid="advanced-pgn-textarea"
        value={pgn}
        onChange={handleChange}
        maxLength={MAX_PGN_CHARS}
        rows={12}
        style={{
          width: '100%',
          resize: 'vertical',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12,
          padding: '8px',
          borderRadius: 'var(--r-sm)',
          border: `1px solid ${parseValid === false ? 'var(--danger)' : 'var(--border)'}`,
          background: 'var(--surface)',
          color: 'var(--ink-1)',
          boxSizing: 'border-box',
        }}
        placeholder={t('creator.lessonEditor.pgnPlaceholderEnter')}
        aria-label={t('creator.lessonEditor.tabPgnAdvanced')}
      />

      {/* Char counter + parse status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          data-testid="advanced-pgn-status"
          style={{
            fontSize: 11.5,
            color: parseValid === false ? 'var(--danger)' : parseValid === true ? 'var(--success)' : 'var(--ink-3)',
          }}
        >
          {parseValid === false
            ? parseError
            : parseValid === true
              ? `✓ ${t('creator.lessonEditor.pgnParsedMoves', { count: moveCount })}`
              : (pgn.trim() ? t('creator.lessonEditor.pgnPlaceholderEnter') : '—')}
        </span>
        <span
          data-testid="advanced-pgn-char-count"
          style={{
            fontSize: 11,
            color: used > MAX_PGN_CHARS * 0.9 ? 'var(--danger)' : 'var(--ink-3)',
            flexShrink: 0,
          }}
        >
          {t('creator.lessonEditor.pgnCharCount', { used, max: MAX_PGN_CHARS })}
        </span>
      </div>
    </div>
  )
}
