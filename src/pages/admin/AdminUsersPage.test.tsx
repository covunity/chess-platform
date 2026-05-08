import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminUsersPage from './AdminUsersPage'

const { mockListUsers, mockChangeUserRole, mockChangeUserAccountTier } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockChangeUserRole: vi.fn(),
  mockChangeUserAccountTier: vi.fn(),
}))

vi.mock('../../lib/adminApi', () => ({
  listUsers: mockListUsers,
  changeUserRole: mockChangeUserRole,
  changeUserAccountTier: mockChangeUserAccountTier,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {},
}))

vi.mock('../../lib/accountTiers', () => ({
  useAccountTiers: vi.fn(() => ({
    tiers: [
      { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: false, display_order: 1 },
      { code: 'business', name_vi: 'Doanh nghiệp', platform_fee_pct: 15, max_chapters_per_course: 30, is_enterprise: true, requires_approval: true, display_order: 2 },
    ],
    loading: false,
    getTier: (code: string) => {
      const tiers: Record<string, { code: string; name_vi: string; is_enterprise: boolean; platform_fee_pct: number; max_chapters_per_course: number }> = {
        individual: { code: 'individual', name_vi: 'Cá nhân', is_enterprise: false, platform_fee_pct: 20, max_chapters_per_course: 10 },
        business: { code: 'business', name_vi: 'Doanh nghiệp', is_enterprise: true, platform_fee_pct: 15, max_chapters_per_course: 30 },
      }
      return tiers[code]
    },
  })),
}))

