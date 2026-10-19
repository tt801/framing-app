// Local-only PostgreSQL acceptance. No network connection or hosted credentials.
// Install @electric-sql/pglite outside the repository, then run:
// BLOCK2_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/block2-tenancy.acceptance.mjs
// Auth identity functions are fixtures; tenancy, membership and commercial SQL are repository definitions.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.BLOCK2_PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
const id = n => `2a000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [a, b, ownerA, staffA, ownerB, staffB, invitee, outsider, unconfirmed] = Array.from({ length: 9 }, (_, i) => id(i + 1))
let checks = 0
const q = (sql, args = []) => db.query(sql, args)
const check = (value, message) => { assert.ok(value, message); checks++ }
const reject = async (sql, args, pattern) => { await assert.rejects(q(sql, args), pattern); checks++ }
const system = async () => { await db.exec('reset role'); await q("select set_config('request.jwt.claim.role','',false)") }
const asUser = async user => {
  await system()
  await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$2,false)", [user || '', JSON.stringify({ email: `${user}@test.invalid` })])
  await db.exec('set role authenticated')
}
const jobPayload = { createdAt: '2026-10-16T00:00:00Z', status: 'new', customer: {}, artwork: {}, frame: {}, checklist: [] }
const invoicePayload = { ...jobPayload, items: [], subtotal: 10, tax: 0, total: 10, payments: [] }
const createJob = 'select * from public.create_job($1,$2,$3,$4,$5,$6,null)'
const createInvoice = 'select * from public.create_invoice($1,$2,$3,$4,$5,$6,$7)'
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth to authenticated,anon;
  `)
  for (const path of [
    'TRIAL_SETUP.sql', 'TEAM_ACCESS_SETUP.sql', 'migrations/20260914_block1_access_controls.sql',
    'migrations/20260914_block2a_customers.sql', 'migrations/20260914_block2b_quotes.sql',
    'migrations/20260914_block2c_invoices.sql', 'migrations/20260914_block2d_jobs.sql',
    'migrations/20260914_block6a_company_settings.sql', 'migrations/20260914_block6b_catalog.sql',
    'migrations/20260928_fix_company_settings_catalog_rls.sql', 'migrations/20260929_restrict_numbering_helpers.sql',
    'migrations/20260914_block3a_webhooks.sql', 'migrations/20260914_block3b_checkout.sql',
    'migrations/20261001_founder_paid_history.sql', 'migrations/20261005_recurring_checkout_completion.sql',
    'migrations/20261019_restrict_internal_coordination_tables.sql',
  ]) await db.exec(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  for (const user of [ownerA, staffA, ownerB, staffB, invitee, outsider, unconfirmed])
    await q('insert into auth.users values($1,$2,$3)', [user, `${user}@test.invalid`, user === unconfirmed ? null : '2026-01-01'])
  for (const [company, owner] of [[a, ownerA], [b, ownerB]]) {
    await q("insert into company_accounts(id,owner_user_id,company_name,plan_status) values($1,$2,$3,'active')", [company, owner, company === a ? 'Company A' : 'Company B'])
    await q('insert into company_settings(company_account_id,settings) values($1,$2)', [company, { companyName: company }])
    await q('insert into company_catalog(company_account_id,catalog) values($1,$2)', [company, { frames: [{ id: 'oak', name: 'Oak' }] }])
    const label = company === a ? 'a' : 'b'
    await q('insert into customers(id,company_account_id,first_name,last_name,email) values($1,$2,$3,$4,$5)', [`c-${label}`, company, 'Test', label, `${label}@test.invalid`])
    await q('insert into quotes(id,company_account_id,customer_id,payload) values($1,$2,$3,$4)', [`q-${label}`, company, `c-${label}`, { ...invoicePayload, customerId: `c-${label}`, status: 'Accepted' }])
    await q('insert into invoices(id,company_account_id,customer_id,quote_id,invoice_number,payload) values($1,$2,$3,$4,$5,$6)', [`i-${label}`, company, `c-${label}`, `q-${label}`, `INV-${label}`, invoicePayload])
    await q('insert into jobs(id,company_account_id,ref_no,customer_id,quote_id,invoice_id,payload) values($1,$2,1000,$3,$4,$5,$6)', [`j-${label}`, company, `c-${label}`, `q-${label}`, `i-${label}`, jobPayload])
  }
  for (const [company, user, role] of [[a, ownerA, 'owner'], [a, staffA, 'staff'], [b, ownerB, 'owner'], [b, staffB, 'staff']])
    await q("insert into company_members(company_account_id,user_id,email,role,status) values($1,$2,$3,$4,'active')", [company, user, `${user}@test.invalid`, role])
  for (const user of [invitee, unconfirmed])
    await q("insert into company_members(company_account_id,email,role,status) values($1,$2,'staff','invited')", [a, `${user}@test.invalid`])

  for (const [user, company, foreign, label, foreignLabel, role] of [
    [ownerA, a, b, 'a', 'b', 'owner'], [staffA, a, b, 'a', 'b', 'staff'],
    [ownerB, b, a, 'b', 'a', 'owner'], [staffB, b, a, 'b', 'a', 'staff'],
  ]) {
    await asUser(user)
    for (const table of ['company_accounts', 'company_settings', 'company_catalog', 'customers', 'quotes', 'jobs', 'invoices']) {
      const column = table === 'company_accounts' ? 'id' : 'company_account_id'
      const rows = (await q(`select ${column} from public.${table}`)).rows
      check(rows.length > 0 && rows.every(row => row[column] === company), `${role} ${label}: only own ${table}`)
    }
    check((await q('update quotes set payload=payload where id=$1 returning id', [`q-${foreignLabel}`])).rows.length === 0, 'foreign quote mutation hidden by RLS')
    check((await q('update jobs set quote_id=$1 where id=$2 returning id', [`q-${label}`, `j-${foreignLabel}`])).rows.length === 0, 'foreign linked job mutation hidden by RLS')
    await reject('insert into quotes(id,company_account_id,customer_id,payload) values($1,$2,$3,$4)', [`bad-q-${user}`, company, `c-${foreignLabel}`, {}], /customer_id must belong/)
    await reject(createJob, [`bad-j-${user}`, company, jobPayload, `c-${label}`, `q-${foreignLabel}`, null], /quote_id must belong/)
    await reject('update jobs set invoice_id=$1 where id=$2', [`i-${foreignLabel}`, `j-${label}`], /invoice_id must belong/)
    await reject(createInvoice, [`bad-i-${user}`, company, `c-${label}`, `q-${foreignLabel}`, invoicePayload, 'INV-', 1], /quote_id must belong/)
    await reject('select * from append_invoice_payment($1,$2,$3)', [company, `i-${foreignLabel}`, { id: 'bad', amount: 1 }], /Invoice not found/)
    await reject(createJob, [`bad-company-${user}`, foreign, jobPayload, `c-${foreignLabel}`, `q-${foreignLabel}`, null], /not allowed/)
    const ownJob = (await q(createJob, [`own-job-${user}`, company, jobPayload, `c-${label}`, `q-${label}`, null])).rows[0]
    check(ownJob.company_account_id === company, 'normal member job write allowed')
    const changed = (await q('update company_settings set settings=settings where company_account_id=$1 returning company_account_id', [company])).rows
    check(changed.length === (role === 'owner' ? 1 : 0), 'settings limited to owner/admin roles')
    if (role === 'staff') {
      await reject('select * from update_company_catalog($1,$2,1)', [company, {}], /not allowed/)
      await reject("update company_members set role='owner' where user_id=$1", [user], /permission denied/)
    }
  }
  await asUser(outsider)
  check((await q('select id from customers')).rows.length === 0, 'no-membership user cannot read company customers')
  await reject(createJob, ['outsider', a, jobPayload, 'c-a', 'q-a', null], /not allowed/)
  await reject('select * from accept_company_invitation()', [], /No pending invitation/)
  await asUser(unconfirmed)
  await reject('select * from accept_company_invitation()', [], /confirmed email/)
  await asUser(invitee)
  check((await q('select id from customers')).rows.length === 0, 'invited user has no commercial access before acceptance')
  const accepted = (await q('select * from accept_company_invitation()')).rows[0]
  check(accepted.company_account_id === a && accepted.user_id === invitee && accepted.status === 'active', 'confirmed intended recipient joins original company')
  check((await q('select id from customers')).rows.length === 1, 'accepted invitation becomes usable')
  await reject('select * from accept_company_invitation()', [], /No pending invitation/)
  await system()
  await q("update company_members set status='inactive' where user_id=$1", [staffA])
  await asUser(staffA)
  check((await q('select id from customers')).rows.length === 0, 'same identity loses reads immediately after deactivation')
  await reject(createJob, ['stale-staff', a, jobPayload, 'c-a', 'q-a', null], /not allowed/)
  await system()
  await q("update company_members set status='active' where user_id=$1", [staffA])

  for (const [status, end, writable] of [
    ['trialing', '2099-01-01', true], ['trialing', '2000-01-01', false],
    ['active', '2000-01-01', true], ['past_due', '2099-01-01', false], ['expired', '2099-01-01', false],
  ]) {
    await system()
    await q('update company_accounts set plan_status=$1,trial_ends_at=$2 where id=$3', [status, end, a])
    for (const user of [ownerA, staffA]) {
      await asUser(user)
      check((await q('select id from customers')).rows.length === 1, `${status}: existing data remains readable`)
      check((await q('select is_company_account_writable($1) as writable', [a])).rows[0].writable === writable, `${status}: real database entitlement rule`)
      const args = [`state-${status}-${end}-${user}`, a, jobPayload, 'c-a', 'q-a', null]
      if (writable) check((await q(createJob, args)).rows.length === 1, `${status}: write allowed`)
      else {
        await reject(createJob, args, /not allowed/)
        await reject('select * from append_invoice_payment($1,$2,$3)', [a, 'i-a', { id: 'read-only-payment', amount: 1 }], /not allowed/)
        check((await q('update quotes set payload=payload where id=$1 returning id', ['q-a'])).rows.length === 0, `${status}: direct write blocked`)
        const profile = await q('update company_accounts set company_name=$1 where id=$2 returning company_name', [`Approved profile ${status}-${end}`, a])
        check(profile.rows.length === (user === ownerA ? 1 : 0), `${status}: profile exception remains owner-only`)
      }
    }
  }
  // The company is now expired. Test direct browser-role DML, not a disabled UI.
  await asUser(ownerA)
  const profileWrite = await q('update company_accounts set company_name=$1 where id=$2 returning id,company_name', ['Changed while expired', a])
  check(profileWrite.rows.length === 1 && profileWrite.rows[0].company_name === 'Changed while expired', 'approved exception: expired owner may edit company_name')
  check((await q('select company_name from company_accounts where id=$1', [a])).rows[0].company_name === 'Changed while expired', 'approved profile edit persists')

  // Exactly the fields preserved by protect_company_account_client_fields(); no new account model.
  const protectedValues = {
    owner_user_id: outsider, plan_status: 'active', trial_started_at: '2098-01-01',
    trial_ends_at: '2099-01-01', trial_extended_days: 999,
    stripe_customer_id: 'forged-customer', stripe_subscription_id: 'forged-subscription',
    stripe_price_id: 'forged-price', subscription_renewed_at: '2099-01-01',
    subscription_cancel_at: '2099-01-01', has_ever_paid_recurring: true,
  }
  await system()
  const before = (await q('select * from company_accounts where id=$1', [a])).rows[0]
  await asUser(ownerA)
  for (const [field, value] of Object.entries(protectedValues)) {
    await reject(`update company_accounts set ${field}=$1 where id=$2`, [value, a], /permission denied/)
    await reject(`update company_accounts set company_name='Mixed attack',${field}=$1 where id=$2`, [value, a], /permission denied/)
  }
  await reject("update company_accounts set company_name='Founder attack',stripe_price_id='founder_lifetime' where id=$1", [a], /permission denied/)
  for (const user of [ownerA, staffA, invitee]) {
    await asUser(user)
    for (const [field, value] of Object.entries({ role: 'owner', status: 'active', company_account_id: b, user_id: outsider, email: 'forged@test.invalid' }))
      await reject(`update company_members set ${field}=$1 where user_id=$2`, [value, user], /permission denied/)
  }
  for (const user of [staffA, invitee, outsider, ownerB, staffB, unconfirmed]) {
    await asUser(user)
    check((await q("update company_accounts set company_name='Unauthorized' where id=$1 returning id", [a])).rows.length === 0, 'non-owner cannot exploit profile exception')
    if (user === ownerB) check((await q('select * from ensure_owner_membership()')).rows[0].company_account_id === b, 'foreign owner bootstrap only returns own company')
    else await reject('select * from ensure_owner_membership()', [], /No owned company account/)
  }
  await asUser(ownerA)
  check((await q("update company_accounts set company_name='Foreign attack' where id=$1 returning id", [b])).rows.length === 0, 'expired owner cannot edit foreign company')
  await system()
  const after = (await q('select * from company_accounts where id=$1', [a])).rows[0]
  for (const field of Object.keys(protectedValues)) check(JSON.stringify(after[field]) === JSON.stringify(before[field]), `${field} unchanged after client attacks`)
  check(after.company_name === before.company_name, 'unauthorized and mixed-field attacks do not change profile')

  // Independently exercise the existing trigger, bypassing grants only as the fixture administrator.
  // No client privileges/policies are changed; the authenticated JWT role activates the real guard.
  await q("select set_config('request.jwt.claim.role','authenticated',false)")
  const fields = Object.keys(protectedValues)
  await q(`update company_accounts set ${fields.map((field, i) => `${field}=$${i + 1}`).join(',')} where id=$${fields.length + 1}`, [...Object.values(protectedValues), a])
  await system()
  const guarded = (await q('select * from company_accounts where id=$1', [a])).rows[0]
  for (const field of fields) check(JSON.stringify(guarded[field]) === JSON.stringify(before[field]), `trigger independently preserves ${field}`)

  await asUser(ownerA)
  await q("update company_accounts set company_name='' where id=$1", [a])
  const bootstrap = (await q('select * from create_company_trial_account($1)', ['Profile bootstrap while expired'])).rows[0]
  check(bootstrap.id === a && bootstrap.plan_status === 'expired', 'profile bootstrap retains existing expired company, not a fresh trial')
  await system()
  const bootstrapped = (await q('select * from company_accounts where id=$1', [a])).rows[0]
  for (const field of fields) check(JSON.stringify(bootstrapped[field]) === JSON.stringify(before[field]), `bootstrap preserves ${field}`)
  check(bootstrapped.company_name === 'Profile bootstrap while expired', 'existing-account RPC permits approved profile administration')

  // Broader read-only DML/RPC checks retain readable records and unchanged commercial state.
  for (const user of [ownerA, staffA]) {
    await asUser(user)
    for (const table of ['customers', 'quotes', 'jobs', 'invoices', 'company_settings', 'company_catalog']) {
      check((await q(`select * from ${table}`)).rows.length > 0, `expired: ${table} readable`)
      const column = table === 'customers' ? 'first_name' : table === 'company_settings' ? 'settings' : table === 'company_catalog' ? 'catalog' : 'payload'
      check((await q(`update ${table} set ${column}=${column} where company_account_id=$1 returning company_account_id`, [a])).rows.length === 0, `expired: ${table} update blocked`)
    }
    for (const table of ['customers', 'quotes', 'jobs', 'invoices'])
      check((await q(`delete from ${table} where company_account_id=$1 returning id`, [a])).rows.length === 0, `expired: ${table} delete blocked`)
    await reject(createInvoice, [`expired-invoice-${user}`, a, 'c-a', 'q-a', invoicePayload, 'INV-', 1], /not allowed/)
    await reject('select * from update_company_catalog($1,$2,1)', [a, {}], /not allowed/)
    await reject('select next_job_reference($1,null)', [a], /permission denied/)
    await reject('select next_invoice_number($1,$2,1)', [a, 'INV-'], /permission denied/)
    await reject("insert into quotes(id,company_account_id,payload) values($1,$2,'{}')", [`expired-quote-${user}`, a], /row-level security/)
  }

  // Wrong identity cannot claim a pending invitation even with a spoofed JWT email.
  await asUser(outsider)
  await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ email: `${unconfirmed}@test.invalid` })])
  await reject('select * from accept_company_invitation()', [], /No pending invitation/)
  await reject('select * from ensure_owner_membership()', [], /No owned company account/)
  await system()
  const boundIdentity = id(10)
  await q('insert into auth.users values($1,$2,now())', [boundIdentity, `${boundIdentity}@test.invalid`])
  await q("insert into company_members(company_account_id,user_id,email,role,status) values($1,$2,$3,'staff','invited')", [a, boundIdentity, `${outsider}@test.invalid`])
  await asUser(outsider)
  await reject('select * from accept_company_invitation()', [], /No pending invitation/)
  await system()
  await q("insert into company_members(company_account_id,email,role,status) values($1,$2,'staff','invited')", [b, `${staffA}@test.invalid`])
  await asUser(staffA)
  await reject('select * from accept_company_invitation()', [], /duplicate key/)
  check((await q('select company_account_id,status from company_members where user_id=$1', [staffA])).rows[0].company_account_id === a, 'conflicting invitation cannot relocate an existing member')
  await asUser(unconfirmed)
  await reject('select * from create_company_trial_account($1)', ['Hijack'], /Existing company membership or invitation/)
  await system()
  await q("update company_members set status='inactive' where email=$1", [`${unconfirmed}@test.invalid`])
  await asUser(unconfirmed)
  await reject('select * from accept_company_invitation()', [], /confirmed email/)
  await system()
  await q('update auth.users set email_confirmed_at=now() where id=$1', [unconfirmed])
  await asUser(unconfirmed)
  await reject('select * from accept_company_invitation()', [], /No pending invitation/)
  await asUser(invitee)
  await reject('select * from create_company_trial_account($1)', ['Wrong workspace'], /Existing company membership or invitation/)
  await system()
  await q('delete from company_members where user_id=$1', [invitee])
  await asUser(invitee)
  check((await q('select id from quotes')).rows.length === 0, 'deleted membership immediately loses access with same JWT')
  await reject(createJob, ['deleted-member', a, jobPayload, 'c-a', 'q-a', null], /not allowed/)
  await asUser(ownerA)
  await reject('select * from begin_stripe_checkout_v2($1,$2,$3,false,10)', [a, 'forged', 'forged'], /permission denied/)
  await reject('select record_paid_recurring_invoice($1,$2,$3,$4,$5)', [a, 'forged', outsider, 'forged', 'forged'], /permission denied/)
  await reject('select complete_recurring_checkout($1,$2,$3,$4,$5,$6)', [a, 'forged', 'forged', 'forged', 'forged', outsider], /permission denied/)
  await asUser(null)
  await reject('select * from accept_company_invitation()', [], /Authentication/)
  await reject('select * from create_company_trial_account($1)', ['Anonymous'], /Authentication/)
  await system()
  await db.exec('set role anon')
  await reject('select company_name from company_accounts', [], /permission denied/)
  await reject('select id from quotes', [], /permission denied/)
  console.log(`PASS: ${checks} local PostgreSQL tenancy / membership / invitation / entitlement / approved profile-exception assertions`)
} finally { await db.close() }
