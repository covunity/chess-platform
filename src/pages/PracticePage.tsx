import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getBookmarks, deleteBookmark } from '../lib/bookmarkApi'
import type { BookmarkWithDetails } from '../lib/bookmarkApi'
import MiniBoard from '../components/MiniBoard'

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,4 13,4" />
      <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <rect x="4" y="4" width="8" height="10" rx="1" />
    </svg>
  )
}

function BookmarkFilledIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={color} stroke="none">
      <path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" />
    </svg>
  )
}

type SortOrder = 'newest' | 'oldest'

interface DeleteDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

function DeleteConfirmDialog({ onConfirm, onCancel }: DeleteDialogProps) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="delete-confirm-dialog"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
        zIndex: 200,
      }}
    >
      <div style={{
        background: 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        padding: 28,
        width: 360,
        boxShadow: 'var(--sh-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>
          {t('practice.deleteConfirmTitle', 'Remove this bookmark?')}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="delete-cancel-btn"
            onClick={onCancel}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink-2)',
            }}
          >
            {t('practice.cancel', 'Hủy')}
          </button>
          <button
            type="button"
            data-testid="delete-confirm-btn"
            onClick={onConfirm}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 'var(--r-md)',
              border: 'none',
              background: 'var(--danger)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
            }}
          >
            {t('practice.deleteConfirm', 'Xóa')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PracticePage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const [bookmarks, setBookmarks] = useState<BookmarkWithDetails[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    getBookmarks(supabase, user.id).then(({ bookmarks: bm }) => {
      setBookmarks(bm ?? [])
      setLoading(false)
    })
  }, [user])

  async function handleDelete() {
    if (!deletingId) return
    const { error } = await deleteBookmark(supabase, deletingId)
    if (!error) {
      setBookmarks(prev => (prev ?? []).filter(b => b.id !== deletingId))
    }
    setDeletingId(null)
  }

  const sorted = [...(bookmarks ?? [])].sort((a, b) => {
    const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    return sortOrder === 'newest' ? diff : -diff
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--ink-3)', fontSize: 14 }}>{t('practice.loading', 'Đang tải...')}</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 56px 64px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
            {t('practice.eyebrow', 'LUYỆN TẬP')}
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 38, fontWeight: 400, color: 'var(--ink-1)', margin: 0, letterSpacing: '-0.02em' }}>
            {t('practice.heading', 'Hàng đợi ôn tập của bạn.')}
          </h1>
        </div>
        {bookmarks && bookmarks.length > 0 && (
          <button
            type="button"
            data-testid="sort-toggle"
            onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
            style={{
              height: 36,
              padding: '0 14px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink-2)',
            }}
          >
            {sortOrder === 'newest'
              ? t('practice.sortNewest', 'Sắp xếp: Mới nhất')
              : t('practice.sortOldest', 'Sắp xếp: Cũ nhất')}
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div
          data-testid="practice-empty-state"
          style={{
            textAlign: 'center',
            padding: '80px 0',
            color: 'var(--ink-3)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>
            <BookmarkFilledIcon color="var(--border-strong)" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>
            {t('practice.emptyHeading', 'Chưa có bookmark nào')}
          </div>
          <div style={{ fontSize: 13.5, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
            {t('practice.emptyBody', 'Chưa có bookmark nào — lưu một vị trí từ bất kỳ bài cờ vua nào để bắt đầu hàng đợi ôn tập của bạn.')}
          </div>
        </div>
      ) : (
        <>
          {/* Hero card */}
          <div
            data-testid="practice-hero"
            style={{
              marginBottom: 32,
              background: 'linear-gradient(135deg, oklch(0.97 0.02 200) 0%, var(--surface) 100%)',
              borderRadius: 'var(--r-lg)',
              border: '1px solid var(--border)',
              padding: 24,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-ink)', marginBottom: 6 }}>
                  {t('practice.heroEyebrow', 'LUYỆN TẬP')}
                </div>
                <div
                  data-testid="practice-bookmark-count"
                  style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400, color: 'var(--ink-1)', letterSpacing: '-0.02em', marginBottom: 6 }}
                >
                  {t('practice.heroCount', '{{count}} vị trí đã bookmark', { count: bookmarks?.length ?? 0 })}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {t('practice.heroSub', 'Ôn lại các vị trí khó theo lịch của riêng bạn.')}
                </div>
              </div>
              <Link
                to={sorted[0] ? `/learn/${sorted[0].course_id}/${sorted[0].lesson_id}` : '/'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 44,
                  padding: '0 20px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--accent)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >
                {t('practice.startPractice', 'Bắt đầu luyện tập')}
              </Link>
            </div>

            {/* Mini board previews */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {sorted.slice(0, 4).map(bm => (
                <div key={bm.id} style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0 }}>
                  <MiniBoard fen={bm.pgn_snapshot} size={80} />
                </div>
              ))}
              {(bookmarks?.length ?? 0) > 4 && (
                <div style={{
                  width: 80,
                  height: 80,
                  borderRadius: 'var(--r-md)',
                  border: '1px dashed var(--border-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--ink-3)',
                  flexShrink: 0,
                }}>
                  +{(bookmarks?.length ?? 0) - 4} {t('practice.more', 'nữa')}
                </div>
              )}
            </div>
          </div>

          {/* Bookmark grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {sorted.map(bm => (
              <div
                key={bm.id}
                data-testid={`bookmark-card-${bm.id}`}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  overflow: 'hidden',
                }}
              >
                {/* Board area */}
                <Link
                  data-testid={`bookmark-link-${bm.id}`}
                  to={`/learn/${bm.course_id}/${bm.lesson_id}`}
                  style={{
                    aspectRatio: '1 / 1',
                    background: 'var(--surface-3)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MiniBoard fen={bm.pgn_snapshot} size={240} />
                </Link>

                {/* Card body */}
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                    {bm.lesson_title}
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {bm.course_title}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                      {new Date(bm.created_at).toLocaleDateString('vi-VN')}
                    </span>
                    <button
                      type="button"
                      data-testid={`delete-bookmark-${bm.id}`}
                      onClick={() => setDeletingId(bm.id)}
                      aria-label={t('practice.deleteAriaLabel', 'Xóa bookmark')}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: 'var(--r-sm)',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: 'var(--ink-3)',
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {deletingId && (
        <DeleteConfirmDialog
          onConfirm={handleDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}
