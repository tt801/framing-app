import { expect, it } from 'vitest'
import { matColour, createMatSlots, deleteMatSlot, selectMatMaterial, editMatSide, restoreMatLocks, matDisplayValue, matPhysicalValue } from '@/lib/visualizerMats'
import { uniformBorders } from '@/lib/matGeometry'
it('uses the catalogue color field over a stale historical colour alias', () => {
  expect(matColour({ color: '#0000ff', colour: '#ff0000' })).toBe('#0000ff')
  expect(matColour({ color: ' ', colour: '#ff0000' })).toBe('#ff0000')
  expect(matColour(undefined)).toBe('#EEE')
})
it('compacts materials upward without moving destination measurements or lock states', () => {
  const slots = createMatSlots(['a', 'b', 'c'])
  slots[1].borders.left = 4; slots[1].locked = false
  const next = deleteMatSlot(slots, 1)
  expect(next.map(s => s.materialId)).toEqual(['a', 'c', 'mat0'])
  expect(next[1].borders.left).toBe(4)
  expect(next[1].locked).toBe(false)
  expect(deleteMatSlot(slots, 0).map(s => s.materialId)).toEqual(['b', 'c', 'mat0'])
  expect(deleteMatSlot(slots, 0).map(s => s.borders.top)).toEqual([5, 2, 1])
  expect(slots.map(s => s.materialId)).toEqual(['a', 'b', 'c'])
})
it('resets a newly filled empty position to defaults, but changing a material preserves measurements', () => {
  const slots = createMatSlots(['a', 'b', 'c']); slots[2].borders.left = 9
  const removed = deleteMatSlot(slots, 2)
  const added = selectMatMaterial(removed, 2, 'd')
  expect(added[2]).toMatchObject({ materialId: 'd', borders: uniformBorders(1), locked: true })
  added[1].borders.left = 7
  expect(selectMatMaterial(added, 1, 'e')[1].borders.left).toBe(7)
})
it('locking never changes asymmetric values; the next locked edit synchronises every side', () => {
  const slots = createMatSlots(['a']); slots[0].borders.left = 9
  expect(editMatSide(slots, 0, 'right', 3)[0].borders).toEqual(uniformBorders(3))
  slots[0].locked = false
  expect(editMatSide(slots, 0, 'right', 3)[0].borders).toEqual({ top: 5, bottom: 5, left: 9, right: 3 })
  expect(restoreMatLocks([slots[0].borders, uniformBorders(2), uniformBorders(1)])).toEqual([false, true, true])
  expect(restoreMatLocks([slots[0].borders], [true])).toEqual([true])
})
it('converts display units without changing stored centimetres', () => {
  expect(matDisplayValue(5, 0, 'metric')).toBe(5)
  expect(matDisplayValue(2, 1, 'metric')).toBe(20)
  expect(matPhysicalValue(10, 2, 'metric')).toBe(1)
  for (const slot of [0, 1, 2]) expect(matPhysicalValue(matDisplayValue(5, slot, 'imperial'), slot, 'imperial')).toBeCloseTo(5, 12)
})
