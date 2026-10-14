import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createHash, randomUUID } from 'node:crypto'
import * as XLSX from '@e965/xlsx'
import { createSupabaseBlock2eStore, orchestrateWessexCheckAndPlan, planEntryToStagedRow } from '../server/platform/supplierFeeds/block2eOrchestrator'
import { planningFacade } from '../server/platform/supplier-feed-checks'
import { parseWessexMouldings } from '../server/platform/supplierFeeds/wessexMouldings'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization'
import { planFeed } from '../server/platform/supplierFeeds/planner'
import { isSynthetic } from '../server/platform/supplierFeeds/operations'
import { fixture, install, localClient, persisted } from './helpers/block2eBatchFixture'

let db: PGlite
beforeAll(async () => { db = new PGlite(); await install(db) })
afterAll(async () => { vi.unstubAllGlobals(); await db.close() })

function artifact(count: number) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Reference', 'Description', 'Price/mtr', 'Width'],
    ...Array.from({ length: count }, (_, i) => [`LOCAL-${String(i + 1).padStart(5, '0')}`, `Synthetic local moulding ${i + 1}`, 10 + i % 20, 20 + i % 30])]), 'gen')
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const parsed = parseWessexMouldings(bytes, { sourceUrl: 'https://www.wessexpictures.com/res/WessexMouldings.xls',
    originalFilename: 'WessexMouldings.xls', byteSize: bytes.length, sha256, retrievedAt: '2026-10-14T00:00:00Z', lastModified: 'Thu, 08 Oct 2026 15:21:52 GMT' })
  // Official URL/filename exist ONLY at the unchanged parser's local validation boundary.
  parsed.acquisition.sourceUrl = 'https://synthetic-local.invalid/phase5e.xls'
  parsed.acquisition.originalFilename = 'SYNTHETIC_LOCAL_NEVER_APPLY.xls'
  return parsed
}
async function newSource() {
  // Fixture creates a separate staged run; orchestrator gets a fresh checksum/key and creates its own run.
  const f = await fixture(db, 'wessex-wpp4-mouldings', '2')
  return { supplierId: f.supplier, feedSourceId: f.source, scopeKey: 'mouldings' }
}
function fetchCheck(raw: ReturnType<typeof artifact>, source: Awaited<ReturnType<typeof newSource>>) {
  return async () => ({ classification: 'changed' as const, hashChanged: true, previousSha256: null, latestSha256: raw.acquisition.sha256, artifact: raw,
    publishedUpdate: { sourceUrl: 'https://synthetic-local.invalid/simulated-date', retrievedAt: '2026-10-14T00:00:00Z', matchedText: 'SYNTHETIC simulated date 08/10/2026',
      publishedDatabaseUpdateDateRaw: '08/10/2026', publishedDatabaseUpdateDate: '08/10/2026', extractionRule: 'synthetic local test; no supplier claim' },
    normalized: normalizeWessexArtifact(raw, { supplierId: source.supplierId, sourceId: source.feedSourceId, scopeId: source.scopeKey,
      runId: randomUUID(), publishedDatabaseUpdateDate: '08/10/2026', acquisitionComplete: true, completeReleaseConfirmed: true }) })
}
const options = (source: Awaited<ReturnType<typeof newSource>>, raw: ReturnType<typeof artifact>) => ({ source, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: fetchCheck(raw, source) })

async function protectedSnapshot() {
  return JSON.stringify(await Promise.all(['supplier_products', 'supplier_product_aliases', 'supplier_product_cost_events'].map(table => db.query(`SELECT * FROM ${table} ORDER BY id`))))
}

