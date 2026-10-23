import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoice, Payment } from '@/lib/invoices'

const state = vi.hoisted(() => ({ invoice: {} as Invoice, failAfterAppend: false, defer: false,
  release: null as null | (() => void), rpc: vi.fn(), updates: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: 'company-a', readOnly: false }), useBillingWriteGuard: () => () => true }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: { currencyCode: 'GBP', currencySymbol: '£' } } }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: [] }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [] }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: state.toast }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    if (table !== 'invoices') throw new Error(`Unexpected table ${table}`)
    let patch: { payload: Invoice } | undefined
    const row = () => ({ id: state.invoice.id, invoice_number: state.invoice.number, customer_id: null, quote_id: null, payload: structuredClone(state.invoice) })
    const query = { select: () => query, eq: () => query,
      order: async () => ({ data: [row()], error: null }),
      update: (value: { payload: Invoice }) => { patch = value; state.updates(value); return query },
      single: async () => { if (patch) state.invoice = structuredClone(patch.payload); return { data: row(), error: null } },
    }
    return query
  },
} }))
import Invoices from '@/pages/Invoices'

beforeEach(() => {
  localStorage.clear(); window.location.hash = '#/invoices?id=i1'; vi.clearAllMocks()
  state.failAfterAppend = false; state.defer = false; state.release = null
  state.invoice = { id: 'i1', number: 'INV-1000', createdAt: '2026-10-20', status: 'Sent',
    currencyCode: 'GBP', currencySymbol: '£', items: [{ id: 'frame', description: 'Frame', qty: 1, unitPrice: 175.75 }],
    subtotal: 175.75, taxRate: 0.15, tax: 26.36, total: 202.11, payments: [] }
  state.rpc.mockImplementation(async (name: string, args: { p_payment: Payment }) => {
    expect(name).toBe('append_invoice_payment')
    if (state.defer) await new Promise<void>(resolve => { state.release = resolve })
    if (!state.invoice.payments!.some(p => p.id === args.p_payment.id)) state.invoice.payments!.push(structuredClone(args.p_payment))
    if (state.failAfterAppend) { state.failAfterAppend = false; return { data: null, error: { message: 'Response lost; retry payment' } } }
    return { data: { id: 'i1', invoice_number: 'INV-1000', customer_id: null, quote_id: null, payload: structuredClone(state.invoice) }, error: null }
  })
})
afterEach(() => { cleanup(); window.location.hash = ''; vi.restoreAllMocks() })

async function open() { const view = render(<Invoices />); await screen.findByText('Invoice: INV-1000'); return view }
function amount(value: string) { fireEvent.change(screen.getByLabelText('Payment amount'), { target: { value } }) }
function summary(label: string) { return within(screen.getAllByText(label, { exact: true }).at(-1)!.parentElement!).getByText(/£/) }

describe('manual invoice payments through the real invoice hook', () => {
  it('records £50 then Mark Paid settles only £152.11, surviving a reread', async () => {
    const view = await open()
    amount('50'); fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(summary('Paid').textContent).toBe('£50.00'))
    expect(summary('Balance due').textContent).toBe('£152.11')
    expect(state.invoice.status).toBe('Sent')
    expect(state.rpc).toHaveBeenCalledTimes(1)
    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_company_account_id: 'company-a', p_invoice_id: 'i1', p_payment: { amount: 50, method: 'Manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }))
    await waitFor(() => expect(state.invoice.status).toBe('Paid'))
    expect(state.invoice.payments!.map(p => p.amount)).toEqual([50, 152.11])
    expect(new Set(state.invoice.payments!.map(p => p.id)).size).toBe(2)
    expect(summary('Paid').textContent).toBe('£202.11')
    expect(summary('Balance due').textContent).toBe('£0.00')
    view.unmount(); await open()
    expect(summary('Paid').textContent).toBe('£202.11')
    expect(summary('Balance due').textContent).toBe('£0.00')
  })

  it.each(['0', '-1', '202.12', ''])('rejects invalid manual amount %s without persistence', async value => {
    await open(); amount(value)
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.updates).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/amount|balance/i)
  })

  it('locks duplicate submissions and settlement while a payment is pending', async () => {
    state.defer = true; await open(); amount('50')
    const button = screen.getByRole('button', { name: 'Record payment' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1))
    expect((screen.getByRole('button', { name: 'Mark Paid' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Concurrent edit' } })
    expect(state.updates).not.toHaveBeenCalled()
    state.release!()
    await waitFor(() => expect(summary('Paid').textContent).toBe('£50.00'))
  })

  it('reuses the same payment ID after an ambiguous response instead of double charging', async () => {
    state.failAfterAppend = true; await open(); amount('50')
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await screen.findByText(/Response lost/)
    expect((screen.getByRole('button', { name: 'Mark Paid' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry payment' }))
    await waitFor(() => expect(summary('Paid').textContent).toBe('£50.00'))
    expect(state.rpc.mock.calls[0][1].p_payment).toEqual(state.rpc.mock.calls[1][1].p_payment)
    expect(state.invoice.payments).toHaveLength(1)
  })

  it('rejects amounts above the remaining balance after a partial payment', async () => {
    await open(); amount('50')
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(summary('Paid').textContent).toBe('£50.00'))
    amount('152.12'); fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(screen.getByRole('alert').textContent).toMatch(/outstanding balance/)
    expect(state.rpc).toHaveBeenCalledTimes(1)
  })

  it('allows an exact-balance manual payment and persists Paid without a second payment', async () => {
    const view = await open(); amount('202.11')
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(state.invoice.status).toBe('Paid'))
    expect(state.invoice.payments!.map(p => p.amount)).toEqual([202.11])
    expect(state.rpc).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull()
    view.unmount(); await open()
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull()
    expect(summary('Paid').textContent).toBe('£202.11')
    expect(summary('Balance due').textContent).toBe('£0.00')
  })
})
