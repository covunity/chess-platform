import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, beforeEach, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import PracticePage from './PracticePage'
import * as bookmarkApi from '../lib/bookmarkApi'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}))

const mockGetBookmarks = vi.spyOn(bookmarkApi, 'getBookmarks')
const mockDeleteBookmark = vi.spyOn(bookmarkApi, 'deleteBookmark')

const mockUser = {
  id: 'u1',
  email: 'test@example.com',
  user_metadata: { name: 'Test User' },
} as AuthContextValue['user']

const mockAuthValue: AuthContextValue = {
  user: mockUser,
  loading: false,
  profile: null,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}

const sampleBookmarks: bookmarkApi.BookmarkWithDetails[] = [
  {
    id: 'bm1',
    user_id: 'u1',
    lesson_id: 'l1',
    pgn_snapshot: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    created_at: '2026-05-07T10:00:00Z',
    lesson_title: 'The Opening',
    course_title: 'Italian Game Mastery',
    course_id: 'c1',
  },
  {
    id: 'bm2',
    user_id: 'u1',
    lesson_id: 'l2',
    pgn_snapshot: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    created_at: '2026-05-06T10:00:00Z',
    lesson_title: 'Italian Defense',
    course_title: 'Italian Game Mastery',
    course_id: 'c1',
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <AuthContext.Provider value={mockAuthValue}>
          <PracticePage />
        </AuthContext.Provider>
      </I18nextProvider>
    </MemoryRouter>
  )
}

describe('PracticePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows empty state when user has no bookmarks', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: [], error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('practice-empty-state')).toBeInTheDocument()
    })
  })

  it('shows bookmark count in hero when bookmarks exist', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: sampleBookmarks, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('practice-hero')).toBeInTheDocument()
    })
    expect(screen.getByTestId('practice-bookmark-count')).toBeInTheDocument()
  })

  it('renders a card for each bookmark', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: sampleBookmarks, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
      expect(screen.getByTestId('bookmark-card-bm2')).toBeInTheDocument()
    })
    expect(screen.getByText('The Opening')).toBeInTheDocument()
    expect(screen.getByText('Italian Defense')).toBeInTheDocument()
  })

  it('shows delete confirm dialog when trash button is clicked', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: [sampleBookmarks[0]], error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('delete-bookmark-bm1'))

    expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument()
  })

  it('removes the bookmark from the list after confirming delete', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: [sampleBookmarks[0]], error: null })
    mockDeleteBookmark.mockResolvedValue({ error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('delete-bookmark-bm1'))
    await userEvent.click(screen.getByTestId('delete-confirm-btn'))

    await waitFor(() => {
      expect(screen.queryByTestId('bookmark-card-bm1')).not.toBeInTheDocument()
    })
    expect(mockDeleteBookmark).toHaveBeenCalledWith(expect.anything(), 'bm1')
  })

  it('closes the dialog without deleting when cancel is clicked', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: [sampleBookmarks[0]], error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('delete-bookmark-bm1'))
    expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('delete-cancel-btn'))
    expect(screen.queryByTestId('delete-confirm-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
  })

  it('shows empty state after last bookmark is deleted', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: [sampleBookmarks[0]], error: null })
    mockDeleteBookmark.mockResolvedValue({ error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('delete-bookmark-bm1'))
    await userEvent.click(screen.getByTestId('delete-confirm-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('practice-empty-state')).toBeInTheDocument()
    })
  })

  it('each bookmark card links to the lesson player', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: [sampleBookmarks[0]], error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    const link = screen.getByTestId('bookmark-link-bm1')
    expect(link).toHaveAttribute('href', '/learn/c1/l1')
  })

  it('sorts bookmarks newest-first by default', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: sampleBookmarks, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    const cards = screen.getAllByTestId(/^bookmark-card-/)
    expect(cards[0]).toHaveAttribute('data-testid', 'bookmark-card-bm1')
    expect(cards[1]).toHaveAttribute('data-testid', 'bookmark-card-bm2')
  })

  it('reverses order when sort is toggled to Oldest', async () => {
    mockGetBookmarks.mockResolvedValue({ bookmarks: sampleBookmarks, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-card-bm1')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('sort-toggle'))

    const cards = screen.getAllByTestId(/^bookmark-card-/)
    expect(cards[0]).toHaveAttribute('data-testid', 'bookmark-card-bm2')
    expect(cards[1]).toHaveAttribute('data-testid', 'bookmark-card-bm1')
  })
})
