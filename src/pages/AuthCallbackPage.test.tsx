import { render, waitFor } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import AuthCallbackPage from './AuthCallbackPage'

const mockNavigate = vi.fn()
const mockGetSession = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}))

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthCallbackPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('navigates to /dashboard when getSession returns a session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    renderPage()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    })
  })

  it('navigates to /login with oauth_failed when getSession errors', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('bad') })
    renderPage()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?error=oauth_failed', { replace: true })
    })
  })

  it('navigates to /login with oauth_failed when session is null', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    renderPage()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?error=oauth_failed', { replace: true })
    })
  })
})
