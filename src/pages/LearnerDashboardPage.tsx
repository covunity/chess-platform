import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getLearnerStats,
  getEnrolledCoursesProgress,
  getRecommendedCourses,
  getDashboardWishlistCourses,
} from '../lib/dashboardApi'
import type {
  LearnerStats,
  EnrolledCourseProgress,
  RecommendedCourse,
} from '../lib/dashboardApi'
import { getWishlistCourses } from '../lib/wishlistApi'
import type { WishlistCourse } from '../lib/wishlistApi'
import { listMyOrders } from '../lib/orderApi'
import type { MyOrderRow } from '../lib/orderApi'
import MiniBoard from '../components/MiniBoard'

const ZERO_STATS: LearnerStats = {
  currentStreak: 0,
  bestStreak: 0,
  lessonsThisWeek: 0,
  lessonsLastWeek: 0,
  bookmarksCount: 0,
  hoursStudied: 0,
  coursesCount: 0,
}

function FlameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c0 1.7-1 3-2 3a2 2 0 0 1-2-2c0-1.5 1-3 1-4.5 0-1-1.5-3-1.5-4 0-1 1-2 2-2.5C9 9 12 12 12 8.5 12 7 11 5 11 5s4 2 4 6.5c0 1.5-.5 3 .5 4.5 1.5 2 3 0 3-2 0-1-.5-2-1-3 0 0 4 3 4 8 0 2.5-2 5-6 5s-7-2-7-5z"/>
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="9,12 11,14 15,10" />
    </svg>
  )
}

function BookmarkFilledIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h11a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" />
      <path d="M4 4v15h12" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

interface StatCardProps {
  testId: string
  tone: 'warm' | 'good' | 'accent' | 'neutral'
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}

const TONE_STYLES: Record<StatCardProps['tone'], { bg: string; color: string }> = {
  warm: { bg: 'oklch(0.95 0.04 60)', color: 'oklch(0.55 0.14 50)' },
  good: { bg: 'var(--success-soft)', color: 'var(--success)' },
  accent: { bg: 'var(--accent-soft)', color: 'var(--accent-ink)' },
  neutral: { bg: 'var(--surface-2)', color: 'var(--ink-2)' },
}

function StatCard({ testId, tone, icon, label, value, sub }: StatCardProps) {
  const t = TONE_STYLES[tone]
  return (
    <div
      data-testid={testId}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span
          style={{
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8,
            background: t.bg,
            color: t.color,
          }}
        >
          {icon}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>{sub}</div>
    </div>
  )
}

function PendingOrderRow({ order }: { order: MyOrderRow }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={`pending-order-${order.id}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--warning-border)',
        borderRadius: 'var(--r-lg)',
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{
        width: 120, height: 90, borderRadius: 'var(--r-md)',
        background: 'var(--surface-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, overflow: 'hidden',
      }}>
        <MiniBoard size={88} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
          {order.course?.title ?? ''}
        </h3>
        <div style={{ fontSize: 12.5, color: 'var(--warning)' }}>
          {t('dashboard.pendingPaymentStatus', 'Đang chờ xác nhận thanh toán')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {t('dashboard.pendingOrderCode', 'Mã đơn: {{code}}', { code: order.code })}
        </div>
      </div>
      <Link
        data-testid={`pending-pay-btn-${order.id}`}
        to={`/checkout/${order.id}`}
        style={{
          display: 'inline-flex', alignItems: 'center',
          height: 40, padding: '0 18px',
          borderRadius: 'var(--r-md)',
          background: 'var(--warning)',
          color: 'white',
          textDecoration: 'none', fontSize: 13, fontWeight: 500, flexShrink: 0,
        }}
      >
        {t('dashboard.goPay', 'Tiến hành thanh toán')}
      </Link>
    </div>
  )
}

function CancelledOrderRow({ order }: { order: MyOrderRow }) {
  const { t } = useTranslation()
  const [showReason, setShowReason] = useState(false)
  return (
    <div
      data-testid={`cancelled-order-${order.id}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--danger-border)',
        borderRadius: 'var(--r-lg)',
        padding: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 20,
      }}
    >
      <div style={{
        width: 120, height: 90, borderRadius: 'var(--r-md)',
        background: 'var(--surface-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, overflow: 'hidden',
      }}>
        <MiniBoard size={88} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-2)', margin: 0 }}>
          {order.course?.title ?? ''}
        </h3>
        <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
          {t('dashboard.cancelledStatus', 'Đơn đã bị huỷ')}
        </div>
        {showReason && order.cancelled_reason && (
          <div
            data-testid={`cancelled-reason-${order.id}`}
            style={{ fontSize: 12, color: 'var(--ink-2)' }}
          >
            {t('dashboard.cancelledReasonLabel', 'Lý do:')}{' '}{order.cancelled_reason}
          </div>
        )}
        {order.cancelled_reason && (
          <button
            type="button"
            data-testid={`cancelled-reveal-btn-${order.id}`}
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={() => setShowReason(prev => !prev)}
          >
            {showReason
              ? t('dashboard.cancelledHideReason', 'Ẩn lý do')
              : t('dashboard.cancelledShowReason', 'Xem lý do')}
          </button>
        )}
      </div>
    </div>
  )
}

