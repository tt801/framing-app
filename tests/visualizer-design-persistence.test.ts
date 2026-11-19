import { expect, it } from 'vitest'
import { decodeVisualizerPreset } from '@/lib/visualizerScene'
import { createMatSlots } from '@/lib/visualizerMats'
const design = { version: 1, mode: 'basic', layoutModel: 'shared-group-v1', basic: { widthCm: 40, heightCm: 30, imageUrl: 'data:basic' },
  pro: { origin: { x: 8, y: 8 }, openings: [{ id: 'a', shape: 'oval', xCm: 8, yCm: 8, widthCm: 10, heightCm: 15, imageUrl: 'data:pro' }] }, mats: createMatSlots(['a', 'b']) }
it('adapts the additive typed snapshot back to existing preset fields losslessly', () => {
  const result = decodeVisualizerPreset({ visualizerDesign: design, unit: 'imperial' })
  expect(result.issue).toBeNull()
  expect(result.state.art).toEqual(design.basic)
  expect(result.state.mats).toMatchObject({ mode: 'basic', selectedMat1: 'a', selectedMat2: 'b', geometryVersion: 3, openings: design.pro.openings, borders: design.mats.map(s => s.borders) })
})
it('rejects conflicting mirror fields and unknown snapshot versions without inventing replacement values', () => {
  expect(decodeVisualizerPreset({ visualizerDesign: design, art: { ...design.basic, imageUrl: 'data:different' } }).issue).toMatch(/review/)
  expect(decodeVisualizerPreset({ mats: { layoutModel: 'future-layout' } }).issue).toBeTruthy()
  expect(decodeVisualizerPreset({ mats: { proOrigin: { x: 1, y: 2 }, origin: { x: 2, y: 2 } } }).issue).toBeTruthy()
  expect(decodeVisualizerPreset({ visualizerDesign: { ...design, version: 99 } }).issue).toBeTruthy()
})
it('rejects conflicting nested identities, enabled flags, dimensions and artwork mirrors', () => {
  for (const mirror of [
    { mats: { hasMat1: false } },
    { mats: { mat1: { id: 'different', borders: design.mats[0].borders } } },
    { mats: { mat1: { id: 'a', borders: { ...design.mats[0].borders, left: 99 } } } },
    { dims: { art: { widthCm: 99, heightCm: 30 } } },
    { mats: { mat1BorderCm: 99 } },
    { mats: { mat1: { borderCm: 99 } } },
    { artworkUrl: 'data:different' },
  ]) expect(decodeVisualizerPreset({ visualizerDesign: design, ...mirror }).issue).toMatch(/review/)
})
it('does not silently reinterpret malformed or hidden legacy openings', () => {
  for (const mats of [{ mode: 'future' }, { mode: 'basic', openings: [{ id: 'bad', shape: 'triangle' }] }, { proOrigin: { x: NaN, y: 0 } }]) expect(decodeVisualizerPreset({ mats }).issue).toBeTruthy()
  expect(decodeVisualizerPreset({ art: { widthCm: 0 } }).issue).toBeTruthy()
})
it('leaves unversioned legacy records untouched for the existing geometry boundary adapter', () => {
  const old = { art: { imageUrl: 'data:old' }, mats: { selectedMat1: 'm', mat1BorderCm: 5 } }
  expect(decodeVisualizerPreset(old)).toEqual({ state: old, issue: null })
})
