import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { priceSellingDocument, toVisualiserQuote, toVisualiserInvoice } from '@/lib/pricing'
// @ts-expect-error pdfjs-dist 3 exposes its legacy CommonJS build without declarations.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const state = vi.hoisted(() => ({ quotes: [] as Record<string, unknown>[], invoices: [] as Record<string, unknown>[], pdfCalls: 0 }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: state.invoices }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [{ id: 'c1', firstName: 'Alice', lastName: 'Example' }] }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: {
  companyName: 'Acceptance Frames', currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30,
} } }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false }) }))
vi.mock('@/lib/pdf/invoicePdf', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/pdf/invoicePdf')>()
  return { ...actual, exportInvoicePDF: async (args: Parameters<typeof actual.exportInvoicePDF>[0]) => {
    const doc = await actual.exportInvoicePDF({ ...args, download: false })
    state.pdfCalls++
    return doc
  } }
})
import Quotes from '@/pages/Quotes'
import Invoices from '@/pages/Invoices'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'

const snapshot = priceSellingDocument({ items: [{ id: 'frame', description: 'Oak frame', qty: 1, unitPrice: 175.75 }],
  currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 15, taxLabel: 'VAT' })
const invoice = { ...toVisualiserInvoice(snapshot), id: 'i1', number: 'INV-1200', customerId: 'c1', status: 'Sent' }
afterEach(cleanup)

describe('saved commercial currency and payment document acceptance', () => {
  it('generates an Invoice PDF through the actual screen action', async () => {
    state.invoices = [{ ...invoice, payments: [{ amount: 50 }] }]
    state.pdfCalls = 0
    render(<Invoices />)
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    await waitFor(() => expect(state.pdfCalls).toBe(1))
  })
  it.each(['GBP', { code: 'GBP', symbol: '£' }])('renders saved Quote currency %j rather than current company currency', currency => {
    state.quotes = [{ ...toVisualiserQuote(snapshot), currency, id: 'q1', number: 'Q-001', customerId: 'c1', status: 'Sent' }]
    render(<Quotes />)
    expect(screen.getAllByText('£202.11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('£175.75').length).toBeGreaterThan(0)
  })
  it.each([
    {},
    { currencyCode: undefined, currency: undefined },
    { pricingSnapshot: undefined, currencyCode: undefined, currency: 'GBP', currencySymbol: undefined },
    { pricingSnapshot: undefined, currencyCode: undefined, currency: { code: 'GBP', symbol: '£' }, currencySymbol: undefined },
  ])('renders saved Invoice values, payments and balance with currency fields %j', legacy => {
    state.invoices = [{ ...invoice, ...legacy, payments: [{ amount: 50 }] }]
    render(<Invoices />)
    expect(screen.getAllByText('£202.11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('£152.11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('£50.00').length).toBeGreaterThan(0)
  })
  it.each([{ paid: 50, balance: '152.11' }, { paid: 202.11, balance: '0.00' }])(
    'prints persisted invoice paid/balance values after a £$paid manual payment', async ({ paid, balance }) => {
      const doc = await exportInvoicePDF({ invoice: { ...invoice, payments: [{ amount: paid }] },
        customer: { firstName: 'Alice', lastName: 'Example', email: 'alice@example.invalid' },
        settings: { companyName: 'Acceptance Frames', currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30 }, download: false })
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
      const text: string[] = []
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent()
        text.push(content.items.map(item => 'str' in item ? item.str : '').join(' '))
      }
      const content = text.join(' ').replace(/\s+/g, ' ')
      for (const expected of ['Acceptance Frames', 'Alice Example', 'INV-1200', '175.75', '26.36', '202.11',
        'Amount paid', paid.toFixed(2), 'Balance due', balance]) expect(content).toContain(expected)
      expect(content).not.toContain('$202.11')
      await pdf.destroy()
    })
})