function LevelPill({ level }: { level: string }) {
  const { t } = useTranslation()
  const labelKey =
    level === 'beginner' ? 'home.levelBadgeBeginner'
    : level === 'intermediate' ? 'home.levelBadgeIntermediate'
    : 'home.levelBadgeAdvanced'
  return (
    <span
      style={{
        height: 22,
        padding: '0 8px',
        display: 'inline-flex',
        alignItems: 'center',
        background: 'transparent',
        border: '1px solid var(--border-strong)',
        color: 'var(--ink-2)',
        fontSize: 11.5,
        fontWeight: 500,
        borderRadius: 999,
      }}
    >
      {t(labelKey)}
    </span>
  )
}

export default function LearnerDashboardPage() {
  const { t } = useTranslation()
  const { user, loading: authLoading } = useAuth()

  const [stats, setStats] = useState<LearnerStats>(ZERO_STATS)
  const [enrolled, setEnrolled] = useState<EnrolledCourseProgress[] | null>(null)
  const [pendingOrders, setPendingOrders] = useState<MyOrderRow[]>([])
  const [cancelledOrders, setCancelledOrders] = useState<MyOrderRow[]>([])
  const [recommended, setRecommended] = useState<RecommendedCourse[]>([])
  const [wishlistCourses, setWishlistCourses] = useState<WishlistCourse[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([
      getLearnerStats(supabase, user.id),
      getEnrolledCoursesProgress(supabase, user.id),
      getRecommendedCourses(supabase, user.id, 3),
      listMyOrders(supabase, { status: 'pending' }),
      listMyOrders(supabase, { status: 'cancelled' }),
      getWishlistCourses(supabase, user.id),
    ]).then(([statsRes, enrolledRes, recRes, pendingRes, cancelledRes, wishlistRes]) => {
      if (cancelled) return
      if (statsRes.stats) setStats(statsRes.stats)
      setEnrolled(enrolledRes.courses ?? [])
      setRecommended(recRes.courses ?? [])
      setPendingOrders(pendingRes.orders)
      setCancelledOrders(cancelledRes.orders)
      setWishlistCourses(wishlistRes.courses ?? [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user])

  if (authLoading) {
    return <div data-testid="dashboard-loading" aria-label="Loading" style={{ minHeight: 240 }} />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const learnerName = (user.user_metadata?.name as string | undefined) ?? user.email ?? ''
  const formattedHours = stats.hoursStudied >= 100
    ? Math.round(stats.hoursStudied).toString()
    : Number.isInteger(stats.hoursStudied)
      ? stats.hoursStudied.toString()
      : stats.hoursStudied.toFixed(1)
  const weekDelta = stats.lessonsThisWeek - stats.lessonsLastWeek

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 56px 64px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
        <div>
          <div
            data-testid="dashboard-welcome"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 6,
            }}
          >
            {t('dashboard.welcome', 'CHÀO MỪNG TRỞ LẠI, {{name}}', { name: learnerName.toUpperCase() })}
          </div>
          <h1
            data-testid="dashboard-heading"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 38,
              fontWeight: 400,
              color: 'var(--ink-1)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            {t('dashboard.heading', 'Quay lại nơi bạn đã dừng.')}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link
            data-testid="dashboard-bookmarks-btn"
            to="/practice"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 16px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <BookmarkFilledIcon />
            {t('dashboard.bookmarksBtn', 'Bookmarks ({{count}})', { count: stats.bookmarksCount })}
          </Link>
          <Link
            data-testid="dashboard-browse-btn"
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 40,
              padding: '0 18px',
              borderRadius: 'var(--r-md)',
              background: 'var(--ink-1)',
              color: 'var(--on-ink-1)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {t('dashboard.browseBtn', 'Khám phá khóa học mới')}
          </Link>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 36 }}>
        <StatCard
          testId="stat-streak"
          tone="warm"
          icon={<FlameIcon />}
          label={t('dashboard.statStreak', 'Chuỗi hiện tại')}
          value={t('dashboard.statStreakValue', '{{count}} ngày', { count: stats.currentStreak })}
          sub={t('dashboard.statStreakSub', 'Kỷ lục: {{count}} ngày', { count: stats.bestStreak })}
        />
        <StatCard
          testId="stat-lessons-week"
          tone="good"
          icon={<CheckCircleIcon />}
          label={t('dashboard.statLessonsWeek', 'Bài học tuần này')}
          value={String(stats.lessonsThisWeek)}
          sub={
            weekDelta === 0
              ? t('dashboard.statLessonsWeekSame', 'Bằng tuần trước')
              : weekDelta > 0
                ? t('dashboard.statLessonsWeekUp', 'Tăng {{count}} so với tuần trước', { count: weekDelta })
                : t('dashboard.statLessonsWeekDown', 'Ít hơn {{count}} so với tuần trước', { count: -weekDelta })
          }
        />
        <StatCard
          testId="stat-bookmarks"
          tone="accent"
          icon={<BookmarkFilledIcon />}
          label={t('dashboard.statBookmarks', 'Bookmark cần ôn')}
          value={String(stats.bookmarksCount)}
          sub={t('dashboard.statBookmarksSub', 'Luyện tập ngay')}
        />
        <StatCard
          testId="stat-hours"
          tone="neutral"
          icon={<BookIcon />}
          label={t('dashboard.statHours', 'Số giờ đã học')}
          value={t('dashboard.statHoursValue', '{{hours}}h', { hours: formattedHours })}
          sub={t('dashboard.statHoursSub', 'Trên {{count}} khóa học', { count: stats.coursesCount })}
        />
      </div>

      {/* My courses */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
            {t('dashboard.myCoursesHeading', 'Khóa học của tôi')}
          </h2>
          {((enrolled?.length ?? 0) + pendingOrders.length + cancelledOrders.length) > 0 && (
            <span style={{ fontSize: 13, color: 'var(--accent-ink)', fontWeight: 500 }}>
              {t('dashboard.myCoursesCount', '{{count}} khóa học', { count: (enrolled?.length ?? 0) + pendingOrders.length + cancelledOrders.length })}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>{t('dashboard.loading', 'Đang tải...')}</div>
        ) : (enrolled?.length ?? 0) === 0 && pendingOrders.length === 0 && cancelledOrders.length === 0 ? (
          <div
            data-testid="my-courses-empty"
            style={{
              textAlign: 'center',
              padding: '48px 0',
              border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--r-lg)',
              color: 'var(--ink-3)',
              fontSize: 13.5,
            }}
          >
            {t('dashboard.myCoursesEmpty', 'Bạn chưa đăng ký khóa học nào — hãy khám phá thư viện để bắt đầu.')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {enrolled!.map(course => {
              const pct = course.lessonsCount === 0 ? 0 : Math.round((course.completedCount / course.lessonsCount) * 100)
              return (
                <div
                  key={course.course_id}
                  data-testid={`enrolled-course-${course.course_id}`}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)',
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                  }}
                >
                  <div style={{
                    width: 120,
                    height: 90,
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}>
                    <MiniBoard size={88} />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <LevelPill level={course.level} />
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{course.creator_name ?? ''}</span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
                      {course.title}
                    </h3>
                    {course.nextLesson ? (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                        {t('dashboard.upNext', 'Tiếp theo:')}{' '}
                        <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{course.nextLesson.title}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: 'var(--success)' }}>
                        {t('dashboard.allDone', 'Bạn đã hoàn thành toàn bộ bài học.')}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
                      </div>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-3)', minWidth: 64, textAlign: 'right' }}>
                        {t('dashboard.lessonsProgress', '{{done}}/{{total}} bài', {
                          done: course.completedCount, total: course.lessonsCount,
                        })}
                      </span>
                    </div>
                  </div>
                  {course.isComplete ? (
                    <span
                      data-testid={`course-complete-${course.course_id}`}
                      style={{
                        height: 28,
                        padding: '0 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'var(--success-soft)',
                        color: 'var(--success)',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      <CheckCircleIcon />
                      {t('dashboard.courseComplete', 'Đã hoàn thành')}
                    </span>
                  ) : course.nextLesson ? (
                    <Link
                      data-testid={`resume-${course.course_id}`}
                      to={`/learn/${course.course_id}/${course.nextLesson.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 40,
                        padding: '0 18px',
                        borderRadius: 'var(--r-md)',
                        background: 'var(--ink-1)',
                        color: 'var(--on-ink-1)',
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {t('dashboard.resume', 'Tiếp tục')}
                    </Link>
                  ) : null}
                </div>
              )
            })}
            {pendingOrders.map(order => (
              <PendingOrderRow key={order.id} order={order} />
            ))}
            {cancelledOrders.map(order => (
              <CancelledOrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      {/* Wishlist section */}
      {wishlistCourses.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              {t('dashboard.wishlistHeading', 'Danh sách quan tâm')}
            </h2>
            <span style={{ fontSize: 13, color: 'var(--accent-ink)', fontWeight: 500 }}>
              {t('dashboard.wishlistCount', '{{count}} khóa học', { count: wishlistCourses.length })}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {wishlistCourses.map(course => (
              <Link
                key={course.id}
                to={`/courses/${course.id}`}
                data-testid={`wishlist-course-${course.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)',
                    overflow: 'hidden',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'var(--sh-1)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    style={{
                      width: '100%',
                      height: 180,
                      background: 'var(--surface-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {course.thumbnail_url ? (
                      <img
                        src={course.thumbnail_url}
                        alt={course.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ fontSize: 40, color: 'var(--ink-4)' }}>🎓</div>
                    )}
                  </div>
                  {/* Content */}
                  <div style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <HeartIcon />
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {new Date(course.added_at).toLocaleDateString('vi-VN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <h3 style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--ink-1)',
                      margin: '0 0 8px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                    }}>
                      {course.title}
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
                      {course.creator_name ?? 'Unknown'} · ⭐ {course.rating_avg.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: course.price === 0 ? 'var(--success)' : 'var(--ink-1)' }}>
                      {course.price === 0
                        ? t('dashboard.priceFree', 'Miễn phí')
                        : `${course.price.toLocaleString('vi-VN')} ₫`}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Bottom row: Practice + Recommended */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
        <div
          data-testid="practice-shortcut"
          style={{
            background: 'linear-gradient(135deg, oklch(0.97 0.02 200) 0%, var(--surface) 100%)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 24,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{
                fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--accent-ink)', marginBottom: 6,
              }}>
                {t('dashboard.practiceEyebrow', 'LUYỆN TẬP')}
              </div>
              <div style={{
                fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400,
                color: 'var(--ink-1)', letterSpacing: '-0.02em', marginBottom: 4,
              }}>
                {t('dashboard.practiceCount', '{{count}} vị trí đã bookmark', { count: stats.bookmarksCount })}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {t('dashboard.practiceSub', 'Ôn lại các vị trí khó theo lịch của riêng bạn.')}
              </div>
            </div>
            <Link
              data-testid="practice-shortcut-cta"
              to="/practice"
              style={{
                display: 'inline-flex', alignItems: 'center',
                height: 44, padding: '0 20px',
                borderRadius: 'var(--r-md)', background: 'var(--accent)',
                color: 'var(--ink-on-accent)', textDecoration: 'none', fontSize: 14, fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {t('dashboard.practiceStart', 'Bắt đầu luyện tập')}
            </Link>
          </div>
          {stats.bookmarksCount > 0 ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
              {Array.from({ length: Math.min(4, stats.bookmarksCount) }).map((_, idx) => (
                <div
                  key={idx}
                  style={{
                    aspectRatio: '1 / 1',
                    width: 120,
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <MiniBoard size={118} />
                </div>
              ))}
              {stats.bookmarksCount > 4 && (
                <div style={{
                  width: 120, height: 120,
                  borderRadius: 'var(--r-md)',
                  border: '1px dashed var(--border-strong)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 500, color: 'var(--ink-3)',
                  flexShrink: 0,
                }}>
                  +{stats.bookmarksCount - 4} {t('dashboard.more', 'nữa')}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-3)' }}>
              {t('dashboard.practiceEmpty', 'Chưa có bookmark — lưu một vị trí từ bài học cờ vua để bắt đầu.')}
            </div>
          )}
        </div>

        <div
          data-testid="recommended-card"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 24,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
            {t('dashboard.recommendedHeading', 'Gợi ý cho bạn')}
          </h3>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 0, marginBottom: 16 }}>
            {t('dashboard.recommendedSub', 'Dựa trên hành trình học của bạn')}
          </div>

          {recommended.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {t('dashboard.recommendedEmpty', 'Chưa có gợi ý nào.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recommended.map(c => (
                <Link
                  key={c.id}
                  data-testid={`recommended-link-${c.id}`}
                  to={`/courses/${c.id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div
                    data-testid={`recommended-${c.id}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: 8, borderRadius: 'var(--r-md)',
                    }}
                  >
                    <div style={{
                      width: 44, height: 44, flexShrink: 0,
                      background: 'var(--surface-3)',
                      borderRadius: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                    }}>
                      <MiniBoard size={40} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--ink-1)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {c.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {c.creator_name ?? ''} · ⭐ {c.rating_avg.toFixed(1)}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: c.price === 0 ? 'var(--success)' : 'var(--ink-1)', flexShrink: 0 }}>
                      {c.price === 0
                        ? t('dashboard.priceFree', 'Miễn phí')
                        : `${c.price.toLocaleString('vi-VN')} ₫`}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
