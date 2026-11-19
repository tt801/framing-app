import { expect, it } from 'vitest'
import { buildJobDetails, jobDetailsDraft } from '@/lib/jobEditing'
import { jobSpecificationFields } from '@/lib/jobSpecification'
import { uniformBorders } from '@/lib/matGeometry'

const job = () => ({ description: 'Historical frame', jobType: 'internal', subtotal: 100, tax: 20, total: 120,
  pricingSnapshot: { version: 1, subtotal: 100, tax: 20, total: 120, items: [{ lineTotal: 100 }] },
  details: { mats: { geometryVersion: 2, hasMat1: true, hasMat2: true, hasMat3: true, proOrigin: { x: 8, y: 8 }, mode: 'pro',
    openings: [{ id: 'one', xCm: 8, yCm: 8, widthCm: 40, heightCm: 30, shape: 'oval', imageUrl: 'data:saved' }],
    mat1: { name: 'Green', borders: uniformBorders(5) }, mat2: { name: 'Blue', borders: uniformBorders(7) }, mat3: { name: 'Red', borders: uniformBorders(8) } },
    dims: { art: { widthCm: 40, heightCm: 30 }, visible: { widthCm: 56, heightCm: 46 }, external: { widthCm: 60, heightCm: 50 }, frameFaceWidthCm: 2 } } })
it('converts Stage B workshop controls to increments and saves coherent geometry without repricing', () => {
  const original = job()
  const draft = jobDetailsDraft(original as never)
  expect(draft.spec.mat2Left).toBe('2')
  expect(draft.spec.mat3Left).toBe('1')
  draft.spec.mat2Left = '4'
  const saved = buildJobDetails(draft, [], original as never)
  expect(saved.details?.mats.geometryVersion).toBe(3)
  expect(saved.details?.mats.borders.map((b: { left: number }) => b.left)).toEqual([5, 4, 1])
  expect(saved.details?.mats.mat2.borders.left).toBe(4)
  expect(saved.details?.dims.visible).toEqual({ widthCm: 58, heightCm: 46 })
  expect(saved.details?.dims.external).toEqual({ widthCm: 62, heightCm: 50 })
  expect(saved.details?.mats.openings).toEqual(original.details.mats.openings)
  expect(saved.details?.mats.proOrigin).toEqual(original.details.mats.proOrigin)
  expect(saved.pricingSnapshot).toEqual(original.pricingSnapshot)
  expect([saved.subtotal, saved.tax, saved.total]).toEqual([100, 20, 120])
  expect(JSON.parse(saved.detailsJson!).mats).toEqual(saved.details?.mats)
  expect(saved.mats).toEqual(saved.details?.mats)
})
it('derives versioned dimensions after artwork edits and rejects conflicting independent internal dimensions', () => {
  const original = job(), draft = jobDetailsDraft(original as never)
  draft.spec.artWidth = '42'
  const saved = buildJobDetails(draft, [], original as never)
  expect(saved.details?.dims.visible).toEqual({ widthCm: 58, heightCm: 46 })
  expect(saved.total).toBe(original.total)
  const conflicting = jobDetailsDraft(original as never)
  conflicting.spec.visibleWidth = '99'
  expect(() => buildJobDetails(conflicting, [], original as never)).toThrow(/derived/i)
})
it('does not convert historical geometry for a notes-only save', () => {
  const original = job(), draft = jobDetailsDraft(original as never)
  draft.notes = 'Workshop note'
  const saved = buildJobDetails(draft, [], original as never)
  expect(saved.details).toEqual(original.details)
  expect(saved.pricingSnapshot).toEqual(original.pricingSnapshot)
})
it('labels frozen absolute versus incremental measurement semantics without modifying historical specifications', () => {
  expect(jobSpecificationFields(job()).find(f => f.label === 'Mat measurements')?.value).toMatch(/absolute/i)
  const current = job(); current.details.mats.geometryVersion = 3
  expect(jobSpecificationFields(current).find(f => f.label === 'Mat measurements')?.value).toMatch(/incremental/i)
})
it('flags unversioned four-sided workshop geometry instead of treating it as incremental', () => {
  const original = job(); delete (original.details.mats as { geometryVersion?: number }).geometryVersion
  const draft = jobDetailsDraft(original as never)
  expect(draft.matMeasurementNote).toMatch(/review/i)
  draft.spec.mat2Left = '4'
  expect(() => buildJobDetails(draft, [], original as never)).toThrow(/review/i)
})
it('refuses geometry edits of invalid Stage B data without preventing notes-only saves', () => {
  const original = job(); original.details.mats.mat2.borders = uniformBorders(3)
  const draft = jobDetailsDraft(original as never)
  draft.spec.mat2Left = '4'
  expect(() => buildJobDetails(draft, [], original as never)).toThrow(/review/i)
  draft.spec.mat2Left = '3'; draft.notes = 'Review needed'
  expect(buildJobDetails(draft, [], original as never).pricingSnapshot).toEqual(original.pricingSnapshot)
})
