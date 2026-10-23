import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Invoice } from '@/lib/invoices'

const state = vi.hoisted(() => ({ invoices: [] as Invoice[], rpc: vi.fn(), updates: vi.fn(), pdf: vi.fn(), download: vi.fn(), toast: vi.fn(),
  jobs: [] as Record<string, unknown>[], quotes: [] as Invoice[], link: vi.fn(),
  defer: false, fail: false, release: null as null | (() => void) }))
const customers = [{ id: 'c1', firstName: 'Current', lastName: 'Customer', email: 'current@example.test', phone: '0123456789' }]
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: 'company-a', readOnly: false }), useBillingWriteGuard: () => () => true }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: { currencyCode: 'GBP', currencySymbol: '£', invoicePrefix: 'INV-', invoiceStartNumber: 1000 } } }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: state.jobs, loading: false, linkInvoiceFromQuote: state.link }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: state.toast }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/pdf/invoicePdf', () => ({ exportInvoicePDF: state.pdf }))
vi.mock('jspdf', async importOriginal => {
  const actual = await importOriginal<typeof import('jspdf')>()
  const createDocument = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const document = new actual.jsPDF(...args)
    document.save = state.download
    return document
  }
  return { ...actual, default: createDocument, jsPDF: createDocument }
})
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    if (table !== 'invoices') throw new Error(`Unexpected table ${table}`)
    let id = ''; let patch: { payload: Invoice } | undefined
    const row = (invoice: Invoice) => ({ id: invoice.id, invoice_number: invoice.number, customer_id: invoice.customerId || null, quote_id: invoice.quoteId || null, payload: structuredClone(invoice) })
    const query = { select: () => query, eq: (key: string, value: string) => { if (key === 'id') id = value; return query },
      order: async () => ({ data: state.invoices.map(row), error: null }),
      update: (value: { payload: Invoice }) => { patch = value; state.updates(value); return query },
      single: async () => {
        if (state.defer) await new Promise<void>(resolve => { state.release = resolve })
        if (state.fail) return { data: null, error: { message: 'Save unavailable' } }
        if (patch) state.invoices = state.invoices.map(invoice => invoice.id === id ? structuredClone(patch!.payload) : invoice)
        return { data: row(state.invoices.find(invoice => invoice.id === id)!), error: null }
      },
    }; return query
  },
} }))
import Invoices from '@/pages/Invoices'
import Quotes from '@/pages/Quotes'
const base = (patch: Partial<Invoice> = {}): Invoice => ({ id: 'i1', number: 'INV-1000', createdAt: '2026-10-22', status: 'Sent', customerId: 'c1', quoteId: 'q1', items: [{ id: 'line', name: 'Frame', qty: 1, unitPrice: 100 }], subtotal: 100, tax: 0, total: 100, payments: [], ...patch })
beforeEach(() => {
  localStorage.clear(); window.location.hash = '#/invoices?id=i1'; vi.clearAllMocks()
  state.defer = false; state.fail = false; state.release = null
  state.invoices = [base()]
  state.jobs = [{ id: 'j1', refNo: 'JOB-1000', invoiceId: 'i1', quoteId: 'q1' }]
  state.quotes = []
  state.link.mockImplementation(async (_quoteId: string, invoiceId: string) => {
    state.jobs[0] = { ...state.jobs[0], invoiceId }
    return { ok: true, job: state.jobs[0] }
  })
  state.rpc.mockImplementation(async (name: string, args: { p_payload: Invoice; p_id: string }) => {
    expect(name).toBe('create_invoice')
    expect(args).toMatchObject({ p_company_account_id: 'company-a', p_prefix: 'INV-', p_start_number: 1000 })
    const invoice = { ...args.p_payload, id: args.p_id, number: 'INV-1001' }
    state.invoices.push(structuredClone(invoice))
    return { data: { id: invoice.id, invoice_number: invoice.number, payload: invoice }, error: null }
  })
})
afterEach(() => { cleanup(); window.location.hash = ''; vi.restoreAllMocks() })
async function open() { const view = render(<Invoices />); await screen.findByText('Invoice: INV-1000'); return view }
function value(name: string) { return (screen.getByPlaceholderText(name) as HTMLInputElement).value }

