import type { CommercialSnapshot } from '../pricing'
import { PdfLayout } from './pdfLayout'
import { pdfCommercial, pdfCustomer, pdfDate } from './pdfDocumentData'
import type { Customer, InvoicePdfSettings } from './invoicePdf'

export interface QuotePdfItem { name: string; qty: number; unitPrice: number; total: number }
export interface QuotePdfQuote {
  id: string; number: string; dateISO: string; status?: string; items: QuotePdfItem[]; subtotal: number; total: number
  notes?: string; currency?: string | { code?: string; symbol?: string }; currencyCode?: string; currencySymbol?: string
  tax?: number; taxRate?: number; taxLabel?: string; pricingSnapshot?: CommercialSnapshot
}
export type QuotePdfCustomer = Customer
export interface QuotePdfSettings extends InvoicePdfSettings {
  themeColor?: string; taxNumber?: string; quoteFooterNote?: string
}
export interface ExportQuotePdfOptions {
  quote: QuotePdfQuote; customer: QuotePdfCustomer; settings: QuotePdfSettings; download?: boolean
}

export async function exportQuotePDF({ quote, customer, settings, download = true }: ExportQuotePdfOptions) {
  const values = pdfCommercial(quote, settings)
  const date = pdfDate(quote.dateISO)
  const layout = new PdfLayout('Quote', quote.number || quote.id, settings, [
    date && `Issued: ${date}`, quote.status ? `Status: ${quote.status}` : '',
  ])
  layout.block('Prepared for', pdfCustomer({}, customer).join('\n') || 'Customer not recorded')
  layout.table(['Description', 'Qty', 'Unit price', 'Amount'], values.items.map(item => [
    item.description, String(item.qty), values.money(item.unitPrice), values.money(item.amount),
  ]), true)
  layout.totals([
    ['Subtotal', values.money(values.subtotal)], [`${values.taxTitle}:`, values.money(values.tax)], ['Total', values.money(values.total), true],
  ], values.currency)
  layout.block('Notes', quote.notes || '')
  layout.block('Payment details', layout.brand.bank)
  layout.block('Additional information', layout.brand.quoteFooter)
  const doc = layout.finish()
  if (download) doc.save(`Quote-${quote.number || quote.id || 'quote'}.pdf`)
  return doc
}