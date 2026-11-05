import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), reset: vi.fn(), update: vi.fn(), database: vi.fn() }))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light' }) }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.session, resetPasswordForEmail: mocks.reset, updateUser: mocks.update, onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  from: mocks.database, rpc: mocks.database,
} }))
import Auth from '@/pages/Auth'
beforeEach(() => {
  window.history.replaceState(null, '', '/#/login')
  mocks.session.mockReset(); mocks.session.mockResolvedValue({ data: { session: null } })
  mocks.reset.mockReset(); mocks.reset.mockResolvedValue({ error: null })
  mocks.update.mockReset(); mocks.update.mockResolvedValue({ error: null })
  mocks.database.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('Block 2 password recovery application responsibilities', () => {
  it.each([
    ['#/login?reset=1&invite=1', 'Welcome to FramersApp', 'Create a password to join your workspace.', 'Create Password'],
    ['#/login?reset=1', 'Reset your password', 'Choose a new password for your account.', 'Update Password'],
  ])('presents the correct password setup context for %s without signup messaging', async (route, heading, description, button) => {
    window.location.hash = route
    mocks.session.mockResolvedValue({ data: { session: { user: { id: 'setup-user' } } } })
    render(<Auth />)
    await screen.findByText('Enter your new password below.')
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.getByText(description)).toBeTruthy()
    expect(screen.getByRole('button', { name: button })).toBeTruthy()
    expect(screen.queryByText('What happens after signup')).toBeNull()
    expect(screen.queryByText(/workspace is created automatically/)).toBeNull()
    expect(screen.queryByText(/14-day/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start trial' })).toBeNull()
  })
  it('requests email with the current-origin recovery callback and neutral feedback, without company writes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<Auth />)
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'person@test.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    await screen.findByText(/If this email address is registered/)
    expect(mocks.reset).toHaveBeenCalledWith('person@test.invalid', { redirectTo: `${window.location.origin}/auth/callback?flow=recovery` })
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it.each([
    ['#/login?reset=1', 'Update Password', 'Verifying your reset link… please wait.'],
    ['#/login?reset=1&invite=1', 'Create Password', 'Verifying your invitation… please wait.'],
  ])('keeps %s submission disabled without a verified SDK session', async (route, button, pending) => {
    window.location.hash = route; render(<Auth />)
    await screen.findByText(pending)
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([
    ['#/login?reset=1', 'Update Password'],
    ['#/login?reset=1&invite=1', 'Create Password'],
  ])('updates only the current session password and returns to login from %s', async (route, button) => {
    window.location.hash = route
    mocks.session.mockResolvedValue({ data: { session: { user: { id: 'recovering-user' } } } })
    render(<Auth />)
    await screen.findByText('Enter your new password below.')
    fireEvent.change(screen.getByPlaceholderText('Minimum 6 characters'), { target: { value: 'local-fixture-only' } })
    fireEvent.change(screen.getByPlaceholderText('Repeat new password'), { target: { value: 'local-fixture-only' } })
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ password: 'local-fixture-only' })
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it.each([
    ['#/login?reset=1', 'Update Password'],
    ['#/login?reset=1&invite=1', 'Create Password'],
  ])('surfaces expired session failure without reporting success for %s', async (route, button) => {
    window.location.hash = route
    mocks.session.mockResolvedValue({ data: { session: {} } })
    mocks.update.mockResolvedValue({ error: new Error('Recovery session expired') })
    render(<Auth />)
    await screen.findByText('Enter your new password below.')
    fireEvent.change(screen.getByPlaceholderText('Minimum 6 characters'), { target: { value: 'local-fixture-only' } })
    fireEvent.change(screen.getByPlaceholderText('Repeat new password'), { target: { value: 'local-fixture-only' } })
    fireEvent.click(screen.getByRole('button', { name: button }))
    await screen.findByText('Recovery session expired')
    expect(window.location.hash).toBe(route)
    expect(screen.queryByText('Password updated successfully. You can now sign in.')).toBeNull()
  })
  it('does not infer invitation acceptance from an invite flag without the callback password-setup marker', () => {
    window.location.hash = '#/login?invite=1'
    render(<Auth />)
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create Password' })).toBeNull()
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it('preserves the normal signup screen', () => {
    render(<Auth defaultMode="signup" />)
    expect(screen.getByRole('heading', { name: 'Start your free trial' })).toBeTruthy()
    expect(screen.getByText('What happens after signup')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
  })
})
