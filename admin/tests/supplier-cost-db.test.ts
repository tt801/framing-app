import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
const supplierId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'
let db: PGlite
async function rows(sql: string) { return (await db.query(sql)).rows as Record<string, any>[] }
async function update(version: string, fields: Record<string, unknown>) {
  return db.query('SELECT public.block2d_update_supplier_product($1::uuid,$2::uuid,$3::timestamptz,$4::jsonb,$5::uuid)',
    [supplierId, productId, version, JSON.stringify(fields), actorId])
}
async function version() { return (await rows(`SELECT updated_at FROM public.supplier_products WHERE id = '${productId}'`))[0].updated_at as string }
async function events() { return rows('SELECT * FROM public.supplier_product_cost_events ORDER BY observed_at, id') }

beforeEach(async () => {
  db = new PGlite()
  // Only local disposable PostgreSQL. The external dependencies required by Block 2B
  // are schema-minimal fixtures; we execute the actual 2B + proposed 2D migration SQL.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE TABLE public.company_accounts(id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE public.company_members(company_account_id uuid, user_id uuid, status text, role text);
    CREATE FUNCTION public.is_company_account_writable(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`)
  await db.exec(migration('20261007_block2b_supplier_foundation.sql'))
  await db.exec(migration('20261008_block2d_supplier_cost_audit.sql'))
  await db.exec(`INSERT INTO public.suppliers(id,name,slug) VALUES ('${supplierId}','Example','example');
    INSERT INTO public.supplier_products(id,supplier_id,category,supplier_description,supplier_sku,
      wholesale_cost,cost_currency,cost_unit,cost_tax_basis,cost_effective_at)
      VALUES ('${productId}','${supplierId}','frame','Frame','SKU-1',10,'GBP','metre','exclusive','2026-10-08T00:00:00Z');`)
})
afterEach(async () => { await db.close() })

describe('Block 2D cost audit in disposable PostgreSQL', () => {
  it('accepts initial wholesale cost without an update event', async () => {
    expect((await events()).length).toBe(0)
    expect((await rows(`SELECT wholesale_cost FROM public.supplier_products WHERE id = '${productId}'`))[0].wholesale_cost).toBe('10')
  })
  it('does not append an event for unchanged cost metadata', async () => {
    await update(await version(), { display_description: 'New description' })
    expect((await events()).length).toBe(0)
    await update(await version(), { wholesale_cost: 10, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-08T00:00:00Z' })
    expect((await events()).length).toBe(0)
  })
  it('records exactly one append-only event for a wholesale cost change', async () => {
    await update(await version(), { wholesale_cost: 12 })
    const history = await events()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ old_cost: '10', new_cost: '12', old_currency: 'GBP', new_currency: 'GBP', actor_user_id: actorId, reason: 'platform admin cost update' })
    await expect(db.exec(`UPDATE public.supplier_product_cost_events SET new_cost = 30`)).rejects.toThrow(/append-only/)
    await expect(db.exec(`DELETE FROM public.supplier_product_cost_events`)).rejects.toThrow(/append-only/)
  })
  it('records currency, unit, tax basis and effective-date transitions', async () => {
    const before = await version()
    await update(before, { cost_currency: 'EUR', cost_unit: 'piece', cost_tax_basis: 'inclusive', cost_effective_at: '2026-11-01T00:00:00Z' })
    expect((await events()).length).toBe(1)
    expect((await events())[0]).toMatchObject({ old_currency: 'GBP', new_currency: 'EUR', old_unit: 'metre', new_unit: 'piece', old_tax_basis: 'exclusive', new_tax_basis: 'inclusive' })
    expect(new Date((await events())[0].old_effective_at).toISOString()).toBe('2026-10-08T00:00:00.000Z')
    expect(new Date((await events())[0].source_effective_at).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
  it('rolls back product metadata and cost when event insertion fails', async () => {
    const before = await version()
    await db.exec(`ALTER TABLE public.supplier_product_cost_events ADD CONSTRAINT test_fail_event CHECK (reason <> 'platform admin cost update')`)
    await expect(update(before, { wholesale_cost: 14, display_description: 'Must not persist' })).rejects.toThrow()
    expect((await rows(`SELECT wholesale_cost, display_description FROM public.supplier_products WHERE id = '${productId}'`))[0]).toMatchObject({ wholesale_cost: '10', display_description: null })
    expect((await events()).length).toBe(0)
  })
  it('rejects a retry after another edit and never duplicates the first event', async () => {
    const before = await version()
    await update(before, { wholesale_cost: 11 })
    await expect(update(before, { wholesale_cost: 11 })).rejects.toThrow(/version changed/)
    expect((await events()).length).toBe(1)
    await update(await version(), { wholesale_cost: 12 })
    await expect(update(before, { wholesale_cost: 11 })).rejects.toThrow(/version changed/)
    expect((await events()).map(row => row.new_cost).sort()).toEqual(['11', '12'])
    expect((await rows(`SELECT wholesale_cost FROM public.supplier_products WHERE id = '${productId}'`))[0].wholesale_cost).toBe('12')
  })
  it('audits clearing a cost without losing the prior tuple', async () => {
    await update(await version(), { wholesale_cost: null, cost_currency: null, cost_unit: null, cost_tax_basis: null, cost_effective_at: null })
    expect((await events())[0]).toMatchObject({ old_cost: '10', new_cost: null, old_currency: 'GBP', new_currency: null })
  })
  it('audits direct trusted updates and grants RPC to service_role only', async () => {
    await db.exec(`UPDATE public.supplier_products SET wholesale_cost = 12 WHERE id = '${productId}'`)
    expect((await events()).length).toBe(1)
    const grants = await rows(`SELECT has_function_privilege('service_role','public.block2d_update_supplier_product(uuid,uuid,timestamptz,jsonb,uuid)','EXECUTE') AS service,
      has_function_privilege('authenticated','public.block2d_update_supplier_product(uuid,uuid,timestamptz,jsonb,uuid)','EXECUTE') AS customer,
      has_function_privilege('anon','public.block2d_update_supplier_product(uuid,uuid,timestamptz,jsonb,uuid)','EXECUTE') AS anon`)
    expect(grants[0]).toMatchObject({ service: true, customer: false, anon: false })
  })
  it('executes the RPC and cost-audit trigger as service_role (not only as table owner)', async () => {
    const before = await version()
    await db.exec('SET ROLE service_role')
    try { await update(before, { wholesale_cost: 13 }) }
    finally { await db.exec('RESET ROLE') }
    expect((await events())[0]).toMatchObject({ old_cost: '10', new_cost: '13', actor_user_id: actorId })
  })
})
