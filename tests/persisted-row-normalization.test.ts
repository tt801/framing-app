import { describe, expect, it } from 'vitest'
import { rowToInvoice } from '@/lib/invoices'
import { rowToJob } from '@/lib/jobs'
import { rowToQuote } from '@/lib/quotes'

const invoiceRow = (payload: unknown) => ({ id: 'invoice-db', invoice_number: 'INV-10', customer_id: null, quote_id: null, created_at: '2026-09-01T00:00:00Z', payload })
const jobRow = (payload: unknown) => ({ id: 'job-db', ref_no: 10, customer_id: null, quote_id: null, invoice_id: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z', payload })

// The stored JSON is an untrusted legacy/import boundary, not a typed application model.
describe('persisted row normalization', () => {
  it('preserves valid invoice values and fills non-financial missing fields', () => {
    const item = { id: 'frame', description: 'Oak', qty: 2, unitPrice: 30, custom: 'kept' }
    const invoice = rowToInvoice(invoiceRow({ items: [item], subtotal: 60, total: 69, createdAt: '2026-08-31', notes: 'keep' }))
    expect(invoice).toMatchObject({ id: 'invoice-db', number: 'INV-10', createdAt: '2026-08-31', items: [item], subtotal: 60, total: 69, notes: 'keep' })
    expect(rowToInvoice(invoiceRow({ subtotal: 0, total: 0 }))).toMatchObject({ createdAt: '2026-09-01T00:00:00Z', items: [], subtotal: 0, total: 0 })
  })

  it('rejects invoices with missing or invalid financial values instead of presenting false zeroes', () => {
    expect(rowToInvoice(invoiceRow({ items: [], subtotal: 50 }))).toBeNull()
    expect(rowToInvoice(invoiceRow({ items: [{ qty: '2', unitPrice: 10 }], subtotal: 20, total: 20 }))).toBeNull()
    expect(rowToInvoice(invoiceRow([]))).toBeNull()
  })

  it('preserves valid job data and normalizes minimal and malformed optional structures', () => {
    const valid = { status: 'in_progress', createdAt: '2026-08-31', customer: { name: 'A' }, artwork: { title: 'A' }, frame: { name: 'Oak' }, checklist: [{ key: 'fit', label: 'Fit', done: true }] }
    expect(rowToJob(jobRow(valid))).toMatchObject({ ...valid, id: 'job-db', refNo: 10 })
    expect(rowToJob(jobRow({}))).toMatchObject({ createdAt: '2026-09-01T00:00:00Z', status: 'new', customer: {}, artwork: {}, frame: {}, checklist: [] })
    expect(rowToJob(jobRow({ customer: [], checklist: 'bad' }))).toBeNull()
  })

  it('round-trips a Visualizer-created job checklist without dropping identifiers or steps', () => {
    const checklist = [
      { id: 'measure-1', text: 'Measure & verify artwork size', done: false },
      { id: 'cut-2', text: 'Cut frame lengths', done: true },
    ]
    const persisted = JSON.parse(JSON.stringify({ status: 'new', customer: {}, artwork: {}, frame: {}, checklist }))
    const loaded = rowToJob(jobRow(persisted))
    expect(loaded?.checklist).toEqual(checklist)
    expect(rowToJob(jobRow(JSON.parse(JSON.stringify(loaded))))?.checklist).toEqual(checklist)
    expect(rowToJob(jobRow({ checklist: [{ id: 'step-1', text: 'Valid', done: false }, { id: 'bad', done: true }] }))).toBeNull()
  })

  it('preserves the older key/label checklist representation', () => {
    const checklist = [{ key: 'fit', label: 'Measure artwork', done: true, note: 'verified' }]
    expect(rowToJob(jobRow({ checklist }))?.checklist).toEqual(checklist)
  })

  it('preserves valid quote data, supports customerless drafts, and rejects invalid line items', () => {
    const item = { id: 'one', description: 'Frame', qty: 1, unitPrice: 42 }
    expect(rowToQuote({ id: 'quote-db', payload: { customerId: 'cust', items: [item], notes: 'keep' } })).toMatchObject({ id: 'quote-db', customerId: 'cust', items: [item], notes: 'keep' })
    expect(rowToQuote({ id: 'quote-db', payload: {} })).toMatchObject({ customerId: '', items: [] })
    expect(rowToQuote({ id: 'quote-db', payload: { items: [{ qty: 1, unitPrice: 'wrong' }] } })).toBeNull()
  })
})
