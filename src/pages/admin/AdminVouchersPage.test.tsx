import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminVouchersPage from './AdminVouchersPage'
import type { Voucher, VoucherUsage } from '../../lib/vouchersApi'
import type { CoursePickerRow } from '../../lib/campaignsApi'

const {
  mockListVouchers,
  mockCreateVoucher,
  mockUpdateVoucher,
  mockDeactivateVoucher,
  mockDeleteVoucher,
  mockGetVoucherUsages,
  mockListAdminCourses,
  mockListCampaigns,
} = vi.hoisted(() => ({
  mockListVouchers: vi.fn(),
  mockCreateVoucher: vi.fn(),
  mockUpdateVoucher: vi.fn(),
  mockDeactivateVoucher: vi.fn(),
  mockDeleteVoucher: vi.fn(),
  mockGetVoucherUsages: vi.fn(),
  mockListAdminCourses: vi.fn(),
  mockListCampaigns: vi.fn(),
}))

vi.mock('../../lib/vouchersApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/vouchersApi')>(
    '../../lib/vouchersApi'
  )
  return {
    ...actual,
    listVouchers: mockListVouchers,
    createVoucher: mockCreateVoucher,
    updateVoucher: mockUpdateVoucher,
    deactivateVoucher: mockDeactivateVoucher,
    deleteVoucher: mockDeleteVoucher,
    getVoucherUsages: mockGetVoucherUsages,
  }
})

