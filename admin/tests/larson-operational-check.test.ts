import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PlatformDependencies } from '../server/platform/dependencies.js'
import { createCheckHandler, executeSupplierFeedCheck } from '../server/platform/supplier-feed-checks.js'
import type { FeedOrchestrationOptions, WessexOrchestrationResult } from '../server/platform/supplierFeeds/block2eOrchestrator.js'

const source = { id: '11111111-1111-4111-8111-111111111111', supplier_id: '22222222-2222-4222-8222-222222222222',
  source_key: 'larson-juhl-uk-public-mouldings', scope_key: 'uk-public-mouldings-category', allows_authoritative_snapshots: false,
  supplier: { id: '22222222-2222-4222-8222-222222222222', name: 'Larson-Juhl UK', slug: 'larson-juhl-uk', status: 'draft' } }
const env = { SUPPLIER_FEED_AUTOMATION_ENABLED: 'true', SUPPLIER_FEED_EXPECTED_PROJECT_REF: 'zminmylvmtyglkujxxyk', SUPABASE_URL: 'https://zminmylvmtyglkujxxyk.supabase.co' }
const sha = 'a'.repeat(64)
type Row = Record<string, unknown>
function fixture(persistedSource: Row | null = source) {
  const tables: Record<string, Row[]> = { supplier_feed_sources: persistedSource ? [persistedSource] : [], supplier_feed_runs: [],
    supplier_feed_source_checks: [], supplier_feed_execution_attempts: [] }
  const db = { from: vi.fn((table: string) => {
    let rows = tables[table] ?? [], single = false
    const query = { select: () => query, eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query },
      limit: () => query, single: () => { single = true; return query }, maybeSingle: () => { single = true; return query }, abortSignal: () => query,
      then: (resolve: (result: { data: unknown; count: number; error: null }) => unknown) =>
        Promise.resolve({ data: single ? rows[0] ?? null : rows, count: rows.length, error: null }).then(resolve) }
    return query
  }), rpc: vi.fn(async (name: string, args: Row) => {
    if (name === 'block2e_claim_feed_execution') {
      const attempt = { id: 'attempt', ownership_token: 'fixture-owner', completed_at: null, outcome: 'running' }
      tables.supplier_feed_execution_attempts.push(attempt)
      return { data: attempt, error: null }
    }
    if (name === 'block2e_finish_feed_execution') {
      Object.assign(tables.supplier_feed_execution_attempts[0], { outcome: args.p_outcome, completed_at: '2026-10-16', source_check_id: args.p_check_id, feed_run_id: args.p_run_id })
      return { data: null, error: null }
    }
    throw new Error('Unexpected RPC in local test')
  }) }
  const orchestrate = vi.fn(async (_store: unknown, options: FeedOrchestrationOptions): Promise<WessexOrchestrationResult> => {
    expect(options.adapter).toMatchObject({ id: 'larson-juhl-uk-public-catalogue', mode: 'dry_run', allowsAuthoritative: false, allowsMissing: false })
    expect(options.source).toMatchObject({ supplierId: source.supplier_id, feedSourceId: source.id, allowsAuthoritativeSnapshots: false })
    tables.supplier_feed_runs.push({ id: 'run', supplier_id: source.supplier_id, feed_source_id: source.id, scope_key: source.scope_key,
      status: 'planned', mode: 'dry_run', persistence_version: 2, row_count: 0, source_checksum: sha, plan_fingerprint: sha,
      authoritative_snapshot: false, validation_safe_for_missing: false, missing_inference_enabled: false, plan_counts: { cost_changes: 0 } })
    tables.supplier_feed_source_checks.push({ id: 'check', feed_source_id: source.id, status: 'changed', feed_run_id: 'run', plan_fingerprint: sha })
    return { outcome: 'planned', checkId: 'check', runId: 'run', previousSha256: null, latestSha256: sha,
      releaseLogicalKey: `larson-juhl-uk-public-catalogue:${source.id}:${sha}`, planFingerprint: sha, runStatus: 'planned', planCounts: {}, reusedExistingRun: false }
  })
  return { db, tables, orchestrate }
}
beforeEach(() => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network allowed in registry tests') }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('binds persisted identity before claiming an attempt and recognises a planning-only dry run as success', async () => {
  const f = fixture()
  const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: f.orchestrate }, 'manual', source.id)
  expect(out).toMatchObject({ outcome: 'planned', runStatus: 'planned' })
  expect(f.db.from.mock.invocationCallOrder[0]).toBeLessThan(f.db.rpc.mock.invocationCallOrder[0])
  expect(f.db.rpc.mock.calls.map(call => call[0])).toEqual(['block2e_claim_feed_execution', 'block2e_finish_feed_execution'])
  expect(fetch).not.toHaveBeenCalled()
})

it.each([null, { ...source, source_key: 'international-moulding-historical' }, { ...source, allows_authoritative_snapshots: true }])('rejects absent/mismatched persisted sources without writes', async persisted => {
  const f = fixture(persisted)
  await expect(executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: f.orchestrate }, 'manual', source.id)).rejects.toThrow('unsupported_feed')
  expect(f.db.rpc).not.toHaveBeenCalled()
  expect(f.orchestrate).not.toHaveBeenCalled()
})

it('rejects scheduled Larson execution before claims or acquisition', async () => {
  const f = fixture()
  await expect(executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: f.orchestrate }, 'scheduled', source.id)).rejects.toThrow('unsupported_feed')
  expect(f.db.rpc).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['mode', 'authoritative_snapshot', 'validation_safe_for_missing', 'missing_inference_enabled', 'cost_changes'])('rejects an inconsistent persisted dry-run %s policy', async field => {
  const f = fixture(), original = f.orchestrate.getMockImplementation()!
  f.orchestrate.mockImplementation(async (...args) => {
    const result = await original(...args)
    const run = f.tables.supplier_feed_runs[0]
    if (field === 'mode') run.mode = 'apply_requested'
    else if (field === 'cost_changes') run.plan_counts = { cost_changes: 1 }
    else run[field] = true
    return result
  })
  expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: f.orchestrate }, 'manual', source.id)).outcome).toBe('failed')
})

it('lets a valid manual feed UUID reach persisted identity verification, never a caller-supplied URL or adapter', async () => {
  const f = fixture(), getSupabaseAdmin = vi.fn(() => f.db)
  // Claim denial stops this HTTP input test before orchestration/acquisition.
  f.db.rpc.mockResolvedValueOnce({ data: null, error: null })
  const req = { method: 'POST', headers: { authorization: 'Bearer fixture-session', host: 'admin.test', origin: 'https://admin.test', 'content-type': 'application/json' }, query: {}, body: { feedId: source.id } } as unknown as VercelRequest
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() }
  const deps = { getSupabaseAdmin, requirePlatformAdmin: vi.fn(async () => ({})) } as unknown as PlatformDependencies
  await createCheckHandler(deps, 'manual')(req, res as unknown as VercelResponse)
  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'already_running' }))
  expect(f.db.rpc).toHaveBeenCalledExactlyOnceWith('block2e_claim_feed_execution', { p_source_id: source.id, p_trigger: 'manual' })
  expect(fetch).not.toHaveBeenCalled()
})