it('populates customer-ID-only invoices without writing fallback customer data', async () => {
  await open()
  expect(screen.getAllByText('Current Customer').length).toBeGreaterThan(0)
  expect(value('Name')).toBe('Current Customer')
  expect(value('Email')).toBe('current@example.test')
  expect(value('Phone')).toBe('0123456789')
  expect(state.updates).not.toHaveBeenCalled()
})
it('retains historical snapshot fields, honours explicit editable fields and clears on selection change', async () => {
  state.invoices = [base({ customerSnapshot: { firstName: 'Historical', lastName: 'Customer', email: 'old@example.test', phone: '0999' } }), base({ id: 'i2', number: 'INV-1002', customerId: undefined, quoteId: undefined })]
  const view = await open()
  expect(value('Name')).toBe('Historical Customer'); expect(value('Email')).toBe('old@example.test'); expect(value('Phone')).toBe('0999')
  expect(screen.getByRole('link', { name: 'Source Quote' }).getAttribute('href')).toBe('#/quotes?id=q1')
  expect(screen.getByRole('link', { name: 'View Job JOB-1000' }).getAttribute('href')).toBe('#/jobs?id=j1')
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Invoice recipient' } })
  await waitFor(() => expect(value('Name')).toBe('Invoice recipient'))
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: '' } })
  await waitFor(() => expect(state.invoices[0].customerEmail).toBe(''))
  expect(value('Email')).toBe('')
  expect(state.invoices[0].customerSnapshot.email).toBe('old@example.test')
  view.unmount(); await open()
  expect(value('Name')).toBe('Invoice recipient'); expect(value('Email')).toBe('')
  fireEvent.click(screen.getByText('INV-1002'))
  expect(value('Name')).toBe(''); expect(value('Email')).toBe(''); expect(value('Phone')).toBe('')
  fireEvent.click(screen.getByText('INV-1000'))
  expect(value('Name')).toBe('Invoice recipient'); expect(value('Phone')).toBe('0999')
})
it('does not fill missing historical snapshot fields from the current customer', async () => {
  state.invoices = [base({ customerSnapshot: { firstName: 'Historical', lastName: 'Customer', email: '' } })]
  await open()
  expect(value('Name')).toBe('Historical Customer')
  expect(value('Email')).toBe(''); expect(value('Phone')).toBe('')
  expect(state.updates).not.toHaveBeenCalled()
})
it.each(['Paid', 'Sent'])('does not offer settlement for fully paid %s invoices', async status => {
  state.invoices = [base({ status, payments: [{ id: 'p1', amount: 100 }] })]
  await open()
  expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull()
  expect(state.updates).not.toHaveBeenCalled()
})
it('respects an existing Paid status without rewriting historical payments or balances', async () => {
  state.invoices = [base({ status: 'Paid', payments: [] })]
  await open()
  expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull()
  expect(state.invoices[0].payments).toEqual([])
  expect(state.updates).not.toHaveBeenCalled()
})
it('settles a partial invoice once and removes the action immediately and after remount', async () => {
  state.invoices = [base({ payments: [{ id: 'p1', amount: 40 }] })]
  const view = await open()
  fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }))
  await waitFor(() => expect(state.invoices[0].status).toBe('Paid'))
  expect(state.invoices[0].payments!.map(payment => payment.amount)).toEqual([40, 60])
  expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull()
  expect(state.updates).toHaveBeenCalledTimes(1)
  view.unmount(); await open()
  expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull()
})
it('blocks repeated settlement clicks while saving and permits retry after failure', async () => {
  state.defer = true; state.fail = true
  await open()
  const button = screen.getByRole('button', { name: 'Mark Paid' }) as HTMLButtonElement
  fireEvent.click(button); fireEvent.click(button)
  expect(state.updates).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled).toBe(true)
  state.release!()
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith('Save unavailable', 'error'))
  expect(state.invoices[0].payments).toEqual([])
  expect(button.disabled).toBe(false)
  state.defer = false; state.fail = false
  fireEvent.click(button)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull())
  expect(state.invoices[0].payments).toHaveLength(1)
  expect(state.updates).toHaveBeenCalledTimes(2)
})
it.each([
  { customer: { name: 'Legacy Customer', email: 'legacy@example.test', phone: '0111' } },
  { details: { customer: { name: 'Legacy Customer', email: 'legacy@example.test', phone: '0111' } } },
])('displays existing legacy customer details without persisting a migration: %j', async fields => {
  state.invoices = [base(fields)]
  await open()
  expect(value('Name')).toBe('Legacy Customer'); expect(value('Email')).toBe('legacy@example.test'); expect(value('Phone')).toBe('0111')
  expect(state.updates).not.toHaveBeenCalled()
})
it('creates once with the returned number, selects in-app, remounts, and exports only explicitly', async () => {
  const view = await open()
  fireEvent(window, new CustomEvent('frameapp:new', { detail: { type: 'invoice' } }))
  await screen.findByText('Invoice: INV-1001')
  expect(state.rpc).toHaveBeenCalledTimes(1)
  expect(state.invoices).toHaveLength(2)
  expect(state.pdf).not.toHaveBeenCalled()
  expect(value('Name')).toBe('')
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'New recipient' } })
  await waitFor(() => expect(state.invoices[1].customerName).toBe('New recipient'))
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  expect(state.pdf).toHaveBeenCalledTimes(1)
  expect(state.pdf.mock.calls[0][0].invoice).toMatchObject({ number: 'INV-1001', customerName: 'New recipient' })
  const id = state.invoices[1].id
  view.unmount(); window.location.hash = `#/invoices?id=${id}`; render(<Invoices />)
  await screen.findByText('Invoice: INV-1001')
  expect(value('Name')).toBe('New recipient')
  expect(state.rpc).toHaveBeenCalledTimes(1)
})
it('selects a customer on a new standalone invoice and retains editable details on remount', async () => {
  const view = await open()
  fireEvent(window, new CustomEvent('frameapp:new', { detail: { type: 'invoice' } }))
  await screen.findByText('Invoice: INV-1001')
  fireEvent.change(screen.getByPlaceholderText('Type name or email...'), { target: { value: 'Current Customer' } })
  await waitFor(() => expect(state.invoices[1].customerId).toBe('c1'))
  expect(value('Name')).toBe('Current Customer'); expect(value('Email')).toBe('current@example.test')
  fireEvent.change(screen.getByPlaceholderText('Phone'), { target: { value: '07777' } })
  await waitFor(() => expect(state.invoices[1].customerPhone).toBe('07777'))
  const id = state.invoices[1].id
  view.unmount(); window.location.hash = `#/invoices?id=${id}`; render(<Invoices />)
  await screen.findByText('Invoice: INV-1001')
  expect(value('Name')).toBe('Current Customer'); expect(value('Phone')).toBe('07777')
  expect(state.rpc).toHaveBeenCalledTimes(1); expect(state.pdf).not.toHaveBeenCalled()
})
it('persists a Quote/Job-linked invoice once through the real hook and reopens its saved snapshot', async () => {
  state.invoices = []
  state.jobs = [{ id: 'j1', refNo: 'JOB-1000', quoteId: 'q1' }]
  state.quotes = [{ ...base(), id: 'q1', number: 'Q-1000', status: 'Accepted',
    customerSnapshot: { firstName: 'Historical', lastName: 'Customer', email: 'old@example.test' } }]
  window.location.hash = '#/quotes?id=q1'
  const view = render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/invoices\?id=/))
  expect(state.rpc).toHaveBeenCalledTimes(1); expect(state.invoices).toHaveLength(1)
  expect(state.invoices[0]).toMatchObject({ number: 'INV-1001', customerId: 'c1', quoteId: 'q1', total: 100 })
  expect(state.link).toHaveBeenCalledExactlyOnceWith('q1', state.invoices[0].id)
  expect(state.pdf).not.toHaveBeenCalled()
  view.unmount(); const invoiceView = render(<Invoices />)
  await screen.findByText('Invoice: INV-1001')
  expect(value('Name')).toBe('Historical Customer'); expect(value('Email')).toBe('old@example.test')
  expect(screen.getByRole('link', { name: 'Source Quote' }).getAttribute('href')).toBe('#/quotes?id=q1')
  expect(screen.getByRole('link', { name: 'View Job JOB-1000' }).getAttribute('href')).toBe('#/jobs?id=j1')
  invoiceView.unmount(); render(<Invoices />)
  await screen.findByText('Invoice: INV-1001')
  expect(value('Name')).toBe('Historical Customer')
  expect(state.rpc).toHaveBeenCalledTimes(1)
})
it('the explicit PDF action downloads a real document without changing the saved invoice', async () => {
  const { exportInvoicePDF } = await vi.importActual<typeof import('@/lib/pdf/invoicePdf')>('@/lib/pdf/invoicePdf')
  let document: Awaited<ReturnType<typeof exportInvoicePDF>> | undefined
  state.pdf.mockImplementationOnce(async args => { document = await exportInvoicePDF(args) })
  await open()
  const before = structuredClone(state.invoices)
  expect(state.download).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.download).toHaveBeenCalledExactlyOnceWith('Invoice_INV-1000.pdf'))
  expect(document!.output().startsWith('%PDF-')).toBe(true)
  expect(state.invoices).toEqual(before); expect(state.updates).not.toHaveBeenCalled()
})
