import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { batchMigration, bootstrap, fixture, frameworkMigrations, freeze, hash, migrationText, persisted, sourceRow, stage } from './helpers/block2eBatchFixture'
import { postgresJsonBytes } from '../server/platform/supplierFeeds/batchStaging'

let db: PGlite
let noBackfill = false, unchangedFunctions = false, unchangedTableGrants = false
beforeAll(async () => {
  db = new PGlite()
  await db.exec(bootstrap)
  for (const file of frameworkMigrations) await db.exec(migrationText(file))
  const prior = await fixture(db)
  await db.query('SELECT public.block2e_stage_row($1::uuid,$2::jsonb)', [prior.run, JSON.stringify(sourceRow(prior, 1))])
  await freeze(db, prior.run)
  const snapshot = async () => JSON.stringify(await Promise.all(['suppliers', 'supplier_feed_sources', 'supplier_feed_runs', 'supplier_feed_rows',
    'supplier_products', 'supplier_product_aliases', 'supplier_product_cost_events', 'supplier_feed_source_checks', 'supplier_feed_execution_attempts']
    .map(table => db.query(`SELECT * FROM public.${table} ORDER BY id`))))
  const functions = async () => JSON.stringify((await db.query(`SELECT oid,prosrc,prosecdef,proconfig,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'block2%' ORDER BY oid`)).rows)
  const grants = async () => JSON.stringify((await db.query(`SELECT oid,relacl,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY oid`)).rows)
  const before = await snapshot(), beforeFunctions = await functions(), beforeGrants = await grants()
  await db.exec(migrationText(batchMigration))
  noBackfill = before === await snapshot()
  unchangedFunctions = beforeFunctions === JSON.stringify((await db.query(`SELECT oid,prosrc,prosecdef,proconfig,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'block2%' AND proname<>'block2e_stage_rows' ORDER BY oid`)).rows)
  unchangedTableGrants = beforeGrants === await grants()
})
afterAll(async () => { await db.close() })
it('installs the additive batch RPC with the approved signature', async () => {
  const r = await db.query<{ present: boolean }>(`SELECT to_regprocedure('public.block2e_stage_rows(uuid,jsonb)') IS NOT NULL AS present`)
  expect(r.rows[0].present).toBe(true)
})

