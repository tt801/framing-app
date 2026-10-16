import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { priceSellingDocument, toVisualiserQuote } from '@/lib/pricing'
import { invoiceBalance, invoiceFromQuote } from '@/lib/commercialDocuments'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
// @ts-expect-error pdfjs-dist legacy CommonJS build lacks its declaration path.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const state = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>(), rpc: vi.fn() }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: {
  currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30, marginMultiplier: 5, invoicePrefix: 'INV-', invoiceStartNumber: 1200,
} } }) }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    const filters: [string, unknown][] = []
    let patch: Record<string, unknown> | undefined, single = false
    const execute = () => {
      const rows = (state.tables.get(table) || []).filter(row => filters.every(([key, value]) => row[key] === value))
      if (patch) rows.forEach(row => Object.assign(row, patch, { updated_at: `${Number(row.updated_at) + 1}` }))
      return single ? { data: rows.length === 1 ? structuredClone(rows[0]) : null, error: rows.length === 1 ? null : { message: 'Record not found' } }
        : { data: structuredClone(rows), error: null }
    }
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      update: (value: Record<string, unknown>) => { patch = value; return query },
      single: () => { single = true; return Promise.resolve(execute()) },
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return query
  },
} }))
import { useJobs } from '@/lib/jobs'
import { useInvoices } from '@/lib/invoices'
const billing: BillingAccess = { readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false,
  isPastDue: false, statusMessage: '', companyAccountId: 'company-a', companyName: 'A', userId: 'owner-a' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={billing}>{children}</BillingAccessProvider>
const agreement = priceSellingDocument({ items: [{ description: 'Frame', qty: 1, unitPrice: 175.75 }], currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 15 })
beforeEach(() => {
  state.tables.clear()
  state.tables.set('jobs', [])
  state.tables.set('quotes', [{ id: 'q1', company_account_id: 'company-a', customer_id: 'c1', payload: {
    ...toVisualiserQuote(agreement), id: 'q1', status: 'Accepted', customerId: 'c1',
    jobSpecification: { artwork: { widthCm: 40, heightCm: 30 }, frame: { id: 'oak' },
      details: { dims: { art: { widthCm: 40, heightCm: 30 } } }, customerSnapshot: { id: 'c1', firstName: 'Saved' }, checklist: [] },
  } }])
  state.tables.set('invoices', [{ id: 'i1', company_account_id: 'company-a', quote_id: 'q1', customer_id: 'c1' }])
  state.rpc.mockReset().mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    if (_name === 'create_invoice') {
      const rows = state.tables.get('invoices')!
      const row = { id: args.p_id, company_account_id: args.p_company_account_id, customer_id: args.p_customer_id,
        quote_id: args.p_quote_id, invoice_number: `${args.p_prefix}${args.p_start_number}`,
        payload: args.p_payload, created_at: '2026-10-16T00:00:00Z' }
      rows.push(row)
      return { data: structuredClone(row), error: null }
    }
    if (_name === 'append_invoice_payment') {
      const row = state.tables.get('invoices')!.find(invoice => invoice.id === args.p_invoice_id && invoice.company_account_id === args.p_company_account_id)!
      const payload = row.payload as { payments: unknown[] }
      payload.payments.push(args.p_payment)
      return { data: structuredClone(row), error: null }
    }
    const jobs = state.tables.get('jobs')!
    if (jobs.some(job => job.id === args.p_id)) return { data: null, error: { message: 'duplicate key', code: '23505' } }
    const job = { id: args.p_id, company_account_id: args.p_company_account_id, customer_id: args.p_customer_id,
      quote_id: args.p_quote_id, invoice_id: null, payload: args.p_payload, ref_no: 1001 + jobs.length, updated_at: '1' }
    jobs.push(job)
    return { data: structuredClone(job), error: null }
  })
})
afterEach(cleanup)

