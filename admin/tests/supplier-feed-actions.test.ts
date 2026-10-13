import { describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHandler, applyLimits } from '../server/platform/supplier-feed-actions.js'
import { platformAdminError } from '../server/platform/platformAdmin.js'

const runId = '22222222-2222-4222-8222-222222222222'
const feedId = '11111111-1111-4111-8111-111111111111'
const actor = '44444444-4444-4444-8444-444444444444'
const fp = 'b'.repeat(64)
function fixture(n = 2, overrides: Record<string, any> = {}) {
  const run: any = { id: runId, feed_source_id: feedId, supplier_id: actor, scope_key: 'mouldings', persistence_version: 2,
    created_at: '2026-10-13', status: 'awaiting_approval', mode: 'apply_requested', adapter_id: 'wessex-wpp4-mouldings', adapter_version: '2',
    planner_version: 'planner-1', logical_run_key: 'operational-release', source_checksum: 'a'.repeat(64), artifact_ref: '/artifact/WessexMouldings.xls',
    plan_fingerprint: fp, plan_counts: { create: n, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 },
    policy_snapshot: {}, anomaly_flags: [], row_count: n, acquisition_complete: true, parsing_complete: true, apply_disposition: 'retryable', ...overrides }
  const rows = Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(4, '0'), row_number: i + 1, feed_run_id: runId, row_persistence_version: 2, apply_state: 'pending', proposed_action: 'create' }))
  const checks: any[] = []
  const calls: Array<{ table: string; method: string; args: any[] }> = []
  const from = vi.fn((table: string) => {
    let data = table === 'supplier_feed_runs' ? [run] : table === 'supplier_feed_rows' ? [...rows] : table === 'supplier_feed_source_checks' ? [...checks] : table === 'supplier_feed_sources' ? [{ id: feedId, supplier_id: actor, scope_key: 'mouldings', source_key: 'wessex', supplier: { name: 'Wessex' } }] : []
    let head = false, start = 0, end = Infinity
    const query: any = {}
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'range']) query[method] = (...args: any[]) => {
      calls.push({ table, method, args })
      if (method === 'select') head = args[1]?.head === true
      if (method === 'eq') data = data.filter(row => row[args[0]] === args[1])
      if (method === 'in') data = data.filter(row => args[1].includes(row[args[0]]))
      if (method === 'limit') end = args[0] - 1
      if (method === 'range') [start, end] = args
      return query
    }
    query.then = (resolve: any) => resolve({ data: head ? null : data.slice(start, end + 1), count: data.length, error: null })
    return query
  })
  const rowOutcome = { state: 'applied' }
  const rpc = vi.fn(async (name: string, args: any): Promise<{ data: any; error: Error | null }> => {
    if (name === 'block2e_approve_run') Object.assign(run, { status: 'approved', approved_by: args.p_actor, approved_at: '2026-10-13', approved_plan_fingerprint: fp, acknowledged_anomalies: args.p_acknowledged })
    else if (name === 'block2e_apply_row') {
      const row = rows.find(r => r.id === args.p_row_id)!
      row.apply_state = rowOutcome.state
      if (rowOutcome.state === 'conflict') { Object.assign(row, { failure_code: 'stale_product_revision' }); Object.assign(run, { apply_disposition: 'replan_required', failure_code: 'stale_product_revision' }) }
      run.status = rows.some(r => ['pending', 'failed', 'conflict'].includes(r.apply_state)) ? 'partially_applied' : 'applied'
    } else if (name === 'block2e_finish_empty_run') run.status = 'applied'
    else throw new Error('Unexpected RPC')
    return { data: name === 'block2e_apply_row' ? rowOutcome : null, error: null }
  })
  return { from, rpc, calls, run, rows, checks, rowOutcome }
}
function approved(db: ReturnType<typeof fixture>) { Object.assign(db.run, { status: 'approved', approved_by: actor, approved_at: '2026-10-13', approved_plan_fingerprint: fp, acknowledged_anomalies: db.run.anomaly_flags }); return db }
async function request(db = fixture(), options: { body?: any; headers?: any; method?: string; authError?: string; query?: any } = {}) {
  const state: any = {}
  const res: any = { status: (n: number) => { state.status = n; return res }, json: (body: any) => { state.body = body; return res }, end: () => res, setHeader: vi.fn() }
  const getSupabaseAdmin = vi.fn(() => db)
  await createHandler({ getSupabaseAdmin, platformAdminError, requirePlatformAdmin: async () => { if (options.authError) throw new Error(options.authError); return { id: actor } as any } })({ method: options.method ?? 'POST', query: options.query ?? {}, headers: { host: 'admin.example.test', authorization: 'Bearer fixture-token', origin: 'https://admin.example.test', 'content-type': 'application/json', ...options.headers }, body: options.body ?? { runId, action: 'approve' } } as VercelRequest, res as VercelResponse)
  return { ...state, getSupabaseAdmin, res }
}

