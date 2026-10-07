import { describe, expect, it } from 'vitest'
import { createManualDraft, editManualDraft, invoiceFromQuote } from '@/lib/commercialDocuments'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
// @ts-expect-error pdfjs-dist legacy CommonJS build lacks its declaration path.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

async function textOf(doc: { output: (mode: 'arraybuffer') => ArrayBuffer }) {
  const parsed = await pdfjsLib.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
  const page = await parsed.getPage(1)
  return (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
}

const oldSettings = { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 20, taxLabel: 'VAT' }
const changed = { currencyCode: 'USD', currencySymbol: '$', taxLabel: 'GST', companyName: 'Test Framer' }

describe('manual commercial PDFs', () => {
  it('renders saved selling lines and totals from Quote and Invoice after company tax/currency changes', async () => {
    const draft = createManualDraft('quote', oldSettings)
    const priced = { ...draft, ...editManualDraft({ ...draft, status: 'Draft' }, [{ name: 'Mounting', qty: 2, unitPrice: 100 }], 'quote') }
    const quote = { ...priced, id: 'q1', number: 'Q-1', dateISO: '2026-01-01' }
    const quotePdf = await exportQuotePDF({ quote, customer: { firstName: 'Test' }, settings: changed, download: false })
    expect(quotePdf).toBeTruthy()
    const quoteText = await textOf(quotePdf!)
    expect(quoteText).toContain('£100.00')
    expect(quoteText).toContain('£200.00')
    expect(quoteText).toContain('VAT (20.00%): £40.00')
    expect(quoteText).toContain('£240.00')
    const converted = invoiceFromQuote(quote)
    const invoicePdf = await exportInvoicePDF({ invoice: { ...converted, id: 'i1', number: 'INV-1', items: converted.items }, settings: changed, download: false })
    const invoiceText = await textOf(invoicePdf)
    expect(invoiceText).toContain('£100.00')
    expect(invoiceText).toContain('£200.00')
    expect(invoiceText).toContain('VAT (20.00%)')
    expect(invoiceText).toContain('£240.00')
    expect(invoiceText).not.toContain('GST (20.00%)')
  })
  it('keeps legacy saved totals/tax even when line items disagree', async () => {
    const legacyQuote = { id: 'q-old', number: 'Q-OLD', dateISO: '2025-01-01', currency: 'GBP',
      items: [{ name: 'Legacy', qty: 1, unitPrice: 80, total: 80 }], subtotal: 82, total: 90 }
    const pdf = await exportQuotePDF({ quote: legacyQuote, customer: {}, settings: changed, download: false })
    const text = await textOf(pdf!)
    expect(text).toContain('£80.00')
    expect(text).toContain('£82.00')
    expect(text).toContain('£90.00')
    const invoice = invoiceFromQuote({ ...legacyQuote, tax: 8, taxRate: 0.1 })
    expect(invoice.pricingSnapshot).toBeUndefined()
    expect(invoice.total).toBe(90)
  })
})
