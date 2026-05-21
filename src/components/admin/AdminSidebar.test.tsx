import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminSidebar from './AdminSidebar'
import { AuthContext } from '../../context/AuthContext'
import type { AuthContextValue } from '../../context/AuthContext'
import type { User } from '@supabase/supabase-js'

const { mockGetPendingOrderCount } = vi.hoisted(() => ({
  mockGetPendingOrderCount: vi.fn(),
}))

vi.mock('../../lib/adminOrdersApi', () => ({
  getPendingOrderCount: mockGetPendingOrderCount,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn(),
  },
}))

const adminProfile = {
  id: 'admin-1',
  email: 'admin@test.com',
  name: 'Admin User',
  avatar_url: null,
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { id: 'admin-1', email: 'admin@test.com' } as User,
    loading: false,
    profile: adminProfile,
    profileLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function renderSidebar(path = '/admin/users') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={makeCtx()}>
          <AdminSidebar />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPendingOrderCount.mockResolvedValue({ count: 0, error: null })
  })

  it('renders ADMIN eyebrow label', () => {
    renderSidebar()
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('renders all nav items', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: /tổng quan/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /đơn hàng/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /người dùng/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /báo cáo/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /chi trả creator/i })).toBeInTheDocument()
  })

  // ADR-0008: creator self-publish — the admin course-review gate is gone.
  it('does NOT render the course-review nav item', () => {
    renderSidebar()
    expect(screen.queryByRole('link', { name: /duyệt khóa học/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /duyệt khoá học/i })).not.toBeInTheDocument()
  })

  it('marks Users link as active at /admin/users', () => {
    renderSidebar('/admin/users')
    const usersLink = screen.getByRole('link', { name: /người dùng/i })
    expect(usersLink).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark Users link as active at /admin/overview', () => {
    renderSidebar('/admin/overview')
    const usersLink = screen.getByRole('link', { name: /người dùng/i })
    expect(usersLink).not.toHaveAttribute('aria-current', 'page')
  })

  it('renders admin user profile card at the bottom', () => {
    renderSidebar()
    expect(screen.getByText('Admin User')).toBeInTheDocument()
    expect(screen.getByText('admin@test.com')).toBeInTheDocument()
  })

  it('shows pending-orders badge when there are pending orders', async () => {
    mockGetPendingOrderCount.mockResolvedValueOnce({ count: 7, error: null })
    renderSidebar()
    await waitFor(() => {
      expect(screen.getByTestId('orders-pending-badge')).toHaveTextContent('7')
    })
  })

  it('hides the badge when count is 0', async () => {
    mockGetPendingOrderCount.mockResolvedValueOnce({ count: 0, error: null })
    renderSidebar()
    // Wait for the resolve to flush, then assert no badge appears.
    await waitFor(() => expect(mockGetPendingOrderCount).toHaveBeenCalled())
    expect(screen.queryByTestId('orders-pending-badge')).not.toBeInTheDocument()
  })
})
