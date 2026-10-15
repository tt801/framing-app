import type { FeedContext, FeedAcquisition, PublicationEvidence } from './contracts.js'
import type { PlanningRow } from './planner.js'
import type { FeedSourceIdentity } from './block2eOrchestrator.js'
import { runWessexFetchCheck, WESSEX_MOULDINGS_XLS_URL, WESSEX_UPDATES_PAGE_URL, type WessexFetchCheckOptions, type WessexFetchCheckResult } from './wessexFetchCheck.js'
import { normalizeWessexArtifact } from './wessexNormalization.js'
import { runInternationalFetchCheck } from './internationalFetchCheck.js'
import { normalizeInternationalArtifact } from './internationalNormalization.js'
import { INTERNATIONAL_MEMBER, INTERNATIONAL_ZIP_URL } from './internationalMoulding.js'

export type FeedNormalization = { context: FeedContext; planningRows: PlanningRow[] }
export type CheckedFeedRelease = {
  classification: 'changed' | 'unchanged'; latestSha256: string
  artifact: { acquisition: FeedAcquisition }
  publishedUpdate: PublicationEvidence
  normalized: FeedNormalization
  normalizeForRun(runId: string): FeedNormalization
  artifactRef?: string
  sourceEvidenceByRow?: Map<number, Record<string, unknown>>
}
export type FeedAdapter = {
  readonly id: 'wessex-wpp4-mouldings' | 'international-moulding-historical'
  readonly sourceUrl: string; readonly publicationUrl: string; readonly releaseNamespace: string
  readonly mode: 'apply_requested' | 'dry_run'; readonly allowsAuthoritative: boolean; readonly allowsMissing: boolean
  acquire(input: { source: FeedSourceIdentity; previousSha256: string | null; timeoutMs: number; now: () => Date }): Promise<CheckedFeedRelease>
}

type WessexAcquirer = (options: WessexFetchCheckOptions & { previousSha256: string | null }) => Promise<WessexFetchCheckResult>
export function createWessexAdapter(fetchCheck: WessexAcquirer = runWessexFetchCheck, policy = { acquisitionComplete: true, completeReleaseConfirmed: true }): FeedAdapter {
  return Object.freeze({ id: 'wessex-wpp4-mouldings', sourceUrl: WESSEX_MOULDINGS_XLS_URL, publicationUrl: WESSEX_UPDATES_PAGE_URL,
    releaseNamespace: 'wessex', mode: 'apply_requested', allowsAuthoritative: true, allowsMissing: true,
    async acquire({ source, previousSha256, timeoutMs, now }) {
      const identity = { supplierId: source.supplierId, sourceId: source.feedSourceId, scopeId: source.scopeKey }
      const check = await fetchCheck({ ...identity, runId: '00000000-0000-4000-8000-000000000000', ...policy, previousSha256, timeoutMs, now })
      return { ...check, normalizeForRun: runId => normalizeWessexArtifact(check.artifact, { ...identity, runId,
        publishedDatabaseUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
        acquisitionComplete: check.normalized.context.acquisitionComplete, completeReleaseConfirmed: check.normalized.context.authoritative }) }
    } })
}
export function createInternationalAdapter(fetchCheck = runInternationalFetchCheck): FeedAdapter {
  return Object.freeze({ id: 'international-moulding-historical', sourceUrl: INTERNATIONAL_ZIP_URL,
    publicationUrl: `${INTERNATIONAL_ZIP_URL}#${encodeURIComponent(INTERNATIONAL_MEMBER)}`, releaseNamespace: 'international-moulding-historical',
    mode: 'dry_run', allowsAuthoritative: false, allowsMissing: false,
    async acquire({ source, previousSha256, timeoutMs, now }) {
      if (source.allowsAuthoritativeSnapshots !== false) throw new Error('Historical source cannot allow authoritative snapshots')
      const identity = { supplierId: source.supplierId, sourceId: source.feedSourceId, scopeId: source.scopeKey }
      const check = await fetchCheck({ ...identity, runId: 'pending-run-id', previousSha256, timeoutMs, now })
      return { ...check, normalizeForRun: runId => normalizeInternationalArtifact(check.artifact, { ...identity, runId }),
        artifactRef: `${INTERNATIONAL_ZIP_URL}#member=${encodeURIComponent(INTERNATIONAL_MEMBER)}&sha256=${check.latestSha256}`,
        sourceEvidenceByRow: new Map(check.artifact.rows.map(row => [row.item.rowNumber, { historical: true, selectedMember: check.artifact.selectedMember,
          worksheet: check.artifact.worksheet, publishedTitle: check.artifact.publishedTitle, publishedDate: check.artifact.publishedDate,
          workbookSha256: check.artifact.workbookSha256, acquisition: check.artifact.acquisition, prices: row.prices }])) }
    } })
}

export type RegisteredFeed = { source: FeedSourceIdentity; adapter: FeedAdapter; liveChecking: boolean; schedule: 'daily' | null }
// Only approved existing identities are registered. International has deliberately NO
// feed UUID/operational registration until a separately approved Sandbox registration.
export const wessexFeedSource = Object.freeze({
  supplierId: '1312e794-ec94-4bf0-aa3a-9ffc35b4428d', feedSourceId: '468247ee-809b-4784-aca1-bba44f860c85',
  scopeKey: 'mouldings' })
// Native production scheduling is deferred; manual execution capability is separate.
const registeredFeeds: readonly RegisteredFeed[] = [Object.freeze({ source: wessexFeedSource, adapter: createWessexAdapter(), liveChecking: true, schedule: null })]
export function registeredFeed(feedId: unknown): RegisteredFeed | null {
  return typeof feedId === 'string' ? registeredFeeds.find(feed => feed.source.feedSourceId === feedId) ?? null : null
}
export function checkingCapability(source: { id: string; supplier_id: string; source_key: string; scope_key: string; allows_authoritative_snapshots: boolean; supplier?: { status: string } }) {
  const registered = registeredFeed(source.id)
  const identityMatches = registered && registered.source.supplierId === source.supplier_id
    && registered.source.scopeKey === source.scope_key && source.allows_authoritative_snapshots
  const enabled = Boolean(identityMatches && registered.liveChecking && process.env.SUPPLIER_FEED_AUTOMATION_ENABLED === 'true'
    && process.env.SUPPLIER_FEED_EXPECTED_PROJECT_REF === 'zminmylvmtyglkujxxyk'
    && process.env.SUPABASE_URL === 'https://zminmylvmtyglkujxxyk.supabase.co')
  return { canCheckNow: enabled, schedule: enabled ? registered!.schedule : null,
    description: enabled ? 'Live checking enabled' : 'Live checking disabled — manual/historical or unregistered source' }
}
