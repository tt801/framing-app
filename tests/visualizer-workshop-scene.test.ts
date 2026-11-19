import { expect, it } from 'vitest'
import { buildJobDetails, jobDetailsDraft } from '@/lib/jobEditing'
import { decodeVisualizerPreset } from '@/lib/visualizerScene'
import { createMatSlots } from '@/lib/visualizerMats'
import { jobSpecificationFields } from '@/lib/jobSpecification'
const mats = createMatSlots(['a','b','c'])
const openings = [{ id: 'one', shape: 'rect', xCm: -10, yCm: 5, widthCm: 15, heightCm: 10, imageUrl: 'data:saved-pro' }]
const job = () => ({ description: 'Shared layout', jobType: 'internal', total: 120, subtotal: 100, tax: 20, pricingSnapshot: { total: 120 }, details: {
  visualizerDesign: { version: 1, layoutModel: 'shared-group-v1', mode: 'pro', basic: { widthCm: 40, heightCm: 30, imageUrl: 'data:original' }, pro: { origin: { x: 8, y: 8 }, openings }, mats },
  dims: { art: { widthCm: 40, heightCm: 30 }, frameFaceWidthCm: 2 },
  mats: { geometryVersion: 3, layoutModel: 'shared-group-v1', mode: 'pro', proOrigin: { x: 8, y: 8 }, openings, borders: mats.map(s => s.borders), hasMat1: true, hasMat2: true, hasMat3: true,
    mat1: { id: 'a', borders: mats[0].borders }, mat2: { id: 'b', borders: mats[1].borders }, mat3: { id: 'c', borders: mats[2].borders } } } })
it('edits a single-board workshop snapshot without enabling or losing retained Basic mats or repricing', () => {
  const old = job()
  const original = { ...old, details: { ...old.details, visualizerDesign: { ...old.details.visualizerDesign, layoutModel: 'single-board-v1' },
    mats: { ...old.details.mats, layoutModel: 'single-board-v1', hasMat2: false, hasMat3: false, mat2: null, mat3: null } } }
  const draft = jobDetailsDraft(original as never); draft.spec.mat1Left = '7'
  const saved = buildJobDetails(draft, [], original as never)
  expect(saved.details!.dims.visible).toEqual({ widthCm: 70, heightCm: 43 })
  expect(saved.details!.visualizerDesign.mats.slice(1)).toEqual(mats.slice(1))
  expect(decodeVisualizerPreset(saved.details).issue).toBeNull()
  expect([saved.subtotal, saved.tax, saved.total, saved.pricingSnapshot]).toEqual([original.subtotal, original.tax, original.total, original.pricingSnapshot])
  expect(jobSpecificationFields(saved).find(f => f.label === 'Mat cut-outs')?.value).toMatch(/single.*board/i)
  const reenable = jobDetailsDraft(saved); reenable.spec.mat2State = 'on'
  expect(() => buildJobDetails(reenable, [], saved)).toThrow(/inactive.*Pro/i)
})
it('workshop edits consume the shared bounds calculation and synchronise additive snapshots without repricing', () => {
  const original = job(); const draft = jobDetailsDraft(original as never); draft.spec.mat2Left = '4'
  const saved = buildJobDetails(draft, [], original as never)
  expect(saved.details!.dims.visible).toEqual({ widthCm: 76, heightCm: 49 })
  expect(saved.details!.visualizerDesign.mats[1].borders.left).toBe(4)
  expect(saved.details!.visualizerDesign.pro.openings).toEqual(openings)
  expect(saved.details!.visualizerDesign.basic.imageUrl).toBe('data:original')
  expect(saved.pricingSnapshot).toEqual(original.pricingSnapshot)
  expect([saved.subtotal, saved.tax, saved.total]).toEqual([100,20,120])
})
it('blocks geometry edits that would clip historical border-area openings while allowing notes-only saves', () => {
  const original = job(); original.details.mats.layoutModel = 'legacy-individual-v1'; original.details.visualizerDesign.layoutModel = 'legacy-individual-v1'
  const draft = jobDetailsDraft(original as never); draft.spec.mat2Left = '4'
  expect(() => buildJobDetails(draft, [], original as never)).toThrow(/review/)
  const notes = jobDetailsDraft(original as never); notes.notes = 'Retain historical agreement'
  expect(buildJobDetails(notes, [], original as never).details).toEqual(original.details)
})
it('retains material identity across workshop disable/re-enable and rejects conflicting snapshots', () => {
  const original = job(), off = jobDetailsDraft(original as never); off.spec.mat2State = 'off'
  const disabled = buildJobDetails(off, [], original as never)
  const on = jobDetailsDraft(disabled); on.spec.mat2State = 'on'
  const enabled = buildJobDetails(on, [], disabled)
  expect(enabled.details!.visualizerDesign.mats[1].materialId).toBe('b')
  expect(enabled.details!.mats.mat2.id).toBe('b')
  expect(enabled.total).toBe(original.total)
  const bad = job(); bad.details.mats.mat2.id = 'conflict'
  const edit = jobDetailsDraft(bad as never); edit.spec.mat2Left = '4'
  expect(() => buildJobDetails(edit, [], bad as never)).toThrow(/review/)
})
it('specifies the active layout and opening measurements while retaining inactive artwork in storage', () => {
  const fields = jobSpecificationFields(job())
  expect(fields.find(f => f.label === 'Mat cut-outs')?.value).toMatch(/shared/i)
  expect(fields.find(f => f.label === 'Opening 1')?.value).toContain('15 × 10 cm')
})
