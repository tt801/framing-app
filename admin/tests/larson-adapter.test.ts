import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, expect, it, vi } from 'vitest'
import { createLarsonJuhlAdapter, createInternationalAdapter, createWessexAdapter, checkingCapability, registeredFeed } from '../server/platform/supplierFeeds/feedAdapters.js'
import { createSupabaseBlock2eStore, orchestrateFeedCheckAndPlan } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import { readRunControl } from '../server/platform/supplierFeeds/control.js'
import { aggregateFeed } from '../server/platform/supplierFeeds/operations.js'
import { LARSON_SCOPE } from '../server/platform/supplierFeeds/larsonJuhlCatalogue.js'
import { larsonFixture } from './helpers/larsonFixture.js'
import { install, localClient } from './helpers/block2eBatchFixture.js'

afterEach(() => vi.unstubAllGlobals())
const stub = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(larsonFixture.toString(), { headers: { 'content-type': 'text/html' } })))

it('exposes a conservative internal adapter without registering a live identity or changing existing supplier capabilities', async () => {
  stub()
  const adapter = createLarsonJuhlAdapter()
  expect(adapter).toMatchObject({ id: 'larson-juhl-uk-public-catalogue', mode: 'dry_run', allowsAuthoritative: false, allowsMissing: false })
  const source = { supplierId: 'supplier', feedSourceId: 'source', scopeKey: LARSON_SCOPE, allowsAuthoritativeSnapshots: false }
  const release = await adapter.acquire({ source, previousSha256: null, timeoutMs: 1000, now: () => new Date() })
  expect(release.normalizeForRun('actual-run').context.runId).toBe('actual-run')
  expect(release.publishedUpdate.publishedDatabaseUpdateDate).toBeNull()
  expect(release.sourceEvidenceByRow?.size).toBe(6)
  await expect(adapter.acquire({ source: { ...source, allowsAuthoritativeSnapshots: true }, previousSha256: null, timeoutMs: 1000, now: () => new Date() })).rejects.toThrow()
  expect(registeredFeed('larson-juhl-uk-public-mouldings')).toBeNull()
  expect(checkingCapability({ id: 'source', supplier_id: 'supplier', source_key: 'larson-juhl-uk-public-mouldings', scope_key: LARSON_SCOPE, allows_authoritative_snapshots: false }))
    .toMatchObject({ canCheckNow: false, schedule: null })
  expect(createWessexAdapter()).toMatchObject({ mode: 'apply_requested', allowsAuthoritative: true, allowsMissing: true, releaseNamespace: 'wessex' })
  expect(createInternationalAdapter()).toMatchObject({ mode: 'dry_run', allowsAuthoritative: false, allowsMissing: false, releaseNamespace: 'international-moulding-historical' })
})

it('uses existing batched planning/freeze and Admin read models with absent publication/cost and review evidence in disposable SQL only', async () => {
  stub()
  const db = new PGlite()
  try {
    await install(db)
    const supplierId = randomUUID(), feedSourceId = randomUUID()
    await db.query('INSERT INTO suppliers(id,name,slug) VALUES ($1,$2,$3)', [supplierId, 'LOCAL Larson proof', supplierId])
    await db.query('INSERT INTO supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots) VALUES ($1,$2,$3,$4,false)',
      [feedSourceId, supplierId, 'larson-juhl-uk-public-mouldings', LARSON_SCOPE])
    const source = { supplierId, feedSourceId, scopeKey: LARSON_SCOPE, allowsAuthoritativeSnapshots: false }
    const client = localClient(db), adapter = createLarsonJuhlAdapter(), store = createSupabaseBlock2eStore(() => client)
    const result = await orchestrateFeedCheckAndPlan(store, { source, adapter, stagingBatchSize: 2 })
    expect(result.outcome).toBe('planned')
    if (result.outcome !== 'planned') throw new Error(JSON.stringify(result))
    expect(result.releaseLogicalKey).toMatch(/^larson-juhl-uk-public-catalogue:/)
    expect(result.planCounts).toMatchObject({ create: 4, review: 2, potential_missing: 0, cost_changes: 0 })
    const run = (await db.query<Record<string, unknown>>('SELECT * FROM supplier_feed_runs WHERE id=$1', [result.runId])).rows[0]
    expect(run).toMatchObject({ mode: 'dry_run', status: 'planned', authoritative_snapshot: false, validation_safe_for_missing: false, missing_inference_enabled: false })
    const check = (await db.query<Record<string, unknown>>('SELECT * FROM supplier_feed_source_checks WHERE id=$1', [result.checkId])).rows[0]
    expect(check).toMatchObject({ status: 'changed', published_update_date: null, published_update_date_raw: null })
    const rows = (await db.query<{ proposed_product: Record<string, unknown>; proposed_diff: Record<string, unknown>; proposed_action: string }>('SELECT * FROM supplier_feed_rows WHERE feed_run_id=$1', [result.runId])).rows
    expect(rows).toHaveLength(6)
    expect(rows.every(r => !('cost' in r.proposed_product))).toBe(true)
    expect(rows.every(r => r.proposed_diff.sourceEvidence)).toBe(true)
    expect(await readRunControl(client, run)).toMatchObject({ canApprove: false, canApply: false })
    const sourceRow = (await db.query<Record<string, unknown>>('SELECT * FROM supplier_feed_sources WHERE id=$1', [feedSourceId])).rows[0]
    const supplier = (await db.query<Record<string, unknown>>('SELECT * FROM suppliers WHERE id=$1', [supplierId])).rows[0]
    const feed = aggregateFeed({ ...sourceRow, supplier }, [check], [run], 0)
    expect(feed.checking).toMatchObject({ canCheckNow: false, schedule: null })
    expect(feed.overdue).toBe(false)
    expect(feed.latestCheck?.published_update_date).toBeNull()
    expect(client.calls.filter(n => n === 'block2e_stage_rows')).toHaveLength(3)
    expect(client.calls).toContain('block2e_freeze_plan')
    expect(client.calls).not.toContain('block2e_approve_run')
    expect(client.calls).not.toContain('block2e_apply_row')
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM supplier_products')).rows[0].n).toBe(0)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM supplier_product_cost_events')).rows[0].n).toBe(0)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM supplier_feed_execution_attempts')).rows[0].n).toBe(0)
    const replay = await orchestrateFeedCheckAndPlan(store, { source, adapter })
    expect(replay.outcome).toBe('unchanged')
    await expect(db.query("UPDATE supplier_feed_runs SET mode='apply_requested' WHERE id=$1", [result.runId])).rejects.toThrow()
  } finally { await db.close() }
}, 20000)
