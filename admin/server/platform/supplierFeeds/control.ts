import type { ApplyProgress, RunControl } from '../../../src/lib/supplierFeedTypes.js'
import { isSynthetic } from './operations.js'

type Run = Record<string, any>
const countKeys = ['create', 'update', 'unchanged', 'review', 'reject', 'potential_missing', 'cost_changes'] as const
const digest = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const object = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v)
const flags = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => ['creates', 'updates', 'costChanges', 'potentialMissing'].includes(x)) && new Set(v).size === v.length

// Operator labels are projections, not additional database states. The RPCs
// remain the final atomic transition/identity/revision gate.
export function deriveRunControl(run: Run, progress: ApplyProgress, linkedSynthetic = false, evidenceLimited = false): RunControl {
  const synthetic = isSynthetic(run) || linkedSynthetic
  const result: RunControl = {
    state: 'Not eligible', canApprove: false, canApply: false, canContinue: false, synthetic,
    reasonCodes: [], description: '', anomalies: flags(run.anomaly_flags) ? run.anomaly_flags : [], progress,
    approvedBy: text(run.approved_by) ? run.approved_by : null, approvedAt: text(run.approved_at) ? run.approved_at : null,
    applyDisposition: text(run.apply_disposition) ? run.apply_disposition : null,
  }
  const stop = (code: string, description: string, state: RunControl['state'] = 'Not eligible') => ({ ...result, state, reasonCodes: [code], description })
  if (synthetic) return stop('synthetic_run', 'Synthetic verification runs cannot be approved or applied.')
  if (run.status === 'applied') return stop('already_applied', 'Applied; no further mutation is permitted.', 'Applied')
  if (run.persistence_version !== 2) return stop('unsupported_persistence_version', 'Only Block2E version-2 operational runs are supported.')
  if (run.mode !== 'apply_requested') return stop('dry_run', 'Dry-run plans cannot be approved or applied.')
  if (evidenceLimited) return stop('evidence_limit', 'Linked check evidence exceeds the bounded safety scan; attention required.')
  if (![run.feed_source_id, run.supplier_id, run.scope_key, run.logical_run_key, run.adapter_id, run.adapter_version, run.planner_version, run.artifact_ref].every(text)
    || !digest(run.source_checksum) || run.acquisition_complete !== true || run.parsing_complete !== true)
    return stop('operational_evidence_missing', 'Complete operational acquisition, parsing and artifact identity are required.')
  if (run.apply_disposition !== 'retryable' || progress.conflict > 0)
    return stop('replan_required', 'Conflict/stale evidence is retained. This plan cannot continue; no automatic replan or approval.', 'Failed / attention required')
  if (run.staging_purged_at) return stop('staging_purged', 'The persisted staging payload has been purged.')
  if (!digest(run.plan_fingerprint) || !object(run.plan_counts) || !object(run.policy_snapshot) || !flags(run.anomaly_flags))
    return stop('plan_not_frozen', 'Review required: no complete frozen Block2E plan is available.', 'Review required')
  if (!countKeys.every(k => Number.isSafeInteger(run.plan_counts[k]) && run.plan_counts[k] >= 0)
    || countKeys.filter(k => k !== 'cost_changes').reduce((n, k) => n + run.plan_counts[k], 0) !== run.row_count
    || run.plan_counts.cost_changes > run.plan_counts.update || progress.total !== run.row_count || progress.version2 !== progress.total
    || Object.entries(progress).filter(([k]) => !['total', 'version2'].includes(k)).reduce((n, [, v]) => n + v, 0) !== progress.total)
    return stop('persisted_counts_mismatch', 'Persisted plan / row checkpoints are inconsistent; attention required.', 'Failed / attention required')
  if (run.status === 'awaiting_approval') {
    if (progress.pending !== progress.total || run.approved_by || run.approved_at || run.approved_plan_fingerprint)
      return stop('unsafe_approval_state', 'The run is not an untouched unapproved frozen plan.')
    result.canApprove = true
    result.state = run.plan_counts.review || run.plan_counts.reject || result.anomalies.length ? 'Review required' : 'Ready for approval'
    result.reasonCodes = ['ready_for_approval']
    result.description = 'Review the persisted plan. Approval acknowledges displayed anomalies but does not apply canonical changes. Review, Reject and Potential Missing rows are non-mutating Block2E outcomes.'
    return result
  }
  if (!['approved', 'applying', 'partially_applied'].includes(run.status)) return stop('unsupported_run_state', `Run state ${run.status} cannot be approved or applied.`)
  if (!text(run.approved_by) || !text(run.approved_at) || run.approved_plan_fingerprint !== run.plan_fingerprint
    || !flags(run.acknowledged_anomalies) || [...run.acknowledged_anomalies].sort().join(',') !== [...run.anomaly_flags].sort().join(','))
    return stop('invalid_approval', 'Existing approval identity, fingerprint or anomaly acknowledgement is invalid.')
  if (progress.total === 0 && run.status !== 'approved') return stop('inconsistent_empty_run', 'Only an approved empty run can be finished.')
  if (progress.total > 0 && progress.pending + progress.failed === 0) return stop('no_resumable_rows', 'No pending or retryable failed rows remain; inspect the run checkpoint.')
  result.canApply = true
  result.canContinue = run.status !== 'approved'
  result.state = progress.failed > 0 ? 'Failed / attention required' : run.status === 'approved' ? 'Approved — ready to apply' : run.status === 'applying' ? 'Applying' : 'Partially applied'
  result.reasonCodes = [result.canContinue ? 'resume_available' : 'ready_to_apply', ...(progress.failed ? ['retryable_row_failures'] : [])]
  result.description = progress.failed ? 'Retryable row failures are retained. Continue only after reviewing the failure evidence; Block2E will recheck each row.' : 'Apply in bounded requests. Durable row checkpoints allow continuation; each row commits separately.'
  return result
}

export async function readRunControl(db: { from: (table: string) => any }, run: Run): Promise<RunControl> {
  const countRows = async (state?: string, version?: number): Promise<number> => {
    let query = db.from('supplier_feed_rows').select('id', { head: true, count: 'exact' }).eq('feed_run_id', run.id)
    if (state) query = query.eq('apply_state', state)
    if (version) query = query.eq('row_persistence_version', version)
    const { count, error } = await query
    if (error) throw error
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Checkpoint count unavailable')
    return count
  }
  const [total, version2, pending, applied, skipped, failed, conflict, checks] = await Promise.all([
    countRows(), countRows(undefined, 2), ...['pending', 'applied', 'skipped', 'failed', 'conflict'].map(s => countRows(s)),
    db.from('supplier_feed_source_checks').select('source_url,published_update_source_url,published_update_date_raw,release_logical_key,error_code')
      .eq('feed_run_id', run.id).limit(201),
  ])
  if (checks.error) throw checks.error
  return deriveRunControl(run, { total, version2, pending, applied, skipped, failed, conflict }, (checks.data ?? []).some(isSynthetic), (checks.data ?? []).length > 200)
}
