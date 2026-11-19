import { expect, it } from 'vitest'
import { restoreMatBorders, uniformBorders } from '@/lib/matGeometry'
it('keeps coincident historical physical geometry but requires review rather than accepting lost reveals', () => {
  const restored = restoreMatBorders({ geometryVersion: 2, borders: [5, 5, 5].map(uniformBorders) }, [true, true, true])
  expect(restored.borders.map(b => b.left)).toEqual([5, 0, 0])
  expect(restored.issue).toMatch(/review/i)
})
it('rejects contradictory historical absolute aliases', () => {
  expect(restoreMatBorders({ geometryVersion: 2, borders: [5, 7, 8].map(uniformBorders), mat2: { borders: uniformBorders(9) } }, [true, true, true]).issue).toMatch(/review/i)
})
