import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import ProtectedAdminRoute from './ProtectedAdminRoute'
import { AuthContext } from '../../context/AuthContext'
import type { AuthContextValue } from '../../context/AuthContext'
import type { User } from '@supabase/supabase-js'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn(),
  },
}))

const stubAdmin = { id: 'admin-1', email: 'admin@test.com' } as User
const stubLearner = { id: 'learner-1', email: 'user@test.com' } as User

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

function renderRoute(ctx: Partial<AuthContextValue>, path = '/admin/users') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={makeCtx(ctx)}>
          <Routes>
            <Route path="/admin" element={<ProtectedAdminRoute />}>
              <Route path="*" element={<div data-testid="admin-content">Admin</div>} />
            </Route>
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('ProtectedAdminRoute', () => {
  it('shows loading spinner while auth is resolving', () => {
    renderRoute({ loading: true })
    expect(screen.getByTestId('admin-loading')).toBeInTheDocument()
  })

  it('shows loading spinner while profile is fetching', () => {
    renderRoute({ user: stubAdmin, loading: false, profileLoading: true })
    expect(screen.getByTestId('admin-loading')).toBeInTheDocument()
  })

  it('redirects unauthenticated user to /login', () => {
    renderRoute({ user: null, loading: false })
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  it('shows 403 page for learner role', () => {
    renderRoute({
      user: stubLearner,
      loading: false,
      profileLoading: false,
      profile: { id: 'learner-1', email: 'user@test.com', name: null, avatar_url: null, role: 'learner', created_at: '' },
    })
    expect(screen.getByTestId('forbidden-page')).toBeInTheDocument()
  })

  it('shows 403 page for coach role', () => {
    renderRoute({
      user: stubLearner,
      loading: false,
      profileLoading: false,
      profile: { id: 'learner-1', email: 'user@test.com', name: null, avatar_url: null, role: 'coach', created_at: '' },
    })
    expect(screen.getByTestId('forbidden-page')).toBeInTheDocument()
  })

  it('renders children for admin role', () => {
    renderRoute({
      user: stubAdmin,
      loading: false,
      profileLoading: false,
      profile: { id: 'admin-1', email: 'admin@test.com', name: 'Admin', avatar_url: null, role: 'admin', created_at: '' },
    })
    expect(screen.getByTestId('admin-content')).toBeInTheDocument()
  })
})
