import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBillingAccess } from '@/lib/billingAccess'

const state = vi.hoisted(() => ({
  user: 'owner-a' as string | null,
  trial: null as { workspaceRole: string; readOnly: boolean; companyAccountId: string } | null,
  loading: false,
  authListener: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
}))
vi.mock('@/lib/supabase', () => ({
  getCurrentUser: async () => state.user ? { id: state.user } : null,
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }),
      onAuthStateChange: (listener: typeof state.authListener) => { state.authListener = listener; return { data: { subscription: { unsubscribe() {} } } } },
    },
    from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.trial ? { id: 'member' } : null, error: null }) }; return query },
  },
}))
vi.mock('@/lib/trial', () => ({ useTrialStatus: () => ({ trial: state.trial, loading: state.loading, error: null, isExpired: false }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed', toggleLayoutMode() {} }) }))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light', toggleThemeMode() {} }) }))
vi.mock('@/pages/Onboarding', () => ({ default: () => <div>Onboarding boundary</div>, checkAndAutoMarkExistingUser: () => true, isOnboardingDone: () => true }))
vi.mock('@/pages/Admin', () => ({ default: () => <div>Admin boundary</div> }))
vi.mock('@/pages/Billing', () => ({ default: () => <div>Billing boundary</div> }))
vi.mock('@/pages/Auth', () => ({ default: () => <div>Login boundary</div> }))
vi.mock('@/pages/Quotes', () => ({ default: function QuotesBoundary() { const access = useBillingAccess(); return <div>Quotes boundary: {access.companyAccountId || 'no company'} / {access.readOnly ? 'read only' : 'writable'}</div> } }))
vi.mock('@/components/TrialBanner', () => ({ default: () => null }))
vi.mock('@/components/ToastContainer', () => ({ default: () => null }))
vi.mock('@/components/CommandPalette', () => ({ default: () => null }))
vi.mock('@/components/HelpAssistant', () => ({ default: () => null }))
vi.mock('@/components/CookieConsentBanner', () => ({ default: () => null }))
import App from '@/App'

beforeEach(() => {
  state.user = 'owner-a'; state.trial = { workspaceRole: 'owner', readOnly: false, companyAccountId: 'a' }; state.loading = false
  window.history.replaceState(null, '', '/#/quotes')
})
afterEach(cleanup)
describe('Block 2 direct routes (real App guards; destination pages are transport probes)', () => {
  it.each(['/admin', '/billing', '/quotes', '/jobs', '/invoices'])('requires authentication at %s', async route => {
    state.user = null; window.location.hash = `#${route}`
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
    expect(screen.queryByText('Admin boundary')).toBeNull()
    expect(screen.queryByText('Billing boundary')).toBeNull()
    expect(screen.queryByText(/Quotes boundary/)).toBeNull()
  })
  it('permits the authenticated owner to access Admin', async () => {
    window.location.hash = '#/admin'; render(<App />)
    await screen.findByText('Admin boundary')
  })
  it.each(['/admin', '/billing'])('prevents staff direct navigation to %s', async route => {
    state.trial!.workspaceRole = 'staff'; window.location.hash = `#${route}`
    render(<App />)
    await screen.findByText(route === '/admin' ? 'You do not have access to Admin' : 'Billing is available to the company owner.')
    expect(screen.queryByText('Admin boundary')).toBeNull()
    expect(screen.queryByText('Billing boundary')).toBeNull()
  })
  it('does not grant a company context or write entitlement without verified membership', async () => {
    state.trial = null; render(<App />)
    await screen.findByText('Quotes boundary: no company / read only')
    expect(screen.queryByRole('button', { name: /New quote/ })).toBeNull()
  })
  it('keeps direct read-only commercial navigation readable but carries no write entitlement', async () => {
    state.trial!.readOnly = true; render(<App />)
    await screen.findByText('Quotes boundary: a / read only')
    expect(screen.queryByRole('button', { name: /New quote/ })).toBeNull()
  })
  it('removes protected content on sign-out without a reload', async () => {
    render(<App />); await screen.findByText('Quotes boundary: a / writable')
    state.user = null
    await act(async () => state.authListener?.('SIGNED_OUT', null))
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
    expect(screen.queryByText(/Quotes boundary/)).toBeNull()
  })
  it('normalizes an implicit recovery hash into the public reset route', async () => {
    state.user = null; window.location.hash = '#type=recovery&access_token=local-fixture'
    render(<App />)
    await screen.findByText('Login boundary')
    expect(screen.queryByText(/Quotes boundary/)).toBeNull()
  })
})
