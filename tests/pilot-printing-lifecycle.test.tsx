import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog } from '@/lib/store'
import { useQuotes } from '@/lib/quotes'
import { useJobs } from '@/lib/jobs'
import { useInvoices } from '@/lib/invoices'
import { invoiceBalance, invoiceFromQuote } from '@/lib/commercialDocuments'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
import Admin from '@/pages/Admin'
import VisualizerApp from '@/VisualizerApp'
// @ts-expect-error legacy PDF parser has no matching declaration path.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const state = vi.hoisted(() => ({ tables: new Map<string, any[]>(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    const filters: [string, unknown][] = []
    let inserted: any, patch: any
    const execute = (single = false) => {
      if (!state.tables.has(table)) throw new Error(`Unexpected table ${table}`)
      const rows = state.tables.get(table)!
      if (inserted) { rows.push(structuredClone(inserted)); inserted = undefined }
      const matched = rows.filter(row => filters.every(([key, value]) => row[key] === value))
      if (patch) matched.forEach(row => Object.assign(row, structuredClone(patch), { updated_at: '2' }))
      return { data: structuredClone(single ? matched[0] ?? null : matched), error: null }
    }
    const query = { select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      insert: (row: unknown) => { inserted = row; return query },
      update: (value: unknown) => { patch = value; return query },
      single: async () => execute(true), maybeSingle: async () => execute(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return query
  },
} }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => null }) }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: ({ onApply }: { onApply: (value: unknown) => void }) =>
  <button onClick={() => onApply({ state: { frame: { id: 'f' }, glazing: { id: 'g' }, printing: { includePrint: true, printMaterialId: 'p' } } })}>Load printing design</button> }))
