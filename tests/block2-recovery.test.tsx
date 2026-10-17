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
  it('requests email with the current-origin recovery callback and neutral feedback, without company writes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<Auth />)
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'person@test.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    await screen.findByText(/If this email address is registered/)
    expect(mocks.reset).toHaveBeenCalledWith('person@test.invalid', { redirectTo: `${window.location.origin}/auth/callback?flow=recovery` })
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it('keeps reset submission disabled without a verified SDK session', async () => {
    window.location.hash = '#/login?reset=1'; render(<Auth />)
    await screen.findByText('Verifying your reset link… please wait.')
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect((screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('updates only the current session password and returns to login', async () => {
    window.location.hash = '#/login?reset=1'
    mocks.session.mockResolvedValue({ data: { session: { user: { id: 'recovering-user' } } } })
    render(<Auth />)
    await screen.findByText('Enter your new password below.')
    fireEvent.change(screen.getByPlaceholderText('Minimum 6 characters'), { target: { value: 'local-fixture-only' } })
    fireEvent.change(screen.getByPlaceholderText('Repeat new password'), { target: { value: 'local-fixture-only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ password: 'local-fixture-only' })
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it('surfaces expired recovery-session failure without reporting success', async () => {
    window.location.hash = '#/login?reset=1'
    mocks.session.mockResolvedValue({ data: { session: {} } })
    mocks.update.mockResolvedValue({ error: new Error('Recovery session expired') })
    render(<Auth />)
    await screen.findByText('Enter your new password below.')
    fireEvent.change(screen.getByPlaceholderText('Minimum 6 characters'), { target: { value: 'local-fixture-only' } })
    fireEvent.change(screen.getByPlaceholderText('Repeat new password'), { target: { value: 'local-fixture-only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await screen.findByText('Recovery session expired')
    expect(window.location.hash).toBe('#/login?reset=1')
    expect(screen.queryByText('Password updated successfully. You can now sign in.')).toBeNull()
  })
})
