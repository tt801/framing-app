// Local-only PostgreSQL acceptance; no DSN, network or hosted credentials.
// INTERNAL_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/internal-table-privileges.acceptance.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.INTERNAL_PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
const q = (sql, args = []) => db.query(sql, args)
let checks = 0
const check = (value, message) => { assert.ok(value, message); checks++ }
const id = n => `19000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [a, b, c, owner, manager, member, inactive, otherOwner, expiredOwner] = Array.from({ length: 9 }, (_, i) => id(i + 1))
const tables = ['stripe_checkout_attempts', 'stripe_subscription_reconciliation_locks', 'catalog_stock_adjustments']
const migration = 'migrations/20261019_restrict_internal_coordination_tables.sql'
const operations = table => {
  const insert = table === tables[0]
    ? `insert into ${table}(company_account_id,price_id,idempotency_key,expires_at) values('${b}','price_probe','probe',now()+interval '1 hour')`
    : table === tables[1]
      ? `insert into ${table}(company_account_id,lease_token) values('${b}','${id(90)}')`
      : `insert into ${table}(company_account_id,adjustment_key) values('${b}','probe')`
  const assignment = table === tables[0] ? "status='completed'" : table === tables[1] ? `lease_token='${id(91)}'` : "adjustment_key='changed'"
  return [`select * from ${table}`, insert, `update ${table} set ${assignment} where company_account_id='${a}'`, `delete from ${table} where company_account_id='${a}'`, `truncate ${table}`]
}
async function as(role, user, fn) {
  await db.exec('begin')
  try {
    await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [user || '', role])
    await db.exec(`set local role ${role}`)
    check((await q('select current_user as role')).rows[0].role === role, `actual role ${role}`)
    return await fn()
  } finally { await db.exec('rollback') }
}
async function denied(sql, args = [], message = /permission denied/) {
  await db.exec('savepoint expected_denial')
  let caught
  try { await q(sql, args) } catch (error) { caught = error }
  await db.exec('rollback to savepoint expected_denial; release savepoint expected_denial')
  check(caught?.code === '42501' && message.test(caught.message), `authorization denial: ${sql}: ${caught?.message}`)
}
const stock = { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], stock: { frames: [{ profileId: 'oak', metersAvailable: 10 }], sheets: [], rolls: [] } }
const adjust = 'select * from adjust_company_stock($1,$2,$3,$4,$5)'
const meters = async company => (await q("select (catalog->'stock'->'frames'->0->>'metersAvailable')::int as meters from company_catalog where company_account_id=$1", [company])).rows[0].meters
async function rejectedStock(company, user, key) {
  await as('authenticated', user, async () => {
    await db.exec('savepoint bad_stock')
    let caught
    try { await q(adjust, [company, key, 'frame', 'oak', 2]) } catch (error) { caught = error }
    await db.exec('rollback to savepoint bad_stock; release savepoint bad_stock')
    check(caught?.message.includes('Catalog writes are not allowed'), `stock authorization for ${key}`)
  })
  check(await meters(company) === 10, 'rejected stock unchanged')
  check((await q('select * from catalog_stock_adjustments where adjustment_key=$1', [key])).rows.length === 0, 'rejected key absent')
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema auth to anon,authenticated,service_role;`)
  for (const path of ['TRIAL_SETUP.sql', 'TEAM_ACCESS_SETUP.sql', 'migrations/20260914_block1_access_controls.sql', 'migrations/20260914_block2a_customers.sql', 'migrations/20260914_block6b_catalog.sql', 'migrations/20260928_fix_company_settings_catalog_rls.sql', 'migrations/20260914_block3a_webhooks.sql', 'migrations/20260914_block3b_checkout.sql', 'migrations/20261001_founder_paid_history.sql', 'migrations/20261005_recurring_checkout_completion.sql']) {
    // The catalog policy correction also requires company_settings.
    if (path.endsWith('20260914_block6b_catalog.sql')) await db.exec(await readFile(new URL('../migrations/20260914_block6a_company_settings.sql', import.meta.url), 'utf8'))
    await db.exec(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  }
  for (const user of [owner, manager, member, inactive, otherOwner, expiredOwner]) await q('insert into auth.users values($1,$2,now())', [user, `${user}@example.invalid`])
  for (const [company, user, status] of [[a, owner, 'active'], [b, otherOwner, 'active'], [c, expiredOwner, 'expired']]) {
    await q('insert into company_accounts(id,owner_user_id,plan_status,has_ever_paid_recurring) values($1,$2,$3,false)', [company, user, status])
    await q('insert into company_catalog(company_account_id,catalog) values($1,$2)', [company, stock])
  }
  for (const [user, role, status] of [[manager, 'manager', 'active'], [member, 'staff', 'active'], [inactive, 'manager', 'inactive']]) await q('insert into company_members(company_account_id,user_id,email,role,status) values($1,$2,$3,$4,$5)', [a, user, `${user}@example.invalid`, role, status])
  await q("insert into stripe_checkout_attempts(company_account_id,price_id,idempotency_key,expires_at) values($1,'price_seed','seed',now()+interval '1 hour')", [a])
  await q('insert into stripe_subscription_reconciliation_locks(company_account_id,lease_token) values($1,$2)', [a, id(89)])
  await q("insert into catalog_stock_adjustments(company_account_id,adjustment_key) values($1,'seed')", [a])
  // Reproduce relevant hosted defaults explicitly, including a PUBLIC route.
  await db.exec('grant all on all tables in schema public to service_role')
  for (const table of tables) await db.exec(`grant all on ${table} to public,anon,authenticated,service_role`)
  for (const role of ['anon', 'authenticated']) for (const table of tables) for (const sql of operations(table)) {
    await as(role, owner, async () => {
      const result = await q(sql)
      if (sql.startsWith('select')) check(result.rows.length === 1, 'exposed pre-repair row')
      else if (!sql.startsWith('truncate')) check(result.affectedRows === 1, 'pre-repair mutation applied')
      else check((await q(`select * from ${table}`)).rows.length === 0, 'pre-repair truncate applied')
    })
  }
  console.log('PRE-MIGRATION: both client roles can SELECT/INSERT/UPDATE/DELETE/TRUNCATE all three tables (rolled back)')
  const definitions = async () => (await q(`select p.oid,p.prosrc,p.prosecdef,p.proacl,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid`)).rows
  const before = await definitions()
  const serviceAcl = async () => (await q(`select c.relname,x.privilege_type,x.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) x where n.nspname='public' and c.relname=any($1) and x.grantee='service_role'::regrole order by 1,2`, [tables])).rows
  const serviceBefore = await serviceAcl()
  const sql = await readFile(new URL(`../${migration}`, import.meta.url), 'utf8')
  // Negative control: skip only the approved repair to see the post-repair assertion fail.
  if (!process.env.INTERNAL_PRIVILEGES_NEGATIVE_CONTROL) await db.exec(sql)
  for (const role of ['anon', 'authenticated']) for (const table of tables) for (const operation of operations(table)) await as(role, owner, () => denied(operation))
  for (const table of tables) {
    const row = (await q("select relrowsecurity from pg_class where oid=$1::regclass", [table])).rows[0]
    check(row.relrowsecurity, `${table} RLS enabled`)
    check((await q('select * from pg_policies where schemaname=\'public\' and tablename=$1', [table])).rows.length === 0, 'no policies')
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) check(!(await q('select has_table_privilege($1,$2,$3) as allowed', [role, table, privilege])).rows[0].allowed, 'no effective table privilege')
      check((await q(`select a.attname from pg_attribute a where a.attrelid=$2::regclass and a.attnum>0 and not a.attisdropped and (has_column_privilege($1,a.attrelid,a.attnum,'SELECT') or has_column_privilege($1,a.attrelid,a.attnum,'INSERT') or has_column_privilege($1,a.attrelid,a.attnum,'UPDATE') or has_column_privilege($1,a.attrelid,a.attnum,'REFERENCES'))`, [role, table])).rows.length === 0, 'no effective column privileges')
    }
    check((await q("select * from pg_class c cross join lateral aclexplode(c.relacl) x where c.oid=$1::regclass and x.grantee=0", [table])).rows.length === 0, 'no PUBLIC privileges')
  }
  assert.deepEqual(await definitions(), before); checks++
  assert.deepEqual(await serviceAcl(), serviceBefore); checks++
  await db.exec(sql)
  assert.deepEqual(await definitions(), before); checks++
  assert.deepEqual(await serviceAcl(), serviceBefore); checks++
  console.log('POST-MIGRATION: client denials, RLS, ACLs, unchanged functions/service grants and second execution PASS')
  const billingRoutines = (await q(`select p.proname,oidvectortypes(p.proargtypes) as types,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('begin_stripe_checkout_v2','begin_stripe_checkout',
      'save_stripe_checkout_session','expire_stripe_checkout_attempt','complete_founder_checkout_v2',
      'complete_founder_checkout','complete_recurring_checkout','record_paid_recurring_invoice',
      'claim_stripe_webhook','finish_stripe_webhook','claim_stripe_subscription_reconciliation',
      'release_stripe_subscription_reconciliation','reconcile_stripe_subscription_state','apply_stripe_subscription_event')`)).rows
  check(billingRoutines.length === 14, 'all server-only billing signatures present')
  for (const routine of billingRoutines) {
    check(routine.service, `service EXECUTE retained: ${routine.proname}`)
    for (const role of ['anon', 'authenticated']) await as(role, owner, () => denied(
      `select * from public.${routine.proname}(${routine.types.split(', ').map(type => `null::${type}`).join(',')})`,
    ))
  }
  for (const table of tables) for (const operation of operations(table)) await as('service_role', null, () => q(operation))
  console.log('SERVICE ROLE: real-role direct operations remain permitted')
  for (const user of [owner, manager]) await as('authenticated', user, async () => {
    await q(adjust, [a, 'once', 'frame', 'oak', 2])
    check(await meters(a) === 12, 'authorized stock changed')
    await q(adjust, [a, 'once', 'frame', 'oak', 2])
    check(await meters(a) === 12, 'stock replay not applied twice')
    await db.exec('set local role service_role')
    check((await q("select * from catalog_stock_adjustments where company_account_id=$1 and adjustment_key='once'", [a])).rows.length === 1, 'exactly one deduplication key')
  })
  await as('authenticated', owner, async () => {
    await q(adjust, [a, 'shared', 'frame', 'oak', 1])
    await q("select set_config('request.jwt.claim.sub',$1,true)", [otherOwner])
    await q(adjust, [b, 'shared', 'frame', 'oak', 3])
    check(await meters(b) === 13, 'same key independent in other tenant')
    await db.exec('set local role service_role')
    check(await meters(a) === 11, 'original tenant adjustment intact')
    check((await q("select * from catalog_stock_adjustments where adjustment_key='shared'")).rows.length === 2, 'two company-scoped keys')
  })
  await rejectedStock(b, owner, 'foreign')
  await rejectedStock(a, member, 'member')
  await rejectedStock(a, inactive, 'inactive')
  await rejectedStock(c, expiredOwner, 'readonly')
  // Force ledger insertion to fail after stock UPDATE: the RPC statement must be atomic.
  await db.exec(`create function reject_test_adjustment() returns trigger language plpgsql as $$begin if new.adjustment_key='fail-after-stock' then raise exception 'synthetic ledger failure'; end if; return new; end$$;
    create trigger reject_test_adjustment before insert on catalog_stock_adjustments for each row execute function reject_test_adjustment();`)
  await as('authenticated', owner, async () => {
    await db.exec('savepoint failed_rpc')
    let caught
    try { await q(adjust, [a, 'fail-after-stock', 'frame', 'oak', 2]) } catch (error) { caught = error }
    await db.exec('rollback to savepoint failed_rpc; release savepoint failed_rpc')
    check(caught?.message.includes('synthetic ledger failure'), 'failure reached ledger insert')
    check(await meters(a) === 10, 'stock UPDATE rolled back with failed ledger insert')
    await db.exec('set local role service_role')
    check((await q("select * from catalog_stock_adjustments where adjustment_key='fail-after-stock'")).rows.length === 0, 'failed key absent')
  })
  await db.exec('drop trigger reject_test_adjustment on catalog_stock_adjustments; drop function reject_test_adjustment()')
  // Existing browser catalog reads, initial INSERT and revisioned RPC save still work.
  await as('authenticated', owner, async () => {
    check(await meters(a) === 10, 'normal catalog load')
    await q('select * from update_company_catalog($1,$2,1)', [a, { ...stock, marker: 'saved' }])
    const saved = (await q('select catalog,revision from company_catalog where company_account_id=$1', [a])).rows[0]
    check(saved.revision === 2 && saved.catalog.marker === 'saved', 'catalog reload sees persisted payload and revision')
    await db.exec('set local role service_role')
    await q('delete from company_catalog where company_account_id=$1', [a])
    await db.exec('set local role authenticated')
    await q('insert into company_catalog(company_account_id,catalog) values($1,$2)', [a, stock])
    check(await meters(a) === 10, 'initial catalog creation and reload')
  })
  // Execute the existing rollback-contained catalog/settings RLS regression too.
  await db.exec(`alter table auth.users add column aud text, add column role text,
    add column created_at timestamptz, add column updated_at timestamptz`)
  const catalogRls = await readFile(new URL('./company-settings-catalog-rls.sql', import.meta.url), 'utf8')
  await db.exec(catalogRls.replace(/^\\set ON_ERROR_STOP on\r?\n/m, ''))
  console.log('CATALOG/SETTINGS: existing company-settings-catalog-rls.sql PASS (rolled back)')
  console.log(`PASS: ${checks} internal-table/stock assertions; all local fixtures discarded on close`)
} finally { await db.close() }
