import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { expect, it, vi } from 'vitest'
import { createSupabaseBlock2eStore, orchestrateFeedCheckAndPlan } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import { createInternationalAdapter, createWessexAdapter, registeredFeed } from '../server/platform/supplierFeeds/feedAdapters.js'
import { readRunControl } from '../server/platform/supplierFeeds/control.js'
import { install, localClient } from './helpers/block2eBatchFixture.js'
import { member, workbook, zip } from './helpers/internationalFixture.js'

it('uses the generic batched staging/freeze path while persisting non-actionable historical policy and price evidence', async () => {
  const db = new PGlite()
  const bytes = zip([[member, workbook()]])
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  try {
    await install(db)
    const supplierId = randomUUID(), feedSourceId = randomUUID()
    await db.query('INSERT INTO suppliers(id,name,slug) VALUES ($1,$2,$3)', [supplierId, 'LOCAL historical proof', supplierId])
    await db.query('INSERT INTO supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots) VALUES ($1,$2,$3,$4,false)', [feedSourceId, supplierId, 'international-moulding-historical', 'mouldings'])
    const client = localClient(db), adapter = createInternationalAdapter()
    const source = { supplierId, feedSourceId, scopeKey: 'mouldings', allowsAuthoritativeSnapshots: false }
    const result = await orchestrateFeedCheckAndPlan(createSupabaseBlock2eStore(() => client), { source, adapter, stagingBatchSize: 1 })
    expect(result.outcome).toBe('planned')
    if (result.outcome !== 'planned') throw new Error(JSON.stringify(result))
    expect(result.releaseLogicalKey).toMatch(/^international-moulding-historical:/)
    const run = (await db.query<any>('SELECT * FROM supplier_feed_runs WHERE id=$1', [result.runId])).rows[0]
    expect(run).toMatchObject({ mode: 'dry_run', status: 'planned', authoritative_snapshot: false, missing_inference_enabled: false, validation_safe_for_missing: false, approved_at: null })
    const rows = (await db.query<any>('SELECT * FROM supplier_feed_rows WHERE feed_run_id=$1', [result.runId])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].proposed_product).not.toHaveProperty('cost')
    expect(rows[0].proposed_product.runId).toBe(result.runId)
    expect(rows[0].proposed_diff.sourceEvidence).toMatchObject({ historical: true, selectedMember: member, prices: { Chop: { decimal: '4.44' } } })
    const control = await readRunControl(client, run)
    expect(control).toMatchObject({ canApprove: false, canApply: false })
    await expect(db.query("UPDATE supplier_feed_runs SET mode='apply_requested' WHERE id=$1", [result.runId])).rejects.toThrow()
    expect(client.calls).toContain('block2e_stage_rows')
    expect(client.calls).toContain('block2e_freeze_plan')
    expect(client.calls).not.toContain('block2e_approve_run')
    expect(client.calls).not.toContain('block2e_apply_row')
    expect((await db.query<any>('SELECT count(*)::int AS n FROM supplier_products')).rows[0].n).toBe(0)
    expect((await db.query<any>('SELECT count(*)::int AS n FROM supplier_product_cost_events')).rows[0].n).toBe(0)
    const store = createSupabaseBlock2eStore(() => client)
    await expect(orchestrateFeedCheckAndPlan(store, { source: { ...source, allowsAuthoritativeSnapshots: true }, adapter })).rejects.toThrow('Historical source policy')
    await db.query('UPDATE supplier_feed_sources SET allows_authoritative_snapshots=true WHERE id=$1', [feedSourceId])
    await expect(orchestrateFeedCheckAndPlan(store, { source, adapter })).rejects.toThrow('Persisted feed source policy mismatch')
    await db.query('UPDATE supplier_feed_sources SET allows_authoritative_snapshots=false WHERE id=$1', [feedSourceId])
    const replay = await orchestrateFeedCheckAndPlan(createSupabaseBlock2eStore(() => client), { source, adapter })
    expect(replay.outcome).toBe('unchanged')
  } finally { vi.unstubAllGlobals(); await db.close() }
}, 20000)

it.each(['mode', 'cost', 'missing', 'provenance'])('rejects an adapter violating historical %s policy before creating a run', async poison => {
  const actual = createInternationalAdapter(), bytes = zip([[member, workbook()]])
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  const store: any = { ensureFeedSource: vi.fn(), getLatestSuccessfulChecksum: vi.fn(async () => null),
    createRun: vi.fn(), recordSourceCheck: vi.fn(async () => 'check') }
  const adapter = { ...actual, acquire: async (input: any) => {
    const checked = await actual.acquire(input)
    if (poison === 'mode') checked.normalized.context.mode = 'apply_requested'
    if (poison === 'cost') checked.normalized.planningRows[0].result.value!.cost = { amount: '1', currency: 'USD', unit: 'foot', taxBasis: 'exclusive', effectiveAt: '2023-01-16T00:00:00Z' }
    if (poison === 'missing') checked.normalized.context.missingInferenceEnabled = true
    if (poison === 'provenance') checked.publishedUpdate.sourceUrl = 'https://www.wessexpictures.com/wessex_pricing_program_downloads.html'
    return checked
  } }
  try {
    const result = await orchestrateFeedCheckAndPlan(store, { source: { supplierId: 'supplier', feedSourceId: 'source', scopeKey: 'mouldings', allowsAuthoritativeSnapshots: false }, adapter })
    expect(result.outcome).toBe('check_error')
    expect(store.createRun).not.toHaveBeenCalled()
    expect(store.recordSourceCheck.mock.calls[0][0].sourceUrl).toContain('im-dropbox-sync')
    expect(JSON.stringify(store.recordSourceCheck.mock.calls)).not.toContain('wessex')
  } finally { vi.unstubAllGlobals() }
})

it('keeps International unregistered/live-disabled, and Wessex release identity unchanged', () => {
  expect(createWessexAdapter().mode).toBe('apply_requested')
  expect(registeredFeed('international-moulding-historical')).toBeNull()
  expect(registeredFeed('unknown')).toBeNull()
  expect(createWessexAdapter().releaseNamespace).toBe('wessex')
  expect(createInternationalAdapter()).toMatchObject({ mode: 'dry_run', allowsMissing: false, allowsAuthoritative: false, releaseNamespace: 'international-moulding-historical' })
})

it('persists International transport failures with its own provenance and no run', async () => {
  const store = { ensureFeedSource: vi.fn(), getLatestSuccessfulChecksum: vi.fn().mockResolvedValue(null),
    recordSourceCheck: vi.fn().mockResolvedValue('check') }
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('untrusted details')))
  try {
    const result = await orchestrateFeedCheckAndPlan(store as any, { source: {
      supplierId: 'supplier', feedSourceId: 'source', scopeKey: 'mouldings', allowsAuthoritativeSnapshots: false,
    }, adapter: createInternationalAdapter() })
    expect(result).toMatchObject({ outcome: 'check_error', status: 'fetch_error', errorCode: 'fetch_failed' })
    expect(store.recordSourceCheck.mock.calls[0][0]).toMatchObject({ feedRunId: null, releaseLogicalKey: null })
    expect(store.recordSourceCheck.mock.calls[0][0].sourceUrl).toContain('im-dropbox-sync')
    expect(JSON.stringify(store.recordSourceCheck.mock.calls)).not.toMatch(/wessex|untrusted details/i)
  } finally { vi.unstubAllGlobals() }
})
