import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'

export const batchMigration = '20261014_phase5e_batch_staging.sql'
export const frameworkMigrations = ['20261007_block2b_supplier_foundation.sql', '20261008_block2d_supplier_cost_audit.sql',
  '20261009_block2e_supplier_feed_framework.sql', '20261012_block2d_initial_cost_event_on_insert.sql',
  '20261013_block2f_supplier_feed_source_checks.sql', '20261014_phase5e_supplier_feed_execution_attempts.sql']
export const migrationText = (name: string) => readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8')
export const bootstrap = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
  CREATE TABLE public.company_accounts(id uuid PRIMARY KEY, owner_user_id uuid);
  CREATE TABLE public.company_members(company_account_id uuid,user_id uuid,status text,role text);
  CREATE FUNCTION public.is_company_account_writable(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`
export async function install(db: PGlite) {
  await db.exec(bootstrap)
  for (const file of [...frameworkMigrations, batchMigration]) await db.exec(migrationText(file))
}
export const hash = (n: number) => n.toString(16).padStart(64, '0')
export async function fixture(db: PGlite, adapter = 'fixture-adapter', version = '1', staged = true) {
  const supplier = randomUUID(), source = randomUUID()
  await db.query(`INSERT INTO public.suppliers(id,name,slug) VALUES ($1,'SYNTHETIC LOCAL TEST — NEVER APPLY',$2)`, [supplier, supplier])
  await db.query(`INSERT INTO public.supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots)
    VALUES ($1,$2,'synthetic-local','mouldings',true)`, [source, supplier])
  const run = (await db.query<{ id: string }>(`SELECT public.block2e_create_run($1::uuid,$2::uuid,'mouldings',$3,'apply_requested','snapshot',true,$4,$5,'local-test', $6,NULL,true,true,true,true) AS id`,
    [supplier, source, randomUUID(), adapter, version, hash(999)])).rows[0].id
  if (staged) await db.query('SELECT public.block2e_begin_staging($1::uuid)', [run])
  return { supplier, source, run }
}
export function sourceRow(f: { supplier: string; source: string; run: string }, n: number, overrides: Record<string, unknown> = {}) {
  return { row_kind: 'source_item', row_number: n, source_record_key: `LOCAL-${n}`, source_path: `gen!A${n}:D${n}`,
    item_fingerprint: hash(n), action_fingerprint: hash(n + 10000), source_product_key: `LOCAL-${n}`,
    source_product_key_origin: 'supplier_provided', validation_status: 'valid', validation_errors: [], validation_warnings: [],
    proposed_action: 'create', proposed_diff: { costChange: false },
    proposed_product: { supplierId: f.supplier, sourceId: f.source, runId: f.run, scopeId: 'mouldings', adapter: { id: 'fixture-adapter', version: '1' },
      sourceProductKey: `LOCAL-${n}`, sourceProductKeyOrigin: 'supplier_provided',
      fields: { category: 'frame', supplierDescription: `Synthetic ${n}`, lifecycle: 'active', availability: 'unknown' } }, ...overrides }
}
export async function stage(db: PGlite, run: string | null, rows: unknown) {
  return (await db.query<{ ids: string[] }>('SELECT public.block2e_stage_rows($1::uuid,$2::jsonb) AS ids', [run, JSON.stringify(rows)])).rows[0].ids
}
export async function freeze(db: PGlite, run: string) {
  return (await db.query<{ fingerprint: string }>('SELECT public.block2e_freeze_plan($1::uuid,\'{}\'::jsonb) AS fingerprint', [run])).rows[0].fingerprint
}
export async function persisted(db: PGlite, run: string) {
  return (await db.query<any>('SELECT * FROM public.supplier_feed_rows WHERE feed_run_id=$1 ORDER BY row_number NULLS LAST,id', [run])).rows
}
// Bounded PostgREST-shaped LOCAL transport. All RPC validation/constraints are actual SQL.
export function localClient(db: PGlite) {
  const calls: string[] = []
  return { calls, from(table: string) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('invalid table')
    const filters: string[] = [], args: any[] = [], orders: string[] = []
    let start = 0, end = Infinity, single = false, selected = ''
    const q: any = { select: (columns: string) => { selected = columns; return q },
      eq: (key: string, value: any) => { args.push(value); filters.push(`${key}=$${args.length}`); return q },
      in: (key: string, values: any[]) => { args.push(values); filters.push(`${key}=ANY($${args.length})`); return q },
      order: (key: string) => { orders.push(key); return q }, range: (a: number, b: number) => { start = a; end = b; return q },
      limit: (n: number) => { end = n - 1; return q }, single: () => { single = true; return q }, abortSignal: () => q,
      then: async (resolve: any, reject: any) => {
        try {
          let data: any[] = (await db.query(`SELECT * FROM public.${table}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}${orders.length ? ' ORDER BY ' + orders.join(',') : ''}`, args)).rows
          const count = data.length; data = data.slice(start, end + 1)
          if (selected.includes('linked_run:')) for (const row of data) if (row.feed_run_id)
            row.linked_run = (await db.query('SELECT * FROM public.supplier_feed_runs WHERE id=$1', [row.feed_run_id])).rows[0]
          resolve({ data: single ? data[0] : data, count, error: null })
        } catch (error) { reject(error) }
      } }
    return q
  }, rpc(name: string, args: Record<string, any>) {
    calls.push(name)
    return { abortSignal() { return this }, then: async (resolve: any) => {
      try {
        const params = Object.entries(args)
        const result = await db.query<{ result: any }>(`SELECT public.${name}(${params.map(([k], i) => `${k} => $${i + 1}`).join(',')}) AS result`,
          params.map(([, v]) => typeof v === 'object' && v !== null ? JSON.stringify(v) : v))
        resolve({ data: result.rows[0].result, error: null })
      } catch (error) { resolve({ data: null, error }) }
    } }
  } }
}
