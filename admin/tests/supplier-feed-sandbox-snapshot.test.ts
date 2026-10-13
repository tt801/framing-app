import { describe, expect, it } from 'vitest'
import { deriveRunControl } from '../server/platform/supplierFeeds/control.js'
import { aggregateFeed, isSynthetic, mapRun } from '../server/platform/supplierFeeds/operations.js'

// Read-only Sandbox snapshot (Phase 5D verification). No client/credentials or
// mutation is used here. Counts/status/identity were read via Sandbox MCP.
const supplierId = '1312e794-ec94-4bf0-aa3a-9ffc35b4428d'
const feedId = '468247ee-809b-4784-aca1-bba44f860c85'
const real = {
  id: '5e1d7166-f986-4d07-99f9-8fc96609b86a', supplier_id: supplierId, feed_source_id: feedId, scope_key: 'mouldings',
  persistence_version: 2, status: 'applied', mode: 'apply_requested', adapter_id: 'wessex-wpp4-mouldings', adapter_version: '2',
  planner_version: 'planner-1', logical_run_key: 'wessex-phase4b-first-real-20261012',
  source_checksum: 'f96d393af1847d30929b8be8a2e165404a48ed6c3e93f7bcc6c2b0fd0d0f7e80',
  artifact_ref: '/opt/data/cache/scratch/wessex-block2f/WessexMouldings.xls',
  plan_fingerprint: '921139c389a8fa81063245328d5c22bc1ff6a48174a99b33f3fb1900d64f7adb',
  plan_counts: { create: 1194, reject: 0, review: 0, update: 0, unchanged: 0, cost_changes: 0, potential_missing: 0 },
  row_count: 1194, completed_at: '2026-10-12T17:24:12.956222+00:00',
}
const synthetic = {
  id: '0052d91f-19ae-4077-8c39-34a0f709dfac', supplier_id: supplierId, feed_source_id: feedId, scope_key: 'mouldings',
  persistence_version: 2, status: 'queued', mode: 'dry_run', adapter_id: 'phase5b-synthetic-verification',
  adapter_version: 'phase5b-synthetic-1', planner_version: 'phase5b-synthetic-unexecuted',
  logical_run_key: 'wessex:468247ee-809b-4784-aca1-bba44f860c85:3bfbb5c7228eefe1a419ff0d1617c20c21fbaad096da382ecb783830bc1aea6f',
  source_checksum: '3bfbb5c7228eefe1a419ff0d1617c20c21fbaad096da382ecb783830bc1aea6f',
  artifact_ref: 'https://phase5b-verification.invalid/synthetic-release-idempotency',
  plan_fingerprint: null, plan_counts: null, row_count: 0, completed_at: null,
}
const empty = { total: 0, version2: 0, applied: 0, pending: 0, skipped: 0, failed: 0, conflict: 0 }
describe('read-only Sandbox snapshot recognises applied and synthetic runs', () => {
  it('retains Phase 5C real applied-import evidence and excludes the queued synthetic run', () => {
    const source = { id: feedId, supplier_id: supplierId, source_key: 'wessex-mouldings-xls', scope_key: 'mouldings', supplier: { id: supplierId, name: 'Wessex', status: 'draft' } }
    const feed = aggregateFeed(source, [], [synthetic, real], 1194)
    expect(isSynthetic(real)).toBe(false)
    expect(feed.latestRun?.id).toBe(real.id)
    expect(feed.latestRelease).toMatchObject({ sha256: real.source_checksum, origin: 'applied_import' })
    expect(mapRun(real)).toMatchObject({ status: 'applied', appliedAt: real.completed_at, counts: { create: 1194 } })
    expect(feed.canonicalProductCount).toBe(1194)
  })
  it('makes the applied Wessex run and zero-row Phase 5B synthetic run non-actionable', () => {
    expect(deriveRunControl(real, { ...empty, total: 1194, version2: 1194, applied: 1194 })).toMatchObject({ state: 'Applied', canApprove: false, canApply: false, canContinue: false, reasonCodes: ['already_applied'] })
    expect(deriveRunControl(synthetic, empty)).toMatchObject({ synthetic: true, canApprove: false, canApply: false, canContinue: false, reasonCodes: ['synthetic_run'] })
  })
})