const billing: BillingAccess = { companyAccountId: 'pilot', userId: 'owner', readOnly: false, hasFullAccess: true,
  canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={billing}>{children}</BillingAccessProvider>
beforeEach(() => {
  localStorage.clear()
  state.tables.clear()
  state.tables.set('company_settings', [{ company_account_id: 'pilot', settings: { currencyCode: 'GBP', currencySymbol: '£',
    companyName: 'Synthetic Pilot', taxRatePct: 15, taxLabel: 'VAT', labourBase: 10, marginMultiplier: 1.25, invoicePrefix: 'INV-', invoiceStartNumber: 1001 } }])
  state.tables.set('company_catalog', [{ company_account_id: 'pilot', revision: 1, catalog: {
    frames: [{ id: 'f', name: 'Frame', pricePerMeter: 10, faceWidthCm: 2 }], mats: [],
    glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }], printingMaterials: [{ id: 'p', name: 'Pilot paper', pricePerSqM: 7, costPerSqm: 99 }],
    backers: [], settings: { foamBackerPerSqM: 0 },
  } }])
  state.tables.set('customers', [{ id: 'c', company_account_id: 'pilot', first_name: 'Synthetic', last_name: 'Customer', email: 'pilot@example.test' }])
  for (const table of ['quotes', 'jobs', 'invoices']) state.tables.set(table, [])
  state.rpc.mockReset().mockImplementation(async (name: string, args: any) => {
    if (name === 'update_company_catalog') {
      const row = state.tables.get('company_catalog')![0]
      if (row.revision !== args.p_revision) return { data: null, error: { code: '40001', message: 'Conflict' } }
      row.catalog = structuredClone(args.p_catalog); row.revision++
      return { data: structuredClone(row), error: null }
    }
    if (name === 'append_invoice_payment') {
      const row = state.tables.get('invoices')!.find(row => row.id === args.p_invoice_id)!
      row.payload.payments.push(structuredClone(args.p_payment))
      return { data: structuredClone(row), error: null }
    }
    if (name !== 'create_job' && name !== 'create_invoice') throw new Error(`Unexpected RPC ${name}`)
    const table = name === 'create_job' ? 'jobs' : 'invoices'
    const row = { id: args.p_id, company_account_id: args.p_company_account_id, customer_id: args.p_customer_id,
      quote_id: args.p_quote_id, invoice_id: args.p_invoice_id ?? null, payload: structuredClone(args.p_payload),
      ref_no: 1001, invoice_number: `${args.p_prefix}${args.p_start_number}`, updated_at: '1', created_at: '2026-11-16T00:00:00Z' }
    state.tables.get(table)!.push(row)
    return { data: structuredClone(row), error: null }
  })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External transport forbidden') }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.location.hash = '' })

it('carries the actual Admin printing rate through Visualiser, linked persisted records, payment, reload and real PDFs', async () => {
  const admin = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Printing' }))
  const row = (await screen.findByDisplayValue('Pilot paper')).closest('tr')!
  fireEvent.change(within(row).getByLabelText('Base material rate'), { target: { value: '25' } })
  await waitFor(() => expect(state.tables.get('company_catalog')![0].catalog.printingMaterials[0]).toMatchObject({ pricePerSqM: 25, costPerSqm: 99 }))
  admin.unmount()
  const visualiser = render(<VisualizerApp />, { wrapper: Wrapper })

  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Load printing design' }))
  await screen.findByRole('option', { name: /Pilot paper/ })
  await screen.findByRole('option', { name: /Synthetic Customer/ })
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'c' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.tables.get('quotes')).toHaveLength(1))
  const saved = structuredClone(state.tables.get('quotes')![0].payload)
  expect(saved.pricingSnapshot.items.find((line: any) => line.key === 'print')).toMatchObject({ productId: 'p', qty: 0.12, unit: 'm²', rawAmount: 3, unitPrice: 31.25, lineTotal: 3.75 })
  expect(saved).toMatchObject({ subtotal: 34.95, tax: 5.24, total: 40.19, currencyCode: 'GBP' })
  expect(saved.pricingSnapshot.quantityBasis).toBe('material')
  visualiser.unmount()
  const hook = renderHook(() => ({ quotes: useQuotes(), jobs: useJobs(), invoices: useInvoices(), catalog: useCatalog() }), { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.quotes.quotes).toHaveLength(1))
  const quote = hook.result.current.quotes.quotes[0]
  await act(async () => { expect((await hook.result.current.quotes.update({ id: quote.id, status: 'Accepted' })).ok).toBe(true) })
  await act(async () => { expect((await hook.result.current.jobs.createFromQuote(quote.id)).ok).toBe(true) })
  await act(async () => { expect((await hook.result.current.invoices.addInvoice({ ...invoiceFromQuote({ ...quote, status: 'Accepted' }), customerSnapshot: quote.customerSnapshot })).ok).toBe(true) })
  const invoiceId = hook.result.current.invoices.invoices[0].id
  await act(async () => { expect((await hook.result.current.jobs.linkInvoiceFromQuote(quote.id, invoiceId)).ok).toBe(true) })
  await act(async () => { expect((await hook.result.current.invoices.addPayment(invoiceId, { id: 'pay', amount: 10, method: 'cash', dateISO: '2026-11-16' })).ok).toBe(true) })
  hook.unmount()
  state.tables.get('company_settings')![0].settings = { currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30, taxLabel: 'GST', marginMultiplier: 5 }
  state.tables.get('company_catalog')![0].catalog.printingMaterials[0].pricePerSqM = 999
  const reload = renderHook(() => ({ quotes: useQuotes(), jobs: useJobs(), invoices: useInvoices() }), { wrapper: Wrapper })
  await waitFor(() => expect(reload.result.current.invoices.invoices).toHaveLength(1))
  await waitFor(() => expect(reload.result.current.jobs.jobs).toHaveLength(1))
  const q = reload.result.current.quotes.quotes[0], j = reload.result.current.jobs.jobs[0], i = reload.result.current.invoices.invoices[0]
  expect(j).toMatchObject({ quoteId: quote.id, invoiceId, customerId: 'c' })
  expect(i).toMatchObject({ quoteId: quote.id, customerId: 'c' })
  for (const doc of [q, j, i]) expect(doc.pricingSnapshot).toEqual(saved.pricingSnapshot)
  expect(invoiceBalance(i)).toBe(30.19)
  const settings = { companyName: 'Synthetic Pilot', currencyCode: 'USD', currencySymbol: '$', taxLabel: 'GST', taxRatePct: 30 }
  const documents = [await exportQuotePDF({ quote: q, customer: q.customerSnapshot, settings, download: false }),
    await exportJobCardPDF({ job: j, settings, download: false }), await exportInvoicePDF({ invoice: i, settings, download: false })]
  const texts: string[] = []
  for (const doc of documents) {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
    let text = ''
    for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map((item: any) => item.str ?? '').join(' ')
    texts.push(text)
    expect(text).toContain('£40.19'); expect(text).toContain('£5.24'); expect(text).not.toContain('$40.19')
  }
  expect(texts[0]).toContain('Printing (Pilot paper)'); expect(texts[0]).toContain('£3.75')
  expect(texts[2]).toContain('Printing (Pilot paper)'); expect(texts[2]).toContain('£3.75')
  expect(texts[1]).toContain('Printing'); expect(texts[1]).toContain('On')
  expect(texts[2]).toContain('£10.00'); expect(texts[2]).toContain('£30.19')
})
