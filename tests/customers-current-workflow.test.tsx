import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const state = vi.hoisted(() => ({ rows: [] as Record<string, any>[], writes: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    if (table !== 'customers') throw new Error(`Unexpected table ${table}`)
    let operation = 'read'
    let payload: Record<string, any> = {}
    const filters: Record<string, string> = {}
    const execute = async () => {
      let rows = state.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value))
      if (operation !== 'read') state.writes(operation, structuredClone(payload), { ...filters })
      if (operation === 'insert') { state.rows.push(structuredClone(payload)); rows = [payload] }
      if (operation === 'update') { rows.forEach(row => Object.assign(row, payload)) }
      if (operation === 'delete') state.rows = state.rows.filter(row => !rows.includes(row))
      return { data: structuredClone(rows), error: null }
    }
    const query: any = {
      select: () => query,
      eq: (key: string, value: string) => { filters[key] = value; return query },
      order: execute,
      insert: (row: Record<string, any>) => { operation = 'insert'; payload = row; return query },
      update: (row: Record<string, any>) => { operation = 'update'; payload = row; return query },
      delete: () => { operation = 'delete'; return query },
      single: async () => { const result = await execute(); return { ...result, data: result.data[0] } },
      then: (resolve: any, reject: any) => execute().then(resolve, reject),
    }
    return query
  },
} }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: { companyName: 'Company A', currencyCode: 'GBP', currencySymbol: '£' } } }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: [] }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false, undo: vi.fn() }) }))
import Customers from '@/pages/Customers'

const access: BillingAccess = { companyAccountId: 'company-a', userId: 'owner-a', companyName: 'Company A', readOnly: false,
  hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
const source = '[{"id":"legacy-customer","firstName":"Legacy"}]'
beforeEach(() => {
  state.rows = [{ id: 'foreign', company_account_id: 'company-b', first_name: 'Foreign', last_name: 'Customer', email: 'foreign@example.invalid' }]
  state.writes.mockClear()
  localStorage.clear(); localStorage.setItem('customers_v1', source)
  window.location.hash = ''
})
afterEach(cleanup)

it('creates, edits, rereads and deletes through the real customer hook without importing browser data', async () => {
  const view = render(<Customers />, { wrapper: Wrapper })
  await waitFor(() => expect(screen.getByText('No customers match your filters.')).toBeTruthy())
  expect(state.writes).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'New customer' }))
  fireEvent.change(await screen.findByPlaceholderText('First name'), { target: { value: 'Current' } })
  fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Customer' } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'current@example.invalid' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save customer' }))
  await waitFor(() => expect(state.rows.find(row => row.company_account_id === 'company-a')?.first_name).toBe('Current'))
  expect(state.writes.mock.calls.map(call => call[0])).toEqual(['insert', 'update'])
  expect(state.writes.mock.calls[1][2]).toMatchObject({ company_account_id: 'company-a' })
  view.unmount()
  render(<Customers />, { wrapper: Wrapper })
  fireEvent.click(await screen.findByTitle('View Current Customer'))
  expect(screen.getByPlaceholderText('Email')).toHaveProperty('value', 'current@example.invalid')
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
  await waitFor(() => expect(state.rows).toHaveLength(1))
  expect(state.rows[0].id).toBe('foreign')
  expect(localStorage.getItem('customers_v1')).toBe(source)
})

it('keeps genuine customer CSV file selection and import operational', async () => {
  const view = render(<Customers />, { wrapper: Wrapper })
  fireEvent.click(screen.getByRole('button', { name: 'import customers' }))
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
  const click = vi.spyOn(input, 'click')
  fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
  expect(click).toHaveBeenCalledOnce()
  fireEvent.change(input, { target: { files: [new File(['firstName,lastName,email\nCSV,Customer,csv@example.invalid'], 'customers.csv', { type: 'text/csv' })] } })
  await waitFor(() => expect(state.rows.find(row => row.email === 'csv@example.invalid')).toMatchObject({ first_name: 'CSV', last_name: 'Customer', company_account_id: 'company-a' }))
  expect(await screen.findByTitle('View CSV Customer')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Import saved browser customers' })).toBeNull()
  expect(localStorage.getItem('customers_v1')).toBe(source)
  click.mockRestore()
})
