import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { getPendingOrderCount } from '../../lib/adminOrdersApi'

const NAV_ITEMS = [
  { key: 'overview', to: '/admin/overview' },
  { key: 'courseReview', to: '/admin/course-review' },
  { key: 'orders', to: '/admin/orders' },
  { key: 'campaigns', to: '/admin/campaigns' },
  { key: 'vouchers', to: '/admin/vouchers' },
  { key: 'users', to: '/admin/users' },
  { key: 'creatorApplications', to: '/admin/creator-applications' },
  { key: 'creatorFees', to: '/admin/creators/fees' },
  { key: 'tiers', to: '/admin/tiers' },
  { key: 'payouts', to: '/admin/payouts' },
  { key: 'reports', to: '/admin/reports' },
] as const

export default function AdminSidebar() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getPendingOrderCount(supabase).then(({ count }) => {
      if (!cancelled) setPendingCount(count)
    })
    const onFocus = () => {
      getPendingOrderCount(supabase).then(({ count }) => {
        if (!cancelled) setPendingCount(count)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
    // Refetch when navigating between admin pages — e.g. after a confirm/cancel
    // on /admin/orders changes the underlying count.
  }, [location.pathname])

  const initials = profile?.name
    ? profile.name.charAt(0).toUpperCase()
    : profile?.email?.charAt(0).toUpperCase() ?? 'A'

  return (
    <aside
      className="flex flex-col h-screen border-r border-(--border) bg-(--surface)"
      style={{ width: 220, minWidth: 220 }}
      aria-label="Admin navigation"
    >
      {/* Logo + eyebrow */}
      <div className="px-4 pt-5 pb-4">
        <Link to="/" className="flex items-center gap-2 mb-1" aria-label="Gambitly home" style={{ textDecoration: 'none' }}>
          <span className="logo-mark" aria-hidden="true" style={{ fontSize: 17 }} />
          <span className="font-serif text-base text-(--ink-1)">Gambitly</span>
        </Link>
        <p
          className="text-(--ink-3) uppercase font-medium tracking-widest"
          style={{ fontSize: 11, letterSpacing: '0.06em' }}
        >
          {t('admin.sidebar.eyebrow')}
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-0.5" aria-label="Admin menu">
        {NAV_ITEMS.map(({ key, to }) => (
          <NavLink
            key={key}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center justify-between gap-2 rounded-(--r-md) px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'text-(--ink-1) bg-(--surface-2) font-medium'
                  : 'text-(--ink-2) hover:bg-(--surface-2) hover:text-(--ink-1)',
              ].join(' ')
            }
          >
            <span>{t(`admin.sidebar.${key}`)}</span>
            {key === 'orders' && pendingCount !== null && pendingCount > 0 && (
              <span
                data-testid="orders-pending-badge"
                className="pill"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent-ink)',
                  border: '1px solid var(--accent-border)',
                  fontSize: 11,
                  padding: '1px 8px',
                  minWidth: 22,
                  textAlign: 'center',
                }}
              >
                {pendingCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Profile card */}
      {profile && (
        <div className="mx-2 mb-3 rounded-(--r-md) bg-(--surface-2) px-3 py-2.5 flex items-center gap-2">
          <div
            className="avatar shrink-0"
            style={{ width: 28, height: 28, fontSize: 12 }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-medium text-(--ink-1) truncate">{profile.name}</p>
            <p className="truncate text-(--ink-3)" style={{ fontSize: 10.5 }}>{profile.email}</p>
          </div>
        </div>
      )}
    </aside>
  )
}
