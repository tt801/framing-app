import { expect, it } from 'vitest'
import { matGeometry, normalizeMatBorders, restoreMatBorders, uniformBorders } from '@/lib/matGeometry'

it('keeps independent incremental values, including inactive slots', () => {
  const b = normalizeMatBorders([5, 2, 1], [true, false, false])
  expect(b.map(v => v.left)).toEqual([5, 2, 1])
  b[0].left = 9
  const g = matGeometry(40, 30, 2, b, [true, true, true])
  expect(g.total).toEqual({ top: 8, bottom: 8, left: 12, right: 8 })
  expect(g.layers.map(l => l.borders.left)).toEqual([9, 11, 12])
  expect(g.internal).toEqual({ width: 60, height: 46 })
})
it('sums asymmetric contributions independently on each side', () => {
  const b = [{ top: 2, bottom: 4, left: 3, right: 5 }, { top: 1, bottom: 2, left: 1, right: 2 }, { top: 2, bottom: 2, left: 2, right: 2 }]
  const g = matGeometry(40, 30, 2, b, [true, true, true])
  expect(g.internal).toEqual({ width: 55, height: 43 })
  expect(g.external).toEqual({ width: 59, height: 47 })
  expect(g.layers.map(l => l.aperture.width)).toEqual([47, 44, 40])
  expect(g.issue).toBeNull()
})
it('ignores disabled contributions without erasing their settings', () => {
  const b = [uniformBorders(5), uniformBorders(2), uniformBorders(1)]
  for (let mask = 0; mask < 8; mask++) {
    const active = [1, 2, 4].map(bit => !!(mask & bit))
    const total = [5, 2, 1].reduce((sum, v, i) => sum + (active[i] ? v : 0), 0)
    expect(matGeometry(40, 30, 2, b, active).total.left).toBe(total)
    expect(b.map(v => v.left)).toEqual([5, 2, 1])
  }
})
it('preserves explicit zero increments and rejects negative or nonfinite inputs', () => {
  expect(matGeometry(40, 30, 2, [uniformBorders(0)], [true]).internal).toEqual({ width: 40, height: 30 })
  for (const bad of [-1, NaN, Infinity]) expect(matGeometry(40, 30, 2, [uniformBorders(bad)], [true]).issue).toBeTruthy()
})
it('converts valid Stage B absolute values without changing physical geometry', () => {
  const saved = { geometryVersion: 2, borders: [uniformBorders(5), uniformBorders(7), uniformBorders(8)] }
  const original = structuredClone(saved)
  const restored = restoreMatBorders(saved, [true, true, true])
  expect(restored.issue).toBeNull()
  expect(restored.borders.map(b => b.top)).toEqual([5, 2, 1])
  expect(matGeometry(40, 30, 2, restored.borders, [true, true, true]).internal).toEqual({ width: 56, height: 46 })
  expect(saved).toEqual(original)
})
it('restores Stage B inactive placeholders from independent legacy settings rather than zero reveals', () => {
  const restored = restoreMatBorders({ geometryVersion: 2, mat1BorderCm: 5, mat2BorderCm: 2, mat3BorderCm: 1,
    borders: [uniformBorders(5), uniformBorders(5), uniformBorders(5)] }, [true, false, false])
  expect(restored.issue).toBeNull()
  expect(restored.borders.map(b => b.left)).toEqual([5, 2, 1])
})
it('retains meaningful inactive Stage B side settings instead of replacing them with scalar defaults', () => {
  const restored = restoreMatBorders({ geometryVersion: 2, borders: [uniformBorders(5), { top: 7, bottom: 8, left: 9, right: 10 }, uniformBorders(5)] }, [true, false, false])
  expect(restored.issue).toBeNull()
  expect(restored.borders[1]).toEqual({ top: 2, bottom: 3, left: 4, right: 5 })
  expect(matGeometry(40, 30, 2, restored.borders, [true, true, false]).internal).toEqual({ width: 59, height: 45 })
})
it('converts across enabled slots and retains explicit historical zero reveals', () => {
  const restored = restoreMatBorders({ geometryVersion: 2, borders: [uniformBorders(0), uniformBorders(2), uniformBorders(3)] }, [false, true, true])
  expect(restored.borders.map(b => b.left)).toEqual([5, 2, 1])
  expect(restoreMatBorders({ geometryVersion: 2, borders: [uniformBorders(5), uniformBorders(5), uniformBorders(5)] }, [true, true, true]).borders.map(b => b.left)).toEqual([5, 0, 0])
})
it('loads new incremental and old scalar values without accumulating them twice', () => {
  const b = [uniformBorders(5), uniformBorders(2), uniformBorders(1)]
  expect(restoreMatBorders({ geometryVersion: 3, borders: b }, [true, true, true])).toEqual({ borders: b, issue: null })
  expect(restoreMatBorders({ mat1BorderCm: 5, mat2BorderCm: 2, mat3BorderCm: 1 }, [true, true, true])).toEqual({ borders: b, issue: null })
})
it('flags crossing, partial, unversioned or unknown historical geometry without guessing', () => {
  for (const saved of [
    { geometryVersion: 2, borders: [uniformBorders(5), uniformBorders(3)] },
    { geometryVersion: 2, borders: [uniformBorders(5), { left: 7 }] },
    { borders: [uniformBorders(5), uniformBorders(7)] },
    { geometryVersion: 99, borders: [uniformBorders(5), uniformBorders(7)] },
    { geometryVersion: 3, borders: [uniformBorders(5)] },
    { geometryVersion: 3, borders: [uniformBorders(5), uniformBorders(2), uniformBorders(1)], mat2: { borders: uniformBorders(7) } },
    { mat1BorderCm: -1 },
  ]) expect(restoreMatBorders(saved, [true, true, false]).issue).toMatch(/review/i)
})
