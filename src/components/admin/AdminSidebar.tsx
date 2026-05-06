import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'

const NAV_ITEMS = [
  { key: 'overview', to: '/admin/overview' },
  { key: 'courseReview', to: '/admin/course-review' },
  { key: 'orders', to: '/admin/orders' },
  { key: 'users', to: '/admin/users' },
  { key: 'reports', to: '/admin/reports' },
  { key: 'settings', to: '/admin/settings' },
] as const

export default function AdminSidebar() {
  const { t } = useTranslation()
  const { profile } = useAuth()

  const initials = profile?.name
    ? profile.name.charAt(0).toUpperCase()
    : profile?.email?.charAt(0).toUpperCase() ?? 'A'

  return (
    <aside
      className="flex flex-col h-screen border-r border-[--border] bg-[--surface]"
      style={{ width: 220, minWidth: 220 }}
      aria-label="Admin navigation"
    >
      {/* Logo + eyebrow */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="logo-mark" aria-hidden="true" style={{ fontSize: 17 }} />
          <span className="font-serif text-base text-[--ink-1]">Gambitly</span>
        </div>
        <p
          className="text-[--ink-3] uppercase font-medium tracking-widest"
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
                'flex items-center gap-2 rounded-[--r-md] px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'text-[--ink-1] bg-[--surface-2] font-medium'
                  : 'text-[--ink-2] hover:bg-[--surface-2] hover:text-[--ink-1]',
              ].join(' ')
            }
          >
            {t(`admin.sidebar.${key}`)}
          </NavLink>
        ))}
      </nav>

      {/* Profile card */}
      {profile && (
        <div className="mx-2 mb-3 rounded-[--r-md] bg-[--surface-2] px-3 py-2.5 flex items-center gap-2">
          <div
            className="avatar shrink-0"
            style={{ width: 28, height: 28, fontSize: 12 }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-medium text-[--ink-1] truncate">{profile.name}</p>
            <p className="truncate text-[--ink-3]" style={{ fontSize: 10.5 }}>{profile.email}</p>
          </div>
        </div>
      )}
    </aside>
  )
}