describe('company-scoped quote job conversion', () => {
  it('preserves the saved design agreement through job, invoice, manual payment, real PDFs and reload', async () => {
    state.tables.set('invoices', [])
    const hook = renderHook(() => ({ jobs: useJobs(), invoices: useInvoices() }), { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.jobs.loading || hook.result.current.invoices.loading).toBe(false))
    const source = structuredClone(state.tables.get('quotes')![0].payload) as Parameters<typeof invoiceFromQuote>[0]
    await act(async () => { expect((await hook.result.current.jobs.createFromQuote('q1')).ok).toBe(true) })
    const job = hook.result.current.jobs.jobs[0]
    await act(async () => { expect((await hook.result.current.invoices.addInvoice({ ...invoiceFromQuote({ ...source, id: 'q1' }),
      customerSnapshot: job.customerSnapshot })).ok).toBe(true) })
    const invoiceId = hook.result.current.invoices.invoices[0].id
    await act(async () => { expect((await hook.result.current.jobs.linkInvoiceFromQuote('q1', invoiceId)).ok).toBe(true) })
    await act(async () => { expect((await hook.result.current.invoices.addPayment(invoiceId, {
      id: 'payment1', amount: 50, method: 'cash', dateISO: '2026-10-16',
    })).ok).toBe(true) })
    hook.unmount()
    const reload = renderHook(() => ({ jobs: useJobs(), invoices: useInvoices() }), { wrapper: Wrapper })
    await waitFor(() => expect(reload.result.current.jobs.jobs).toHaveLength(1))
    await waitFor(() => expect(reload.result.current.invoices.invoices).toHaveLength(1))
    const savedJob = reload.result.current.jobs.jobs[0], invoice = reload.result.current.invoices.invoices[0]
    expect(savedJob).toMatchObject({ quoteId: 'q1', invoiceId, customerId: 'c1' })
    expect(invoice).toMatchObject({ quoteId: 'q1', customerId: 'c1', number: 'INV-1200', total: 202.11, tax: 26.36 })
    expect(invoice.pricingSnapshot).toEqual(savedJob.pricingSnapshot)
    expect(invoiceBalance(invoice)).toBe(152.11)
    const changed = { currencyCode: 'USD', currencySymbol: '$', taxRatePct: 30, taxLabel: 'GST', companyName: 'Local Test' }
    const documents = [
      await exportQuotePDF({ quote: { ...source, id: 'q1', number: 'Q-001', dateISO: '2026-10-16' }, customer: savedJob.customerSnapshot, settings: changed, download: false }),
      await exportJobCardPDF({ job: savedJob, customer: savedJob.customerSnapshot, settings: changed, download: false }),
      await exportInvoicePDF({ invoice, customer: savedJob.customerSnapshot, settings: changed, download: false }),
    ]
    for (const doc of documents) {
      const parsed = await pdfjsLib.getDocument({ data: new Uint8Array(doc!.output('arraybuffer')) }).promise
      let text = ''
      for (let index = 1; index <= parsed.numPages; index++) {
        const content = await (await parsed.getPage(index)).getTextContent()
        text += content.items.map(item => 'str' in item ? item.str : '').join(' ')
      }
      expect(text).toContain('£202.11')
      expect(text).toContain('£26.36')
      expect(text).toContain('Saved')
      expect(text).not.toContain('$202.11')
    }
  })
  it.each(['missing', 'foreign'])('rejects %s quotes before calling the allocator', async id => {
    state.tables.get('quotes')!.push({ ...structuredClone(state.tables.get('quotes')![0]), id: 'foreign', company_account_id: 'company-b' })
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { expect((await hook.result.current.createFromQuote(id)).ok).toBe(false) })
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.tables.get('jobs')).toHaveLength(0)
  })
  it.each(['Draft', 'Declined'])('rejects an unaccepted %s quote', async status => {
    const quote = state.tables.get('quotes')![0].payload as Record<string, unknown>
    quote.status = status
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { expect((await hook.result.current.createFromQuote('q1')).ok).toBe(false) })
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('rejects a stale or mismatched quote customer', async () => {
    state.tables.get('quotes')![0].customer_id = null
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { expect((await hook.result.current.createFromQuote('q1')).ok).toBe(false) })
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it.each(['foreign', 'wrong-quote', 'wrong-customer', 'missing'])('rejects a %s invoice link without modifying the job', async kind => {
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { await hook.result.current.createFromQuote('q1') })
    const invoice = state.tables.get('invoices')![0]
    if (kind === 'foreign') invoice.company_account_id = 'company-b'
    if (kind === 'wrong-quote') invoice.quote_id = 'q2'
    if (kind === 'wrong-customer') invoice.customer_id = 'c2'
    if (kind === 'missing') state.tables.set('invoices', [])
    await act(async () => { expect((await hook.result.current.linkInvoiceFromQuote('q1', 'i1')).ok).toBe(false) })
    expect(state.tables.get('jobs')![0].invoice_id).toBeNull()
  })
  it('keeps independent job creation available without a quote', async () => {
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { expect((await hook.result.current.add({ customerId: 'c1', customer: {}, artwork: {}, frame: {}, checklist: [] })).ok).toBe(true) })
    expect(state.tables.get('jobs')![0]).toMatchObject({ quote_id: null, customer_id: 'c1' })
    hook.unmount()
    const reloaded = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(reloaded.result.current.jobs).toHaveLength(1))
    expect(reloaded.result.current.jobs[0].quoteId).toBeUndefined()
  })
  it('refuses an existing job whose customer no longer matches the source quote', async () => {
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { await hook.result.current.createFromQuote('q1') })
    state.tables.get('jobs')![0].customer_id = 'other-customer'
    await act(async () => { expect((await hook.result.current.createFromQuote('q1')).ok).toBe(false) })
  })
  it('refuses to link an invoice when its source quote has been deleted', async () => {
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { await hook.result.current.createFromQuote('q1') })
    state.tables.set('quotes', [])
    await act(async () => { expect((await hook.result.current.linkInvoiceFromQuote('q1', 'i1')).ok).toBe(false) })
    expect(state.tables.get('jobs')![0].invoice_id).toBeNull()
  })
  it('links the existing job to its quote invoice without changing the saved agreement', async () => {
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => { expect((await hook.result.current.createFromQuote('q1')).ok).toBe(true) })
    await act(async () => { expect((await hook.result.current.linkInvoiceFromQuote('q1', 'i1')).ok).toBe(true) })
    expect(hook.result.current.jobs[0]).toMatchObject({ invoiceId: 'i1', quoteId: 'q1', total: 202.11, tax: 26.36 })
    expect(state.tables.get('jobs')![0].invoice_id).toBe('i1')
    expect(hook.result.current.jobs[0].pricingSnapshot).toEqual(agreement)
  })
  it('creates one durable linked job and returns it on repeated/concurrent conversion', async () => {
    const hook = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    let results: Awaited<ReturnType<typeof hook.result.current.createFromQuote>>[] = []
    await act(async () => { results = await Promise.all([hook.result.current.createFromQuote('q1'), hook.result.current.createFromQuote('q1')]) })
    expect(results.every(result => result.ok)).toBe(true)
    expect(state.tables.get('jobs')).toHaveLength(1)
    expect(hook.result.current.jobs[0]).toMatchObject({ quoteId: 'q1', customerId: 'c1', refNo: 1001,
      total: 202.11, tax: 26.36, currency: { code: 'GBP' }, artwork: { widthCm: 40 } })
    hook.unmount()
    const reloaded = renderHook(useJobs, { wrapper: Wrapper })
    await waitFor(() => expect(reloaded.result.current.jobs[0]?.quoteId).toBe('q1'))
    expect(reloaded.result.current.jobs[0].pricingSnapshot).toEqual(agreement)
  })
})
