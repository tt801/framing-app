import { describe, expect, it } from 'vitest'
import { deriveRunControl } from '../server/platform/supplierFeeds/control.js'

export const operationalRun = {
  id: '22222222-2222-4222-8222-222222222222', supplier_id: '33333333-3333-4333-8333-333333333333',
  feed_source_id: '11111111-1111-4111-8111-111111111111', scope_key: 'mouldings', persistence_version: 2,
  status: 'awaiting_approval', mode: 'apply_requested', adapter_id: 'wessex-wpp4-mouldings', adapter_version: '2',
  planner_version: 'planner-1', logical_run_key: 'real-release', artifact_ref: '/artifact/WessexMouldings.xls',
  source_checksum: 'a'.repeat(64), plan_fingerprint: 'b'.repeat(64), policy_snapshot: {}, anomaly_flags: [],
  plan_counts: { create: 2, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 },
  row_count: 2, acquisition_complete: true, parsing_complete: true, staging_purged_at: null,
  apply_disposition: 'retryable', approved_by: null, approved_at: null, approved_plan_fingerprint: null, acknowledged_anomalies: null,
}
export const progress = { total: 2, pending: 2, applied: 0, skipped: 0, failed: 0, conflict: 0, version2: 2 }
export const approval = { approved_by: '44444444-4444-4444-8444-444444444444', approved_at: '2026-10-13T12:00:00Z', approved_plan_fingerprint: operationalRun.plan_fingerprint, acknowledged_anomalies: [] }

describe('persisted Block2E operator eligibility', () => {
  it.each([
    [{ mode: 'dry_run' }, 'dry_run'], [{ persistence_version: 1 }, 'unsupported_persistence_version'],
    [{ status: 'applied' }, 'already_applied'], [{ adapter_version: 'synthetic-1' }, 'synthetic_run'],
    [{ planner_version: 'synthetic-planner' }, 'synthetic_run'], [{ artifact_ref: 'https://verification.invalid/run' }, 'synthetic_run'],
    [{ acquisition_complete: false }, 'operational_evidence_missing'], [{ parsing_complete: false }, 'operational_evidence_missing'],
    [{ artifact_ref: null }, 'operational_evidence_missing'], [{ source_checksum: null }, 'operational_evidence_missing'],
    [{ plan_fingerprint: null }, 'plan_not_frozen'], [{ policy_snapshot: null }, 'plan_not_frozen'], [{ anomaly_flags: ['unknown'] }, 'plan_not_frozen'],
    [{ apply_disposition: 'replan_required' }, 'replan_required'], [{ staging_purged_at: '2026-10-13' }, 'staging_purged'],
    [{ row_count: 3 }, 'persisted_counts_mismatch'], [{ status: 'failed' }, 'unsupported_run_state'],
    [{ status: 'rejected' }, 'unsupported_run_state'], [{ status: 'planned' }, 'unsupported_run_state'],
    [{ approved_by: 'already' }, 'unsafe_approval_state'],
  ])('fails closed on persisted unsafe state %j', (overrides, code) => {
    expect(deriveRunControl({ ...operationalRun, ...overrides }, progress)).toMatchObject({ canApprove: false, canApply: false, canContinue: false, reasonCodes: [code] })
  })
  it.each([{ total: 3 }, { version2: 1 }, { pending: 1 }, { applied: 1 }])('fails closed on checkpoint inconsistency %j', overrides => {
    expect(deriveRunControl(operationalRun, { ...progress, ...overrides }).canApprove).toBe(false)
  })
  it('fails closed for linked synthetic / incomplete bounded evidence', () => {
    expect(deriveRunControl(operationalRun, progress, true).reasonCodes).toEqual(['synthetic_run'])
    expect(deriveRunControl(operationalRun, progress, false, true).reasonCodes).toEqual(['evidence_limit'])
  })
  it('preserves Block2E non-mutating review/reject outcomes and explicit anomaly acknowledgement', () => {
    const result = deriveRunControl({ ...operationalRun, anomaly_flags: ['creates'], plan_counts: { ...operationalRun.plan_counts, create: 0, review: 1, reject: 1 } }, progress)
    expect(result).toMatchObject({ state: 'Review required', canApprove: true, anomalies: ['creates'] })
    expect(result.description).toContain('non-mutating')
  })
  it.each(['approved', 'applying', 'partially_applied'])('derives %s eligibility only with valid approval', status => {
    expect(deriveRunControl({ ...operationalRun, ...approval, status }, progress)).toMatchObject({ canApprove: false, canApply: true, canContinue: status !== 'approved' })
    expect(deriveRunControl({ ...operationalRun, ...approval, status, approved_plan_fingerprint: 'c'.repeat(64) }, progress).reasonCodes).toEqual(['invalid_approval'])
  })
  it('surfaces retryable failures and terminal conflicts without fabricating a database state', () => {
    expect(deriveRunControl({ ...operationalRun, ...approval, status: 'partially_applied' }, { ...progress, pending: 1, failed: 1 }))
      .toMatchObject({ state: 'Failed / attention required', canContinue: true, reasonCodes: ['resume_available', 'retryable_row_failures'] })
    expect(deriveRunControl({ ...operationalRun, ...approval, status: 'partially_applied' }, { ...progress, pending: 1, conflict: 1 }))
      .toMatchObject({ canContinue: false, reasonCodes: ['replan_required'] })
  })
  it('allows a frozen operational plan to be approved, never applied before approval', () => {
    expect(deriveRunControl(operationalRun, progress)).toMatchObject({ state: 'Ready for approval', canApprove: true, canApply: false, reasonCodes: ['ready_for_approval'] })
  })
})
