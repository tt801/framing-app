import { describe, expect, it, vi } from 'vitest'
import { wessexFeedSource } from '../server/platform/supplierFeeds/feedAdapters.js'
import { aggregateFeed, isSynthetic, mapCheck, mapReviewRow } from '../server/platform/supplierFeeds/operations.js'

const source = { id: '11111111-1111-4111-8111-111111111111', supplier_id: '22222222-2222-4222-8222-222222222222', source_key: 'wessex-mouldings-xls', scope_key: 'mouldings', allows_authoritative_snapshots: true, supplier: { id: '22222222-2222-4222-8222-222222222222', name: 'Wessex', status: 'draft' } }
const check = { id: 'check', checked_at: '2026-10-13T10:00:00Z', created_at: '2026-10-13T10:00:00Z', status: 'unchanged', release_classification: 'unchanged', sha256: 'a'.repeat(64), source_url: 'https://supplier.com/feed.xls', published_update_source_url: 'https://supplier.com/downloads', published_update_date: '08/10/2026' }
const run = { id: 'real', status: 'applied', created_at: '2026-10-12T10:00:00Z', completed_at: '2026-10-12T11:00:00Z', mode: 'apply_requested', source_checksum: 'a'.repeat(64), plan_fingerprint: 'b'.repeat(64), plan_counts: { create: 1194, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 }, adapter_id: 'wessex-wpp4-mouldings', artifact_ref: '/scratch/Wessex.xls' }

