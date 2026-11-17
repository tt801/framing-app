import { describe, expect, it } from 'vitest'
import { editManualDraft, invoiceFromQuote, type CommercialItem, type SavedCommercialDocument } from '@/lib/commercialDocuments'
import { priceVisualiser, toVisualiserInvoice, toVisualiserQuote } from '@/lib/pricing'
import { rowToQuote } from '@/lib/quotes'
import { rowToInvoice } from '@/lib/invoices'

const snapshot = () => priceVisualiser({ artWcm: 40, artHcm: 30, borderCm: 0,
  frame: { id: 'frame-oak', name: 'Oak', pricePerMeter: 150 },
  glazing: { id: 'glass-clear', name: 'Glass', pricePerSqM: 50 },
  mats: [{ id: 'mat-white', name: 'White', pricePerSqM: 30 }],
  print: { id: 'print-paper', name: 'Print', pricePerSqM: 80 },
  backer: { id: 'backer-board', name: 'Backer', pricePerSqM: 20 },
  labourBase: 10, currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 20, marginMultiplier: 1.234567 })
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function draft(kind: 'quote' | 'invoice') {
  const priced = snapshot()
  const fields = kind === 'quote' ? toVisualiserQuote(priced) : toVisualiserInvoice(priced)
  return { ...fields, status: 'Draft', id: 'document', customerId: 'customer', createdAt: '2026-01-01',
    items: fields.items.map((line, index) => ({ ...line, id: `line-${index}` })) }
}
// Mirrors the Quote editor's presentation adapter, which does not carry productId.
const editorItems = (document: SavedCommercialDocument): CommercialItem[] => document.items!.map(line => ({
  id: line.id, name: line.name ?? line.description, qty: line.qty, unitPrice: line.unitPrice, unit: line.unit,
}))
const amounts = (document: SavedCommercialDocument) => ({ subtotal: document.subtotal, tax: document.tax,
  total: document.total, taxRate: document.taxRate, currencyCode: document.currencyCode,
  items: document.items!.map(line => [line.qty, line.unit, line.unitPrice, line.total, line.roundingAdjustment]),
  snapshot: document.pricingSnapshot && { subtotal: document.pricingSnapshot.subtotal,
    tax: document.pricingSnapshot.tax, total: document.pricingSnapshot.total,
    items: document.pricingSnapshot.items.map(line => [line.qty, line.unit, line.unitPrice, line.lineTotal, line.roundingAdjustment]) },
})
function reload(document: SavedCommercialDocument, kind: 'quote' | 'invoice') {
  const payload = clone(document)
  const result = kind === 'quote' ? rowToQuote({ id: 'document', payload }) : rowToInvoice({
    id: 'document', payload, invoice_number: 'INV-1', customer_id: 'customer', quote_id: null, created_at: '2026-01-01',
  })
  expect(result).not.toBeNull()
  return result! as SavedCommercialDocument
}

// Reference repair must not change the pre-existing pricing policy or calculations.
describe.each(['quote', 'invoice'] as const)('%s material reference integrity', kind => {
  it('retains every reference during a financial edit, persisted reload and conversion without changing pricing', () => {
    const original = draft(kind), before = clone(original)
    const items = editorItems(original); items[0].qty = 2
    const edited = editManualDraft(original, items, kind)
    expect(edited.items.map(line => line.productId)).toEqual(original.items.map(line => line.productId))
    expect(edited.pricingSnapshot!.items.map(line => ({ key: line.key, productId: line.productId,
      materialQuantity: line.materialQuantity, materialUnit: line.materialUnit }))).toEqual(
      original.pricingSnapshot.items.map((line, index) => ({ key: line.key, productId: line.productId,
        materialQuantity: index === 0 ? 2 : line.materialQuantity, materialUnit: line.materialUnit })))
    expect(edited.items[0].total).toBe(370.37)
    const unchangedLine = (line: CommercialItem) => ({ productId: line.productId, qty: line.qty,
      unit: line.unit, unitPrice: line.unitPrice, total: line.total })
    expect(edited.items.slice(1).map(unchangedLine)).toEqual(original.items.slice(1).map(unchangedLine))
    // Reference-free control follows the same existing financial edit path.
    const control = clone(original)
    control.items.forEach(line => { delete line.productId })
    control.pricingSnapshot.items.forEach(line => { delete line.productId })
    expect(amounts(edited)).toEqual(amounts(editManualDraft(control, items, kind)))
    const reopened = reload({ ...original, ...edited }, kind)
    expect(reopened.items).toMatchObject(edited.items)
    expect(reopened.pricingSnapshot).toEqual(edited.pricingSnapshot)
    const savedAgain = editManualDraft(reopened, editorItems(reopened), kind)
    expect(savedAgain.items.map(line => line.productId)).toEqual(edited.items.map(line => line.productId))
    expect(amounts(savedAgain)).toEqual(amounts(edited))
    const invoice = invoiceFromQuote({ ...reopened, id: 'quote' })
    expect(invoice.items.map(line => line.productId)).toEqual(edited.items.map(line => line.productId))
    expect(invoice.pricingSnapshot).toEqual(edited.pricingSnapshot)
    expect(amounts(reload(invoice, 'invoice'))).toEqual(amounts(edited))
    expect(original).toEqual(before)
  })

  it('does not change references or any saved financial values on a rename-only save', () => {
    const original = draft(kind), items = editorItems(original)
    items[0].name = 'Renamed frame'
    const edited = editManualDraft(original, items, kind)
    expect(edited.items.map(line => line.productId)).toEqual(original.items.map(line => line.productId))
    expect(edited.pricingSnapshot!.items[0]).toMatchObject({ ...original.pricingSnapshot.items[0], description: 'Renamed frame' })
    expect(amounts(edited)).toEqual(amounts(original))
  })

  it('keeps surviving references on removal and does not assign removed material references to a new manual line', () => {
    const original = draft(kind), items = editorItems(original).slice(1)
    items.push({ id: 'new-manual-line', name: 'Extra service', qty: 1, unitPrice: 12 })
    const edited = editManualDraft(original, items, kind)
    expect(edited.items.map(line => line.productId)).toEqual([...original.items.slice(1).map(line => line.productId), undefined])
    expect(edited.pricingSnapshot!.items.slice(0, -1).map(line => line.key)).toEqual(original.pricingSnapshot.items.slice(1).map(line => line.key))
    expect(edited.pricingSnapshot!.items.at(-1)).not.toHaveProperty('materialQuantity')
    expect(edited.pricingSnapshot!.items.at(-1)).not.toHaveProperty('productId')
  })

  it('recovers a saved snapshot reference when a legacy item lacks productId', () => {
    const original = draft(kind); delete original.items[0].productId
    const items = editorItems(original); items[0].unitPrice = 200
    const edited = editManualDraft(original, items, kind)
    expect(edited.items[0].productId).toBe('frame-oak')
    expect(edited.pricingSnapshot!.items[0]).toMatchObject({ key: 'frame', productId: 'frame-oak', materialQuantity: 1.4, materialUnit: 'm' })
  })
})
