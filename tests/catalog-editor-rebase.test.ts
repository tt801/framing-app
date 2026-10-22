import { expect, it } from 'vitest'
import { rebaseCatalogEdits } from '@/lib/catalogEditor'
import type { Catalog } from '@/lib/store'
const base = () => ({ frames: [{ id: 'f', name: 'Oak', pricePerMeter: 10, faceWidthCm: 2, supplierMetadata: { retained: true } }],
  mats: [], glazing: [], printingMaterials: [], backers: [], settings: {}, stock: { frames: [], sheets: [], rolls: [] },
}) as unknown as Catalog

it('rebases only changed fields and preserves unrelated products, stock, settings and metadata without mutation', () => {
  const original = base(), draft = structuredClone(original), remote = structuredClone(original)
  draft.frames[0].name = 'Local name'
  remote.frames[0].pricePerMeter = 25
  remote.frames.push({ id: 'remote', name: 'Remote product', pricePerMeter: 2, faceWidthCm: 1 })
  remote.settings.labourBase = 250
  remote.stock.frames.push({ profileId: 'f', metersAvailable: 20, minThreshold: 1 })
  const snapshot = structuredClone(remote)
  const result = rebaseCatalogEdits(original, draft, remote)
  expect(result.frames[0]).toMatchObject({ name: 'Local name', pricePerMeter: 25, supplierMetadata: { retained: true } })
  expect(result.frames[1].id).toBe('remote')
  expect(result.settings.labourBase).toBe(250)
  expect(result.stock).toEqual(remote.stock)
  expect(remote).toEqual(snapshot)
})
it('preserves local additions/deletions without deleting remotely added products', () => {
  const original = base(), draft = base(), remote = base()
  draft.frames = [{ id: 'local', name: 'New', pricePerMeter: 2, faceWidthCm: 1 }]
  remote.frames.push({ id: 'remote', name: 'Other', pricePerMeter: 4, faceWidthCm: 1 })
  expect(rebaseCatalogEdits(original, draft, remote).frames.map(row => row.id)).toEqual(['remote', 'local'])
})
it.each(['same field', 'remote removal', 'local removal', 'id collision'])('blocks an unresolved %s conflict', mode => {
  const original = base(), draft = base(), remote = base()
  draft.frames[0].name = 'Local'
  if (mode === 'same field') remote.frames[0].name = 'Remote'
  if (mode === 'remote removal') remote.frames = []
  if (mode === 'local removal') { draft.frames = []; remote.frames[0].name = 'Remote' }
  if (mode === 'id collision') { original.frames = []; remote.frames[0].name = 'Remote' }
  expect(() => rebaseCatalogEdits(original, draft, remote)).toThrow('changed elsewhere')
})
it('accepts an already committed identical edit after a lost acknowledgement', () => {
  const original = base(), draft = base()
  draft.frames[0].name = 'Local'
  expect(rebaseCatalogEdits(original, draft, structuredClone(draft))).toEqual(draft)
})
it('retains historical rows without IDs, but refuses ambiguous concurrent list changes', () => {
  const original = base(); delete (original.frames[0] as Partial<Catalog['frames'][number]>).id
  const draft = structuredClone(original); draft.frames[0].name = 'Local'
  expect(rebaseCatalogEdits(original, draft, original).frames[0].name).toBe('Local')
  const remote = structuredClone(original); remote.frames[0].pricePerMeter = 25
  expect(() => rebaseCatalogEdits(original, draft, remote)).toThrow('changed elsewhere')
})

it('preserves historical duplicate IDs rather than silently collapsing rows', () => {
  const original = base()
  original.frames.push({ ...original.frames[0], name: 'Duplicate ID row' })
  const draft = structuredClone(original); draft.frames[0].name = 'Local'
  expect(rebaseCatalogEdits(original, draft, original).frames.map((row: { name: string }) => row.name)).toEqual(['Local', 'Duplicate ID row'])
  const remote = structuredClone(original); remote.frames[1].pricePerMeter = 50
  expect(() => rebaseCatalogEdits(original, draft, remote)).toThrow('changed elsewhere')
})
