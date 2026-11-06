import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import VisualizerApp from '@/VisualizerApp'
import ToastContainer from '@/components/ToastContainer'
import { useToast } from '@/lib/toast'

const state = vi.hoisted(() => ({
  company: 'company-a', user: 'user-a', issue: null as string | null,
  createCustomer: vi.fn(), updateCustomer: vi.fn(), quote: vi.fn(), job: vi.fn(), invoice: vi.fn(),
}))
const customer = { id: 'customer-a', firstName: 'Test', lastName: 'Customer', email: 'test@example.test' }
const customers = [customer, { ...customer, id: 'customer-b', firstName: 'Other' }]
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: {
  frames: [{ id: 'f', name: 'Frame', faceWidthCm: 2, pricePerMeter: 10 }], mats: [],
  glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }], printingMaterials: [],
  settings: { currencyCode: 'GBP', currencySymbol: '£', marginMultiplier: 1.25, labourBase: 120, taxRatePct: 15 },
} }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [], add: state.quote }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: state.job }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ addInvoice: state.invoice }) }))
vi.mock('@/lib/customers', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/customers')>(),
  useCustomers: () => ({ customers, add: state.createCustomer, update: state.updateCustomer }),
}))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: state.company, userId: state.user, readOnly: false }) }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => state.issue }) }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: ({ onApply }: { onApply: (preset: unknown) => void }) =>
  <button onClick={() => onApply({ get state() { throw new Error('Broken preset') } })}>Apply broken preset</button> }))

const view = () => <><VisualizerApp /><ToastContainer /></>
const selectCustomer = (id = customer.id) => fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: id } })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const messages = (): Array<{ message: string; type: string }> => useToast.getState().toasts.map(toast => ({ message: toast.message, type: toast.type }))
const deferred = () => { let resolve!: (result: any) => void; let reject!: (error: Error) => void; const promise = new Promise<any>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

beforeEach(() => {
  vi.resetAllMocks(); state.company = 'company-a'; state.user = 'user-a'; state.issue = null
  state.createCustomer.mockResolvedValue({ ok: true, customer })
  state.updateCustomer.mockResolvedValue({ ok: true, customer })
  state.quote.mockImplementation(async payload => ({ ok: true, quote: { ...payload, id: 'saved-quote' } }))
  state.job.mockResolvedValue({ ok: true, job: { id: 'saved-job', refNo: 42 } })
  state.invoice.mockResolvedValue({ ok: true, invoice: { id: 'saved-invoice', number: 'INV-42' } })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.location.hash = '#/app'
})
afterEach(() => {
  cleanup()
  for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id)
  vi.restoreAllMocks(); window.location.hash = ''
})

it('shows confirmed CRM creation success through the real store and container without alert', async () => {
  render(view()); click('Save to CRM')
  await screen.findByText('Saved to CRM (created).')
  expect(messages()).toEqual([{ type: 'success', message: 'Saved to CRM (created).' }])
  expect(state.createCustomer).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Existing customer').parentElement!.querySelector('select')!.value).toBe(customer.id)
  expect(window.alert).not.toHaveBeenCalled()
})

const operations = [
  { label: 'CRM create', button: 'Save to CRM', mock: 'createCustomer', existing: false, entity: 'customer' },
  { label: 'CRM update', button: 'Save to CRM', mock: 'updateCustomer', existing: true, entity: 'customer' },
  { label: 'quote', button: 'Add to Quotes', mock: 'quote', existing: true, entity: 'quote' },
  { label: 'job', button: 'Add to Jobs', mock: 'job', existing: true, entity: 'job' },
  { label: 'invoice', button: 'Add to Invoices', mock: 'invoice', existing: true, entity: 'invoice' },
] as const

