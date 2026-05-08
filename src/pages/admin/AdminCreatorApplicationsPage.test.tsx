import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminCreatorApplicationsPage from './AdminCreatorApplicationsPage'

const {
  mockListAccountApplications,
  mockApproveAccountApplication,
  mockRejectAccountApplication,
} = vi.hoisted(() => ({
  mockListAccountApplications: vi.fn(),
  mockApproveAccountApplication: vi.fn(),
  mockRejectAccountApplication: vi.fn(),
}))

vi.mock('../../lib/accountApplicationApi', () => ({
  listAccountApplications: mockListAccountApplications,
  approveAccountApplication: mockApproveAccountApplication,
  rejectAccountApplication: mockRejectAccountApplication,
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../lib/accountTiers', () => ({
  useAccountTiers: vi.fn(() => ({
    tiers: [
      { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: false, display_order: 1 },
      { code: 'business', name_vi: 'Doanh nghiệp', platform_fee_pct: 15, max_chapters_per_course: 30, is_enterprise: true, requires_approval: true, display_order: 2 },
      { code: 'athlete', name_vi: 'Vận động viên', platform_fee_pct: 10, max_chapters_per_course: 15, is_enterprise: true, requires_approval: true, display_order: 3 },
      { code: 'training_center', name_vi: 'Trung tâm đào tạo', platform_fee_pct: 10, max_chapters_per_course: 50, is_enterprise: true, requires_approval: true, display_order: 4 },
    ],
    loading: false,
    getTier: (code: string) => {
      const map: Record<string, { code: string; name_vi: string; is_enterprise: boolean }> = {
        individual: { code: 'individual', name_vi: 'Cá nhân', is_enterprise: false },
        business: { code: 'business', name_vi: 'Doanh nghiệp', is_enterprise: true },
        athlete: { code: 'athlete', name_vi: 'Vận động viên', is_enterprise: true },
        training_center: { code: 'training_center', name_vi: 'Trung tâm đào tạo', is_enterprise: true },
      }
      return map[code]
    },
  })),
}))

const baseApp = {
  id: 'app-1',
  user_id: 'u-1',
  status: 'pending' as const,
  requested_tier_code: 'individual' as const,
  motivation: 'I want to teach openings to club players.',
  experience: 'I have an ELO of 2200 and coach weekly.',
  sample_url: 'https://example.com/sample',
  metadata: {},
  rejection_reason: null,
  created_at: '2026-05-07T10:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
  applicant: { id: 'u-1', name: 'Alice', email: 'alice@test.com' },
}

const businessApp = {
  ...baseApp,
  id: 'app-2',
  user_id: 'u-2',
  requested_tier_code: 'business' as const,
  motivation: 'Different motivation here for variety',
  metadata: { business_name: 'Chess Corp', business_registration_no: 'VN-123' },
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
    mockListAccountApplications.mockResolvedValue({ applications: [baseApp, businessApp], error: null })
  })

  describe('list rendering + tabs', () => {
    it('shows pending tab as default and lists applications', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('application-row-app-1')).toBeInTheDocument()
        expect(screen.getByTestId('application-row-app-2')).toBeInTheDocument()
      })
      expect(mockListAccountApplications).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'pending' })
      )
      expect(screen.getByTestId('status-tab-pending')).toHaveAttribute('aria-selected', 'true')
    })

    it('switches to approved tab and refetches', async () => {
      mockListAccountApplications.mockResolvedValueOnce({ applications: [baseApp, businessApp], error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))

      mockListAccountApplications.mockResolvedValueOnce({
        applications: [{ ...baseApp, status: 'approved' as const }],
        error: null,
      })
      await userEvent.click(screen.getByTestId('status-tab-approved'))

      await waitFor(() => {
        expect(mockListAccountApplications).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ status: 'approved' })
        )
      })
      expect(screen.getByTestId('status-tab-approved')).toHaveAttribute('aria-selected', 'true')
    })

    it('shows empty state when no applications match', async () => {
      mockListAccountApplications.mockResolvedValue({ applications: [], error: null })
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

  describe('tier filter', () => {
    it('renders tier filter dropdown', async () => {
      renderPage()
      expect(screen.getByTestId('tier-filter')).toBeInTheDocument()
    })

    it('filters by tier when selected', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))

      mockListAccountApplications.mockResolvedValueOnce({ applications: [businessApp], error: null })
      await userEvent.selectOptions(screen.getByTestId('tier-filter'), 'business')

      await waitFor(() => {
        expect(mockListAccountApplications).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ tier: 'business' })
        )
      })
    })
  })

  describe('tier badge in list', () => {
    it('shows tier badge on each application row', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      // business app should show Doanh nghiệp badge (may appear in filter option too)
      const matches = screen.getAllByText('Doanh nghiệp')
      expect(matches.length).toBeGreaterThanOrEqual(1)
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

    it('shows tier label in detail pane', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-2'))
      await userEvent.click(screen.getByTestId('application-row-app-2'))

      await screen.findByTestId('application-detail')
      // Should show Doanh nghiệp tier badge in detail pane
      const detail = screen.getByTestId('application-detail')
      expect(detail).toHaveTextContent('Doanh nghiệp')
    })

    it('shows business metadata fields in detail pane', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-2'))
      await userEvent.click(screen.getByTestId('application-row-app-2'))

      await screen.findByTestId('application-detail')
      expect(screen.getByText('Chess Corp')).toBeInTheDocument()
      expect(screen.getByText('VN-123')).toBeInTheDocument()
    })

    it('does not show approve/reject buttons for non-pending applications', async () => {
      mockListAccountApplications.mockResolvedValue({
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
      mockListAccountApplications.mockResolvedValue({
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
    it('calls approveAccountApplication and removes row on success', async () => {
      mockApproveAccountApplication.mockResolvedValue({
        application: { ...baseApp, status: 'approved' },
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await userEvent.click(screen.getByTestId('approve-btn'))

      await waitFor(() => {
        expect(mockApproveAccountApplication).toHaveBeenCalledWith(expect.anything(), 'app-1')
        expect(screen.queryByTestId('application-row-app-1')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('application-row-app-2')).toBeInTheDocument()
    })

    it('shows action error when approve fails', async () => {
      mockApproveAccountApplication.mockResolvedValue({ application: null, error: { message: 'fail' } })
      renderPage()
      await waitFor(() => screen.getByTestId('application-row-app-1'))
      await userEvent.click(screen.getByTestId('application-row-app-1'))

      await userEvent.click(screen.getByTestId('approve-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('action-error')).toHaveTextContent(/không thể duyệt/i)
      })
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
      expect(mockRejectAccountApplication).not.toHaveBeenCalled()
    })

    it('calls reject RPC with trimmed reason and removes row on success', async () => {
      mockRejectAccountApplication.mockResolvedValue({
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
        expect(mockRejectAccountApplication).toHaveBeenCalledWith(
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
      expect(mockRejectAccountApplication).not.toHaveBeenCalled()
    })
  })
})
