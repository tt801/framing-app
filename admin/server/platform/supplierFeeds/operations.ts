import type { FeedCheck, FeedRun, FeedSummary, PlanCounts, FeedList, FeedDetail, RunDetail, ReviewRow } from '../../../src/lib/supplierFeedTypes.js'
import { readRunControl } from './control.js'
import { readReviewEvidence } from './reviewEvidence.js'
import { checkingCapability } from './feedAdapters.js'

type Row = Record<string, any>
const text = (value: unknown, max = 512): string | null => typeof value === 'string' ? value.slice(0, max) : null
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const countKeys = ['create', 'update', 'unchanged', 'review', 'reject', 'potential_missing', 'cost_changes'] as const

// Reserved .invalid URLs cannot be supplier acquisition evidence. Only explicit
// synthetic identity/evidence markers qualify; dry runs and empty plans do not.
// There is no schema-level synthetic flag: unmarked verification records cannot
// safely be distinguished. Do not compensate with fixture UUID allow/deny lists.
export function isSynthetic(row: Row): boolean {
  const invalidUrl = (value: unknown) => {
    if (typeof value !== 'string') return false
    try { const host = new URL(value).hostname; return host === 'invalid' || host.endsWith('.invalid') }
    catch { return false }
  }
  return [row.source_url, row.published_update_source_url, row.artifact_ref].some(invalidUrl)
    || [row.adapter_id, row.adapter_version, row.planner_version, row.logical_run_key, row.release_logical_key, row.error_code].some(value =>
      typeof value === 'string' && /(^|[-_: ])synthetic([-_: ]|$)/i.test(value))
    || (typeof row.published_update_date_raw === 'string' && /^SYNTHETIC .*VERIFICATION/i.test(row.published_update_date_raw))
    || Boolean(row.linked_run && isSynthetic(row.linked_run))
    || Boolean(Array.isArray(row.checks) && row.checks.some(isSynthetic))
}

