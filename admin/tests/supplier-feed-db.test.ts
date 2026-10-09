import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
const supplier = '11111111-1111-4111-8111-111111111111'
const product = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
let db: PGlite
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, any>[]
const current = async () => (await rows(`SELECT product_revision, updated_at, wholesale_cost, owner_feed_source_id FROM public.supplier_products WHERE id='${product}'`))[0]

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE TABLE public.company_accounts(id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE public.company_members(company_account_id uuid, user_id uuid, status text, role text);
    CREATE FUNCTION public.is_company_account_writable(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`)
  await db.exec(migration('20261007_block2b_supplier_foundation.sql'))
  await db.exec(migration('20261008_block2d_supplier_cost_audit.sql'))
  await db.exec(`INSERT INTO public.suppliers(id,name,slug) VALUES ('${supplier}','Fixture','fixture');
    INSERT INTO public.supplier_products(id,supplier_id,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis,cost_effective_at)
    VALUES ('${product}','${supplier}','frame','Fixture',10,'GBP','metre','exclusive','2026-10-08T00:00:00Z');`)
  await db.exec(migration('20261009_block2e_supplier_feed_framework.sql'))
})
afterEach(async () => { await db.close() })

describe('Block 2E disposable installed migration', () => {
  it('revisions existing manual rows and increments twice in the same transaction', async () => {
    expect(await current()).toMatchObject({ product_revision: 1, owner_feed_source_id: null })
    await db.exec('BEGIN')
    try {
      await db.exec(`UPDATE public.supplier_products SET supplier_description='First' WHERE id='${product}'`)
      const first = await current()
      expect(first.product_revision).toBe(2)
      await db.exec(`UPDATE public.supplier_products SET supplier_description='Second' WHERE id='${product}'`)
      const second = await current()
      expect(second.product_revision).toBe(3)
      expect(second.updated_at).toEqual(first.updated_at)
    } finally { await db.exec('ROLLBACK') }
  })

  const source = '44444444-4444-4444-8444-444444444444'
  const h = (letter: string) => letter.repeat(64)
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as Record<string, any>[]
  async function register(authoritative = true) {
    await q('INSERT INTO public.supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots) VALUES ($1,$2,$3,$4,$5)',
      [source, supplier, 'fixture-feed', 'catalog-a', authoritative])
  }
  async function run(key: string, mode = 'apply_requested', coverage = 'delta', authoritative = false) {
    const result = await q(`SELECT public.block2e_create_run($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS id`,
      [supplier, source, 'catalog-a', key, mode, coverage, authoritative, 'fixture-adapter', '1', 'planner-1', h('f'), null, true, true, true, true])
    const id = result[0].id as string
    await q('SELECT public.block2e_begin_staging($1::uuid)', [id])
    return id
  }
  const candidate = (id: string, key: string, description: string, cost?: string) => ({
    supplierId: supplier, runId: id, sourceId: source, scopeId: 'catalog-a',
    adapter: { id: 'fixture-adapter', version: '1' }, sourceProductKey: key,
    sourceProductKeyOrigin: 'supplier_provided',
    fields: { category: 'frame', supplierDescription: description, lifecycle: 'active', availability: 'available' },
    ...(cost ? { cost: { amount: cost, currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-08T00:00:00Z' } } : {}),
  })
  async function stage(id: string, row: Record<string, unknown>) {
    return (await q('SELECT public.block2e_stage_row($1::uuid,$2::jsonb) AS id', [id, JSON.stringify(row)]))[0].id as string
  }
  const sourceRow = (id: string, key: string, action: string, n: number, description: string, cost?: string,
    evidence: Record<string, unknown> = {}) => ({
      row_kind: 'source_item', row_number: n, source_record_key: `source-${n}`, source_path: `row-${n}`,
      source_product_key: key, source_product_key_origin: 'supplier_provided',
      item_fingerprint: h('a'), action_fingerprint: h(n === 1 ? 'b' : 'c'),
      proposed_action: action, validation_status: 'valid', validation_errors: [], validation_warnings: [],
      proposed_product: candidate(id, key, description, cost), proposed_diff: { costChange: Boolean(cost) }, ...evidence,
    })
  async function freeze(id: string, policy = {}) {
    return (await q('SELECT public.block2e_freeze_plan($1::uuid,$2::jsonb) AS fingerprint', [id, JSON.stringify(policy)]))[0].fingerprint as string
  }
  async function approve(id: string, fp: string, flags: string[] = []) {
    await q('SELECT public.block2e_approve_run($1::uuid,$2,$3::uuid,$4::jsonb)', [id, fp, actor, JSON.stringify(flags)])
  }
  async function apply(id: string, row: string, fp: string) {
    return (await q('SELECT public.block2e_apply_row($1::uuid,$2::uuid,$3) AS outcome', [id, row, fp]))[0].outcome
  }
  async function createOwned() {
    await register()
    const id = await run('create-owned')
    const row = await stage(id, sourceRow(id, 'owned-key', 'create', 1, 'Owned', '10'))
    const fp = await freeze(id)
    await approve(id, fp)
    const outcome = await apply(id, row, fp)
    return { id, row, fp, outcome }
  }
  async function stageUpdate(key: string, cost: string, description = 'Updated') {
    const owned = (await q('SELECT id,updated_at,product_revision FROM public.supplier_products WHERE source_product_key=$1', [key]))[0]
    const id = await run(`update-${cost}-${description}`)
    const row = await stage(id, sourceRow(id, key, 'update', 1, description, cost, {
      matched_product_id: owned.id, expected_product_revision: owned.product_revision,
      expected_product_updated_at: owned.updated_at,
    }))
    const fp = await freeze(id)
    await approve(id, fp)
    return { id, row, fp, owned }
  }

  it('Block 2D Admin RPC succeeds and advances revision; manual revision forcing is rejected', async () => {
    const prior = await current()
    await db.exec('SET ROLE service_role')
    try {
      await q('SELECT public.block2d_update_supplier_product($1::uuid,$2::uuid,$3::timestamptz,$4::jsonb,$5::uuid)',
        [supplier, product, prior.updated_at, JSON.stringify({ wholesale_cost: 11 }), actor])
    } finally { await db.exec('RESET ROLE') }
    expect((await current()).product_revision).toBe(2)
    expect((await q(`SELECT feed_run_id,feed_row_id FROM public.supplier_product_cost_events WHERE supplier_product_id='${product}'`)))
      .toEqual([{ feed_run_id: null, feed_row_id: null }])
    await expect(q(`UPDATE public.supplier_products SET product_revision=100 WHERE id='${product}'`)).rejects.toThrow('database-owned')
    await expect(q(`UPDATE public.supplier_products SET product_revision=1 WHERE id='${product}'`)).rejects.toThrow('database-owned')
    await q(`UPDATE public.supplier_products SET product_revision=product_revision WHERE id='${product}'`)
    expect((await current()).product_revision).toBe(3)
  })

  it('feed create begins at revision 1, has ownership and no initial cost event; replay is idempotent', async () => {
    const { id, row, fp, outcome } = await createOwned()
    expect(outcome).toMatchObject({ state: 'applied', productRevision: 1 })
    const saved = (await q('SELECT * FROM public.supplier_products WHERE id=$1', [outcome.productId]))[0]
    expect(saved).toMatchObject({ product_revision: 1, owner_feed_source_id: source, owner_scope_key: 'catalog-a', ownership_run_id: id })
    expect((await q('SELECT count(*)::int AS n FROM public.supplier_product_cost_events WHERE supplier_product_id=$1', [outcome.productId]))[0].n).toBe(0)
    expect(await apply(id, row, fp)).toMatchObject({ state: 'applied', productRevision: 1 })
    expect((await q('SELECT product_revision FROM public.supplier_products WHERE id=$1', [outcome.productId]))[0].product_revision).toBe(1)
  })

  it('matching feed revision updates cost once, returns revision 2 and checkpoints run/row audit provenance', async () => {
    const created = await createOwned()
    const { id, row, fp } = await stageUpdate('owned-key', '12')
    const result = await apply(id, row, fp)
    expect(result).toMatchObject({ state: 'applied', productRevision: 2, productId: created.outcome.productId })
    expect((await q('SELECT feed_run_id,feed_row_id FROM public.supplier_product_cost_events WHERE supplier_product_id=$1',
      [created.outcome.productId]))).toEqual([{ feed_run_id: id, feed_row_id: row }])
    expect(await apply(id, row, fp)).toMatchObject({ state: 'applied', productRevision: 2 })
    expect((await q('SELECT product_revision FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0].product_revision).toBe(2)
    expect((await q('SELECT count(*)::int AS n FROM public.supplier_product_cost_events WHERE supplier_product_id=$1',
      [created.outcome.productId]))[0].n).toBe(1)
  })

  it('stale revision 2 after same-transaction revision 3 conflicts with NO canonical write or cost event', async () => {
    const created = await createOwned()
    await db.exec('BEGIN')
    try {
      const first = await stageUpdate('owned-key', '11', 'First')
      expect((await apply(first.id, first.row, first.fp)).productRevision).toBe(2)
      const stale = await stageUpdate('owned-key', '13', 'Stale')
      const before = (await q('SELECT updated_at,product_revision FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0]
      await q('UPDATE public.supplier_products SET wholesale_cost=12 WHERE id=$1', [created.outcome.productId])
      const intervening = (await q('SELECT updated_at,product_revision,wholesale_cost FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0]
      expect(intervening.product_revision).toBe(3)
      expect(intervening.updated_at).toEqual(before.updated_at)
      const eventsBefore = (await q('SELECT count(*)::int AS n FROM public.supplier_product_cost_events WHERE supplier_product_id=$1', [created.outcome.productId]))[0].n
      expect(await apply(stale.id, stale.row, stale.fp)).toMatchObject({ state: 'conflict', reason: 'replan_required' })
      const after = (await q('SELECT product_revision,wholesale_cost FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0]
      expect(after.product_revision).toBe(3)
      expect(after.wholesale_cost).toBe(intervening.wholesale_cost)
      expect((await q('SELECT count(*)::int AS n FROM public.supplier_product_cost_events WHERE supplier_product_id=$1', [created.outcome.productId]))[0].n).toBe(eventsBefore)
      expect((await q('SELECT apply_disposition,status FROM public.supplier_feed_runs WHERE id=$1', [stale.id]))[0])
        .toMatchObject({ apply_disposition: 'replan_required', status: 'partially_applied' })
      await expect(apply(stale.id, stale.row, stale.fp)).resolves.toMatchObject({ state: 'conflict' })
    } finally { await db.exec('ROLLBACK') }
  })

  it('dry-run cannot be approved or applied, and a new apply run may reuse the checksum', async () => {
    await register()
    const dry = await run('simulation', 'dry_run')
    const dryRow = await stage(dry, sourceRow(dry, 'fresh', 'create', 1, 'Fresh'))
    const dryFp = await freeze(dry)
    expect((await q('SELECT status,mode FROM public.supplier_feed_runs WHERE id=$1', [dry]))[0])
      .toMatchObject({ status: 'planned', mode: 'dry_run' })
    await expect(approve(dry, dryFp)).rejects.toThrow('approval/acknowledgement mismatch')
    await expect(apply(dry, dryRow, dryFp)).rejects.toThrow('run/approval fingerprint mismatch')
    const requested = await run('real-application')
    expect((await q('SELECT source_checksum FROM public.supplier_feed_runs WHERE id=$1', [requested]))[0])
      .toEqual((await q('SELECT source_checksum FROM public.supplier_feed_runs WHERE id=$1', [dry]))[0])
    expect(requested).not.toBe(dry)
  })

  it('duplicate validated source keys cannot freeze; invalid rows remain reportable', async () => {
    await register()
    const id = await run('duplicate-source')
    await stage(id, sourceRow(id, 'same-key', 'create', 1, 'First'))
    await stage(id, sourceRow(id, 'same-key', 'create', 2, 'Second'))
    await expect(freeze(id)).rejects.toThrow('duplicate validated source product key')
    const invalidRun = await run('invalid-rows')
    await stage(invalidRun, {
      row_kind: 'source_item', row_number: 1, item_fingerprint: h('a'), action_fingerprint: h('b'),
      validation_status: 'invalid', validation_errors: [{ code: 'invalid_identity' }], proposed_action: 'reject',
    })
    const fp = await freeze(invalidRun)
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    expect((await q('SELECT error_count,plan_counts FROM public.supplier_feed_runs WHERE id=$1', [invalidRun]))[0])
      .toMatchObject({ error_count: 1, plan_counts: { reject: 1 } })
  })

  it('mass-change policy requires exact acknowledgement and partial runs resume by row checkpoint', async () => {
    await register()
    const id = await run('two-creates')
    const first = await stage(id, sourceRow(id, 'first-key', 'create', 1, 'First'))
    const second = await stage(id, sourceRow(id, 'second-key', 'create', 2, 'Second'))
    const fp = await freeze(id, { creates: { count: 1 } })
    expect((await q('SELECT anomaly_flags,plan_counts FROM public.supplier_feed_runs WHERE id=$1', [id]))[0])
      .toMatchObject({ anomaly_flags: ['creates'], plan_counts: { create: 2 } })
    await expect(approve(id, fp)).rejects.toThrow('approval/acknowledgement mismatch')
    await expect(approve(id, h('0'), ['creates'])).rejects.toThrow('approval/acknowledgement mismatch')
    await approve(id, fp, ['creates'])
    const a = await apply(id, first, fp)
    expect(a).toMatchObject({ state: 'applied', productRevision: 1 })
    expect((await q('SELECT status FROM public.supplier_feed_runs WHERE id=$1', [id]))[0].status).toBe('partially_applied')
    expect(await apply(id, first, fp)).toMatchObject({ state: 'applied', productRevision: 1 })
    expect(await apply(id, second, fp)).toMatchObject({ state: 'applied', productRevision: 1 })
    expect((await q('SELECT status FROM public.supplier_feed_runs WHERE id=$1', [id]))[0].status).toBe('applied')
    expect((await q('SELECT count(*)::int AS n FROM public.supplier_products WHERE ownership_run_id=$1', [id]))[0].n).toBe(2)
  })

  it('snapshot missing is scope-owned only, registered and independently acknowledged when empty', async () => {
    const created = await createOwned()
    const id = await run('snapshot-empty', 'apply_requested', 'snapshot', true)
    const missing = await stage(id, {
      row_kind: 'potential_missing', action_fingerprint: h('b'), proposed_action: 'potential_missing',
      validation_status: 'valid', matched_product_id: created.outcome.productId,
      expected_product_revision: 1, expected_product_updated_at:
        (await q('SELECT updated_at FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0].updated_at,
    })
    await expect(freeze(id)).rejects.toThrow('unsafe potential_missing plan')
    await q('SELECT public.block2e_ack_empty_snapshot($1::uuid,$2::uuid)', [id, actor])
    const fp = await freeze(id, { potentialMissing: { count: 0 } })
    expect((await q('SELECT anomaly_flags,empty_snapshot_ack_by FROM public.supplier_feed_runs WHERE id=$1', [id]))[0])
      .toMatchObject({ anomaly_flags: ['potentialMissing'], empty_snapshot_ack_by: actor })
    await approve(id, fp, ['potentialMissing'])
    expect(await apply(id, missing, fp)).toMatchObject({ state: 'skipped' })
    expect((await q('SELECT lifecycle,product_revision FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0])
      .toMatchObject({ lifecycle: 'active', product_revision: 1 })
  })

  it('non-authoritative snapshot and delta cannot stage potential_missing; ownership never backfills', async () => {
    await register(false)
    const delta = await run('delta')
    await expect(stage(delta, { row_kind: 'potential_missing', action_fingerprint: h('b'),
      proposed_action: 'potential_missing', matched_product_id: product })).rejects.toThrow('missing inference not eligible')
    const snapshot = await run('snapshot', 'apply_requested', 'snapshot', true)
    await expect(freeze(snapshot)).rejects.toThrow('source is not registered for authoritative snapshots')
    expect((await current()).owner_feed_source_id).toBeNull()
  })

  it('privileges deny untrusted feed reads and direct service-role canonical/cost mutations', async () => {
    await db.exec('SET ROLE authenticated')
    await expect(q('SELECT * FROM public.supplier_feed_sources')).rejects.toThrow()
    await expect(q('SELECT * FROM public.supplier_feed_runs')).rejects.toThrow()
    await db.exec('RESET ROLE')
    await db.exec('SET ROLE service_role')
    try {
      await expect(q(`UPDATE public.supplier_products SET wholesale_cost=100 WHERE id='${product}'`)).rejects.toThrow()
      await expect(q(`INSERT INTO public.supplier_product_cost_events (supplier_id,supplier_product_id,event_key)
        VALUES ('${supplier}','${product}','forged')`)).rejects.toThrow()
      const before = (await current()).updated_at
      await q('SELECT public.block2d_update_supplier_product($1::uuid,$2::uuid,$3::timestamptz,$4::jsonb,$5::uuid)',
        [supplier, product, before, JSON.stringify({ wholesale_cost: 11 }), actor])
      expect((await current()).product_revision).toBe(2)
    } finally { await db.exec('RESET ROLE') }
  })

  it('effective-date-only feed cost change is audited; alias resolves only to the same owned product', async () => {
    const created = await createOwned()
    await q('INSERT INTO public.supplier_product_aliases(supplier_id,supplier_product_id,alias_kind,alias_value) VALUES ($1,$2,$3,$4)',
      [supplier, created.outcome.productId, 'source_key', 'old-owned-key'])
    const target = (await q('SELECT id,updated_at,product_revision FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0]
    const id = await run('effective-date')
    const plan = sourceRow(id, 'old-owned-key', 'update', 1, 'Owned', '10', {
      matched_product_id: target.id, expected_product_revision: target.product_revision,
      expected_product_updated_at: target.updated_at,
    })
    plan.proposed_product.cost!.effectiveAt = '2026-10-09T00:00:00Z'
    const row = await stage(id, plan)
    const fp = await freeze(id, { costChanges: { proportion: 0.5 } })
    expect((await q('SELECT anomaly_flags FROM public.supplier_feed_runs WHERE id=$1', [id]))[0].anomaly_flags).toEqual(['costChanges'])
    await approve(id, fp, ['costChanges'])
    expect(await apply(id, row, fp)).toMatchObject({ state: 'applied', productRevision: 2 })
    expect((await q('SELECT old_effective_at,source_effective_at,feed_row_id FROM public.supplier_product_cost_events WHERE feed_run_id=$1', [id]))[0])
      .toMatchObject({ feed_row_id: row, source_effective_at: new Date('2026-10-09T00:00:00Z') })
    expect((await q('SELECT source_product_key FROM public.supplier_products WHERE id=$1', [created.outcome.productId]))[0].source_product_key).toBe('owned-key')
  })

  it('SKU collision cannot become a create, and a manual matching source key cannot be adopted', async () => {
    await register()
    await q(`UPDATE public.supplier_products SET source_product_key='manual-key',supplier_sku='SKU-7' WHERE id=$1`, [product])
    const id = await run('sku-collision')
    const proposed = sourceRow(id, 'fresh-key', 'create', 1, 'Fresh')
    ;(proposed.proposed_product.fields as Record<string, unknown>).supplierSku = 'sku-7'
    await stage(id, proposed)
    await expect(freeze(id)).rejects.toThrow('create collides')
    const manual = await run('manual-key-collision')
    await stage(manual, sourceRow(manual, 'manual-key', 'create', 1, 'Manual'))
    await expect(freeze(manual)).rejects.toThrow('create collides')
    expect((await current()).owner_feed_source_id).toBeNull()
  })

  it('asset metadata is shaped for canonical storage and candidate cannot set selling prices', async () => {
    await register()
    const id = await run('asset-create')
    const payload = sourceRow(id, 'asset-key', 'create', 1, 'Asset')
    ;(payload.proposed_product as Record<string, unknown>).asset = {
      sourceUrl: 'https://example.test/image.jpg', rightsStatus: 'permitted', permittedUses: ['catalog'],
    }
    ;(payload.proposed_product.fields as Record<string, unknown>).sellingPrice = '99999'
    const row = await stage(id, payload)
    const fp = await freeze(id)
    await approve(id, fp)
    const applied = await apply(id, row, fp)
    expect(applied.state).toBe('applied')
    const saved = (await q('SELECT image_permitted_uses,source_image_url,to_jsonb(p) AS product FROM public.supplier_products p WHERE id=$1',
      [applied.productId]))[0]
    expect(saved.image_permitted_uses).toEqual({ uses: ['catalog'] })
    expect(saved.source_image_url).toBe('https://example.test/image.jpg')
    expect(JSON.stringify(saved.product)).not.toContain('99999')
  })

  it('staged plan and retained metadata are immutable until a valid terminal retention purge', async () => {
    await register()
    const id = await run('retention')
    const row = await stage(id, sourceRow(id, 'retain-key', 'create', 1, 'Private'))
    const fp = await freeze(id)
    await expect(q('SELECT public.block2e_mark_retention_purged($1::uuid,false,true)', [id]))
      .rejects.toThrow('run not terminal')
    await approve(id, fp)
    await apply(id, row, fp)
    await expect(q('SELECT public.block2e_mark_retention_purged($1::uuid,false,true)', [id]))
      .rejects.toThrow('staging retention window active')
    await q('UPDATE public.supplier_feed_runs SET staging_purge_after=now()-interval \'1 day\' WHERE id=$1', [id])
    await q('SELECT public.block2e_mark_retention_purged($1::uuid,false,true)', [id])
    expect((await q('SELECT proposed_product,action_fingerprint,apply_state,result_product_revision FROM public.supplier_feed_rows WHERE id=$1',
      [row]))[0]).toMatchObject({ proposed_product: null, action_fingerprint: h('b'), apply_state: 'applied', result_product_revision: 1 })
  })

  it('explicitly finishes an approved empty run without missing inference or product mutation', async () => {
    await register()
    const id = await run('empty-run', 'apply_requested', 'snapshot', true)
    const fp = await freeze(id)
    expect((await q('SELECT plan_counts FROM public.supplier_feed_runs WHERE id=$1', [id]))[0].plan_counts.potential_missing).toBe(0)
    await approve(id, fp)
    await q('SELECT public.block2e_finish_empty_run($1::uuid,$2)', [id, fp])
    expect((await q('SELECT status FROM public.supplier_feed_runs WHERE id=$1', [id]))[0].status).toBe('applied')
    expect((await current()).product_revision).toBe(1)
  })

  it('a cost-audit insertion error rolls back canonical changes and checkpoints a retryable row failure', async () => {
    const created = await createOwned()
    const attempt = await stageUpdate('owned-key', '12', 'Attempt')
    await db.exec(`CREATE FUNCTION public.test_reject_cost_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
      CREATE TRIGGER test_reject_cost_event BEFORE INSERT ON public.supplier_product_cost_events
      FOR EACH ROW EXECUTE FUNCTION public.test_reject_cost_event();`)
    const before = (await q('SELECT product_revision,supplier_description,wholesale_cost FROM public.supplier_products WHERE id=$1',
      [created.outcome.productId]))[0]
    expect(await apply(attempt.id, attempt.row, attempt.fp)).toMatchObject({ state: 'failed' })
    expect((await q('SELECT product_revision,supplier_description,wholesale_cost FROM public.supplier_products WHERE id=$1',
      [created.outcome.productId]))[0]).toEqual(before)
    expect((await q('SELECT count(*)::int AS n FROM public.supplier_product_cost_events WHERE supplier_product_id=$1',
      [created.outcome.productId]))[0].n).toBe(0)
    expect((await q('SELECT status FROM public.supplier_feed_runs WHERE id=$1', [attempt.id]))[0].status).toBe('partially_applied')
    await db.exec('DROP TRIGGER test_reject_cost_event ON public.supplier_product_cost_events')
    expect(await apply(attempt.id, attempt.row, attempt.fp)).toMatchObject({ state: 'applied', productRevision: 2 })
  })

  it('an update preserves optional canonical fields omitted from the normalized candidate', async () => {
    const created = await createOwned()
    await q('UPDATE public.supplier_products SET supplier_sku=$1,collection_name=$2 WHERE id=$3',
      ['SKU-keep','Heritage',created.outcome.productId])
    const update = await stageUpdate('owned-key','12','Revised')
    expect(await apply(update.id, update.row, update.fp)).toMatchObject({ state: 'applied', productRevision: 3 })
    expect((await q('SELECT supplier_sku,collection_name FROM public.supplier_products WHERE id=$1',
      [created.outcome.productId]))[0]).toMatchObject({ supplier_sku: 'SKU-keep', collection_name: 'Heritage' })
  })

  it('denies direct service-role v1/v2 run and row writes; privileged v2 RPCs remain usable', async () => {
    await register()
    const id = await run('acl-v2')
    const row = await stage(id, sourceRow(id, 'safe-key', 'create', 1, 'Safe'))
    const legacy = (await q('INSERT INTO public.supplier_feed_runs(supplier_id,adapter_version) VALUES ($1,$2) RETURNING id',
      [supplier,'legacy']))[0].id
    await q('INSERT INTO public.supplier_feed_rows(feed_run_id,row_number,raw_record,proposed_action) VALUES ($1,1,$2::jsonb,$3)',
      [legacy,'{}','review'])
    await db.exec('SET ROLE service_role')
    try {
      await expect(q('INSERT INTO public.supplier_feed_runs(supplier_id,adapter_version) VALUES ($1,$2)',
        [supplier,'legacy'])).rejects.toThrow('permission denied')
      await expect(q('UPDATE public.supplier_feed_runs SET status=$1 WHERE id=$2', ['staged',legacy])).rejects.toThrow('permission denied')
      await expect(q('INSERT INTO public.supplier_feed_rows(feed_run_id,row_number,raw_record) VALUES ($1,2,$2::jsonb)',
        [legacy,'{}'])).rejects.toThrow('permission denied')
      await expect(q('UPDATE public.supplier_feed_rows SET proposed_action=$1 WHERE id=$2', ['review',row])).rejects.toThrow('permission denied')
      await expect(q('INSERT INTO public.supplier_feed_runs(supplier_id,adapter_version,persistence_version) VALUES ($1,$2,2)',
        [supplier,'new'])).rejects.toThrow('permission denied')
      await expect(q('UPDATE public.supplier_feed_runs SET persistence_version=2 WHERE id=$1', [legacy])).rejects.toThrow('permission denied')
      const viaRpc = (await q(`SELECT public.block2e_create_run($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS id`,
        [supplier, source, 'catalog-a', 'acl-v2-via-rpc', 'dry_run', 'delta', false,
          'fixture-adapter', '1', 'planner-1', h('f'), null, true, true, true, true]))[0].id
      await q('SELECT public.block2e_begin_staging($1::uuid)', [viaRpc])
      expect((await q('SELECT status FROM public.supplier_feed_runs WHERE id=$1', [viaRpc]))[0].status).toBe('staged')
    } finally { await db.exec('RESET ROLE') }
    expect((await q('SELECT status FROM public.supplier_feed_runs WHERE id=$1', [id]))[0].status).toBe('staged')
  })

  it('rejects spoofed feed provenance on the existing Block 2D Admin RPC', async () => {
    const prior = await current()
    await db.exec('BEGIN')
    try {
      await db.exec('SET ROLE service_role')
      await q("SELECT set_config('app.block2e_feed_run_id',$1,true),set_config('app.block2e_feed_row_id',$2,true)",
        ['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'])
      await expect(q('SELECT public.block2d_update_supplier_product($1::uuid,$2::uuid,$3::timestamptz,$4::jsonb,$5::uuid)',
        [supplier,product,prior.updated_at,JSON.stringify({ wholesale_cost: 99 }),actor])).rejects.toThrow('invalid feed cost provenance')
    } finally { await db.exec('ROLLBACK') }
    expect(await current()).toMatchObject({ product_revision: 1, wholesale_cost: '10' })
    expect((await q('SELECT count(*)::int AS n FROM public.supplier_product_cost_events WHERE supplier_product_id=$1', [product]))[0].n).toBe(0)
  })
})
