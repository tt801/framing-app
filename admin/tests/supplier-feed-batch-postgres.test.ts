// Opt-in real PostgreSQL tests. PHASE5E_PG_BIN must point to disposable local binaries.
// Host is hardcoded to loopback; inherited Supabase credentials are never consulted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { bootstrap, frameworkMigrations, batchMigration, migrationText, sourceRow } from './helpers/block2eBatchFixture'

const bin = process.env.PHASE5E_PG_BIN
const suite = bin ? describe : describe.skip
const execute = promisify(execFile)
const database = `phase5e_test_${randomUUID().replaceAll('-', '')}`
const port = process.env.PHASE5E_PG_PORT ?? '55432'
const connections = new Set<ChildProcessWithoutNullStreams>()
const quote = (v: string) => `'${v.replaceAll("'", "''")}'`
function args(db = database) { return ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', process.env.PHASE5E_PG_USER ?? 'hermes', '-d', db] }
async function sql(query: string, db = database) {
  return (await execute(join(bin!, 'psql'), [...args(db), '-c', query], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim()
}
async function rows(query: string) { return JSON.parse(await sql(`SELECT COALESCE(json_agg(t),'[]'::json) FROM (${query}) t`)) as any[] }
async function fixture() {
  const f = { supplier: randomUUID(), source: randomUUID(), run: '' }
  await sql(`INSERT INTO public.suppliers(id,name,slug) VALUES (${quote(f.supplier)},'SYNTHETIC LOCAL PG — NEVER APPLY',${quote(f.supplier)});
    INSERT INTO public.supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots) VALUES (${quote(f.source)},${quote(f.supplier)},'local','mouldings',true);`)
  f.run = await sql(`SELECT public.block2e_create_run(${quote(f.supplier)},${quote(f.source)},'mouldings',${quote(randomUUID())},'apply_requested','snapshot',true,'fixture-adapter','1','local',NULL,NULL,true,true,true,true)`)
  await sql(`SELECT public.block2e_begin_staging(${quote(f.run)})`)
  return f
}
const batch = (f: Awaited<ReturnType<typeof fixture>>, n: number[], overrides: Record<string, unknown> = {}) =>
  `SELECT public.block2e_stage_rows(${quote(f.run)},${quote(JSON.stringify(n.map(i => sourceRow(f, i, overrides))))}::jsonb)`
const count = async (run: string) => Number(await sql(`SELECT count(*) FROM public.supplier_feed_rows WHERE feed_run_id=${quote(run)}`))
async function waitForLock(name: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const r = await rows(`SELECT pid FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'`)
    if (r.length === 1) return r[0].pid as number
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Expected independent PostgreSQL connection did not reach lock wait')
}
async function holder(statement: string) {
  const child = spawn(join(bin!, 'psql'), args(), { stdio: ['pipe', 'pipe', 'pipe'] })
  connections.add(child)
  let output = '', error = ''
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local transaction did not become ready')), 5000)
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('PHASE5E_READY')) { clearTimeout(timer); resolve() } })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('exit', code => { clearTimeout(timer); if (code) reject(new Error(error)); connections.delete(child) })
    child.on('error', reject)
  })
  child.stdin.write(`BEGIN; ${statement}; SELECT 'PHASE5E_READY';\n`)
  await ready
  return { async finish(commit = true) {
    const ended = new Promise<void>((resolve, reject) => child.once('exit', code => code ? reject(new Error(error)) : resolve()))
    child.stdin.end(`${commit ? 'COMMIT' : 'ROLLBACK'};\n`); await ended
  } }
}
const observed = (promise: Promise<string>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))