export function mapRun(row: Row): FeedRun {
  const counts = Object.fromEntries(countKeys.map(key => [key, count(row.plan_counts?.[key])])) as PlanCounts
  return {
    id: row.id, logical_run_key: text(row.logical_run_key), created_at: row.created_at, status: row.status,
    mode: text(row.mode), approved_at: text(row.approved_at), completed_at: text(row.completed_at),
    appliedAt: row.status === 'applied' ? text(row.completed_at) : null,
    plan_fingerprint: text(row.plan_fingerprint), source_checksum: text(row.source_checksum), artifact_ref: text(row.artifact_ref, 2048),
    adapter_id: text(row.adapter_id), adapter_version: text(row.adapter_version), planner_version: text(row.planner_version),
    row_count: count(row.row_count), counts, failure_code: text(row.failure_code),
  }
}
export function mapCheck(row: Row): FeedCheck {
  return {
    id: row.id, checked_at: row.checked_at, status: row.status, release_classification: text(row.release_classification),
    source_url: text(row.source_url, 2048), published_update_source_url: text(row.published_update_source_url, 2048),
    published_update_date: text(row.published_update_date), published_update_date_raw: text(row.published_update_date_raw),
    published_update_match: text(row.published_update_match), artifact_retrieved_at: text(row.artifact_retrieved_at),
    evidence_retrieved_at: text(row.evidence_retrieved_at), etag: text(row.etag), last_modified: text(row.last_modified),
    content_byte_length: count(row.content_byte_length), sha256: text(row.sha256), release_logical_key: text(row.release_logical_key),
    feed_run_id: text(row.feed_run_id), plan_fingerprint: text(row.plan_fingerprint), error_code: text(row.error_code, 64),
    error_summary: text(row.error_summary), synthetic: isSynthetic(row),
  }
}
export function aggregateFeed(source: Row, checks: Row[], runs: Row[], canonicalProductCount: number, historyLimited = false, releaseEvidence?: { checks: Row[]; runs: Row[]; attempt?: Row; pending?: Row[] }): FeedSummary {
  checks = checks.filter(row => !isSynthetic(row))
  runs = runs.filter(row => !isSynthetic(row))
  const latestCheck = checks[0] ? mapCheck(checks[0]) : null
  const latestRun = runs[0] ? mapRun(runs[0]) : null
  const successful = (releaseEvidence?.checks ?? checks).find(row => !isSynthetic(row) && ['changed', 'unchanged'].includes(row.status) && row.sha256)
  const imported = (releaseEvidence?.runs ?? runs).find(row => !isSynthetic(row) && row.status === 'applied' && row.source_checksum)
  const latestRelease = successful ? {
    sha256: successful.sha256, classification: text(successful.release_classification),
    publishedUpdateDate: text(successful.published_update_date), origin: 'check' as const,
  } : imported ? {
    sha256: imported.source_checksum, classification: null, publishedUpdateDate: null, origin: 'applied_import' as const,
  } : null
  const knownRuns = [...runs, ...(releaseEvidence?.runs ?? [])].filter(row => !isSynthetic(row))
  const relevantRun = latestCheck && (knownRuns.find(row => row.id === latestCheck.feed_run_id)
    ?? knownRuns.find(row => row.source_checksum === latestCheck.sha256)
    ?? knownRuns.find(row => Date.parse(row.created_at) >= Date.parse(latestCheck.checked_at)))
  const pendingRelease = relevantRun && relevantRun.status !== 'applied'
  const pendingApproval = [...(releaseEvidence?.pending ?? []), ...runs].find(row => !isSynthetic(row) && row.status === 'awaiting_approval')
  const health = !latestCheck ? (historyLimited ? 'Unknown — history limit' : 'Never checked')
    : latestCheck.status === 'planning_error' ? 'Planning failed'
      : !['changed', 'unchanged'].includes(latestCheck.status) ? 'Check failed'
        : relevantRun?.status === 'failed' ? 'Planning failed'
          : pendingApproval || pendingRelease || (latestCheck.status === 'changed' && relevantRun?.status !== 'applied') ? 'Changed — review required' : historyLimited ? 'Unknown — history limit' : 'Healthy'
  const attempt = releaseEvidence?.attempt
  const interrupted = attempt?.outcome === 'running' && Date.parse(attempt.expires_at) <= Date.now()
  const lastSuccessfulCheckAt = successful?.checked_at ?? null
  const checking = checkingCapability(source as Parameters<typeof checkingCapability>[0])
  return {
    checking,
    lastSuccessfulCheckAt, pendingApprovalRunId: pendingApproval?.id ?? null,
    overdue: checking.schedule === 'daily' && (!lastSuccessfulCheckAt || Date.now() - Date.parse(lastSuccessfulCheckAt) > 30 * 60 * 60 * 1000),
    latestAttempt: attempt ? { id: attempt.id, triggerType: attempt.trigger_type, state: interrupted || attempt.outcome === 'interrupted' ? 'interrupted' : attempt.outcome === 'running' ? 'running' : attempt.outcome === 'failed' ? 'failed' : 'completed', startedAt: attempt.started_at, completedAt: attempt.completed_at, stage: attempt.stage } : null,
    id: source.id, supplier_id: source.supplier_id, source_key: source.source_key, scope_key: source.scope_key,
    allows_authoritative_snapshots: source.allows_authoritative_snapshots,
    supplier: { id: source.supplier.id, name: source.supplier.name, status: source.supplier.status },
    canonicalProductCount, latestCheck, latestRun, latestRelease, health, historyLimited,
  }
}

