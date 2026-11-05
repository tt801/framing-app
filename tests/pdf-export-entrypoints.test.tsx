import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { priceSellingDocument, toVisualiserInvoice } from '@/lib/pricing'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
const state = vi.hoisted(() => ({ invoices: [] as Record<string, unknown>[], quotes: [] as Record<string, unknown>[], documents: [] as string[], quotePdf: vi.fn() }))
const customers = [{ id: 'c1', firstName: 'Current', lastName: 'CRM', email: 'current@example.invalid' }]
const settings = { currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30, taxLabel: 'GST', companyName: 'Test Business', companyLogoDataUrl: '', invoiceFooterNote: 'Saved footer' }
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: state.invoices }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: [] }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers }), customersToCSV: vi.fn(), downloadCSV: vi.fn() }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings } }) }))
vi.mock('@/lib/company', () => ({ useCompany: () => ({ profile: { registrationNumber: 'REG-123', website: 'https://synthetic.example.invalid',
  bankName: 'Synthetic Bank', bankAccountNumber: '123456', bankBranchCode: '000', invoiceFooterNote: 'Profile footer' } }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/favorites', () => ({ useFavorites: () => ({ isFavorited: () => false, toggle: vi.fn() }) }))
vi.mock('@/lib/pdf/quotePdf', () => ({ exportQuotePDF: (...args: unknown[]) => state.quotePdf(...args) }))
vi.mock('@/lib/pdf/invoicePdf', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/pdf/invoicePdf')>()
  return { ...actual, exportInvoicePDF: async (args: Parameters<typeof actual.exportInvoicePDF>[0]) => {
    const doc = await actual.exportInvoicePDF({ ...args, download: false })
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
    const text = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      text.push((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '))
    }
    await pdf.destroy()
    state.documents.push(text.join(' ').replace(/\s+/g, ' '))
    return doc
  } }
})
import Invoices from '@/pages/Invoices'
import Customers from '@/pages/Customers'
import Quotes from '@/pages/Quotes'

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  state.documents = []; state.quotePdf.mockClear(); window.location.hash = ''
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('exports identical saved financial/customer content from Invoices and Customers', async () => {
  const snapshot = priceSellingDocument({ items: [{ description: 'Saved frame', qty: 3, unitPrice: 10 }], currencyCode: 'GBP', taxRatePct: 20, taxLabel: 'VAT' })
  state.invoices = [{ ...toVisualiserInvoice(snapshot), id: 'i1', number: 'INV-SAVED', customerId: 'c1',
    createdAt: '2025-01-02', dueDateISO: '2025-02-02', status: 'Sent', customerSnapshot: { firstName: 'Historical', lastName: 'Customer', email: 'saved@example.invalid' },
    customerEmail: '', payments: [{ amount: 10, createdAt: '2025-01-03', method: 'Cash' }] }]
  const view = render(<Invoices />)
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.documents).toHaveLength(1))
  view.unmount()
  render(<Customers />)
  fireEvent.click(screen.getByTitle('View Current CRM'))
  fireEvent.click(await screen.findByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.documents).toHaveLength(2))
  expect(state.documents[1]).toBe(state.documents[0])
  for (const expected of ['Historical Customer', '£36.00', '£26.00', 'VAT (20.00%)', 'Cash', 'Profile footer', 'REG-123', 'Synthetic Bank']) expect(state.documents[0]).toContain(expected)
  expect(state.documents[0]).not.toContain('saved@example.invalid')
  expect(state.documents[0]).not.toContain('Current CRM')
})

it('never falls back to internal-only quote notes and forwards saved tax/currency', async () => {
  state.quotes = [{ id: 'q1', number: 'Q-SAVED', status: 'Sent', createdAt: '2025-01-02', internalNotes: 'PRIVATE DISCOUNT STRATEGY',
    items: [{ name: 'Frame', qty: 1, unitPrice: 10, total: 10 }], subtotal: 10, tax: 2, taxRate: 0.2, total: 12,
    currencyCode: 'GBP', currencySymbol: '£', customerId: 'c1' }]
  render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.quotePdf).toHaveBeenCalledTimes(1))
  expect(state.quotePdf.mock.calls[0][0].quote).toMatchObject({ notes: '', tax: 2, taxRate: 0.2, currencyCode: 'GBP' })
})
