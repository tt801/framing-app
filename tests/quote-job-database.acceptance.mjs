// Disposable PostgreSQL acceptance; never opens a network/database connection.
// Install @electric-sql/pglite outside the repo, then run:
// BLOCK1C_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/quote-job-database.acceptance.mjs
// Foundation auth/company/customer fixtures are minimal; commercial migrations are the actual repository SQL.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.BLOCK1C_PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
const a = '1c000000-0000-4000-8000-000000000001'
const b = '1c000000-0000-4000-8000-000000000002'
const owner = '1c000000-0000-4000-8000-000000000003'
let assertions = 0
const check = (condition, message) => { assert.ok(condition, message); assertions++ }
const query = (sql, args = []) => db.query(sql, args)
const rejects = async (sql, args, pattern) => { await assert.rejects(query(sql, args), pattern); assertions++ }
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('test.user_id', true), '')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.company_accounts(id uuid primary key, owner_user_id uuid, writable boolean default true);
    create table public.customers(id text primary key, company_account_id uuid references public.company_accounts(id));
    create function public.is_active_company_member(uuid) returns boolean language sql stable as $$select false$$;
    create function public.is_company_account_writable(uuid) returns boolean language sql stable security definer as
      $$select coalesce((select writable from public.company_accounts where id=$1),false)$$;
    create function public.touch_updated_at() returns trigger language plpgsql as
      $$begin new.updated_at=clock_timestamp(); return new; end$$;
    grant select on public.company_accounts, public.customers to authenticated;
  `)
  for (const name of ['20260914_block2b_quotes.sql', '20260914_block2c_invoices.sql', '20260914_block2d_jobs.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  await query('insert into public.company_accounts(id,owner_user_id) values ($1,$2),($3,$3)', [a, owner, b])
  await query('insert into public.customers values ($1,$2),($3,$4)', ['c-a', a, 'c-b', b])
  const payload = { status: 'Accepted', customerId: 'c-a', subtotal: 175.75, taxRate: 0.15, tax: 26.36, total: 202.11,
    currencyCode: 'GBP', customerSnapshot: { firstName: 'Saved' }, artwork: { widthCm: 40, heightCm: 30 },
    frame: { name: 'Oak' }, customer: { firstName: 'Saved' }, checklist: [], items: [{ description: 'Frame', qty: 1, unitPrice: 175.75 }],
    pricingSnapshot: { version: 1, currencyCode: 'GBP', tax: 26.36, total: 202.11 } }
  await query('insert into quotes(id,company_account_id,customer_id,payload) values ($1,$2,$3,$4),($5,$6,$7,$4)', ['q-a', a, 'c-a', payload, 'q-b', b, 'c-b'])
  await query("select set_config('test.user_id',$1,false)", [owner])
  await db.exec('set role authenticated')
  check((await query('select id from quotes order by id')).rows.map(row => row.id).join() === 'q-a', 'RLS hides company B quote')
  const create = 'select * from public.create_job($1,$2,$3,$4,$5,$6,null)'
  const args = ['quote-job:q-a', a, { ...payload, quoteId: 'q-a' }, 'c-a', 'q-a', null]
  const job = (await query(create, args)).rows[0]
  check(job.ref_no === 1001 && job.quote_id === 'q-a' && job.customer_id === 'c-a' && job.company_account_id === a, 'company-scoped allocated job and relationships')
  assert.deepEqual(job.payload.pricingSnapshot, payload.pricingSnapshot); assertions++
  await rejects(create, args, /duplicate key/)
  check((await query('select count(*)::int as n from jobs')).rows[0].n === 1, 'duplicate conversion primary key permits exactly one job')
  await rejects(create, ['foreign-company', b, payload, 'c-b', 'q-b', null], /not allowed/)
  await rejects(create, ['foreign-quote', a, payload, 'c-a', 'q-b', null], /quote_id must belong/)
  await rejects(create, ['foreign-customer', a, payload, 'c-b', 'q-a', null], /customer_id must belong/)
  await rejects(create, ['missing-quote', a, payload, 'c-a', 'missing', null], /quote_id must belong/)
  await rejects(create, ['missing-customer', a, payload, 'missing', 'q-a', null], /customer_id must belong/)
  const independent = (await query(create, ['independent', a, payload, 'c-a', null, null])).rows[0]
  check(independent.quote_id === null && independent.ref_no === 1002, 'independent jobs retain safe numbering after rejected conversions')
  const invoice = (await query('select * from public.create_invoice($1,$2,$3,$4,$5,$6,$7)', ['i-a', a, 'c-a', 'q-a', { ...payload, payments: [] }, 'INV-', 1200])).rows[0]
  check(invoice.invoice_number === 'INV-1200' && invoice.quote_id === 'q-a', 'quote invoice allocator and relationship')
  await query('update public.jobs set invoice_id=$1,payload=payload || $2::jsonb where id=$3 and company_account_id=$4', ['i-a', JSON.stringify({ invoiceId: 'i-a' }), 'quote-job:q-a', a])
  await rejects('update public.jobs set quote_id=$1 where id=$2', ['q-b', 'quote-job:q-a'], /quote_id must belong/)
  await rejects('update public.jobs set customer_id=$1 where id=$2', ['c-b', 'quote-job:q-a'], /customer_id must belong/)
  await query('select * from public.append_invoice_payment($1,$2,$3)', [a, 'i-a', { id: 'p1', amount: 50, method: 'cash' }])
  await query('select * from public.append_invoice_payment($1,$2,$3)', [a, 'i-a', { id: 'p1', amount: 50, method: 'cash' }])
  const saved = (await query('select j.quote_id,j.invoice_id,j.payload as job,i.payload as invoice from jobs j join invoices i on i.id=j.invoice_id where j.id=$1', ['quote-job:q-a'])).rows[0]
  check(saved.quote_id === 'q-a' && saved.invoice_id === 'i-a', 'relationships survive independent reads')
  check(saved.invoice.payments.length === 1 && saved.invoice.total - saved.invoice.payments[0].amount === 152.11, 'manual payment idempotence and balance')
  assert.deepEqual(saved.job.pricingSnapshot, saved.invoice.pricingSnapshot); assertions++
  await db.exec('reset role')
  await query('update public.company_accounts set writable=false where id=$1', [a])
  await db.exec('set role authenticated')
  await rejects(create, ['readonly', a, payload, 'c-a', 'q-a', null], /not allowed/)
  console.log(`PASS: ${assertions} disposable PostgreSQL commercial linkage / RLS / allocator / payment assertions`)
} finally {
  await db.close()
}
