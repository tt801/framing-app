import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Customer, CustomerOpResult } from '@/lib/customers'
import type { Quote } from '@/lib/quotes'
import { jobFromQuote } from '@/lib/quoteJobLinkage'
import VisualizerApp from '@/VisualizerApp'
import Quotes from '@/pages/Quotes'
import ToastContainer from '@/components/ToastContainer'
import { useToast } from '@/lib/toast'

const state = vi.hoisted(() => ({
  customers: [] as Customer[],
  createCustomer: vi.fn<() => Promise<CustomerOpResult>>(),
  rows: [] as { id: string; customer_id: string; payload: Quote }[],
  insert: vi.fn(), quotePdf: vi.fn(), addInvoice: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  if (table !== 'quotes') throw new Error(`Unexpected table: ${table}`)
  const query = {
    select: () => query, eq: () => query,
    order: async () => ({ data: state.rows, error: null }),
    insert: (row: typeof state.rows[number]) => { state.insert(row); state.rows.push(structuredClone(row)); return query },
    single: async () => ({ data: state.rows.at(-1), error: null }),
  }
  return query
} } }))
vi.mock('@/lib/billingAccess', () => ({
  useBillingAccess: () => ({ companyAccountId: 'test-company', readOnly: false }),
  useBillingWriteGuard: () => () => true,
}))
vi.mock('@/lib/customers', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/customers')>(),
  useCustomers: () => ({ customers: state.customers, add: state.createCustomer }),
}))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: {
  frames: [{ id: 'f', name: 'UAT-H2 Frame', faceWidthCm: 2, pricePerMeter: 10 }],
  mats: [{ id: 'm', name: 'UAT-H2 Mat', pricePerSqM: 5 }],
  glazing: [{ id: 'g', name: 'UAT-H2 Glass', pricePerSqM: 8 }], printingMaterials: [],
  settings: { currencyCode: 'GBP', currencySymbol: '£', marginMultiplier: 1.25, labourBase: 120, taxRatePct: 15, taxLabel: 'VAT' },
} }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: [], loading: false }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: [], addInvoice: state.addInvoice }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/pdf/quotePdf', () => ({ exportQuotePDF: state.quotePdf }))
vi.mock('@/lib/pdf/invoicePdf', () => ({ exportInvoicePDF: vi.fn() }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: () => null }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => null }) }))

const customer: Customer = { id: 'customer-h2', firstName: 'UAT H2', lastName: 'Commercial',
  email: 'uat-h2@example.test', phone: '0123456789', company: 'Synthetic studio' }
beforeEach(() => {
  localStorage.clear(); state.rows = []; state.customers = [{ ...customer }]
  vi.clearAllMocks(); useToast.setState({ toasts: [] })
  state.createCustomer.mockResolvedValue({ ok: false, error: 'Customer save failed' })
  state.addInvoice.mockResolvedValue({ ok: true, invoice: { id: 'invoice-test', number: 'INV-test' } })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useToast.setState({ toasts: [] }); window.location.hash = '' })
function customerSelect() {
  return screen.getByText('Existing customer').parentElement!.querySelector('select')!
}
function renderVisualiser() {
  return render(<><VisualizerApp /><ToastContainer /></>)
}
function addQuote() { fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' })) }
function assertCustomer(quote: Quote, expected: Customer) {
  expect(quote).toMatchObject({ customerId: expected.id,
    customerName: `${expected.firstName} ${expected.lastName}`, customerSnapshot: expected,
    jobSpecification: { customerId: expected.id, customerSnapshot: expected, customer: expected } })
}

it('does not insert a quote or show success when no customer is resolved', async () => {
  renderVisualiser(); addQuote()
  await screen.findByText(/select.*customer/i, { selector: 'span' })
  expect(state.insert).not.toHaveBeenCalled()
  expect(state.rows).toHaveLength(0)
  expect(window.alert).not.toHaveBeenCalled()
  expect(useToast.getState().toasts).toEqual([expect.objectContaining({ type: 'error' })])
})

it('uses the newly created customer immediately without a CRM-list rerender', async () => {
  state.customers = []
  const created = { ...customer, id: 'new-customer', firstName: 'Returned', lastName: 'Customer' }
  state.createCustomer.mockResolvedValue({ ok: true, customer: created })
  renderVisualiser()
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Entered' } })
  fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Customer' } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'entered@example.test' } })
  addQuote()
  await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(1))
  expect(state.customers).toHaveLength(0)
  expect(state.rows[0].customer_id).toBe(created.id)
  assertCustomer(state.rows[0].payload, created)
})

