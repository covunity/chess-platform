/**
 * ProfilePage tests — PRD-0004 Slice 11 (issue #198)
 *
 * Tests the "Trình soạn nâng cao" section with the editor_advanced toggle.
 */
import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import i18n from '../i18n'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { User } from '@supabase/supabase-js'
import ProfilePage from './ProfilePage'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
    storage: {
      from: () => ({
        upload: vi.fn(),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
        remove: vi.fn(),
      }),
    },
  },
}))

vi.mock('../lib/profileApi', () => ({
  updateProfileName: vi.fn().mockResolvedValue({ error: null }),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  updateEditorAdvanced: vi.fn().mockResolvedValue({ error: null }),
}))

const stubUser = { id: 'u-1', email: 'user@test.com' } as User

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'user@test.com',
    name: 'Test User',
    avatar_url: null,
    role: 'creator' as const,
    account_tier_id: 'individual' as const,
    created_at: '2026-01-01T00:00:00Z',
    editor_advanced: false,
    ...overrides,
  }
}

function makeCtx(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    user: stubUser,
    loading: false,
    profile: makeProfile(),
    profileLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    updateProfile: vi.fn(),
    ...overrides,
  }
}

function renderPage(ctx: Partial<AuthContextValue> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthContext.Provider value={makeCtx(ctx)}>
          <ProfilePage />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

// ── "Trình soạn nâng cao" section ─────────────────────────────────────────────

describe('ProfilePage — editor_advanced toggle', () => {
  it('renders the "Trình soạn nâng cao" section heading', () => {
    renderPage()
    expect(screen.getByTestId('editor-advanced-section')).toBeInTheDocument()
  })

  it('renders the editor_advanced checkbox', () => {
    renderPage()
    expect(screen.getByTestId('editor-advanced-checkbox')).toBeInTheDocument()
  })

  it('checkbox is unchecked when editor_advanced is false', () => {
    renderPage({ profile: makeProfile({ editor_advanced: false }) })
    expect(screen.getByTestId('editor-advanced-checkbox')).not.toBeChecked()
  })

  it('checkbox is checked when editor_advanced is true', () => {
    renderPage({ profile: makeProfile({ editor_advanced: true }) })
    expect(screen.getByTestId('editor-advanced-checkbox')).toBeChecked()
  })

  it('toggling calls updateEditorAdvanced with new value', async () => {
    const user = userEvent.setup()
    const updateProfile = vi.fn()
    renderPage({
      profile: makeProfile({ editor_advanced: false }),
      updateProfile,
    })
    await user.click(screen.getByTestId('editor-advanced-checkbox'))
    // updateProfile should be called with editor_advanced: true
    expect(updateProfile).toHaveBeenCalledWith({ editor_advanced: true })
  })

  it('renders the help text for the toggle', () => {
    renderPage()
    expect(screen.getByTestId('editor-advanced-help')).toBeInTheDocument()
  })
})
