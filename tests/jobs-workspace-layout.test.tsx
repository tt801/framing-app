import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ layoutMode: 'fixed', banner: false, write: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  getCurrentUser: async () => ({ id: 'owner' }),
  supabase: { auth: {
    getUser: async () => ({ data: { user: { id: 'owner' } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }, from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'member' }, error: null }) }; return query } },
}))
vi.mock('@/lib/trial', () => ({ useTrialStatus: () => ({ trial: state.banner ? { companyAccountId: 'a', companyName: 'Layout fixture', workspaceRole: 'owner', planStatus: 'trialing', hasFullAccess: true, daysRemaining: 7, readOnly: false } : null, loading: false, error: null }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: state.layoutMode, toggleLayoutMode() {} }) }))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light', toggleThemeMode() {} }) }))
vi.mock('@/pages/Onboarding', () => ({ default: () => null, checkAndAutoMarkExistingUser: () => true, isOnboardingDone: () => true }))
vi.mock('@/pages/Customers', () => ({ default: () => <div>Customers route</div> }))
vi.mock('@/pages/Quotes', () => ({ default: () => <div>Quotes route</div> }))
vi.mock('@/pages/Invoices', () => ({ default: () => <div>Invoices route</div> }))
vi.mock('@/components/ToastContainer', () => ({ default: () => null }))
vi.mock('@/components/CommandPalette', () => ({ default: () => null }))
vi.mock('@/components/HelpAssistant', () => ({ default: () => null }))
vi.mock('@/components/CookieConsentBanner', () => ({ default: () => null }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ companyAccountId: 'a', jobs: [
  { id: 'one', refNo: 1001, customer: { firstName: 'Customer', lastName: 'Job' }, checklist: [], description: 'First work' },
  { id: 'two', refNo: 1003, jobType: 'internal', checklist: [], description: 'Internal work' },
  { id: 'missing', checklist: [], description: 'Historical work' },
], update: state.write, updateDetails: state.write, createIntake: state.write }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [] }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [] }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: {} } }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/favorites', () => ({ useFavorites: () => ({ isFavorited: () => false, toggle: vi.fn() }) }))
import App from '@/App'

beforeEach(() => { state.layoutMode = 'fixed'; state.banner = false; vi.clearAllMocks(); localStorage.clear(); window.location.hash = '#/jobs' })
afterEach(cleanup)

it.each([['fixed', false], ['fixed', true], ['full', false], ['full', true]] as const)('bounds the Jobs height chain only on desktop in %s mode, banner=%s', async (mode, banner) => {
  state.layoutMode = mode; state.banner = banner
  const view = render(<App />)
  await screen.findByRole('heading', { name: 'Job 1001' })
  const shell = view.container.querySelector('.app-shell')!
  for (const token of ['lg:h-dvh', 'lg:flex', 'lg:flex-col', 'lg:overflow-hidden']) expect(shell.classList.contains(token), token).toBe(true)
  expect(shell.classList.contains('h-dvh')).toBe(false)
  expect(shell.classList.contains('overflow-hidden')).toBe(false)
  const main = shell.querySelector(':scope > main')!
  expect(main.classList.contains('lg:flex-1')).toBe(true)
  expect(main.classList.contains('lg:min-h-0')).toBe(true)
  const wrapper = main.firstElementChild!
  expect(wrapper.classList.contains('lg:h-full')).toBe(true)
  expect(wrapper.classList.contains('lg:min-h-0')).toBe(true)
  expect(wrapper.classList.contains('max-w-[1440px]')).toBe(mode === 'fixed')
  const page = wrapper.firstElementChild!
  expect(page.classList.contains('lg:min-h-0')).toBe(true)
  expect(page.classList.contains('lg:h-full')).toBe(true)
  const pageMain = page.querySelector(':scope > main')!
  for (const token of ['lg:flex', 'lg:flex-col', 'lg:min-h-0', 'lg:h-full']) expect(pageMain.classList.contains(token), token).toBe(true)
  expect(Boolean(screen.queryByText(/7 days left for Layout fixture/))).toBe(banner)
  expect(state.write).not.toHaveBeenCalled()
})

it('gives sidebar and detail independent desktop overflow and preserves selection and final detail content', async () => {
  const view = render(<App />)
  await screen.findByRole('heading', { name: 'Job 1001' })
  const aside = view.container.querySelector('aside')!
  const grid = aside.parentElement!
  expect(grid.classList.contains('lg:flex-1')).toBe(true)
  expect(grid.classList.contains('lg:min-h-0')).toBe(true)
  expect(aside.classList.contains('lg:min-h-0')).toBe(true)
  expect(aside.classList.contains('lg:flex-col')).toBe(true)
  const scroll = aside.children[1]
  for (const token of ['lg:flex-1', 'lg:min-h-0', 'lg:overflow-y-auto', 'lg:max-h-none']) expect(scroll.classList.contains(token), token).toBe(true)
  expect(scroll.firstElementChild!.classList.contains('lg:static')).toBe(true)
  const detail = grid.querySelector(':scope > main')!
  for (const token of ['lg:min-h-0', 'lg:overflow-y-auto', 'hidden', 'lg:block']) expect(detail.classList.contains(token), token).toBe(true)
  const cards = within(aside).getAllByRole('listitem')
  expect(cards[0].textContent).toContain('Customer Job')
  fireEvent.click(cards[1])
  expect(screen.getByRole('heading', { name: 'Job 1003' })).toBeTruthy()
  expect(cards[1].textContent).toContain('Internal work — no customer')
  expect(within(detail as HTMLElement).getByText('Timeline')).toBeTruthy()
  fireEvent.scroll(scroll, { target: { scrollTop: 1000 } })
  fireEvent.scroll(detail, { target: { scrollTop: 2000 } })
  fireEvent.click(cards[2])
  expect(screen.getByRole('heading', { name: 'Job — reference unavailable' })).toBeTruthy()
  expect(state.write).not.toHaveBeenCalled()
})

it.each(['customers', 'quotes', 'invoices'])('does not constrain the %s route workspace', async route => {
  window.location.hash = `#/${route}`
  const view = render(<App />)
  await screen.findByText(`${route[0].toUpperCase()}${route.slice(1)} route`)
  const shell = view.container.querySelector('.app-shell')!
  expect(shell.classList.contains('lg:h-dvh')).toBe(false)
  expect(shell.classList.contains('lg:overflow-hidden')).toBe(false)
  const main = shell.querySelector(':scope > main')!
  expect(main.classList.contains('lg:flex-1')).toBe(false)
  expect(main.firstElementChild!.classList.contains('lg:h-full')).toBe(false)
})
