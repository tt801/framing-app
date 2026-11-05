import type { CommercialSnapshot } from '../pricing'
import { PdfLayout } from './pdfLayout'
import { invoicePdfStatus, pdfCommercial, pdfCustomer, pdfDate, text } from './pdfDocumentData'

export type InvoiceItem = { id: string; description?: string; name?: string; qty: number; unitPrice: number; total?: number }
export type InvoicePayment = { dateISO?: string; createdAt?: string; method?: string; notes?: string; amount: number }
export type Customer = {
  id?: string; firstName?: string; lastName?: string; name?: string; email?: string; company?: string; phone?: string
  address1?: string; address2?: string; city?: string; state?: string; postalCode?: string; postcode?: string; country?: string
}
export type Invoice = {
  id: string; number: string; dateISO?: string; createdAt?: string; dueDateISO?: string; items: InvoiceItem[]
  subtotal?: number; total?: number; tax?: number; taxRate?: number; taxLabel?: string
  currencyCode?: string; currencySymbol?: string; currency?: string | { code?: string; symbol?: string }
  customerSnapshot?: Customer; customer?: Customer | string; customerName?: string; customerEmail?: string; customerPhone?: string
  notes?: string; payments?: InvoicePayment[]; taxExempt?: boolean; pricingSnapshot?: CommercialSnapshot; status?: string
  [key: string]: unknown
}
export type InvoicePdfSettings = {
  currencyCode?: string; currencySymbol?: string; companyName?: string; companyNumber?: string; registrationNumber?: string
  companyAddress?: string; companyAddress1?: string; companyAddress2?: string; companyEmail?: string; companyPhone?: string
  logoDataUrl?: string; companyLogoDataUrl?: string; taxLabel?: string; taxRatePct?: number; vatNumber?: string
  bankDetails?: string; paymentTermsDays?: number; invoiceFooter?: string; invoiceFooterNote?: string; taxDetails?: string
}

export async function exportInvoicePDF(args: {
  invoice: Invoice; customer?: Customer; settings: InvoicePdfSettings; fileName?: string; download?: boolean
}) {
  const { invoice, customer, settings, fileName, download = true } = args
  const values = pdfCommercial(invoice, settings)
  const state = invoicePdfStatus(invoice, values)
  const issue = pdfDate(invoice.dateISO ?? invoice.createdAt), due = pdfDate(invoice.dueDateISO)
  const layout = new PdfLayout('Invoice', invoice.number || invoice.id, settings, [
    issue && `Issued: ${issue}`, due && `Due: ${due}`, `Recorded status: ${state.status}`, `Payment: ${state.summary}`,
  ])
  layout.block('Bill to', pdfCustomer(invoice, customer).join('\n') || 'Customer not recorded')
  if (state.warning) layout.paragraph(state.warning, { size: 9 })
  layout.table(['Description', 'Qty', 'Unit price', 'Amount'], values.items.map(item => [
    item.description, String(item.qty), values.money(item.unitPrice), values.money(item.amount),
  ]), true)
  layout.totals([
    ['Subtotal', values.money(values.subtotal)], [values.taxTitle, values.money(values.tax)],
    ['Total', values.money(values.total), true], ['Amount paid', values.money(values.paid)],
    [values.balance < 0 ? 'Credit balance' : 'Balance due', values.money(values.balance < 0 ? -values.balance : values.balance), true],
  ], values.currency)
  if (values.payments.length) {
    layout.section('Recorded payments')
    values.payments.forEach(payment => layout.paragraph([
      payment.date || 'Date not recorded', values.money(payment.amount), payment.method, payment.notes,
    ].filter(Boolean).join(' — '), { size: 9 }))
  }
  if (layout.brand.bank) layout.block('Payment instructions', `${layout.brand.bank}\nPayment reference: ${invoice.number || invoice.id}`)
  layout.block('Notes', text(invoice.notes))
  layout.paragraph(layout.brand.invoiceFooter, { size: 9 })
  const doc = layout.finish()
  if (download) doc.save(fileName || `Invoice_${invoice.number || invoice.id}.pdf`)
  return doc
}