describe('batch SQL semantics', () => {
  it('performs no backfill or historical mutation and changes no existing RPC or table grants/policies', () => {
    expect(noBackfill).toBe(true); expect(unchangedFunctions).toBe(true); expect(unchangedTableGrants).toBe(true)
  })
  it.each([1, 25, 50, 100])('stages %s rows in supplied UUID order', async count => {
    const f = await fixture(db), rows = Array.from({ length: count }, (_, i) => sourceRow(f, count - i))
    const ids = await stage(db, f.run, rows), saved = await persisted(db, f.run)
    expect(ids).toHaveLength(count); expect(new Set(ids).size).toBe(count)
    rows.forEach((r, i) => expect(saved.find(s => s.id === ids[i])).toMatchObject({ row_number: r.row_number, action_fingerprint: r.action_fingerprint, apply_state: 'pending', row_persistence_version: 2 }))
    expect((await db.query<any>('SELECT row_count,plan_counts FROM supplier_feed_runs WHERE id=$1', [f.run])).rows[0]).toMatchObject({ row_count: 0, plan_counts: null })
  })
  it('batch size 1 has identical persisted evidence to unchanged stage_row', async () => {
    const f = await fixture(db), first = sourceRow(f, 1)
    const id = (await db.query<{ id: string }>('SELECT public.block2e_stage_row($1::uuid,$2::jsonb) AS id', [f.run, JSON.stringify(first)])).rows[0].id
    const second = { ...first, row_number: 2, action_fingerprint: hash(54321) }, ids = await stage(db, f.run, [second])
    const saved = await persisted(db, f.run)
    const canonical = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'created_at', 'updated_at', 'row_number', 'action_fingerprint'].includes(k)))
    expect(canonical(saved.find(r => r.id === ids[0]))).toEqual(canonical(saved.find(r => r.id === id)))
  })
  it.each([[], null, {}, 'not-array', [null], [1], ['row']].map(input => ({ input })))('rejects invalid batch shape $input', async ({ input: rows }) => {
    const f = await fixture(db); await expect(stage(db, f.run, rows)).rejects.toThrow(); expect(await persisted(db, f.run)).toHaveLength(0)
  })
  it('rejects SQL NULL and >100 rows', async () => {
    const f = await fixture(db)
    await expect(db.query('SELECT public.block2e_stage_rows($1::uuid,NULL)', [f.run])).rejects.toThrow()
    await expect(stage(db, f.run, Array.from({ length: 101 }, (_, i) => sourceRow(f, i + 1)))).rejects.toThrow()
    expect(await persisted(db, f.run)).toHaveLength(0)
  })
  it('accepts exactly 262144 bytes and rejects one byte more', async () => {
    const f = await fixture(db), base = sourceRow(f, 1, { proposed_diff: { note: '' } })
    const size = (await db.query<{ n: number }>(`SELECT octet_length(convert_to($1::jsonb::text,'UTF8')) AS n`, [JSON.stringify([base])])).rows[0].n
    const exact = { ...base, proposed_diff: { note: 'x'.repeat(262144 - size) } }
    expect(postgresJsonBytes([exact])).toBe(262144); await stage(db, f.run, [exact])
    const g = await fixture(db), oversized = { ...exact, proposed_diff: { note: 'x'.repeat(262145 - size) } }
    await expect(stage(db, g.run, [oversized])).rejects.toThrow(/bounds/); expect(await persisted(db, g.run)).toHaveLength(0)
  })
  it('enforces UTF-8 Unicode bytes and matches client estimator including exponents', async () => {
    const f = await fixture(db), input = [sourceRow(f, 1, { proposed_diff: { note: '界'.repeat(100), numbers: [1e21, 1e-7, 1.2e30, -1.234e-20], escaped: '\\"\n' } })]
    const actual = (await db.query<{ n: number }>(`SELECT octet_length(convert_to($1::jsonb::text,'UTF8')) AS n`, [JSON.stringify(input)])).rows[0].n
    expect(postgresJsonBytes(input)).toBe(actual); await stage(db, f.run, input)
    await expect(stage(db, f.run, [sourceRow(f, 2, { proposed_diff: { note: '界'.repeat(90000) } })])).rejects.toThrow(/bounds/)
    expect(await persisted(db, f.run)).toHaveLength(1)
  })
  it.each([0, 1, 2])('malformed row at position %s rolls back the whole batch', async index => {
    const f = await fixture(db), input: any[] = [sourceRow(f, 1), sourceRow(f, 2), sourceRow(f, 3)]
    input[index] = { ...input[index], unexpected: true }
    await expect(stage(db, f.run, input)).rejects.toThrow(); expect(await persisted(db, f.run)).toHaveLength(0)
  })
  it.each([{ unexpected: true }, { raw_record: {} }, { row_number: 'invalid' }, { row_number: 0 }, { matched_product_id: 'invalid' },
    { expected_product_revision: 'invalid' }, { expected_product_updated_at: 'invalid' }, { action_fingerprint: 'bad' }, { item_fingerprint: 'bad' },
    { proposed_action: 'apply' }, { validation_status: 'bad' }, { validation_errors: {} }, { validation_warnings: {} }])('propagates unchanged row validation %j atomically', async invalid => {
    const f = await fixture(db)
    await expect(stage(db, f.run, [sourceRow(f, 1), sourceRow(f, 2, invalid)])).rejects.toThrow()
    expect(await persisted(db, f.run)).toHaveLength(0)
  })
  it.each(['action_fingerprint', 'row_number'])('rolls back duplicate %s within and against previous batches; direct replay errors', async key => {
    const f = await fixture(db), a = sourceRow(f, 1), b = sourceRow(f, 2, { [key]: a[key as keyof typeof a] })
    await expect(stage(db, f.run, [a, b])).rejects.toThrow(); expect(await persisted(db, f.run)).toHaveLength(0)
    await stage(db, f.run, [a]); await expect(stage(db, f.run, [sourceRow(f, 3), b])).rejects.toThrow()
    await expect(stage(db, f.run, [a])).rejects.toThrow(); expect(await persisted(db, f.run)).toHaveLength(1)
  })
  it('duplicate potential_missing target fails atomically', async () => {
    const f = await fixture(db), product = randomUUID()
    await db.query(`INSERT INTO supplier_products(id,supplier_id,category,supplier_description) VALUES ($1,$2,'frame','Local target')`, [product, f.supplier])
    const r = { row_kind: 'potential_missing', proposed_action: 'potential_missing', validation_status: 'valid', matched_product_id: product,
      expected_product_revision: '1', expected_product_updated_at: '2026-10-01T00:00:00Z', action_fingerprint: hash(234) }
    await expect(stage(db, f.run, [r, { ...r, action_fingerprint: hash(235) }])).rejects.toThrow(); expect(await persisted(db, f.run)).toHaveLength(0)
    await stage(db, f.run, [r]); await expect(stage(db, f.run, [{ ...r, action_fingerprint: hash(236) }])).rejects.toThrow()
    expect(await persisted(db, f.run)).toHaveLength(1)
  })
  it('duplicate valid source keys remain stageable until freeze', async () => {
    const f = await fixture(db), a = sourceRow(f, 1), b = sourceRow(f, 2, { source_product_key: a.source_product_key, proposed_product: a.proposed_product })
    await stage(db, f.run, [a, b]); expect(await persisted(db, f.run)).toHaveLength(2)
    await expect(freeze(db, f.run)).rejects.toThrow(/duplicate validated source product key/)
  })
  it('legitimate reject and review diagnostics remain stageable', async () => {
    const f = await fixture(db)
    await stage(db, f.run, [sourceRow(f, 1, { proposed_action: 'reject', validation_status: 'invalid', validation_errors: [{ code: 'fixture', message: 'synthetic' }] }),
      sourceRow(f, 2, { proposed_action: 'review', proposed_diff: { reviewEvidence: { version: 1, fields: [] } } })])
    expect(await persisted(db, f.run)).toHaveLength(2); expect(await freeze(db, f.run)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('rejects null/nonexistent/wrong runs and queued, legacy, frozen state', async () => {
    const f = await fixture(db)
    await expect(stage(db, null, [sourceRow(f, 1)])).rejects.toThrow()
    await expect(stage(db, randomUUID(), [sourceRow(f, 1)])).rejects.toThrow()
    await expect(db.query(`SELECT public.block2e_stage_rows('not-uuid', '[]'::jsonb)`)).rejects.toThrow()
    const queued = await fixture(db, 'fixture-adapter', '1', false)
    await expect(stage(db, queued.run, [sourceRow(queued, 1)])).rejects.toThrow(/not staging/)
    const legacy = randomUUID()
    await db.query(`INSERT INTO supplier_feed_runs(id,supplier_id,status,persistence_version,adapter_version) VALUES ($1,$2,'staged',1,'legacy')`, [legacy, f.supplier])
    await expect(stage(db, legacy, [sourceRow(f, 1)])).rejects.toThrow(/not staging/)
    await stage(db, f.run, [sourceRow(f, 1)]); await freeze(db, f.run)
    await expect(stage(db, f.run, [sourceRow(f, 2)])).rejects.toThrow(/not staging/)
  })
  it('row immutability and freeze evidence validation remain unchanged', async () => {
    const f = await fixture(db), ids = await stage(db, f.run, [sourceRow(f, 1, { proposed_product: { ...sourceRow(f, 1).proposed_product, supplierId: randomUUID() } })])
    await expect(db.query(`UPDATE supplier_feed_rows SET proposed_diff='{}' WHERE id=$1`, [ids[0]])).rejects.toThrow(/immutable/)
    await expect(freeze(db, f.run)).rejects.toThrow(); expect((await persisted(db, f.run))[0].apply_state).toBe('pending')
  })
  it('grants only service_role execution, uses trusted owner/empty search_path, and denies browser roles', async () => {
    const metadata = (await db.query<any>(`SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner,
      proowner=(SELECT proowner FROM pg_proc WHERE oid='public.block2e_stage_row(uuid,jsonb)'::regprocedure) AS same_owner,
      pg_get_function_result(oid) AS result FROM pg_proc WHERE oid='public.block2e_stage_rows(uuid,jsonb)'::regprocedure`)).rows[0]
    expect(metadata).toMatchObject({ prosecdef: true, same_owner: true, result: 'uuid[]' }); expect(metadata.proconfig).toEqual(['search_path=""'])
    const acl = (await db.query<any>(`SELECT COALESCE(r.rolname,'PUBLIC') AS role,x.privilege_type FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee WHERE p.oid='public.block2e_stage_rows(uuid,jsonb)'::regprocedure`)).rows
    expect(acl.map(a => a.role).sort()).toEqual([metadata.owner, 'service_role'].sort())
    const f = await fixture(db)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      try { await expect(stage(db, f.run, [sourceRow(f, 1)])).rejects.toThrow(/permission denied/) } finally { await db.exec('RESET ROLE') }
    }
    await db.exec('SET ROLE service_role')
    try { expect(await stage(db, f.run, [sourceRow(f, 1)])).toHaveLength(1) } finally { await db.exec('RESET ROLE') }
  })
})
