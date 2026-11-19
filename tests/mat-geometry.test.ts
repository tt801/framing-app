import { expect, it } from 'vitest'
import { matGeometry, normalizeMatBorders, restoreMatBorders } from '@/lib/matGeometry'

it('converts incremental legacy layers into physical aperture distances', () => {
  const borders = normalizeMatBorders([5, 2, 1], [true, true, true])
  expect(borders.map(b => b.left)).toEqual([5, 2, 1])
  const g = matGeometry(40, 30, 2, borders, [true, true, true])
  expect(g.internal).toEqual({ width: 56, height: 46 })
  expect(g.external).toEqual({ width: 60, height: 50 })
  expect(g.layers.map(l => l.aperture.x)).toEqual([5, 7, 8])
})
it('does not double-count four-sided physical distances across three mats', () => {
  const b = [{ top: 2, bottom: 4, left: 3, right: 5 }, { top: 3, bottom: 6, left: 4, right: 7 }, { top: 5, bottom: 8, left: 6, right: 9 }]
  const restored = restoreMatBorders({ geometryVersion: 2, borders: b }, [true, true, true])
  const g = matGeometry(40, 30, 2, restored.borders, [true, true, true])
  expect(g.internal).toEqual({ width: 55, height: 43 })
  expect(g.external).toEqual({ width: 59, height: 47 })
  expect(g.layers.map(l => l.aperture.width)).toEqual([47, 44, 40])
  expect(g.issue).toBeNull()
})
it('ignores disabled slots when converting scalar bands', () => {
  expect(normalizeMatBorders([5, 2, 1], [false, true, true]).map(b => b.top)).toEqual([5, 2, 1])
})
it('identifies crossing apertures without silently correcting the values', () => {
  const b = [{ top: 5, bottom: 5, left: 5, right: 5 }, { top: 3, bottom: 6, left: 6, right: 6 }]
  const restored = restoreMatBorders({ geometryVersion: 2, borders: b }, [true, true, false])
  expect(restored.issue).toMatch(/review/)
  expect(b[1].top).toBe(3)
})
it('supports explicitly zero four-sided borders', () => {
  const b = normalizeMatBorders([5], [true], [{ top: 0, bottom: 0, left: 0, right: 0 }])
  expect(matGeometry(40, 30, 2, b, [true]).internal).toEqual({ width: 40, height: 30 })
})
