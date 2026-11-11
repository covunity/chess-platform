import { render, screen, waitFor, act } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

const { mockGetSession, mockOnAuthStateChange, mockSignUp, mockSignInWithPassword,
        mockSignOut, mockResetPasswordForEmail, mockUpdateUser, mockFrom } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockSignUp: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockSignOut: vi.fn(),
  mockResetPasswordForEmail: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
    },
    from: mockFrom,
  },
}))

function TestConsumer() {
  const { user, loading, signUp, signIn, signOut, resetPassword, updatePassword } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.email : 'null'}</span>
      <button onClick={() => signUp('Test User', 'test@example.com', 'Password1')}>signUp</button>
      <button onClick={() => signIn('test@example.com', 'Password1')}>signIn</button>
      <button onClick={() => signOut()}>signOut</button>
      <button onClick={() => resetPassword('test@example.com')}>resetPassword</button>
      <button onClick={() => updatePassword('NewPassword1')}>updatePassword</button>
    </div>
  )
}

function renderWithAuth() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({ data: null }) }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    mockFrom.mockReturnValue(chain)
  })

  it('starts with loading true then resolves to false', async () => {
    renderWithAuth()
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
  })

  it('exposes null user when no session', async () => {
    renderWithAuth()
    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('null')
    })
  })

  it('exposes user email when session exists', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { email: 'test@example.com', id: '123' } } },
      error: null,
    })
    renderWithAuth()
    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('test@example.com')
    })
  })

  it('calls supabase signUp with correct args', async () => {
    mockSignUp.mockResolvedValue({ data: {}, error: null })
    renderWithAuth()
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    await act(async () => {
      screen.getByText('signUp').click()
    })
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'Password1',
      options: { data: { name: 'Test User' } },
    })
  })

  it('calls supabase signInWithPassword', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null })
    renderWithAuth()
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    await act(async () => {
      screen.getByText('signIn').click()
    })
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'Password1',
    })
  })

  it('calls supabase signOut', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    renderWithAuth()
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    await act(async () => {
      screen.getByText('signOut').click()
    })
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('calls supabase resetPasswordForEmail', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    renderWithAuth()
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    await act(async () => {
      screen.getByText('resetPassword').click()
    })
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('test@example.com')
  })

  it('calls supabase updateUser for password update', async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: null })
    renderWithAuth()
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    await act(async () => {
      screen.getByText('updatePassword').click()
    })
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'NewPassword1' })
  })

  it('throws when useAuth is used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<TestConsumer />)).toThrow()
    spy.mockRestore()
  })

  it('preserves user reference identity on onAuthStateChange if user data is identical (e.g. tab focus token refresh)', async () => {
    let authCallback: (event: string, session: any) => void = () => {}
    mockOnAuthStateChange.mockImplementation((cb: any) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    const initialUser = { id: 'u1', email: 'test@example.com', updated_at: '2026-11-11T00:00:00Z' }
    mockGetSession.mockResolvedValue({
      data: { session: { user: initialUser } },
      error: null,
    })

    let capturedUser: any = null
    let renderCount = 0
    function UserTracker() {
      const { user } = useAuth()
      capturedUser = user
      renderCount++
      return <div data-testid="user-id">{user?.id}</div>
    }

    render(
      <AuthProvider>
        <UserTracker />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('user-id').textContent).toBe('u1')
    })

    const firstUserRef = capturedUser
    const initialRenderCount = renderCount

    // Simulate Supabase visibilitychange / TOKEN_REFRESHED: creates a newly allocated user object
    const newSessionUser = { id: 'u1', email: 'test@example.com', updated_at: '2026-11-11T00:00:00Z' }
    act(() => {
      authCallback('TOKEN_REFRESHED', { user: newSessionUser })
    })

    // User reference must remain identical, avoiding re-render
    expect(capturedUser).toBe(firstUserRef)
    expect(renderCount).toBe(initialRenderCount)
  })
})
