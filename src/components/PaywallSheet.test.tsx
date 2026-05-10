import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import PaywallSheet from './PaywallSheet'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const sampleCourse = {
  lessons_count: 42,
  pgn_annotations_count: 96,
  puzzle_count: 18,
  price: 480000,
}

function renderSheet(props: Partial<Parameters<typeof PaywallSheet>[0]> = {}) {
  const defaults = {
    onClose: vi.fn(),
    course: sampleCourse,
    isLoggedIn: false,
    ...props,
  }
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <PaywallSheet {...defaults} />
      </I18nextProvider>
    </MemoryRouter>
  )
}

describe('PaywallSheet', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('renders the title', () => {
    renderSheet()
    expect(screen.getByTestId('paywall-sheet-title')).toBeInTheDocument()
  })

  it('shows logged-out body with lesson count substitution', () => {
    renderSheet({ isLoggedIn: false })
    const body = screen.getByTestId('paywall-sheet-body')
    expect(body.textContent).toContain('42')
  })

  it('shows logged-in body with lesson, annotation, puzzle counts', () => {
    renderSheet({ isLoggedIn: true })
    const body = screen.getByTestId('paywall-sheet-body')
    expect(body.textContent).toContain('42')
    expect(body.textContent).toContain('96')
    expect(body.textContent).toContain('18')
  })

  it('shows login CTA when logged out', () => {
    renderSheet({ isLoggedIn: false })
    expect(screen.getByTestId('paywall-cta')).toBeInTheDocument()
    expect(screen.getByTestId('paywall-cta').textContent).not.toContain('₫')
  })

  it('shows buy CTA with price when logged in', () => {
    renderSheet({ isLoggedIn: true })
    const cta = screen.getByTestId('paywall-cta')
    expect(cta.textContent).toContain('480')
  })

  it('navigates to /login when logged-out CTA is clicked', async () => {
    renderSheet({ isLoggedIn: false })
    await userEvent.click(screen.getByTestId('paywall-cta'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    await userEvent.click(screen.getByTestId('paywall-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when back link is clicked', async () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    await userEvent.click(screen.getByTestId('paywall-back'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders lock icon in accent-soft square', () => {
    renderSheet()
    expect(screen.getByTestId('paywall-lock-wrapper')).toBeInTheDocument()
  })
})
