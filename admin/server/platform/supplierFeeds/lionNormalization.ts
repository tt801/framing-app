import type { Candidate, FeedContext, FeedIssue } from './contracts.js'
import type { PlanningRow } from './planner.js'
import { LION_SCOPE, parseLionCsv, type LionCatalogue } from './lionCatalogue.js'
import { lionDiscoveryEvidence } from './lionReviewEvidence.js'
import { validateCandidate } from './validation.js'

export type LionIdentity = { supplierId: string; sourceId: string; scopeId: string; runId: string }
/** No website/companion acquisition, cost, dimension-unit, stock or lifecycle inference. */
export function normalizeLionCatalogue(raw: LionCatalogue, identity: LionIdentity) {
  if (identity.scopeId !== LION_SCOPE || raw.adapter.id !== 'lion-uk-public-mouldings' || raw.adapter.version !== '1')
    throw new Error('Unverified Lion catalogue identity/scope')
  const verified = parseLionCsv(raw.bytes, raw.acquisition)
  if (JSON.stringify(raw.rows) !== JSON.stringify(verified.rows) || JSON.stringify(raw.generation) !== JSON.stringify(verified.generation))
    throw new Error('Unverified Lion catalogue rows/generation')
  const ids = { supplierId: identity.supplierId, sourceId: identity.sourceId, scopeId: identity.scopeId, runId: identity.runId }
  const context: FeedContext = { ...ids, adapter: { ...verified.adapter }, mode: 'dry_run', coverage: 'snapshot', authoritative: false,
    acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: false, missingInferenceEnabled: false }
  const sourceEvidenceByRow = new Map<number, Record<string, unknown>>()
  const planningRows: PlanningRow[] = verified.rows.map(row => {
    const alerts: FeedIssue[] = []
    const warn = (code: string, message: string) => alerts.push({ code, message })
    // The CSV Width header has no explicit units. Withhold the canonical dimension AND
    // hold the item for review; no dimensional ambiguity is silently promoted to CREATE.
    warn('lion_dimensions_review', 'CSV width has unqualified units/zero semantics; raw evidence only, no canonical dimensions')
    if ((lionDiscoveryEvidence.membershipDisagreements as readonly string[]).includes(row.sku))
      warn('lion_membership_review', 'Retained discovery found CSV/web membership disagreement; not current absence/lifecycle evidence')
    if ((lionDiscoveryEvidence.discontinued as readonly string[]).includes(row.sku))
      warn('lion_discontinued_review', 'Exact SKU occurred on the retained explicit discontinued list; no automatic lifecycle mutation')
    if ((lionDiscoveryEvidence.phaseOut as readonly string[]).includes(row.sku))
      warn('lion_phase_out_review', 'Retained explicit discontinued-when-out-of-stock warning; not equivalent to discontinued')
    if (/X$/.test(row.sku) || /\b(?:second quality|first quality)\b/i.test(row.name))
      warn('lion_quality_identity_review', 'Quality/suffix identity requires review; never merge into an unsuffixed code')
    if (/^(?:CH|CL|CA|CB)\d|^\d+$/.test(row.sku) || /\b(?:chop|chevron|sample|slip|spacer|tray|sub.?frame|stretcher|brace|component)\b/i.test(row.name))
      warn('lion_scope_review', 'Possible chop/sample/component or uncertain moulding stock scope; no name-derived canonical attributes')
    const item = { key: row.sku, rowNumber: row.rowNumber }
    const candidate: Candidate = { ...ids, adapter: { ...verified.adapter }, item, sourceProductKey: row.sku, sourceProductKeyOrigin: 'supplier_provided',
      fields: { category: 'frame', subcategory: 'moulding', supplierSku: row.sku, catalogScope: identity.scopeId, supplierDescription: row.name.trim(),
        // Contract-required initial defaults, not source lifecycle assertions. Every row
        // is review-only; preserveLifecycle additionally blocks existing-state changes.
        lifecycle: 'active', availability: 'unknown' } }
    sourceEvidenceByRow.set(row.rowNumber, { rawProduct: row, acquisition: verified.acquisition, generation: verified.generation,
      costQualified: false, dimensionsQualified: false, lifecycleQualified: false, assetRightsStatus: 'unknown',
      retainedDiscovery: { observedOn: lionDiscoveryEvidence.observedOn, catalogueUrl: lionDiscoveryEvidence.catalogueUrl,
        discontinuedUrl: lionDiscoveryEvidence.discontinuedUrl, qualification: lionDiscoveryEvidence.qualification }, reviewReasons: alerts })
    const result = validateCandidate(candidate)
    result.warnings.push(...alerts.slice(1))
    return { item, result, policy: { preserveLifecycle: true, reviewReason: alerts[0] } }
  })
  return { context, planningRows, candidates: planningRows.flatMap(row => row.result.value ? [row.result.value] : []), sourceEvidenceByRow }
}
