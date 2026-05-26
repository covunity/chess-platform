import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import TopNav from './TopNav'
import { AuthContext } from '../context/AuthContext'
import * as coursesApi from '../lib/coursesApi'

const mockListPublishedCourses = vi.spyOn(coursesApi, 'listPublishedCourses')

const { mockHasUnreadOrderUpdates, mockReadLastSeenOrdersAt } = vi.hoisted(() => ({
  mockHasUnreadOrderUpdates: vi.fn(),
  mockReadLastSeenOrdersAt: vi.fn(),
}))

vi.mock('../lib/orderUpdatesApi', () => ({
  hasUnreadOrderUpdates: mockHasUnreadOrderUpdates,
  readLastSeenOrdersAt: mockReadLastSeenOrdersAt,
  writeLastSeenOrdersAt: vi.fn(),
}))

vi.mock('../lib/bookmarkApi', () => ({
  getBookmarks: vi.fn().mockResolvedValue({ bookmarks: [], error: null }),
}))

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
    profile: null,
    profileLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: mockSignOut,
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function profileFor(role: 'learner' | 'creator' | 'admin') {
  return {
    id: '123',
    email: 'user@example.com',
    name: 'John Doe',
    avatar_url: null,
    role,
    created_at: '2026-01-01T00:00:00Z',
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
    // Default: no unread orders. Individual tests override.
    mockHasUnreadOrderUpdates.mockResolvedValue({ hasUpdates: false, error: null })
    mockReadLastSeenOrdersAt.mockReturnValue(null)
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
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      // aria-label is t('nav.myProfile') = "Hồ sơ của tôi"
      expect(screen.getByRole('button', { name: /hồ sơ/i })).toBeInTheDocument()
    })

    it('does not show Sign in link', () => {
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      expect(screen.queryByRole('link', { name: /đăng nhập/i })).not.toBeInTheDocument()
    })

    it('opens dropdown on avatar click and shows logout option', async () => {
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await userEvent.click(screen.getByRole('button', { name: /hồ sơ/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /đăng xuất/i })).toBeInTheDocument()
      })
    })

    it('calls signOut and navigates to / when logout is clicked', async () => {
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await userEvent.click(screen.getByRole('button', { name: /hồ sơ/i }))
      await waitFor(() => screen.getByRole('menuitem', { name: /đăng xuất/i }))
      await userEvent.click(screen.getByRole('menuitem', { name: /đăng xuất/i }))
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled()
        expect(mockNavigate).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('role-based top nav', () => {
    const loggedInUser = { email: 'user@example.com', id: '123', user_metadata: { name: 'John Doe' } }

    it('learner role shows library + become-creator, hides creator/admin links', () => {
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      expect(screen.getByTestId('nav-library-link')).toHaveAttribute('href', '/dashboard')
      expect(screen.getByTestId('nav-become-creator-link')).toHaveAttribute('href', '/become-creator')
      expect(screen.queryByTestId('nav-creator-link')).not.toBeInTheDocument()
      expect(screen.queryByTestId('nav-admin-link')).not.toBeInTheDocument()
    })

    it('creator role shows Creator Studio in top nav, hides library + become-creator + admin', () => {
      renderNav({ user: loggedInUser, profile: profileFor('creator') })
      expect(screen.getByTestId('nav-creator-link')).toHaveAttribute('href', '/creator')
      expect(screen.queryByTestId('nav-library-link')).not.toBeInTheDocument()
      expect(screen.queryByTestId('nav-become-creator-link')).not.toBeInTheDocument()
      expect(screen.queryByTestId('nav-admin-link')).not.toBeInTheDocument()
    })

    it('admin role shows Quản trị in top nav, hides library + become-creator', () => {
      renderNav({ user: loggedInUser, profile: profileFor('admin') })
      expect(screen.getByTestId('nav-admin-link')).toHaveAttribute('href', '/admin')
      expect(screen.queryByTestId('nav-library-link')).not.toBeInTheDocument()
      expect(screen.queryByTestId('nav-become-creator-link')).not.toBeInTheDocument()
    })

    it('shows learner-style nav when profile is null (still loading)', () => {
      renderNav({ user: loggedInUser, profile: null })
      expect(screen.getByTestId('nav-library-link')).toHaveAttribute('href', '/dashboard')
      expect(screen.queryByTestId('nav-admin-link')).not.toBeInTheDocument()
    })
  })

  describe('avatar dropdown role-based items', () => {
    const loggedInUser = { email: 'user@example.com', id: '123', user_metadata: { name: 'John Doe' } }

    async function openDropdown() {
      await userEvent.click(screen.getByRole('button', { name: /hồ sơ/i }))
      await waitFor(() => screen.getByRole('menuitem', { name: /đăng xuất/i }))
    }

    it('learner dropdown does not include Creator Studio', async () => {
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await openDropdown()
      expect(screen.queryByRole('menuitem', { name: /creator studio/i })).not.toBeInTheDocument()
    })

    it('creator dropdown does not include Creator Studio (it is in top nav)', async () => {
      renderNav({ user: loggedInUser, profile: profileFor('creator') })
      await openDropdown()
      expect(screen.queryByRole('menuitem', { name: /creator studio/i })).not.toBeInTheDocument()
    })

    it('admin dropdown still includes Creator Studio (since top nav shows Quản trị)', async () => {
      renderNav({ user: loggedInUser, profile: profileFor('admin') })
      await openDropdown()
      expect(screen.getByRole('menuitem', { name: /creator studio/i })).toHaveAttribute('href', '/creator')
    })
  })

  describe('library link', () => {
    it('points to /dashboard (not the dead /library route) when no profile', () => {
      renderNav({ user: { email: 'user@example.com', id: '123', user_metadata: { name: 'John Doe' } }, profile: null })
      expect(screen.getByTestId('nav-library-link')).toHaveAttribute('href', '/dashboard')
    })
  })

  describe('search box', () => {
    it('renders a search input in the nav', () => {
      renderNav()
      expect(screen.getByRole('searchbox')).toBeInTheDocument()
    })

    it('search input has placeholder text', () => {
      renderNav()
      const input = screen.getByRole('searchbox')
      expect(input).toHaveAttribute('placeholder')
    })
  })

  describe('search overlay', () => {
    const overlayCourses = [
      {
        id: 'ov1', title: 'Sicilian Defense', description: null, thumbnail_url: null,
        price: 0, level: 'beginner' as const, tags: [], creator_id: 'u1',
        creator_name: 'GM X', rating_avg: 4.5, rating_count: 10,
        lessons_count: 5, hours_total: 2, enrollment_count: 50,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]

    beforeEach(() => {
      mockListPublishedCourses.mockResolvedValue({ courses: overlayCourses, error: null })
    })

    it('shows search overlay after typing in the search box', async () => {
      const user = userEvent.setup({ delay: null })
      renderNav()
      const input = screen.getByRole('searchbox')
      await user.type(input, 'Sicilian')
      await waitFor(() => {
        expect(screen.getByTestId('search-overlay')).toBeInTheDocument()
      }, { timeout: 1000 })
    })

    it('overlay shows a result row for each matching course', async () => {
      const user = userEvent.setup({ delay: null })
      renderNav()
      await user.type(screen.getByRole('searchbox'), 'Sicilian')
      await waitFor(() => screen.getByTestId('search-overlay'))
      expect(screen.getByTestId('search-overlay-result-ov1')).toBeInTheDocument()
      expect(screen.getByTestId('search-overlay-result-ov1').textContent).toMatch(/Sicilian Defense/)
    })

    it('clicking an overlay result navigates to the course detail page', async () => {
      const user = userEvent.setup({ delay: null })
      renderNav()
      await user.type(screen.getByRole('searchbox'), 'Sicilian')
      await waitFor(() => screen.getByTestId('search-overlay-result-ov1'))
      await user.click(screen.getByTestId('search-overlay-result-ov1'))
      expect(mockNavigate).toHaveBeenCalledWith('/courses/ov1')
    })

    it('overlay hides when input is cleared', async () => {
      const user = userEvent.setup({ delay: null })
      renderNav()
      await user.type(screen.getByRole('searchbox'), 'Sicilian')
      await waitFor(() => screen.getByTestId('search-overlay'))
      await user.clear(screen.getByRole('searchbox'))
      await waitFor(() => {
        expect(screen.queryByTestId('search-overlay')).not.toBeInTheDocument()
      })
    })
  })

  // ── PRD-0005 D12c — unread-orders dot indicator ─────────────────────────
  //
  // Because email notifications are deferred (D-14), the dot on the
  // avatar-dropdown "Lịch sử đơn hàng" link is the only learner-facing
  // signal that an order has flipped to active/refunded/expired since
  // they last opened the page.
  describe('unread-orders dot indicator (PRD-0005 D12c)', () => {
    const loggedInUser = { email: 'user@example.com', id: '123', user_metadata: { name: 'John Doe' } }

    async function openDropdown() {
      await userEvent.click(screen.getByRole('button', { name: /hồ sơ/i }))
      await waitFor(() => screen.getByTestId('nav-orders-link'))
    }

    it('shows the dot on the orders link when hasUnreadOrderUpdates resolves true', async () => {
      mockHasUnreadOrderUpdates.mockResolvedValue({ hasUpdates: true, error: null })
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(mockHasUnreadOrderUpdates).toHaveBeenCalled()
      })
      await openDropdown()
      expect(screen.getByTestId('topnav-orders-dot')).toBeInTheDocument()
    })

    it('hides the dot when hasUnreadOrderUpdates resolves false', async () => {
      mockHasUnreadOrderUpdates.mockResolvedValue({ hasUpdates: false, error: null })
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(mockHasUnreadOrderUpdates).toHaveBeenCalled()
      })
      await openDropdown()
      expect(screen.queryByTestId('topnav-orders-dot')).not.toBeInTheDocument()
    })

    it('passes the value of readLastSeenOrdersAt as the since arg', async () => {
      mockReadLastSeenOrdersAt.mockReturnValue('2026-05-19T10:00:00Z')
      mockHasUnreadOrderUpdates.mockResolvedValue({ hasUpdates: false, error: null })
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(mockHasUnreadOrderUpdates).toHaveBeenCalledWith(
          expect.anything(),
          '2026-05-19T10:00:00Z'
        )
      })
    })

    it('does not run the unread query when the user is logged out', async () => {
      renderNav()
      // Allow any pending microtasks to resolve.
      await new Promise(r => setTimeout(r, 0))
      expect(mockHasUnreadOrderUpdates).not.toHaveBeenCalled()
    })

    it('clears the dot optimistically when the user clicks the orders link', async () => {
      mockHasUnreadOrderUpdates.mockResolvedValue({ hasUpdates: true, error: null })
      renderNav({ user: loggedInUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(mockHasUnreadOrderUpdates).toHaveBeenCalled()
      })
      await openDropdown()
      expect(screen.getByTestId('topnav-orders-dot')).toBeInTheDocument()
      await userEvent.click(screen.getByTestId('nav-orders-link'))
      expect(screen.queryByTestId('topnav-orders-dot')).not.toBeInTheDocument()
    })
  })
})