it.each(operations)('handles returned $label errors with persistent verification guidance and no success', async op => {
  state[op.mock].mockResolvedValue({ ok: false, error: 'Saved record could not be read back' })
  render(view()); if (op.existing) selectCustomer(); click(op.button)
  expect((await screen.findByRole('alert')).textContent).toContain('Check Customers')
  expect(messages()).toEqual([{ type: 'error', message: expect.stringContaining('before retrying') }])
  expect(useToast.getState().toasts[0].duration).toBe(0)
  expect(window.location.hash).toBe('#/app')
  expect(window.alert).not.toHaveBeenCalled()
})

it.each(operations)('handles rejected $label promises without native alerts or false success', async op => {
  state[op.mock].mockRejectedValue(new Error('Connection interrupted'))
  render(view()); if (op.existing) selectCustomer(); click(op.button)
  expect((await screen.findByRole('alert')).textContent).toContain('Connection interrupted')
  expect(messages()).toEqual([{ type: 'error', message: expect.stringContaining('may already have been saved') }])
  expect(window.location.hash).toBe('#/app')
  expect(window.alert).not.toHaveBeenCalled()
})

it.each(operations)('does not report $label success for an unconfirmed result', async op => {
  state[op.mock].mockResolvedValue({ ok: true, [op.entity]: {} })
  render(view()); if (op.existing) selectCustomer(); click(op.button)
  await screen.findByRole('alert')
  expect(messages().every(message => message.type === 'error')).toBe(true)
  expect(window.location.hash).toBe('#/app')
  expect(window.alert).not.toHaveBeenCalled()
})

it.each(operations)('submits $label once while pending and releases the lock after failure', async op => {
  const request = deferred(); state[op.mock].mockReturnValueOnce(request.promise)
  render(view()); if (op.existing) selectCustomer()
  act(() => { click(op.button); click(op.button) })
  await waitFor(() => expect(state[op.mock]).toHaveBeenCalledTimes(1))
  expect((screen.getByRole('button', { name: op.button }) as HTMLButtonElement).disabled).toBe(true)
  expect(messages()).toEqual([])
  await act(async () => request.resolve({ ok: false, error: 'Unavailable' }))
  expect((screen.getByRole('button', { name: op.button }) as HTMLButtonElement).disabled).toBe(false)
  click(op.button)
  await waitFor(() => expect(state[op.mock]).toHaveBeenCalledTimes(2))
})

for (const context of ['company', 'customer', 'draft', 'unmount', 'route', 'user'] as const) {
  it.each(operations)(`suppresses late $label success and navigation after ${context} changes`, async op => {
    const request = deferred(); state[op.mock].mockReturnValue(request.promise)
    const rendered = render(view()); if (op.existing) selectCustomer(); click(op.button)
    await waitFor(() => expect(state[op.mock]).toHaveBeenCalledTimes(1))
    if (context === 'company') { state.company = 'company-b'; rendered.rerender(view()) }
    if (context === 'user') { state.user = 'user-b'; rendered.rerender(view()) }
    if (context === 'customer') selectCustomer('customer-b')
    if (context === 'draft') fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Changed during save' } })
    if (context === 'route') window.location.hash = '#/quotes'
    if (context === 'unmount') rendered.unmount()
    const route = window.location.hash
    await act(async () => request.resolve({ ok: true, [op.entity]: { id: 'late', refNo: 99 } }))
    expect(messages()).toEqual([])
    expect(window.location.hash).toBe(route)
    expect(window.alert).not.toHaveBeenCalled()
    if (context === 'customer') expect(screen.getByText('Existing customer').parentElement!.querySelector('select')!.value).toBe('customer-b')
  })
}

it.each(operations)('suppresses late $label errors after switching company away and back', async op => {
  const request = deferred(); state[op.mock].mockReturnValue(request.promise)
  const rendered = render(view()); if (op.existing) selectCustomer(); click(op.button)
  await waitFor(() => expect(state[op.mock]).toHaveBeenCalledTimes(1))
  state.company = 'company-b'; rendered.rerender(view())
  state.company = 'company-a'; rendered.rerender(view())
  await act(async () => request.reject(new Error('Late rejection')))
  expect(messages()).toEqual([])
  expect(window.alert).not.toHaveBeenCalled()
})

