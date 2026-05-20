import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, describe, it, expect } from 'vitest'
import { MemoryRouter, Route, Routes, useParams, useLocation } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import ConfirmPurchasePage from './ConfirmPurchasePage'
import * as coursesApi from '../lib/coursesApi'
import * as orderApi from '../lib/orderApi'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { CourseDetail } from '../lib/coursesApi'
import type { PurchasePreview, Order } from '../lib/orderApi'
import type { User } from '@supabase/supabase-js'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

const mockGetCourseDetail = vi.spyOn(coursesApi, 'getCourseDetail')
const mockCheckUserEnrollment = vi.spyOn(coursesApi, 'checkUserEnrollment')
const mockGetPendingOrderForCourse = vi.spyOn(orderApi, 'getPendingOrderForCourse')
const mockPreviewPurchase = vi.spyOn(orderApi, 'previewPurchase')
const mockCreateOrder = vi.spyOn(orderApi, 'createOrder')

const sampleCourse: CourseDetail = {
  id: 'c1',
  title: 'The Italian Game',
  description: 'Master the Italian.',
  thumbnail_url: null,
  price: 1_000_000,
  original_price: null,
  promo_ends_at: null,
  level: 'intermediate',
  language: 'vi',
  tags: ['openings'],
  creator_id: 'creator-1',
  creator_name: 'GM Anh Lê',
  creator_bio: null,
  rating_avg: 4.8,
  rating_count: 100,
  lessons_count: 20,
  hours_total: 4,
  enrollment_count: 500,
  created_at: '2026-01-01T00:00:00Z',
  what_you_learn: [],
  prerequisites: null,
  free_preview_count: 0,
  pgn_annotations_count: 0,
  puzzle_count: 0,
  chapters: [],
  reviews: [],
}

const previewNoCampaign: PurchasePreview = {
  original_price: 1_000_000,
  campaign_id: null,
  campaign_name: null,
  campaign_discount_amount: 0,
  voucher_id: null,
  voucher_code: null,
  voucher_discount_amount: 0,
  final_price: 1_000_000,
  platform_fee_pct: 20,
  platform_fee_amount: 200_000,
  creator_payout_amount: 800_000,
}

const previewWithCampaign: PurchasePreview = {
  original_price: 1_000_000,
  campaign_id: 'cmp-1',
  campaign_name: 'Tết Sale 2026',
  campaign_discount_amount: 200_000,
  voucher_id: null,
  voucher_code: null,
  voucher_discount_amount: 0,
  final_price: 800_000,
  platform_fee_pct: 20,
  platform_fee_amount: 160_000,
  creator_payout_amount: 640_000,
}

const noAuthContext: AuthContextValue = {
  user: null,
  loading: false,
  profile: null,
  profileLoading: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}

const loggedInContext: AuthContextValue = {
  ...noAuthContext,
  user: { id: 'u-1', email: 'learner@test.com' } as User,
  profile: {
    id: 'u-1',
    email: 'learner@test.com',
    name: 'Learner',
    avatar_url: null,
    role: 'learner',
    created_at: '2026-01-01T00:00:00Z',
  },
}

function CheckoutStub() {
  const { orderId } = useParams<{ orderId: string }>()
  return <div data-testid={`checkout-page-${orderId}`} />
}

function LearnStub() {
  const { courseId } = useParams<{ courseId: string }>()
  const location = useLocation()
  const toast = (location.state as { freeCourseToast?: boolean } | null)?.freeCourseToast
  return (
    <div data-testid={`learn-page-${courseId}`}>
      {toast && <span data-testid="free-course-toast">free</span>}
    </div>
  )
}

