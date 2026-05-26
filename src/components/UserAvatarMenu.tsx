import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { hasUnreadOrderUpdates, readLastSeenOrdersAt } from '../lib/orderUpdatesApi'

type Placement = 'bottom-right' | 'top-stretch'

export default function UserAvatarMenu({ placement = 'bottom-right' }: { placement?: Placement }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [hasOrderUpdates, setHasOrderUpdates] = useState(false)
  const [avatarErrorUrl, setAvatarErrorUrl] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const initials = profile?.name
    ? profile.name.charAt(0).toUpperCase()
    : (user?.user_metadata?.name as string | undefined)?.charAt(0).toUpperCase()
    ?? user?.email?.charAt(0).toUpperCase()
    ?? '?'

  const firstName = (
    profile?.name ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email?.split('@')[0] ||
    ''
  ).split(' ')[0]

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!user) { setHasOrderUpdates(false); return }
    let cancelled = false
    hasUnreadOrderUpdates(supabase, readLastSeenOrdersAt()).then(({ hasUpdates }) => {
      if (!cancelled) setHasOrderUpdates(hasUpdates)
    })
    return () => { cancelled = true }
  }, [user])

  async function handleLogout() {
    await signOut()
    setMenuOpen(false)
    navigate('/')
  }

  if (!user || !profile) return null

  const showAvatarImg = !!profile.avatar_url && avatarErrorUrl !== profile.avatar_url
  const avatarEl = showAvatarImg ? (
    <img
      src={profile.avatar_url!}
      alt={profile.name ?? user.email ?? ''}
      referrerPolicy="no-referrer"
      onError={() => setAvatarErrorUrl(profile.avatar_url)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
    />
  ) : (
    initials
  )

  const dropdownContent = (
    <>
      <p className="nav-dropdown__email">{user.email}</p>
      <Link
        role="menuitem"
        className="nav-dropdown__item"
        to="/profile"
        onClick={() => setMenuOpen(false)}
      >
        {t('nav.profile', 'Hồ sơ')}
      </Link>
      <Link
        role="menuitem"
        className="nav-dropdown__item"
        data-testid="nav-orders-link"
        to="/account/orders"
        onClick={() => { setMenuOpen(false); setHasOrderUpdates(false) }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span>{t('nav.orders', 'Lịch sử đơn hàng')}</span>
        {hasOrderUpdates && (
          <span
            data-testid="topnav-orders-dot"
            aria-label={t('nav.ordersUnreadAriaLabel', 'Có cập nhật đơn hàng mới')}
            role="status"
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 999,
              background: 'var(--danger, #e54848)',
              flexShrink: 0,
            }}
          />
        )}
      </Link>
      {profile.role === 'creator' && (
        <Link
          role="menuitem"
          className="nav-dropdown__item"
          data-testid="nav-creator-payout-link"
          to="/creator/settings/payout"
          onClick={() => setMenuOpen(false)}
        >
          {t('nav.creatorPayoutSettings', 'Thông tin thanh toán')}
        </Link>
      )}
      {profile.role === 'admin' && (
        <Link
          role="menuitem"
          className="nav-dropdown__item"
          data-testid="nav-creator-link"
          to="/creator"
          onClick={() => setMenuOpen(false)}
        >
          {t('nav.creatorStudio', 'Creator Studio')}
        </Link>
      )}
      <button
        type="button"
        role="menuitem"
        className="nav-dropdown__item"
        onClick={handleLogout}
        aria-label={t('nav.logout')}
      >
        {t('nav.logout')}
      </button>
    </>
  )

  if (placement === 'top-stretch') {
    return (
      <div ref={menuRef} style={{ position: 'relative', margin: '0 8px 12px' }}>
        <button
          type="button"
          aria-label={t('nav.myProfile')}
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: menuOpen ? 'var(--surface-3)' : 'var(--surface-2)',
            border: menuOpen ? '1px solid var(--border)' : '1px solid transparent',
            borderRadius: 'var(--r-md)',
            cursor: 'pointer',
          }}
        >
          <div className="avatar shrink-0" style={{ width: 28, height: 28, fontSize: 12 }} aria-hidden="true">
            {avatarEl}
          </div>
          <div className="overflow-hidden flex-1 text-left">
            <p className="text-xs font-medium text-(--ink-1) truncate">{profile.name}</p>
            <p className="truncate text-(--ink-3)" style={{ fontSize: 10.5 }}>{profile.email}</p>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(100% + 6px)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              boxShadow: 'var(--sh-2)',
              zIndex: 200,
              overflow: 'hidden',
            }}
          >
            {dropdownContent}
          </div>
        )}
      </div>
    )
  }

  // placement === 'bottom-right' (TopNav)
  return (
    <div className="nav-avatar-menu" ref={menuRef}>
      <button
        type="button"
        aria-label={t('nav.myProfile')}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px 4px 4px',
          background: menuOpen ? 'var(--surface-2)' : 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--r-md)',
          cursor: 'pointer',
        }}
      >
        <span className="avatar" style={{ flexShrink: 0, overflow: 'hidden' }}>
          {avatarEl}
        </span>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-1)', whiteSpace: 'nowrap' }}>
          {t('nav.greeting', { name: firstName })}
        </span>
      </button>
      {menuOpen && (
        <div className="nav-dropdown" role="menu">
          {dropdownContent}
        </div>
      )}
    </div>
  )
}
