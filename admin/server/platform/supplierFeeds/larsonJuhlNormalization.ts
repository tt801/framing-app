import type { Candidate, FeedContext } from './contracts.js'
import type { PlanningRow } from './planner.js'
import { assembleLarsonCatalogue, LARSON_SCOPE, LARSON_NO_IMAGE, type LarsonCatalogue } from './larsonJuhlCatalogue.js'
import { validateCandidate } from './validation.js'

export type LarsonIdentity = { supplierId: string; sourceId: string; scopeId: string; runId: string }
/** Retained positive evidence, not an exhaustive or current discontinued feed. */
export const larsonDiscontinuedEvidence = Object.freeze({ sourceUrl: 'https://larsonjuhl.co.uk/discontinued/',
  retrievedAt: '2026-10-16T06:49:05Z', skus: ['991247116', '945008001'] as readonly string[],
  statement: 'Items appearing in Volume 14 now discontinued and no longer available to purchase' })

export function normalizeLarsonCatalogue(raw: LarsonCatalogue, identity: LarsonIdentity) {
  if (identity.scopeId !== LARSON_SCOPE || raw.adapter.id !== 'larson-juhl-uk-public-catalogue' || raw.adapter.version !== '1'
    || !raw.rows.length || !/^[0-9a-f]{64}$/.test(raw.manifestSha256)) throw new Error('Unverified Larson catalogue identity/scope')
  const verified = assembleLarsonCatalogue(raw.pages)
  if (verified.manifestSha256 !== raw.manifestSha256 || JSON.stringify(verified.rows) !== JSON.stringify(raw.rows))
    throw new Error('Unverified Larson catalogue completeness/manifest')
  const ids = { supplierId: identity.supplierId, sourceId: identity.sourceId, scopeId: identity.scopeId, runId: identity.runId }
  const context: FeedContext = { ...ids, adapter: { ...raw.adapter }, mode: 'dry_run', coverage: 'snapshot', authoritative: false,
    acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: false, missingInferenceEnabled: false }
  const acquisitionBySku = new Map(raw.pages.flatMap(page => page.rows.map(row => [row.sku, page.acquisition] as const)))
  const sourceEvidenceByRow = new Map<number, Record<string, unknown>>()
  const planningRows: PlanningRow[] = raw.rows.map((row, index) => {
    const sample = /\b(?:chevron|sample)\b/i.test(row.name)
    const moulding = /\bmoulding\b/i.test(row.name)
    const lifecycleConflict = larsonDiscontinuedEvidence.skus.includes(row.sku)
    const item = { key: row.sku, rowNumber: index + 1, path: row.url }
    const candidate: Candidate = { ...ids, adapter: { ...raw.adapter }, item, sourceProductKey: row.sku, sourceProductKeyOrigin: 'supplier_provided',
      fields: { category: sample || !moulding ? 'other' : 'frame', ...(sample ? { subcategory: 'sample' } : moulding ? { subcategory: 'moulding' } : {}),
        supplierSku: row.sku, catalogScope: identity.scopeId, supplierDescription: row.name,
        // Initial record state only, NOT lifecycle/stock evidence. Existing differences require review below.
        lifecycle: 'active', availability: 'unknown' },
      ...(row.image && row.image !== LARSON_NO_IMAGE ? { asset: { sourceUrl: row.image, attribution: 'Larson-Juhl UK', rightsStatus: 'unknown' as const } } : {}) }
    const reviewReason = lifecycleConflict
      ? { code: 'larson_lifecycle_review', message: 'Retained explicit discontinued evidence conflicts with catalogue presence; no lifecycle assertion authorized' }
      : !sample && !moulding ? { code: 'larson_category_review', message: 'Public category membership does not establish ordinary moulding stock type' } : undefined
    sourceEvidenceByRow.set(item.rowNumber, { rawProduct: row, categorySource: 'UK public mouldings-category membership',
      categoryReviewRequired: Boolean(!sample && !moulding), lifecycleQualified: false, costQualified: false,
      acquisition: acquisitionBySku.get(row.sku), manifestSha256: raw.manifestSha256,
      ...(lifecycleConflict ? { discontinuedEvidence: larsonDiscontinuedEvidence } : {}) })
    return { item, result: validateCandidate(candidate), policy: { preserveLifecycle: true, ...(reviewReason ? { reviewReason } : {}) } }
  })
  return { context, planningRows, candidates: planningRows.flatMap(row => row.result.value ? [row.result.value] : []), sourceEvidenceByRow,
    provenance: { sourceClassification: 'C', lifecycleQualified: false, costQualified: false, rawRows: raw.rows, pages: raw.pages.map(p => p.acquisition) } }
}
