import { expect, it } from 'vitest'
import { visualizerScene, layoutDimensionForExternal } from '@/lib/visualizerScene'
import { uniformBorders } from '@/lib/matGeometry'
const input = { mode: 'pro' as const, layoutModel: 'shared-group-v1' as const, width: 40, height: 30, face: 2,
  borders: [5, 2, 1].map(uniformBorders), active: [true, true, true], origin: { x: 8, y: 8 },
  openings: [{ id: 'a', shape: 'rect' as const, xCm: 8, yCm: 8, widthCm: 10, heightCm: 10, imageUrl: 'data:a' },
    { id: 'b', shape: 'oval' as const, xCm: 28, yCm: 8, widthCm: 12, heightCm: 15, imageUrl: 'data:b' }] }
it.each(Array.from({ length: 8 }, (_, n) => ({ active: [0, 1, 2].map(i => !!(n & (1 << i))) })))('uses only enabled contributions and never covers artwork ($active)', ({ active }) => {
  const g = visualizerScene({ ...input, active })
  const sum = [5, 2, 1].reduce((n, v, i) => n + (active[i] ? v : 0), 0)
  expect(g.internal).toEqual({ width: 40 + sum * 2, height: 30 + sum * 2 })
  expect(g.layers).toHaveLength(active.filter(Boolean).length)
  for (const layer of g.layers.slice(1)) for (const o of g.openings) {
    const hole = layer.cutouts[0]
    expect(hole.xCm).toBeLessThanOrEqual(o.xCm); expect(hole.yCm).toBeLessThanOrEqual(o.yCm)
    expect(hole.xCm + hole.widthCm).toBeGreaterThanOrEqual(o.xCm + o.widthCm)
    expect(hole.yCm + hole.heightCm).toBeGreaterThanOrEqual(o.yCm + o.heightCm)
  }
})
it('inverts external dimensions using group bounds, rejecting frames that would clip an opening', () => {
  const expanded = { ...input, openings: [{ ...input.openings[0], xCm: -10 }, { ...input.openings[1], xCm: 75 }] }
  const scene = visualizerScene(expanded)
  const width = layoutDimensionForExternal(scene, 'width', 120)
  expect(visualizerScene({ ...expanded, width }).external.width).toBe(120)
  expect(() => layoutDimensionForExternal(scene, 'width', 20)).toThrow(/opening/)
})
it('uses individual primary apertures and one shared rectangular cut-out per decorative layer', () => {
  const scene = visualizerScene(input)
  expect(scene.internal).toEqual({ width: 56, height: 46 })
  expect(scene.layers.map(l => l.slot)).toEqual([0, 1, 2])
  expect(scene.layers.map(l => l.cutouts.length)).toEqual([2, 1, 1])
  expect(scene.layers[1].cutouts[0]).toMatchObject({ shape: 'rect', xCm: 3, yCm: 3, widthCm: 50, heightCm: 40 })
  expect(scene.layers[2].cutouts[0]).toMatchObject({ xCm: 1, yCm: 1, widthCm: 54, heightCm: 44 })
  expect(scene.openings[0]).toMatchObject({ xCm: 8, yCm: 8, imageUrl: 'data:a' })
})
it('grows on every edge to contain moving openings without mutating saved coordinates', () => {
  const data = structuredClone(input); data.openings[0].xCm = -20; data.openings[1].widthCm = 80
  const original = structuredClone(data)
  const scene = visualizerScene(data)
  expect(scene.layoutOrigin.x).toBe(-20)
  expect(scene.internal.width).toBe(144)
  expect(scene.openings.every(o => o.xCm >= scene.total.left)).toBe(true)
  expect(scene.layers[1].cutouts[0].widthCm).toBe(138)
  expect(data).toEqual(original)
})
it('uses the same cumulative asymmetric dimensions in Basic and Pro', () => {
  const borders = [{ top: 2, bottom: 4, left: 3, right: 5 }, uniformBorders(2), uniformBorders(1)]
  const basic = visualizerScene({ ...input, mode: 'basic', borders })
  const pro = visualizerScene({ ...input, borders })
  expect(basic.internal).toEqual(pro.internal)
  expect(basic.openings).toHaveLength(1)
  expect(basic.openings[0].shape).toBe('rect')
})
it('preserves the legacy individual-cutout rendering contract until explicit adoption', () => {
  const scene = visualizerScene({ ...input, layoutModel: 'legacy-individual-v1' })
  expect(scene.layers.map(l => l.slot)).toEqual([2, 1, 0])
  expect(scene.layers.map(l => l.cutouts.length)).toEqual([2, 2, 2])
})
it('reports invalid opening dimensions instead of allowing pricing an invalid scene', () => {
  expect(visualizerScene({ ...input, openings: [{ ...input.openings[0], widthCm: NaN }] }).issue).toMatch(/opening/i)
})
