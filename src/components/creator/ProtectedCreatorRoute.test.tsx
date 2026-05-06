import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import ProtectedCreatorRoute from './ProtectedCreatorRoute'

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

function renderRoute() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ProtectedCreatorRoute />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('ProtectedCreatorRoute', () => {
  it('shows loading state while auth is loading', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, profile: null, profileLoading: false })
    renderRoute()
    expect(screen.getByTestId('creator-loading')).toBeInTheDocument()
  })

  it('shows loading state while profile is loading', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false, profile: null, profileLoading: true })
    renderRoute()
    expect(screen.getByTestId('creator-loading')).toBeInTheDocument()
  })

  it('redirects to /login when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, profile: null, profileLoading: false })
    renderRoute()
    expect(screen.queryByTestId('creator-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('forbidden-creator')).not.toBeInTheDocument()
  })

  it('shows forbidden page when user is not a coach or admin', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1' },
      loading: false,
      profile: { id: 'u1', role: 'learner' },
      profileLoading: false,
    })
    renderRoute()
    expect(screen.getByTestId('forbidden-creator')).toBeInTheDocument()
  })

  it('renders outlet for coach role', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1' },
      loading: false,
      profile: { id: 'u1', role: 'coach' },
      profileLoading: false,
    })
    const { container } = renderRoute()
    expect(screen.queryByTestId('forbidden-creator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('creator-loading')).not.toBeInTheDocument()
    expect(container).toBeInTheDocument()
  })

  it('renders outlet for admin role', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1' },
      loading: false,
      profile: { id: 'u1', role: 'admin' },
      profileLoading: false,
    })
    renderRoute()
    expect(screen.queryByTestId('forbidden-creator')).not.toBeInTheDocument()
  })
})
