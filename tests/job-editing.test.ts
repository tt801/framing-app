import { describe, expect, it } from 'vitest'
import { buildJobDetails, jobDetailsDraft, workshopFields } from '@/lib/jobEditing'
import { jobSpecificationFields } from '@/lib/jobSpecification'

const customers = [{ id: 'c1', firstName: 'Local', lastName: 'Customer', email: 'synthetic@example.test' }]
const original = () => ({ id: 'j1', refNo: 1001, createdAt: '2026-10-21', updatedAt: 'revision-1', status: 'new',
  customerId: 'c1', customer: customers[0], customerSnapshot: customers[0], description: 'Repair corner', notes: 'Keep backing',
  artwork: {}, frame: {}, checklist: [{ key: 'qc', label: 'Quality check', done: true }],
  detailsJson: JSON.stringify({ dims: { art: { widthCm: 40, heightCm: 30 } }, frame: { name: 'Original', textureUrl: 'saved-texture' },
    mats: { openings: [{ id: 'opening', x: 2 }], mode: 'pro' }, internalCosts: { frameCost: 7 } }) })

describe('job intake and working specification', () => {
  it('does not rewrite an untouched due date when saving notes', () => {
    const job = { ...original(), dueDate: '2026-11-02T00:00:00.000Z' }
    const draft = jobDetailsDraft(job); draft.notes = 'Changed note'
    expect(buildJobDetails(draft, customers, job).dueDate).toBe(job.dueDate)
    draft.dueDate = ''
    expect(buildJobDetails(draft, customers, job).dueDate).toBeUndefined()
    draft.dueDate = '2026-99-99'
    expect(() => buildJobDetails(draft, customers, job)).toThrow(/due date/i)
  })
  it('preserves a partial details overlay over detailsJson when rendering', () => {
    const job = { ...original(), details: { dims: { art: { widthCm: 42 } } } }
    expect(jobSpecificationFields(job).find(field => field.label === 'Artwork dimensions')?.value).toBe('42 × 30 cm')
  })
  it('requires a local customer and meaningful instructions except for explicit Internal work', () => {
    const draft = jobDetailsDraft()
    expect(() => buildJobDetails(draft, customers)).toThrow(/description|instructions/i)
    draft.description = 'Repair loose corner'
    expect(() => buildJobDetails(draft, customers)).toThrow(/customer/i)
    draft.customerId = 'foreign'
    expect(() => buildJobDetails(draft, customers)).toThrow(/customer/i)
    draft.customerId = ''
    draft.jobType = 'internal'
    const job = buildJobDetails(draft, customers)
    expect(job).toMatchObject({ jobType: 'internal', customer: {}, artwork: {}, frame: {}, checklist: [] })
    expect(job.customerId).toBeUndefined()
    expect(job.customerSnapshot).toBeUndefined()
    expect(job.total).toBeUndefined()
    expect(jobSpecificationFields(job).every(field => field.value === 'Not recorded')).toBe(true)
  })
  it('merges deliberate edits while preserving nested metadata, agreement and source identities', () => {
    const job = { ...original(), quoteId: 'q1', invoiceId: 'i1', total: 202.11, tax: 26.36,
      pricingSnapshot: { version: 1, total: 202.11 }, items: [{ description: 'Selling agreement' }] }
    const before = structuredClone(job)
    const draft = jobDetailsDraft(job)
    expect(draft.spec.artWidth).toBe('40')
    draft.spec.artWidth = '42'
    draft.spec.frameName = 'Working frame'
    draft.notes = 'New workshop note'
    const result = buildJobDetails(draft, customers, job)
    expect(result.details.dims.art).toEqual({ widthCm: 42, heightCm: 30 })
    expect(result.details.frame).toEqual({ name: 'Working frame', textureUrl: 'saved-texture' })
    expect(result.details.mats.openings).toEqual([{ id: 'opening', x: 2 }])
    expect(result.details.internalCosts).toEqual({ frameCost: 7 })
    expect(JSON.parse(result.detailsJson)).toEqual(result.details)
    expect(result).toMatchObject({ quoteId: 'q1', invoiceId: 'i1', customerId: 'c1', total: 202.11, tax: 26.36, pricingSnapshot: job.pricingSnapshot, items: job.items })
    expect(job).toEqual(before)
    expect(result.checklist[0]).toEqual(job.checklist[0])
  })
  it('protects commercially linked customers but permits local standalone reassignment', () => {
    const draft = jobDetailsDraft(original())
    draft.customerId = 'c2'
    const list = [...customers, { ...customers[0], id: 'c2' }]
    expect(buildJobDetails(draft, list, original()).customerId).toBe('c2')
    expect(() => buildJobDetails(draft, list, { ...original(), quoteId: 'q1' })).toThrow(/customer/i)
    expect(() => buildJobDetails(draft, list, { ...original(), invoiceId: 'i1' })).toThrow(/customer/i)
  })
  it('distinguishes cleared measurements, explicit zero and unknown/Off/None states', () => {
    const job = { ...original(), artWcm: 40, dims: { art: { widthCm: 40 } }, frameName: 'Legacy frame' }
    const draft = jobDetailsDraft(job)
    draft.spec.artWidth = ''
    draft.spec.frameName = ''
    draft.spec.mat1State = 'off'
    draft.spec.printing = 'off'
    draft.spec.mat2Border = '0'
    draft.spec.mat2State = 'on'
    const result = buildJobDetails(draft, customers, job)
    const fields = jobSpecificationFields(result)
    expect(fields.find(f => f.label === 'Artwork dimensions')?.value).toContain('Not recorded × 30 cm')
    expect(fields.find(f => f.label === 'Frame')?.value).toBe('Not recorded')
    expect(fields.find(f => f.label === 'Mat 1')?.value).toBe('None')
    expect(fields.find(f => f.label === 'Printing')?.value).toBe('Off')
    expect(fields.find(f => f.label === 'Additional mats')?.value).toContain('0 cm border')
    expect(fields.find(f => f.label === 'Foam/backer')?.value).toBe('Not recorded')
    expect(() => buildJobDetails({ ...draft, spec: { ...draft.spec, artHeight: '-2' } }, customers, job)).toThrow(/measurement/i)
    expect(workshopFields.length).toBeGreaterThan(10)
  })
})
