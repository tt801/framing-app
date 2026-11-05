import { describe, expect, it } from 'vitest'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

async function pagesOf(doc: { output: (mode: 'arraybuffer') => ArrayBuffer }) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
  const pages = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    pages.push({ text: content.items.map(item => 'str' in item ? item.str : '').join(' '),
      items: content.items.filter(item => 'str' in item && item.str.trim()), width: page.view[2], height: page.view[3] })
  }
  await pdf.destroy()
  return pages
}

const settings = { companyName: 'Example Framing', currencyCode: 'USD', taxRatePct: 30, taxLabel: 'GST' }

describe('PDF financial fidelity', () => {
  it('labels legacy Paid status without fabricating payment evidence or a zero balance', async () => {
    const invoice = { id: 'paid-old', number: 'INV-PAID-OLD', status: 'Paid', paidAt: '2025-02-02',
      items: [{ id: 'a', description: 'Saved frame', qty: 1, unitPrice: 100 }], subtotal: 100, tax: 20, total: 120, currencyCode: 'GBP' }
    const before = structuredClone(invoice)
    const doc = await exportInvoicePDF({ invoice, settings, download: false })
    const text = (await pagesOf(doc)).map(page => page.text).join(' ').replace(/\s+/g, ' ')
    expect(text).toContain('Recorded status: Paid')
    expect(text).toContain('Paid status recorded; no payment entries recorded.')
    expect(text).toContain('Amount paid £0.00')
    expect(text).toContain('Balance due £120.00')
    expect(text).not.toContain('Recorded payments')
    expect(text).not.toContain('02 Feb 2025')
    expect(invoice).toEqual(before)
  })

  it('prioritises saved job currency over legacy details settings and current branding', async () => {
    const doc = await exportJobCardPDF({ job: { id: 'j1', currency: { code: 'GBP' }, subtotal: 100, tax: 20, total: 120,
      details: { settings: { currencyCode: 'USD' }, costs: { subtotal: 100, taxRate: 0.2, total: 120 } } }, settings, download: false })
    const text = (await pagesOf(doc)).map(page => page.text).join(' ')
    expect(text).toContain('£120.00')
    expect(text).not.toContain('US$')
  })

  it('uses saved legacy currency, line amounts and payment dates without repricing', async () => {
    const doc = await exportInvoicePDF({ invoice: { id: 'legacy', number: 'INV-OLD', createdAt: '2025-01-02',
      currency: { code: 'GBP', symbol: '£' }, status: 'Paid',
      items: [{ id: 'a', description: 'Historical line', qty: 3, unitPrice: 10, total: 29.99 }],
      subtotal: 29.99, tax: 2, taxRate: 0, total: 31.99,
      payments: [{ amount: 10, createdAt: '2025-01-03', method: 'Cash' }] }, settings, download: false })
    const text = (await pagesOf(doc)).map(page => page.text).join(' ')
    expect(text).toContain('£29.99')
    expect(text).toContain('£21.99')
    expect(text).toContain('03 Jan 2025')
    expect(text).toContain('Cash')
    expect(text).toContain('Recorded status: Paid')
    expect(text).not.toContain('$')
  })
})

describe('shared A4 layout', () => {
  it('splits a single oversized table description without losing its ending or overlapping the footer', async () => {
    const doc = await exportInvoicePDF({ invoice: { id: 'large-row', number: 'INV-LARGE-ROW', currencyCode: 'GBP',
      items: [{ id: 'a', description: `${'Oversized description with saved instructions. '.repeat(400)} LAST-ROW-WORD`, qty: 1, unitPrice: 100 }],
      subtotal: 100, tax: 20, total: 120 }, settings, download: false })
    const pages = await pagesOf(doc)
    expect(pages.length).toBeGreaterThan(2)
    expect(pages.map(page => page.text).join(' ')).toContain('LAST-ROW-WORD')
    const totalsPage = pages.find(page => page.text.includes('Balance due'))!
    expect(totalsPage.text).toContain('Subtotal')
    expect(totalsPage.text).toContain('£120.00')
    for (const page of pages) for (const item of page.items) {
      if ('transform' in item) expect(item.transform[5], item.str).toBeGreaterThan(24)
    }
  })

  it.each(['quote', 'invoice', 'job'])('paginates long %s documents with identification and safe text bounds', async kind => {
    const company = { ...settings, companyName: 'The Contemporary Framing and Conservation Workshop '.repeat(4),
      companyAddress: 'First address line\nSecond address line\nA very long town and postal address',
      companyLogoDataUrl: 'broken-image', bankDetails: 'Banking instructions '.repeat(100) }
    const items = Array.from({ length: 65 }, (_, i) => ({ id: `${i}`, name: `Item ${i} ${'Detailed conservation framing description '.repeat(12)}`,
      description: `Item ${i} ${'Detailed conservation framing description '.repeat(12)}`, qty: 1, unitPrice: 10, total: 10 }))
    const notes = `${'Please protect the original artwork during handling. '.repeat(180)} END-OF-NOTES`
    const base = { id: 'local-only', number: 'REF-FULL-12345678901234567890', dateISO: '2026-01-02', items, subtotal: 650, total: 650, notes }
    const doc = kind === 'quote' ? await exportQuotePDF({ quote: base, customer: { firstName: 'Synthetic customer' }, settings: company, download: false })
      : kind === 'invoice' ? await exportInvoicePDF({ invoice: base, settings: company, download: false })
      : await exportJobCardPDF({ job: { ...base, refNo: base.number, description: notes, workInstructions: notes,
        checklist: [{ text: 'Saved completed task', done: true }, { label: 'Saved incomplete task', done: false }] }, settings: company, download: false })
    const pages = await pagesOf(doc!)
    expect(pages.length).toBeGreaterThan(1)
    for (const [index, page] of pages.entries()) {
      expect(page.width).toBeCloseTo(595.28, 1)
      expect(page.height).toBeCloseTo(841.89, 1)
      expect(page.text).toContain(base.number)
      expect(page.text).toContain(`Page ${index + 1} of ${pages.length}`)
      expect(page.text).toContain('Created with FramersApp')
      for (const item of page.items) {
        if (!('transform' in item)) continue
        const baseline = item.transform[5]
        expect(baseline, item.str).toBeGreaterThan(24)
        expect(baseline + item.height, item.str).toBeLessThan(page.height - 28)
      }
    }
    expect(pages.map(page => page.text).join(' ')).toContain('END-OF-NOTES')
  })

  it('separates saved job checklist states from a blank printable final QC', async () => {
    const doc = await exportJobCardPDF({ job: { id: 'j1', refNo: 'JOB-12345678901234567890',
      description: 'Conservation frame', dueDate: '2026-03-02', priority: 'high', assignedTo: 'Workshop A', completedAt: '2026-03-01',
      checklist: [{ text: 'Cut frame', done: true }, { label: 'Fit glazing', done: false }] }, download: false })
    const text = (await pagesOf(doc)).map(page => page.text).join(' ')
    for (const value of ['JOB-12345678901234567890', '[x] Cut frame', '[ ] Fit glazing', 'Printable final QC',
      'complete by hand', 'Signature', 'Date', 'Exception notes', '02 Mar 2026', 'Workshop A']) expect(text).toContain(value)
    expect(text).not.toContain('Bank details')
  })
})
