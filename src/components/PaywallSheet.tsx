import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface CourseSnapshot {
  lessons_count: number
  pgn_annotations_count: number
  puzzle_count: number
  price: number
}

interface PaywallSheetProps {
  onClose: () => void
  course: CourseSnapshot
  isLoggedIn: boolean
  onPurchase?: () => void
}

function formatPriceRaw(price: number): string {
  if (price >= 1000) return `${Math.round(price / 1000)}k`
  return String(price)
}

const PANEL_STYLE = `
  .paywall-sheet-panel {
    background: var(--surface-1);
    border-radius: var(--r-lg);
    width: 440px;
    max-width: 100vw;
    padding: 32px 32px 28px;
    text-align: center;
    position: relative;
  }
  @media (max-width: 640px) {
    .paywall-sheet-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100%;
      max-width: 100%;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
    }
  }
`

export default function PaywallSheet({ onClose, course, isLoggedIn, onPurchase }: PaywallSheetProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  function handleCta() {
    if (!isLoggedIn) {
      navigate('/login')
    } else {
      onPurchase ? onPurchase() : onClose()
    }
  }

  return (
    <div
      data-testid="paywall-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,17,20,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <style>{PANEL_STYLE}</style>
      {/* Sheet panel */}
      <div
        className="paywall-sheet-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Lock icon in accent-soft square */}
        <div
          data-testid="paywall-lock-wrapper"
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--r-md)',
            background: 'var(--accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <svg
            width={32}
            height={32}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-ink)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {/* Title */}
        <h3
          data-testid="paywall-sheet-title"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 24,
            fontWeight: 600,
            color: 'var(--ink-1)',
            marginBottom: 12,
          }}
        >
          {t('paywallSheet.title')}
        </h3>

        {/* Body */}
        <p
          data-testid="paywall-sheet-body"
          style={{
            fontSize: 14,
            color: 'var(--ink-2)',
            lineHeight: 1.55,
            maxWidth: 360,
            margin: '0 auto 24px',
          }}
        >
          {isLoggedIn
            ? t('paywallSheet.bodyLoggedIn', {
                n: course.lessons_count,
                a: course.pgn_annotations_count,
                p: course.puzzle_count,
              })
            : t('paywallSheet.bodyLoggedOut', { n: course.lessons_count })}
        </p>

        {/* CTA */}
        <button
          type="button"
          data-testid="paywall-cta"
          className="btn btn-accent btn-lg"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={handleCta}
        >
          {isLoggedIn
            ? t('paywallSheet.cta.buy', { price: formatPriceRaw(course.price) })
            : t('paywallSheet.cta.login')}
        </button>

        {/* Back link */}
        <button
          type="button"
          data-testid="paywall-back"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
          onClick={onClose}
        >
          {t('paywallSheet.back')}
        </button>
      </div>
    </div>
  )
}
