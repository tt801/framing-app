import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import QuotesPage from '@/pages/Quotes'
import InvoicesPage from '@/pages/Invoices'

const state = vi.hoisted(() => ({ quotes: [] as Record<string, unknown>[], invoices: [] as Record<string, unknown>[],
  quotePdf: [] as Record<string, unknown>[], invoicePdf: [] as Record<string, unknown>[], taxRatePct: 20 }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => {
  const [quotes, setQuotes] = React.useState(state.quotes)
  return { quotes, add: async (q: Record<string, unknown>) => {
    const quote = { ...q, id: 'quote-1', createdAt: '2026-01-01' }; state.quotes = [...state.quotes, quote]; setQuotes(state.quotes); return { ok: true, quote }
  }, update: async (patch: Record<string, unknown>) => {
    const quote = { ...state.quotes.find(q => q.id === patch.id), ...patch }; state.quotes = [quote]; setQuotes(state.quotes); return { ok: true, quote }
  } }
} }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => {
  const [invoices, setInvoices] = React.useState(state.invoices)
  return { invoices, addInvoice: async (payload: Record<string, unknown>) => {
    const invoice = { ...payload, id: 'invoice-1', number: 'INV-1' }; state.invoices = [...state.invoices, invoice]; setInvoices(state.invoices); return { ok: true, invoice }
  }, updateInvoice: async (id: string, patch: Record<string, unknown>) => {
    const invoice = { ...state.invoices.find(row => row.id === id), ...patch }; state.invoices = [invoice]; setInvoices(state.invoices); return { ok: true, invoice }
  } }
} }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [{ id: 'c1', firstName: 'Alex', lastName: 'Test', email: 'alex@test.invalid' }] }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: {
  currencyCode: 'GBP', currencySymbol: '£', taxRatePct: state.taxRatePct, taxLabel: 'VAT', marginMultiplier: 1.5,
} } }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/pdf/quotePdf', () => ({ exportQuotePDF: async (args: Record<string, unknown>) => { state.quotePdf.push(args) } }))
vi.mock('@/lib/pdf/invoicePdf', () => ({ exportInvoicePDF: async (args: Record<string, unknown>) => { state.invoicePdf.push(args) } }))

function reset() { state.quotes = []; state.invoices = []; state.quotePdf = []; state.invoicePdf = []; state.taxRatePct = 20 }
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('manual commercial UI', () => {
  it('creates, edits, saves and reopens a Quote, then converts its saved agreement', async () => {
    reset(); vi.spyOn(window, 'confirm').mockReturnValue(false); vi.spyOn(window, 'alert').mockImplementation(() => {})
    const view = render(<QuotesPage />)
    fireEvent.click(screen.getByRole('button', { name: /New quote/i }))
    await screen.findByRole('button', { name: 'Save Draft' })
    fireEvent.change(screen.getByLabelText('Quote customer'), { target: { value: 'c1' } })
    await waitFor(() => expect(state.quotes[0].customerId).toBe('c1'))
    fireEvent.click(screen.getByRole('button', { name: /Add line item/i }))
    fireEvent.change(screen.getByLabelText('Quote description 1'), { target: { value: 'Frame service' } })
    fireEvent.change(screen.getByLabelText('Quote quantity 1'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Quote unit price 1'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(state.quotes[0].total).toBe(240))
    expect(state.quotes[0].subtotal).toBe(200)
    view.unmount(); render(<QuotesPage />)
    expect(await screen.findByDisplayValue('Frame service')).toBeTruthy()
    state.taxRatePct = 30
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    await waitFor(() => expect(state.quotePdf).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
    await waitFor(() => expect(state.invoices[0]?.total).toBe(240))
    expect(state.invoices[0].tax).toBe(40)
    expect(state.invoices[0].quoteId).toBe('quote-1')
    fireEvent.click(screen.getByRole('button', { name: 'Mark Sent' }))
    await waitFor(() => expect(state.quotes[0].status).toBe('Sent'))
    expect(screen.queryByRole('button', { name: /Add line item/i })).toBeNull()
    expect(state.quotes[0].total).toBe(240)
  })
  it('edits a Draft Invoice, persists balance and prevents edits after Paid', async () => {
    reset(); state.invoices = [{ id: 'i1', number: 'INV-1', status: 'Draft', items: [], subtotal: 0, taxRate: 0.2, tax: 0, total: 0,
      currencyCode: 'GBP', currencySymbol: '£', payments: [{ amount: 10 }] }]
    render(<InvoicesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add line item/i }))
    fireEvent.change(screen.getByLabelText('Invoice description 1'), { target: { value: 'Labour' } })
    fireEvent.change(screen.getByLabelText('Invoice unit price 1'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(state.invoices[0].total).toBe(120))
    expect(state.invoices[0].payments).toEqual([{ amount: 10 }])
    expect(state.invoices[0].subtotal).toBe(100)
    expect(state.invoices[0].pricingSnapshot).toMatchObject({ version: 1, pricingRule: 'manual-selling', taxRate: 0.2 })
    fireEvent.change(screen.getByLabelText('Invoice unit price 1'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(state.invoices[0].total).toBe(120) // below recorded payment is rejected
    fireEvent.change(screen.getByLabelText('Invoice unit price 1'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }))
    await waitFor(() => expect(state.invoices[0].status).toBe('Paid'))
    expect(screen.queryByRole('button', { name: /Add line item/i })).toBeNull()
  })
})