describe('local real parser → normalizer → planner → batch SQL → freeze', () => {
  it('freezes 1194 rows using exactly 24 batch RPCs with persisted evidence and recomputed fingerprint', async () => {
    const unrelated = await fixture(db), product = randomUUID()
    await db.query(`INSERT INTO supplier_products(id,supplier_id,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis,cost_effective_at)
      VALUES ($1,$2,'frame','Unrelated local sentinel',5,'GBP','metre','exclusive','2026-10-01')`, [product, unrelated.supplier])
    await db.query(`INSERT INTO supplier_product_aliases(supplier_id,supplier_product_id,alias_kind,alias_value) VALUES ($1,$2,'source_key','LOCAL-SENTINEL')`, [unrelated.supplier, product])
    const before = await protectedSnapshot(), source = await newSource(), raw = artifact(1194), network = vi.fn(() => { throw new Error('Network forbidden') })
    vi.stubGlobal('fetch', network)
    const client = localClient(db), store = createSupabaseBlock2eStore(() => planningFacade(client, Date.now() + 240000))
    const result = await orchestrateWessexCheckAndPlan(store, options(source, raw))
    expect(result.outcome).toBe('planned'); if (result.outcome !== 'planned') throw new Error('Plan not frozen')
    const saved = await persisted(db, result.runId)
    expect(raw.rows).toHaveLength(1194); expect(saved).toHaveLength(1194)
    expect(client.calls.filter(name => name === 'block2e_stage_rows')).toHaveLength(24)
    expect(client.calls).not.toContain('block2e_stage_row')
    expect(client.calls.some(name => /approve|apply|finish_empty|block2d|claim|register/.test(name))).toBe(false)
    expect(saved.every(r => r.apply_state === 'pending' && r.row_persistence_version === 2 && r.proposed_action === 'create')).toBe(true)
    const normalized = normalizeWessexArtifact(raw, { supplierId: source.supplierId, runId: result.runId, sourceId: source.feedSourceId, scopeId: source.scopeKey,
      publishedDatabaseUpdateDate: '08/10/2026', acquisitionComplete: true, completeReleaseConfirmed: true })
    expect(normalized.candidates).toHaveLength(1194)
    const plan = planFeed({ context: { ...normalized.context, mode: 'apply_requested' }, rows: normalized.planningRows, existingProducts: [], aliases: [], massChangePolicy: {} })
    const expected = plan.entries.map(planEntryToStagedRow)
    expected.forEach(row => {
      const actual = saved.find(r => r.action_fingerprint === row.action_fingerprint)
      expect(actual).toMatchObject(row)
    })
    const run = (await db.query<any>('SELECT * FROM supplier_feed_runs WHERE id=$1', [result.runId])).rows[0]
    expect(run).toMatchObject({ persistence_version: 2, status: 'awaiting_approval', row_count: 1194, approved_by: null, approved_at: null,
      applied_by: null, plan_counts: { create: 1194, update: 0, unchanged: 0, reject: 0, review: 0, potential_missing: 0, cost_changes: 0 } })
    expect(isSynthetic(run)).toBe(true)
    const fingerprint = (await db.query<any>(`WITH evidence AS (SELECT jsonb_agg(jsonb_build_object(
      'row',r.id,'kind',r.row_kind,'sourceRow',r.row_number,'sourceRecord',r.source_record_key,'sourcePath',r.source_path,
      'action',r.proposed_action,'fingerprint',r.action_fingerprint,'item',r.item_fingerprint,'key',r.source_product_key,'keyOrigin',r.source_product_key_origin,
      'candidate',r.proposed_product,'validationStatus',r.validation_status,'diff',r.proposed_diff,'target',r.matched_product_id,
      'revision',r.expected_product_revision,'updatedAt',r.expected_product_updated_at,'errors',r.validation_errors,'warnings',r.validation_warnings)
      ORDER BY r.action_fingerprint) AS rows FROM supplier_feed_rows r WHERE feed_run_id=$1)
      SELECT encode(sha256(convert_to(jsonb_build_object('run',v.id,'supplier',v.supplier_id,'source',v.feed_source_id,'scope',v.scope_key,
      'adapter',v.adapter_id,'version',v.adapter_version,'planner',v.planner_version,'mode',v.mode,'coverage',v.coverage,'authoritative',v.authoritative_snapshot,
      'checksum',v.source_checksum,'emptyAcknowledged',v.allow_empty_snapshot_missing_inference,'counts',v.plan_counts,'policy',v.policy_snapshot,
      'flags',v.anomaly_flags,'rows',e.rows)::text,'UTF8')),'hex') AS fingerprint FROM supplier_feed_runs v CROSS JOIN evidence e WHERE v.id=$1`, [result.runId])).rows[0].fingerprint
    expect(fingerprint).toBe(result.planFingerprint); expect(await protectedSnapshot()).toBe(before); expect(network).not.toHaveBeenCalled()
    console.info('LOCAL_1194_RESULT', JSON.stringify({ accepted: normalized.candidates.length, staged: saved.length, batchRPCs: 24, status: run.status, counts: run.plan_counts, fingerprintVerified: true, protectedUnchanged: true }))
  })
  it('stops after response loss, retains committed batches, and later surfaces recovery-required without replay/replacement', async () => {
    const source = await newSource(), raw = artifact(12), client = localClient(db), rpc = client.rpc.bind(client)
    let submitted = 0
    client.rpc = (name, args) => {
      const request = rpc(name, args)
      if (name === 'block2e_stage_rows' && ++submitted === 9) return { abortSignal() { return this }, then: async (resolve: any) => {
        await request.then(() => undefined); resolve({ data: null, error: new Error('lost after commit') })
      } }
      return request
    }
    const store = createSupabaseBlock2eStore(() => planningFacade(client, Date.now() + 240000))
    await expect(orchestrateWessexCheckAndPlan(store, { ...options(source, raw), stagingBatchSize: 1 })).rejects.toThrow(/recovery required/)
    expect(submitted).toBe(9); expect(client.calls).not.toContain('block2e_freeze_plan'); expect(client.calls).not.toContain('block2e_record_source_check')
    const run = (await db.query<any>('SELECT * FROM supplier_feed_runs WHERE supplier_id=$1 AND source_checksum=$2', [source.supplierId, raw.acquisition.sha256])).rows[0]
    const rows = await persisted(db, run.id); expect(rows).toHaveLength(9)
    const before = JSON.stringify(rows), retry = localClient(db)
    await expect(orchestrateWessexCheckAndPlan(createSupabaseBlock2eStore(() => retry), options(source, raw))).rejects.toThrow(/recovery required/)
    expect(retry.calls).not.toContain('block2e_stage_rows'); expect(retry.calls).not.toContain('block2e_create_run')
    expect(JSON.stringify(await persisted(db, run.id))).toBe(before)
  })
  it('rejects invalid overrides before any read or write', async () => {
    const source = await newSource(), raw = artifact(1), client = localClient(db), store = createSupabaseBlock2eStore(() => client)
    await expect(orchestrateWessexCheckAndPlan(store, { ...options(source, raw), stagingBatchSize: 101 })).rejects.toThrow(/batch size/)
    expect(client.calls).toHaveLength(0)
  })
})
