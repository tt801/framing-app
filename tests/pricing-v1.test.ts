import { describe, expect, it } from 'vitest'
import { priceVisualiser, toVisualiserQuote, toVisualiserJobCosts, toVisualiserInvoice, effectiveTaxRatePct } from '@/lib/pricing'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
// @ts-expect-error pdfjs-dist legacy CommonJS build has no matching declaration path.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const input = () => ({
  artWcm: 40, artHcm: 30, borderCm: 5,
  frame: { id: 'f', name: 'Frame', pricePerMeter: 10 },
  mats: [{ id: 'm', name: 'Mat', pricePerSqM: 5 }],
  glazing: { id: 'g', name: 'Glass', pricePerSqM: 8 },
  print: null, backer: null,
  labourBase: 120, marginMultiplier: 1.25, taxRatePct: 15,
  taxLabel: 'VAT', currencyCode: 'GBP', currencySymbol: '£',
})

describe('canonical Visualiser pricing v1', () => {
  it('prints the saved selling prices, tax label, and currency after company settings change', async () => {
    const snapshot = priceVisualiser(input())
    const invoice = { id: 'test-invoice', number: 'INV-1', ...toVisualiserInvoice(snapshot) }
    const pdf = await exportInvoicePDF({ invoice, settings: { companyName: 'Test Framer', currencyCode: 'USD', taxLabel: 'GST' }, download: false })
    const bytes = new Uint8Array(pdf.output('arraybuffer'))
    const parsed = await pdfjsLib.getDocument({ data: bytes }).promise
    const page = await parsed.getPage(1)
    const text = (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
    expect(text).toContain('VAT (15.00%)')
    expect(text).toContain('£202.11')
    expect(text).toContain('£22.50')
    expect(text).not.toContain('GST (15.00%)')
    expect(text).not.toContain('£18.00')
  })

  it('agrees across Visualiser, Quote, Job and direct Invoice with selling lines', () => {
    const snapshot = priceVisualiser(input())
    const quote = toVisualiserQuote(snapshot)
    const job = toVisualiserJobCosts(snapshot)
    const invoice = toVisualiserInvoice(snapshot)
    expect(snapshot).toMatchObject({ version: 1, subtotal: 175.75, tax: 26.36, total: 202.11, taxRate: 0.15, taxMode: 'exclusive' })
    expect(quote.total).toBe(snapshot.total)
    expect(job.total).toBe(snapshot.total)
    expect(invoice.total).toBe(snapshot.total)
    expect(quote.items.reduce((sum, item) => sum + item.total, 0)).toBe(snapshot.subtotal)
    expect(invoice.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)).toBe(snapshot.subtotal)
    expect(snapshot.subtotal + snapshot.tax).toBe(snapshot.total)
    expect(snapshot.items.find(item => item.key === 'frame')).toMatchObject({ materialQuantity: 1.8, materialUnit: 'm', rawAmount: 18, productId: 'f' })
    expect(quote.items[0].unitPrice).not.toBe(18)
  })

  it('handles three mats, glazing, print, backing and labour without omissions', () => {
    const data = input()
    const priced = priceVisualiser({ ...data, mats: [data.mats[0], data.mats[0], data.mats[0]], print: { id: 'p', name: 'Print', pricePerSqM: 10 }, backer: { name: 'Backer', pricePerSqM: 5 } })
    expect(priced.items.map(item => item.key)).toEqual(['frame', 'glazing', 'mat1', 'mat2', 'mat3', 'print', 'backer', 'labour'])
    expect(priced.items.find(item => item.key === 'print')?.rawAmount).toBe(1.2)
    expect(priced.items.find(item => item.key === 'backer')?.rawAmount).toBe(1)
    expect(priced.items.find(item => item.key === 'labour')?.rawAmount).toBe(120)
    expect(priced.items.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(priced.subtotal)
  })

  it('supports zero tax, changed multiplier and 0/3-decimal currencies', () => {
    const zero = priceVisualiser({ ...input(), taxRatePct: 0, marginMultiplier: 1 })
    expect(zero.tax).toBe(0)
    expect(zero.total).toBe(zero.subtotal)
    const yen = priceVisualiser({ ...input(), currencyCode: 'JPY', labourBase: 1.005 })
    expect(Number.isInteger(yen.total)).toBe(true)
    const dinar = priceVisualiser({ ...input(), currencyCode: 'KWD', labourBase: 1.005 })
    expect(Math.round(dinar.total * 1000)).toBe(dinar.total * 1000)
  })

  it('keeps agreed numbers fixed after catalogue, multiplier and tax changes', () => {
    const data = input()
    const saved = JSON.parse(JSON.stringify(priceVisualiser(data)))
    data.frame.pricePerMeter = 100
    data.marginMultiplier = 3
    data.taxRatePct = 0
    expect(priceVisualiser(data).total).not.toBe(saved.total)
    expect(toVisualiserQuote(saved).total).toBe(202.11)
    expect(toVisualiserJobCosts(saved).total).toBe(202.11)
    expect(toVisualiserInvoice(saved).total).toBe(202.11)
  })

  it('never creates negative selling lines when individually rounded components exceed the rounded subtotal', () => {
    const data = input()
    const priced = priceVisualiser({ ...data,
      frame: { id: 'f', name: 'F', pricePerMeter: 0.003 },
      mats: [{ id: 'a', name: 'A', pricePerSqM: 0.03 }, { id: 'b', name: 'B', pricePerSqM: 0.03 }],
      glazing: { id: 'g', name: 'G', pricePerSqM: 0.03 },
      labourBase: 0, marginMultiplier: 1, taxRatePct: 0,
    })
    expect(priced.items.every(item => item.lineTotal >= 0)).toBe(true)
    expect(priced.items.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(priced.subtotal)
  })

  it('reconciles fractional line rounding without losing the displayed subtotal', () => {
    const priced = priceVisualiser({ ...input(), frame: { id: 'f', name: 'F', pricePerMeter: 0.005 }, mats: [], glazing: { id: 'g', name: 'G', pricePerSqM: 0.005 }, labourBase: 0.005, marginMultiplier: 1.25, taxRatePct: 7.5 })
    expect(priced.items.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(priced.subtotal)
    expect(priced.subtotal + priced.tax).toBe(priced.total)
  })
})

describe('legacy tax setting shapes', () => {
  it('prefers explicit taxRatePct and accepts old percent or fractional taxRate', () => {
    expect(effectiveTaxRatePct({ taxRatePct: 0, taxRate: 15 })).toBe(0)
    expect(effectiveTaxRatePct({ taxRatePct: 15 })).toBe(15)
    expect(effectiveTaxRatePct({ taxRate: 15 })).toBe(15)
    expect(effectiveTaxRatePct({ taxRate: 0.15 })).toBe(15)
  })
})
