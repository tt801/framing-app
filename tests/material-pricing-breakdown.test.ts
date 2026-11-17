import { describe, expect, it } from 'vitest'
import { priceVisualiser, roundMoney, toVisualiserInvoice, toVisualiserQuote } from '@/lib/pricing'
import { editManualDraft, invoiceFromQuote } from '@/lib/commercialDocuments'
import { normalizeLineItems } from '@/lib/persistedRows'

const materialInput = () => ({
  artWcm: 40, artHcm: 30, borderCm: 0,
  frame: { name: 'Frame', pricePerMeter: 150 },
  mats: [{ name: 'Mat', pricePerSqM: 100 }],
  glazing: { name: 'Glass', pricePerSqM: 200 },
  print: { name: 'Print', pricePerSqM: 50 }, backer: { name: 'Backing', pricePerSqM: 25 },
  labourBase: 10, marginMultiplier: 1, taxRatePct: 20, currencyCode: 'GBP', taxLabel: 'VAT',
})

describe('material selling breakdown', () => {
  it('saves the 40 × 30 cm frame as 1.4 m at £150/m, not one £210 design', () => {
    const snapshot = priceVisualiser(materialInput())
    expect(snapshot.items[0]).toMatchObject({ qty: 1.4, unit: 'm', unitPrice: 150, lineTotal: 210 })
    expect(snapshot).toMatchObject({ subtotal: 265, tax: 53, total: 318 })
    for (const document of [toVisualiserQuote(snapshot), toVisualiserInvoice(snapshot)]) {
      expect(document.items[0]).toMatchObject({ qty: 1.4, unit: 'm', unitPrice: 150, total: 210 })
    }
  })
  it('uses bordered square metres for each mat, glass and backing, but artwork area for printing', () => {
    const input = materialInput()
    const snapshot = priceVisualiser({ ...input, borderCm: 5, mats: [input.mats[0], input.mats[0], input.mats[0]], marginMultiplier: 1.25 })
    const expected = [
      ['frame', 1.8, 'm', 187.5], ['glazing', 0.2, 'm²', 250],
      ['mat1', 0.2, 'm²', 125], ['mat2', 0.2, 'm²', 125], ['mat3', 0.2, 'm²', 125],
      ['print', 0.12, 'm²', 62.5], ['backer', 0.2, 'm²', 31.25], ['labour', 1, 'design', 12.5],
    ]
    expected.forEach(([key, qty, unit, unitPrice], index) => expect(snapshot.items[index]).toMatchObject({ key, qty, unit, unitPrice }))
    expect(snapshot.items.reduce((n, line) => n + line.lineTotal, 0)).toBe(snapshot.subtotal)
  })
  it('keeps aggregate rounding and explicitly records each allocated rounding difference', () => {
    const snapshot = priceVisualiser({ ...materialInput(), borderCm: 5,
      frame: { name: 'F', pricePerMeter: 0.003 }, glazing: { name: 'G', pricePerSqM: 0.03 },
      mats: [{ name: 'A', pricePerSqM: 0.03 }, { name: 'B', pricePerSqM: 0.03 }],
      print: null, backer: null, labourBase: 0, taxRatePct: 0,
    })
    expect(snapshot.subtotal).toBe(0.02)
    expect(snapshot.items.map(line => line.lineTotal)).toEqual([0.01, 0.01, 0, 0, 0])
    snapshot.items.forEach(line => expect(roundMoney(line.qty * line.unitPrice, 'GBP') + (line.roundingAdjustment ?? 0)).toBeCloseTo(line.lineTotal, 10))
    expect(snapshot.items[2].roundingAdjustment).toBe(-0.01)
    expect(toVisualiserInvoice(snapshot).items[2]).toMatchObject({ total: 0, roundingAdjustment: -0.01 })
  })
  it('preserves the material agreement through storage, conversion and unchanged Draft saves', () => {
    const snapshot = priceVisualiser({ ...materialInput(), marginMultiplier: 1.234567 })
    const quote = { id: 'q', status: 'Draft', ...toVisualiserQuote(snapshot) }
    const before = JSON.stringify(quote)
    const reloaded = { ...quote, items: normalizeLineItems(JSON.parse(JSON.stringify(quote.items)))! }
    const invoice = { ...invoiceFromQuote(reloaded), status: 'Draft' }
    expect(invoice.items[0]).toMatchObject({ qty: 1.4, unit: 'm', unitPrice: snapshot.items[0].unitPrice, total: snapshot.items[0].lineTotal })
    for (const [document, kind] of [[reloaded, 'quote'], [invoice, 'invoice']] as const) {
      const saved = editManualDraft(document, document.items, kind)
      expect(saved.items[0]).toMatchObject({ unit: 'm', qty: 1.4, unitPrice: snapshot.items[0].unitPrice, total: snapshot.items[0].lineTotal })
      expect(saved.total).toBe(snapshot.total)
      expect(saved.pricingSnapshot).toEqual(snapshot)
    }
    expect(JSON.stringify(quote)).toBe(before)
  })
  it('keeps allocated totals on unchanged rows when another Draft row is edited or removed', () => {
    const snapshot = priceVisualiser({ ...materialInput(), borderCm: 5,
      frame: { name: 'F', pricePerMeter: 0.003 }, glazing: { name: 'G', pricePerSqM: 0.03 },
      mats: [{ name: 'A', pricePerSqM: 0.03 }, { name: 'B', pricePerSqM: 0.03 }],
      print: null, backer: null, labourBase: 0, taxRatePct: 0,
    })
    const quote = { status: 'Draft', ...toVisualiserQuote(snapshot) }
    const items = quote.items.map((item, index) => ({ ...item, id: `line-${index}` }))
    const saved = editManualDraft(quote, items.map((item, index) => index === 0 ? { ...item, qty: 2 } : item), 'quote')
    expect(saved.items[2]).toMatchObject({ unit: 'm²', total: 0, roundingAdjustment: -0.01 })
    expect(saved.items[0]).toMatchObject({ unit: 'm', qty: 2, unitPrice: 0.003, total: 0.01, roundingAdjustment: 0 })
    const removed = editManualDraft({ ...quote, items }, items.slice(1), 'quote')
    expect(removed.items.find(item => item.name === 'Mat 1 (A)')?.total).toBe(0)
  })
  it('does not repair an inconsistent historical document on an unchanged Draft save or conversion', () => {
    const old = { id: 'old', status: 'Draft', currency: 'GBP', taxRate: 0.1, tax: 8, subtotal: 82, total: 90,
      items: [{ id: 'old-line', name: 'Legacy', qty: 1, unitPrice: 80, total: 80 }] }
    const before = JSON.stringify(old)
    expect(editManualDraft(old, old.items, 'quote')).toMatchObject({ subtotal: 82, tax: 8, total: 90 })
    expect(invoiceFromQuote(old)).toMatchObject({ subtotal: 82, tax: 8, total: 90 })
    expect(JSON.stringify(old)).toBe(before)
  })
  it('does not reinterpret historical one-design snapshots using their recorded material quantities', () => {
    const snapshot = priceVisualiser(materialInput())
    delete snapshot.quantityBasis
    snapshot.items = snapshot.items.map(line => ({ ...line, qty: 1, unit: 'design', unitPrice: line.lineTotal, roundingAdjustment: undefined }))
    const quote = { ...toVisualiserQuote(snapshot), status: 'Draft' }
    const before = JSON.stringify(quote)
    expect(invoiceFromQuote(quote).items[0]).toMatchObject({ qty: 1, unit: 'design', unitPrice: 210, total: 210 })
    expect(editManualDraft(quote, quote.items, 'quote').pricingSnapshot).toEqual(snapshot)
    expect(JSON.stringify(quote)).toBe(before)
  })
  it.each(['GBP', 'JPY', 'KWD'])('preserves precision, tax and allocations on an unchanged %s Draft, including name-only edits', currencyCode => {
    const snapshot = priceVisualiser({ ...materialInput(), currencyCode, marginMultiplier: 1.234567, taxRatePct: 7.5 })
    const quote = { ...toVisualiserQuote(snapshot), status: 'Draft' }
    for (const items of [quote.items, quote.items.map((line, index) => index === 0 ? { ...line, name: 'Renamed frame' } : line)]) {
      const saved = editManualDraft(quote, items, 'quote')
      expect(saved).toMatchObject({ subtotal: snapshot.subtotal, tax: snapshot.tax, total: snapshot.total })
      expect(saved.items.map(line => [line.qty, line.unit, line.unitPrice, line.total, line.roundingAdjustment]))
        .toEqual(quote.items.map(line => [line.qty, line.unit, line.unitPrice, line.total, line.roundingAdjustment]))
    }
  })
})
