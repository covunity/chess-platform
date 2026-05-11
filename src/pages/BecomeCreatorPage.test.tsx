import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import BecomeCreatorPage from './BecomeCreatorPage'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { User } from '@supabase/supabase-js'

const { mockGetMyLatestAccountApplication, mockSubmitAccountApplication } = vi.hoisted(() => ({
  mockGetMyLatestAccountApplication: vi.fn(),
  mockSubmitAccountApplication: vi.fn(),
}))

vi.mock('../lib/accountApplicationApi', () => ({
  getMyLatestAccountApplication: mockGetMyLatestAccountApplication,
  submitAccountApplication: mockSubmitAccountApplication,
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('../lib/pendingAccountApplication', () => ({
  savePendingAccountApplication: vi.fn(),
  getPendingAccountApplication: vi.fn(() => null),
  clearPendingAccountApplication: vi.fn(),
  getPendingApplicationFromUserMetadata: vi.fn(() => null),
  clearPendingApplicationFromMetadata: vi.fn(),
}))

vi.mock('../lib/accountTiers', () => ({
  useAccountTiers: vi.fn(() => ({
    tiers: [
      { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: false, display_order: 1 },
      { code: 'business', name_vi: 'Doanh nghiệp', platform_fee_pct: 15, max_chapters_per_course: 30, is_enterprise: true, requires_approval: true, display_order: 2 },
      { code: 'athlete', name_vi: 'Vận động viên', platform_fee_pct: 10, max_chapters_per_course: 15, is_enterprise: true, requires_approval: true, display_order: 3 },
      { code: 'training_center', name_vi: 'Trung tâm đào tạo', platform_fee_pct: 10, max_chapters_per_course: 50, is_enterprise: true, requires_approval: true, display_order: 4 },
    ],
    loading: false,
    getTier: vi.fn(),
  })),
}))

import {
  savePendingAccountApplication,
  getPendingAccountApplication,
  clearPendingAccountApplication,
  getPendingApplicationFromUserMetadata,
  clearPendingApplicationFromMetadata,
} from '../lib/pendingAccountApplication'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const stubUser = { id: 'u-1', email: 'user@test.com' } as User
const mockSignUp = vi.fn()

function makeCtx(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    user: null,
    loading: false,
    profile: null,
    profileLoading: false,
    signUp: mockSignUp,
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    updateProfile: vi.fn(),
    ...overrides,
  }
}

function profileFor(role: 'learner' | 'creator' | 'admin', tier: 'individual' | 'business' = 'individual') {
  return {
    id: 'u-1',
    email: 'user@test.com',
    name: 'Tester',
    avatar_url: null,
    role,
    account_tier_id: tier as import('../lib/accountTiers').AccountTierCode,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function renderPage(ctx: Partial<AuthContextValue>, initialPath = '/become-creator') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthContext.Provider value={makeCtx(ctx)}>
          <Routes>
            <Route path="/become-creator" element={<BecomeCreatorPage />} />
            <Route path="/register-business" element={<BecomeCreatorPage />} />
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            <Route path="/check-email" element={<div data-testid="check-email-page">Check Email</div>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

const sampleApp = {
  id: 'app-1',
  user_id: 'u-1',
  status: 'pending' as const,
  requested_tier_code: 'individual' as const,
  motivation: 'Tôi yêu cờ',
  experience: 'GM 2400',
  sample_url: null,
  metadata: {},
  rejection_reason: null,
  created_at: '2026-05-07T10:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
}

describe('BecomeCreatorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMyLatestAccountApplication.mockResolvedValue({ application: null, error: null })
    mockSubmitAccountApplication.mockResolvedValue({ id: 'app-1', error: null })
    ;(getPendingAccountApplication as ReturnType<typeof vi.fn>).mockReturnValue(null)
  })

  describe('auth gating', () => {
    it('shows loading skeleton while auth resolves', () => {
      renderPage({ loading: true })
      expect(screen.getByTestId('become-creator-loading')).toBeInTheDocument()
    })

    it('shows loading skeleton while profile fetches', () => {
      renderPage({ user: stubUser, profileLoading: true })
      expect(screen.getByTestId('become-creator-loading')).toBeInTheDocument()
    })

    it('shows anon combined form for unauthenticated user', () => {
      renderPage({ user: null, loading: false })
      expect(screen.getByTestId('anon-combined-form')).toBeInTheDocument()
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    })
  })

  describe('tier selector', () => {
    it('renders tier selector cards in the anon form', () => {
      renderPage({ user: null, loading: false })
      expect(screen.getByTestId('tier-card-individual')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-business')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-athlete')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-training_center')).toBeInTheDocument()
    })

    it('individual is selected by default', () => {
      renderPage({ user: null, loading: false })
      expect(screen.getByTestId('tier-card-individual')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('tier-card-business')).toHaveAttribute('aria-pressed', 'false')
    })

    it('pre-selects tier from URL param ?tier=athlete', () => {
      renderPage({ user: null, loading: false }, '/register-business?tier=athlete')
      expect(screen.getByTestId('tier-card-athlete')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('tier-card-individual')).toHaveAttribute('aria-pressed', 'false')
    })

    it('pre-selects tier from URL param ?tier=business', () => {
      renderPage({ user: null, loading: false }, '/register-business?tier=business')
      expect(screen.getByTestId('tier-card-business')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('tier-card-individual')).toHaveAttribute('aria-pressed', 'false')
    })

    it('switching to business tier hides name field (business_name is the display name)', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-business'))
      expect(screen.queryByTestId('field-name')).not.toBeInTheDocument()
      expect(screen.getByTestId('field-business-name')).toBeInTheDocument()
    })

    it('switching to athlete tier shows federation field', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-athlete'))
      expect(screen.getByTestId('field-federation-or-team')).toBeInTheDocument()
    })

    it('switching to training_center tier shows address and size fields', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-training_center'))
      expect(screen.getByTestId('field-center-address')).toBeInTheDocument()
      expect(screen.getByTestId('field-center-size')).toBeInTheDocument()
    })
  })

  describe('anon combined form - individual tier', () => {
    it('renders all 6 fields for individual tier', () => {
      renderPage({ user: null, loading: false })
      expect(screen.getByTestId('field-name')).toBeInTheDocument()
      expect(screen.getByTestId('field-email')).toBeInTheDocument()
      expect(screen.getByTestId('field-password')).toBeInTheDocument()
      expect(screen.getByTestId('field-motivation')).toBeInTheDocument()
      expect(screen.getByTestId('field-experience')).toBeInTheDocument()
      expect(screen.getByTestId('field-sample')).toBeInTheDocument()
    })

    it('shows error when name is empty on submit', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('anon-submit'))
      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('shows error when password < 6 chars', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), '123')
      await userEvent.click(screen.getByTestId('anon-submit'))
      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('saves to localStorage and calls signUp on valid submit', async () => {
      mockSignUp.mockResolvedValue({ error: null })
      renderPage({ user: null, loading: false })

      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(savePendingAccountApplication).toHaveBeenCalledWith(
          expect.objectContaining({ requested_tier_code: 'individual' })
        )
        expect(mockSignUp).toHaveBeenCalledWith('Alice', 'alice@test.com', 'secret123', expect.objectContaining({ pending_application: expect.objectContaining({ requested_tier_code: 'individual' }) }))
      })
    })

    it('redirects to /check-email after successful signUp', async () => {
      mockSignUp.mockResolvedValue({ error: null })
      renderPage({ user: null, loading: false })

      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/check-email')
      })
    })

    it('shows error but does NOT clear localStorage when signUp fails', async () => {
      mockSignUp.mockResolvedValue({ error: new Error('Email already registered') })
      renderPage({ user: null, loading: false })

      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      })
      expect(clearPendingAccountApplication).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  describe('anon combined form - business tier', () => {
    it('uses business_name as signUp display name (E-15)', async () => {
      mockSignUp.mockResolvedValue({ error: null })
      renderPage({ user: null, loading: false })

      await userEvent.click(screen.getByTestId('tier-card-business'))
      await userEvent.type(screen.getByTestId('field-business-name'), 'Chess Corp')
      await userEvent.type(screen.getByTestId('field-business-registration-no'), 'VN-123')
      await userEvent.type(screen.getByTestId('field-email'), 'corp@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith('Chess Corp', 'corp@test.com', 'secret123', expect.objectContaining({ pending_application: expect.objectContaining({ requested_tier_code: 'business' }) }))
        expect(savePendingAccountApplication).toHaveBeenCalledWith(
          expect.objectContaining({
            requested_tier_code: 'business',
            metadata: expect.objectContaining({
              business_name: 'Chess Corp',
              business_registration_no: 'VN-123',
            }),
          })
        )
      })
    })

    it('blocks submit when business_name is empty', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-business'))
      await userEvent.type(screen.getByTestId('field-email'), 'corp@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('blocks submit when business_registration_no is empty', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-business'))
      await userEvent.type(screen.getByTestId('field-business-name'), 'Chess Corp')
      await userEvent.type(screen.getByTestId('field-email'), 'corp@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSignUp).not.toHaveBeenCalled()
    })
  })

  describe('anon combined form - athlete tier', () => {
    it('blocks submit when federation_or_team is empty', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-athlete'))
      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.click(screen.getByTestId('anon-submit'))

      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('includes federation metadata on valid submit', async () => {
      mockSignUp.mockResolvedValue({ error: null })
      renderPage({ user: null, loading: false })

      await userEvent.click(screen.getByTestId('tier-card-athlete'))
      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.type(screen.getByTestId('field-federation-or-team'), 'FIDE Vietnam')
      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(savePendingAccountApplication).toHaveBeenCalledWith(
          expect.objectContaining({
            requested_tier_code: 'athlete',
            metadata: expect.objectContaining({ federation_or_team: 'FIDE Vietnam' }),
          })
        )
      })
    })
  })

  describe('anon combined form - training_center tier', () => {
    it('blocks submit when center_address is empty', async () => {
      renderPage({ user: null, loading: false })
      await userEvent.click(screen.getByTestId('tier-card-training_center'))
      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.type(screen.getByTestId('field-center-size'), '50')
      await userEvent.click(screen.getByTestId('anon-submit'))

      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('includes center metadata on valid submit', async () => {
      mockSignUp.mockResolvedValue({ error: null })
      renderPage({ user: null, loading: false })

      await userEvent.click(screen.getByTestId('tier-card-training_center'))
      await userEvent.type(screen.getByTestId('field-name'), 'Alice')
      await userEvent.type(screen.getByTestId('field-email'), 'alice@test.com')
      await userEvent.type(screen.getByTestId('field-password'), 'secret123')
      await userEvent.type(screen.getByTestId('field-center-address'), '123 Chess Street')
      await userEvent.type(screen.getByTestId('field-center-size'), '100')
      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(savePendingAccountApplication).toHaveBeenCalledWith(
          expect.objectContaining({
            requested_tier_code: 'training_center',
            metadata: expect.objectContaining({
              center_address: '123 Chess Street',
              center_size: 100,
            }),
          })
        )
      })
    })
  })

  describe('route alias /register-business', () => {
    it('renders the same form with pre-selected tier from ?tier param', () => {
      renderPage({ user: null, loading: false }, '/register-business?tier=athlete')
      expect(screen.getByTestId('anon-combined-form')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-athlete')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('field-federation-or-team')).toBeInTheDocument()
    })
  })

  describe('already-elevated states', () => {
    it('shows "already a creator" panel for admin role', () => {
      renderPage({ user: stubUser, profile: profileFor('admin') })
      expect(screen.getByRole('heading', { name: /bạn đã là creator\./i })).toBeInTheDocument()
    })

    it('shows "already enterprise" panel for creator with enterprise tier', () => {
      renderPage({ user: stubUser, profile: profileFor('creator', 'business') })
      expect(screen.getByTestId('already-enterprise-heading')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /mở creator studio/i })).toHaveAttribute('href', '/creator')
      expect(screen.queryByTestId('upgrade-form')).not.toBeInTheDocument()
    })
  })

  describe('creator individual tier upgrade path', () => {
    it('shows upgrade banner and upgrade form for creator with individual tier', async () => {
      renderPage({ user: stubUser, profile: profileFor('creator') })
      await waitFor(() => {
        expect(screen.getByTestId('upgrade-banner')).toBeInTheDocument()
        expect(screen.getByTestId('upgrade-form')).toBeInTheDocument()
      })
    })

    it('shows only enterprise tier cards in upgrade form (no individual)', async () => {
      renderPage({ user: stubUser, profile: profileFor('creator') })
      await waitFor(() => screen.getByTestId('upgrade-form'))
      expect(screen.queryByTestId('tier-card-individual')).not.toBeInTheDocument()
      expect(screen.getByTestId('tier-card-business')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-athlete')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-training_center')).toBeInTheDocument()
    })

    it('does NOT render learner application form for creator individual', async () => {
      renderPage({ user: stubUser, profile: profileFor('creator') })
      await waitFor(() => screen.getByTestId('upgrade-form'))
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })

    it('hides upgrade form and shows pending card when application is pending', async () => {
      mockGetMyLatestAccountApplication.mockResolvedValue({ application: sampleApp, error: null })
      renderPage({ user: stubUser, profile: profileFor('creator') })
      await waitFor(() => {
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('upgrade-form')).not.toBeInTheDocument()
    })

    it('calls submitAccountApplication and shows pending card after upgrade submit', async () => {
      mockGetMyLatestAccountApplication
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValueOnce({ application: sampleApp, error: null })

      renderPage({ user: stubUser, profile: profileFor('creator') })
      await waitFor(() => screen.getByTestId('upgrade-form'))

      await userEvent.type(screen.getByTestId('field-motivation'), 'I want to share my knowledge of openings with learners worldwide.')
      await userEvent.type(screen.getByTestId('field-experience'), 'I have played chess for over twenty years professionally.')
      await userEvent.click(screen.getByTestId('submit-application'))

      await waitFor(() => {
        expect(mockSubmitAccountApplication).toHaveBeenCalled()
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
    })
  })

  describe('learner authenticated form', () => {
    it('renders the application form with tier selector', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(screen.getByTestId('creator-application-form')).toBeInTheDocument()
      })
      expect(screen.getByTestId('tier-card-individual')).toBeInTheDocument()
      expect(screen.getByTestId('tier-card-business')).toBeInTheDocument()
    })

    it('does NOT render auth fields (name/email/password) for authenticated user', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))
      expect(screen.queryByTestId('field-name')).not.toBeInTheDocument()
      expect(screen.queryByTestId('field-email')).not.toBeInTheDocument()
      expect(screen.queryByTestId('field-password')).not.toBeInTheDocument()
    })

    it('submits with metadata when business tier is selected', async () => {
      mockGetMyLatestAccountApplication
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValueOnce({ application: sampleApp, error: null })

      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.click(screen.getByTestId('tier-card-business'))
      await userEvent.type(screen.getByTestId('field-business-name'), 'Chess Corp')
      await userEvent.type(screen.getByTestId('field-business-registration-no'), 'VN-123')
      await userEvent.type(screen.getByTestId('field-motivation'), 'I want to share my knowledge of openings with learners worldwide.')
      await userEvent.type(screen.getByTestId('field-experience'), 'I have played chess for over twenty years professionally.')
      await userEvent.click(screen.getByTestId('submit-application'))

      await waitFor(() => {
        expect(mockSubmitAccountApplication).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            requested_tier_code: 'business',
            metadata: expect.objectContaining({
              business_name: 'Chess Corp',
              business_registration_no: 'VN-123',
            }),
          })
        )
      })
    })

    it('blocks submit when business tier selected but business_name empty', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.click(screen.getByTestId('tier-card-business'))
      await userEvent.type(screen.getByTestId('field-motivation'), 'I want to share my knowledge of openings with learners worldwide.')
      await userEvent.type(screen.getByTestId('field-experience'), 'I have played chess for over twenty years professionally.')
      await userEvent.click(screen.getByTestId('submit-application'))

      expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      expect(mockSubmitAccountApplication).not.toHaveBeenCalled()
    })

    it('rejects submit when motivation < 20 chars', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.type(screen.getByTestId('field-motivation'), 'short')
      await userEvent.type(screen.getByTestId('field-experience'), 'I have played chess for over twenty years professionally.')
      await userEvent.click(screen.getByTestId('submit-application'))

      expect(screen.getByTestId('submit-error')).toHaveTextContent(/động lực/i)
      expect(mockSubmitAccountApplication).not.toHaveBeenCalled()
    })

    it('shows pending state after successful submission', async () => {
      mockGetMyLatestAccountApplication
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValueOnce({ application: sampleApp, error: null })

      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.type(screen.getByTestId('field-motivation'), 'I want to share my knowledge of openings with learners worldwide.')
      await userEvent.type(screen.getByTestId('field-experience'), 'I have played chess for over twenty years professionally.')
      await userEvent.click(screen.getByTestId('submit-application'))

      await waitFor(() => {
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })
  })

  describe('existing applications', () => {
    it('shows pending status card and hides form', async () => {
      mockGetMyLatestAccountApplication.mockResolvedValue({ application: sampleApp, error: null })
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })

    it('shows approved status card', async () => {
      mockGetMyLatestAccountApplication.mockResolvedValue({
        application: { ...sampleApp, status: 'approved' },
        error: null,
      })
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(screen.getByTestId('application-status-approved')).toBeInTheDocument()
      })
    })

    it('shows rejected status card AND allows resubmit', async () => {
      mockGetMyLatestAccountApplication.mockResolvedValue({
        application: { ...sampleApp, status: 'rejected', rejection_reason: 'Cần thêm kinh nghiệm' },
        error: null,
      })
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(screen.getByTestId('application-status-rejected')).toBeInTheDocument()
      })
      expect(screen.getByTestId('creator-application-form')).toBeInTheDocument()
      expect(screen.getByTestId('submit-application')).toHaveTextContent(/gửi lại đơn/i)
    })
  })

  describe('auto-submit from localStorage', () => {
    it('auto-submits pending application on mount when localStorage has payload', async () => {
      ;(getPendingAccountApplication as ReturnType<typeof vi.fn>).mockReturnValue({
        requested_tier_code: 'individual',
        motivation: 'Auto motivation',
        experience: 'Auto experience',
      })
      mockGetMyLatestAccountApplication
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValueOnce({ application: sampleApp, error: null })

      renderPage({ user: stubUser, profile: profileFor('learner') })

      await waitFor(() => {
        expect(mockSubmitAccountApplication).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ requested_tier_code: 'individual', motivation: 'Auto motivation' })
        )
      })
      await waitFor(() => {
        expect(clearPendingAccountApplication).toHaveBeenCalled()
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
    })

    it('skips auto-submit when user already has a pending application', async () => {
      ;(getPendingAccountApplication as ReturnType<typeof vi.fn>).mockReturnValue({
        requested_tier_code: 'individual',
      })
      mockGetMyLatestAccountApplication.mockResolvedValue({ application: sampleApp, error: null })

      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('application-status-pending'))
      expect(mockSubmitAccountApplication).not.toHaveBeenCalled()
    })

    it('calls submitAccountApplication exactly once under StrictMode double-mount', async () => {
      ;(getPendingAccountApplication as ReturnType<typeof vi.fn>).mockReturnValue({
        requested_tier_code: 'individual',
        motivation: 'StrictMode test motivation',
        experience: 'StrictMode test experience',
      })
      // StrictMode runs fetch twice: first is cancelled, second sets loading=false + app=null.
      // Third call is the post-submit refresh.
      mockGetMyLatestAccountApplication
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValue({ application: sampleApp, error: null })

      render(
        <StrictMode>
          <I18nextProvider i18n={i18n}>
            <MemoryRouter initialEntries={['/become-creator']}>
              <AuthContext.Provider value={makeCtx({ user: stubUser, profile: profileFor('learner') })}>
                <Routes>
                  <Route path="/become-creator" element={<BecomeCreatorPage />} />
                </Routes>
              </AuthContext.Provider>
            </MemoryRouter>
          </I18nextProvider>
        </StrictMode>
      )

      await waitFor(() => {
        expect(mockSubmitAccountApplication).toHaveBeenCalledTimes(1)
      })
    })

    it('auto-submits from user_metadata when localStorage is empty (cross-tab scenario)', async () => {
      // Simulate: localStorage is empty (different browser/tab) but user_metadata has the payload
      ;(getPendingAccountApplication as ReturnType<typeof vi.fn>).mockReturnValue(null)
      ;(getPendingApplicationFromUserMetadata as ReturnType<typeof vi.fn>).mockReturnValue({
        requested_tier_code: 'individual',
        motivation: 'Cross-tab motivation',
        experience: 'Cross-tab experience',
      })
      mockGetMyLatestAccountApplication
        .mockResolvedValueOnce({ application: null, error: null })
        .mockResolvedValueOnce({ application: sampleApp, error: null })
      mockSubmitAccountApplication.mockResolvedValue({ id: 'app-1', error: null })

      const userWithMeta = {
        ...stubUser,
        user_metadata: {
          pending_application: {
            requested_tier_code: 'individual',
            motivation: 'Cross-tab motivation',
            experience: 'Cross-tab experience',
            expires_at: Date.now() + 86400000,
          },
        },
      } as unknown as typeof stubUser

      renderPage({ user: userWithMeta, profile: profileFor('learner') })

      await waitFor(() => {
        expect(mockSubmitAccountApplication).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ requested_tier_code: 'individual', motivation: 'Cross-tab motivation' })
        )
      })
      await waitFor(() => {
        expect(clearPendingApplicationFromMetadata).toHaveBeenCalled()
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
    })

    it('passes pending_application to signUp extraData on anon form submit', async () => {
      mockSignUp.mockResolvedValue({ error: null })

      renderPage({ user: null, loading: false })

      await userEvent.type(screen.getByTestId('field-name'), 'Test User')
      await userEvent.type(screen.getByTestId('field-email'), 'test@example.com')
      await userEvent.type(screen.getByTestId('field-password'), 'password123')

      await userEvent.click(screen.getByTestId('anon-submit'))

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith(
          'Test User',
          'test@example.com',
          'password123',
          expect.objectContaining({
            pending_application: expect.objectContaining({ requested_tier_code: 'individual' }),
          })
        )
      })
    })
  })
})