type Database = { from: (table: string) => any }
export const operationLimits = { feeds: 25, scan: 200, checks: 50, runs: 20, rows: 50 } as const
export const sourceColumns = 'id,supplier_id,source_key,scope_key,allows_authoritative_snapshots,supplier:suppliers(id,name,slug,status)'
export const runColumns = 'id,feed_source_id,supplier_id,scope_key,persistence_version,logical_run_key,created_at,status,mode,approved_by,approved_at,approved_plan_fingerprint,acknowledged_anomalies,completed_at,plan_fingerprint,plan_counts,policy_snapshot,anomaly_flags,apply_disposition,acquisition_complete,parsing_complete,staging_purged_at,source_checksum,artifact_ref,adapter_id,adapter_version,planner_version,row_count,failure_code'
const checkColumns = 'id,checked_at,created_at,status,release_classification,source_url,published_update_source_url,published_update_date,published_update_date_raw,published_update_match,artifact_retrieved_at,evidence_retrieved_at,etag,last_modified,content_byte_length,sha256,release_logical_key,feed_run_id,plan_fingerprint,error_code,error_summary,linked_run:supplier_feed_runs!feed_run_id(adapter_id,adapter_version,planner_version,artifact_ref,logical_run_key)'
const rowColumns = 'id,row_number,source_product_key,source_record_key,source_path,row_kind,proposed_action,validation_status,matched_product_id,apply_state,failure_code,proposed_product,proposed_diff,validation_errors,validation_warnings'

export class OperationsNotFound extends Error {}
async function data(query: any): Promise<Row[]> {
  const result = await query
  if (result.error) throw result.error
  return result.data ?? []
}
async function sourceById(db: Database, feedId: string): Promise<Row> {
  const sources = await data(db.from('supplier_feed_sources').select(sourceColumns).eq('id', feedId).limit(1))
  if (!sources[0]) throw new OperationsNotFound('Feed not found')
  return sources[0]
}
async function evidence(db: Database, source: Row) {
  const checksQuery = () => db.from('supplier_feed_source_checks').select(checkColumns).eq('feed_source_id', source.id)
    .order('checked_at', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
  const runsQuery = () => db.from('supplier_feed_runs').select(runColumns).eq('feed_source_id', source.id).eq('supplier_id', source.supplier_id).eq('persistence_version', 2)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
  const [checks, runs, successfulChecks, appliedRuns, products, attempts, pending] = await Promise.all([
    data(checksQuery().limit(operationLimits.scan + 1)),
    data(runsQuery().limit(operationLimits.scan + 1)),
    // Independent bounded success lookups retain the last good release even
    // after a long failure/queued-run history. Synthetic records stay filtered.
    data(checksQuery().in('status', ['changed', 'unchanged']).limit(operationLimits.scan + 1)),
    data(runsQuery().eq('status', 'applied').limit(operationLimits.scan + 1)),
    db.from('supplier_products').select('id', { count: 'exact', head: true }).eq('owner_feed_source_id', source.id).eq('supplier_id', source.supplier_id),
    data(db.from('supplier_feed_execution_attempts').select('id,trigger_type,started_at,expires_at,completed_at,outcome,stage').eq('feed_source_id', source.id).order('started_at', { ascending: false }).order('id', { ascending: false }).limit(1)),
    data(runsQuery().eq('status', 'awaiting_approval').limit(operationLimits.scan + 1)),
  ])
  if (products.error) throw products.error
  if (count(products.count) === null) throw new Error('Owned product count unavailable')
  return { checks: checks.slice(0, operationLimits.scan), runs: runs.slice(0, operationLimits.scan), canonicalProductCount: products.count as number,
    releaseEvidence: { checks: successfulChecks.slice(0, operationLimits.scan), runs: appliedRuns.slice(0, operationLimits.scan), attempt: attempts[0], pending: pending.slice(0, operationLimits.scan) },
    checksLimited: checks.length > operationLimits.scan || successfulChecks.length > operationLimits.scan,
    runsLimited: runs.length > operationLimits.scan || appliedRuns.length > operationLimits.scan || pending.length > operationLimits.scan }
}
export async function readFeedList(db: Database, offset = 0): Promise<FeedList> {
  const sources = await data(db.from('supplier_feed_sources').select(sourceColumns).order('source_key').order('id').range(offset, offset + operationLimits.feeds))
  const feeds: FeedSummary[] = []
  // Bound concurrency as well as payload size; no unbounded per-feed fan-out.
  for (let i = 0; i < Math.min(sources.length, operationLimits.feeds); i += 5) {
    feeds.push(...await Promise.all(sources.slice(i, Math.min(i + 5, operationLimits.feeds)).map(async source => {
      const e = await evidence(db, source)
      return aggregateFeed(source, e.checks, e.runs, e.canonicalProductCount, e.checksLimited || e.runsLimited, e.releaseEvidence)
    })))
  }
  return { feeds, offset, hasMore: sources.length > operationLimits.feeds }
}
export async function readFeedDetail(db: Database, feedId: string): Promise<FeedDetail> {
  const source = await sourceById(db, feedId)
  const e = await evidence(db, source)
  const realRuns = e.runs.filter(row => !isSynthetic(row))
  return {
    feed: aggregateFeed(source, e.checks, e.runs, e.canonicalProductCount, e.checksLimited || e.runsLimited, e.releaseEvidence),
    checks: e.checks.slice(0, operationLimits.checks).map(mapCheck), runs: realRuns.slice(0, operationLimits.runs).map(mapRun),
    checksLimited: e.checksLimited || e.checks.length > operationLimits.checks,
    runsLimited: e.runsLimited || realRuns.length > operationLimits.runs,
    syntheticChecks: e.checks.filter(isSynthetic).length, syntheticRuns: e.runs.length - realRuns.length,
  }
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 20).map(part => text(part) ?? '').filter(Boolean) : []
const issues = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 20).map(part =>
  typeof part === 'string' ? text(part)! : text(`${text(part?.code, 64) ?? 'issue'}: ${text(part?.message) ?? ''}`)!) : []
