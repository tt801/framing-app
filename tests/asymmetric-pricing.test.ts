import { expect, it } from 'vitest'
import { priceVisualiser } from '@/lib/pricing'
const input = { artWcm: 40, artHcm: 30, borderCm: 0, mats: [{ name: 'Mat', pricePerSqM: 5 }], frame: { name: 'Frame', pricePerMeter: 10 }, glazing: { name: 'Glass', pricePerSqM: 8 }, print: { name: 'Print', pricePerSqM: 20 }, backer: { name: 'Backer', pricePerSqM: 80 }, labourBase: 10, marginMultiplier: 1.25, taxRatePct: 20, currencyCode: 'GBP' }
it('uses asymmetric board dimensions for perimeter and board areas but not printing', () => {
  const snapshot = priceVisualiser({ ...input, geometry: { internalWidthCm: 54, internalHeightCm: 42 } })
  expect(snapshot.items.find(i => i.key === 'frame')!.qty).toBeCloseTo(1.92)
  expect(snapshot.items.find(i => i.key === 'backer')!.qty).toBeCloseTo(0.2268)
  expect(snapshot.items.find(i => i.key === 'print')!.qty).toBeCloseTo(0.12)
  expect(snapshot.items.reduce((s, l) => s + l.lineTotal, 0)).toBeCloseTo(snapshot.subtotal)
  expect(snapshot.subtotal + snapshot.tax).toBeCloseTo(snapshot.total)
})
it.each([NaN, Infinity, -1, 0])('rejects invalid explicit board dimension %s', value => {
  expect(() => priceVisualiser({ ...input, geometry: { internalWidthCm: value, internalHeightCm: 42 } })).toThrow()
})
it('keeps the scalar compatibility calculation byte-identical to equivalent physical geometry', () => {
  expect(priceVisualiser({ ...input, borderCm: 5 })).toEqual(priceVisualiser({ ...input, geometry: { internalWidthCm: 50, internalHeightCm: 40 } }))
})
