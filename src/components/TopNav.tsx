import { useRef, useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getBookmarks } from '../lib/bookmarkApi'
import { listPublishedCourses } from '../lib/coursesApi'
import type { PublicCourse } from '../lib/coursesApi'
import ThemeToggle from './ThemeToggle'
import UserAvatarMenu from './UserAvatarMenu'

export default function TopNav({ hideSearch = false }: { hideSearch?: boolean } = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)
  const [bookmarkCount, setBookmarkCount] = useState(0)
  const [overlayQuery, setOverlayQuery] = useState('')
  const [overlayResults, setOverlayResults] = useState<PublicCourse[]>([])
  const overlayRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchOverlay = useCallback((q: string) => {
    if (!q.trim()) { setOverlayResults([]); return }
    listPublishedCourses(supabase, { q }).then(({ courses }) => {
      setOverlayResults((courses ?? []).slice(0, 8))
    })
  }, [])

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setOverlayQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchOverlay(val), 250)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (val) next.set('q', val)
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
    if (!user) return
    getBookmarks(supabase, user.id).then(({ bookmarks }) => {
      setBookmarkCount(bookmarks?.length ?? 0)
    })
  }, [user])

  return (
    <header
      role="banner"
      className="h-16 flex items-center"
      style={{
        padding: '0 32px',
        gap: 24,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-strong)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <Link to="/" className="flex items-center gap-2" aria-label="Gambitly home" style={{ flexShrink: 0 }}>
        <span className="logo-mark" aria-hidden="true" />
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--ink-1)' }}>Gambitly</span>
      </Link>

      {/* Nav links */}
      <nav className="flex items-center" style={{ gap: 4 }}>
        {(user
          ? [
              { to: '/', labelKey: 'nav.browse', end: true },
              ...(profile?.role === 'admin'
                ? [
                    { to: '/admin', labelKey: 'nav.admin', end: false },
                    { to: '/creator', labelKey: 'nav.creatorStudio', end: false },
                  ]
                : profile?.role === 'creator'
                  ? [{ to: '/creator', labelKey: 'nav.creatorStudio', end: false }]
                  : [
                      { to: '/practice', labelKey: 'nav.practice', end: false },
                      { to: '/dashboard', labelKey: 'nav.library', end: false },
                      { to: '/become-creator', labelKey: 'nav.becomeCreator', end: false },
                    ]),
            ]
          : []
        ).map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            data-testid={
              link.labelKey === 'nav.library'
                ? 'nav-library-link'
                : link.labelKey === 'nav.becomeCreator'
                  ? 'nav-become-creator-link'
                  : link.labelKey === 'nav.creatorStudio'
                    ? 'nav-creator-link'
                    : link.labelKey === 'nav.admin'
                      ? 'nav-admin-link'
                      : undefined
            }
            style={({ isActive }) => ({
              padding: '8px 12px',
              borderRadius: 'var(--r-md)',
              fontSize: 14,
              color: isActive ? 'var(--ink-1)' : 'var(--ink-2)',
              background: isActive ? 'var(--surface-2)' : 'transparent',
              textDecoration: 'none',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            })}
          >
            {t(link.labelKey)}
            {link.labelKey === 'nav.library' && bookmarkCount > 0 && (
              <span
                data-testid="nav-bookmark-badge"
                style={{
                  background: 'var(--ink-1)',
                  color: 'var(--on-ink-1)',
                  borderRadius: 999,
                  fontSize: 10.5,
                  fontWeight: 600,
                  padding: '1px 6px',
                  lineHeight: 1.4,
                }}
              >
                {bookmarkCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Search box */}
      {!hideSearch && <div style={{ position: 'relative', flex: 1, maxWidth: user ? 320 : 560 }}>
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
            padding: '1px 5px',
            pointerEvents: 'none',
          }}
        >
          <Search size={12} />
        </span>
        {overlayQuery.length > 0 && overlayResults.length > 0 && (
          <div
            ref={overlayRef}
            data-testid="search-overlay"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              zIndex: 100,
              overflow: 'hidden',
            }}
          >
            {overlayResults.map(course => (
              <button
                key={course.id}
                type="button"
                data-testid={`search-overlay-result-${course.id}`}
                onClick={() => {
                  setOverlayQuery('')
                  setOverlayResults([])
                  navigate(`/courses/${course.id}`)
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--ink-1)',
                  display: 'block',
                }}
              >
                {course.title}
              </button>
            ))}
          </div>
        )}
      </div>}

      <div className="flex items-center" style={{ marginLeft: 'auto', gap: 8 }}>
        <ThemeToggle />
        {/* Bell icon */}
        {/* <button
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
        </button> */}

        {user ? (
          <UserAvatarMenu placement="bottom-right" />
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
