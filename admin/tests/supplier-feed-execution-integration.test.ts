import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

import * as XLSX from '@e965/xlsx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeSupplierFeedCheck, wessexSource } from '../server/platform/supplier-feed-checks.js'
import { orchestrateWessexCheckAndPlan } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
let db: PGlite
const project = 'zminmylvmtyglkujxxyk'
const env = { SUPABASE_URL: `https://${project}.supabase.co`, SUPPLIER_FEED_EXPECTED_PROJECT_REF: project, SUPPLIER_FEED_AUTOMATION_ENABLED: 'true' }
const sql = async (query: string, args: any[] = []) => (await db.query<any>(query, args)).rows
let baseline: string
async function canonical() { return JSON.stringify({ products: await sql('select * from supplier_products order by id'), events: await sql('select * from supplier_product_cost_events order by id') }) }
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE TABLE company_accounts(id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE company_members(company_account_id uuid,user_id uuid,status text,role text);
    CREATE FUNCTION is_company_account_writable(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`)
  for (const file of ['20261007_block2b_supplier_foundation.sql', '20261008_block2d_supplier_cost_audit.sql', '20261009_block2e_supplier_feed_framework.sql', '20261012_block2d_initial_cost_event_on_insert.sql', '20261013_block2f_supplier_feed_source_checks.sql', '20261014_phase5e_supplier_feed_execution_attempts.sql']) await db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  await sql(`insert into suppliers(id,name,slug) values ($1,'Wessex','wessex')`, [wessexSource.supplierId])
  await sql(`insert into supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots) values ($1,$2,'wessex-mouldings-xls','mouldings',true)`, [wessexSource.feedSourceId, wessexSource.supplierId])
  // Non-empty, unrelated local fixture makes the no-canonical-mutation assertion meaningful.
  await sql(`insert into supplier_products(supplier_id,category,supplier_description,source_product_key,wholesale_cost,cost_currency,cost_unit,cost_tax_basis,cost_effective_at)
    values ($1,'frame','Existing manual fixture','MANUAL',5,'GBP','metre','exclusive','2026-10-01')`, [wessexSource.supplierId])
  baseline = await canonical()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Reference','Description','Price/mtr','Width'],['WX1','Frame one',10,20],['WX2','Frame two',11,22]]), 'gen')
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.xls') ? new Response(bytes, { headers: { 'last-modified': 'Thu, 08 Oct 2026 15:21:52 GMT' } }) : new Response('Databases last updated 08/10/26')))
})
afterEach(async () => { expect(await canonical()).toBe(baseline); vi.unstubAllGlobals(); await db.close() })
// In-process PostgREST-shaped transport; SQL functions and constraints are real.
function client(options: { failStage?: boolean; lostFreeze?: boolean; lostCheck?: boolean } = {}) {
  const calls: string[] = []
  let stages = 0, lost = false
  return { calls, from(table: string) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('invalid table')
    const filters: string[] = [], args: any[] = [], orders: string[] = []
    let start = 0, end = Infinity, single = false, head = false, selected = ''
    const q: any = { select: (columns: string, opts?: any) => { selected = columns; head = opts?.head; return q },
      eq: (k: string, v: any) => { args.push(v); filters.push(`${k}=$${args.length}`); return q },
      in: (k: string, values: any[]) => { args.push(values); filters.push(`${k}=ANY($${args.length})`); return q },
      order: (k: string, opts?: any) => { orders.push(`${k} ${opts?.ascending === false ? 'desc' : 'asc'}`); return q },
      range: (a: number, b: number) => { start = a; end = b; return q }, limit: (n: number) => { end = n - 1; return q },
      single: () => { single = true; return q }, abortSignal: () => q,
      then: async (resolve: any, reject: any) => {
        try {
          let data = await sql(`select * from ${table}${filters.length ? ' where ' + filters.join(' AND ') : ''}${orders.length ? ' order by ' + orders.join(',') : ''}`, args)
          const count = data.length
          data = data.slice(start, end + 1)
          for (const row of data) {
            if (selected.includes('linked_run:') && row.feed_run_id) row.linked_run = (await sql('select * from supplier_feed_runs where id=$1', [row.feed_run_id]))[0]
            if (selected.includes('checks:') && table === 'supplier_feed_runs') row.checks = await sql('select * from supplier_feed_source_checks where feed_run_id=$1', [row.id])
          }
          return resolve({ data: single ? data[0] : head ? null : data, count, error: null })
        } catch (error) { return reject(error) }
      } }
    return q
  }, rpc(name: string, args: any) {
    calls.push(name)
    return { abortSignal() { return this }, then: async (resolve: any) => {
      try {
        if (name === 'block2e_stage_row' && options.failStage && ++stages === 2) throw new Error('stage failed')
        const params = Object.entries(args)
        const data = (await sql(`select public.${name}(${params.map(([k], i) => `${k} => $${i + 1}`).join(',')}) as result`, params.map(([, v]) => typeof v === 'object' && v !== null ? JSON.stringify(v) : v)))[0].result
        if (!lost && ((name === 'block2e_freeze_plan' && options.lostFreeze) || (name === 'block2e_record_source_check' && options.lostCheck))) { lost = true; return resolve({ data: null, error: new Error('response lost after commit') }) }
        return resolve({ data, error: null })
      } catch (error) { return resolve({ data: null, error }) }
    } }
  } }
}
describe('Phase 5E real shared service + orchestrator + disposable SQL', () => {
  it('freezes exactly one awaiting-approval plan; sequential same-SHA invocation is unchanged', async () => {
    const c = client(), deps = { getSupabaseAdmin: () => c, env }
    const first = await executeSupplierFeedCheck(deps, 'scheduled')
    expect(first.outcome).toBe('planned')
    expect((await sql('select status,row_count,approved_by,approved_at,applied_by from supplier_feed_runs'))[0]).toMatchObject({ status: 'awaiting_approval', row_count: 2, approved_by: null, approved_at: null, applied_by: null })
    expect((await executeSupplierFeedCheck(deps, 'manual')).outcome).toBe('unchanged')
    expect(await sql('select id from supplier_feed_runs')).toHaveLength(1)
    expect(c.calls.some(name => /approve|apply|finish_empty|block2d/.test(name))).toBe(false)
  })
  it('retains partial staging and refuses automatic append or replacement on retry', async () => {
    const broken = client({ failStage: true })
    expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => broken, env }, 'scheduled')).outcome).toBe('failed')
    const retry = client()
    expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => retry, env }, 'manual')).outcome).toBe('failed')
    expect(await sql('select id from supplier_feed_runs')).toHaveLength(1)
    expect(await sql('select id from supplier_feed_rows')).toHaveLength(1)
    expect(retry.calls).not.toContain('block2e_stage_row')
  })
  it('reconciles freeze commit despite uncertain RPC response', async () => {
    const c = client({ lostFreeze: true })
    expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => c, env }, 'scheduled')).outcome).toBe('planned')
    expect(await sql('select id from supplier_feed_runs')).toHaveLength(1)
  })
  it('reuses historical applied import SHA without creating a replacement actionable run', async () => {
    const c = client(), deps = { getSupabaseAdmin: () => c, env }
    expect((await executeSupplierFeedCheck(deps, 'scheduled')).outcome).toBe('planned')
    // Fixture-only historical state. No approval/apply RPC is invoked.
    await db.exec('ALTER TABLE supplier_feed_runs DISABLE TRIGGER USER')
    await db.exec(`update supplier_feed_runs set logical_run_key='historical-first-import',status='applied',
      approved_by='11111111-1111-4111-8111-111111111111',approved_at=clock_timestamp(),approved_plan_fingerprint=plan_fingerprint,acknowledged_anomalies='[]'::jsonb`)
    await db.exec('ALTER TABLE supplier_feed_runs ENABLE TRIGGER USER')
    // Historical imports may have no operational check baseline. Exercise that
    // input while retaining the real adapter, planner, reconciliation and SQL.
    const second = await executeSupplierFeedCheck({ ...deps, orchestrate: (store, options) => orchestrateWessexCheckAndPlan({ ...store, getLatestSuccessfulChecksum: async () => null }, options) }, 'manual')
    expect(second.outcome).toBe('planned')
    expect(await sql('select id from supplier_feed_runs')).toHaveLength(1)
    expect(c.calls.filter(name => name === 'block2e_create_run')).toHaveLength(1)
  })
  it('reconciles source-check commit despite uncertain response', async () => {
    const c = client({ lostCheck: true })
    expect((await executeSupplierFeedCheck({ getSupabaseAdmin: () => c, env }, 'scheduled')).outcome).toBe('planned')
    expect(await sql('select id from supplier_feed_runs')).toHaveLength(1)
  })
})
