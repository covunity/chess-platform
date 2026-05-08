import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminCreatorApplicationsPage from './AdminCreatorApplicationsPage'

const {
  mockListCreatorApplications,
  mockApproveCreatorApplication,
  mockRejectCreatorApplication,
} = vi.hoisted(() => ({
  mockListCreatorApplications: vi.fn(),
  mockApproveCreatorApplication: vi.fn(),
  mockRejectCreatorApplication: vi.fn(),
}))

vi.mock('../../lib/creatorApplicationApi', () => ({
  listCreatorApplications: mockListCreatorApplications,
  approveCreatorApplication: mockApproveCreatorApplication,
  rejectCreatorApplication: mockRejectCreatorApplication,
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const baseApp = {
  id: 'app-1',
  user_id: 'u-1',
  status: 'pending' as const,
  motivation: 'I want to teach openings to club players.',
  experience: 'I have an ELO of 2200 and coach weekly.',
  sample_url: 'https://example.com/sample',
  rejection_reason: null,
  created_at: '2026-05-07T10:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
  applicant: { id: 'u-1', name: 'Alice', email: 'alice@test.com' },
}

const secondApp = {
  ...baseApp,
  id: 'app-2',
  user_id: 'u-2',
  motivation: 'Different motivation here for variety',
  applicant: { id: 'u-2', name: 'Bob', email: 'bob@test.com' },
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminCreatorApplicationsPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminCreatorApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListCreatorApplications.mockResolvedValue({ applications: [baseApp, secondApp], error: null })
  })

  describe('list rendering + tabs', () => {
    it('shows pending tab as default and lists applications', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('application-row-app-1')).toBeInTheDocument()
        expect(screen.getByTestId('application-row-app-2')).toBeInTheDocument()
      })
      expect(mockListCreatorApplications).toHaveBeenCalledWith(expect.anything(), { status: 'pending' })
      expect(screen.getByTestId('status-tab-pending')).toHaveAttribute('aria-selected', 'true')
    })

    it('switches to approved tab and refetches', async () => {
      mockListCreatorApplications.mockResolvedValueOnce({ applications: [baseApp, secondApp], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))

      mockListCreatorApplications.mockResolvedValueOnce({
        applications: [{ ...baseApp, status: 'approved' as const }],
        error: null,
      })
      await userEvent.click(screen.getByTestId('status-tab-approved'))

      await waitFor(() => {
        expect(mockListCreatorApplications).toHaveBeenLastCalledWith(expect.anything(), { status: 'approved' })
      })
      expect(screen.getByTestId('status-tab-approved')).toHaveAttribute('aria-selected', 'true')
    })

    it('shows empty state when no applications match', async () => {
      mockListCreatorApplications.mockResolvedValue({ applications: [], error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('applications-empty')).toBeInTheDocument()
      })
    })

    it('shows select hint when nothing is selected', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      expect(screen.getByText(/chọn một đơn/i)).toBeInTheDocument()
    })
  })

  describe('detail pane', () => {
    it('shows applicant info, motivation, experience and sample URL when selected', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      const detail = await screen.findByTestId('application-detail')
      expect(detail).toHaveTextContent('Alice')
      expect(detail).toHaveTextContent('alice@test.com')
      expect(detail).toHaveTextContent(/teach openings/i)
      expect(detail).toHaveTextContent(/ELO of 2200/i)
      expect(screen.getByRole('link', { name: /example\.com\/sample/i })).toHaveAttribute(
        'href',
        'https://example.com/sample'
      )
    })

    it('does not show approve/reject buttons for non-pending applications', async () => {
      mockListCreatorApplications.mockResolvedValue({
        applications: [{ ...baseApp, status: 'approved' as const }],
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await screen.findByTestId('application-detail')
      expect(screen.queryByTestId('approve-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('reject-btn')).not.toBeInTheDocument()
    })

    it('shows rejection reason on rejected applications', async () => {
      mockListCreatorApplications.mockResolvedValue({
        applications: [
          { ...baseApp, status: 'rejected' as const, rejection_reason: 'Cần thêm portfolio' },
        ],
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await screen.findByTestId('application-detail')
      expect(screen.getByText(/cần thêm portfolio/i)).toBeInTheDocument()
    })
  })

  describe('approve flow', () => {
    it('calls approveCreatorApplication and removes row on success', async () => {
      mockApproveCreatorApplication.mockResolvedValue({
        application: { ...baseApp, status: 'approved' },
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await userEvent.click(screen.getByTestId('approve-btn'))

      await waitFor(() => {
        expect(mockApproveCreatorApplication).toHaveBeenCalledWith(expect.anything(), 'app-1')
        expect(screen.queryByTestId('application-row-app-1')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('application-row-app-2')).toBeInTheDocument()
    })

    it('shows action error when approve fails', async () => {
      mockApproveCreatorApplication.mockResolvedValue({ application: null, error: { message: 'fail' } })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await userEvent.click(screen.getByTestId('approve-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('action-error')).toHaveTextContent(/không thể duyệt/i)
      })
      // Row stays
      expect(screen.getByTestId('application-row-app-1')).toBeInTheDocument()
    })
  })

  describe('reject flow', () => {
    it('opens reason textarea on Reject click', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await userEvent.click(screen.getByTestId('reject-btn'))

      expect(screen.getByTestId('reject-reason')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-reject')).toBeInTheDocument()
    })

    it('blocks confirm when reason < 5 chars', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('reject-btn'))

      await userEvent.type(screen.getByTestId('reject-reason'), 'no')
      await userEvent.click(screen.getByTestId('confirm-reject'))

      expect(screen.getByTestId('action-error')).toHaveTextContent(/tối thiểu 5 ký tự/i)
      expect(mockRejectCreatorApplication).not.toHaveBeenCalled()
    })

    it('calls reject RPC with trimmed reason and removes row on success', async () => {
      mockRejectCreatorApplication.mockResolvedValue({
        application: { ...baseApp, status: 'rejected', rejection_reason: 'Cần thêm portfolio' },
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('reject-btn'))

      await userEvent.type(screen.getByTestId('reject-reason'), '   Cần thêm portfolio   ')
      await userEvent.click(screen.getByTestId('confirm-reject'))

      await waitFor(() => {
        expect(mockRejectCreatorApplication).toHaveBeenCalledWith(
          expect.anything(),
          'app-1',
          'Cần thêm portfolio'
        )
        expect(screen.queryByTestId('application-row-app-1')).not.toBeInTheDocument()
      })
    })

    it('cancel button closes the reason editor without calling RPC', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('reject-btn'))

      await userEvent.click(screen.getByRole('button', { name: /^hủy$/i }))

      expect(screen.queryByTestId('reject-reason')).not.toBeInTheDocument()
      expect(screen.getByTestId('reject-btn')).toBeInTheDocument()
      expect(mockRejectCreatorApplication).not.toHaveBeenCalled()
    })
  })
})
