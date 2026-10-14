import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
let db: PGlite
const source = '44444444-4444-4444-8444-444444444444'
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE supplier_feed_sources(id uuid PRIMARY KEY);
    CREATE TABLE supplier_feed_runs(id uuid PRIMARY KEY, feed_source_id uuid);
    CREATE TABLE supplier_feed_source_checks(id uuid PRIMARY KEY, feed_source_id uuid);
    INSERT INTO supplier_feed_sources VALUES ('${source}');`)
  await db.exec(readFileSync(new URL('../../migrations/20261014_phase5e_supplier_feed_execution_attempts.sql', import.meta.url), 'utf8'))
})
afterEach(async () => { await db.close() })
async function claim() { return (await db.query<any>('select public.block2e_claim_feed_execution($1,$2) as attempt', [source, 'scheduled'])).rows[0].attempt }
describe('durable planning-only leases (disposable database)', () => {
  it('denies expired finish, direct service writes, terminal edits and audit deletion', async () => {
    const first = await claim()
    await db.exec('ALTER TABLE supplier_feed_execution_attempts DISABLE TRIGGER USER')
    await db.query(`update supplier_feed_execution_attempts set started_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '5 minutes' where id=$1`, [first.id])
    await db.exec('ALTER TABLE supplier_feed_execution_attempts ENABLE TRIGGER USER')
    const finish = (a: any) => db.query('select public.block2e_finish_feed_execution($1,$2,$3,$4,$5,$6)', [a.id,a.ownership_token,'failed','planning',null,null])
    await expect(finish(first)).rejects.toThrow('lease')
    const second = await claim()
    await finish(second)
    await expect(db.query('delete from supplier_feed_execution_attempts where id=$1', [second.id])).rejects.toThrow('retained')
    await expect(db.query("update supplier_feed_execution_attempts set stage='checking' where id=$1", [second.id])).rejects.toThrow('immutable')
    await db.exec('SET ROLE service_role')
    await expect(db.query("update supplier_feed_execution_attempts set stage='complete' where id=$1", [second.id])).rejects.toThrow('permission denied')
    await db.exec('RESET ROLE')
  })
  it('permits one concurrent owner and retains completed audit history', async () => {
    const [a, b] = await Promise.all([claim(), claim()])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    const attempt = a ?? b
    await db.query('select public.block2e_finish_feed_execution($1,$2,$3,$4,$5,$6)', [attempt.id, attempt.ownership_token, 'unchanged', 'complete', null, null])
    expect(await claim()).not.toBeNull()
    expect((await db.query('select * from supplier_feed_execution_attempts')).rows).toHaveLength(2)
  })
  it('rejects wrong owner and rejects a second finish', async () => {
    const a = await claim()
    await expect(db.query('select public.block2e_finish_feed_execution($1,$2,$3,$4,$5,$6)', [a.id, source, 'failed', 'planning', null, null])).rejects.toThrow('lease')
    await db.query('select public.block2e_finish_feed_execution($1,$2,$3,$4,$5,$6)', [a.id, a.ownership_token, 'failed', 'planning', null, null])
    await expect(db.query('select public.block2e_finish_feed_execution($1,$2,$3,$4,$5,$6)', [a.id, a.ownership_token, 'unchanged', 'complete', null, null])).rejects.toThrow('lease')
  })
  it('supersedes expired attempts without allowing stale owner release', async () => {
    const a = await claim()
    // Test-only owner time travel; application roles have no table DML.
    await db.exec(`ALTER TABLE supplier_feed_execution_attempts DISABLE TRIGGER USER`)
    await db.query(`update supplier_feed_execution_attempts set started_at=now()-interval '15 minutes', expires_at=now()-interval '10 minutes' where id=$1`, [a.id])
    await db.exec(`ALTER TABLE supplier_feed_execution_attempts ENABLE TRIGGER USER`)
    const next = await claim()
    expect(next.id).not.toBe(a.id)
    expect((await db.query<any>('select outcome from supplier_feed_execution_attempts where id=$1', [a.id])).rows[0].outcome).toBe('interrupted')
    await expect(db.query('select public.block2e_finish_feed_execution($1,$2,$3,$4,$5,$6)', [a.id, a.ownership_token, 'failed', 'planning', null, null])).rejects.toThrow('lease')
  })
  it('has no browser privileges, table writes or canonical mutation functions', async () => {
    const result = await db.query<any>(`select has_table_privilege('service_role','supplier_feed_execution_attempts','UPDATE') as update_allowed,
      has_table_privilege('anon','supplier_feed_execution_attempts','SELECT') as anon_allowed,
      has_function_privilege('authenticated','block2e_claim_feed_execution(uuid,text)','EXECUTE') as auth_allowed`)
    expect(result.rows[0]).toEqual({ update_allowed: false, anon_allowed: false, auth_allowed: false })
  })
})
