// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../src/App.js'

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true, isRecoveryCallback: false, markRecoveryCallback: vi.fn(), clearRecoveryCallback: vi.fn(), getAccessToken: async () => 'test-token',
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }), signOut: vi.fn() } },
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('renders the actual signed-in dashboard and navigates to the actual Supplier Feeds page', async () => {
  const fetch = vi.fn(async (url: string) => ({ ok: true, text: async () => JSON.stringify(url === '/api/platform/stats' ? { totalCompanies: 0, totalMembers: 0, openTickets: 0, planCounts: {}, recentCompanies: [] } : { feeds: [], hasMore: false, offset: 0 }) }))
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  expect(await screen.findByText('Total Companies')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Supplier Feeds' }))
  expect(await screen.findByText('No configured supplier feeds.')).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1, name: 'Supplier Feeds' })).toBeTruthy()
  expect(fetch).toHaveBeenCalledWith('/api/platform/supplier-feeds?offset=0', expect.any(Object))
})
