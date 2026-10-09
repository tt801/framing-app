import { describe, expect, it } from 'vitest'
import { validateCandidate } from '../server/platform/supplierFeeds/validation.js'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'
import type { CanonicalProduct, Candidate, FeedContext, MassChangePolicy, SourceKeyAlias } from '../server/platform/supplierFeeds/contracts.js'

const context: FeedContext = { supplierId: 's1', runId: 'r1', sourceId: 'feed-1', adapter: { id: 'generic-fixture', version: '1' }, scopeId: 'full', mode: 'dry_run', coverage: 'delta', authoritative: false, acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: true, missingInferenceEnabled: true }
const candidate: Candidate = { supplierId: 's1', runId: 'r1', sourceId: 'feed-1', adapter: context.adapter, scopeId: 'full', item: { key: 'row-1', rowNumber: 1 }, sourceProductKey: 'source-1', sourceProductKeyOrigin: 'supplier_provided', fields: { category: 'frame', supplierDescription: 'Wood', lifecycle: 'active', availability: 'available', supplierSku: 'SKU-1', widthMm: 20 }, cost: { amount: '5.25', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-09T06:41:00Z' } }
const existing: CanonicalProduct = { id: 'p1', supplierId: 's1', sourceProductKey: 'source-1', ownerScopeId: 'full', ownerSourceId: 'feed-1', updatedAt: '2026-10-09T08:00:00Z', fields: candidate.fields, cost: candidate.cost }
const row = (input: unknown, key?: string) => ({ item: { key: key ?? (input as Candidate).item.key }, result: validateCandidate(input) })
const plan = (rows: ReturnType<typeof row>[], products: CanonicalProduct[] = [], extra: { context?: FeedContext; aliases?: SourceKeyAlias[]; policy?: MassChangePolicy; allowEmptySnapshotMissingInference?: boolean } = {}) => planFeed({ context: extra.context ?? context, rows, existingProducts: products, aliases: extra.aliases ?? [], massChangePolicy: extra.policy ?? {}, allowEmptySnapshotMissingInference: extra.allowEmptySnapshotMissingInference ?? false })
const actions = (result: ReturnType<typeof plan>) => result.entries.map(e => e.action)

describe('pure supplier-feed reconciliation', () => {
  it('records canonical revision for apply planning and reviews missing revision instead of guessing from updated_at', () => {
    const applyContext = { ...context, mode: 'apply_requested' as const }
    const changed = { ...candidate, cost: { ...candidate.cost!, amount: '6.00' } }
    const withRevision = plan([row(changed)], [{ ...existing, productRevision: '2' }], { context: applyContext }).entries[0]
    expect(withRevision.action).toBe('update')
    expect(withRevision.expectedProductRevision).toBe('2')
    expect(withRevision.expectedUpdatedAt).toBe(existing.updatedAt)
    expect(plan([row(changed)], [existing], { context: applyContext }).entries[0])
      .toMatchObject({ action: 'review', warnings: [expect.objectContaining({ code: 'missing_product_revision' })] })
  })
  it('changes action fingerprint when revision changes even if updated_at is identical', () => {
    const contextForApply = { ...context, mode: 'apply_requested' as const }
    const a = plan([row(candidate)], [{ ...existing, productRevision: '2' }], { context: contextForApply })
    const b = plan([row(candidate)], [{ ...existing, productRevision: '3' }], { context: contextForApply })
    expect(a.entries[0].actionId).not.toBe(b.entries[0].actionId)
  })
  it('plans a new stable key as one create without pricing fields', () => {
    const result = plan([row(candidate)])
    expect(actions(result)).toEqual(['create'])
    expect(result.counts.create).toBe(1)
    expect(result.requiresPlatformAdminApproval).toBe(true)
    expect(result.entries[0].costChange).toBe(false)
    expect(result.entries[0]).not.toHaveProperty('sellingPrice')
  })
  it('does not update an identical existing product', () => {
    expect(actions(plan([row(candidate)], [existing]))).toEqual(['unchanged'])
  })
  it('separates ordinary and lifecycle/availability changes', () => {
    const changed = { ...candidate, fields: { ...candidate.fields, supplierDescription: 'Oak', availability: 'limited' as const } }
    const entry = plan([row(changed)], [existing]).entries[0]
    expect(entry.action).toBe('update')
    expect(entry.ordinaryChanges).toEqual(['supplierDescription'])
    expect(entry.lifecycleChanges).toEqual(['availability'])
    expect(entry.costChange).toBe(false)
  })
  it('plans one audited-boundary update for a cost-only change', () => {
    const entry = plan([row({ ...candidate, cost: { ...candidate.cost!, amount: '5.75' } })], [existing]).entries[0]
    expect(entry.action).toBe('update')
    expect(entry.costChange).toBe(true)
    expect(entry.expectedUpdatedAt).toBe(existing.updatedAt)
    expect(entry.ordinaryChanges).toEqual([])
  })
  it('recognizes an effective-date-only cost change', () => {
    const result = plan([row({ ...candidate, cost: { ...candidate.cost!, effectiveAt: '2026-10-09T07:41:00Z' } })], [existing])
    expect(result.entries[0].costChange).toBe(true)
    expect(result.counts.cost_changes).toBe(1)
  })
  it('reports both duplicate source-key rows rather than planning writes', () => {
    const duplicate = { ...candidate, item: { key: 'row-2', rowNumber: 2 } }
    const result = plan([row(candidate), row(duplicate)])
    expect(actions(result)).toEqual(['review','review'])
    expect(result.counts.create).toBe(0)
  })
  it('treats a colliding SKU as review evidence, not an identity match', () => {
    const result = plan([row({ ...candidate, sourceProductKey: 'other-key' })], [existing])
    expect(actions(result)).toEqual(['review'])
    expect(result.entries[0].productId).toBe(existing.id)
  })
  it('resolves an established same-supplier source-key alias', () => {
    const renamed = { ...candidate, sourceProductKey: 'old-key' }
    const result = plan([row(renamed)], [existing], { aliases: [{ supplierId: 's1', productId: 'p1', aliasKind: 'source_key', aliasValue: 'old-key' }] })
    expect(actions(result)).toEqual(['unchanged'])
    expect(result.entries[0].productId).toBe('p1')
  })
  it('reviews an alias conflicting with a current source key', () => {
    const other = { ...existing, id: 'p2', sourceProductKey: 'old-key', fields: { ...existing.fields, supplierSku: 'SKU-2' } }
    const result = plan([row({ ...candidate, sourceProductKey: 'old-key' })], [existing, other], { aliases: [{ supplierId: 's1', productId: 'p1', aliasKind: 'source_key', aliasValue: 'old-key' }] })
    expect(actions(result)).toEqual(['review'])
  })
  it('rejects invalid candidates with per-row errors, not silence', () => {
    const result = plan([row({ ...candidate, sourceProductKey: '  ' }, 'row-1')])
    expect(actions(result)).toEqual(['reject'])
    expect(result.entries[0].errors[0].field).toBe('sourceProductKey')
    expect(result.counts.reject).toBe(1)
  })
  it('does not infer missing products from delta feeds', () => {
    expect(plan([], [existing]).counts.potential_missing).toBe(0)
  })
  const snapshot: FeedContext = { ...context, coverage: 'snapshot', authoritative: true }
  it('proposes missing only for owned products in a complete authoritative snapshot', () => {
    const foreign = { ...existing, id: 'p2', sourceProductKey: 'other', ownerScopeId: 'other' }
    const manual = { ...existing, id: 'p3', sourceProductKey: 'manual', ownerScopeId: null, ownerSourceId: null }
    const observed = { ...candidate, sourceProductKey: 'new-key', fields: { ...candidate.fields, supplierSku: 'NEW-SKU' } }
    const result = plan([row(observed)], [existing, foreign, manual], { context: snapshot })
    expect(actions(result)).toEqual(['create', 'potential_missing'])
    expect(result.entries[1].productId).toBe('p1')
    expect(result.entries[1].lifecycleChanges).toEqual([])
  })
  it('blocks empty authoritative snapshots by default and reports a structured anomaly', () => {
    const result = plan([], [existing], { context: snapshot })
    expect(result.counts.potential_missing).toBe(0)
    expect(result.missingInferenceEligible).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'empty_snapshot_missing_inference_blocked' }))
  })
  it('permits empty-snapshot missing planning only with a separate explicit permission', () => {
    const result = plan([], [existing], { context: snapshot, allowEmptySnapshotMissingInference: true })
    expect(actions(result)).toEqual(['potential_missing'])
    expect(result.warnings.some(w => w.code === 'empty_snapshot_missing_inference_blocked')).toBe(false)
  })
  it('never infers missing from an empty delta even with empty-snapshot permission', () => {
    expect(plan([], [existing], { allowEmptySnapshotMissingInference: true }).counts.potential_missing).toBe(0)
  })
  it('never infers missing from an empty non-authoritative snapshot even with permission', () => {
    const result = plan([], [existing], { context: { ...snapshot, authoritative: false }, allowEmptySnapshotMissingInference: true })
    expect(result.counts.potential_missing).toBe(0)
  })
  it('remains deterministic across actions, fingerprints, counts and flags for empty-snapshot anomalies', () => {
    const input = { context: snapshot, policy: { potentialMissing: { count: 0 } }, allowEmptySnapshotMissingInference: true } satisfies Parameters<typeof plan>[2]
    const first = plan([], [existing], input)
    const second = plan([], [existing], input)
    expect(second).toEqual(first)
    expect(second.entries.map(e => e.actionId)).toEqual(first.entries.map(e => e.actionId))
    expect(second.massChangeFlags).toMatchObject([{ kind: 'potentialMissing', count: 1 }])
  })
  it('disables missing inference for incomplete or unhealthy snapshots', () => {
    for (const patch of [{ missingInferenceEnabled: false }, { parsingComplete: false }, { validationSafeForMissing: false }, { authoritative: false }]) {
      const result = plan([], [existing], { context: { ...snapshot, ...patch } })
      expect(result.counts.potential_missing).toBe(0)
    }
  })
  it('fails closed on invalid rows during a snapshot', () => {
    const result = plan([row({ ...candidate, sourceProductKey: '' }, 'row-1')], [existing], { context: snapshot })
    expect(result.counts.potential_missing).toBe(0)
    expect(result.counts.reject).toBe(1)
  })
  it('does not let supplier, scope, run or adapter metadata cross a plan boundary', () => {
    for (const change of [{ supplierId: 's2' }, { scopeId: 'other' }, { runId: 'other' }, { adapter: { id: 'other', version: '1' } }]) {
      expect(actions(plan([row({ ...candidate, ...change })]))).toEqual(['reject'])
    }
  })
  it('compares asset metadata separately from ordinary fields', () => {
    const asset = { rightsStatus: 'unknown' as const, sourceUrl: 'https://example.invalid/img' }
    const result = plan([row({ ...candidate, asset })], [existing])
    expect(result.entries[0].assetChanges).toEqual(['rightsStatus','sourceUrl'])
    expect(result.entries[0].ordinaryChanges).toEqual([])
  })
  it('is deterministic for the same inputs, including stable action identities', () => {
    const first = plan([row(candidate)], [existing])
    expect(plan([row(candidate)], [existing])).toEqual(first)
  })
  it('freezes normalized candidate content into action fingerprints', () => {
    const first = plan([row(candidate)])
    const second = plan([row({ ...candidate, fields: { ...candidate.fields, supplierDescription: 'Oak' } })])
    expect(first.entries[0].candidate?.fields.supplierDescription).toBe('Wood')
    expect(first.entries[0].actionId).not.toBe(second.entries[0].actionId)
  })
  it('reviews multiple different keys resolving to one product in the same run', () => {
    const older = { ...candidate, item: { key: 'row-2', rowNumber: 2 }, sourceProductKey: 'old-key' }
    const result = plan([row(candidate), row(older)], [existing], { aliases: [{ supplierId: 's1', productId: 'p1', aliasKind: 'source_key', aliasValue: 'old-key' }] })
    expect(actions(result)).toEqual(['review','review'])
    expect(result.counts.update).toBe(0)
  })
  it('reviews two new source keys sharing the same canonical SKU tuple', () => {
    const second = { ...candidate, sourceProductKey: 'source-2', item: { key: 'row-2', rowNumber: 2 } }
    const result = plan([row(candidate), row(second)])
    expect(actions(result)).toEqual(['review', 'review'])
    expect(result.entries.every(e => e.warnings.some(w => w.code === 'sku_collision'))).toBe(true)
  })
  it('uses scope-owned products as the mass-update proportion denominator', () => {
    const outside = Array.from({ length: 10 }, (_, i) => ({ ...existing, id: `other-${i}`, sourceProductKey: `other-${i}`, ownerScopeId: 'elsewhere', fields: { ...existing.fields, supplierSku: `OTHER-${i}` } }))
    const changed = { ...candidate, fields: { ...candidate.fields, supplierDescription: 'Changed' } }
    const result = plan([row(changed)], [existing, ...outside], { policy: { updates: { proportion: 0.5 } } })
    expect(result.massChangeFlags).toMatchObject([{ kind: 'updates', count: 1, denominator: 1 }])
  })
  it('flags configured count and proportion mass-change limits without blocking planning', () => {
    const result = plan([row(candidate)], [], { policy: { creates: { count: 0, proportion: 0.5 } } })
    expect(result.massChangeFlags).toMatchObject([{ kind: 'creates', count: 1 }])
    expect(result.requiresAcknowledgement).toBe(true)
    expect(result.counts.create).toBe(1)
  })
  it('assesses update, cost and potential-missing limits independently', () => {
    const changed = { ...candidate, cost: { ...candidate.cost!, amount: '5.75' } }
    const other = { ...existing, id: 'p2', sourceProductKey: 'source-2', fields: { ...existing.fields, supplierSku: 'SKU-2' } }
    const result = plan([row(changed)], [existing, other], {
      context: { ...context, coverage: 'snapshot', authoritative: true },
      policy: { updates: { count: 0 }, costChanges: { proportion: 0.4 }, potentialMissing: { count: 0 } },
    })
    expect(result.massChangeFlags.map(flag => flag.kind)).toEqual(['updates','costChanges','potentialMissing'])
    expect(result.counts).toMatchObject({ update: 1, cost_changes: 1, potential_missing: 1 })
  })
})
