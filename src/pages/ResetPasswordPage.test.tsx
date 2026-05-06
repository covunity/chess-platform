import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import ResetPasswordPage from './ResetPasswordPage'
import { AuthContext } from '../context/AuthContext'

const mockUpdatePassword = vi.fn()
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
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: mockUpdatePassword,
    ...overrides,
  }
}

function renderPage(authOverrides = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthContext(authOverrides)}>
          <ResetPasswordPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdatePassword.mockResolvedValue({ error: null })
  })

  it('renders the heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /tạo mật khẩu mới/i })).toBeInTheDocument()
  })

  it('renders new password and confirm password fields', () => {
    renderPage()
    // Use exact label text to distinguish the two fields
    expect(screen.getByLabelText('Mật khẩu mới')).toBeInTheDocument()
    expect(screen.getByLabelText('Xác nhận mật khẩu mới')).toBeInTheDocument()
  })

  it('shows required errors on empty submit', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /cập nhật mật khẩu/i }))
    await waitFor(() => {
      expect(screen.getAllByText(/trường này là bắt buộc/i).length).toBeGreaterThan(0)
    })
  })

  it('shows password too short error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /cập nhật mật khẩu/i }))
    await waitFor(() => {
      expect(screen.getByText(/mật khẩu phải có ít nhất 8 ký tự/i)).toBeInTheDocument()
    })
  })

  it('shows passwords mismatch error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Password1')
    await userEvent.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Different1')
    await userEvent.click(screen.getByRole('button', { name: /cập nhật mật khẩu/i }))
    await waitFor(() => {
      expect(screen.getByText(/mật khẩu xác nhận không khớp/i)).toBeInTheDocument()
    })
  })

  it('calls updatePassword with the new password', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Password1')
    await userEvent.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /cập nhật mật khẩu/i }))
    await waitFor(() => {
      expect(mockUpdatePassword).toHaveBeenCalledWith('Password1')
    })
  })

  it('shows success state after password update', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Password1')
    await userEvent.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /cập nhật mật khẩu/i }))
    await waitFor(() => {
      expect(screen.getByText(/mật khẩu đã được cập nhật/i)).toBeInTheDocument()
    })
  })

  it('shows server error on failure', async () => {
    mockUpdatePassword.mockResolvedValue({ error: new Error('Token expired') })
    renderPage()
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Password1')
    await userEvent.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /cập nhật mật khẩu/i }))
    await waitFor(() => {
      expect(screen.getByText(/token expired/i)).toBeInTheDocument()
    })
  })
})