const mockUsers = [
  {
    id: 'u1',
    email: 'alice@test.com',
    name: 'Alice',
    avatar_url: null,
    role: 'learner' as const,
    account_tier_id: 'individual' as const,
    created_at: '2026-01-15T10:00:00Z',
  },
  {
    id: 'u2',
    email: 'bob@test.com',
    name: 'Bob',
    avatar_url: null,
    role: 'creator' as const,
    account_tier_id: 'business' as const,
    created_at: '2026-02-20T12:00:00Z',
  },
]

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListUsers.mockResolvedValue({ users: mockUsers, total: 2, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders search input', () => {
    renderPage()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('renders table column headers including Tier', () => {
    renderPage()
    expect(screen.getByText(/tên/i)).toBeInTheDocument()
    expect(screen.getByText(/email/i)).toBeInTheDocument()
    expect(screen.getByText(/vai trò/i)).toBeInTheDocument()
    expect(screen.getByText(/tier/i)).toBeInTheDocument()
    expect(screen.getByText(/ngày đăng ký/i)).toBeInTheDocument()
    expect(screen.getByText(/khóa học đã mua/i)).toBeInTheDocument()
    expect(screen.getByText(/khóa học đã tạo/i)).toBeInTheDocument()
  })

  it('renders tier badges for each user', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cá nhân')).toBeInTheDocument()
      expect(screen.getByText('Doanh nghiệp')).toBeInTheDocument()
    })
  })

  it('renders user rows after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  it('renders role pills for each user', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Học viên')).toBeInTheDocument()
      expect(screen.getByText('Người tạo')).toBeInTheDocument()
    })
  })

  it('calls listUsers with search term after debounce (300ms)', async () => {
    vi.useFakeTimers()
    renderPage()

    await act(async () => {})
    expect(mockListUsers).toHaveBeenCalledTimes(1)

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'alice' } })

    expect(mockListUsers).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(mockListUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ search: 'alice', page: 1 })
    )
  })

  it('opens role change dialog when action button clicked', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Alice'))

    const actionButtons = screen.getAllByRole('button', { name: /đổi vai trò/i })
    await userEvent.click(actionButtons[0])

    expect(screen.getByTestId('role-change-dialog')).toBeInTheDocument()
    expect(screen.getByText(/thay đổi vai trò\?/i)).toBeInTheDocument()
  })

  it('dialog shows user name and role transition', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Alice'))

    await userEvent.click(screen.getAllByRole('button', { name: /đổi vai trò/i })[0])

    const dialog = screen.getByTestId('role-change-dialog')
    expect(dialog).toHaveTextContent('Alice')
    expect(dialog).toHaveTextContent('Học viên')
    expect(dialog).toHaveTextContent('Người tạo')
  })

  it('closes dialog on Cancel click', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Alice'))

    await userEvent.click(screen.getAllByRole('button', { name: /đổi vai trò/i })[0])
    expect(screen.getByTestId('role-change-dialog')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /hủy/i }))
    expect(screen.queryByTestId('role-change-dialog')).not.toBeInTheDocument()
  })

  it('calls changeUserRole and updates pill on Confirm', async () => {
    const updatedAlice = { ...mockUsers[0], role: 'creator' as const, account_tier_id: 'individual' as const }
    mockChangeUserRole.mockResolvedValue({ user: updatedAlice, error: null })

    renderPage()
    await waitFor(() => screen.getByText('Alice'))

    await userEvent.click(screen.getAllByRole('button', { name: /đổi vai trò/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /xác nhận/i }))

    await waitFor(() => {
      expect(mockChangeUserRole).toHaveBeenCalledWith(expect.anything(), 'u1', 'creator')
    })

    await waitFor(() => {
      const pills = screen.getAllByText('Người tạo')
      expect(pills.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('tier change', () => {
    it('shows Đổi tier button for non-admin users', async () => {
      renderPage()
      await waitFor(() => screen.getByText('Alice'))

      expect(screen.getByTestId('change-tier-btn-u1')).toBeInTheDocument()
      expect(screen.getByTestId('change-tier-btn-u2')).toBeInTheDocument()
    })

    it('does not show Đổi tier button for admin users', async () => {
      const adminUser = { ...mockUsers[0], id: 'u-admin', role: 'admin' as const }
      mockListUsers.mockResolvedValue({ users: [adminUser], total: 1, error: null })

      renderPage()
      await waitFor(() => screen.getByText('Alice'))

      expect(screen.queryByTestId('change-tier-btn-u-admin')).not.toBeInTheDocument()
    })

    it('opens tier change dialog when button clicked', async () => {
      renderPage()
      await waitFor(() => screen.getByText('Alice'))

      await userEvent.click(screen.getByTestId('change-tier-btn-u1'))

      expect(screen.getByTestId('tier-change-dialog')).toBeInTheDocument()
    })

    it('tier dialog shows fee and max chapters for selected tier', async () => {
      renderPage()
      await waitFor(() => screen.getByText('Alice'))

      await userEvent.click(screen.getByTestId('change-tier-btn-u1'))

      expect(screen.getByTestId('tier-change-dialog')).toBeInTheDocument()
      // Should show fee/max info for individual tier (20%, 10 chapters)
      expect(screen.getByTestId('tier-change-dialog')).toHaveTextContent('20')
    })

    it('calls changeUserAccountTier on confirm and updates tier badge', async () => {
      const updatedAlice = { ...mockUsers[0], account_tier_id: 'business' as const }
      mockChangeUserAccountTier.mockResolvedValue({ user: updatedAlice, error: null })

      renderPage()
      await waitFor(() => screen.getByText('Alice'))

      await userEvent.click(screen.getByTestId('change-tier-btn-u1'))

      const tierSelect = screen.getByTestId('tier-select')
      await userEvent.selectOptions(tierSelect, 'business')

      await userEvent.click(screen.getByTestId('tier-change-confirm'))

      await waitFor(() => {
        expect(mockChangeUserAccountTier).toHaveBeenCalledWith(
          expect.anything(),
          'u1',
          'business'
        )
      })
      expect(screen.queryByTestId('tier-change-dialog')).not.toBeInTheDocument()
    })

    it('shows error when downgrade violates chapter limit', async () => {
      mockChangeUserAccountTier.mockResolvedValue({
        user: null,
        error: { message: 'tier_downgrade_violates_chapter_limit' },
      })

      renderPage()
      await waitFor(() => screen.getByText('Bob'))

      await userEvent.click(screen.getByTestId('change-tier-btn-u2'))

      const tierSelect = screen.getByTestId('tier-select')
      await userEvent.selectOptions(tierSelect, 'individual')

      await userEvent.click(screen.getByTestId('tier-change-confirm'))

      await waitFor(() => {
        expect(screen.getByTestId('tier-change-error')).toBeInTheDocument()
      })
      // Dialog stays open
      expect(screen.getByTestId('tier-change-dialog')).toBeInTheDocument()
    })

    it('closes dialog on cancel', async () => {
      renderPage()
      await waitFor(() => screen.getByText('Alice'))

      await userEvent.click(screen.getByTestId('change-tier-btn-u1'))
      expect(screen.getByTestId('tier-change-dialog')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /hủy/i }))
      expect(screen.queryByTestId('tier-change-dialog')).not.toBeInTheDocument()
    })
  })
})
