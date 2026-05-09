import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { PublicCourse } from '../lib/coursesApi'
import ChessBoard from './ChessBoard/ChessBoard'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function Badge({ label, color, testId }: { label: string; color: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '2px 8px',
        borderRadius: 'var(--r-sm)',
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: '#fff',
        background: color,
        zIndex: 1,
      }}
    >
      {label}
    </span>
  )
}

export default function CourseCard({ course }: { course: PublicCourse }) {
  const { t } = useTranslation()

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const isNew = new Date(course.created_at) > thirtyDaysAgo

  type BadgeKind = 'free' | 'bestseller' | 'new' | null
  const badgeKind: BadgeKind = course.price === 0
    ? 'free'
    : course.enrollment_count > 100
      ? 'bestseller'
      : isNew
        ? 'new'
        : null

  const badgeLabel = badgeKind === 'free'
    ? t('home.badgeFree')
    : badgeKind === 'bestseller'
      ? t('home.badgeBestseller')
      : badgeKind === 'new'
        ? t('home.badgeNew')
        : null

  const badgeColor = badgeKind === 'free'
    ? 'var(--success)'
    : badgeKind === 'new'
      ? 'var(--accent)'
      : 'oklch(0.62 0.16 30)'

  const levelLabel = {
    beginner: t('home.levelBadgeBeginner'),
    intermediate: t('home.levelBadgeIntermediate'),
    advanced: t('home.levelBadgeAdvanced'),
  }[course.level] ?? course.level

  const priceDisplay = course.price === 0
    ? t('home.free')
    : `${(course.price / 1000).toFixed(0)}k ₫`

  const firstTag = course.tags[0]

  return (
    <Link
      to={`/courses/${course.id}`}
      style={{ textDecoration: 'none', display: 'block' }}
    >
    <article
      className="card"
      style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', aspectRatio: '16/10', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {badgeLabel && <Badge label={badgeLabel} color={badgeColor} testId={badgeKind ? `badge-${badgeKind}` : undefined} />}

        {firstTag && (
          <span
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              background: 'rgba(255,255,255,0.92)',
              borderRadius: 999,
              padding: '2px 10px',
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--ink-2)',
              zIndex: 1,
            }}
          >
            {firstTag}
          </span>
        )}

        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt={course.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', inset: 0 }}
          />
        ) : (
          <div style={{ transform: 'scale(1.05)', pointerEvents: 'none' }}>
            <ChessBoard fen={INITIAL_FEN} size={120} showCoords={false} />
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: 16, gap: 8, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.3,
            letterSpacing: '-0.005em',
            color: 'var(--ink-1)',
            margin: 0,
          }}
        >
          {course.title}
        </h3>

        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0 }}>
          {course.creator_name}
        </p>

        {/* Stats */}
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>⭐ {course.rating_avg > 0 ? course.rating_avg.toFixed(1) : '—'}</span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span>{t('home.lessons', { count: course.lessons_count })}</span>
          {course.hours_total > 0 && (
            <>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span>{course.hours_total}h</span>
            </>
          )}
        </p>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          <span
            className="pill"
            style={{ background: 'transparent', border: '1px solid var(--border)' }}
          >
            {levelLabel}
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: course.price === 0 ? 'var(--success)' : 'var(--ink-1)',
            }}
          >
            {priceDisplay}
          </span>
        </div>
      </div>
    </article>
    </Link>
  )
}
