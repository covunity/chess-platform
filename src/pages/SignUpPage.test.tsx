import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import SignUpPage from './SignUpPage'
import { AuthContext } from '../context/AuthContext'

const mockSignUp = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeAuthContext(overrides = {}) {
  return {
    user: null,
    loading: false,
    signUp: mockSignUp,
    signIn: vi.fn(),
    signInWithOAuth: mockSignInWithOAuth,
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
          <SignUpPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignUp.mockResolvedValue({ error: null })
    mockSignInWithOAuth.mockResolvedValue({ error: null })
  })

  it('renders the sign up heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /tạo tài khoản miễn phí/i })).toBeInTheDocument()
  })

  it('renders full name, email, password and confirm password fields', () => {
    renderPage()
    expect(screen.getByLabelText(/họ và tên/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^mật khẩu$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/xác nhận mật khẩu/i)).toBeInTheDocument()
  })

  it('renders the ToS checkbox', () => {
    renderPage()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('shows required error when submitting empty form', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(screen.getAllByText(/trường này là bắt buộc/i).length).toBeGreaterThan(0)
    })
  })

  it('shows name too short error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/họ và tên/i), 'A')
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(screen.getByText(/tên phải có ít nhất 2 ký tự/i)).toBeInTheDocument()
    })
  })

  it('shows invalid email error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^email$/i), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(screen.getByText(/địa chỉ email không hợp lệ/i)).toBeInTheDocument()
    })
  })

  it('shows password too short error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Pass1')
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      // Error text is distinct: "Mật khẩu phải có ít nhất 8 ký tự."
      expect(screen.getByText(/mật khẩu phải có ít nhất 8 ký tự/i)).toBeInTheDocument()
    })
  })

  it('shows passwords do not match error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.type(screen.getByLabelText(/xác nhận mật khẩu/i), 'Different1')
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(screen.getByText(/mật khẩu xác nhận không khớp/i)).toBeInTheDocument()
    })
  })

  it('shows tos required error', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/họ và tên/i), 'John Doe')
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.type(screen.getByLabelText(/xác nhận mật khẩu/i), 'Password1')
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(screen.getByText(/bạn phải đồng ý với điều khoản/i)).toBeInTheDocument()
    })
  })

  it('calls signUp with correct values on valid submission', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/họ và tên/i), 'John Doe')
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.type(screen.getByLabelText(/xác nhận mật khẩu/i), 'Password1')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith('John Doe', 'john@example.com', 'Password1')
    })
  })

  it('navigates to /dashboard after successful signup', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/họ và tên/i), 'John Doe')
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.type(screen.getByLabelText(/xác nhận mật khẩu/i), 'Password1')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows server error when signUp fails', async () => {
    mockSignUp.mockResolvedValue({ error: new Error('Email already registered') })
    renderPage()
    await userEvent.type(screen.getByLabelText(/họ và tên/i), 'John Doe')
    await userEvent.type(screen.getByLabelText(/^email$/i), 'john@example.com')
    await userEvent.type(screen.getByLabelText(/^mật khẩu$/i), 'Password1')
    await userEvent.type(screen.getByLabelText(/xác nhận mật khẩu/i), 'Password1')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }))
    await waitFor(() => {
      expect(screen.getByText(/email này đã được đăng ký/i)).toBeInTheDocument()
    })
  })

  it('calls signInWithOAuth with google when the Google button is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập bằng google/i }))
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith('google')
    })
  })

  it('calls signInWithOAuth with facebook when the Facebook button is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập bằng facebook/i }))
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith('facebook')
    })
  })

  it('shows oauth error when signInWithOAuth fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: new Error('boom') })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập bằng google/i }))
    await waitFor(() => {
      expect(screen.getByText(/đăng nhập bằng google không thành công/i)).toBeInTheDocument()
    })
  })

  it('has a link to the login page', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /đăng nhập/i })).toHaveAttribute('href', '/login')
  })
})
