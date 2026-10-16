import { expect, it } from 'vitest'
import { planFeed, type PlanningRow } from '../server/platform/supplierFeeds/planner.js'
import type { Candidate, CanonicalProduct, FeedContext } from '../server/platform/supplierFeeds/contracts.js'

const context: FeedContext = { supplierId: 'supplier', sourceId: 'source', scopeId: 'uk-public-mouldings-category', runId: 'run',
  adapter: { id: 'larson-juhl-uk-public-catalogue', version: '1' }, mode: 'dry_run', coverage: 'snapshot',
  authoritative: false, acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: false, missingInferenceEnabled: false }
const candidate: Candidate = { ...context, item: { key: '0475WG', rowNumber: 1 }, sourceProductKey: '0475WG', sourceProductKeyOrigin: 'supplier_provided',
  fields: { category: 'frame', supplierSku: '0475WG', supplierDescription: 'LJE Moulding', lifecycle: 'active', availability: 'unknown' } }
const existing: CanonicalProduct = { id: 'product', supplierId: 'supplier', sourceProductKey: '0475WG', ownerSourceId: 'source',
  ownerScopeId: context.scopeId, updatedAt: '2026-10-16T00:00:00Z', productRevision: '1', fields: { ...candidate.fields, lifecycle: 'discontinued', availability: 'unavailable' } }
const plan = (row: PlanningRow, products: CanonicalProduct[] = []) => planFeed({ context, rows: [row], existingProducts: products, aliases: [], massChangePolicy: {} })

it('routes adapter-qualified ambiguous product rows through the existing review action', () => {
  const row: PlanningRow = { item: candidate.item, result: { value: candidate, errors: [], warnings: [] },
    policy: { reviewReason: { code: 'category_review', message: 'Supplier category does not establish stock type' } } }
  const result = plan(row)
  expect(result.counts.review).toBe(1)
  expect(result.counts.create).toBe(0)
  expect(result.entries[0]).toMatchObject({ action: 'review', candidate, warnings: [expect.objectContaining({ code: 'category_review' })] })
})

it('withholds lifecycle/availability mutations when a product-only row disagrees with existing state', () => {
  const row: PlanningRow = { item: candidate.item, result: { value: candidate, errors: [], warnings: [] }, policy: { preserveLifecycle: true } }
  const result = plan(row, [existing])
  expect(result.entries[0]).toMatchObject({ action: 'review', lifecycleChanges: [], costChange: false })
  expect(result.entries[0].warnings).toContainEqual(expect.objectContaining({ code: 'lifecycle_not_qualified' }))
  expect(result.counts.update).toBe(0)
  expect(result.counts.cost_changes).toBe(0)
  expect(result.counts.potential_missing).toBe(0)
})

it('leaves existing supplier planning unchanged when row policy is absent', () => {
  expect(plan({ item: candidate.item, result: { value: candidate, errors: [], warnings: [] } }, [existing]).entries[0].action).toBe('update')
})
