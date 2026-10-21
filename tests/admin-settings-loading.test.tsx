import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog } from '@/lib/store'
import * as companyModule from '@/lib/company'
import Admin from '@/pages/Admin'

const state = vi.hoisted(() => ({
  settings: { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0, companyName: 'UAT Block1 Finish C' },
  catalog: null as null | { settings: Record<string, unknown> },
  reads: [] as Array<() => void>,
  defer: true,
  failRead: false,
  saves: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let pending: { settings: typeof state.settings } | undefined
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: () => {
        const result = () => table === 'company_settings'
          ? { data: state.failRead ? null : { settings: structuredClone(state.settings) }, error: state.failRead ? { message: 'Settings unavailable' } : null }
          : { data: state.catalog ? { catalog: structuredClone(state.catalog), revision: 1 } : null, error: null }
        if (state.defer) return new Promise(resolve => { state.reads.push(() => resolve(result())) })
        return Promise.resolve(result())
      },
      upsert: (row: { settings: typeof state.settings }) => { pending = row; return query },
      single: async () => {
        state.settings = structuredClone(pending!.settings)
        state.saves(state.settings)
        return { data: { settings: state.settings }, error: null }
      },
    }
    return query
  },
} }))
const access: BillingAccess = { companyAccountId: 'company-c', userId: 'owner-c', companyName: 'UAT Block1 Finish C', readOnly: false,
  hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
beforeEach(() => {
  localStorage.clear()
  state.settings = { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0, companyName: 'UAT Block1 Finish C' }
  state.catalog = null
  state.reads = []; state.defer = true; state.failRead = false; state.saves.mockClear()
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function finishLoading() {
  await act(async () => { state.defer = false; state.reads.splice(0).forEach(resolve => resolve()) })
}
function changeTax(value: string) {
  const heading = screen.getByText('Default tax rate (%)').parentElement!
  fireEvent.change(heading.querySelector('input')!, { target: { value } })
}

it('loads persisted GBP after the temporary ZAR profile and preserves GBP when saving only tax', async () => {
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  expect(reader.result.current.catalog.settings.currencyCode).toBe('ZAR')
  const view = render(<Admin />, { wrapper: Wrapper })
  await finishLoading()
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('GBP'))
  expect((screen.getByDisplayValue('£') as HTMLInputElement).readOnly).toBe(true)
  changeTax('15')
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(state.saves).toHaveBeenCalledTimes(1))
  expect(state.settings).toMatchObject({ currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 15 })
  view.unmount(); reader.unmount()
  render(<Admin />, { wrapper: Wrapper })
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('GBP'))
  expect((screen.getByText('Default tax rate (%)').parentElement!.querySelector('input') as HTMLInputElement).value).toBe('15')
})

it('does not expose a saveable temporary draft while settings are loading', async () => {
  render(<Admin />, { wrapper: Wrapper })
  expect(screen.getByRole('status').textContent).toContain('Loading settings')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
  expect(state.saves).not.toHaveBeenCalled()
  await finishLoading()
})

it('preserves an intentional currency edit across unrelated rerenders and saves its matching symbol', async () => {
  const useCompany = companyModule.useCompany
  // Keep the real hook and persistence path, but simulate fresh profile objects
  // on parent rerenders so a settings-dependent resync effect would lose EUR.
  function useFreshCompany() {
    const company = useCompany()
    return { ...company, profile: { ...company.profile } }
  }
  vi.spyOn(companyModule, 'useCompany').mockImplementation(useFreshCompany)
  const view = render(<Admin />, { wrapper: Wrapper })
  await finishLoading()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EUR' } })
  changeTax('15')
  view.rerender(<Admin />)
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('EUR')
  expect(screen.getByDisplayValue('€')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(state.saves).toHaveBeenCalledTimes(1))
  expect(state.settings).toMatchObject({ currencyCode: 'EUR', currencySymbol: '€', taxRatePct: 15 })
  // The save creates a fresh normalized company profile; it must not reset the draft.
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('EUR')
})

it('does not expose a saveable default draft if the company settings read fails', async () => {
  state.failRead = true
  render(<Admin />, { wrapper: Wrapper })
  await finishLoading()
  expect(screen.getByRole('alert').textContent).toContain('Settings unavailable')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
  expect(state.saves).not.toHaveBeenCalled()
})

it('initializes sibling draft fields from both loaded sources rather than temporary defaults', async () => {
  Object.assign(state.settings, { invoicePrefix: 'UAT-', taxRatePct: 12 })
  state.catalog = { settings: {
    defaultPaymentTerms: 'Within 30 days', nextInvoiceNumber: 4321,
    invoiceFooterNote: 'Loaded footer', foamBackerEnabled: true,
  } }
  render(<Admin />, { wrapper: Wrapper })
  await finishLoading()
  expect(screen.getByDisplayValue('UAT-')).toBeTruthy()
  expect((screen.getByText('Default tax rate (%)').parentElement!.querySelector('input') as HTMLInputElement).value).toBe('12')
  expect(screen.getByDisplayValue('Within 30 days')).toBeTruthy()
  expect(screen.getByDisplayValue('4321')).toBeTruthy()
  expect(screen.getByDisplayValue('Loaded footer')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(state.saves).toHaveBeenCalledTimes(1))
  expect(state.settings).toMatchObject({
    invoicePrefix: 'UAT-', taxRatePct: 12, defaultPaymentTerms: 'Within 30 days',
    nextInvoiceNumber: 4321, invoiceFooterNote: 'Loaded footer', foamBackerEnabled: true,
  })
})
