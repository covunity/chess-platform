import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 150
const HIDE_DELAY_MS = 120

export interface UserNameCardData {
  name: string | null
  avatar_url: string | null
  bio: string | null
}

interface UserNameCardTriggerProps {
  user: UserNameCardData
  children: React.ReactNode
  /** Override the visual fallback when the user has no avatar (defaults to first letter). */
  fallbackInitials?: string
}

function initialsFor(user: UserNameCardData, override?: string): string {
  if (override) return override
  const source = (user.name ?? '').trim()
  if (source.length === 0) return '?'
  return source.charAt(0).toUpperCase()
}

/**
 * Wraps an inline trigger (typically a username span) and shows a floating
 * name-card popup with the user's avatar, name and bio on hover.
 *
 * Pop-up position is captured once at hover-in (at the mouse coords) and stays
 * still until hover-out — no jitter from continuous tracking. Renders via
 * portal so it escapes any `overflow: hidden` parents.
 */
export default function UserNameCardTrigger({
  user,
  children,
  fallbackInitials,
}: UserNameCardTriggerProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null }
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }

  useEffect(() => () => clearTimers(), [])

  function handleEnter(e: React.MouseEvent) {
    clearTimers()
    const x = e.clientX
    const y = e.clientY
    showTimer.current = setTimeout(() => {
      setPosition({ x, y })
      setOpen(true)
    }, SHOW_DELAY_MS)
  }

  function handleLeave() {
    clearTimers()
    hideTimer.current = setTimeout(() => {
      setOpen(false)
      setPosition(null)
    }, HIDE_DELAY_MS)
  }

  return (
    <>
      <span
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setPosition({ x: rect.left, y: rect.bottom })
          setOpen(true)
        }}
        onBlur={handleLeave}
        tabIndex={0}
        style={{ cursor: 'help', borderBottom: '1px dotted var(--ink-3)' }}
      >
        {children}
      </span>
      {open && position && (
        <UserNameCardPopup
          user={user}
          position={position}
          initials={initialsFor(user, fallbackInitials)}
          onMouseEnter={clearTimers}
          onMouseLeave={handleLeave}
        />
      )}
    </>
  )
}

interface PopupProps {
  user: UserNameCardData
  position: { x: number; y: number }
  initials: string
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function UserNameCardPopup({ user, position, initials, onMouseEnter, onMouseLeave }: PopupProps) {
  // Clamp horizontal so the card never overflows the viewport
  const CARD_WIDTH = 260
  const CARD_OFFSET = 12
  const left = Math.min(
    Math.max(8, position.x + CARD_OFFSET),
    window.innerWidth - CARD_WIDTH - 8
  )
  const top = position.y + CARD_OFFSET

  return createPortal(
    <div
      data-testid="user-name-card-popup"
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        top,
        left,
        width: CARD_WIDTH,
        zIndex: 1000,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        boxShadow: '0 8px 28px rgba(15, 17, 20, 0.18), 0 2px 6px rgba(15, 17, 20, 0.08)',
        padding: 14,
        animation: 'user-name-card-fade-in 120ms ease-out',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            className="avatar"
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              fontSize: 16,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div
            data-testid="user-name-card-name"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.name ?? '—'}
          </div>
          {user.bio && (
            <p
              data-testid="user-name-card-bio"
              style={{
                marginTop: 4,
                marginBottom: 0,
                fontSize: 12.5,
                color: 'var(--ink-2)',
                lineHeight: 1.45,
                wordBreak: 'break-word',
              }}
            >
              {user.bio}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
