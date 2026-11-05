import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
import { priceSellingDocument, toVisualiserQuote, toVisualiserInvoice } from '@/lib/pricing'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

// Entirely synthetic branding and customer data; never reads a database.
const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAABICAIAAADQ/0gHAAABSElEQVR4nO3d0W3CMBRAUSbqDpU6UzfqnO0EV7IJSR18jt4vknncn1gCHr8QHv99ANYlDpI4SOIgiYMkDpI4SBnHx+fXLebKZe1GHCRxkMRBEgdJHKSJOK48VlnzVO9KHCRxkMRBEgdJHCRxkMRB2iiOI1dt7zcjG3tZHD/fn6+aqQ945E3Wa3eekY2JY9MZ2Zg4Np2RjYlj0xnZmDg2nZGNbRQHs06M49VHfeZUHCEOkjhI4iCJg7TE08r4ccVxJXGQNorjyJXRyjO+gVniuP2Mb2CWOG4/4xuYJY7bz/gGZnmUJYmDJA6SOEjiIImDJA6SOEgbxXHkounKOWNvzxHHcnPG3p7ju7LLzXnbmyWO5ea87c3aKA5miYMkDpI4SOIgiYPkh/FJ4iCJgyQOkjhI4iD502GSOEjiIImDJA6SOEjiIImD9Af/YuJBsafk0wAAAABJRU5ErkJggg=='
const settings = { companyName: 'Oak & Linen Framing', companyAddress: '24 Example Lane\nBristol BS1 1AA',
  companyEmail: 'studio@example.invalid', companyPhone: '+44 0000 000000', website: 'https://example.invalid',
  registrationNumber: 'SYNTHETIC-123', vatNumber: 'GB-SAMPLE', companyLogoDataUrl: logo, themeColor: '#2E4144',
  currencyCode: 'GBP', currencySymbol: '£', bankDetails: 'Synthetic Bank\nAccount: 00000000 | Sort code: 00-00-00',
  quoteFooterNote: 'Please contact the studio if you would like to discuss your framing specification.',
  invoiceFooterNote: 'Thank you for supporting an independent framing business.' }
const customer = { firstName: 'Jamie', lastName: 'Example', email: 'jamie@example.invalid', address1: '8 Sample Road', city: 'Bristol', postalCode: 'BS2 2BB' }
const common = { id: 'synthetic-only', createdAt: '2026-11-05', dateISO: '2026-11-05', status: 'Sent', customerSnapshot: customer }

async function multiPageInvoiceSample() {
  const many = priceSellingDocument({ currencyCode: 'GBP', taxRatePct: 20, taxLabel: 'VAT', items: Array.from({ length: 32 }, (_, i) => ({
    description: `Artwork ${i + 1}: bespoke conservation frame with archival mount and UV-filtering glazing. Confirm orientation and retain original edges.`, qty: 1, unitPrice: 125 + i,
  })) })
  const document = await exportInvoicePDF({ invoice: { ...toVisualiserInvoice(many), ...common, number: 'INV-PILOT-MULTIPAGE',
    dueDateISO: '2026-11-19', notes: `${'Synthetic handling and collection instructions. '.repeat(100)} END OF SYNTHETIC NOTES`,
    payments: [{ amount: 500, createdAt: '2026-11-05', method: 'Bank transfer' }] }, settings: { ...settings, companyLogoDataUrl: '' }, download: false })
  return { document, descriptions: many.items.map(item => item.description) }
}

it('keeps each normal-sized multi-page sample description wholly on one page, including Artwork 22', async () => {
  const { document, descriptions } = await multiPageInvoiceSample()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(document.output('arraybuffer')) }).promise
  try {
    const pages: string[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' '))
    }
    expect(descriptions).toHaveLength(32)
    for (const description of descriptions) {
      expect(pages.filter(page => page.includes(description)), description).toHaveLength(1)
    }
  } finally {
    await pdf.destroy()
  }
})

it('generates representative real synthetic PDFs (optional external review directory)', async () => {
  const snapshot = priceSellingDocument({ currencyCode: 'GBP', taxRatePct: 20, taxLabel: 'VAT', items: [
    { description: 'Natural oak frame — hand-finished profile, conservation mount and UV-filtering glazing', qty: 1, unitPrice: 185 },
    { description: 'Archival mounting and finishing', qty: 1, unitPrice: 45 },
  ] })

  const quote = await exportQuotePDF({ quote: { ...toVisualiserQuote(snapshot), ...common, number: 'Q-PILOT-001',
    notes: 'Conservation materials as discussed. Please confirm the specification before work begins.' }, customer, settings, download: false })
  const invoice = await exportInvoicePDF({ invoice: { ...toVisualiserInvoice(snapshot), ...common, number: 'INV-PILOT-001',
    dueDateISO: '2026-11-19', payments: [{ amount: 100, createdAt: '2026-11-05', method: 'Bank transfer' }] }, settings, download: false })
  const job = await exportJobCardPDF({ job: { ...common, refNo: 'JOB-PILOT-000001', status: 'in-progress', jobType: 'customer',
    description: 'Coastal landscape — conservation framing', workInstructions: 'Retain the original artwork edges. Use reversible archival mounting; confirm orientation before fitting.',
    dueDate: '2026-11-18', assignedTo: 'Workshop bench 1', priority: 'normal',
    details: { dims: { art: { widthCm: 40, heightCm: 30 }, visible: { widthCm: 50, heightCm: 40 }, frameFaceWidthCm: 2 },
      frame: { name: 'Natural oak 20 mm' }, glazing: { name: 'UV-filtering glass' }, mats: { hasMat1: true, mat1: { name: 'Warm white conservation', borderCm: 5 }, hasMat2: false, hasMat3: false }, printing: { include: false }, backer: { include: true } },
    checklist: [{ text: 'Artwork condition and dimensions recorded', done: true }, { text: 'Frame assembled', done: true }, { text: 'Final fitting and packaging', done: false }] }, settings, download: false })
  const { document: long } = await multiPageInvoiceSample()
  const docs = { 'quote.pdf': quote, 'invoice.pdf': invoice, 'job-card.pdf': job, 'invoice-multipage.pdf': long }
  expect(invoice.getNumberOfPages()).toBe(1)
  expect(long.getNumberOfPages()).toBeGreaterThan(1)
  for (const doc of [quote, invoice, job]) expect(doc.output()).toContain('/Subtype /Image')
  expect(long.output()).not.toContain('/Subtype /Image')
  const directory = process.env.FRAMERSAPP_PDF_REVIEW_DIR
  if (directory) {
    if (!isAbsolute(directory) || resolve(directory) === process.cwd() || resolve(directory).startsWith(process.cwd() + sep))
      throw new Error('Review output must be an absolute path outside the repository')
    mkdirSync(directory, { recursive: true })
    const manifest = Object.entries(docs).map(([name, doc]) => {
      const bytes = Buffer.from(doc.output('arraybuffer'))
      writeFileSync(join(directory, name), bytes)
      return { name, pages: doc.getNumberOfPages(), bytes: bytes.length }
    })
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }
})
