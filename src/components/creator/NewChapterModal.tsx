import React, { useState, useId } from 'react'
import { Upload, FileText, Globe, KeyRound, Sparkles, X } from 'lucide-react'
import { splitMultiGamePgn, type ParsedPgnGame } from '../../utils/pgnSplitter'

export type ChapterInputType = 'empty' | 'url' | 'fen' | 'pgn'
export type BoardPerspective = 'white' | 'black'

export interface NewChapterSubmitData {
  chapterTitle: string
  inputType: ChapterInputType
  rawText: string
  boardPerspective: BoardPerspective
  parsedGames: ParsedPgnGame[]
}

interface NewChapterModalProps {
  defaultChapterNumber: number
  onCancel: () => void
  onCreate: (data: NewChapterSubmitData) => Promise<void>
  t: (key: string, options?: any) => string
}

export default function NewChapterModal({
  defaultChapterNumber,
  onCancel,
  onCreate,
  t,
}: NewChapterModalProps) {
  const fileInputId = useId()
  const [chapterTitle, setChapterTitle] = useState('')
  const [inputType, setInputType] = useState<ChapterInputType>('empty')
  const [rawText, setRawText] = useState('')
  const [boardPerspective, setBoardPerspective] = useState<BoardPerspective>('white')
  const [fileName, setFileName] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Live PGN parse result for feedback badge
  const parsedGames = React.useMemo(() => {
    if (inputType === 'pgn' && rawText.trim()) {
      return splitMultiGamePgn(rawText)
    }
    return []
  }, [inputType, rawText])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) {
        setRawText(content)
      }
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const titleToUse = chapterTitle.trim() || `${t('creator.courseEdit.chapterPlaceholder')} ${defaultChapterNumber}`
    setIsSubmitting(true)
    try {
      await onCreate({
        chapterTitle: titleToUse,
        inputType,
        rawText,
        boardPerspective,
        parsedGames,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputTypesList: { type: ChapterInputType; labelKey: string; icon: React.ReactNode }[] = [
    { type: 'empty', labelKey: 'creator.courseEdit.newChapter.typeEmpty', icon: <Sparkles size={16} /> },
    { type: 'url',   labelKey: 'creator.courseEdit.newChapter.typeUrl',   icon: <Globe size={16} /> },
    { type: 'fen',   labelKey: 'creator.courseEdit.newChapter.typeFen',   icon: <KeyRound size={16} /> },
    { type: 'pgn',   labelKey: 'creator.courseEdit.newChapter.typePgn',   icon: <FileText size={16} /> },
  ]

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(15, 17, 21, 0.65)', backdropFilter: 'blur(4px)', zIndex: 70 }}
      role="dialog"
      aria-modal="true"
    >
      <div
        data-testid="new-chapter-modal"
        className="card w-full max-w-lg shadow-2xl rounded-2xl border overflow-hidden"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          padding: 24,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-(--border) mb-5">
          <h3 className="text-base font-semibold text-(--ink-1) flex items-center gap-2">
            <Sparkles size={18} style={{ color: 'var(--accent)' }} />
            {t('creator.courseEdit.newChapter.title')}
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm p-1 rounded-full text-(--ink-3) hover:text-(--ink-1)"
            onClick={onCancel}
            aria-label={t('creator.courseEdit.cancel')}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* 1. Chapter Title */}
          <div>
            <label className="block text-xs font-semibold text-(--ink-2) uppercase tracking-wider mb-1.5">
              {t('creator.courseEdit.newChapter.labelTitle')}
              <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>
            </label>
            <input
              type="text"
              data-testid="new-chapter-title-input"
              className="input w-full"
              placeholder={t('creator.courseEdit.newChapter.titlePlaceholder')}
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              autoFocus
            />
          </div>

          {/* 2. Input Type Selector (Trống / URL / FEN / PGN) */}
          <div>
            <label className="block text-xs font-semibold text-(--ink-2) uppercase tracking-wider mb-2">
              {t('creator.courseEdit.newChapter.inputTypeLabel')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {inputTypesList.map(({ type, labelKey, icon }) => (
                <button
                  key={type}
                  type="button"
                  data-testid={`input-type-${type}`}
                  onClick={() => setInputType(type)}
                  className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all"
                  style={{
                    borderColor: inputType === type ? 'var(--accent)' : 'var(--border)',
                    background: inputType === type ? 'var(--accent-soft)' : 'var(--surface-2)',
                    color: inputType === type ? 'var(--accent-ink)' : 'var(--ink-2)',
                  }}
                >
                  {icon}
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Manual Input Text & File Upload (when type !== 'empty') */}
          {inputType !== 'empty' && (
            <div className="flex flex-col gap-3 p-4 rounded-xl border border-(--border) bg-(--surface-2)">
              {/* Manual Input */}
              <div>
                <label className="block text-xs font-medium text-(--ink-2) mb-1.5">
                  {t('creator.courseEdit.newChapter.labelManualInput')}
                </label>
                {inputType === 'pgn' ? (
                  <textarea
                    data-testid="new-chapter-manual-input"
                    className="input w-full font-mono text-xs"
                    rows={5}
                    placeholder={t('creator.courseEdit.newChapter.placeholderPgn')}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    data-testid="new-chapter-manual-input"
                    className="input w-full font-mono text-xs"
                    placeholder={
                      inputType === 'url'
                        ? t('creator.courseEdit.newChapter.placeholderUrl')
                        : t('creator.courseEdit.newChapter.placeholderFen')
                    }
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                  />
                )}
              </div>

              {/* File Upload Button */}
              <div>
                <label className="block text-xs font-medium text-(--ink-2) mb-1.5">
                  {t('creator.courseEdit.newChapter.labelFileInput')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id={fileInputId}
                    type="file"
                    data-testid="new-chapter-file-input"
                    accept={
                      inputType === 'pgn'
                        ? '.pgn,.txt'
                        : inputType === 'fen'
                        ? '.fen,.txt'
                        : '.txt'
                    }
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor={fileInputId}
                    className="btn btn-ghost btn-sm flex items-center gap-2 border border-(--border-strong) cursor-pointer"
                    style={{ background: 'var(--surface)', fontSize: 12 }}
                  >
                    <Upload size={14} />
                    {fileName ? fileName : t('creator.courseEdit.newChapter.fileUploadHint')}
                  </label>
                  {fileName && (
                    <button
                      type="button"
                      className="text-xs text-(--ink-3) hover:text-(--danger)"
                      onClick={() => { setFileName(null); setRawText(''); }}
                    >
                      {t('creator.courseEdit.cancel')}
                    </button>
                  )}
                </div>
              </div>

              {/* Live Parsing Feedback Summary for PGN */}
              {inputType === 'pgn' && parsedGames.length > 0 && (
                <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg bg-(--accent-soft) text-(--accent-ink) text-xs font-medium border border-(--accent-border)">
                  <Sparkles size={14} />
                  <span>{t('creator.courseEdit.newChapter.parsedSummary', { count: parsedGames.length })}</span>
                </div>
              )}
            </div>
          )}

          {/* 4. Board Perspective Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-(--ink-2) uppercase tracking-wider mb-1.5">
              {t('creator.courseEdit.newChapter.labelPerspective')}
            </label>
            <select
              data-testid="new-chapter-perspective-select"
              className="input w-full"
              value={boardPerspective}
              onChange={(e) => setBoardPerspective(e.target.value as BoardPerspective)}
            >
              <option value="white">{t('creator.courseEdit.newChapter.perspectiveWhite')}</option>
              <option value="black">{t('creator.courseEdit.newChapter.perspectiveBlack')}</option>
            </select>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-(--border) mt-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {t('creator.courseEdit.cancel')}
            </button>
            <button
              type="submit"
              data-testid="new-chapter-submit-btn"
              className="btn btn-primary btn-sm"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? t('creator.courseEdit.newChapter.creatingBtn')
                : t('creator.courseEdit.newChapter.createBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
