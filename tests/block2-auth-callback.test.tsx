import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(), session: vi.fn(), user: vi.fn(), rpc: vi.fn(), membership: vi.fn(),
  event: null as ((event: string) => void) | null,
}))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light' }) }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: {
    exchangeCodeForSession: mocks.exchange, getSession: mocks.session, getUser: mocks.user,
    onAuthStateChange: (listener: typeof mocks.event) => { mocks.event = listener; return { data: { subscription: { unsubscribe() {} } } } },
  },
  rpc: mocks.rpc,
  from: () => { const query = { select: () => query, eq: () => query, maybeSingle: mocks.membership }; return query },
} }))
import AuthCallback from '@/pages/AuthCallback'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  window.history.replaceState(null, '', '/auth/callback?code=local-code')
  mocks.exchange.mockReset(); mocks.exchange.mockResolvedValue({ error: null })
  mocks.session.mockReset(); mocks.session.mockResolvedValue({ data: { session: null } })
  mocks.user.mockReset(); mocks.user.mockResolvedValue({ data: { user: { id: 'invitee', user_metadata: { company_account_id: 'a' } } } })
  mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue({ error: null })
  mocks.membership.mockReset(); mocks.membership.mockResolvedValue({ data: null, error: null })
})
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers() })
describe('Block 2 Auth callback application boundary (not hosted Auth certification)', () => {
  it('surfaces invalid/expired callback code without accepting membership', async () => {
    mocks.exchange.mockResolvedValue({ error: new Error('Invalid or expired code') })
    render(<AuthCallback />)
    await screen.findByText('Invalid or expired code')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it.each(['flow=recovery', 'type=recovery'])('routes %s toward password reset, never invitation acceptance', async marker => {
    window.history.replaceState(null, '', `/auth/callback?code=local-code&${marker}`)
    render(<AuthCallback />)
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(screen.getByText('Identity verified. Taking you to the password reset form...')).toBeTruthy()
    expect(mocks.exchange).toHaveBeenCalledWith('local-code')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('recognizes PASSWORD_RECOVERY emitted during PKCE exchange', async () => {
    mocks.exchange.mockImplementation(async () => { mocks.event?.('PASSWORD_RECOVERY'); return { error: null } })
    render(<AuthCallback />)
    await screen.findByText('Identity verified. Taking you to the password reset form...')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires a session before invitation acceptance', async () => {
    render(<AuthCallback />)
    await screen.findByText('Email confirmed. Please sign in to continue.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('accepts through the identity-bound RPC, not a company ID from mutable metadata', async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { id: 'invitee' } } } })
    render(<AuthCallback />)
    await screen.findByText('Invitation accepted. Set your password to continue...')
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('accept_company_invitation')
  })
  it('handles replay only when the current identity already has an active membership', async () => {
    mocks.session.mockResolvedValue({ data: { session: {} } })
    mocks.rpc.mockResolvedValue({ error: new Error('No pending invitation') })
    mocks.membership.mockResolvedValue({ data: { id: 'accepted-member' }, error: null })
    render(<AuthCallback />)
    await screen.findByText('Invitation accepted. Set your password to continue...')
    expect(mocks.membership).toHaveBeenCalledOnce()
  })
  it('does not turn an invalid invitation into a successful callback', async () => {
    mocks.session.mockResolvedValue({ data: { session: {} } })
    mocks.rpc.mockResolvedValue({ error: new Error('No pending invitation') })
    render(<AuthCallback />)
    await waitFor(() => expect(screen.getByText('No pending invitation')).toBeTruthy())
    expect(screen.queryByText('Invitation accepted. Set your password to continue...')).toBeNull()
  })
})
