import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

export default function TopNav() {
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
    <header role="banner" className="h-16 flex items-center px-14 border-b border-[--border] bg-[--surface]">
      <Link to="/" className="flex items-center gap-2" aria-label="Gambitly home">
        <span className="logo-mark" aria-hidden="true" />
        <span className="font-serif text-lg text-[--ink-1]">Gambitly</span>
      </Link>

      {/* Search box */}
      <div style={{ position: 'relative', marginLeft: 24 }}>
        <input
          ref={searchRef}
          role="searchbox"
          type="search"
          defaultValue={searchParams.get('q') ?? ''}
          onChange={handleSearchChange}
          placeholder={t('home.searchPlaceholder')}
          style={{
            width: 320,
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
      </div>

      <nav className="ml-auto flex items-center gap-4 text-sm text-[--ink-2]">
        <Link to="/">{t('nav.home')}</Link>

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
      </nav>
    </header>
  )
}
