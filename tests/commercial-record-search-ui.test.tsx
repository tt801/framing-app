import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  readOnly: false, otherCompany: false, write: vi.fn(),
  customers: [] as any[], quotes: [] as any[], jobs: [] as any[], invoices: [] as any[],
}))
vi.mock('@/lib/customers', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/customers')>(), useCustomers: () => ({ customers: state.otherCompany ? [] : state.customers, readOnly: state.readOnly, add: state.write, update: state.write, remove: state.write }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.otherCompany ? [] : state.quotes, readOnly: state.readOnly, add: state.write, update: state.write, remove: state.write }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: state.otherCompany ? [] : state.jobs, companyAccountId: state.otherCompany ? 'company-b' : 'company-a', readOnly: state.readOnly, createIntake: state.write, updateDetails: state.write, update: state.write }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: state.otherCompany ? [] : state.invoices, readOnly: state.readOnly, addInvoice: state.write, updateInvoice: state.write, addPayment: state.write }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0 } } }) }))
vi.mock('@/lib/supabase', () => ({ supabase: null }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
import Customers from '@/pages/Customers'
import Quotes from '@/pages/Quotes'
import Jobs from '@/pages/Jobs'
import Invoices from '@/pages/Invoices'

const saved = { id: 'old-customer', firstName: 'Saved', lastName: 'Person', company: 'Historic Studio', email: 'archive@example.invalid' }
const pages = [
  ['Customers', Customers, 'Search by name, email, company…'],
  ['Quotes', Quotes, 'Search by customer, email, number…'],
  ['Jobs', Jobs, 'Search by customer, job reference…'],
  ['Invoices', Invoices, 'Search by customer, invoice number…'],
] as const
const snapshot = () => JSON.stringify([state.customers, state.quotes, state.jobs, state.invoices])
const cards = (container: HTMLElement, page: string) => {
  const aside = container.querySelector('aside')!
  return Array.from(aside.querySelectorAll(page === 'Jobs' ? 'li' : page === 'Customers' ? 'button[title^="View "]' : 'button.text-left')) as HTMLElement[]
}
async function search(container: HTMLElement, query: string) {
  fireEvent.change(container.querySelector('aside input[placeholder^="Search"]')!, { target: { value: query } })
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); window.location.hash = ''
  state.readOnly = false; state.otherCompany = false
  state.customers = [
    { id: 'c1', firstName: 'Ada ', lastName: 'Lovelace', company: 'Frame Works', email: 'ada@example.invalid', phone: '+44 123 456', address1: 'Maple Road' },
    { id: 'c2', firstName: 'UAT H2 ', lastName: 'Commercial', email: 'uat@example.invalid' },
  ]
  const commercial = { customerId: 'c1', customerSnapshot: saved, items: [{ id: 'line', description: 'Work', qty: 1, unitPrice: 456789123 }], subtotal: 987654321, total: 987654321, status: 'Draft', createdAt: '2025-09-01T00:00:00.000Z' }
  state.quotes = [
    { ...commercial, id: 'opaque-quote-hiddenidmarker', number: 'Q-3' },
    { ...commercial, id: 'opaque-quote-beta', number: 'Q-002' },
    { ...commercial, id: 'legacy_7' },
    { ...commercial, id: 'opaque-quote-history', quoteNumber: 'HIST-009' },
  ]
  state.invoices = [{ ...commercial, id: 'opaque-invoice-hiddenidmarker', number: 'INV-1000', payments: [{ amount: 876543219 }], irrelevantPayload: 'payloadmarker' }]
  const job = { customerId: 'c1', customerSnapshot: state.customers[0], customer: saved, createdAt: '2025-09-01', status: 'new', artwork: {}, frame: {}, checklist: [], frameName: 'Oak', glazingName: 'Clear', total: 987654321 }
  state.jobs = [
    { ...job, id: 'opaque-job-hiddenidmarker', refNo: 1001, description: 'Canvas restoration' },
    { ...job, id: 'quote-job:opaque-quote-beta', refNo: 1003, quoteId: 'opaque-quote-beta', description: 'Poster mounting' },
    { ...job, id: 'opaque-internal', refNo: 1004, jobType: 'internal', customerId: undefined, customerSnapshot: undefined, customer: {} },
    { ...job, id: 'opaque-missing-ref', refNo: undefined },
  ]
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.location.hash = '' })

it('Customers searches full identity/contact/address fields with normalized stored and query whitespace', async () => {
  const before = snapshot(); const view = render(<Customers />)
  for (const query of ['Ada', 'Lovelace', 'Ada Lovelace', 'Frame Works', 'ada@example.invalid', '+44 123 456', 'Maple Road']) {
    await search(view.container, query); expect(cards(view.container, 'Customers')).toHaveLength(1)
  }
  for (const query of ['UAT', 'H2', 'Commercial', 'UAT H2', 'H2 Commercial', 'UAT H2 Commercial', '  uAt   h2  Commercial  ']) {
    await search(view.container, query); expect(cards(view.container, 'Customers')).toHaveLength(1)
    expect(cards(view.container, 'Customers')[0].textContent).toContain('Commercial')
  }
  await search(view.container, '   '); expect(cards(view.container, 'Customers')).toHaveLength(2)
  expect(snapshot()).toBe(before); expect(state.write).not.toHaveBeenCalled()
})

it('Quotes searches displayed/manual/Visualiser/historical references and saved/current identities, never unrelated numeric fields', async () => {
  const before = snapshot(); const view = render(<Quotes />)
  for (const query of ['Q-3', '3', 'Q-002', '002', '2', 'Q-7', 'Q-   7', 'HIST-009', '009']) {
    await search(view.container, query); expect(cards(view.container, 'Quotes'), query).toHaveLength(1)
  }
  for (const query of ['Ada', 'Lovelace', '  ADA   Lovelace  ', 'Frame Works', 'ada@example.invalid', 'Saved', 'Person', 'Saved Person', 'Historic Studio', 'archive@example.invalid']) {
    await search(view.container, query); expect(cards(view.container, 'Quotes'), query).toHaveLength(4)
  }
  for (const query of ['987654321', '456789123', '2025', 'hiddenidmarker', '[object Object]']) {
    await search(view.container, query); expect(cards(view.container, 'Quotes'), query).toHaveLength(0)
  }
  await search(view.container, ' '); expect(cards(view.container, 'Quotes')).toHaveLength(4)
  expect(snapshot()).toBe(before); expect(state.write).not.toHaveBeenCalled()
})

it('Jobs searches allocated references, customer identities and work summaries, not opaque IDs or totals', async () => {
  const before = snapshot(); const view = render(<Jobs />)
  for (const query of ['1001', '1003', 'Canvas restoration', 'Poster mounting']) {
    await search(view.container, query); expect(cards(view.container, 'Jobs'), query).toHaveLength(1)
  }
  for (const query of ['Ada', 'Lovelace', '  aDa   Lovelace ', 'Frame Works', 'ada@example.invalid', '+44 123 456', 'Saved', 'Person', 'Saved Person', 'Historic Studio', 'archive@example.invalid']) {
    await search(view.container, query); expect(cards(view.container, 'Jobs'), query).toHaveLength(3)
  }
  for (const query of ['Oak', 'Clear']) { await search(view.container, query); expect(cards(view.container, 'Jobs')).toHaveLength(4) }
  for (const query of ['hiddenidmarker', '987654321', '2025']) { await search(view.container, query); expect(cards(view.container, 'Jobs'), query).toHaveLength(0) }
  await search(view.container, ' '); expect(cards(view.container, 'Jobs')).toHaveLength(4)
  expect(snapshot()).toBe(before); expect(state.write).not.toHaveBeenCalled()
})

it('Jobs shows references in both list cards and the selected heading, including Internal and missing-reference jobs', () => {
  window.location.hash = '#/jobs?id=quote-job%3Aopaque-quote-beta'
  const view = render(<Jobs />)
  const list = cards(view.container, 'Jobs')
  expect(within(list[1]).getByText('Job 1003')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Job 1003' })).toBeTruthy()
  expect(within(list[2]).getByText('Job 1004')).toBeTruthy()
  fireEvent.click(within(list[2]).getByRole('button', { name: 'View' }))
  expect(screen.getByRole('heading', { name: 'Job 1004' })).toBeTruthy()
  expect(within(list[2]).getByText('Internal work — no customer')).toBeTruthy()
  expect(within(list[3]).getByText('Job — reference unavailable')).toBeTruthy()
  fireEvent.click(within(list[3]).getByRole('button', { name: 'View' }))
  expect(screen.getByRole('heading', { name: 'Job — reference unavailable' })).toBeTruthy()
  expect(view.container.querySelector('aside')!.textContent).not.toContain('opaque-')
  expect(state.write).not.toHaveBeenCalled()
})

it('Invoices searches its displayed number and saved/current identity fields without matching payment/financial/payload/ID values', async () => {
  const before = snapshot(); const view = render(<Invoices />)
  for (const query of ['INV-1000', '1000', 'Ada', 'Lovelace', '  ADA   Lovelace ', 'Frame Works', 'ada@example.invalid', 'Saved Person', 'Historic Studio', 'archive@example.invalid']) {
    await search(view.container, query); expect(cards(view.container, 'Invoices'), query).toHaveLength(1)
    expect(cards(view.container, 'Invoices')[0].textContent).toContain('INV-1000')
  }
  for (const query of ['987654321', '456789123', '876543219', 'payloadmarker', 'hiddenidmarker', '2025']) {
    await search(view.container, query); expect(cards(view.container, 'Invoices'), query).toHaveLength(0)
  }
  await search(view.container, ' '); expect(cards(view.container, 'Invoices')).toHaveLength(1)
  expect(screen.getByText('Invoice: INV-1000')).toBeTruthy()
  expect(snapshot()).toBe(before); expect(state.write).not.toHaveBeenCalled()
})

it.each(pages)('%s search remains available read-only and only searches current company hook results', async (name, Component) => {
  state.readOnly = true
  const view = render(<Component />)
  await search(view.container, 'Ada Lovelace')
  expect(cards(view.container, name).length).toBeGreaterThan(0)
  state.otherCompany = true; view.rerender(<Component />)
  expect(cards(view.container, name)).toHaveLength(0)
  expect(state.write).not.toHaveBeenCalled()
})

it('Quotes retains saved top-level identity aliases even when the current customer wins display precedence', async () => {
  state.quotes = [{ ...state.quotes[0], customerSnapshot: undefined, customerName: 'HistoricLabel', customerEmail: 'prior@example.invalid' }]
  const view = render(<Quotes />)
  for (const query of ['HistoricLabel', 'prior@example.invalid', 'Ada Lovelace', 'ada@example.invalid']) {
    await search(view.container, query)
    expect(cards(view.container, 'Quotes'), query).toHaveLength(1)
    expect(cards(view.container, 'Quotes')[0].textContent).toContain('Ada')
  }
})

it.each([['Quotes', Quotes], ['Invoices', Invoices]] as const)('%s does not index a customer ID used only as a missing-name display fallback', async (name, Component) => {
  state.customers = [{ id: 'c1', firstName: '', lastName: '', company: '', email: '' }]
  const view = render(<Component />)
  await search(view.container, 'c1')
  expect(cards(view.container, name)).toHaveLength(0)
  expect(state.write).not.toHaveBeenCalled()
})

it.each(['Jobs', 'Invoices'] as const)('%s preserves persisted status/sort, 200ms debounce and empty-query filtering', async name => {
  const jobs = name === 'Jobs'
  if (jobs) {
    state.jobs[0] = { ...state.jobs[0], status: 'ready', total: 10 }
    state.jobs[1] = { ...state.jobs[1], status: 'ready', total: 20 }
  } else {
    state.invoices = [
      { ...state.invoices[0], number: 'INV-1000', total: 10 },
      { ...state.invoices[0], id: 'second', number: 'INV-1001', total: 20 },
      { ...state.invoices[0], id: 'sent', number: 'INV-1002', status: 'Sent' },
    ]
  }
  const key = jobs ? 'jobs.filters.v1' : 'invoices.filters.v1'
  const filters = jobs ? { statusFilter: 'ready', sortBy: 'value' } : { statusFilter: 'Draft', sortKey: 'amount' }
  localStorage.setItem(key, JSON.stringify({ ...filters, search: '  ADA   Lovelace  ' }))
  const Component = jobs ? Jobs : Invoices
  const view = render(<Component />)
  expect(cards(view.container, name)).toHaveLength(2)
  expect(cards(view.container, name)[0].textContent).toContain(jobs ? 'Job 1003' : 'INV-1001')
  fireEvent.change(view.container.querySelector('aside input[placeholder^="Search"]')!, { target: { value: 'no-matching-record' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(199) })
  expect(cards(view.container, name)).toHaveLength(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(cards(view.container, name)).toHaveLength(0)
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ ...filters, search: 'no-matching-record' })
  await search(view.container, '   ')
  expect(cards(view.container, name)).toHaveLength(2)
  expect(state.write).not.toHaveBeenCalled()
})

it('Quotes preserves its status filter and value sorting while changing and clearing search', async () => {
  state.quotes[0] = { ...state.quotes[0], total: 10 }
  state.quotes[1] = { ...state.quotes[1], total: 20 }
  state.quotes[2] = { ...state.quotes[2], status: 'Sent' }
  state.quotes[3] = { ...state.quotes[3], status: 'Sent' }
  const view = render(<Quotes />)
  const list = view.container.querySelector('aside')!
  fireEvent.click(within(list).getByRole('button', { name: 'Draft' }))
  fireEvent.change(within(list).getByRole('combobox'), { target: { value: 'total' } })
  await search(view.container, 'Ada Lovelace')
  expect(cards(view.container, 'Quotes')).toHaveLength(2)
  expect(cards(view.container, 'Quotes')[0].textContent).toContain('Q-002')
  await search(view.container, ' ')
  expect(cards(view.container, 'Quotes')).toHaveLength(2)
  expect(state.write).not.toHaveBeenCalled()
})
