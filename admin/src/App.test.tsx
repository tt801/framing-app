// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthEvent = 'PASSWORD_RECOVERY' | 'SIGNED_IN' | 'SIGNED_OUT' | 'INITIAL_SESSION' | 'USER_UPDATED'
type Session = { access_token: string }
const mocks = vi.hoisted(() => ({
  callback: null as null | ((event: AuthEvent, session: Session | null) => void),
  callbackFlag: false,
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  get isRecoveryCallback() { return mocks.callbackFlag },
  isSupabaseConfigured: true,
  markRecoveryCallback: vi.fn(),
  clearRecoveryCallback: vi.fn(),
  getAccessToken: vi.fn(),
  supabase: { auth: {
    getSession: mocks.getSession,
    onAuthStateChange: mocks.onAuthStateChange,
    resetPasswordForEmail: mocks.resetPasswordForEmail,
    signInWithPassword: mocks.signInWithPassword,
    updateUser: mocks.updateUser,
    signOut: mocks.signOut,
  } },
}))
vi.mock('@/pages/Dashboard', () => ({ default: () => <div>Admin dashboard</div> }))

beforeEach(() => {
  mocks.callback = null
  mocks.callbackFlag = false
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } })
  mocks.onAuthStateChange.mockReset().mockImplementation((cb: typeof mocks.callback) => {
    mocks.callback = cb
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  mocks.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null })
  mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null })
  mocks.updateUser.mockReset().mockResolvedValue({ error: null })
  mocks.signOut.mockReset().mockResolvedValue({ error: null })
})
afterEach(() => { cleanup(); vi.resetModules() })
async function openApp() {
  const { default: App } = await import('./App')
  render(<App />)
  await waitFor(() => expect(screen.queryByText('Checking session...')).toBeNull())
}

describe('standalone Admin password recovery', () => {
  it('offers a forgot-password action on the login screen', async () => {
    await openApp()
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy()
  })

  it('requests recovery for the entered email using the current Admin origin and neutral feedback', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'owner@example.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'owner@example.invalid', { redirectTo: window.location.origin }
    ))
    expect(await screen.findByText(/If an account exists for that email/)).toBeTruthy()
  })

  it('does not enter the Admin shell when a recovery callback creates a session', async () => {
    mocks.callbackFlag = true
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'recovery-session' } } })
    await openApp()
    expect(screen.queryByText('Admin dashboard')).toBeNull()
    await act(async () => { mocks.callback?.('PASSWORD_RECOVERY', { access_token: 'recovery-session' }) })
    expect(screen.getByRole('heading', { name: 'Set new password' })).toBeTruthy()
    expect(screen.queryByText('Admin dashboard')).toBeNull()
  })

  async function enterRecovery() {
    await openApp()
    await act(async () => { mocks.callback?.('PASSWORD_RECOVERY', { access_token: 'recovery-session' }) })
    expect(screen.getByRole('heading', { name: 'Set new password' })).toBeTruthy()
  }

  it('rejects mismatched passwords without calling updateUser', async () => {
    await enterRecovery()
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'not-the-same-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Passwords do not match.')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('requires at least eight characters before submitting to Supabase', async () => {
    await enterRecovery()
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Use a password of at least 8 characters.')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('shows a Supabase password-policy error without signing out or entering Admin', async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: new Error('Password does not meet policy') })
    await enterRecovery()
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Password does not meet policy')
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(screen.queryByText('Admin dashboard')).toBeNull()
  })

  it('updates the password, signs out and returns to login only after explicit navigation', async () => {
    await enterRecovery()
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'long-enough-password' }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce())
    expect(screen.getByText(/Password updated/)).toBeTruthy()
    expect(screen.queryByText('Admin dashboard')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy()
    expect(screen.queryByText('Admin dashboard')).toBeNull()
  })

  it('does not treat a recovery session as Platform Admin authorization', async () => {
    await enterRecovery()
    await act(async () => { mocks.callback?.('SIGNED_IN', { access_token: 'recovery-session' }) })
    expect(screen.queryByText('Admin dashboard')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Set new password' })).toBeTruthy()
  })

  it('does not expose the login or Admin shell when sign-out after update fails, and retries sign-out', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: new Error('temporarily unavailable') })
    await enterRecovery()
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('sign-out failed'))
    expect(screen.queryByRole('button', { name: 'Back to sign in' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Finish sign-out' }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(2))
    expect(mocks.updateUser).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Password updated/)).toBeTruthy()
  })

  it('keeps an unverifiable callback out of Admin and lets the user request another link', async () => {
    mocks.callbackFlag = true
    await openApp()
    expect(await screen.findByRole('alert', {}, { timeout: 6_000 })).toHaveProperty(
      'textContent', expect.stringContaining('could not be verified')
    )
    expect(screen.queryByText('Admin dashboard')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Request another link' }))
    await act(async () => { await Promise.resolve() })
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy()
  }, 8_000)
})
