import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ quotes: [] as any[], invoices: [] as any[], jobs: [] as any[], toast: vi.fn(), write: vi.fn() }))
const customers = [{ id: 'c1', firstName: 'Jamie', lastName: '50% & Co', email: 'jamie@example.invalid', phone: '+44 7000 123456' }]
const settings = { companyName: 'Oak & Linen', currencyCode: 'USD', currencySymbol: '$', jobReadyMessageTemplate: 'Old catalogue template' }
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: state.invoices, save: state.write }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: state.jobs, loading: false, update: state.write }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers, loading: false }), customersToCSV: vi.fn(), downloadCSV: vi.fn() }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings } }) }))
vi.mock('@/lib/company', () => ({ useCompany: () => ({ profile: { jobReadyMessageTemplate: 'Hello {{customerName}}, collect {{jobId}} from {{companyName}}.' } }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: state.toast }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/favorites', () => ({ useFavorites: () => ({ isFavorited: () => false, toggle: vi.fn() }) }))
import Quotes from '@/pages/Quotes'
import Invoices from '@/pages/Invoices'
import Jobs from '@/pages/Jobs'
import Customers from '@/pages/Customers'
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  state.quotes = [{ id: 'q1', number: 'Q-SAVED', status: 'Sent', customerId: 'c1', total: 120, subtotal: 100, tax: 20, currencyCode: 'GBP', items: [] }]
  state.invoices = [{ ...state.quotes[0], id: 'i1', number: 'INV-SAVED', payments: [{ amount: 30 }] }]
  state.jobs = [{ id: 'j1', refNo: 'JOB-FULL-1234567890', status: 'completed', customerId: 'c1', currency: { code: 'GBP' }, total: 120 }]
  state.toast.mockClear(); state.write.mockClear(); window.location.hash = ''
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function draft() {
  const link = screen.getByRole('link', { name: 'Open email draft' })
  const body = new URL(link.getAttribute('href')!).searchParams.get('body')!
  link.addEventListener('click', event => event.preventDefault(), { once: true })
  fireEvent.click(link)
  expect(state.write).not.toHaveBeenCalled()
  expect(state.toast).not.toHaveBeenCalled()
  return body
}
it('opens a Quote draft using saved currency and explains manual PDF attachment', () => {
  render(<Quotes />)
  expect(draft()).toContain('Quote total: £120.00')
  expect(screen.getByText(/attach the downloaded PDF manually/i)).toBeTruthy()
})
it('opens an Invoice draft with payment evidence and no automatic attachment', () => {
  render(<Invoices />)
  expect(draft()).toContain('Balance remaining: £90.00')
  expect(screen.getByText(/attach the downloaded PDF manually/i)).toBeTruthy()
})
it('opens a collection draft from the configured template and full saved reference', () => {
  window.location.hash = '#/jobs?id=j1'
  render(<Jobs />)
  expect(draft()).toContain('collect JOB-FULL-1234567890 from Oak & Linen.')
  expect(screen.getByRole('link', { name: 'Open WhatsApp draft' }).getAttribute('href')).not.toContain('Total%20due')
})
it('opens a customer account update with recorded invoice currency and payments', () => {
  render(<Customers />)
  fireEvent.click(screen.getByTitle('View Jamie 50% & Co'))
  expect(draft()).toContain('GBP: £90.00')
})
