import { describe, expect, it } from 'vitest'
import { priceVisualiser, toVisualiserQuote } from '@/lib/pricing'
import { jobFromQuote, quoteJobId } from '@/lib/quoteJobLinkage'

const pricingSnapshot = priceVisualiser({ artWcm: 40, artHcm: 30, borderCm: 5,
  frame: { id: 'oak', name: 'Oak', pricePerMeter: 10 }, mats: [{ id: 'mat', name: 'White', pricePerSqM: 5 }],
  glazing: { id: 'glass', name: 'Glass', pricePerSqM: 8 }, labourBase: 120, marginMultiplier: 1.25,
  taxRatePct: 15, taxLabel: 'VAT', currencyCode: 'GBP', currencySymbol: '£' })
const quote = () => ({ ...toVisualiserQuote(pricingSnapshot), id: 'q1', number: 'Q-001', status: 'Accepted', customerId: 'c1',
  jobSpecification: { artwork: { widthCm: 40, heightCm: 30 }, frame: { id: 'oak', name: 'Oak' },
    customerSnapshot: { id: 'c1', firstName: 'Original' }, details: { dims: { art: { widthCm: 40, heightCm: 30 } },
      mats: { mat1: { id: 'mat', borderCm: 5 } }, costs: {} }, checklist: [{ id: 'cut', text: 'Cut', done: false }] } })

describe('accepted quote to job agreement', () => {
  it('uses the quote agreement and customer after Draft edits, never stale specification identities or numbering', () => {
    const source = { ...quote(), customerSnapshot: { id: 'c1', firstName: 'Accepted' },
      jobSpecification: { ...quote().jobSpecification, refNo: 9000, invoiceId: 'stale-invoice',
        costs: { total: 1 }, tax: 1, currencyCode: 'USD' } }
    const job = jobFromQuote(source)
    expect(job).not.toHaveProperty('refNo')
    expect(job).not.toHaveProperty('invoiceId')
    expect(job.customerSnapshot).toEqual(source.customerSnapshot)
    expect(job.customer).toEqual(source.customerSnapshot)
    expect(job.costs).toMatchObject({ total: source.total, tax: source.tax })
    expect(job.currencyCode).toBe('GBP')
  })
  it('copies saved framing and commercial state without repricing or sharing mutable data', () => {
    const source = quote()
    const job = jobFromQuote(source)
    expect(job).toMatchObject({ id: quoteJobId('q1'), quoteId: 'q1', customerId: 'c1', status: 'new',
      subtotal: 175.75, tax: 26.36, total: 202.11, currency: { code: 'GBP', symbol: '£' },
      artwork: { widthCm: 40, heightCm: 30 }, frame: { id: 'oak' }, customerSnapshot: { firstName: 'Original' } })
    expect(job.pricingSnapshot).toEqual(source.pricingSnapshot)
    expect(job).not.toHaveProperty('refNo')
    job.artwork!.widthCm = 99
    expect(source.jobSpecification.artwork.widthCm).toBe(40)
    expect(job.details.costs.total).toBe(202.11)
    expect(job.details.costs.lineItems).toEqual(source.pricingSnapshot.items.map(line => ({
      k: line.key, label: line.description, amount: line.lineTotal,
    })))
  })
})