describe('supplier feed operations aggregation', () => {
  it('derives checking capability from registered source identity and environment; historical/non-authoritative sources stay manual-only', () => {
    vi.stubEnv('SUPPLIER_FEED_AUTOMATION_ENABLED', 'true')
    vi.stubEnv('SUPPLIER_FEED_EXPECTED_PROJECT_REF', 'zminmylvmtyglkujxxyk')
    vi.stubEnv('SUPABASE_URL', 'https://zminmylvmtyglkujxxyk.supabase.co')
    const registered = { ...source, id: wessexFeedSource.feedSourceId, supplier_id: wessexFeedSource.supplierId }
    try {
      expect(aggregateFeed(registered, [], [], 0).checking).toMatchObject({ canCheckNow: true, schedule: null })
      expect(aggregateFeed({ ...registered, allows_authoritative_snapshots: false }, [], [], 0).checking.canCheckNow).toBe(false)
      expect(aggregateFeed({ ...source, source_key: 'international-moulding-historical', allows_authoritative_snapshots: false }, [], [], 0)).toMatchObject({ checking: { canCheckNow: false, schedule: null }, overdue: false })
      expect(aggregateFeed({ ...registered, supplier_id: 'other-supplier' }, [], [], 0).checking.canCheckNow).toBe(false)
      vi.stubEnv('SUPPLIER_FEED_AUTOMATION_ENABLED', 'false')
      expect(aggregateFeed(registered, [], [], 0).checking.canCheckNow).toBe(false)
    } finally { vi.unstubAllEnvs() }
  })
  it.each([
    ['running', '2100-01-01', 'running'], ['running', '2020-01-01', 'interrupted'],
    ['planned', '2100-01-01', 'completed'], ['failed', '2100-01-01', 'failed'], ['interrupted', '2020-01-01', 'interrupted'],
  ])('exposes operational %s attempts as %s', (outcome, expires_at, state) => {
    const current = { ...check, status: 'unchanged', checked_at: new Date().toISOString() }
    const summary = aggregateFeed(source, [current], [], 0, false, { checks: [current], runs: [], attempt: { id: 'attempt', trigger_type: 'manual', outcome, expires_at } })
    expect(summary.latestAttempt?.state).toBe(state)
    expect(summary.overdue).toBe(false)
    expect(summary.lastSuccessfulCheckAt).toBe(current.checked_at)
  })
  it('retains older pending human approval after a later unchanged check', () => {
    const pending = { ...run, id: 'pending', status: 'awaiting_approval' }
    const unchanged = { ...check, status: 'unchanged' }
    const summary = aggregateFeed(source, [unchanged], [], 0, false, { checks: [unchanged], runs: [], pending: [pending] })
    expect(summary.pendingApprovalRunId).toBe('pending')
    expect(summary.health).toBe('Changed — review required')
  })
  it('does not require new review for changed evidence whose linked run is applied', () => {
    const result = aggregateFeed(source, [{ ...check, status: 'changed', feed_run_id: run.id }], [run], 1194)
    expect(result.health).toBe('Healthy')
    expect(result.lastSuccessfulCheckAt).toBe(check.checked_at)
  })
  it('retains pending approval independently of the latest unchanged artifact', () => {
    const result = aggregateFeed(source, [check], [run, { ...run, id: 'pending', status: 'awaiting_approval', source_checksum: 'e'.repeat(64) }], 1194)
    expect(result.pendingApprovalRunId).toBe('pending')
    expect(result.health).toBe('Changed — review required')
  })
  it('combines persisted feed, check, release, real run and exact owned count', () => {
    const result = aggregateFeed(source, [check], [run], 1194)
    expect(result).toMatchObject({ id: source.id, supplier: { name: 'Wessex', status: 'draft' }, scope_key: 'mouldings', canonicalProductCount: 1194, health: 'Healthy', latestCheck: { status: 'unchanged' }, latestRelease: { sha256: check.sha256, classification: 'unchanged', publishedUpdateDate: '08/10/2026' }, latestRun: { id: 'real', status: 'applied', counts: { create: 1194 } } })
  })
  it.each([
    ['changed', 'Changed — review required'], ['fetch_error', 'Check failed'],
    ['evidence_error', 'Check failed'], ['validation_error', 'Check failed'], ['planning_error', 'Planning failed'],
  ])('derives %s health without hiding the last successful release', (status, health) => {
    const result = aggregateFeed(source, [{ ...check, status, sha256: null }, check], [run], 1194)
    expect(result.health).toBe(health)
    expect(result.latestRelease?.sha256).toBe(check.sha256)
  })
  it('has an honest no-check state while retaining applied-import checksum provenance', () => {
    const result = aggregateFeed(source, [], [run], 1194)
    expect(result.health).toBe('Never checked')
    expect(result.latestCheck).toBeNull()
    expect(result.latestRelease).toMatchObject({ origin: 'applied_import', classification: null })
  })
  it('does not call an unchanged artifact healthy while its persisted plan awaits review', () => {
    expect(aggregateFeed(source, [check], [{ ...run, status: 'awaiting_approval' }], 1194).health).toBe('Changed — review required')
  })
  it('excludes unambiguously synthetic checks and runs from operational summaries', () => {
    const syntheticCheck = { ...check, id: 'synthetic', status: 'changed', source_url: 'https://phase5b-verification.invalid/artifact' }
    const syntheticRun = { ...run, id: 'synthetic', adapter_id: 'phase5b-synthetic-verification' }
    const result = aggregateFeed(source, [syntheticCheck, check], [syntheticRun, run], 1194)
    expect(result.latestCheck?.id).toBe('check')
    expect(result.latestRun?.id).toBe('real')
  })
  it('does not infer synthetic data from dry-run mode or zero rows alone', () => {
    expect(aggregateFeed(source, [], [{ ...run, mode: 'dry_run', row_count: 0 }], 0).latestRun?.id).toBe('real')
  })
  it('reports unknown instead of never checked when bounded history may hide real evidence', () => {
    expect(aggregateFeed(source, [], [], 0, true).health).toBe('Unknown — history limit')
  })
  it('preserves missing plan counts as unknown, not an invented zero plan', () => {
    expect(aggregateFeed(source, [], [{ ...run, plan_counts: null }], 0).latestRun?.counts.create).toBeNull()
  })
  it('selects the latest successful check behind newer failures, not merely the first check', () => {
    const newerSuccess = { ...check, id: 'new-success', sha256: 'c'.repeat(64) }
    expect(aggregateFeed(source, [{ ...check, status: 'planning_error', sha256: 'd'.repeat(64) }, newerSuccess, check], [run], 0).latestRelease?.sha256).toBe(newerSuccess.sha256)
  })
  it.each([
    { published_update_source_url: 'https://phase5b-verification.invalid/evidence' },
    { release_logical_key: 'phase5b-synthetic-check-history:feed:sha' },
    { error_code: 'PHASE5B_SYNTHETIC_FETCH_ERROR' },
    { published_update_date_raw: 'SYNTHETIC PHASE 5B VERIFICATION — NOT WESSEX EVIDENCE' },
    { linked_run: { adapter_id: 'phase5b-synthetic-verification' } },
  ])('uses explicit persisted synthetic evidence %j', marker => {
    expect(isSynthetic(marker)).toBe(true)
    expect(mapCheck({ ...check, ...marker }).synthetic).toBe(true)
  })
  it('never uses synthetic successful artifacts or real-looking release keys in summaries', () => {
    const result = aggregateFeed(source, [{ ...check, source_url: 'https://verification.invalid/a' }], [{ ...run, artifact_ref: 'https://verification.invalid/a', logical_run_key: `wessex:${source.id}:${run.source_checksum}` }], 1194)
    expect(result.latestRelease).toBeNull()
    expect(result.latestRun).toBeNull()
    expect(result.health).toBe('Never checked')
  })
  it('does not let an old failed or rejected attempt override a newer applied release', () => {
    expect(aggregateFeed(source, [check], [run, { ...run, status: 'rejected' }], 1194).health).toBe('Healthy')
  })
  it('surfaces a newer failed planning run even if the most recent check was unchanged', () => {
    expect(aggregateFeed(source, [check], [{ ...run, status: 'failed', created_at: '2026-10-14T10:00:00Z' }], 1194).health).toBe('Planning failed')
  })
  it('does not hide a new different artifact awaiting approval behind an older unchanged check', () => {
    expect(aggregateFeed(source, [check], [{ ...run, status: 'awaiting_approval', created_at: '2026-10-14T10:00:00Z', source_checksum: 'd'.repeat(64) }], 1194).health).toBe('Changed — review required')
  })
  it('caps hostile review data and omits raw records, arbitrary candidate objects and asset URLs', () => {
    const row = mapReviewRow({ id: 'row', proposed_product: { fields: { supplierDescription: 'x'.repeat(1000) }, asset: { sourceUrl: 'do-not-return' } }, proposed_diff: { ordinaryChanges: Array(100).fill('x'.repeat(1000)), costChange: 'true' }, validation_errors: Array(100).fill({ code: 'bad', message: 'x'.repeat(1000) }), raw_record: { hidden: true } })
    expect(row.errors).toHaveLength(20)
    expect(row.errors.every(issue => issue.length <= 512)).toBe(true)
    expect(row.ordinaryChanges).toHaveLength(20)
    expect(row.description).toHaveLength(512)
    expect(row.costChange).toBeNull()
    expect(JSON.stringify(row)).not.toContain('do-not-return')
    expect(JSON.stringify(row)).not.toContain('hidden')
  })
})
