import { useRef, useState, useEffect } from 'react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

export default function TopNav({ hideSearch = false }: { hideSearch?: boolean } = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (e.target.value) next.set('q', e.target.value)
      else next.delete('q')
      return next
    })
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleLogout() {
    await signOut()
    setMenuOpen(false)
    navigate('/')
  }

  const initials = user?.user_metadata?.name
    ? (user.user_metadata.name as string).charAt(0).toUpperCase()
    : user?.email?.charAt(0).toUpperCase() ?? '?'

  return (
    <header
      role="banner"
      className="h-16 flex items-center"
      style={{
        padding: '0 32px',
        gap: 24,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-strong)',
      }}
    >
      <Link to="/" className="flex items-center gap-2" aria-label="Gambitly home" style={{ flexShrink: 0 }}>
        <span className="logo-mark" aria-hidden="true" />
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--ink-1)' }}>Gambitly</span>
      </Link>

      {/* Nav links */}
      <nav className="flex items-center" style={{ gap: 4 }}>
        {[
          { to: '/', labelKey: 'nav.browse', end: true },
          { to: '/practice', labelKey: 'nav.practice', end: false },
          { to: '/library', labelKey: 'nav.library', end: false },
        ].map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            style={({ isActive }) => ({
              padding: '8px 12px',
              borderRadius: 'var(--r-md)',
              fontSize: 14,
              color: isActive ? 'var(--ink-1)' : 'var(--ink-2)',
              background: isActive ? 'var(--surface-2)' : 'transparent',
              textDecoration: 'none',
              fontWeight: 500,
            })}
          >
            {t(link.labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* Search box */}
      {!hideSearch && <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
        <input
          ref={searchRef}
          role="searchbox"
          type="search"
          defaultValue={searchParams.get('q') ?? ''}
          onChange={handleSearchChange}
          placeholder={t('home.searchPlaceholder')}
          style={{
            width: '100%',
            height: 38,
            padding: '0 40px 0 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink-4)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            padding: '1px 5px',
            pointerEvents: 'none',
          }}
        >
          ⌘K
        </span>
      </div>}

      <div className="flex items-center" style={{ marginLeft: 'auto', gap: 8 }}>
        {/* Bell icon */}
        <button
          type="button"
          aria-label={t('nav.notifications')}
          style={{
            width: 38,
            height: 38,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--r-md)',
            cursor: 'pointer',
            color: 'var(--ink-2)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        {user ? (
          <div className="nav-avatar-menu" ref={menuRef}>
            <button
              type="button"
              className="avatar"
              aria-label={t('nav.myProfile')}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}
            >
              {initials}
            </button>
            {menuOpen && (
              <div className="nav-dropdown" role="menu">
                <p className="nav-dropdown__email">{user.email}</p>
                <button
                  type="button"
                  role="menuitem"
                  className="nav-dropdown__item"
                  onClick={handleLogout}
                  aria-label={t('nav.logout')}
                >
                  {t('nav.logout')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Link to="/login" className="btn btn-secondary btn-sm">{t('nav.signIn')}</Link>
            <Link to="/signup" className="btn btn-accent btn-sm">{t('nav.createAccount')}</Link>
          </>
        )}
      </div>
    </header>
  )
}
