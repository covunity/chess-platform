import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import BecomeCreatorPage from './BecomeCreatorPage'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { User } from '@supabase/supabase-js'

const { mockGetMyLatestApplication, mockSubmitCreatorApplication } = vi.hoisted(() => ({
  mockGetMyLatestApplication: vi.fn(),
  mockSubmitCreatorApplication: vi.fn(),
}))

vi.mock('../lib/creatorApplicationApi', () => ({
  getMyLatestApplication: mockGetMyLatestApplication,
  submitCreatorApplication: mockSubmitCreatorApplication,
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))

const stubUser = { id: 'u-1', email: 'user@test.com' } as User

function makeCtx(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    user: null,
    loading: false,
    profile: null,
    profileLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function profileFor(role: 'learner' | 'creator' | 'admin') {
  return {
    id: 'u-1',
    email: 'user@test.com',
    name: 'Tester',
    avatar_url: null,
    role,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function renderPage(ctx: Partial<AuthContextValue>) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/become-creator']}>
        <AuthContext.Provider value={makeCtx(ctx)}>
          <Routes>
            <Route path="/become-creator" element={<BecomeCreatorPage />} />
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
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
  motivation: 'Tôi yêu cờ',
  experience: 'GM 2400',
  sample_url: null,
  rejection_reason: null,
  created_at: '2026-05-07T10:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
}

describe('BecomeCreatorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMyLatestApplication.mockResolvedValue({ application: null, error: null })
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

    it('shows landing with login + signup CTA for unauthenticated user', () => {
      renderPage({ user: null, loading: false })
      // Landing renders, NOT a redirect to /login
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
      const cta = screen.getByTestId('anon-login-cta')
      expect(cta).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /đăng nhập để gửi đơn/i })).toHaveAttribute(
        'href',
        '/login'
      )
      expect(screen.getByRole('link', { name: /tạo tài khoản/i })).toHaveAttribute(
        'href',
        '/signup'
      )
      // No form for anon
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })
  })

  describe('already-elevated states', () => {
    it('shows "already a creator" panel for creator role', () => {
      renderPage({ user: stubUser, profile: profileFor('creator') })
      expect(screen.getByRole('heading', { name: /bạn đã là creator/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /mở creator studio/i })).toHaveAttribute('href', '/creator')
      // No form should render
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })

    it('shows "already a creator" panel for admin role', () => {
      renderPage({ user: stubUser, profile: profileFor('admin') })
      expect(screen.getByRole('heading', { name: /bạn đã là creator/i })).toBeInTheDocument()
    })
  })

  describe('learner with no prior application', () => {
    it('renders the application form', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => {
        expect(screen.getByTestId('creator-application-form')).toBeInTheDocument()
      })
      expect(screen.getByTestId('field-motivation')).toBeInTheDocument()
      expect(screen.getByTestId('field-experience')).toBeInTheDocument()
      expect(screen.getByTestId('field-sample')).toBeInTheDocument()
    })

    it('rejects submit when motivation < 20 chars', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.type(screen.getByTestId('field-motivation'), 'short')
      await userEvent.type(
        screen.getByTestId('field-experience'),
        'I have played chess for over twenty years professionally.'
      )
      await userEvent.click(screen.getByTestId('submit-application'))

      expect(screen.getByTestId('submit-error')).toHaveTextContent(/động lực/i)
      expect(mockSubmitCreatorApplication).not.toHaveBeenCalled()
    })

    it('rejects submit when experience < 20 chars', async () => {
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.type(
        screen.getByTestId('field-motivation'),
        'I want to share my knowledge of openings with learners worldwide.'
      )
      await userEvent.type(screen.getByTestId('field-experience'), 'GM')
      await userEvent.click(screen.getByTestId('submit-application'))

      expect(screen.getByTestId('submit-error')).toHaveTextContent(/kinh nghiệm/i)
      expect(mockSubmitCreatorApplication).not.toHaveBeenCalled()
    })

    it('submits and shows pending state on success', async () => {
      mockSubmitCreatorApplication.mockResolvedValue({ application: sampleApp, error: null })
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.type(
        screen.getByTestId('field-motivation'),
        'I want to share my knowledge of openings with learners worldwide.'
      )
      await userEvent.type(
        screen.getByTestId('field-experience'),
        'I have played chess for over twenty years professionally.'
      )
      await userEvent.click(screen.getByTestId('submit-application'))

      await waitFor(() => {
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
      // Form is hidden once an application is pending
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
      expect(mockSubmitCreatorApplication).toHaveBeenCalledWith(
        expect.anything(),
        'u-1',
        expect.objectContaining({
          motivation: expect.stringContaining('share my knowledge'),
          experience: expect.stringContaining('twenty years'),
        })
      )
    })

    it('shows generic error when submit fails', async () => {
      mockSubmitCreatorApplication.mockResolvedValue({ application: null, error: { message: 'fail' } })
      renderPage({ user: stubUser, profile: profileFor('learner') })
      await waitFor(() => screen.getByTestId('creator-application-form'))

      await userEvent.type(
        screen.getByTestId('field-motivation'),
        'I want to share my knowledge of openings with learners worldwide.'
      )
      await userEvent.type(
        screen.getByTestId('field-experience'),
        'I have played chess for over twenty years professionally.'
      )
      await userEvent.click(screen.getByTestId('submit-application'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toHaveTextContent(/không thể gửi/i)
      })
    })
  })

  describe('learner with existing application', () => {
    it('shows pending status card and hides form', async () => {
      mockGetMyLatestApplication.mockResolvedValue({ application: sampleApp, error: null })
      renderPage({ user: stubUser, profile: profileFor('learner') })

      await waitFor(() => {
        expect(screen.getByTestId('application-status-pending')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })

    it('shows approved status card', async () => {
      mockGetMyLatestApplication.mockResolvedValue({
        application: { ...sampleApp, status: 'approved' },
        error: null,
      })
      renderPage({ user: stubUser, profile: profileFor('learner') })

      await waitFor(() => {
        expect(screen.getByTestId('application-status-approved')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('creator-application-form')).not.toBeInTheDocument()
    })

    it('shows rejected status card AND allows resubmit', async () => {
      mockGetMyLatestApplication.mockResolvedValue({
        application: { ...sampleApp, status: 'rejected', rejection_reason: 'Cần thêm kinh nghiệm' },
        error: null,
      })
      renderPage({ user: stubUser, profile: profileFor('learner') })

      await waitFor(() => {
        expect(screen.getByTestId('application-status-rejected')).toBeInTheDocument()
      })
      expect(screen.getByText(/cần thêm kinh nghiệm/i)).toBeInTheDocument()
      expect(screen.getByTestId('creator-application-form')).toBeInTheDocument()
      expect(screen.getByTestId('submit-application')).toHaveTextContent(/gửi lại đơn/i)
    })
  })
})