it.each([
  ['Save to CRM', 'Saved to CRM (updated).'],
  ['Add to Quotes', 'Quote Q-001 created.'],
  ['Add to Jobs', 'Job 42 created and added to Jobs.'],
])('renders confirmed %s success', async (button, message) => {
  render(view()); selectCustomer(); click(button)
  await screen.findByText(message)
  expect(messages()).toEqual([{ type: 'success', message }])
  expect(window.alert).not.toHaveBeenCalled()
})

it('keeps successful invoice navigation without adding a success notification', async () => {
  render(view()); selectCustomer(); click('Add to Invoices')
  await waitFor(() => expect(window.location.hash).toBe('#/invoices?id=saved-invoice'))
  expect(messages()).toEqual([])
  expect(window.alert).not.toHaveBeenCalled()
})

it('keeps supplier warnings inline and blocks every individual document with warning toasts', async () => {
  state.issue = 'Supplier product unavailable'
  render(view())
  expect(screen.getByRole('alert').textContent).toContain('select a manual product')
  for (const button of ['Add to Quotes', 'Add to Jobs', 'Add to Invoices']) {
    await act(async () => click(button))
  }
  expect(messages()).toHaveLength(3)
  expect(messages().every(message => message.type === 'warning' && message.message.includes('Choose a manual product'))).toBe(true)
  expect(state.createCustomer).not.toHaveBeenCalled()
  expect(state.quote).not.toHaveBeenCalled(); expect(state.job).not.toHaveBeenCalled(); expect(state.invoice).not.toHaveBeenCalled()
  expect(window.alert).not.toHaveBeenCalled()
})

it('uses an error toast when preset application fails', () => {
  render(view()); click('Apply broken preset')
  expect(messages()).toEqual([{ type: 'error', message: 'Could not apply this preset. It may be from an older version.' }])
  expect(window.alert).not.toHaveBeenCalled()
})

it.each(['Add to Quotes', 'Add to Jobs', 'Add to Invoices'])('does not continue %s after customer creation resolves in a different context', async button => {
  const request = deferred(); state.createCustomer.mockReturnValue(request.promise)
  const rendered = render(view())
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'New' } })
  fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Customer' } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.test' } })
  click(button); await waitFor(() => expect(state.createCustomer).toHaveBeenCalledTimes(1))
  state.company = 'company-b'; rendered.rerender(view())
  await act(async () => request.resolve({ ok: true, customer }))
  expect(state.quote).not.toHaveBeenCalled(); expect(state.job).not.toHaveBeenCalled(); expect(state.invoice).not.toHaveBeenCalled()
  expect(messages()).toEqual([])
})

it('preserves the combined workflow native success alerts and invoice navigation', async () => {
  render(view()); selectCustomer(); click('Create Quote + Invoice + Job')
  await waitFor(() => expect(window.location.hash).toBe('#/invoices?id=saved-invoice'))
  expect(state.quote).toHaveBeenCalledTimes(1); expect(state.job).toHaveBeenCalledTimes(1); expect(state.invoice).toHaveBeenCalledTimes(1)
  expect(window.alert).toHaveBeenNthCalledWith(1, 'Quote Q-001 created.')
  expect(window.alert).toHaveBeenNthCalledWith(2, 'Job 42 created and added to Jobs.')
  expect(messages()).toEqual([])
})

it('preserves the combined workflow catch notification', async () => {
  state.quote.mockRejectedValue(new Error('Combined failure'))
  render(view()); selectCustomer(); click('Create Quote + Invoice + Job')
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Could not create Quote + Invoice + Job. Please check the console for details.'))
  expect(state.job).not.toHaveBeenCalled(); expect(state.invoice).not.toHaveBeenCalled()
  expect(messages()).toEqual([])
})
