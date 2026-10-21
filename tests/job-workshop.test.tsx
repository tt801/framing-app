import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Jobs from '@/pages/Jobs'

const state = vi.hoisted(() => ({ jobs: [] as Record<string, unknown>[], quotes: [] as Record<string, unknown>[], update: vi.fn(), add: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: state.jobs, update: state.update, add: state.add, remove: state.remove }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [] }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: {
  frames: [{ id: 'frame', name: 'Changed catalogue frame' }], mats: [{ id: 'mat', name: 'Changed catalogue mat' }],
  settings: { currencyCode: 'GBP', currencySymbol: '£' },
} }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/favorites', () => ({ useFavorites: () => ({ isFavorited: () => false, toggle: vi.fn() }) }))
vi.mock('@/lib/pdf/jobCardPdf', () => ({ exportJobCardPDF: vi.fn() }))

function details() {
  return { dims: { unit: 'metric', art: { widthCm: 40, heightCm: 30 }, visible: { widthCm: 50, heightCm: 40 }, frameFaceWidthCm: 2 },
    frame: { id: 'frame', name: 'UAT-H2 Frame' }, glazing: { name: 'UAT-H2 Glass' },
    mats: { hasMat1: true, hasMat2: false, hasMat3: false, mat1: { name: 'UAT-H2 Matd', borderCm: 5 }, mat2: null, mat3: null },
    printing: { include: false }, backer: { include: false }, costs: { subtotal: 175.75, total: 202.11, taxRate: 0.15 } }
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); window.location.hash = ''
  state.quotes = [{ id: 'q/2?exact', number: 'Q-002' }, { id: 'unrelated', number: 'Q-999' }]
  state.jobs = [{ id: 'job-test', refNo: 1001, quoteId: 'q/2?exact', status: 'new', createdAt: '2026-10-21',
    customer: { firstName: 'Saved', lastName: 'Customer' }, details: details(), checklist: [] }]
})
afterEach(() => { cleanup(); window.location.hash = '' })
function specification() { return screen.getByRole('region', { name: 'Framing specification' }) }

it('renders the saved workshop specification without changing the Job', () => {
  const before = structuredClone(state.jobs)
  render(<Jobs />)
  const section = specification()
  for (const text of ['40 × 30 cm', '50 × 40 cm', 'UAT-H2 Frame', '2 cm', 'UAT-H2 Matd — 5 cm border', 'None', 'UAT-H2 Glass'])
    expect(within(section).getByText(text)).toBeTruthy()
  expect(within(section).getAllByText('Off')).toHaveLength(2)
  expect(section.textContent).not.toContain('Changed catalogue')
  expect(section.textContent).not.toMatch(/finished size|cut size/i)
  expect(state.jobs).toEqual(before)
  expect(state.update).not.toHaveBeenCalled(); expect(state.add).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled()
})

it('reads detailsJson when the legacy Job has no details object', () => {
  state.jobs[0].detailsJson = JSON.stringify(details()); delete state.jobs[0].details
  render(<Jobs />)
  expect(within(specification()).getByText('UAT-H2 Matd — 5 cm border')).toBeTruthy()
  expect(within(specification()).getByText('40 × 30 cm')).toBeTruthy()
})

it.each([undefined, '{invalid json'])('does not invent missing legacy specification data (%s)', detailsJson => {
  state.jobs[0] = { ...state.jobs[0], details: undefined, detailsJson, artwork: {}, frame: {} }
  render(<Jobs />)
  expect(within(specification()).getAllByText('Not recorded')).toHaveLength(9)
  expect(specification().textContent).not.toContain('None')
  expect(specification().textContent).not.toContain('Off')
})

it('shows all additional mat names/borders and enabled production states', () => {
  state.jobs[0].details = { ...details(), mats: {
    hasMat1: false, hasMat2: true, hasMat3: true,
    mat2: { name: 'Saved second mat', borderCm: 1 }, mat3: { name: 'Saved third mat', borderCm: 0 },
  }, printing: { include: true }, backer: { include: true } }
  render(<Jobs />)
  expect(within(specification()).getByText('None')).toBeTruthy()
  expect(within(specification()).getByText('Mat 2: Saved second mat — 1 cm border; Mat 3: Saved third mat — 0 cm border')).toBeTruthy()
  expect(within(specification()).getAllByText('On')).toHaveLength(2)
})

it('resolves the source quote by exact ID with encoded navigation and visible link/focus styling', () => {
  render(<Jobs />)
  const link = screen.getByRole('link', { name: 'Source Quote: Q-002 →' })
  expect(link.getAttribute('href')).toBe('#/quotes?id=q%2F2%3Fexact')
  expect(link.classList.contains('underline')).toBe(true)
  expect(link.classList.contains('hover:text-emerald-900')).toBe(true)
  expect(link.classList.contains('focus-visible:outline-2')).toBe(true)
  expect(link.classList.contains('focus-visible:outline-emerald-700')).toBe(true)
})

it.each(['not-loaded', 'no-number'])('uses actionable source fallback when %s rather than an unrelated quote number', reason => {
  state.quotes = reason === 'not-loaded' ? [{ id: 'unrelated', number: 'Q-999' }] : [{ id: 'q/2?exact' }]
  render(<Jobs />)
  expect(screen.getByRole('link', { name: 'View source quote →' }).getAttribute('href')).toBe('#/quotes?id=q%2F2%3Fexact')
  expect(screen.queryByText('Source Quote: Q-999 →')).toBeNull()
})

it('updates the fallback when the exact linked quote loads asynchronously', () => {
  state.quotes = []
  const view = render(<Jobs />)
  expect(screen.getByRole('link', { name: 'View source quote →' })).toBeTruthy()
  state.quotes = [{ id: 'q/2?exact', number: 'Q-002' }]; view.rerender(<Jobs />)
  expect(screen.getByRole('link', { name: 'Source Quote: Q-002 →' })).toBeTruthy()
  expect(state.update).not.toHaveBeenCalled()
})

it('omits the source link for Jobs without a source quote', () => {
  delete state.jobs[0].quoteId
  render(<Jobs />)
  expect(screen.queryByRole('link', { name: /source quote/i })).toBeNull()
})

it('keeps inset bulk selection separate from the active detail Job', () => {
  state.jobs.push({ ...state.jobs[0], id: 'second', refNo: 1002, details: { ...details(), frame: { name: 'Second saved frame' } } })
  render(<Jobs />)
  const cards = screen.getAllByRole('listitem')
  expect(cards[0].classList.contains('border-slate-900')).toBe(true)
  fireEvent.click(within(cards[1]).getByRole('checkbox'))
  expect(cards[1].classList.contains('ring-inset')).toBe(true)
  expect(cards[1].classList.contains('ring-blue-500')).toBe(true)
  expect(cards[0].classList.contains('border-slate-900')).toBe(true)
  expect(cards[0].classList.contains('ring-blue-500')).toBe(false)
  expect(within(specification()).getByText('UAT-H2 Frame')).toBeTruthy()
  fireEvent.click(within(cards[1]).getByRole('button', { name: 'View' }))
  expect(within(specification()).getByText('Second saved frame')).toBeTruthy()
  expect(cards[1].classList.contains('border-slate-900')).toBe(true)
  fireEvent.click(within(cards[1]).getByRole('checkbox'))
  expect(cards[1].classList.contains('ring-blue-500')).toBe(false)
  expect(cards[1].classList.contains('border-slate-900')).toBe(true)
  expect(state.update).not.toHaveBeenCalled()
})