vi.mock('../../lib/campaignsApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/campaignsApi')>(
    '../../lib/campaignsApi'
  )
  return {
    ...actual,
    listAdminCourses: mockListAdminCourses,
    listCampaigns: mockListCampaigns,
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const baseVoucher: Voucher = {
  id: 'v-1',
  code: 'WELCOME10',
  discount_type: 'percentage',
  discount_value: 10,
  max_discount_amount: null,
  applicable_courses: null,
  total_quota: 100,
  total_uses: 0,
  per_user_limit: 1,
  starts_at: '2026-02-01T00:00:00Z',
  ends_at: '2026-12-31T23:59:00Z',
  is_active: true,
  campaign_id: null,
  created_by: 'admin-1',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
}

const lockedVoucher: Voucher = {
  ...baseVoucher,
  id: 'v-2',
  code: 'USED50',
  total_uses: 12,
}

const courseList: CoursePickerRow[] = [
  { id: 'c-1', title: 'Khai cuộc Italy' },
  { id: 'c-2', title: 'Phòng thủ Sicilian' },
]

const sampleUsage: VoucherUsage = {
  id: 'u-1',
  voucher_id: 'v-1',
  user_id: 'usr-1',
  order_id: 'ord-1',
  discount_amount: 50000,
  used_at: '2026-05-01T00:00:00Z',
  user: { id: 'usr-1', email: 'alice@example.com', name: 'Alice', avatar_url: null },
  order: { id: 'ord-1', code: 'ORD-2026-000001' },
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminVouchersPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminVouchersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListVouchers.mockResolvedValue({ vouchers: [baseVoucher], error: null })
    mockListAdminCourses.mockResolvedValue({ courses: courseList, error: null })
    mockListCampaigns.mockResolvedValue({ campaigns: [], error: null })
    mockCreateVoucher.mockResolvedValue({ voucher: baseVoucher, error: null })
    mockUpdateVoucher.mockResolvedValue({ voucher: baseVoucher, error: null })
    mockDeactivateVoucher.mockResolvedValue({
      voucher: { ...baseVoucher, is_active: false },
      error: null,
    })
    mockDeleteVoucher.mockResolvedValue({ error: null })
    mockGetVoucherUsages.mockResolvedValue({ usages: [sampleUsage], error: null })
  })

  it('renders the page title and Create button', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/voucher/i)
    })
    expect(screen.getByTestId('admin-vouchers-create-btn')).toBeInTheDocument()
  })

  it('lists vouchers from the API', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-vouchers-row-v-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('admin-vouchers-row-v-1')).toHaveTextContent(/WELCOME10/)
  })

  it('filters by status when the dropdown changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-1'))
    const select = screen.getByTestId('admin-vouchers-status-filter')
    await user.selectOptions(select, 'inactive')
    await waitFor(() => {
      expect(mockListVouchers).toHaveBeenLastCalledWith(expect.anything(), {
        status: 'inactive',
        search: '',
      })
    })
  })

  it('searches by code (debounced)', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-1'))
    const search = screen.getByTestId('admin-vouchers-search')
    await user.type(search, 'WEL')
    await waitFor(() => {
      expect(mockListVouchers).toHaveBeenLastCalledWith(expect.anything(), {
        status: 'all',
        search: 'WEL',
      })
    })
  })

  it('opens the create modal when Create is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-create-btn'))
    await user.click(screen.getByTestId('admin-vouchers-create-btn'))
    expect(screen.getByTestId('admin-vouchers-form-dialog')).toBeInTheDocument()
  })

  it('submits the form via createVoucher when saving a new voucher', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-create-btn'))
    await user.click(screen.getByTestId('admin-vouchers-create-btn'))

    const dialog = screen.getByTestId('admin-vouchers-form-dialog')
    await user.type(within(dialog).getByTestId('voucher-code-input'), 'BLACK20')
    await user.type(within(dialog).getByTestId('voucher-discount-value-input'), '20')
    await user.type(within(dialog).getByTestId('voucher-total-quota-input'), '500')
    await user.type(
      within(dialog).getByTestId('voucher-starts-at-input'),
      '2026-11-25T00:00'
    )
    await user.type(
      within(dialog).getByTestId('voucher-ends-at-input'),
      '2026-11-30T23:59'
    )

    await user.click(within(dialog).getByTestId('admin-vouchers-save-btn'))

    await waitFor(() => {
      expect(mockCreateVoucher).toHaveBeenCalledTimes(1)
    })
    const call = mockCreateVoucher.mock.calls[0][1]
    expect(call.code).toBe('BLACK20')
    expect(call.discount_type).toBe('percentage')
    expect(call.discount_value).toBe(20)
    expect(call.total_quota).toBe(500)
    expect(call.per_user_limit).toBe(1)
    expect(call.applicable_courses).toBeNull()
  })

  it('shows the duplicate-code error when the RPC raises voucher_code_already_exists', async () => {
    const user = userEvent.setup()
    mockCreateVoucher.mockResolvedValue({
      voucher: null,
      error: { message: 'voucher_code_already_exists' } as Error,
    })
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-create-btn'))
    await user.click(screen.getByTestId('admin-vouchers-create-btn'))

    const dialog = screen.getByTestId('admin-vouchers-form-dialog')
    await user.type(within(dialog).getByTestId('voucher-code-input'), 'WELCOME10')
    await user.type(within(dialog).getByTestId('voucher-discount-value-input'), '10')
    await user.type(within(dialog).getByTestId('voucher-total-quota-input'), '100')
    await user.type(
      within(dialog).getByTestId('voucher-starts-at-input'),
      '2026-02-05T00:00'
    )
    await user.type(
      within(dialog).getByTestId('voucher-ends-at-input'),
      '2026-02-20T00:00'
    )
    await user.click(within(dialog).getByTestId('admin-vouchers-save-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('admin-vouchers-form-error')).toHaveTextContent(
        /đã tồn tại/i
      )
    })
  })

  it('validates code regex client-side before calling the RPC', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-create-btn'))
    await user.click(screen.getByTestId('admin-vouchers-create-btn'))

    const dialog = screen.getByTestId('admin-vouchers-form-dialog')
    await user.type(within(dialog).getByTestId('voucher-code-input'), 'abc!')
    await user.type(within(dialog).getByTestId('voucher-discount-value-input'), '10')
    await user.type(within(dialog).getByTestId('voucher-total-quota-input'), '100')
    await user.type(
      within(dialog).getByTestId('voucher-starts-at-input'),
      '2026-02-05T00:00'
    )
    await user.type(
      within(dialog).getByTestId('voucher-ends-at-input'),
      '2026-02-20T00:00'
    )
    await user.click(within(dialog).getByTestId('admin-vouchers-save-btn'))

    expect(mockCreateVoucher).not.toHaveBeenCalled()
    expect(screen.getByTestId('admin-vouchers-form-error')).toHaveTextContent(
      /6[–-]20 ký tự/i
    )
  })

  it('deactivates an active voucher via the row action', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-1'))
    await user.click(screen.getByTestId('admin-vouchers-deactivate-v-1'))
    await waitFor(() => {
      expect(mockDeactivateVoucher).toHaveBeenCalledWith(expect.anything(), 'v-1')
    })
  })

  it('deletes a voucher with no usage', async () => {
    const user = userEvent.setup()
    // confirm() is called before delete
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-1'))
    await user.click(screen.getByTestId('admin-vouchers-delete-v-1'))
    await waitFor(() => {
      expect(mockDeleteVoucher).toHaveBeenCalledWith(expect.anything(), 'v-1')
    })
    confirmSpy.mockRestore()
  })

  it('disables delete on a locked voucher (total_uses > 0)', async () => {
    mockListVouchers.mockResolvedValue({ vouchers: [lockedVoucher], error: null })
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-2'))
    const btn = screen.getByTestId('admin-vouchers-delete-v-2') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('opens the detail drawer when a row is clicked and shows usages', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-1'))
    await user.click(screen.getByTestId('admin-vouchers-row-open-v-1'))
    await waitFor(() => {
      expect(screen.getByTestId('admin-vouchers-drawer')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(mockGetVoucherUsages).toHaveBeenCalledWith(expect.anything(), 'v-1')
    })
    const drawer = screen.getByTestId('admin-vouchers-drawer')
    expect(drawer).toHaveTextContent(/alice@example.com/i)
    expect(drawer).toHaveTextContent(/ORD-2026-000001/)
  })

  it('disables critical fields when editing a locked voucher', async () => {
    const user = userEvent.setup()
    mockListVouchers.mockResolvedValue({ vouchers: [lockedVoucher], error: null })
    renderPage()
    await waitFor(() => screen.getByTestId('admin-vouchers-row-v-2'))
    await user.click(screen.getByTestId('admin-vouchers-edit-v-2'))

    const dialog = screen.getByTestId('admin-vouchers-form-dialog')
    expect(
      (within(dialog).getByTestId('voucher-code-input') as HTMLInputElement).disabled
    ).toBe(true)
    expect(
      (within(dialog).getByTestId('voucher-discount-value-input') as HTMLInputElement).disabled
    ).toBe(true)
    expect(
      (within(dialog).getByTestId('voucher-per-user-limit-input') as HTMLInputElement).disabled
    ).toBe(true)
  })
})
