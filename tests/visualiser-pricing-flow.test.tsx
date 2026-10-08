import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
import VisualizerApp from '@/VisualizerApp'
import type { CommercialSnapshot } from '@/lib/pricing'

type Saved = {
  pricingSnapshot: CommercialSnapshot
  total: number
  subtotal: number
  tax: number
  items: { total: number; unitPrice: number; qty: number }[]
}
type PdfArgs = { invoice: Saved }
const captured = vi.hoisted(() => ({
  quotes: [] as Saved[], jobs: [] as Saved[], invoices: [] as Saved[], pdfs: [] as PdfArgs[], customers: [] as unknown[],
}))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: {
  frames: [{ id: 'f', name: 'Frame', faceWidthCm: 2, pricePerMeter: 10, color: '#000000' }],
  mats: [], glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }], printingMaterials: [],
  settings: { currencyCode: 'GBP', currencySymbol: '£', marginMultiplier: 1.25, labourBase: 120, taxRatePct: 15, taxLabel: 'VAT', printingPerSqM: 10 },
} }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [], add: async (payload: Saved) => { captured.quotes.push(payload); return { ok: true, quote: payload } } }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: async (payload: Saved) => { captured.jobs.push(payload); return { ok: true, job: payload } } }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ addInvoice: async (payload: Saved) => { const invoice = { ...payload, number: 'INV-1' }; captured.invoices.push(invoice); return { ok: true, invoice } } }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: captured.customers, add: async () => ({ ok: false }) }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ readOnly: false }) }))
vi.mock('@/lib/pdf/invoicePdf', () => ({ exportInvoicePDF: async (args: PdfArgs) => { captured.pdfs.push(args); return {} } }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: ({ onApply }: { onApply: (preset: unknown) => void }) =>
  <button onClick={() => onApply({ state: { frame: { id: 'supplier:00000000-0000-0000-0000-000000000003' } } })}>Load supplier preset</button> }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({
  supplierProducts: [], selectionIssue: (ids: string[]) => ids.find(id => id.startsWith('supplier:')) ? 'Supplier product unavailable' : null,
}) }))

const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }).format(n)

describe('Visualiser persistence uses its displayed commercial result', () => {
  it('does not price or persist a saved supplier reference as a fallback manual product', async () => {
    captured.quotes.length = 0; captured.jobs.length = 0; captured.invoices.length = 0
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<VisualizerApp />)
    fireEvent.click(screen.getByRole('button', { name: 'Load supplier preset' }))
    expect(alert.mock.calls).toEqual([])
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('supplier:00000000-0000-0000-0000-000000000003')
    expect(screen.getByText(/Supplier product unavailable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Invoices' }))
    await waitFor(() => expect(alert).toHaveBeenCalled())
    expect(captured.quotes).toHaveLength(0)
    expect(captured.jobs).toHaveLength(0)
    expect(captured.invoices).toHaveLength(0)
    alert.mockRestore()
  })
  it('writes identical pricing snapshots for Quote, Job and direct Invoice, and hands selling lines to PDF', async () => {
    captured.quotes.length = 0; captured.jobs.length = 0; captured.invoices.length = 0; captured.pdfs.length = 0
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<VisualizerApp />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Invoices' }))
    await waitFor(() => expect(captured.pdfs).toHaveLength(1))
    const [quote] = captured.quotes, [job] = captured.jobs, [invoice] = captured.invoices
    expect(quote.pricingSnapshot).toEqual(job.pricingSnapshot)
    expect(quote.pricingSnapshot).toEqual(invoice.pricingSnapshot)
    expect(quote.total).toBe(job.total)
    expect(quote.total).toBe(invoice.total)
    expect(quote.items.reduce((sum, line) => sum + line.total, 0)).toBe(quote.subtotal)
    expect(invoice.items.reduce((sum, line) => sum + line.unitPrice * line.qty, 0)).toBe(invoice.subtotal)
    expect(invoice.subtotal + invoice.tax).toBe(invoice.total)
    expect(captured.pdfs[0].invoice.items).toEqual(invoice.items)
    expect(screen.getByText(money(quote.total))).toBeTruthy()
  })
})
