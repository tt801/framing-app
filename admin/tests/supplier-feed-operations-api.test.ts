import { describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHandler } from '../server/platform/supplier-feeds.js'
import { platformAdminError } from '../server/platform/platformAdmin.js'

const feedId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const supplierId = '33333333-3333-4333-8333-333333333333'
const source = { id: feedId, supplier_id: supplierId, source_key: 'feed', scope_key: 'mouldings', supplier: { id: supplierId, name: 'Wessex', status: 'draft' } }
const run = { id: runId, feed_source_id: feedId, supplier_id: supplierId, persistence_version: 2, created_at: '2026-10-12', status: 'applied', plan_counts: { create: 1194, update: 2, unchanged: 3, review: 4, reject: 5, potential_missing: 6, cost_changes: 2 } }
function database(tables: Record<string, any[]> = {}, fail = false) {
  const calls: Array<{ table: string; method: string; args: any[] }> = []
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])], head = false, start = 0, end = Infinity, single = false
    const ordering: Array<[string, boolean]> = []
    const query: any = {}
    for (const method of ['select', 'eq', 'in', 'order', 'range', 'limit', 'maybeSingle']) query[method] = (...args: any[]) => {
      calls.push({ table, method, args })
      if (method === 'select') head = Boolean(args[1]?.head)
      if (method === 'eq') rows = rows.filter(row => row[args[0]] === args[1])
      if (method === 'in') rows = rows.filter(row => args[1].includes(row[args[0]]))
      if (method === 'order') ordering.push([args[0], args[1]?.ascending !== false])
      if (method === 'range') [start, end] = args
      if (method === 'limit') end = args[0] - 1
      if (method === 'maybeSingle') single = true
      return query
    }
    query.then = (resolve: any) => {
      rows.sort((a, b) => { for (const [key, ascending] of ordering) { const diff = String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (ascending ? 1 : -1); if (diff) return diff } return 0 })
      return resolve({ data: head ? null : single ? rows[0] ?? null : rows.slice(start, end + 1), count: rows.length, error: fail ? new Error('private database error') : null })
    }
    return query
  })
  return { from, calls, rpc: vi.fn(() => { throw new Error('Writes forbidden') }) }
}
async function request(query: Record<string, any> = {}, options: { method?: string; authorized?: boolean; db?: ReturnType<typeof database> } = {}) {
  const db = options.db ?? database()
  const getSupabaseAdmin = vi.fn(() => db)
  const result: { status?: number; body?: any } = {}
  const res = { status: (n: number) => { result.status = n; return res }, json: (body: any) => { result.body = body; return res }, end: () => res, setHeader: vi.fn() } as unknown as VercelResponse
  await createHandler({ getSupabaseAdmin, platformAdminError, requirePlatformAdmin: async () => { if (options.authorized === false) throw new Error('You do not have platform admin access'); return {} as any } })({ method: options.method ?? 'GET', query, headers: {} } as VercelRequest, res)
  return { ...result, db, getSupabaseAdmin, res }
}

