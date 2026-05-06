import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

vi.mock('./lib/creatorApi', () => ({
  listCourses: vi.fn().mockResolvedValue({ courses: [], total: 0, error: null }),
  deleteCourse: vi.fn(),
  countCourseChildren: vi.fn().mockResolvedValue({ chapters: 0, lessons: 0 }),
  listChapters: vi.fn().mockResolvedValue({ chapters: [], error: null }),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
}

describe('routing', () => {
  it('renders homepage at /', () => {
    renderAt('/')
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders /terms page', () => {
    renderAt('/terms')
    expect(screen.getByTestId('terms-page')).toBeInTheDocument()
  })

  it('renders /privacy page', () => {
    renderAt('/privacy')
    expect(screen.getByTestId('privacy-page')).toBeInTheDocument()
  })

  it('renders 404 for unknown routes', () => {
    renderAt('/this-does-not-exist')
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument()
  })

  it('renders /signup page', () => {
    renderAt('/signup')
    expect(screen.getByRole('heading', { name: /bắt đầu khai cuộc/i })).toBeInTheDocument()
  })

  it('renders /login page', () => {
    renderAt('/login')
    expect(screen.getByRole('heading', { name: /tiếp tục từ nơi bạn dừng lại/i })).toBeInTheDocument()
  })

  it('renders /forgot-password page', () => {
    renderAt('/forgot-password')
    expect(screen.getByRole('heading', { name: /đặt lại mật khẩu của bạn/i })).toBeInTheDocument()
  })

  it('renders /check-email page', () => {
    renderAt('/check-email')
    expect(screen.getByTestId('check-email-page')).toBeInTheDocument()
  })

  it('renders /reset-password page', () => {
    renderAt('/reset-password')
    expect(screen.getByRole('heading', { name: /tạo mật khẩu mới/i })).toBeInTheDocument()
  })

  it('redirects /creator to /login when not authenticated', async () => {
    renderAt('/creator')
    // Not authenticated → ProtectedCreatorRoute redirects to /login
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /tiếp tục từ nơi bạn dừng lại/i })).toBeInTheDocument()
    })
  })
})
