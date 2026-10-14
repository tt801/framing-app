import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkExecutionEnvironment, createCheckHandler, executeSupplierFeedCheck, executionLimits, planningFacade, wessexSource } from '../server/platform/supplier-feed-checks.js'
import type { WessexOrchestrationResult } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
const project = 'zminmylvmtyglkujxxyk'
const env = { SUPABASE_URL: `https://${project}.supabase.co`, SUPPLIER_FEED_EXPECTED_PROJECT_REF: project, SUPPLIER_FEED_AUTOMATION_ENABLED: 'true' }
const checkId = 'check', runId = 'run', fingerprint = 'a'.repeat(64)
function database() {
  const attempts: any[] = []
  const checks: any[] = []
  const runs: any[] = []
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'block2e_claim_feed_execution') {
      if (attempts.some(a => a.outcome === 'running')) return { data: null, error: null }
      const a = { id: `attempt-${attempts.length}`, ownership_token: 'private-owner', outcome: 'running', completed_at: null }
      attempts.push(a); return { data: a, error: null }
    }
    if (name === 'block2e_finish_feed_execution') {
      Object.assign(attempts.find(a => a.id === args.p_attempt_id), { outcome: args.p_outcome, completed_at: '2026-10-14', source_check_id: args.p_check_id, feed_run_id: args.p_run_id })
      return { data: null, error: null }
    }
    throw new Error('forbidden RPC')
  })
  const db = { rpc, from: vi.fn((table: string) => {
    let data = table === 'supplier_feed_execution_attempts' ? attempts : table === 'supplier_feed_source_checks' ? checks : table === 'supplier_feed_runs' ? runs : [], single = false, head = false
    const q: any = { select: (_: any, opts: any) => { head = opts?.head; return q }, eq: (key: string, value: any) => { data = data.filter(a => a[key] === value); return q }, limit: () => q, single: () => { single = true; return q }, abortSignal: () => q,
      then: (resolve: any) => resolve({ data: single ? data[0] : head ? null : data, count: data.length, error: null }) }
    return q
  }) }
  return { db, attempts, checks, runs }
}
function result(fixture: ReturnType<typeof database>, changed = false): WessexOrchestrationResult {
  fixture.checks.push({ id: checkId, feed_source_id: wessexSource.feedSourceId, status: changed ? 'changed' : 'unchanged', feed_run_id: changed ? runId : null, plan_fingerprint: changed ? fingerprint : null })
  if (changed) fixture.runs.push({ id: runId, ...Object.fromEntries(Object.entries({ supplier_id: wessexSource.supplierId, feed_source_id: wessexSource.feedSourceId, scope_key: 'mouldings' })), status: 'awaiting_approval', persistence_version: 2, row_count: 0, source_checksum: fingerprint, plan_fingerprint: fingerprint, approved_at: null })
  return changed ? { outcome: 'planned', checkId, runId, previousSha256: null, latestSha256: fingerprint, releaseLogicalKey: 'wessex:source:sha', planFingerprint: fingerprint, runStatus: 'awaiting_approval', planCounts: {}, reusedExistingRun: false }
    : { outcome: 'unchanged', checkId, previousSha256: fingerprint, latestSha256: fingerprint, releaseLogicalKey: null }
}
afterEach(() => vi.unstubAllEnvs())
describe('shared planning-only execution service', () => {

  it('reads back successful terminal attempt and check; never returns ownership token', async () => {
    const f = database()
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => result(f) }, 'scheduled')
    expect(out).toMatchObject({ outcome: 'unchanged', checkId })
    expect(out).not.toHaveProperty('runStatus')
    expect(JSON.stringify(out)).not.toContain('private-owner')
    expect(f.attempts[0].outcome).toBe('unchanged')
  })
  it('permits exactly one concurrent execution; duplicate completed check is safe', async () => {
    const f = database(), orchestrate = vi.fn(async () => result(f))
    const deps = { getSupabaseAdmin: () => f.db, env, orchestrate }
    const outputs = await Promise.all([executeSupplierFeedCheck(deps, 'manual'), executeSupplierFeedCheck(deps, 'scheduled')])
    expect(outputs.map(o => o.outcome).sort()).toEqual(['already_running', 'unchanged'])
    expect(orchestrate).toHaveBeenCalledTimes(1)
    expect((await executeSupplierFeedCheck(deps, 'manual')).outcome).toBe('unchanged')
  })
  it('verifies a changed plan without approving or applying', async () => {
    const f = database()
    expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => result(f, true) }, 'manual')).outcome).toBe('planned')
    expect(f.db.rpc.mock.calls.map(c => c[0])).toEqual(['block2e_claim_feed_execution', 'block2e_finish_feed_execution'])
  })
  it('reports reconciled applied status from persisted state, not the orchestrator snapshot', async () => {
    const f = database()
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => {
      const r = result(f, true)
      f.runs[0].status = 'applied'
      return { ...r, reusedExistingRun: true } as WessexOrchestrationResult
    } }, 'manual')
    expect(out).toMatchObject({ outcome: 'planned', runId, runStatus: 'applied' })
    expect(f.db.rpc.mock.calls.map(c => c[0])).toEqual(['block2e_claim_feed_execution', 'block2e_finish_feed_execution'])
  })
  it.each([false, true])('reports actionable persisted awaiting-approval state (recovered=%s)', async recovered => {
    const f = database()
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => {
      const r = result(f, true)
      return { ...r, reusedExistingRun: recovered, runStatus: 'applied' } as WessexOrchestrationResult
    } }, 'manual')
    expect(out).toMatchObject({ outcome: 'planned', runStatus: 'awaiting_approval' })
  })
  it.each(['run', 'check'])('rejects synthetic %s evidence instead of reporting applied reconciliation', async synthetic => {
    const f = database()
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => {
      const r = result(f, true)
      f.runs[0].status = 'applied'
      if (synthetic === 'run') f.runs[0].adapter_id = 'phase5b-synthetic-verification'
      else f.checks[0].source_url = 'https://verification.invalid/artifact'
      return { ...r, reusedExistingRun: true } as WessexOrchestrationResult
    } }, 'manual')
    expect(out.outcome).toBe('failed')
    expect(out).not.toHaveProperty('runStatus')
    expect(f.db.rpc.mock.calls.map(c => c[0])).toEqual(['block2e_claim_feed_execution', 'block2e_finish_feed_execution'])
  })
  it('does not report success without persisted check evidence', async () => {
    const f = database()
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => { const r = result(f); f.checks.length = 0; return r } }, 'manual')
    expect(out.outcome).toBe('failed')
  })
  it('fails closed and sanitizes planner exceptions; preserves attempt', async () => {
    const f = database()
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => { throw new Error('Authorization: Bearer secret') } }, 'manual')
    expect(out).toMatchObject({ outcome: 'failed', code: 'execution_failed' })
    expect(JSON.stringify(out)).not.toContain('secret')
  })
  it('reconciles a committed finish whose response was lost', async () => {
    const f = database(), original = f.db.rpc.getMockImplementation()!
    f.db.rpc.mockImplementation(async (name, args) => { const r = await original(name, args); if (name.includes('finish')) throw new Error('lost'); return r })
    expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, orchestrate: async () => result(f) }, 'scheduled')).outcome).toBe('unchanged')
  })
  it('cooperatively stops new planning work at the timing boundary and records failure', async () => {
    const f = database(); let time = 0
    const out = await executeSupplierFeedCheck({ getSupabaseAdmin: () => f.db, env, now: () => time, orchestrate: async store => { time = executionLimits.workMs; await store.listCanonicalProducts('supplier'); return result(f) } }, 'scheduled')
    expect(out).toMatchObject({ outcome: 'failed', elapsedMs: executionLimits.workMs })
  })
  it.each(['block2e_approve_run', 'block2e_apply_row', 'block2e_finish_empty_run', 'block2d_update_supplier_product',
    'block2e_register_source', 'block2e_claim_feed_execution', 'block2e_finish_feed_execution', 'arbitrary_rpc'])('cannot reach mutation RPC %s', name => {
    const f = database(), facade = planningFacade(f.db, Date.now() + 1000)
    expect(() => facade.rpc(name, {})).toThrow('capability_denied')
    expect(f.db.rpc).not.toHaveBeenCalled()
  })
  it.each(['insert', 'update', 'upsert', 'delete'])('cannot reach canonical DML %s', method => {
    const f = database(), facade = planningFacade(f.db, Date.now() + 1000)
    for (const table of ['supplier_products', 'supplier_product_aliases', 'supplier_feed_rows', 'supplier_feed_runs', 'supplier_feed_sources', 'supplier_feed_source_checks'])
      expect(() => facade.from(table)[method]({})).toThrow('capability_denied')
    expect(() => facade.from('supplier_product_cost_events')).toThrow('capability_denied')
    expect(() => facade.from('supplier_feed_execution_attempts')).toThrow('capability_denied')
  })
  it('forwards only the approved batch planning RPC without acquiring supervisor capability', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null })), facade = planningFacade({ from: vi.fn(), rpc }, Date.now() + 1000)
    await facade.rpc('block2e_stage_rows', { p_run_id: 'fixture', p_rows: [] })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('block2e_stage_rows', { p_run_id: 'fixture', p_rows: [] })
  })
  it.each([{ ...env, SUPPLIER_FEED_AUTOMATION_ENABLED: 'false' }, { ...env, SUPPLIER_FEED_EXPECTED_PROJECT_REF: 'other' }, { ...env, SUPABASE_URL: 'https://other.supabase.co' }])('rejects disabled/mismatched project before client access', async bad => {
    const getSupabaseAdmin = vi.fn()
    await expect(executeSupplierFeedCheck({ env: bad, getSupabaseAdmin }, 'scheduled')).rejects.toThrow()
    expect(getSupabaseAdmin).not.toHaveBeenCalled()
    expect(() => checkExecutionEnvironment(bad)).toThrow()
  })
})

