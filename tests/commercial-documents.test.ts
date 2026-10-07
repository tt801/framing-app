import { describe, expect, it } from 'vitest'
import { createManualDraft, editManualDraft, invoiceFromQuote, invoiceBalance } from '@/lib/commercialDocuments'

const settings = { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 20, taxLabel: 'VAT', marginMultiplier: 1.5 }
const item = { id: 'line-1', name: 'Artwork', qty: 2, unitPrice: 100 }

describe('commercial document workflows', () => {
  it('creates and revises a Draft Quote with saved tax and no repeated multiplier', () => {
    const quote = createManualDraft('quote', settings)
    expect(quote.pricingSnapshot.version).toBe(1)
    const edited = editManualDraft({ ...quote, status: 'Draft' }, [item], 'quote')
    expect(edited).toMatchObject({ subtotal: 200, tax: 40, total: 240, taxRate: 0.2 })
    expect(edited.items[0]).toMatchObject({ unitPrice: 100, qty: 2, total: 200 })
    const changed = editManualDraft({ ...quote, ...edited, status: 'Draft' }, [], 'quote')
    expect(changed.total).toBe(0)
    expect(() => editManualDraft({ ...quote, ...edited, status: 'Sent' }, [], 'quote')).toThrow(/Draft/)
  })
  it('preserves a saved Quote agreement across changes in company settings', () => {
    const quote = { ...createManualDraft('quote', settings), id: 'q1', customerId: 'c1', status: 'Accepted' }
    const priced = { ...quote, ...editManualDraft({ ...quote, status: 'Draft' }, [item], 'quote') }
    const invoice = invoiceFromQuote(priced)
    expect(invoice).toMatchObject({ quoteId: 'q1', customerId: 'c1', subtotal: 200, tax: 40, total: 240, taxRate: 0.2, currencyCode: 'GBP' })
    expect(invoice.pricingSnapshot).toEqual(priced.pricingSnapshot)
    expect(invoice.items).toMatchObject([{ name: 'Artwork', qty: 2, unitPrice: 100 }])
    expect(invoiceFromQuote(priced).total).toBe(240)
  })
  it('copies legacy saved values without a snapshot or current tax lookup', () => {
    const legacy = { id: 'legacy-q', customerId: 'c', items: [{ name: 'Legacy', qty: 1, unitPrice: 80, total: 80 }], subtotal: 80, tax: 5, taxRate: 0.07, total: 85, currency: 'GBP' }
    const invoice = invoiceFromQuote(legacy)
    expect(invoice).toMatchObject({ subtotal: 80, tax: 5, taxRate: 0.07, total: 85, currencyCode: 'GBP' })
    expect(invoice.pricingSnapshot).toBeUndefined()
    expect(() => editManualDraft({ ...legacy, status: 'Draft' }, legacy.items, 'quote')).not.toThrow()
    expect(() => editManualDraft({ ...legacy, status: 'Draft', taxRate: undefined }, legacy.items, 'quote')).toThrow(/saved tax rate/)
  })
  it('edits a Draft Invoice, keeps payments and rejects a total below recorded payments', () => {
    const draft = { ...createManualDraft('invoice', settings), status: 'Draft', payments: [{ amount: 100 }] }
    const priced = editManualDraft(draft, [item], 'invoice')
    expect(priced.total).toBe(240)
    expect(priced.payments).toEqual(draft.payments)
    expect(invoiceBalance({ ...draft, ...priced })).toBe(140)
    expect(() => editManualDraft(draft, [{ ...item, unitPrice: 20 }], 'invoice')).toThrow(/payment/i)
    expect(() => editManualDraft({ ...draft, status: 'Paid' }, [item], 'invoice')).toThrow(/Draft/)
    expect(invoiceBalance({ total: 0.3, payments: [{ amount: 0.1 }, { amount: 0.2 }], currencyCode: 'GBP' })).toBe(0)
    const small = { ...createManualDraft('invoice', { ...settings, taxRatePct: 0 }), status: 'Draft',
      payments: [{ amount: 0.1 }, { amount: 0.2 }] }
    expect(editManualDraft(small, [{ ...item, qty: 1, unitPrice: 0.3 }], 'invoice').total).toBe(0.3)
  })
})
