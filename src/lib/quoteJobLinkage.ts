import type { Job } from './jobs'
import type { Quote } from './quotes'
import { invoiceFromQuote } from './commercialDocuments'
import { isRecord } from './persistedRows'
import { toVisualiserJobCosts } from './pricing'

/** Quotes have globally unique IDs; the existing jobs primary key also guards concurrent conversion. */
export const quoteJobId = (quoteId: string) => `quote-job:${quoteId}`

export function jobFromQuote(quote: Quote): Partial<Job> {
  const specification = quote.jobSpecification
  if (!isRecord(specification) || !isRecord(specification.artwork) || !isRecord(specification.frame) || !isRecord(specification.details))
    throw new Error('This quote has no saved framing specification. It cannot be converted automatically.')
  if (quote.status !== 'Accepted') throw new Error('Accept the saved quote before creating its job.')
  if (!quote.customerId) throw new Error('The quote must have a saved customer before creating its job.')
  const agreement = invoiceFromQuote(quote)
  if (![agreement.subtotal, agreement.tax, agreement.total].every(value => typeof value === 'number' && Number.isFinite(value)))
    throw new Error('The quote has incomplete saved commercial values.')
  // JSON copy matches the persisted boundary and keeps job edits independent of its source quote.
  const saved = JSON.parse(JSON.stringify(specification)) as Partial<Job>
  // Specifications are design snapshots, never authorities for identity or numbering.
  delete saved.refNo
  delete saved.invoiceId
  const customerSnapshot = JSON.parse(JSON.stringify(quote.customerSnapshot ?? saved.customerSnapshot ?? saved.customer ?? {}))
  const costs = { ...(agreement.pricingSnapshot ? toVisualiserJobCosts(agreement.pricingSnapshot) : {}),
    subtotal: agreement.subtotal, tax: agreement.tax, taxRate: agreement.taxRate,
    total: agreement.total, currency: agreement.currency }
  return { ...saved, id: quoteJobId(quote.id), createdAt: new Date().toISOString(), quoteId: quote.id,
    customerId: quote.customerId, status: 'new', priority: 'normal', ...costs,
    costs, currencyCode: agreement.currencyCode, currencySymbol: agreement.currencySymbol,
    items: agreement.items, pricingSnapshot: agreement.pricingSnapshot,
    customerSnapshot, customer: customerSnapshot,
    details: { ...saved.details, costs, pricingSnapshot: agreement.pricingSnapshot },
    detailsJson: JSON.stringify({ ...saved.details, costs, pricingSnapshot: agreement.pricingSnapshot }),
  }
}
