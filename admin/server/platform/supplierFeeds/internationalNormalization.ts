import type { Candidate, FeedContext } from './contracts.js'
import type { InternationalArtifact } from './internationalMoulding.js'
import { INTERNATIONAL_MEMBER } from './internationalMoulding.js'
import { validateCandidate } from './validation.js'

export type InternationalIdentity = { supplierId: string; sourceId: string; scopeId: string; runId: string }
/** Historical file membership is not current availability. No dimensions, tier selection or cost assertion. */
export function normalizeInternationalArtifact(raw: InternationalArtifact, identity: InternationalIdentity) {
  if (raw.adapter.id !== 'international-moulding-historical' || raw.adapter.version !== '1' || raw.selectedMember !== INTERNATIONAL_MEMBER
    || raw.publishedDate !== '16/01/2023' || !/^[0-9a-f]{64}$/.test(raw.workbookSha256) || !raw.rows.length) throw new Error('Unverified International historical evidence')
  const ids = { supplierId: identity.supplierId, sourceId: identity.sourceId, scopeId: identity.scopeId, runId: identity.runId }
  const context: FeedContext = { ...ids, adapter: { ...raw.adapter }, mode: 'dry_run', coverage: 'snapshot', authoritative: false,
    acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: false, missingInferenceEnabled: false }
  const planningRows = raw.rows.map(row => {
    const candidate: Candidate = { ...ids, adapter: { ...raw.adapter }, item: { ...row.item }, sourceProductKey: row.reference,
      sourceProductKeyOrigin: 'supplier_provided', fields: { category: 'frame', supplierSku: row.reference,
        supplierDescription: row.description, lifecycle: 'active', availability: 'unknown' } }
    return { item: candidate.item, result: validateCandidate(candidate) }
  })
  return { context, planningRows, candidates: planningRows.flatMap(row => row.result.value ? [row.result.value] : []),
    provenance: { historical: true, identityStability: 'unconfirmed', publishedTitle: raw.publishedTitle, publishedDate: raw.publishedDate,
      workbookSha256: raw.workbookSha256, acquisition: { ...raw.acquisition }, selectedMember: raw.selectedMember, rawRows: raw.rows } }
}
