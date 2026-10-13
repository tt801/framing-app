import { describe, expect, it } from 'vitest'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'
import { validateCandidate } from '../server/platform/supplierFeeds/validation.js'
import { mapReviewRow } from '../server/platform/supplierFeeds/operations.js'
import { planEntryToStagedRow } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import { evidenceValue } from '../server/platform/supplierFeeds/reviewEvidence.js'
import type { Candidate, CanonicalProduct, FeedContext } from '../server/platform/supplierFeeds/contracts.js'

const context: FeedContext = { supplierId: 's', runId: 'r', sourceId: 'feed', scopeId: 'uat', adapter: { id: 'uat-json', version: '1' }, mode: 'apply_requested', coverage: 'delta', authoritative: false, acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: true, missingInferenceEnabled: false }
const candidate: Candidate = { supplierId: 's', runId: 'r', sourceId: 'feed', scopeId: 'uat', adapter: context.adapter, item: { key: 'UAT-1' }, sourceProductKey: 'UAT-1', sourceProductKeyOrigin: 'supplier_provided', fields: { category: 'frame', supplierDescription: 'Frame', lifecycle: 'active', availability: 'unknown' }, cost: { amount: '10.01', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-13T15:00:00Z' } }
const existing: CanonicalProduct = { id: 'p', supplierId: 's', sourceProductKey: 'UAT-1', ownerSourceId: 'feed', ownerScopeId: 'uat', productRevision: '1', updatedAt: '2026-10-13T14:00:00Z', fields: candidate.fields, cost: { ...candidate.cost!, amount: '10.00', effectiveAt: '2026-10-13T14:00:00Z' } }
const plan = (input = candidate, product = existing) => planFeed({ context, rows: [{ item: input.item, result: validateCandidate(input) }], existingProducts: [product], aliases: [], massChangePolicy: {} })

describe('frozen approval evidence planning', () => {
  it('captures deterministic ordinary, lifecycle, nullable and structured asset changes', () => {
    const product = { ...existing, fields: { ...existing.fields, widthMm: 20, colour: null, finish: 'matte' }, asset: { rightsStatus: 'permitted' as const, permittedUses: ['catalog'] } }
    const input = { ...candidate, fields: { ...candidate.fields, supplierDescription: 'New frame', widthMm: 21, colour: 'black', finish: null, availability: 'available' as const }, asset: { rightsStatus: 'permitted' as const, permittedUses: ['catalog', 'web'] } }
    const first = plan(input, product)
    expect(plan(input, product)).toEqual(first)
    const evidence = first.entries[0].reviewEvidence!
    expect(evidence.fields).toEqual(expect.arrayContaining([
      { field: 'fields.supplierDescription', oldValue: evidenceValue('Frame'), newValue: evidenceValue('New frame') },
      { field: 'fields.widthMm', oldValue: evidenceValue(20), newValue: evidenceValue(21) },
      { field: 'fields.colour', oldValue: evidenceValue(null), newValue: evidenceValue('black') },
      { field: 'fields.finish', oldValue: evidenceValue('matte'), newValue: evidenceValue(null) },
      { field: 'fields.availability', oldValue: evidenceValue('unknown'), newValue: evidenceValue('available') },
      { field: 'asset.permittedUses', oldValue: evidenceValue(['catalog']), newValue: evidenceValue(['catalog', 'web']) },
    ]))
    expect(evidence.fields.some(f => f.field === 'fields.category' || f.field === 'asset.rightsStatus')).toBe(false)
    const mapped = mapReviewRow(planEntryToStagedRow(first.entries[0]))
    expect(mapped.changedFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'fields.widthMm', oldValue: '20', newValue: '21' }),
      expect.objectContaining({ field: 'fields.colour', oldValue: 'null', newValue: 'black' }),
      expect.objectContaining({ field: 'fields.finish', oldValue: 'matte', newValue: 'null' }),
    ]))
  })
  it('supports boolean/null scalars and canonicalizes bounded structured values', () => {
    expect(evidenceValue(false)).toEqual({ state: 'recorded', value: false })
    expect(evidenceValue(true)).toEqual({ state: 'recorded', value: true })
    expect(evidenceValue(null)).toEqual({ state: 'recorded', value: null })
    expect(evidenceValue(undefined)).toEqual({ state: 'missing' })
    expect(evidenceValue({ b: 2, a: true })).toEqual(evidenceValue({ a: true, b: 2 }))
    const row = mapReviewRow({ proposed_action: 'update', proposed_diff: { reviewEvidence: { version: 1, fields: [
      { field: 'fields.availability', oldValue: evidenceValue(false), newValue: evidenceValue(true) },
    ] } } })
    expect(row.changedFields[0]).toMatchObject({ oldValue: 'false', newValue: 'true' })
  })
  it('keeps every supported change visible, including cost after many ordinary changes', () => {
    const input = { ...candidate, fields: { ...candidate.fields, category: 'other' as const, supplierDescription: 'New frame',
      supplierSku: 'SKU', catalogScope: 'new', variantKey: 'variant', subcategory: 'subcategory', displayDescription: 'Display',
      collectionName: 'Collection', colour: 'Black', finish: 'Matte', material: 'Wood', purchaseUnit: 'length',
      widthMm: 1, depthMm: 2, rebateWidthMm: 3, rebateDepthMm: 4, sheetWidthMm: 5, sheetHeightMm: 6,
      matThicknessMm: 7, glazingThicknessMm: 8, glazingUvPercent: 9, lifecycle: 'discontinued' as const, availability: 'unavailable' as const },
      asset: { rightsStatus: 'permitted' as const, sourceUrl: 'https://supplier.com/image', attribution: 'Supplier', permittedUses: ['catalog'], sourceUpdatedAt: '2026-10-13T15:00:00Z' } }
    const entry = plan(input).entries[0]
    expect(entry.reviewEvidence?.fields).toHaveLength(29)
    const fields = mapReviewRow(planEntryToStagedRow(entry)).changedFields
    expect(fields).toHaveLength(30)
    expect(fields).toContainEqual(expect.objectContaining({ field: 'cost', newValue: '10.01 GBP/metre' }))
    expect(fields).toContainEqual(expect.objectContaining({ field: 'asset.sourceUpdatedAt', newValue: '2026-10-13T15:00:00.000Z' }))
  })
  it('withholds oversized, sensitive, deeply nested and private asset evidence without partial dumps', () => {
    for (const value of ['x'.repeat(513), Infinity, Array(21).fill('x'), { secret: 'hidden' }, { a: { b: { c: {} } } }]) expect(evidenceValue(value)).toEqual({ state: 'withheld' })
    const input = { ...candidate, fields: { ...candidate.fields, supplierDescription: 'x'.repeat(1000) }, asset: { rightsStatus: 'unknown' as const, sourceUrl: 'https://supplier.com/private-image' } }
    const entry = plan(input).entries[0]
    expect(entry.reviewEvidence?.fields.find(f => f.field === 'fields.supplierDescription')?.newValue).toEqual({ state: 'withheld' })
    expect(JSON.stringify(entry.reviewEvidence)).not.toContain('private-image')
    const mapped = mapReviewRow(planEntryToStagedRow(entry))
    expect(mapped.changedFields.every(f => f.oldValue.length <= 512 && f.newValue.length <= 512)).toBe(true)
    expect(JSON.stringify(mapped)).not.toContain('private-image')
  })
  it('does not display unchanged fields even if a persisted entry redundantly includes them', () => {
    expect(mapReviewRow({ proposed_action: 'update', proposed_diff: { reviewEvidence: { version: 1, fields: [
      { field: 'fields.widthMm', oldValue: evidenceValue(20), newValue: evidenceValue(20) },
    ] } } }).changedFields).toEqual([])
  })
  it('preserves effective-date-only cost semantics without displaying a monetary increase', () => {
    const input = { ...candidate, cost: { ...candidate.cost!, amount: '10.00' } }
    const result = plan(input)
    expect(result.counts.cost_changes).toBe(1)
    const mapped = mapReviewRow(planEntryToStagedRow(result.entries[0]))
    expect(mapped.changedFields.map(f => f.field)).toEqual(['cost.effectiveAt'])
  })
  it('uses persisted currencies/units and shows tax-basis changes separately', () => {
    const input = { ...candidate, cost: { ...candidate.cost!, currency: 'JPY', unit: 'sheet', amount: '11', taxBasis: 'inclusive' as const } }
    const fields = mapReviewRow(planEntryToStagedRow(plan(input).entries[0])).changedFields
    expect(fields).toContainEqual(expect.objectContaining({ field: 'cost', oldValue: '10.00 GBP/metre', newValue: '11 JPY/sheet' }))
    expect(fields).toContainEqual(expect.objectContaining({ field: 'cost.taxBasis', oldValue: 'exclusive', newValue: 'inclusive' }))
  })
  it('changes action integrity when old evidence changes, even with the same target revision', () => {
    expect(plan(candidate, { ...existing, cost: { ...existing.cost!, amount: '9' } }).entries[0].actionId).not.toBe(plan().entries[0].actionId)
    const result = plan()
    const oldValue = result.entries[0].reviewEvidence!.fields[0].oldValue
    existing.cost!.amount = '999'
    expect(oldValue).toMatchObject({ state: 'recorded', value: { amount: '10' } })
    existing.cost!.amount = '10.00'
  })
  it('keeps legacy Create and missing update evidence readable without canonical substitution', () => {
    expect(mapReviewRow({ proposed_action: 'create', proposed_product: { cost: candidate.cost }, proposed_diff: {} }).changedFields).toEqual([])
    const legacy = mapReviewRow({ proposed_action: 'update', proposed_product: { cost: candidate.cost }, proposed_diff: { costChange: true }, currentCanonical: existing })
    expect(legacy.changedFields[0]).toMatchObject({ field: 'cost', oldValue: 'Not persisted in this frozen plan', newValue: '10.01 GBP/metre', previousPersisted: false })
    expect(legacy.changedFields[1]).toMatchObject({ field: 'cost.effectiveAt', newValue: candidate.cost!.effectiveAt, previousPersisted: false })
    expect(JSON.stringify(legacy.changedFields)).not.toContain('10.00')
    expect(mapReviewRow({ proposed_action: 'update' }).changedFields).toEqual([])
  })
  it('never retains update evidence for reviewed ownership conflicts', () => {
    const entry = plan(candidate, { ...existing, ownerSourceId: null }).entries[0]
    expect(entry.action).toBe('review')
    expect(entry.reviewEvidence).toBeUndefined()
  })
  it('bounds hostile read evidence and rejects unknown fields and private URLs', () => {
    const fields = Array.from({ length: 100 }, () => ({ field: 'fields.colour', oldValue: evidenceValue('white'), newValue: evidenceValue('black') }))
    const mapped = mapReviewRow({ proposed_action: 'update', proposed_diff: { reviewEvidence: { version: 1, fields } } })
    expect(mapped.changedFields).toHaveLength(1)
    expect(mapReviewRow({ proposed_action: 'update', proposed_diff: { reviewEvidence: { version: 1, fields: [
      { field: 'fields.password', oldValue: evidenceValue('hidden'), newValue: evidenceValue('hidden2') },
      { field: 'asset.sourceUrl', oldValue: evidenceValue('https://private.example/a'), newValue: evidenceValue('https://private.example/b') },
    ] } } }).changedFields).toEqual([expect.objectContaining({ field: 'asset.sourceUrl', oldValue: 'Withheld (unsafe or oversized value)', newValue: 'Withheld (unsafe or oversized value)' })])
  })
  it('exposes frozen cost and effective-date values, never a supplied current canonical value', () => {
    const entry = plan().entries[0]
    const staged = planEntryToStagedRow(entry)
    expect(staged.proposed_diff).toHaveProperty('reviewEvidence', entry.reviewEvidence)
    const row = mapReviewRow({ ...staged, currentCanonical: { wholesale_cost: 999 } })
    expect(row).toHaveProperty('changedFields', [
      { field: 'cost', label: 'Supplier cost', oldValue: '10.00 GBP/metre', newValue: '10.01 GBP/metre', previousPersisted: true },
      { field: 'cost.effectiveAt', label: 'Cost effective at', oldValue: '2026-10-13T14:00:00.000Z', newValue: '2026-10-13T15:00:00.000Z', previousPersisted: true },
    ])
    expect(JSON.stringify(row)).not.toContain('999')
  })
  it('captures both complete cost tuples from the actual planning inputs', () => {
    const result = plan()
    expect(result.counts).toMatchObject({ update: 1, cost_changes: 1 })
    expect(result.entries[0]).toHaveProperty('reviewEvidence', { version: 1, fields: [{
      field: 'cost', oldValue: { state: 'recorded', value: { amount: '10', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-13T14:00:00.000Z' } },
      newValue: { state: 'recorded', value: { amount: '10.01', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-13T15:00:00.000Z' } },
    }] })
  })
})
