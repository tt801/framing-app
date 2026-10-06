import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { table, credentialForm } = vi.hoisted(() => ({
  table: vi.fn(() => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'membership-a' }, error: null }) }
    return query
  }),
  credentialForm: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-a' })),
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: 'user-a' } } }) }, from: table },
}))
vi.mock('@/lib/trial', () => ({ useTrialStatus: () => ({ trial: { workspaceRole: 'owner', readOnly: false, companyAccountId: 'company-a', companyName: 'Company A' }, loading: false, error: null, isExpired: false }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed', toggleLayoutMode: vi.fn() }) }))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light', toggleThemeMode: vi.fn() }) }))
vi.mock('@/pages/APISettings', () => ({ default: () => { credentialForm(); return <div>credential form mounted</div> } }))
vi.mock('@/pages/Dashboard', () => ({ default: () => <div>Dashboard placeholder</div> }))
vi.mock('@/pages/Billing', () => ({ default: () => <div>Billing placeholder</div> }))
vi.mock('@/components/TrialBanner', () => ({ default: () => null }))
vi.mock('@/components/ToastContainer', () => ({ default: () => null }))
vi.mock('@/components/CommandPalette', () => ({ default: () => null }))
vi.mock('@/components/HelpAssistant', () => ({ default: () => null }))
vi.mock('@/components/CookieConsentBanner', () => ({ default: () => null }))
import App from '@/App'

beforeEach(() => { table.mockReset(); credentialForm.mockReset(); window.location.hash = '#/api-settings' })
describe('removed credential route', () => {
  it('exposes Billing in the normal owner navigation', async () => {
    window.location.hash = '#/dashboard'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Billing' }).getAttribute('href')).toBe('#/billing'))
  })
  it('redirects direct navigation without mounting the credential form or reading its table', async () => {
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(credentialForm).not.toHaveBeenCalled()
    expect(screen.queryByText('credential form mounted')).toBeNull()
    expect(table).not.toHaveBeenCalledWith('user_api_credentials')
  })
})

describe('owner Billing navigation', () => {
  it('renders Billing inside the normal application shell and navigates to Dashboard', async () => {
    window.location.hash = '#/billing'
    const { container } = render(<App />)
    await waitFor(() => expect(within(container).getByText('Billing placeholder')).toBeTruthy())

    const shell = container.querySelector('.app-shell')
    expect(shell).not.toBeNull()
    expect(shell?.contains(within(container).getByText('Billing placeholder'))).toBe(true)
    const navigation = within(shell as HTMLElement).getByRole('navigation')
    expect(within(navigation).getByRole('link', { name: 'Billing' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(navigation).getByRole('link', { name: 'Dashboard' }))
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    await waitFor(() => expect(within(container).getByText('Dashboard placeholder')).toBeTruthy())
  })
})
