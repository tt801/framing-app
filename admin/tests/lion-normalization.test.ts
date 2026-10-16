import { expect, it } from 'vitest'
import { normalizeLionCatalogue } from '../server/platform/supplierFeeds/lionNormalization.js'
import { parseLionCsv } from '../server/platform/supplierFeeds/lionCatalogue.js'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'
import type { CanonicalProduct } from '../server/platform/supplierFeeds/contracts.js'
import { lionAcquisition, lionArtifact, lionFixture, lionIdentity } from './helpers/lionFixture.js'

it('normalizes only identity/name/scope, withholding prices, unqualified dimensions and images', () => {
  const out = normalizeLionCatalogue(lionArtifact(), lionIdentity)
  expect(out.context).toMatchObject({ mode: 'dry_run', authoritative: false, validationSafeForMissing: false, missingInferenceEnabled: false })
  expect(out.candidates).toHaveLength(11)
  for (const c of out.candidates) {
    expect(c.cost).toBeUndefined(); expect(c.asset).toBeUndefined()
    expect(c.fields).not.toHaveProperty('widthMm'); expect(c.fields).not.toHaveProperty('rebateWidthMm')
    expect(c.fields).not.toHaveProperty('material'); expect(c.fields).not.toHaveProperty('colour')
    expect(c.fields.supplierSku).toBe(c.sourceProductKey)
  }
  expect(out.sourceEvidenceByRow.get(6)).toMatchObject({ rawProduct: { sku: 'L001', stockRaw: '-1079.40' }, costQualified: false, dimensionsQualified: false })
})

it('routes scope/membership, phase-out and unqualified unit evidence to mandatory review', () => {
  const out = normalizeLionCatalogue(lionArtifact(), lionIdentity)
  const plan = planFeed({ context: out.context, rows: out.planningRows, existingProducts: [], aliases: [], massChangePolicy: {} })
  expect(plan.counts).toMatchObject({ review: 11, create: 0, cost_changes: 0, potential_missing: 0 })
  expect(plan.entries.find(e => e.sourceProductKey === '9777LT')?.warnings.map(w => w.code)).toContain('lion_membership_review')
  expect(plan.entries.find(e => e.sourceProductKey === 'L3091')?.warnings.map(w => w.code)).toContain('lion_phase_out_review')
  expect(plan.entries.find(e => e.sourceProductKey === 'L954')?.warnings.map(w => w.code)).toContain('lion_scope_review')
})

it('preserves existing lifecycle/availability and costs and emits no missing entries for absent products', () => {
  const out = normalizeLionCatalogue(lionArtifact(), lionIdentity), c = out.candidates.find(c => c.sourceProductKey === 'L001')!
  const cost = { amount: '99', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive' as const, effectiveAt: '2026-01-01T00:00:00Z' }
  const p: CanonicalProduct = { id: 'existing', supplierId: 'supplier', ownerSourceId: 'source', ownerScopeId: lionIdentity.scopeId,
    sourceProductKey: 'L001', updatedAt: '2026-01-01T00:00:00Z', fields: { ...c.fields, lifecycle: 'discontinued', availability: 'unavailable' }, cost }
  const before = JSON.stringify(p)
  const plan = planFeed({ context: out.context, rows: out.planningRows, existingProducts: [p, { ...p, id: 'absent', sourceProductKey: 'ABSENT' }], aliases: [], massChangePolicy: {} })
  expect(plan.missingInferenceEligible).toBe(false)
  expect(plan.counts).toMatchObject({ cost_changes: 0, potential_missing: 0, update: 0 })
  expect(plan.entries.find(e => e.productId === p.id)).toMatchObject({ action: 'review', lifecycleChanges: [], ordinaryChanges: [], costChange: false })
  expect(JSON.stringify(p)).toBe(before)
})

it.each(['L3802X', 'CL001', '10450', 'CHL001', '10460L'])('holds ambiguous/discontinued exact code %s without collapsing it', sku => {
  const body = Buffer.from(lionFixture.toString().replace('L012,', `${sku},`))
  const out = normalizeLionCatalogue(parseLionCsv(body, lionAcquisition(body)), lionIdentity)
  expect(out.candidates.some(c => c.sourceProductKey === sku)).toBe(true)
  expect(out.planningRows.find(r => r.item.key === sku)?.policy?.reviewReason).toBeDefined()
})

it('rejects unverified row/adapter/scope mutation before normalization', () => {
  const artifact = lionArtifact(); artifact.rows[0].priceRaw = '0.00'
  expect(() => normalizeLionCatalogue(artifact, lionIdentity)).toThrow()
  expect(() => normalizeLionCatalogue(lionArtifact(), { ...lionIdentity, scopeId: 'other' })).toThrow()
})
