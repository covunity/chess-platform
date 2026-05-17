import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminCreatorFeesPage from './AdminCreatorFeesPage'

const {
  mockListCreatorFees,
  mockSetCreatorFeeOverride,
  mockClearCreatorFeeOverride,
  mockSetCreatorLessonLimitOverride,
  mockClearCreatorLessonLimitOverride,
} = vi.hoisted(() => ({
  mockListCreatorFees: vi.fn(),
  mockSetCreatorFeeOverride: vi.fn(),
  mockClearCreatorFeeOverride: vi.fn(),
  mockSetCreatorLessonLimitOverride: vi.fn(),
  mockClearCreatorLessonLimitOverride: vi.fn(),
}))

vi.mock('../../lib/adminCreatorFeesApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/adminCreatorFeesApi')>(
    '../../lib/adminCreatorFeesApi'
  )
  return {
    ...actual,
    listCreatorFees: mockListCreatorFees,
    setCreatorFeeOverride: mockSetCreatorFeeOverride,
    clearCreatorFeeOverride: mockClearCreatorFeeOverride,
    setCreatorLessonLimitOverride: mockSetCreatorLessonLimitOverride,
    clearCreatorLessonLimitOverride: mockClearCreatorLessonLimitOverride,
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const alice = {
  user_id: 'u-alice',
  name: 'Alice',
  email: 'alice@x.io',
  account_tier_id: 'individual',
  tier_name_vi: 'Cá nhân',
  tier_fee_pct: 20,
  platform_fee_pct_override: null,
  effective_fee_pct: 20,
  tier_max_lessons: 30,
  max_lessons_per_course_override: null,
  effective_max_lessons: 30,
}
const bob = {
  user_id: 'u-bob',
  name: 'Bob',
  email: 'bob@x.io',
  account_tier_id: 'business',
  tier_name_vi: 'Doanh nghiệp',
  tier_fee_pct: 15,
  platform_fee_pct_override: 10,
  effective_fee_pct: 10,
  tier_max_lessons: 150,
  max_lessons_per_course_override: 200,
  effective_max_lessons: 200,
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminCreatorFeesPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminCreatorFeesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListCreatorFees.mockResolvedValue({ creators: [alice, bob], total: 2, error: null })
    mockSetCreatorFeeOverride.mockResolvedValue({
      user: { id: 'u-alice', platform_fee_pct_override: 12.5 },
      error: null,
    })
    mockClearCreatorFeeOverride.mockResolvedValue({
      user: { id: 'u-bob', platform_fee_pct_override: null },
      error: null,
    })
    mockSetCreatorLessonLimitOverride.mockResolvedValue({
      user: { id: 'u-alice', max_lessons_per_course_override: 100 },
      error: null,
    })
    mockClearCreatorLessonLimitOverride.mockResolvedValue({
      user: { id: 'u-bob', max_lessons_per_course_override: null },
      error: null,
    })
  })

  describe('initial render', () => {
    it('shows loading state on first mount', () => {
      mockListCreatorFees.mockReturnValue(new Promise(() => {}))
      renderPage()
      expect(screen.getByTestId('creator-fees-loading')).toBeInTheDocument()
    })

    it('lists creators with tier, override badge, and effective fee', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))

      const aliceRow = screen.getByTestId('creator-fees-row-u-alice')
      expect(aliceRow).toHaveTextContent('alice@x.io')
      expect(aliceRow).toHaveTextContent('Cá nhân')
      // Alice has no override → effective = tier fee (20%)
      expect(aliceRow).toHaveTextContent('20')
      expect(aliceRow).not.toHaveTextContent('Override')

      const bobRow = screen.getByTestId('creator-fees-row-u-bob')
      expect(bobRow).toHaveTextContent('bob@x.io')
      expect(bobRow).toHaveTextContent('Doanh nghiệp')
      // Bob: override=10%, tier=15% → effective=10%, badge visible
      expect(bobRow).toHaveTextContent('Override')
      expect(bobRow).toHaveTextContent('10')
    })

    it('shows empty state when no creators returned', async () => {
      mockListCreatorFees.mockResolvedValue({ creators: [], total: 0, error: null })
      renderPage()
      await waitFor(() => expect(screen.getByTestId('creator-fees-empty')).toBeInTheDocument())
    })

    it('shows error banner when the listing call fails', async () => {
      mockListCreatorFees.mockResolvedValue({ creators: [], total: 0, error: new Error('boom') })
      renderPage()
      await waitFor(() => expect(screen.getByTestId('creator-fees-error')).toBeInTheDocument())
    })
  })

  describe('search + filter', () => {
    it('refetches with the search term', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      mockListCreatorFees.mockClear()

      await userEvent.type(screen.getByTestId('creator-fees-search'), 'alice')

      await waitFor(() => {
        expect(mockListCreatorFees).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ search: 'alice' })
        )
      })
    })

    it('toggles "overrides only" filter and refetches', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      mockListCreatorFees.mockClear()

      await userEvent.click(screen.getByTestId('creator-fees-filter-overrides-only'))

      await waitFor(() => {
        expect(mockListCreatorFees).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ overrides_only: true })
        )
      })
    })
  })

  describe('set override flow', () => {
    it('opens the set-override modal when clicking Set on a row', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      await userEvent.click(screen.getByTestId('set-override-btn-u-alice'))
      expect(screen.getByTestId('creator-fees-modal')).toBeInTheDocument()
      // Modal shows the tier fee note for context
      expect(screen.getByTestId('creator-fees-modal')).toHaveTextContent(/20/)
    })

    it('rejects invalid input client-side (out of range)', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      await userEvent.click(screen.getByTestId('set-override-btn-u-alice'))

      await userEvent.type(screen.getByTestId('override-input'), '120')
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      expect(screen.getByTestId('modal-error')).toHaveTextContent(/0.{1,3}100/i)
      expect(mockSetCreatorFeeOverride).not.toHaveBeenCalled()
    })

    it('rejects empty input', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      await userEvent.click(screen.getByTestId('set-override-btn-u-alice'))
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      expect(screen.getByTestId('modal-error')).toBeInTheDocument()
      expect(mockSetCreatorFeeOverride).not.toHaveBeenCalled()
    })

    it('calls setCreatorFeeOverride RPC, closes modal, and refetches list', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      mockListCreatorFees.mockClear()

      await userEvent.click(screen.getByTestId('set-override-btn-u-alice'))
      await userEvent.type(screen.getByTestId('override-input'), '12.5')
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      await waitFor(() => {
        expect(mockSetCreatorFeeOverride).toHaveBeenCalledWith(
          expect.anything(),
          'u-alice',
          12.5
        )
      })
      // Modal should be dismissed
      await waitFor(() => {
        expect(screen.queryByTestId('creator-fees-modal')).not.toBeInTheDocument()
      })
      // List refetches
      expect(mockListCreatorFees).toHaveBeenCalled()
    })

    it('shows a save error and keeps the modal open when RPC fails', async () => {
      mockSetCreatorFeeOverride.mockResolvedValue({ user: null, error: new Error('forbidden') })
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))

      await userEvent.click(screen.getByTestId('set-override-btn-u-alice'))
      await userEvent.type(screen.getByTestId('override-input'), '12.5')
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      await waitFor(() => {
        expect(screen.getByTestId('modal-error')).toHaveTextContent(/không thể/i)
      })
      expect(screen.getByTestId('creator-fees-modal')).toBeInTheDocument()
    })
  })

  describe('clear override flow', () => {
    it('shows Clear button only for rows with an override', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      expect(screen.queryByTestId('clear-override-btn-u-alice')).not.toBeInTheDocument()
      expect(screen.getByTestId('clear-override-btn-u-bob')).toBeInTheDocument()
    })

    it('opens the clear-override modal and calls clearCreatorFeeOverride RPC on confirm', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-bob'))
      mockListCreatorFees.mockClear()

      await userEvent.click(screen.getByTestId('clear-override-btn-u-bob'))
      expect(screen.getByTestId('creator-fees-modal')).toBeInTheDocument()
      await userEvent.click(screen.getByTestId('modal-confirm-clear'))

      await waitFor(() => {
        expect(mockClearCreatorFeeOverride).toHaveBeenCalledWith(expect.anything(), 'u-bob')
      })
      await waitFor(() => {
        expect(screen.queryByTestId('creator-fees-modal')).not.toBeInTheDocument()
      })
      expect(mockListCreatorFees).toHaveBeenCalled()
    })
  })

  describe('lesson-limit override flow', () => {
    it('shows effective lessons + tier base + badge when override is set', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))

      // Alice: no override → effective = tier (30), no lesson override badge
      expect(screen.getByTestId('creator-fees-effective-lessons-u-alice')).toHaveTextContent('30')
      expect(screen.queryByTestId('creator-fees-lesson-override-badge-u-alice')).not.toBeInTheDocument()

      // Bob: override=200, tier=150 → effective=200, badge visible
      expect(screen.getByTestId('creator-fees-effective-lessons-u-bob')).toHaveTextContent('200')
      expect(screen.getByTestId('creator-fees-lesson-override-badge-u-bob')).toBeInTheDocument()
    })

    it('only renders Clear lesson button when override is set', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      expect(screen.queryByTestId('clear-lesson-override-btn-u-alice')).not.toBeInTheDocument()
      expect(screen.getByTestId('clear-lesson-override-btn-u-bob')).toBeInTheDocument()
    })

    it('rejects empty input on the lesson modal', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      await userEvent.click(screen.getByTestId('set-lesson-override-btn-u-alice'))
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      expect(screen.getByTestId('modal-error')).toBeInTheDocument()
      expect(mockSetCreatorLessonLimitOverride).not.toHaveBeenCalled()
    })

    it('rejects out-of-range / decimal inputs', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      await userEvent.click(screen.getByTestId('set-lesson-override-btn-u-alice'))

      await userEvent.type(screen.getByTestId('override-input'), '12.5')
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      expect(screen.getByTestId('modal-error')).toBeInTheDocument()
      expect(mockSetCreatorLessonLimitOverride).not.toHaveBeenCalled()
    })

    it('calls setCreatorLessonLimitOverride RPC, closes modal, and refetches list', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-alice'))
      mockListCreatorFees.mockClear()

      await userEvent.click(screen.getByTestId('set-lesson-override-btn-u-alice'))
      await userEvent.type(screen.getByTestId('override-input'), '120')
      await userEvent.click(screen.getByTestId('modal-confirm-save'))

      await waitFor(() => {
        expect(mockSetCreatorLessonLimitOverride).toHaveBeenCalledWith(
          expect.anything(),
          'u-alice',
          120
        )
      })
      await waitFor(() => {
        expect(screen.queryByTestId('creator-fees-modal')).not.toBeInTheDocument()
      })
      expect(mockListCreatorFees).toHaveBeenCalled()
    })

    it('opens the clear-lesson modal and calls clearCreatorLessonLimitOverride RPC on confirm', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('creator-fees-row-u-bob'))
      mockListCreatorFees.mockClear()

      await userEvent.click(screen.getByTestId('clear-lesson-override-btn-u-bob'))
      expect(screen.getByTestId('creator-fees-modal')).toBeInTheDocument()
      await userEvent.click(screen.getByTestId('modal-confirm-clear'))

      await waitFor(() => {
        expect(mockClearCreatorLessonLimitOverride).toHaveBeenCalledWith(expect.anything(), 'u-bob')
      })
      await waitFor(() => {
        expect(screen.queryByTestId('creator-fees-modal')).not.toBeInTheDocument()
      })
      expect(mockListCreatorFees).toHaveBeenCalled()
    })
  })
})
