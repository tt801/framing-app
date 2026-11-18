import { expect, it } from 'vitest'
import { jobSpecificationFields } from '@/lib/jobSpecification'
import { jobDetailsDraft, buildJobDetails } from '@/lib/jobEditing'

it('reads four physical distances from the frozen specification rather than a scalar fallback', () => {
  const job = { details: { mats: { hasMat1: true, mat1: { name: 'Green', borderCm: 99, borders: { top: 3, bottom: 8, left: 4, right: 6 } } } } }
  const text = jobSpecificationFields(job).find(f => f.label === 'Mat 1')!.value
  expect(text).toBe('Green — Top 3 cm; Bottom 8 cm; Left 4 cm; Right 6 cm')
})
it('retains legacy scalar descriptions without inventing new measurements', () => {
  expect(jobSpecificationFields({ details: { mats: { mat1: { name: 'Legacy', borderCm: 5 } } } }).find(f => f.label === 'Mat 1')!.value).toBe('Legacy — 5 cm border')
})
it('round trips four-sided workshop measurements without repricing historical agreements', () => {
  const job = { description: 'Frame', jobType: 'internal', pricingSnapshot: { total: 123 }, details: { mats: { mat1: { name: 'Green', borders: { top: 3, bottom: 8, left: 4, right: 6 } } } } }
  const draft = jobDetailsDraft(job as never)
  expect(draft.spec.mat1Left).toBe('4')
  draft.spec.mat1Left = '9'
  const saved = buildJobDetails(draft, [], job as never)
  expect(jobDetailsDraft(saved).spec.mat1Left).toBe('9')
  expect((saved as unknown as { pricingSnapshot: unknown }).pricingSnapshot).toEqual(job.pricingSnapshot)
})
it('never revives a stale scalar when four-sided workshop measurements are partially cleared', () => {
  const field = jobSpecificationFields({ details: { mats: { mat1: { name: 'Partial', borderCm: 99, borders: { left: 4 } } } } }).find(f => f.label === 'Mat 1')!
  expect(field.value).toContain('Left 4 cm')
  expect(field.value).toContain('Top Not recorded')
  expect(field.value).not.toContain('99')
})
