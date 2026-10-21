import type { Job } from './jobs'
import type { Quote } from './quotes'
import { invoiceFromQuote } from './commercialDocuments'
import { isRecord } from './persistedRows'
import { toVisualiserJobCosts } from './pricing'

/** Quotes have globally unique IDs; the existing jobs primary key also guards concurrent conversion. */
export const quoteJobId = (quoteId: string) => `quote-job:${quoteId}`

function validSpecification(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.artwork) || !isRecord(value.frame) || !isRecord(value.details)) return false
  for (const source of [value, value.details]) {
    for (const key of ['customer', 'customerSnapshot', 'dims', 'mats', 'frame', 'glazing', 'printing', 'backer', 'costs']) {
      if (source[key] !== undefined && !isRecord(source[key])) return false
    }
    if (isRecord(source.dims) && ['art', 'visible'].some(key => source.dims[key] !== undefined && !isRecord(source.dims[key]))) return false
  }
  if (value.checklist !== undefined && (!Array.isArray(value.checklist) || !value.checklist.every(item =>
    isRecord(item) && ((typeof item.id === 'string' && Boolean(item.id) && typeof item.text === 'string' && Boolean(item.text) && (item.done === undefined || typeof item.done === 'boolean')) ||
      (typeof item.key === 'string' && Boolean(item.key) && typeof item.label === 'string' && Boolean(item.label) && typeof item.done === 'boolean'))))) return false
  return true
}

export function jobFromQuote(quote: Quote): Partial<Job> {
  const specification = quote.jobSpecification
  if (specification !== undefined && !validSpecification(specification))
    throw new Error('This quote has a malformed saved framing specification. Review it before creating a job.')
  if (quote.status !== 'Accepted') throw new Error('Accept the saved quote before creating its job.')
  if (!quote.customerId) throw new Error('The quote must have a saved customer before creating its job.')
  const agreement = JSON.parse(JSON.stringify(invoiceFromQuote(quote))) as ReturnType<typeof invoiceFromQuote>
  if (![agreement.subtotal, agreement.tax, agreement.total].every(value => typeof value === 'number' && Number.isFinite(value)))
    throw new Error('The quote has incomplete saved commercial values.')
  // JSON copy matches the persisted boundary and keeps job edits independent of its source quote.
  const saved = JSON.parse(JSON.stringify(specification ?? { artwork: {}, frame: {}, checklist: [] })) as Partial<Job>
  // Specifications are design snapshots, never authorities for identity or numbering.
  delete saved.refNo
  delete saved.invoiceId
  const customerSnapshot = JSON.parse(JSON.stringify(quote.customerSnapshot ?? saved.customerSnapshot ?? saved.customer ?? {}))
  const costs = { ...(agreement.pricingSnapshot ? toVisualiserJobCosts(agreement.pricingSnapshot) : {}),
    subtotal: agreement.subtotal, tax: agreement.tax, taxRate: agreement.taxRate,
    total: agreement.total, currency: agreement.currency }
  return { ...saved, id: quoteJobId(quote.id), createdAt: new Date().toISOString(), quoteId: quote.id,
    quoteNumber: quote.number ?? quote.quoteNumber ?? quote.reference ?? quote.ref ?? quote.details?.quoteNumber,
    description: quote.description ?? quote.details?.description ?? saved.description,
    workInstructions: quote.workInstructions ?? quote.instructions ?? quote.details?.workInstructions ?? quote.details?.instructions ?? saved.workInstructions,
    notes: quote.notes ?? quote.internalNotes ?? quote.details?.notes ?? saved.notes,
    customerId: quote.customerId, status: 'new', priority: 'normal', ...costs,
    costs, currencyCode: agreement.currencyCode, currencySymbol: agreement.currencySymbol,
    items: agreement.items, pricingSnapshot: agreement.pricingSnapshot,
    customerSnapshot, customer: customerSnapshot,
    details: { ...saved.details, costs, pricingSnapshot: agreement.pricingSnapshot },
    detailsJson: JSON.stringify({ ...saved.details, costs, pricingSnapshot: agreement.pricingSnapshot }),
  }
}
