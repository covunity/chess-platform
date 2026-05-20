import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminCampaignsPage from './AdminCampaignsPage'
import type { Campaign, CoursePickerRow } from '../../lib/campaignsApi'

const {
  mockListCampaigns,
  mockCreateCampaign,
  mockUpdateCampaign,
  mockDeactivateCampaign,
  mockListAdminCourses,
} = vi.hoisted(() => ({
  mockListCampaigns: vi.fn(),
  mockCreateCampaign: vi.fn(),
  mockUpdateCampaign: vi.fn(),
  mockDeactivateCampaign: vi.fn(),
  mockListAdminCourses: vi.fn(),
}))

vi.mock('../../lib/campaignsApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/campaignsApi')>(
    '../../lib/campaignsApi'
  )
  return {
    ...actual,
    listCampaigns: mockListCampaigns,
    createCampaign: mockCreateCampaign,
    updateCampaign: mockUpdateCampaign,
    deactivateCampaign: mockDeactivateCampaign,
    listAdminCourses: mockListAdminCourses,
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const sampleCampaign: Campaign = {
  id: 'cmp-1',
  name: 'Tết Sale 2026',
  description: null,
  discount_type: 'percentage',
  discount_value: 20,
  max_discount_amount: null,
  applicable_courses: null,
  starts_at: '2026-02-01T00:00:00Z',
  ends_at: '2026-02-15T00:00:00Z',
  is_active: true,
  created_by: 'admin-1',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
}

const courseList: CoursePickerRow[] = [
  { id: 'c-1', title: 'Khai cuộc Italy' },
  { id: 'c-2', title: 'Phòng thủ Sicilian' },
]

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminCampaignsPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminCampaignsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListCampaigns.mockResolvedValue({ campaigns: [sampleCampaign], error: null })
    mockListAdminCourses.mockResolvedValue({ courses: courseList, error: null })
    mockCreateCampaign.mockResolvedValue({ campaign: sampleCampaign, error: null })
    mockUpdateCampaign.mockResolvedValue({ campaign: sampleCampaign, error: null })
    mockDeactivateCampaign.mockResolvedValue({
      campaign: { ...sampleCampaign, is_active: false },
      error: null,
    })
  })

  it('renders the page title and Create button', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/chiến dịch/i)
    })
    expect(screen.getByTestId('admin-campaigns-create-btn')).toBeInTheDocument()
  })

  it('lists campaigns from the API', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-campaigns-row-cmp-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('admin-campaigns-row-cmp-1')).toHaveTextContent(
      /Tết Sale 2026/
    )
  })

  it('filters by status when the dropdown changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-row-cmp-1'))
    const select = screen.getByTestId('admin-campaigns-status-filter')
    await user.selectOptions(select, 'inactive')
    await waitFor(() => {
      expect(mockListCampaigns).toHaveBeenLastCalledWith(expect.anything(), {
        status: 'inactive',
        search: '',
      })
    })
  })

  it('searches by name (debounced)', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-row-cmp-1'))
    const search = screen.getByTestId('admin-campaigns-search')
    await user.type(search, 'Tết')
    await waitFor(() => {
      expect(mockListCampaigns).toHaveBeenLastCalledWith(expect.anything(), {
        status: 'all',
        search: 'Tết',
      })
    })
  })

  it('opens the create modal when Create is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-create-btn'))
    await user.click(screen.getByTestId('admin-campaigns-create-btn'))
    expect(screen.getByTestId('admin-campaigns-form-dialog')).toBeInTheDocument()
  })

  it('submits the form via createCampaign when saving a new campaign', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-create-btn'))
    await user.click(screen.getByTestId('admin-campaigns-create-btn'))

    const dialog = screen.getByTestId('admin-campaigns-form-dialog')
    await user.type(within(dialog).getByTestId('campaign-name-input'), 'Black Friday')
    await user.type(within(dialog).getByTestId('campaign-discount-value-input'), '30')
    await user.type(
      within(dialog).getByTestId('campaign-starts-at-input'),
      '2026-11-25T00:00'
    )
    await user.type(
      within(dialog).getByTestId('campaign-ends-at-input'),
      '2026-11-30T23:59'
    )

    await user.click(within(dialog).getByTestId('admin-campaigns-save-btn'))

    await waitFor(() => {
      expect(mockCreateCampaign).toHaveBeenCalledTimes(1)
    })
    const call = mockCreateCampaign.mock.calls[0][1]
    expect(call.name).toBe('Black Friday')
    expect(call.discount_type).toBe('percentage')
    expect(call.discount_value).toBe(30)
    expect(call.applicable_courses).toBeNull()
  })

  it('shows the overlap error when the RPC raises campaign_overlap_with_existing', async () => {
    const user = userEvent.setup()
    mockCreateCampaign.mockResolvedValue({
      campaign: null,
      error: { message: 'campaign_overlap_with_existing' } as Error,
    })
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-create-btn'))
    await user.click(screen.getByTestId('admin-campaigns-create-btn'))

    const dialog = screen.getByTestId('admin-campaigns-form-dialog')
    await user.type(within(dialog).getByTestId('campaign-name-input'), 'Overlap')
    await user.type(within(dialog).getByTestId('campaign-discount-value-input'), '10')
    await user.type(
      within(dialog).getByTestId('campaign-starts-at-input'),
      '2026-02-05T00:00'
    )
    await user.type(
      within(dialog).getByTestId('campaign-ends-at-input'),
      '2026-02-20T00:00'
    )
    await user.click(within(dialog).getByTestId('admin-campaigns-save-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('admin-campaigns-form-error')).toHaveTextContent(
        /Khoảng thời gian này đã có chiến dịch khác/
      )
    })
  })

  it('validates ends_at > starts_at before calling the RPC', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-create-btn'))
    await user.click(screen.getByTestId('admin-campaigns-create-btn'))

    const dialog = screen.getByTestId('admin-campaigns-form-dialog')
    await user.type(within(dialog).getByTestId('campaign-name-input'), 'Bad dates')
    await user.type(within(dialog).getByTestId('campaign-discount-value-input'), '10')
    await user.type(
      within(dialog).getByTestId('campaign-starts-at-input'),
      '2026-03-10T00:00'
    )
    await user.type(
      within(dialog).getByTestId('campaign-ends-at-input'),
      '2026-03-01T00:00'
    )
    await user.click(within(dialog).getByTestId('admin-campaigns-save-btn'))

    expect(mockCreateCampaign).not.toHaveBeenCalled()
    expect(screen.getByTestId('admin-campaigns-form-error')).toHaveTextContent(
      /kết thúc phải sau/i
    )
  })

  it('deactivates an active campaign via the row action', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-campaigns-row-cmp-1'))
    await user.click(screen.getByTestId('admin-campaigns-deactivate-cmp-1'))
    await waitFor(() => {
      expect(mockDeactivateCampaign).toHaveBeenCalledWith(expect.anything(), 'cmp-1')
    })
  })
})
