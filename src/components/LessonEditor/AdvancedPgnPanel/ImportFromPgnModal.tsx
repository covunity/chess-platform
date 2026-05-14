/**
 * ImportFromPgnModal — PRD-0004 Slice 11 (issue #198)
 *
 * One-shot "Nhập từ PGN" modal available to ALL creators (no editor_advanced gate).
 * Opens from BoardAuthoringSurface and LessonEditor chess tab.
 *
 * On confirm with valid PGN: parse → replace treeStore.tree → close modal.
 * On parse error: show the error, no tree replacement.
 * On cancel: close, no changes.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parsePgn } from '../../../utils/parsePgn'
import type { TreeStore } from '../treeStore'

export interface ImportFromPgnModalProps {
  store: TreeStore
  onClose: () => void
}

export default function ImportFromPgnModal({ store, onClose }: ImportFromPgnModalProps) {
  const { t } = useTranslation()
  const [pgn, setPgn] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleAnalyse() {
    const trimmed = pgn.trim()
    if (!trimmed) {
      setError(t('creator.lessonEditor.pgnInvalid'))
      return
    }
    const result = parsePgn(trimmed)
    if (result.valid && result.root) {
      store.getState().replaceTree(result.root)
      onClose()
    } else {
      setError(t('creator.lessonEditor.pgnInvalid'))
    }
  }

  return (
    <div
      data-testid="import-pgn-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: 28,
          width: 520,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
          {t('creator.lessonEditor.importFromPgnModalTitle')}
        </h2>

        <textarea
          data-testid="import-pgn-textarea"
          value={pgn}
          onChange={(e) => { setPgn(e.target.value); setError(null) }}
          rows={10}
          style={{
            width: '100%',
            resize: 'vertical',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            padding: '8px',
            borderRadius: 'var(--r-sm)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            background: 'var(--surface)',
            color: 'var(--ink-1)',
            boxSizing: 'border-box',
          }}
          placeholder="1. e4 e5 2. Nf3 ..."
          aria-label={t('creator.lessonEditor.importFromPgnModalTitle')}
        />

        {error && (
          <p
            data-testid="import-pgn-error"
            style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="import-pgn-cancel-btn"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
          >
            {t('creator.lessonEditor.importFromPgnCancel')}
          </button>
          <button
            type="button"
            data-testid="import-pgn-analyse-btn"
            className="btn btn-primary btn-sm"
            onClick={handleAnalyse}
          >
            {t('creator.lessonEditor.importFromPgnAnalyse')}
          </button>
        </div>
      </div>
    </div>
  )
}
