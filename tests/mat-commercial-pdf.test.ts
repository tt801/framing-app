import { expect, it } from 'vitest'
import { priceVisualiser, toVisualiserQuote } from '@/lib/pricing'
import { invoiceFromQuote } from '@/lib/commercialDocuments'
import { matGeometry, restoreMatBorders, uniformBorders } from '@/lib/matGeometry'
import { jobDetailsDraft, buildJobDetails } from '@/lib/jobEditing'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
import { visualizerScene } from '@/lib/visualizerScene'
import { createMatSlots } from '@/lib/visualizerMats'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const inputs = { artWcm: 40, artHcm: 30, borderCm: 0, frame: { name: 'Frame', pricePerMeter: 10 },
  mats: [5, 6, 7].map((pricePerSqM, i) => ({ name: `Mat ${i + 1}`, pricePerSqM })), glazing: { name: 'Glass', pricePerSqM: 8 },
  print: { name: 'Print', pricePerSqM: 20 }, backer: { name: 'Backer', pricePerSqM: 10 }, labourBase: 10, marginMultiplier: 1.25,
  taxRatePct: 20, currencyCode: 'GBP', taxLabel: 'Saved VAT' }
async function text(document: { output: (kind: 'arraybuffer') => ArrayBuffer }) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(document.output('arraybuffer')) }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '))
  }
  await pdf.destroy()
  return pages.join(' ').replace(/\s+/g, ' ')
}
it('prices expanded shared bounds and exports their edited Pro specification without repricing the agreement', async () => {
  const slots = createMatSlots(['a', 'b', 'c'])
  const openings = [{ id: 'one', shape: 'rect' as const, xCm: -10, yCm: 5, widthCm: 15, heightCm: 10, imageUrl: 'data:opening' }]
  const origin = { x: 8, y: 8 }, borders = slots.map(s => s.borders)
  const g = visualizerScene({ mode: 'pro', layoutModel: 'shared-group-v1', width: 40, height: 30, face: 2, borders, active: [true,true,true], origin, openings })
  const snapshot = priceVisualiser({ ...inputs, geometry: { internalWidthCm: g.internal.width, internalHeightCm: g.internal.height } })
  expect(snapshot.items.find(i => i.key === 'frame')?.materialQuantity).toBe(2.46)
  expect(snapshot.items.find(i => i.key === 'mat1')?.materialQuantity).toBeCloseTo(0.3626)
  expect(snapshot.items.find(i => i.key === 'print')?.materialQuantity).toBe(0.12)
  const original = { description: 'Shared Pro agreement', jobType: 'internal', subtotal: snapshot.subtotal, tax: snapshot.tax, total: snapshot.total, pricingSnapshot: snapshot, details: {
    visualizerDesign: { version: 1, layoutModel: 'shared-group-v1', mode: 'pro', basic: { widthCm: 40, heightCm: 30, imageUrl: 'data:original' }, pro: { origin, openings }, mats: slots },
    dims: { art: { widthCm: 40, heightCm: 30 }, visible: { widthCm: g.internal.width, heightCm: g.internal.height }, frameFaceWidthCm: 2 },
    mats: { geometryVersion: 3, layoutModel: 'shared-group-v1', mode: 'pro', proOrigin: origin, openings, borders, hasMat1: true, hasMat2: true, hasMat3: true,
      ...Object.fromEntries(slots.map((slot, i) => [`mat${i+1}`, { id: slot.materialId, name: slot.materialId, borders: slot.borders }])) } } }
  const draft = jobDetailsDraft(original as never); draft.spec.mat2Left = '4'
  const saved = buildJobDetails(draft, [], original as never)
  expect(saved.pricingSnapshot).toEqual(snapshot); expect(saved.total).toBe(original.total)
  const content = await text(await exportJobCardPDF({ job: saved, settings: { companyName: 'Business', currencyCode: 'GBP' }, download: false }))
  expect(content).toContain('76.0 × 49.0 cm'); expect(content).toContain('Opening 1'); expect(content).toContain('Image retained'); expect(content).toContain('one shared group cut-out')
  expect(content).toContain(new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(original.total))
})
it('prices cumulative asymmetric board geometry without changing print area, rounding or rate policy', () => {
  const g = matGeometry(40, 30, 2, [{ top: 2, bottom: 4, left: 3, right: 5 }, { top: 1, bottom: 2, left: 1, right: 2 }, { top: 2, bottom: 2, left: 2, right: 2 }], [true, true, true])
  const snapshot = priceVisualiser({ ...inputs, geometry: { internalWidthCm: g.internal.width, internalHeightCm: g.internal.height } })
  expect(snapshot.items.find(i => i.key === 'frame')?.materialQuantity).toBe(1.96)
  for (const key of ['glazing', 'mat1', 'mat2', 'mat3', 'backer']) expect(snapshot.items.find(i => i.key === key)?.materialQuantity).toBe(0.2365)
  expect(snapshot.items.find(i => i.key === 'print')?.materialQuantity).toBe(0.12)
  expect(snapshot.items.reduce((sum, i) => sum + Math.round(i.lineTotal * 100), 0)).toBe(Math.round(snapshot.subtotal * 100))
  expect(Math.round(snapshot.subtotal * 100) + Math.round(snapshot.tax * 100)).toBe(Math.round(snapshot.total * 100))
})
it.each([true, false])('preserves saved commercial amounts through geometry conversion, workshop save and actual PDFs (snapshot=%s)', async withSnapshot => {
  const mats = { geometryVersion: 2, hasMat1: true, hasMat2: true, hasMat3: true,
    mat1: { name: 'Green', borders: uniformBorders(5) }, mat2: { name: 'Blue', borders: uniformBorders(7) }, mat3: { name: 'Red', borders: uniformBorders(8) } }
  const restored = restoreMatBorders(mats, [true, true, true])
  const geometry = matGeometry(40, 30, 2, restored.borders, [true, true, true])
  const snapshot = priceVisualiser({ ...inputs, geometry: { internalWidthCm: geometry.internal.width, internalHeightCm: geometry.internal.height } })
  const quote = { id: 'historical', number: 'Q-HISTORICAL', ...toVisualiserQuote(snapshot) }
  if (!withSnapshot) delete quote.pricingSnapshot
  const before = structuredClone(quote)
  const original = { description: 'Historical frame', jobType: 'internal', subtotal: quote.subtotal, total: quote.total, tax: quote.tax,
    ...(withSnapshot ? { pricingSnapshot: snapshot } : {}),
    details: { mats, dims: { art: { widthCm: 40, heightCm: 30 }, frameFaceWidthCm: 2,
      visible: { widthCm: 56, heightCm: 46 }, external: { widthCm: 60, heightCm: 50 } } } }
  const draft = jobDetailsDraft(original as never)
  draft.spec.mat2Left = '4'
  const saved = buildJobDetails(draft, [], original as never)
  expect([saved.subtotal, saved.tax, saved.total]).toEqual([quote.subtotal, quote.tax, quote.total])
  expect(saved.pricingSnapshot).toEqual(original.pricingSnapshot)
  const invoice = { id: 'historical-invoice', number: 'INV-HISTORICAL', ...invoiceFromQuote(quote) }
  expect(invoice.total).toBe(quote.total); expect(invoice.items.map(i => i.total)).toEqual(quote.items.map(i => i.total))
  // Deliberately conflicting current settings must never replace the saved currency/tax/agreement.
  const settings = { companyName: 'Current business', currencyCode: 'USD', taxLabel: 'Current GST', taxRatePct: 99, marginMultiplier: 99 }
  const quoteText = await text(await exportQuotePDF({ quote: quote as never, customer: null, settings, download: false }))
  const invoiceText = await text(await exportInvoicePDF({ invoice: invoice as never, settings, download: false }))
  const jobText = await text(await exportJobCardPDF({ job: saved, settings: { ...settings, currencyCode: 'GBP' }, download: false }))
  for (const content of [quoteText, invoiceText, jobText]) {
    expect(content).toContain(new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(quote.total))
    expect(content).not.toContain('Current GST (99.00%)')
  }
  expect(jobText).toContain('Incremental: Mat 1 from artwork/layout opening')
  expect(jobText).toContain('Left 4 cm')
  expect(jobText).toContain('58.0 × 46.0 cm')
  expect(quote).toEqual(before)
})
