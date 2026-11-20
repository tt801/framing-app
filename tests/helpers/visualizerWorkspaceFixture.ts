// Synthetic independent-workspace fixtures, not a legacy migration adapter.
import { createMatSlots } from '../../src/lib/visualizerMats'
import { restoreMatBorders } from '../../src/lib/matGeometry'
import { type VisualizerDesign } from '../../src/lib/visualizerScene'
type Data = Record<string, unknown>
const record = (value: unknown): Data => value !== null && typeof value === 'object' ? value as Data : {}
export function independentFixture(state: Data): Data {
  const art = record(state.art), m = record(state.mats)
  const ids = [1, 2, 3].map(i => String(m[`selectedMat${i}`] ?? 'mat0'))
  const borders = restoreMatBorders(m, ids.map(id => id !== 'mat0')).borders
  const slots = createMatSlots(ids).map((slot, i) => ({ ...slot, borders: borders[i], locked: Array.isArray(m.locks) ? !!m.locks[i] : false }))
  const mode = m.mode === 'pro' ? 'pro' : 'basic', empty = createMatSlots()
  const active = mode === 'basic' ? slots : [slots[0], ...empty.slice(1)]
  const widthCm = Number(art.widthCm) || 40, heightCm = Number(art.heightCm) || 30
  const imageUrl = String(art.imageUrl ?? '')
  const pro = { origin: (m.proOrigin ?? { x: 5, y: 5 }) as VisualizerDesign['pro']['origin'], openings: (m.openings ?? []) as VisualizerDesign['pro']['openings'],
    mat: mode === 'pro' ? slots[0] : empty[0], layout: { widthCm, heightCm } }
  return { ...state, art: { widthCm, heightCm, imageUrl: mode === 'basic' ? imageUrl : '' },
    visualizerDesign: { version: 2, mode, layoutModel: 'single-board-v1', basic: { widthCm, heightCm, imageUrl, mats: slots }, pro, mats: active },
    mats: { geometryVersion: 3, layoutModel: 'single-board-v1', mode, proOrigin: pro.origin, openings: pro.openings,
      borders: active.map(s => s.borders), locks: active.map(s => s.locked), ...Object.fromEntries(active.map((s, i) => [`selectedMat${i + 1}`, s.materialId])) } }
}