it('preserves the selected customer after an unrelated rerender through persistence, PDF, Job and Invoice', async () => {
  const view = renderVisualiser()
  fireEvent.change(customerSelect(), { target: { value: customer.id } })
  // Change a design control, then rerender the parent without changing customer identity.
  fireEvent.change(screen.getAllByRole('option', { name: 'UAT-H2 Mat' })[0].closest('select')!, { target: { value: 'm' } })
  view.rerender(<><VisualizerApp /><ToastContainer /></>)
  expect(customerSelect().value).toBe(customer.id)
  addQuote()
  await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(1))
  expect(state.createCustomer).not.toHaveBeenCalled()
  const saved = state.rows[0].payload
  expect(state.rows[0].customer_id).toBe(customer.id)
  assertCustomer(saved, customer)
  expect(saved).toMatchObject({ subtotal: 175.75, tax: 26.36, total: 202.11,
    pricingSnapshot: { currencyCode: 'GBP', subtotal: 175.75, tax: 26.36, total: 202.11 } })
  const job = jobFromQuote({ ...saved, status: 'Accepted' })
  expect(job).toMatchObject({ customerId: customer.id, customerSnapshot: customer, customer,
    subtotal: 175.75, tax: 26.36, total: 202.11 })
  view.unmount()
  render(<Quotes />)
  await screen.findByRole('button', { name: 'PDF' })
  await act(async () => {})
  expect(screen.getAllByText('UAT H2 Commercial').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.quotePdf).toHaveBeenCalledTimes(1))
  expect(state.quotePdf.mock.calls[0][0]).toMatchObject({ customer, quote: { subtotal: 175.75, total: 202.11 } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(state.addInvoice).toHaveBeenCalledTimes(1))
  expect(state.addInvoice.mock.calls[0][0]).toMatchObject({ customerId: customer.id, customerSnapshot: customer,
    quoteId: saved.id, subtotal: 175.75, tax: 26.36, total: 202.11 })
})

it('rejects a selected customer that no longer resolves instead of inferring another customer', async () => {
  const view = renderVisualiser()
  fireEvent.change(customerSelect(), { target: { value: customer.id } })
  state.customers = [{ ...customer, id: 'different-customer' }]
  view.rerender(<><VisualizerApp /><ToastContainer /></>)
  addQuote()
  await screen.findByText(/selected customer is unavailable/i)
  expect(state.insert).not.toHaveBeenCalled()
  expect(state.createCustomer).not.toHaveBeenCalled()
  expect(window.alert).not.toHaveBeenCalled()
})

it('rejects invalid new customer details without trying to create a customer or quote', async () => {
  renderVisualiser()
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Partial' } })
  addQuote()
  await screen.findByText(/complete valid new customer details/i, { selector: 'span' })
  expect(state.createCustomer).not.toHaveBeenCalled()
  expect(state.insert).not.toHaveBeenCalled()
  expect(window.alert).not.toHaveBeenCalled()
})

it.each(['reported', 'thrown'])('does not save or show success after %s customer creation failure', async failure => {
  if (failure === 'thrown') state.createCustomer.mockRejectedValue(new Error('Customer save failed'))
  renderVisualiser()
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'New' } })
  fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Customer' } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.test' } })
  addQuote()
  await screen.findByText('Customer save failed')
  expect(state.createCustomer).toHaveBeenCalledTimes(1)
  expect(state.insert).not.toHaveBeenCalled()
  expect(state.rows).toHaveLength(0)
  expect(window.alert).not.toHaveBeenCalled()
  expect(useToast.getState().toasts.every(toast => toast.type === 'error')).toBe(true)
})

it('rejects an invalid customer identity returned by creation', async () => {
  state.createCustomer.mockResolvedValue({ ok: true, customer: { ...customer, id: '' } })
  renderVisualiser()
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'New' } })
  fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Customer' } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.test' } })
  addQuote()
  await screen.findByText(/could not resolve valid saved customer details/i)
  expect(state.insert).not.toHaveBeenCalled()
  expect(window.alert).not.toHaveBeenCalled()
})