async function request(trigger: 'scheduled' | 'manual', overrides: any = {}, authorized = true) {
  const getSupabaseAdmin = vi.fn(() => database().db)
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn(), setHeader: vi.fn() }
  const req: any = { method: trigger === 'manual' ? 'POST' : 'GET', headers: { authorization: trigger === 'manual' ? 'Bearer admin-token' : 'Bearer fixture-cron-secret-1234', host: 'admin.test', origin: 'https://admin.test', 'content-type': 'application/json' }, query: {}, ...(trigger === 'manual' ? { body: { feedId: wessexSource.feedSourceId } } : {}), ...overrides }
  await createCheckHandler({ getSupabaseAdmin, requirePlatformAdmin: async () => { if (!authorized) throw new Error('private auth detail'); return {} as any }, platformAdminError: () => ({ status: 403, message: 'unauthorized' }) }, trigger)(req, res)
  return { status: res.status.mock.calls[0]?.[0], res, getSupabaseAdmin }
}
beforeEach(() => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); vi.stubEnv('CRON_SECRET', 'fixture-cron-secret-1234') })
describe('cron and Check now authentication gates', () => {
  it.each([undefined, '', 'Bearer wrong', 'bearer fixture-cron-secret-1234', ['Bearer fixture-cron-secret-1234']])('rejects malformed/missing/wrong cron auth %j', async authorization => {
    const r = await request('scheduled', { headers: { authorization } }); expect(r.status).toBe(403); expect(r.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it('rejects missing configured cron secret', async () => { vi.stubEnv('CRON_SECRET', ''); expect((await request('scheduled')).status).toBe(403) })
  it('rejects unsupported method and selectors', async () => {
    expect((await request('scheduled', { method: 'POST' })).status).toBe(405)
    expect((await request('scheduled', { query: { action: 'apply' } })).status).toBe(400)
  })
  it('honors disabled and exact project guard after authentication', async () => {
    vi.stubEnv('SUPPLIER_FEED_AUTOMATION_ENABLED', 'false')
    const r = await request('scheduled'); expect(r.status).toBe(503); expect(r.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated/non-admin Check now before execution', async () => {
    const r = await request('manual', {}, false); expect(r.status).toBe(403); expect(r.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it.each([{ body: { feedId: wessexSource.feedSourceId, action: 'approve' } }, { body: { feedId: 'other' } }, { headers: { authorization: 'Bearer token', 'content-type': 'application/json', host: 'admin.test', origin: 'https://evil.test' } }])('rejects unsafe manual input', async overrides => {
    const r = await request('manual', overrides); expect([400, 403]).toContain(r.status); expect(r.getSupabaseAdmin).not.toHaveBeenCalled()
  })
})
