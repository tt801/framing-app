import type { CommercialSnapshot } from '../pricing'
import { roundMoney } from '../pricing'

export type PdfRecord = Record<string, unknown>
export const record = (value: unknown): PdfRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as PdfRecord : {}
export const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const firstText = (...values: unknown[]) => values.map(text).find(value => value.trim()) || ''
const number = (value: unknown): number | undefined => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined

export function pdfDate(value: unknown): string {
  if (!value) return ''
  // Date-only fields must not move to yesterday in a negative UTC offset.
  const raw = text(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
}

export function pdfSettings(value: unknown) {
  const s = record(value)
  const address = firstText(s.companyAddress) || [s.companyAddress1 ?? s.addressLine1, s.companyAddress2 ?? s.addressLine2, s.city, s.region, s.postalCode, s.country].map(text).filter(Boolean).join('\n')
  const bank = firstText(s.bankDetails) || [s.bankName, s.bankAccountNumber && `Account: ${text(s.bankAccountNumber)}`, s.bankBranchCode && `Branch: ${text(s.bankBranchCode)}`].map(text).filter(Boolean).join('\n')
  return {
    name: firstText(s.companyName) || 'Framing business', address,
    email: firstText(s.companyEmail, s.email), phone: firstText(s.companyPhone, s.phone), website: text(s.website),
    registration: firstText(s.companyNumber, s.registrationNumber), vat: firstText(s.vatNumber, s.taxNumber),
    logo: firstText(s.logoDataUrl, s.companyLogoDataUrl), accent: firstText(s.themeColor) || '#334155', bank,
    quoteFooter: text(s.quoteFooterNote), invoiceFooter: firstText(s.invoiceFooter, s.invoiceFooterNote), jobFooter: text(s.jobCardFooterNote),
  }
}

/** Choose a saved representation as a whole; explicit invoice blanks still win. */
export function pdfCustomer(document: unknown, fallback?: unknown) {
  const d = record(document)
  const saved = d.customerSnapshot ?? d.customer ?? record(d.details).customer ?? fallback
  const c = typeof saved === 'string' ? { name: saved } : record(saved)
  const name = d.customerName != null ? text(d.customerName) : firstText(c.name, [c.firstName, c.lastName].map(text).filter(Boolean).join(' '), c.company)
  const company = text(c.company)
  return [name, company && company !== name ? company : '',
    c.address1, c.address2, [c.city, c.state ?? c.region, c.postalCode ?? c.postcode].map(text).filter(Boolean).join(' '), c.country,
    d.customerEmail ?? c.email, d.customerPhone ?? c.phone].map(text).filter(Boolean)
}

/** Presentation only: no current catalogue rates or current tax settings enter saved totals. */
export function pdfCommercial(document: unknown, settings?: unknown) {
  const d = record(document), s = record(settings)
  const snapshot = record(d.pricingSnapshot).version === 1 ? d.pricingSnapshot as CommercialSnapshot : undefined
  const currency = snapshot?.currencyCode || firstText(d.currencyCode, typeof d.currency === 'string' ? d.currency : record(d.currency).code, s.currencyCode) || 'ZAR'
  const symbol = snapshot?.currencySymbol || firstText(d.currencySymbol, record(d.currency).symbol, s.currencySymbol)
  const money = (value: number) => {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value) } catch { return `${symbol || currency + ' '}${value.toFixed(2)}` }
  }
  const round = (value: number) => { try { return roundMoney(value, currency) } catch { return Math.round(value * 100) / 100 } }
  const rawItems = snapshot?.items ?? (Array.isArray(d.items) ? d.items : [])
  const items = rawItems.map((value: unknown) => {
    const item = record(value), qty = number(item.qty) ?? 0, unitPrice = number(item.unitPrice) ?? 0
    return { description: firstText(item.description, item.name) || 'Item', qty, unitPrice,
      amount: number(item.lineTotal) ?? number(item.total) ?? round(qty * unitPrice) }
  })
  const subtotal = number(d.subtotal) ?? snapshot?.subtotal ?? round(items.reduce((sum, item) => sum + item.amount, 0))
  const total = number(d.total) ?? snapshot?.total ?? number(d.grandTotal) ?? subtotal
  const tax = number(d.tax) ?? snapshot?.tax ?? round(total - subtotal)
  const rawRate = snapshot?.taxRate ?? number(d.taxRate)
  const taxRatePct = rawRate === undefined ? undefined : rawRate > 1 ? rawRate : rawRate * 100
  const taxLabel = snapshot?.taxLabel || firstText(d.taxLabel) || 'Tax'
  const taxTitle = `${taxLabel}${taxRatePct === undefined ? '' : ` (${taxRatePct.toFixed(2)}%)`}`
  const payments = (Array.isArray(d.payments) ? d.payments : []).map(value => {
    const p = record(value)
    return { amount: number(p.amount) ?? 0, date: pdfDate(p.dateISO ?? p.createdAt), method: text(p.method), notes: text(p.notes) }
  })
  const paid = round(payments.reduce((sum, payment) => sum + payment.amount, 0))
  return { items, subtotal, total, tax, taxTitle, currency, money, payments, paid, balance: round(total - paid) }
}

export function invoicePdfStatus(document: unknown, commercial: ReturnType<typeof pdfCommercial>) {
  const d = record(document), status = text(d.status) || 'Draft'
  const summary = commercial.balance < 0 ? 'Credit balance' : commercial.total > 0 && commercial.balance === 0 && commercial.payments.length ? 'Paid' : commercial.paid > 0 ? 'Part-paid' : 'Unpaid'
  return { status, summary, warning: status.toLowerCase() === 'paid' && !commercial.payments.length ? 'Paid status recorded; no payment entries recorded.' : '' }
}
