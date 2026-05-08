import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import LoginPage from './LoginPage'
import { AuthContext } from '../context/AuthContext'

const mockSignIn = vi.fn()
const mockNavigate = vi.fn()

const { mockGetPendingAccountApplication } = vi.hoisted(() => ({
  mockGetPendingAccountApplication: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../lib/pendingAccountApplication', () => ({
  getPendingAccountApplication: mockGetPendingAccountApplication,
  savePendingAccountApplication: vi.fn(),
  clearPendingAccountApplication: vi.fn(),
}))

function makeAuthContext(overrides = {}) {
  return {
    user: null,
    loading: false,
    signUp: vi.fn(),
    signIn: mockSignIn,
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function renderPage(authOverrides = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthContext(authOverrides)}>
          <LoginPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue({ error: null })
    mockGetPendingAccountApplication.mockReturnValue(null)
  })

  it('renders the login heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /tiếp tục từ nơi bạn dừng lại/i })).toBeInTheDocument()
  })

  it('renders email and password fields', () => {
    renderPage()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^mật khẩu$/i)).toBeInTheDocument()
  })

  it('shows required errors when submitting empty form', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => {
      expect(screen.getAllByText(/trường này là bắt buộc/i).length).toBeGreaterThan(0)
    })
  })

  it('shows invalid email error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'bad-email')
    await userEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => {
      expect(screen.getByText(/địa chỉ email không hợp lệ/i)).toBeInTheDocument()
    })
  })

  it('calls signIn with correct values on valid submission', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('john@example.com', 'Password1')
    })
  })

  it('navigates to / after successful login', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })
  })

  it('shows server error when signIn fails', async () => {
    mockSignIn.mockResolvedValue({ error: new Error('Invalid credentials') })
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })
  })

  it('has a forgot password link', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /quên mật khẩu/i })).toHaveAttribute('href', '/forgot-password')
  })

  it('has a link to create account', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /tạo tài khoản/i })).toHaveAttribute('href', '/signup')
  })

  it('redirects to /become-creator after login when pendingAccountApplication exists', async () => {
    mockGetPendingAccountApplication.mockReturnValue({ requested_tier_code: 'individual' })
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/become-creator')
    })
  })
})