export function mapReviewRow(row: Row): ReviewRow {
  return {
    id: row.id, row_number: count(row.row_number), source_product_key: text(row.source_product_key), source_record_key: text(row.source_record_key),
    source_path: text(row.source_path), row_kind: text(row.row_kind), proposed_action: text(row.proposed_action), validation_status: text(row.validation_status),
    matched_product_id: text(row.matched_product_id), apply_state: text(row.apply_state), failure_code: text(row.failure_code),
    description: text(row.proposed_product?.fields?.supplierDescription), ordinaryChanges: strings(row.proposed_diff?.ordinaryChanges),
    lifecycleChanges: strings(row.proposed_diff?.lifecycleChanges), assetChanges: strings(row.proposed_diff?.assetChanges),
    costChange: typeof row.proposed_diff?.costChange === 'boolean' ? row.proposed_diff.costChange : null,
    changedFields: readReviewEvidence(row),
    errors: issues(row.validation_errors), warnings: issues(row.validation_warnings),
  }
}
export async function readRunDetail(db: Database, feedId: string, runId: string, offset = 0): Promise<RunDetail> {
  const source = await sourceById(db, feedId)
  const runs = await data(db.from('supplier_feed_runs').select(runColumns).eq('id', runId).eq('feed_source_id', feedId)
    .eq('supplier_id', source.supplier_id).eq('persistence_version', 2).limit(1))
  if (!runs[0] || isSynthetic(runs[0])) throw new OperationsNotFound('Operational run not found')
  const rows = await data(db.from('supplier_feed_rows').select(rowColumns).eq('feed_run_id', runId).eq('row_persistence_version', 2)
    .order('row_number', { nullsFirst: false }).order('id').range(offset, offset + operationLimits.rows))
  const control = await readRunControl(db, runs[0])
  return { run: mapRun(runs[0]), rows: rows.slice(0, operationLimits.rows).map(mapReviewRow), hasMore: rows.length > operationLimits.rows, offset, control }
}