describe('GET-only authorized feed operations endpoint', () => {
  it('authorizes before constructing the privileged client', async () => {
    const result = await request({}, { authorized: false })
    expect(result.status).toBe(403)
    expect(result.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('rejects %s without data access', async method => {
    const result = await request({}, { method })
    expect(result.status).toBe(405)
    expect(result.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it('returns empty feed state', async () => {
    expect((await request()).body).toEqual({ feeds: [], offset: 0, hasMore: false })
  })
  it('aggregates a feed with an exact owned product count rather than fetching products', async () => {
    const db = database({ supplier_feed_sources: [source], supplier_feed_runs: [run], supplier_products: Array.from({ length: 1194 }, () => ({ owner_feed_source_id: feedId, supplier_id: supplierId })) })
    const result = await request({}, { db })
    expect(result.status).toBe(200)
    expect(result.body.feeds[0]).toMatchObject({ canonicalProductCount: 1194, latestRun: { id: runId, counts: run.plan_counts } })
    expect(db.calls).toContainEqual({ table: 'supplier_products', method: 'select', args: ['id', { count: 'exact', head: true }] })
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('bounds feed pages and every history query', async () => {
    const db = database({ supplier_feed_sources: Array.from({ length: 26 }, (_, i) => ({ ...source, id: String(i).padStart(3, '0') })) })
    const result = await request({}, { db })
    expect(result.body.feeds).toHaveLength(25)
    expect(result.body.hasMore).toBe(true)
    expect(db.calls.filter(c => ['supplier_feed_runs', 'supplier_feed_source_checks'].includes(c.table) && c.method === 'limit').every(c => c.args[0] <= 201)).toBe(true)
  })
  it('keeps synthetic history visibly labelled but excludes synthetic runs', async () => {
    const db = database({ supplier_feed_sources: [source], supplier_feed_source_checks: [{ id: 'test', feed_source_id: feedId, status: 'unchanged', checked_at: '2026-10-13', sha256: 'a'.repeat(64), source_url: 'https://verification.invalid/check' }], supplier_feed_runs: [{ ...run, adapter_id: 'phase5b-synthetic-verification' }, { ...run, id: 'real' }] })
    const result = await request({ feedId }, { db })
    expect(result.body.feed.health).toBe('Never checked')
    expect(result.body.checks[0].synthetic).toBe(true)
    expect(result.body.runs.map((r: any) => r.id)).toEqual(['real'])
    expect(result.body.syntheticRuns).toBe(1)
  })
  it('selects successful release evidence outside the recent failure window', async () => {
    const success = { id: 'success', feed_source_id: feedId, status: 'unchanged', checked_at: '2026-10-12', created_at: '2026-10-12', sha256: 'a'.repeat(64) }
    const db = database({ supplier_feed_sources: [source], supplier_feed_source_checks: [success, ...Array.from({ length: 210 }, (_, i) => ({ id: String(i), feed_source_id: feedId, status: 'fetch_error', checked_at: '2026-10-13', created_at: '2026-10-13' }))] })
    const result = await request({ feedId }, { db })
    expect(result.body.feed.latestRelease).toMatchObject({ sha256: success.sha256, origin: 'check' })
    expect(result.body.feed.latestCheck.status).toBe('fetch_error')
    expect(result.body.feed.historyLimited).toBe(true)
  })
  it('retains successful applied-import evidence outside newer queued runs', async () => {
    const db = database({ supplier_feed_sources: [source], supplier_feed_runs: [{ ...run, source_checksum: 'a'.repeat(64) }, ...Array.from({ length: 210 }, (_, i) => ({ ...run, id: String(i), created_at: '2026-10-13', status: 'queued', plan_counts: null }))] })
    const result = await request({ feedId }, { db })
    expect(result.body.feed.latestRelease).toMatchObject({ sha256: 'a'.repeat(64), origin: 'applied_import' })
    expect(result.body.feed.latestRun.status).toBe('queued')
  })
  it('reads stored plan counts and paginates bounded review rows without calculating a plan', async () => {
    const db = database({ supplier_feed_sources: [source], supplier_feed_runs: [run], supplier_feed_rows: Array.from({ length: 60 }, (_, i) => ({ id: String(i).padStart(3, '0'), feed_run_id: runId, row_persistence_version: 2, proposed_action: 'review', validation_errors: [{ code: 'bad', message: 'x'.repeat(1000) }], proposed_diff: { costChange: true, ordinaryChanges: ['description'] }, raw_record: { secret: 'do not return' }, proposed_product: { fields: { supplierDescription: 'Frame' }, asset: { sourceUrl: 'private' } } })) })
    const result = await request({ feedId, runId }, { db })
    expect(result.status).toBe(200)
    expect(result.body.run.counts).toEqual(run.plan_counts)
    expect(result.body.rows).toHaveLength(50)
    expect(result.body.hasMore).toBe(true)
    expect(result.body.rows[0]).toMatchObject({ description: 'Frame', costChange: true, ordinaryChanges: ['description'] })
    expect(JSON.stringify(result.body)).not.toContain('do not return')
    expect(JSON.stringify(result.body)).not.toContain('private')
    expect(result.body.rows[0].errors[0].length).toBeLessThanOrEqual(512)
    const next = await request({ feedId, runId, offset: '50' }, { db })
    expect(next.body.rows).toHaveLength(10)
    expect(next.body.hasMore).toBe(false)
  })
  it.each([{ runId }, { feedId: ['bad'] }, { feedId: 'bad' }, { offset: '-1' }, { feedId, runId: 'bad' }, { feedId, offset: '1' }, { unknown: 'x' }])('rejects malformed or ambiguous selectors %j', async query => {
    const result = await request(query)
    expect(result.status).toBe(400)
    expect(result.getSupabaseAdmin).not.toHaveBeenCalled()
  })
  it('returns not found for unknown feeds, cross-feed runs and synthetic run detail', async () => {
    expect((await request({ feedId })).status).toBe(404)
    for (const other of [{ ...run, feed_source_id: supplierId }, { ...run, artifact_ref: 'https://verification.invalid/run' }]) {
      const db = database({ supplier_feed_sources: [source], supplier_feed_runs: [other] })
      expect((await request({ feedId, runId }, { db })).status).toBe(404)
      expect(db.from).not.toHaveBeenCalledWith('supplier_feed_rows')
    }
  })
  it('returns sanitized errors rather than credentials or database internals', async () => {
    const result = await request({}, { db: database({}, true) })
    expect(result.status).toBe(500)
    expect(result.body).toEqual({ error: 'Unable to load supplier feed operations' })
  })
})
