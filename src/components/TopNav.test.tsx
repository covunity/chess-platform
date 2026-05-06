import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import TopNav from './TopNav'
import { AuthContext } from '../context/AuthContext'

const mockSignOut = vi.fn()
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeAuthContext(overrides = {}) {
  return {
    user: null,
    loading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: mockSignOut,
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function renderNav(authOverrides = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthContext(authOverrides)}>
          <TopNav />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('TopNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignOut.mockResolvedValue(undefined)
  })

  it('renders a banner landmark', () => {
    renderNav()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders Gambitly brand name', () => {
    renderNav()
    expect(screen.getByText('Gambitly')).toBeInTheDocument()
  })

  it('has a link to the homepage', () => {
    renderNav()
    expect(screen.getByRole('link', { name: /gambitly home/i })).toHaveAttribute('href', '/')
  })

  describe('when logged out', () => {
    it('shows Sign in and Create account buttons', () => {
      renderNav()
      expect(screen.getByRole('link', { name: /đăng nhập/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /tạo tài khoản/i })).toBeInTheDocument()
    })

    it('Sign in links to /login', () => {
      renderNav()
      expect(screen.getByRole('link', { name: /đăng nhập/i })).toHaveAttribute('href', '/login')
    })

    it('Create account links to /signup', () => {
      renderNav()
      expect(screen.getByRole('link', { name: /tạo tài khoản/i })).toHaveAttribute('href', '/signup')
    })
  })

  describe('when logged in', () => {
    const loggedInUser = { email: 'user@example.com', id: '123', user_metadata: { name: 'John Doe' } }

    it('shows avatar button', () => {
      renderNav({ user: loggedInUser })
      // aria-label is t('nav.myProfile') = "Hồ sơ của tôi"
      expect(screen.getByRole('button', { name: /hồ sơ/i })).toBeInTheDocument()
    })

    it('does not show Sign in link', () => {
      renderNav({ user: loggedInUser })
      expect(screen.queryByRole('link', { name: /đăng nhập/i })).not.toBeInTheDocument()
    })

    it('opens dropdown on avatar click and shows logout option', async () => {
      renderNav({ user: loggedInUser })
      await userEvent.click(screen.getByRole('button', { name: /hồ sơ/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /đăng xuất/i })).toBeInTheDocument()
      })
    })

    it('calls signOut and navigates to / when logout is clicked', async () => {
      renderNav({ user: loggedInUser })
      await userEvent.click(screen.getByRole('button', { name: /hồ sơ/i }))
      await waitFor(() => screen.getByRole('menuitem', { name: /đăng xuất/i }))
      await userEvent.click(screen.getByRole('menuitem', { name: /đăng xuất/i }))
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled()
        expect(mockNavigate).toHaveBeenCalledWith('/')
      })
    })
  })
})