describe('controlled supplier-feed actions', () => {
  it.each(['Missing bearer token', 'Invalid or expired token', 'You do not have platform admin access'])('rejects unauthorized mutations: %s', async authError => {
    const db = fixture(); const result = await request(db, { authError })
    expect(result.status).toBe(403); expect(result.getSupabaseAdmin).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled()
  })
  it.each(['GET', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])('rejects %s', async method => {
    const result = await request(fixture(), { method })
    expect(result.status).toBe(405); expect(result.getSupabaseAdmin).not.toHaveBeenCalled(); expect(result.res.setHeader).toHaveBeenCalledWith('Allow', 'POST')
  })
  it.each([{}, [], 'invalid-json', { runId: 'bad', action: 'approve' }, { runId, action: 'fetch' }, { runId, action: 'approve', status: 'awaiting_approval' }, { runId, action: 'approve', counts: { create: 0 } }, { runId, action: 'approve', fingerprint: fp }, { runId: [runId], action: 'apply' }])('rejects malformed or browser-authoritative input %j', async body => {
    const db = fixture(); const result = await request(db, { body })
    expect(result.status).toBe(400); expect(result.getSupabaseAdmin).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled()
  })
  it('rejects query selectors and non-bearer authorization', async () => {
    expect((await request(fixture(), { query: { runId } })).status).toBe(400)
    expect((await request(fixture(), { headers: { authorization: 'fixture-token' } })).status).toBe(403)
  })
  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', undefined, ['application/json']])('rejects inappropriate content type %j', async type => {
    const result = await request(fixture(), { headers: { 'content-type': type } })
    expect(result.status).toBe(415); expect(result.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it.each([
    { origin: 'https://evil.test' }, { origin: 'null' }, { origin: 'https://admin.example.test/path' },
    { origin: ['https://admin.example.test'] }, { origin: 'http://admin.example.test' },
    { origin: undefined, 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ])('rejects inappropriate origin/fetch metadata %j', async headers => {
    const result = await request(fixture(), { headers })
    expect(result.status).toBe(403); expect(result.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it.each([{ origin: undefined }, { 'sec-fetch-site': 'same-origin' }, { 'content-type': 'application/json; charset=utf-8' }])('permits safe bearer requests %j', async headers => {
    expect((await request(fixture(), { headers })).status).toBe(200)
  })
  it.each([
    { status: 'queued', plan_fingerprint: null }, { mode: 'dry_run' }, { adapter_id: 'phase5b-synthetic-verification' },
    { status: 'applied' }, { persistence_version: 1 }, { plan_fingerprint: null }, { apply_disposition: 'replan_required' },
    { acquisition_complete: false }, { staging_purged_at: '2026-10-13' }, { row_count: 5000 },
  ])('rejects unsafe approvals %j', async overrides => {
    const db = fixture(2, overrides); const result = await request(db)
    expect([404, 409]).toContain(result.status); expect(db.rpc).not.toHaveBeenCalled()
  })
  it('safely rejects already-approved approval without changing the original identity', async () => {
    const db = approved(fixture()); const before = { ...db.run }
    const result = await request(db)
    expect(result.status).toBe(409); expect(db.rpc).not.toHaveBeenCalled(); expect(db.run).toEqual(before)
  })
  it('rejects linked synthetic check evidence even on an unmarked frozen run', async () => {
    const db = fixture(); db.checks.push({ feed_run_id: runId, source_url: 'https://verification.invalid/test' })
    const result = await request(db)
    expect(result.status).toBe(409); expect(result.body.reasonCodes).toEqual(['synthetic_run']); expect(db.rpc).not.toHaveBeenCalled()
  })
  it('fails closed on a concurrent approval transition / RPC rejection', async () => {
    const db = fixture(); db.rpc.mockResolvedValueOnce({ error: new Error('private database details'), data: null })
    const result = await request(db)
    expect(result.status).toBe(409); expect(JSON.stringify(result.body)).not.toContain('private database details')
  })
  it('does not claim approval if the reloaded persisted state does not confirm it', async () => {
    const db = fixture(); db.rpc.mockResolvedValueOnce({ error: null, data: null })
    const result = await request(db)
    expect(result.status).toBe(409); expect(result.body.reasonCodes).toEqual(['approval_not_confirmed'])
  })
  it.each([
    { status: 'awaiting_approval' }, { approved_by: null }, { approved_at: null }, { approved_plan_fingerprint: 'c'.repeat(64) },
    { acknowledged_anomalies: ['creates'] }, { status: 'applied' }, { adapter_id: 'synthetic-adapter' }, { mode: 'dry_run' },
  ])('rejects ineligible applications %j', async overrides => {
    const db = approved(fixture()); Object.assign(db.run, overrides)
    const result = await request(db, { body: { runId, action: 'apply' } })
    expect([404, 409]).toContain(result.status); expect(db.rpc).not.toHaveBeenCalled()
  })
  it.each(['conflict', 'failed'])('stops immediately on %s and surfaces persisted partial evidence', async state => {
    const db = approved(fixture(4)); db.rowOutcome.state = state
    const result = await request(db, { body: { runId, action: 'apply' } })
    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(result.body).toMatchObject({ outcome: 'attention', processed: 1, detail: { run: { status: 'partially_applied' }, control: { canContinue: state === 'failed', progress: { pending: 3, [state]: 1 } } } })
    expect(db.rows[0].apply_state).toBe(state)
    if (state === 'conflict') {
      const second = await request(db, { body: { runId, action: 'apply' } })
      expect(second.status).toBe(409); expect(second.body.reasonCodes).toEqual(['replan_required']); expect(db.rpc).toHaveBeenCalledTimes(1)
      expect(db.rows[0]).toMatchObject({ failure_code: 'stale_product_revision' })
    }
  })
  it('resumes retryable failed rows using Block2E, without re-approval', async () => {
    const db = approved(fixture(2)); db.rows[0].apply_state = 'failed'; db.run.status = 'partially_applied'
    const result = await request(db, { body: { runId, action: 'apply' } })
    expect(result.body.detail.run.status).toBe('applied'); expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(['block2e_apply_row', 'block2e_apply_row'])
  })
  it('finishes an approved genuine empty run through the existing finish RPC only', async () => {
    const db = approved(fixture(0)); const result = await request(db, { body: { runId, action: 'apply' } })
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('block2e_finish_empty_run', { p_run_id: runId, p_fingerprint: fp })
    expect(result.body).toMatchObject({ outcome: 'applied', processed: 0, detail: { control: { canApply: false, progress: { total: 0 } } } })
  })
  it('stops after a transport/RPC error and returns reloaded persisted state without claiming completion', async () => {
    const db = approved(fixture(4)); db.rpc.mockResolvedValueOnce({ error: new Error('private failure'), data: null })
    const result = await request(db, { body: { runId, action: 'apply' } })
    expect(result.body).toMatchObject({ outcome: 'attention', processed: 0, detail: { run: { status: 'approved' }, control: { progress: { pending: 4 } } } })
    expect(db.rpc).toHaveBeenCalledTimes(1); expect(JSON.stringify(result.body)).not.toContain('private failure')
  })
  it('honors the elapsed request budget between independently committed rows', async () => {
    const now = vi.spyOn(Date, 'now'); let calls = 0
    now.mockImplementation(() => (++calls <= 2 ? 0 : applyLimits.budgetMs + 1))
    try {
      const db = approved(fixture(4)); const result = await request(db, { body: { runId, action: 'apply' } })
      expect(result.body.processed).toBe(1); expect(result.body.outcome).toBe('bounded'); expect(db.rpc).toHaveBeenCalledTimes(1)
    } finally { now.mockRestore() }
  })
  it('applies at most ten rows with separate RPC commits and resumes from durable checkpoints', async () => {
    const db = approved(fixture(12))
    const first = await request(db, { body: { runId, action: 'apply' } })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ processed: applyLimits.rows, outcome: 'bounded', detail: { run: { status: 'partially_applied' }, control: { canContinue: true, progress: { applied: 10, pending: 2 } } } })
    expect(db.rpc).toHaveBeenCalledTimes(10)
    expect(db.rpc.mock.calls.every(([name, args]) => name === 'block2e_apply_row' && args.p_fingerprint === fp && Object.keys(args).length === 3)).toBe(true)
    const second = await request(db, { body: { runId, action: 'apply' } })
    expect(second.body).toMatchObject({ processed: 2, outcome: 'applied', detail: { run: { status: 'applied' }, control: { canApply: false, canContinue: false, progress: { applied: 12, pending: 0 } } } })
    expect(new Set(db.rpc.mock.calls.map(([, args]) => args.p_row_id)).size).toBe(12)
    expect(db.from.mock.calls.every(([table]) => !['supplier_products', 'supplier_product_cost_events'].includes(table))).toBe(true)
  })
  it('approves using only persisted fingerprint/anomalies and the authorized actor, returning reloaded state', async () => {
    const db = fixture(2, { anomaly_flags: ['creates'] })
    const result = await request(db)
    expect(result.status).toBe(200)
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('block2e_approve_run', { p_run_id: runId, p_fingerprint: fp, p_actor: actor, p_acknowledged: ['creates'] })
    expect(result.body).toMatchObject({ outcome: 'approved', processed: 0, detail: { run: { status: 'approved' }, control: { canApprove: false, canApply: true, approvedBy: actor } } })
  })
})