function renderPage(auth = loggedInContext) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/confirm-purchase/c1']}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route path="/confirm-purchase/:courseId" element={<ConfirmPurchasePage />} />
            <Route path="/courses/:courseId" element={<div data-testid="course-detail-page" />} />
            <Route path="/login" element={<div data-testid="login-page" />} />
            <Route path="/checkout/:orderId" element={<CheckoutStub />} />
            <Route path="/learn/:courseId" element={<LearnStub />} />
            <Route path="/learn/:courseId/:lessonId" element={<LearnStub />} />
          </Routes>
        </I18nextProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('ConfirmPurchasePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
    mockCheckUserEnrollment.mockResolvedValue(false)
    mockGetPendingOrderForCourse.mockResolvedValue({ order: null, error: null })
    mockPreviewPurchase.mockResolvedValue({ preview: previewNoCampaign, error: null })
    mockCreateOrder.mockResolvedValue({ order: null, error: null })
  })

  // ── Guard A: unauthenticated user → redirect to /login ─────────────────

  it('redirects unauthenticated users to /login', async () => {
    renderPage(noAuthContext)
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
  })

  // ── Guard B: course not found → 404 message ────────────────────────────

  it('shows not-found message when the course does not exist', async () => {
    mockGetCourseDetail.mockResolvedValue({ course: null, error: new Error('not found') })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('confirm-purchase-not-found')).toBeInTheDocument()
    })
  })

  // ── Guard C: already enrolled → redirect to /learn/:courseId ───────────

  it('redirects an already-enrolled learner to /learn/:courseId', async () => {
    mockCheckUserEnrollment.mockResolvedValue(true)
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('learn-page-c1')).toBeInTheDocument()
    })
  })

  // ── Guard D: pending order → redirect to /checkout/:existing ───────────

  it('redirects to existing pending order checkout', async () => {
    mockGetPendingOrderForCourse.mockResolvedValue({
      order: { id: 'ord-existing', code: 'ORD-2026-000001', status: 'pending', amount: 1_000_000 } as Order,
      error: null,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('checkout-page-ord-existing')).toBeInTheDocument()
    })
  })

  // ── Breakdown: no campaign ─────────────────────────────────────────────

  it('renders breakdown without a campaign row when no campaign is active', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('confirm-original-price')).toHaveTextContent(/1.000.000/)
      expect(screen.getByTestId('confirm-total-price')).toHaveTextContent(/1.000.000/)
    })
    expect(screen.queryByTestId('confirm-campaign-discount')).not.toBeInTheDocument()
  })

  // ── Breakdown: with campaign ───────────────────────────────────────────

  it('renders campaign discount row with name and amount', async () => {
    mockPreviewPurchase.mockResolvedValue({ preview: previewWithCampaign, error: null })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('confirm-campaign-discount')).toHaveTextContent(/200.000/)
      expect(screen.getByTestId('confirm-total-price')).toHaveTextContent(/800.000/)
    })
    expect(screen.getByTestId('confirm-campaign-name')).toHaveTextContent(/Tết Sale 2026/)
  })

  // ── Submit happy path: paid → /checkout/:newOrderId ────────────────────

  it('submits the order and navigates to /checkout/:newOrderId', async () => {
    const user = userEvent.setup()
    mockCreateOrder.mockResolvedValue({
      order: { id: 'ord-new', course_id: 'c1', user_id: 'u-1', status: 'pending' } as Order,
      error: null,
    })
    renderPage()
    await waitFor(() => screen.getByTestId('confirm-submit-btn'))
    await user.click(screen.getByTestId('confirm-submit-btn'))
    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledWith(expect.anything(), 'c1', null)
      expect(screen.getByTestId('checkout-page-ord-new')).toBeInTheDocument()
    })
  })

  // ── Free path: final_price = 0 → /learn/:courseId with toast ───────────

  it('redirects to /learn/:courseId with toast when final_price = 0 (free path)', async () => {
    const user = userEvent.setup()
    mockPreviewPurchase.mockResolvedValue({
      preview: { ...previewNoCampaign, original_price: 0, final_price: 0, platform_fee_amount: 0, creator_payout_amount: 0 },
      error: null,
    })
    mockCreateOrder.mockResolvedValue({
      order: { id: 'ord-free', course_id: 'c1', user_id: 'u-1', status: 'active' } as Order,
      error: null,
    })
    renderPage()
    await waitFor(() => screen.getByTestId('confirm-submit-btn'))
    await user.click(screen.getByTestId('confirm-submit-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('learn-page-c1')).toBeInTheDocument()
      expect(screen.getByTestId('free-course-toast')).toBeInTheDocument()
    })
  })

  // ── Duplicate pending order race ───────────────────────────────────────

  it('handles duplicate_pending_order by redirecting to the existing checkout', async () => {
    const user = userEvent.setup()
    mockCreateOrder.mockResolvedValue({
      order: null,
      error: { message: 'duplicate_pending_order:ord-race', code: 'P0001' } as unknown as Error,
    })
    renderPage()
    await waitFor(() => screen.getByTestId('confirm-submit-btn'))
    await user.click(screen.getByTestId('confirm-submit-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('checkout-page-ord-race')).toBeInTheDocument()
    })
  })

  // ── Back link → /courses/:courseId ─────────────────────────────────────

  it('renders a back link to the course detail page', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('confirm-back-link'))
    expect(screen.getByTestId('confirm-back-link')).toHaveAttribute('href', '/courses/c1')
  })
})
