import { useRef, useState, useEffect, useCallback } from 'react'
import { Search, Menu, X } from 'lucide-react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getBookmarks } from '../lib/bookmarkApi'
import { listPublishedCourses } from '../lib/coursesApi'
import type { PublicCourse } from '../lib/coursesApi'
import { formatPrice } from '../lib/utils'
import ThemeToggle from './ThemeToggle'
import UserAvatarMenu from './UserAvatarMenu'

export default function TopNav({ hideSearch = false }: { hideSearch?: boolean } = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, profileLoading } = useAuth()
  const searchRef = useRef<HTMLInputElement>(null)
  const mobileSearchRef = useRef<HTMLInputElement>(null)
  const [bookmarkCount, setBookmarkCount] = useState(0)
  const [overlayQuery, setOverlayQuery] = useState('')
  const [overlayResults, setOverlayResults] = useState<PublicCourse[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
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
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const val = overlayQuery.trim()
      setOverlayResults([])
      searchRef.current?.blur()
      if (val) {
        navigate(`/?q=${encodeURIComponent(val)}`)
      } else {
        navigate('/')
      }
    }
    if (e.key === 'Escape') {
      setOverlayQuery('')
      setOverlayResults([])
      searchRef.current?.blur()
    }
  }

  // Sync search box with ?q URL param when on home page
  useEffect(() => {
    if (location.pathname === '/') {
      const params = new URLSearchParams(location.search)
      setOverlayQuery(params.get('q') ?? '')
    } else {
      setOverlayQuery('')
    }
    setOverlayResults([])
  }, [location.pathname, location.search])

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
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOverlayResults([])
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!user) return
    getBookmarks(supabase, user.id).then(({ bookmarks }) => {
      setBookmarkCount(bookmarks?.length ?? 0)
    })
  }, [user])

  useEffect(() => {
    setMobileMenuOpen(false)
    setMobileSearchOpen(false)
  }, [location.pathname])

  const navLinks = user
    ? [
        { to: '/', labelKey: 'nav.browse', end: true },
        ...(!profileLoading
          ? profile?.role === 'admin'
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
                ]
          : []),
      ]
    : []

  return (
    <header
      role="banner"
      className="h-16 flex items-center justify-between"
      style={{
        padding: '0 16px',
        gap: 12,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-strong)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        minHeight: 64,
      }}
    >
      <Link to="/" aria-label="Covunity home" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <img src="/icons/logo-light.png" alt="" className="nav-logo nav-logo--light" style={{ height: 30, width: 'auto', display: 'block' }} />
        <img src="/icons/logo-dark.png"  alt="" className="nav-logo nav-logo--dark"  style={{ height: 30, width: 'auto', display: 'block' }} />
      </Link>

      {/* Desktop Nav links */}
      <nav className="hidden md:flex items-center" style={{ gap: 4 }}>
        {navLinks.map(link => (
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

      {/* Desktop Search box */}
      {!hideSearch && (
        <div className="hidden md:block" style={{ position: 'relative', flex: 1, maxWidth: user ? 320 : 480 }}>
          <input
            ref={searchRef}
            role="searchbox"
            type="text"
            value={overlayQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
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
          <button
            type="button"
            aria-label={t('home.searchPlaceholder')}
            onClick={() => {
              const val = overlayQuery.trim()
              setOverlayResults([])
              searchRef.current?.blur()
              if (val) {
                navigate(`/?q=${encodeURIComponent(val)}`)
              } else {
                navigate('/')
              }
            }}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              padding: 0,
            }}
          >
            <Search size={14} />
          </button>
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
                  className="flex items-center gap-3"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--r-sm)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'var(--surface-2)',
                    }}
                  >
                    {course.thumbnail_url ? (
                      <img
                        src={course.thumbnail_url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          color: 'var(--ink-4)',
                        }}
                      >
                        ♟
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--ink-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {course.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                      {course.price === 0
                        ? t('home.free')
                        : formatPrice(course.price)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Right side controls */}
      <div className="flex items-center" style={{ marginLeft: 'auto', gap: 8 }}>
        {/* Desktop Controls */}
        <div className="hidden md:flex items-center" style={{ gap: 8 }}>
          <ThemeToggle />
          {user ? (
            <UserAvatarMenu placement="bottom-right" />
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="btn btn-secondary btn-sm">{t('nav.signIn')}</Link>
              <Link to="/signup" className="btn btn-accent btn-sm">{t('nav.createAccount')}</Link>
            </div>
          )}
        </div>

        {/* Mobile: ONLY ONE Menu Button */}
        <button
          type="button"
          className="md:hidden flex items-center justify-center p-2 rounded-lg"
          aria-label="Toggle mobile menu"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{
            width: 40,
            height: 40,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--ink-1)',
            cursor: 'pointer',
          }}
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="md:hidden"
          style={{
            position: 'fixed',
            top: 64,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--surface)',
            zIndex: 48,
            padding: '20px 16px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Mobile Search Bar inside Drawer */}
          {!hideSearch && (
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                ref={mobileSearchRef}
                type="text"
                value={overlayQuery}
                onChange={handleSearchChange}
                onKeyDown={(e) => {
                  handleSearchKeyDown(e)
                  if (e.key === 'Enter') setMobileMenuOpen(false)
                }}
                placeholder={t('home.searchPlaceholder')}
                style={{
                  width: '100%',
                  height: 42,
                  padding: '0 40px 0 14px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  fontSize: 14,
                  color: 'var(--ink-1)',
                }}
              />
              <button
                type="button"
                aria-label={t('home.searchPlaceholder')}
                onClick={() => {
                  const val = overlayQuery.trim()
                  setOverlayResults([])
                  setMobileMenuOpen(false)
                  if (val) navigate(`/?q=${encodeURIComponent(val)}`)
                }}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-2)',
                  padding: 4,
                }}
              >
                <Search size={18} />
              </button>
            </div>
          )}

          {/* Theme Toggle Bar inside Mobile Drawer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-1)' }}>
              Giao diện (Theme)
            </span>
            <ThemeToggle />
          </div>

          {/* Nav links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {navLinks.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={() => setMobileMenuOpen(false)}
                style={({ isActive }) => ({
                  padding: '12px 14px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 15,
                  color: isActive ? 'var(--ink-1)' : 'var(--ink-2)',
                  background: isActive ? 'var(--surface-2)' : 'transparent',
                  textDecoration: 'none',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                })}
              >
                <span>{t(link.labelKey)}</span>
                {link.labelKey === 'nav.library' && bookmarkCount > 0 && (
                  <span
                    style={{
                      background: 'var(--ink-1)',
                      color: 'var(--on-ink-1)',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '2px 8px',
                    }}
                  >
                    {bookmarkCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>

          {/* Auth section inside Mobile Drawer */}
          {user ? (
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <UserAvatarMenu placement="bottom-right" />
            </div>
          ) : (
            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                {t('nav.signIn')}
              </Link>
              <Link to="/signup" onClick={() => setMobileMenuOpen(false)} className="btn btn-accent" style={{ width: '100%', justifyContent: 'center' }}>
                {t('nav.createAccount')}
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