suite('independent disposable PostgreSQL batch transactions', () => {
  beforeAll(async () => {
    if (!/^\d+$/.test(port)) throw new Error('Invalid local PG port')
    await sql(`CREATE DATABASE ${database}`, 'postgres')
    // Roles are cluster-scoped; create only missing test roles in this disposable cluster.
    await sql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;`, 'postgres')
    await sql(bootstrap.replace('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;', ''))
    for (const file of [...frameworkMigrations, batchMigration]) await sql(migrationText(file))
  }, 20000)
  afterAll(async () => {
    for (const child of connections) child.stdin.end('ROLLBACK;\n')
    await sql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`, 'postgres')
  })
  it('disjoint batches on the same run serialize and retain exact rows', async () => {
    const f = await fixture(), first = await holder(batch(f, [1, 2]))
    const name = randomUUID(), pending = observed(sql(`SET application_name=${quote(name)}; ${batch(f, [3, 4])}`))
    await waitForLock(name); expect(await count(f.run)).toBe(0)
    await first.finish(); expect((await pending).ok).toBe(true); expect(await count(f.run)).toBe(4)
  })
  it('a conflicting losing transaction rolls back its entire batch, preserving the winner', async () => {
    const f = await fixture(), first = await holder(batch(f, [1]))
    const name = randomUUID(), pending = observed(sql(`SET application_name=${quote(name)}; ${batch(f, [2, 1])}`))
    await waitForLock(name); await first.finish()
    expect((await pending).ok).toBe(false); expect(await count(f.run)).toBe(1)
    expect(await rows(`SELECT row_number FROM supplier_feed_rows WHERE feed_run_id=${quote(f.run)}`)).toEqual([{ row_number: 1 }])
  })
  it('different runs stage independently while another run transaction holds its lock', async () => {
    const a = await fixture(), b = await fixture(), first = await holder(batch(a, [1]))
    await sql(`SET statement_timeout='2s'; ${batch(b, [1, 2])}`)
    expect(await count(b.run)).toBe(2); expect(await count(a.run)).toBe(0); await first.finish()
  })
  it('freeze waits for staging and sees every committed row', async () => {
    const f = await fixture(), first = await holder(batch(f, [1, 2])), name = randomUUID()
    const pending = observed(sql(`SET application_name=${quote(name)}; SELECT public.block2e_freeze_plan(${quote(f.run)},'{}')`))
    await waitForLock(name); await first.finish(); expect((await pending).ok).toBe(true)
    expect(await rows(`SELECT status,row_count FROM supplier_feed_runs WHERE id=${quote(f.run)}`)).toEqual([{ status: 'awaiting_approval', row_count: 2 }])
    await expect(sql(batch(f, [3]))).rejects.toThrow(); expect(await count(f.run)).toBe(2)
  })
  it('staging queued behind a freeze cannot insert after the frozen commit', async () => {
    const f = await fixture(); await sql(batch(f, [1]))
    const frozen = await holder(`SELECT public.block2e_freeze_plan(${quote(f.run)},'{}')`), name = randomUUID()
    const pending = observed(sql(`SET application_name=${quote(name)}; ${batch(f, [2, 3])}`))
    await waitForLock(name); await frozen.finish(); expect((await pending).ok).toBe(false); expect(await count(f.run)).toBe(1)
  })
  it('lock timeout leaves no partial batch and retains earlier commits', async () => {
    const f = await fixture(); await sql(batch(f, [1]))
    const locked = await holder(`SELECT id FROM supplier_feed_runs WHERE id=${quote(f.run)} FOR UPDATE`)
    await expect(sql(`SET lock_timeout='100ms'; ${batch(f, [2, 3])}`)).rejects.toThrow(/lock timeout/)
    await locked.finish(false); expect(await count(f.run)).toBe(1)
  })
  it('cancellation after an internal row insert rolls back the whole batch; exact readback establishes none', async () => {
    const f = await fixture()
    // Disposable-only synchronization hook: pause the second insertion after the first exists inside its transaction.
    await sql(`CREATE FUNCTION public.phase5e_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('phase5e.pause',true)='on' AND NEW.row_number=2 THEN PERFORM pg_advisory_xact_lock(732001); END IF; RETURN NEW; END $$;
      CREATE TRIGGER phase5e_test_pause BEFORE INSERT ON supplier_feed_rows FOR EACH ROW EXECUTE FUNCTION public.phase5e_test_pause();`)
    const locked = await holder('SELECT pg_advisory_xact_lock(732001)'), name = randomUUID()
    const pending = observed(sql(`SET application_name=${quote(name)}; SET phase5e.pause='on'; ${batch(f, [1, 2, 3])}`))
    const pid = await waitForLock(name)
    expect(await sql(`SELECT pg_cancel_backend(${pid})`)).toBe('t')
    expect((await pending).ok).toBe(false); await locked.finish(false)
    expect(await count(f.run)).toBe(0)
    await sql('DROP TRIGGER phase5e_test_pause ON supplier_feed_rows; DROP FUNCTION public.phase5e_test_pause()')
  })
  it('lost response after commit is proven by exact evidence readback; direct replay fails without duplication', async () => {
    const f = await fixture(), input = [sourceRow(f, 1), sourceRow(f, 2)]
    await sql(batch(f, [1, 2])) // deliberately discard returned UUIDs, modelling a lost response after commit
    const saved = await rows(`SELECT row_number,action_fingerprint,proposed_product,proposed_diff,apply_state FROM supplier_feed_rows WHERE feed_run_id=${quote(f.run)} ORDER BY row_number`)
    expect(saved).toHaveLength(2)
    input.forEach((r, i) => expect(saved[i]).toMatchObject({ row_number: r.row_number, action_fingerprint: r.action_fingerprint, proposed_product: r.proposed_product, proposed_diff: r.proposed_diff, apply_state: 'pending' }))
    await expect(sql(batch(f, [1, 2]))).rejects.toThrow(/duplicate key/); expect(await count(f.run)).toBe(2)
  })
})
