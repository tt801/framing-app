import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { priceSellingDocument, toVisualiserQuote } from '@/lib/pricing'
const state = vi.hoisted(() => ({ quote: {} as Record<string, unknown>, jobs: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[], convert: vi.fn(), link: vi.fn(), addInvoice: vi.fn(), toast: vi.fn(),
  quotePdf: vi.fn(), jobPdf: vi.fn(), invoicePdf: vi.fn() }))
vi.mock('@/lib/pdf/quotePdf', () => ({ exportQuotePDF: (...args: unknown[]) => state.quotePdf(...args) }))
vi.mock('@/lib/pdf/jobCardPdf', () => ({ exportJobCardPDF: (...args: unknown[]) => state.jobPdf(...args) }))
vi.mock('@/lib/pdf/invoicePdf', () => ({ exportInvoicePDF: (...args: unknown[]) => state.invoicePdf(...args) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [state.quote] }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => {
  const [jobs, setJobs] = React.useState(state.jobs)
  return { jobs, loading: false, createFromQuote: async (id: string) => { const result = await state.convert(id); if (result.ok) { state.jobs = [result.job]; setJobs(state.jobs) }; return result },
    linkInvoiceFromQuote: (...args: unknown[]) => state.link(...args) }
} }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => {
  const [invoices, setInvoices] = React.useState(state.invoices)
  return { invoices, addInvoice: async (payload: Record<string, unknown>) => {
    state.addInvoice(payload); const invoice = { ...payload, id: 'i1', number: 'INV-1200' }; state.invoices = [invoice]; setInvoices(state.invoices)
    return { ok: true, invoice }
  } }
} }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [{ id: 'c1', firstName: 'Changed', lastName: 'Customer' }] }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: { currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30 } } }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: state.toast }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
import Quotes from '@/pages/Quotes'
import Jobs from '@/pages/Jobs'
import Invoices from '@/pages/Invoices'

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.clearAllMocks(); state.jobs = []; state.invoices = []
  const snapshot = priceSellingDocument({ items: [{ description: 'Frame', qty: 1, unitPrice: 175.75 }], currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 15 })
  state.quote = { ...toVisualiserQuote(snapshot), id: 'q1', number: 'Q-001', customerId: 'c1', status: 'Accepted',
    customerSnapshot: { id: 'c1', firstName: 'Saved', lastName: 'Customer' },
    jobSpecification: { artwork: { widthCm: 40 }, frame: { id: 'oak' }, details: {} } }
  state.convert.mockResolvedValue({ ok: true, job: { id: 'job1', quoteId: 'q1', refNo: 1001 } })
  state.link.mockResolvedValue({ ok: true, job: { id: 'job1', invoiceId: 'i1' } })
  vi.spyOn(window, 'confirm').mockReturnValue(false); vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.location.hash = '' })

it('creates a job from the saved quote and replaces conversion with a durable job link', async () => {
  render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'Create Job' }))
  const link = await screen.findByRole('link', { name: 'View Job 1001' })
  expect(link.getAttribute('href')).toBe('#/jobs?id=job1')
  expect(state.convert).toHaveBeenCalledExactlyOnceWith('q1')
  expect(screen.queryByRole('button', { name: 'Create Job' })).toBeNull()
})

it('enables accepted customer-bound manual conversion without requiring framing data', async () => {
  delete state.quote.jobSpecification
  render(<Quotes />)
  const button = screen.getByRole('button', { name: 'Create Job' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  expect(screen.getByText(/Workshop details are not recorded/)).toBeTruthy()
  fireEvent.click(button)
  await screen.findByRole('link', { name: 'View Job 1001' })
  expect(state.convert).toHaveBeenCalledExactlyOnceWith('q1')
})

it('exports the accepted customer snapshot rather than changed CRM details', async () => {
  render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.quotePdf).toHaveBeenCalled())
  expect(state.quotePdf.mock.calls[0][0].customer).toMatchObject({ firstName: 'Saved' })
})

it('does not substitute a different quote for a stale relationship URL', () => {
  window.location.hash = '#/quotes?id=missing'
  render(<Quotes />)
  expect(screen.queryByRole('button', { name: 'Create Job' })).toBeNull()
})

it('creates the saved quote invoice and links its existing job, preserving the customer snapshot', async () => {
  state.jobs = [{ id: 'job1', quoteId: 'q1', refNo: 1001 }]
  render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(state.link).toHaveBeenCalledExactlyOnceWith('q1', 'i1'))
  expect(state.addInvoice.mock.calls[0][0]).toMatchObject({ quoteId: 'q1', customerId: 'c1', total: 202.11, tax: 26.36,
    currencyCode: 'GBP', customerSnapshot: { firstName: 'Saved' } })
})

it('retries an invoice link failure without creating a second invoice', async () => {
  state.jobs = [{ id: 'job1', quoteId: 'q1', refNo: 1001 }]
  state.link.mockResolvedValueOnce({ ok: false, error: 'Job changed' })
  render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('already saved'), 'error'))
  fireEvent.click(screen.getByRole('button', { name: 'Link Invoice to Job' }))
  await waitFor(() => expect(state.link).toHaveBeenCalledTimes(2))
  expect(state.addInvoice).toHaveBeenCalledTimes(1)
})

it('opens the linked job by URL identity and exposes its quote and invoice', async () => {
  state.jobs = [{ id: 'other', refNo: 1000, createdAt: '2026-10-16', customer: {}, artwork: {}, frame: {}, checklist: [] },
    { id: 'job1', refNo: 1001, quoteId: 'q1', invoiceId: 'i1', createdAt: '2026-10-16', customerId: 'c1',
      customerSnapshot: { firstName: 'Saved' }, customer: {}, artwork: {}, frame: {}, checklist: [] }]
  window.location.hash = '#/jobs?id=job1'
  render(<Jobs />)
  expect((await screen.findByRole('link', { name: 'Source Quote: Q-001 →' })).getAttribute('href')).toBe('#/quotes?id=q1')
  expect(screen.getByRole('link', { name: 'View Invoice' }).getAttribute('href')).toBe('#/invoices?id=i1')
  fireEvent.click(screen.getAllByRole('button', { name: 'PDF' }).at(-1)!)
  await waitFor(() => expect(state.jobPdf).toHaveBeenCalled())
  expect(state.jobPdf.mock.calls[0][0].customer).toMatchObject({ firstName: 'Saved' })
})

it('opens the linked invoice by URL identity and exposes the inverse job relationship', async () => {
  state.jobs = [{ id: 'job1', refNo: 1001, quoteId: 'q1', invoiceId: 'i1' }]
  state.invoices = [{ ...state.quote, id: 'other-invoice', number: 'INV-1199' },
    { ...state.quote, id: 'i1', number: 'INV-1200', quoteId: 'q1', payments: [] }]
  window.location.hash = '#/invoices?id=i1'
  render(<Invoices />)
  expect((await screen.findByRole('link', { name: 'View Job 1001' })).getAttribute('href')).toBe('#/jobs?id=job1')
  expect(screen.getByRole('link', { name: 'Source Quote' }).getAttribute('href')).toBe('#/quotes?id=q1')
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.invoicePdf).toHaveBeenCalled())
  expect(state.invoicePdf.mock.calls[0][0].customer).toMatchObject({ firstName: 'Saved' })
})
