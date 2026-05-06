import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, describe, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminReportsPage from './AdminReportsPage'

const { mockListReportedComments, mockHideComment, mockDismissReports } = vi.hoisted(() => ({
  mockListReportedComments: vi.fn(),
  mockHideComment: vi.fn(),
  mockDismissReports: vi.fn(),
}))

vi.mock('../../lib/adminReportsApi', () => ({
  listReportedComments: mockListReportedComments,
  hideComment: mockHideComment,
  dismissReports: mockDismissReports,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {},
}))

const sampleReportedComment = {
  id: 'cmt-1',
  course_id: 'c1',
  author_id: 'u1',
  body: 'This is a bad comment with spam content.',
  is_hidden: false,
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
  author: { name: 'Người dùng A' },
  course: { title: 'Chess Basics' },
  reports: [
    { id: 'r1', reporter_id: 'u2', reason: 'spam', created_at: '2026-01-11T00:00:00Z', reporter: { name: 'User B' } },
    { id: 'r2', reporter_id: 'u3', reason: 'inappropriate', created_at: '2026-01-12T00:00:00Z', reporter: { name: 'User C' } },
  ],
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminReportsPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListReportedComments.mockResolvedValue({ comments: [], error: null })
    mockHideComment.mockResolvedValue({ error: null })
    mockDismissReports.mockResolvedValue({ error: null })
  })

  describe('empty state', () => {
    it('shows empty state message when no reports', async () => {
      mockListReportedComments.mockResolvedValue({ comments: [], error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('reports-empty')).toBeInTheDocument()
      })
    })
  })

  describe('reports list', () => {
    it('renders reported comment items in the queue', async () => {
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('report-item-cmt-1')).toBeInTheDocument()
      })
    })

    it('shows comment body excerpt in the queue card', async () => {
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/bad comment with spam/i)).toBeInTheDocument()
      })
    })

    it('shows report count for each comment', async () => {
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('report-count-cmt-1')).toBeInTheDocument()
      })
    })

    it('shows pending count pill in header', async () => {
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('pending-count-pill')).toBeInTheDocument()
      })
    })
  })

  describe('detail panel', () => {
    it('shows detail panel when a report item is clicked', async () => {
      const user = userEvent.setup()
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('report-item-cmt-1'))
      await user.click(screen.getByTestId('report-item-cmt-1'))
      await waitFor(() => {
        expect(screen.getByTestId('report-detail-panel')).toBeInTheDocument()
      })
    })

    it('shows full comment body in detail panel', async () => {
      const user = userEvent.setup()
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('report-item-cmt-1'))
      await user.click(screen.getByTestId('report-item-cmt-1'))
      await waitFor(() => {
        expect(screen.getByTestId('detail-comment-body')).toBeInTheDocument()
      })
    })

    it('shows reporters list in detail panel', async () => {
      const user = userEvent.setup()
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('report-item-cmt-1'))
      await user.click(screen.getByTestId('report-item-cmt-1'))
      await waitFor(() => {
        expect(screen.getByTestId('reporters-list')).toBeInTheDocument()
        expect(screen.getByText('User B')).toBeInTheDocument()
      })
    })

    it('clicking "Hide comment" calls hideComment with correct id', async () => {
      const user = userEvent.setup()
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('report-item-cmt-1'))
      await user.click(screen.getByTestId('report-item-cmt-1'))
      await waitFor(() => screen.getByTestId('hide-comment-btn'))
      await user.click(screen.getByTestId('hide-comment-btn'))
      await waitFor(() => {
        expect(mockHideComment).toHaveBeenCalledWith(expect.anything(), 'cmt-1')
      })
    })

    it('clicking "Dismiss reports" calls dismissReports with correct id', async () => {
      const user = userEvent.setup()
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('report-item-cmt-1'))
      await user.click(screen.getByTestId('report-item-cmt-1'))
      await waitFor(() => screen.getByTestId('dismiss-reports-btn'))
      await user.click(screen.getByTestId('dismiss-reports-btn'))
      await waitFor(() => {
        expect(mockDismissReports).toHaveBeenCalledWith(expect.anything(), 'cmt-1')
      })
    })

    it('hiding a comment removes it from the queue', async () => {
      const user = userEvent.setup()
      mockListReportedComments.mockResolvedValue({ comments: [sampleReportedComment], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('report-item-cmt-1'))
      await user.click(screen.getByTestId('report-item-cmt-1'))
      await waitFor(() => screen.getByTestId('hide-comment-btn'))
      await user.click(screen.getByTestId('hide-comment-btn'))
      await waitFor(() => {
        expect(screen.queryByTestId('report-item-cmt-1')).not.toBeInTheDocument()
      })
    })
  })
})
