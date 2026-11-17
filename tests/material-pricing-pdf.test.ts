import { describe, expect, it } from 'vitest'
import { priceVisualiser, toVisualiserQuote, toVisualiserInvoice } from '@/lib/pricing'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
// @ts-expect-error pdfjs-dist legacy CommonJS build has no matching declaration path.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const input = () => ({ artWcm: 40, artHcm: 30, borderCm: 0,
  frame: { name: 'Oak', pricePerMeter: 150 }, mats: [{ name: 'White', pricePerSqM: 30 }],
  glazing: { name: 'Glass', pricePerSqM: 50 }, print: { name: 'Print', pricePerSqM: 80 },
  backer: { name: 'Backing', pricePerSqM: 20 }, labourBase: 10,
  marginMultiplier: 1.25, taxRatePct: 20, taxLabel: 'VAT', currencyCode: 'GBP', currencySymbol: '£' })

async function rendered(snapshot: ReturnType<typeof priceVisualiser>, kind: 'quote' | 'invoice') {
  const settings = { companyName: 'Acceptance Frames', currencyCode: 'USD', taxRatePct: 30 }
  const doc = kind === 'quote'
    ? await exportQuotePDF({ quote: { ...toVisualiserQuote(snapshot), id: 'q', number: 'Q-1', dateISO: '2026-01-01' }, customer: {}, settings, download: false })
    : await exportInvoicePDF({ invoice: { ...toVisualiserInvoice(snapshot), id: 'i', number: 'INV-1' }, settings, download: false })
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
  try {
    const pages: string[] = []
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent()
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '))
    }
    return pages.join(' ').replace(/\s+/g, ' ')
  } finally { await pdf.destroy() }
}

describe('material selling agreement in real PDFs', () => {
  it.each(['quote', 'invoice'] as const)('prints saved quantities, selling rates and explicit totals in a %s', async kind => {
    const snapshot = priceVisualiser(input())
    const before = JSON.stringify(snapshot)
    const content = await rendered(snapshot, kind)
    for (const expected of ['1.4 m', '0.12 m²', '£187.50/m', '£37.50/m²', '£62.50/m²', '£100.00/m²', '£25.00/m²', '£262.50', 'VAT (20.00%)', 'Currency: GBP']) {
      expect(content).toContain(expected)
    }
    expect(content).not.toContain('$')
    expect(JSON.stringify(snapshot)).toBe(before)
  })
  it.each(['quote', 'invoice'] as const)('prints the 40 × 30 cm £210 example in a %s', async kind => {
    const content = await rendered(priceVisualiser({ ...input(), marginMultiplier: 1, mats: [], glazing: null, print: null, backer: null, labourBase: 0, taxRatePct: 0 }), kind)
    for (const expected of ['1.4 m', '£150.00/m', '£210.00']) expect(content).toContain(expected)
  })
  it.each(['quote', 'invoice'] as const)('discloses penny allocation instead of disguising it as a rate in a %s', async kind => {
    const snapshot = priceVisualiser({ ...input(), borderCm: 5, marginMultiplier: 1, taxRatePct: 0,
      frame: { name: 'F', pricePerMeter: 0.003 }, glazing: { name: 'G', pricePerSqM: 0.03 },
      mats: [{ name: 'A', pricePerSqM: 0.03 }, { name: 'B', pricePerSqM: 0.03 }], print: null, backer: null, labourBase: 0 })
    const content = await rendered(snapshot, kind)
    for (const expected of ['£0.003/m', '£0.03/m²', 'Rounding adjustment: -£0.01', '£0.02']) expect(content).toContain(expected)
  })
})
