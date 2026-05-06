import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import ForgotPasswordPage from './ForgotPasswordPage'
import { AuthContext } from '../context/AuthContext'

const mockResetPassword = vi.fn()

function makeAuthContext(overrides = {}) {
  return {
    user: null,
    loading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: mockResetPassword,
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function renderPage(authOverrides = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthContext(authOverrides)}>
          <ForgotPasswordPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResetPassword.mockResolvedValue({ error: null })
  })

  it('renders the heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /đặt lại mật khẩu của bạn/i })).toBeInTheDocument()
  })

  it('renders an email input', () => {
    renderPage()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
  })

  it('shows required error for empty email', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }))
    await waitFor(() => {
      expect(screen.getByText(/trường này là bắt buộc/i)).toBeInTheDocument()
    })
  })

  it('shows invalid email error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'bad-email')
    await userEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }))
    await waitFor(() => {
      expect(screen.getByText(/địa chỉ email không hợp lệ/i)).toBeInTheDocument()
    })
  })

  it('calls resetPassword with the email', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }))
    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith('user@example.com')
    })
  })

  it('shows success state after sending reset link', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }))
    await waitFor(() => {
      expect(screen.getByText(/kiểm tra email của bạn/i)).toBeInTheDocument()
    })
  })

  it('shows server error on failure', async () => {
    mockResetPassword.mockResolvedValue({ error: new Error('User not found') })
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }))
    await waitFor(() => {
      expect(screen.getByText(/user not found/i)).toBeInTheDocument()
    })
  })

  it('has a back to sign in link', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /quay lại đăng nhập/i })).toHaveAttribute('href', '/login')
  })
})
