import { expect, it } from 'vitest'
import { assembleLarsonCatalogue, parseLarsonCataloguePage, LARSON_SCOPE } from '../server/platform/supplierFeeds/larsonJuhlCatalogue.js'
import { normalizeLarsonCatalogue } from '../server/platform/supplierFeeds/larsonJuhlNormalization.js'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'
import type { CanonicalProduct } from '../server/platform/supplierFeeds/contracts.js'
import { larsonFixture, larsonAcquisition } from './helpers/larsonFixture.js'

const identity = { supplierId: 'supplier', sourceId: 'source', scopeId: LARSON_SCOPE, runId: 'actual-run' }
const raw = () => assembleLarsonCatalogue([parseLarsonCataloguePage(larsonFixture, larsonAcquisition(larsonFixture))])
const normalized = () => normalizeLarsonCatalogue(raw(), identity)

it('normalizes exact identity, names and private image references without guessing unlabeled fields', () => {
  const out = normalized()
  expect(out.context).toMatchObject({ ...identity, mode: 'dry_run', authoritative: false, validationSafeForMissing: false,
    missingInferenceEnabled: false, acquisitionComplete: true, parsingComplete: true })
  const candidate = out.candidates.find(c => c.sourceProductKey === '0475WG')!
  expect(candidate).toMatchObject({ sourceProductKey: '0475WG', sourceProductKeyOrigin: 'supplier_provided',
    fields: { supplierSku: '0475WG', supplierDescription: 'LJE Moulding', category: 'frame', catalogScope: LARSON_SCOPE, availability: 'unknown' },
    asset: { rightsStatus: 'unknown', sourceUrl: 'https://larsonjuhl.co.uk/product/image/medium/0475wg_1.jpg' } })
  expect(out.candidates.map(c => c.fields.supplierSku)).toContain('185127000E')
  for (const c of out.candidates) {
    expect(c).not.toHaveProperty('cost')
    for (const field of ['colour', 'finish', 'material', 'collectionName', 'widthMm', 'depthMm', 'rebateWidthMm', 'rebateDepthMm', 'purchaseUnit'])
      expect(c.fields).not.toHaveProperty(field)
  }
  expect(out.provenance.rawRows).toHaveLength(6)
})

it('represents explicit samples as other/sample and routes unknown stock types and discontinued overlaps to review', () => {
  const out = normalized()
  const plan = planFeed({ context: out.context, rows: out.planningRows, existingProducts: [], aliases: [], massChangePolicy: {} })
  expect(plan.entries.find(e => e.sourceProductKey === '999002196')).toMatchObject({ action: 'create',
    candidate: { fields: { category: 'other', subcategory: 'sample' } } })
  expect(plan.entries.find(e => e.sourceProductKey === '20380')).toMatchObject({ action: 'review', warnings: expect.arrayContaining([expect.objectContaining({ code: 'larson_category_review' })]) })
  expect(plan.entries.find(e => e.sourceProductKey === '991247116')).toMatchObject({ action: 'review', warnings: expect.arrayContaining([expect.objectContaining({ code: 'larson_lifecycle_review' })]) })
  expect(plan.counts).toMatchObject({ create: 4, review: 2, cost_changes: 0, potential_missing: 0 })
})

it('never reactivates existing products, changes availability/cost or infers disappearance', () => {
  const out = normalized(), c = out.candidates.find(c => c.sourceProductKey === '0475WG')!
  const existing: CanonicalProduct = { id: 'existing', supplierId: identity.supplierId, ownerSourceId: identity.sourceId,
    ownerScopeId: identity.scopeId, sourceProductKey: c.sourceProductKey, updatedAt: '2026-10-16T00:00:00Z', productRevision: '1',
    fields: { ...c.fields, lifecycle: 'discontinued', availability: 'unavailable' },
    cost: { amount: '99', currency: 'EUR', unit: 'pack', taxBasis: 'inclusive', effectiveAt: '2026-01-01T00:00:00Z' } }
  const before = JSON.stringify(existing)
  const plan = planFeed({ context: out.context, rows: out.planningRows, existingProducts: [existing, { ...existing, id: 'absent', sourceProductKey: 'ABSENT' }], aliases: [], massChangePolicy: {} })
  expect(plan.entries.find(e => e.sourceProductKey === c.sourceProductKey)).toMatchObject({ action: 'review', lifecycleChanges: [], costChange: false })
  expect(plan.entries.some(e => e.productId === 'absent')).toBe(false)
  expect(plan.counts.cost_changes).toBe(0)
  expect(plan.missingInferenceEligible).toBe(false)
  expect(JSON.stringify(existing)).toBe(before)
})

it('rejects the wrong catalogue scope instead of silently widening source ownership', () => {
  expect(() => normalizeLarsonCatalogue(raw(), { ...identity, scopeId: 'mouldings' })).toThrow()
})

it('retains a no-image placeholder as source evidence, not a product image asset', () => {
  const bytes = Buffer.from(larsonFixture.toString().replaceAll('/product/image/medium/0475wg_1.jpg', '/content/files/icons/no-image-medium.png'))
  const artifact = assembleLarsonCatalogue([parseLarsonCataloguePage(bytes, larsonAcquisition(bytes))])
  const out = normalizeLarsonCatalogue(artifact, identity)
  expect(out.candidates[0]).not.toHaveProperty('asset')
  expect(out.provenance.rawRows[0].image).toContain('no-image-medium.png')
})

it('rejects an altered or incomplete catalogue envelope before asserting normalization completeness', () => {
  const incomplete = raw()
  incomplete.rows.pop()
  expect(() => normalizeLarsonCatalogue(incomplete, identity)).toThrow()
  const altered = raw()
  altered.rows[0].name = 'tampered'
  expect(() => normalizeLarsonCatalogue(altered, identity)).toThrow()
})

it('does not promote dimensions from names, raw attributes or an unbound detail specification elsewhere in the page', () => {
  const bytes = Buffer.from(larsonFixture.toString().replace('</body>', '<table id="specifications"><tr><td>Item Width (mm)</td><td>99</td></tr></table></body>'))
  const out = normalizeLarsonCatalogue(assembleLarsonCatalogue([parseLarsonCataloguePage(bytes, larsonAcquisition(bytes))]), identity)
  expect(out.candidates.every(c => c.fields.widthMm === undefined && c.fields.depthMm === undefined)).toBe(true)
  expect(out.provenance.rawRows.find(r => r.sku === '20380')?.name).toContain('23X14')
})
