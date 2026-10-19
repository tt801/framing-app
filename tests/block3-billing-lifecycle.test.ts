// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- Stripe/Supabase transport fixtures; billing RPCs execute real repository SQL. */
// Local only: install @electric-sql/pglite outside this repo, then set
// BLOCK3_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js when running Vitest.
// No URL/DSN is accepted. Auth identities and provider responses are synthetic.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as any, user: 'owner-a', subscriptions: [] as any[], sessions: new Map<string, any>(), failCreate: false, failPortal: false, failList: false, sessionCounter: 0 }))
const companyA = '3a000000-0000-4000-8000-000000000001'
const companyB = '3a000000-0000-4000-8000-000000000002'
const ownerA = '3a000000-0000-4000-8000-000000000003'
const ownerB = '3a000000-0000-4000-8000-000000000004'
const staffA = '3a000000-0000-4000-8000-000000000005'
const stripe = vi.hoisted(() => ({
  customers: { create: vi.fn(), retrieve: vi.fn() },
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  subscriptions: { list: vi.fn(), retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  billingPortal: { sessions: { create: vi.fn() } },
  prices: { retrieve: vi.fn() },
}))
vi.mock('stripe', async importOriginal => {
  const { default: RealStripe } = await importOriginal<typeof import('stripe')>()
  return { default: class {
    webhooks = new RealStripe('sk_test_synthetic_local_only').webhooks
    customers = stripe.customers
    checkout = stripe.checkout
    subscriptions = stripe.subscriptions
    paymentIntents = stripe.paymentIntents
    billingPortal = stripe.billingPortal
    prices = stripe.prices
  } }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async (token: string) => ({ data: { user: token === 'local-owner' && state.user ? { id: state.user, email: 'owner@example.invalid' } : null }, error: null }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    // No replacement business rules: invoke the exact installed function.
    if (!/^[a-z_][a-z_0-9]*$/.test(name)) throw new Error('Invalid fixture RPC')
    const keys = Object.keys(args)
    try {
      const result = await state.db.query(`select * from public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')})`, Object.values(args))
      return { data: result.fields.length === 1 && result.fields[0].name === name ? result.rows[0][name] : result.rows, error: null }
    } catch (error) { return { data: null, error } }
  },
  from: (table: string) => {
    if (!['company_accounts', 'stripe_checkout_attempts'].includes(table)) throw new Error(`Unexpected table ${table}`)
    const filters: [string, unknown, string][] = []
    let columns = '*'
    let values: Record<string, unknown> | null = null
    const run = async (single = false) => {
      const args: unknown[] = []
      const bind = (value: unknown) => { args.push(value); return `$${args.length}` }
      const updates = values ? Object.entries(values).map(([key, value]) => `${key}=${bind(value)}`).join(',') : ''
      const where = filters.map(([key, value, op]) => `${key}${op}${bind(value)}`).join(' and ')
      try {
        const result = await state.db.query(`${values ? `update public.${table} set ${updates}` : `select ${columns} from public.${table}`} ${where ? `where ${where}` : ''}${values ? ' returning id' : ''}`, args)
        if (single && result.rows.length > 1) throw new Error('Ambiguous fixture result')
        return { data: single ? result.rows[0] || null : result.rows, error: null }
      } catch (error) { return { data: null, error } }
    }
    const query: any = {
      select: (selection: string) => { if (!values) columns = selection; return query },
      update: (next: Record<string, unknown>) => { values = next; return query },
      eq: (key: string, value: unknown) => { filters.push([key, value, '=']); return query },
      lte: (key: string, value: unknown) => { filters.push([key, value, '<=']); return run() },
      single: () => run(true), maybeSingle: () => run(true),
    }
    return query
  },
}) }))

const suite = process.env.BLOCK3_PGLITE_MODULE ? describe : describe.skip
suite('Block 3 local billing lifecycle: real handlers + PostgreSQL + signed synthetic events', () => {
  let checkout: any, manage: any, webhook: any, realStripe: any
  const query = (sql: string, args: unknown[] = []) => state.db.query(sql, args)
  const account = async () => (await query('select * from company_accounts where id=$1', [companyA])).rows[0]
  const writable = async () => (await query('select is_company_account_writable($1) as value', [companyA])).rows[0].value
  const response = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this }, end() { return this } } }
  const invoke = async (handler: any, req: any) => {
    const res = response()
    await state.db.exec('set role service_role')
    try {
      expect((await query('select current_user as role')).rows[0].role).toBe('service_role')
      await handler(req, res)
      return res.out
    } finally { await state.db.exec('reset role') }
  }
  const request = (priceId = 'price_starter') => ({ method: 'POST', headers: { authorization: 'Bearer local-owner', host: 'local.invalid' }, body: { priceId, isOneTime: priceId === 'price_founder', companyAccountId: companyB } })
  const confirm = (id: unknown) => ({ method: 'GET', headers: request().headers, query: { billingAction: 'confirm-checkout', session_id: id } })
  const subscription = (status = 'active', id = 'sub_a', price = 'price_starter'): any => ({ id, customer: 'cus_a', status, metadata: { company_account_id: companyA }, cancel_at: null, items: { data: [{ price: { id: price }, current_period_end: 2000000000 }] } })
  const deliver = async (id: string, type: string, object: any, signatureValid = true) => {
    const body = JSON.stringify({ id, type, created: 1, data: { object } })
    const signature = realStripe.webhooks.generateTestHeaderString({ payload: body, secret: signatureValid ? 'whsec_synthetic_local_only' : 'wrong_synthetic_secret' })
    return invoke(webhook, { method: 'POST', headers: { 'stripe-signature': signature }, async *[Symbol.asyncIterator]() { yield Buffer.from(body) } })
  }
  const reconcile = (id: string, object = subscription()) => deliver(id, 'customer.subscription.updated', object)
  const paidCheckout = async (price = 'price_starter') => {
    const started = await invoke(checkout, request(price))
    expect(started.status).toBe(200)
    const session = state.sessions.get(started.body.sessionId)
    Object.assign(session, { status: 'complete', payment_status: 'paid', subscription: price === 'price_founder' ? null : 'sub_a', payment_intent: price === 'price_founder' ? 'pi_a' : null })
    if (price !== 'price_founder') state.subscriptions = [subscription('active', 'sub_a', price)]
    expect((await deliver('evt_checkout', 'checkout.session.completed', session)).status).toBe(200)
    return session
  }
  beforeAll(async () => {
    const { PGlite } = createRequire(import.meta.url)(process.env.BLOCK3_PGLITE_MODULE!)
    state.db = new PGlite()
    await state.db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
      create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
      grant usage on schema auth to authenticated,anon;`)
    for (const path of ['TRIAL_SETUP.sql', 'TEAM_ACCESS_SETUP.sql', 'migrations/20260914_block1_access_controls.sql', 'migrations/20260914_block2a_customers.sql', 'migrations/20260914_block6b_catalog.sql', 'migrations/20260914_block3a_webhooks.sql', 'migrations/20260914_block3b_checkout.sql', 'migrations/20261001_founder_paid_history.sql', 'migrations/20261005_recurring_checkout_completion.sql']) await state.db.exec(readFileSync(path, 'utf8'))
    // Model hosted grants rather than relying on restrictive vanilla PG defaults.
    await state.db.exec(`grant usage on schema auth to service_role;
      grant all on all tables in schema public to service_role;
      grant all on stripe_checkout_attempts,stripe_subscription_reconciliation_locks,catalog_stock_adjustments to anon,authenticated;`)
    await state.db.exec(readFileSync('migrations/20261019_restrict_internal_coordination_tables.sql', 'utf8'))
    vi.stubEnv('SUPABASE_URL', 'http://local.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic_local_only')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic_local_only'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_synthetic_local_only')
    for (const plan of ['STARTER', 'GROWTH', 'PRO', 'FOUNDER']) vi.stubEnv(`VITE_STRIPE_PRICE_${plan}`, `price_${plan.toLowerCase()}`)
    vi.stubEnv('APP_BASE_URL', 'https://app.example.invalid'); vi.stubEnv('FOUNDER_MAX_PURCHASES', '1')
    checkout = (await import('../api/billing/create-checkout')).default
    manage = (await import('../api/billing/manage')).default
    webhook = (await import('../api/billing/webhook')).default
    const { default: Stripe } = await vi.importActual<typeof import('stripe')>('stripe')
    realStripe = new Stripe('sk_test_synthetic_local_only')
  }, 30000)
  beforeEach(async () => {
    await state.db.exec('reset role')
    await query("select set_config('request.jwt.claim.role','service_role',false)")
    await state.db.exec('truncate company_accounts,auth.users cascade')
    for (const [id, email] of [[ownerA, 'a'], [ownerB, 'b'], [staffA, 'staff']]) await query('insert into auth.users values($1,$2,now())', [id, `${email}@example.invalid`])
    for (const [id, owner, customer] of [[companyA, ownerA, 'cus_a'], [companyB, ownerB, 'cus_b']]) await query("insert into company_accounts(id,owner_user_id,stripe_customer_id,has_ever_paid_recurring) values($1,$2,$3,false)", [id, owner, customer])
    state.user = ownerA; state.subscriptions = []; state.sessions.clear(); state.failCreate = false; state.failPortal = false; state.failList = false; state.sessionCounter = 0
    vi.clearAllMocks()
    stripe.customers.retrieve.mockImplementation(async (id: string) => ({ id, metadata: {} }))
    stripe.checkout.sessions.create.mockImplementation(async (params: any) => {
      if (state.failCreate) throw new Error('Synthetic Stripe unavailable')
      const session = { id: `cs_local_${++state.sessionCounter}`, url: 'https://checkout.example.invalid/local', customer: params.customer, mode: params.mode, status: 'open', payment_status: 'unpaid', expires_at: Math.floor(Date.now()/1000)+2100 }
      state.sessions.set(session.id, session); return session
    })
    stripe.checkout.sessions.retrieve.mockImplementation(async (id: string) => { if (!state.sessions.has(id)) throw new Error('Synthetic session missing'); return state.sessions.get(id) })
    stripe.subscriptions.list.mockImplementation(async () => { if (state.failList) throw new Error('Synthetic Stripe list failure'); return { data: state.subscriptions, has_more: false } })
    stripe.subscriptions.retrieve.mockImplementation(async (id: string) => state.subscriptions.find(sub => sub.id === id))
    stripe.paymentIntents.retrieve.mockResolvedValue({ metadata: { company_account_id: companyA } })
    stripe.billingPortal.sessions.create.mockImplementation(async () => { if (state.failPortal) throw new Error('Synthetic portal unavailable'); return { url: 'https://portal.example.invalid/local' } })
  })
  afterAll(async () => { if (state.db) await state.db.close(); vi.unstubAllEnvs() })

  it('can buy the same recurring plan again after completed Checkout and cancellation', async () => {
    await paidCheckout()
    state.subscriptions = []
    expect((await deliver('evt_cancel', 'customer.subscription.deleted', subscription('canceled'))).status).toBe(200)
    expect(await writable()).toBe(false)
    const restart = await invoke(checkout, request())
    expect(restart.status).toBe(200)
    expect(restart.body.sessionId).not.toBe('cs_local_1')
    expect((await query("select count(*)::int as count from stripe_checkout_attempts where status='completed'")).rows[0].count).toBe(1)
    const session = state.sessions.get(restart.body.sessionId)
    Object.assign(session, { status: 'complete', payment_status: 'paid', subscription: 'sub_reactivated' })
    state.subscriptions = [subscription('active', 'sub_reactivated')]
    expect((await deliver('evt_reactivated_checkout', 'checkout.session.completed', session)).status).toBe(200)
    expect((await invoke(manage, confirm(session.id))).body.status).toBe('confirmed')
    expect(await writable()).toBe(true)
    expect((await query("select count(*)::int as count from stripe_checkout_attempts where status='completed'")).rows[0].count).toBe(2)
  })

  it.each(['starter', 'growth', 'pro'])('takes a trial through paid %s Checkout, confirmation and renewal', async plan => {
    expect(await writable()).toBe(true)
    const session = await paidCheckout(`price_${plan}`)
    const saved = await account()
    expect(saved).toMatchObject({ plan_status: 'active', stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', stripe_price_id: `price_${plan}`, has_ever_paid_recurring: false })
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ customer: 'cus_a', mode: 'subscription', line_items: [{ price: `price_${plan}`, quantity: 1 }], subscription_data: { metadata: { company_account_id: companyA } } })
    expect((await invoke(manage, confirm(session.id))).body.status).toBe('confirmed')
    expect((await invoke(manage, confirm(session.id))).body.status).toBe('confirmed')
    const current = subscription('active', 'sub_a', `price_${plan}`)
    current.items.data[0].current_period_end += 30 * 86400
    state.subscriptions = [current]
    expect((await reconcile('evt_renewal', current)).status).toBe(200)
    const invoice = { status: 'paid', amount_paid: 1900, customer: 'cus_a', parent: { subscription_details: { subscription: 'sub_a' } } }
    expect((await deliver('evt_invoice', 'invoice.payment_succeeded', invoice)).status).toBe(200)
    expect((await account()).has_ever_paid_recurring).toBe(true)
    expect((await account()).subscription_renewed_at.toISOString()).toBe(new Date(current.items.data[0].current_period_end * 1000).toISOString())
    expect(await writable()).toBe(true)
  })

  it('retries creation using the persisted key without granting access to an expired trial', async () => {
    await query("update company_accounts set trial_ends_at=now()-interval '1 second' where id=$1", [companyA])
    state.failCreate = true
    expect((await invoke(checkout, request())).status).toBe(400)
    expect(await writable()).toBe(false)
    state.failCreate = false
    expect((await invoke(checkout, request())).status).toBe(200)
    expect(stripe.checkout.sessions.create.mock.calls[0][1].idempotencyKey).toBe(stripe.checkout.sessions.create.mock.calls[1][1].idempotencyKey)
    expect(await writable()).toBe(false)
    expect((await account()).has_ever_paid_recurring).toBe(false)
  })

  it('reuses one pending Checkout for repeated requests', async () => {
    const first = await invoke(checkout, request())
    const second = await invoke(checkout, request())
    expect(first.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it.each(['price_arbitrary', ''])('rejects a non-configured price %s before calling Stripe', async price => {
    expect((await invoke(checkout, request(price))).status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect((await query('select * from stripe_checkout_attempts')).rows).toHaveLength(0)
  })

  it('rejects a forged one-time flag for a recurring plan', async () => {
    const req = request(); req.body.isOneTime = true
    expect((await invoke(checkout, req)).status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('derives billing ownership from the authenticated user, not a supplied company', async () => {
    state.user = staffA
    expect((await invoke(checkout, request())).status).toBe(400)
    const portal = { ...request(), query: { billingAction: 'create-portal' } }
    expect((await invoke(manage, portal)).status).toBe(400)
    state.user = ownerB
    const started = await invoke(checkout, request())
    expect(started.status).toBe(200)
    expect(state.sessions.get(started.body.sessionId).customer).toBe('cus_b')
    expect(stripe.checkout.sessions.create.mock.calls[0][0].subscription_data.metadata.company_account_id).toBe(companyB)
  })

  it.each([undefined, '', 'not-a-session', ['cs_local_1']])('rejects invalid confirmation input %j without a provider lookup', async id => {
    expect((await invoke(manage, confirm(id))).status).toBe(400)
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
    expect((await account()).plan_status).toBe('trialing')
  })

  it('does not confirm another company session, an unknown session, or an unpaid session', async () => {
    const started = await invoke(checkout, request())
    expect((await invoke(manage, confirm(started.body.sessionId))).body.status).toBe('pending')
    expect((await invoke(manage, confirm('cs_unknown'))).status).toBe(404)
    state.user = ownerB
    expect((await invoke(manage, confirm(started.body.sessionId))).status).toBe(404)
    expect((await account()).plan_status).toBe('trialing')
  })

  it('does not confirm an old completed Checkout after cancellation', async () => {
    const session = await paidCheckout()
    state.subscriptions = []
    await deliver('evt_cancel', 'customer.subscription.deleted', subscription('canceled'))
    expect((await invoke(manage, confirm(session.id))).body.status).toBe('pending')
    expect(await writable()).toBe(false)
  })

  it('keeps paid Checkout pending until webhook reconciliation and surfaces provider confirmation failure safely', async () => {
    const started = await invoke(checkout, request())
    Object.assign(state.sessions.get(started.body.sessionId), { status: 'complete', payment_status: 'paid', subscription: 'sub_a' })
    expect((await invoke(manage, confirm(started.body.sessionId))).body.status).toBe('pending')
    stripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error('Synthetic confirmation failure'))
    expect((await invoke(manage, confirm(started.body.sessionId))).status).toBe(400)
    expect((await account()).stripe_subscription_id).toBeNull()
  })

  it('rejects invalid or missing signatures before claiming an event', async () => {
    expect((await deliver('evt_invalid', 'customer.subscription.updated', subscription(), false)).status).toBe(400)
    expect((await invoke(webhook, { method: 'POST', headers: {} })).status).toBe(400)
    expect((await query('select * from stripe_webhook_logs')).rows).toHaveLength(0)
    expect((await account()).plan_status).toBe('trialing')
  })

  it('safely acknowledges unsupported events and processed duplicates without commercial mutation', async () => {
    expect((await deliver('evt_ignored', 'unhandled.synthetic', {})).status).toBe(200)
    expect((await deliver('evt_ignored', 'unhandled.synthetic', {})).body.duplicate).toBe(true)
    expect((await account()).plan_status).toBe('trialing')
    expect((await query('select attempt_count,status from stripe_webhook_logs')).rows[0]).toEqual({ attempt_count: 1, status: 'processed' })
  })

  it('replays a paid Checkout event without applying commercial state twice', async () => {
    const session = await paidCheckout()
    const snapshot = await account()
    expect((await deliver('evt_checkout', 'checkout.session.completed', session)).body.duplicate).toBe(true)
    expect(await account()).toEqual(snapshot)
    expect((await query("select * from stripe_checkout_attempts where status='completed'")).rows).toHaveLength(1)
  })

  it('reconciles delayed deletion and past-due payloads against current Stripe state', async () => {
    await paidCheckout()
    state.subscriptions = [subscription('active', 'sub_replacement')]
    expect((await deliver('evt_old_delete', 'customer.subscription.deleted', subscription('canceled', 'sub_old'))).status).toBe(200)
    expect((await reconcile('evt_old_past_due', subscription('past_due', 'sub_old'))).status).toBe(200)
    expect((await account()).stripe_subscription_id).toBe('sub_replacement')
    expect(await writable()).toBe(true)
  })

  it('keeps active access during scheduled cancellation, then becomes read-only on terminal cancellation', async () => {
    await paidCheckout()
    const scheduled = { ...subscription(), cancel_at: 2000000000 }
    state.subscriptions = [scheduled]
    expect((await reconcile('evt_scheduled', scheduled)).status).toBe(200)
    expect((await account()).subscription_cancel_at.toISOString()).toBe(new Date(2000000000 * 1000).toISOString())
    expect(await writable()).toBe(true)
    state.subscriptions = [subscription('canceled')]
    expect((await deliver('evt_cancel', 'customer.subscription.deleted', subscription('canceled'))).status).toBe(200)
    expect((await account()).plan_status).toBe('expired')
    expect(await writable()).toBe(false)
  })

  it.each(['past_due', 'unpaid', 'paused'])('makes %s read-only and restores access after authoritative active recovery', async status => {
    await paidCheckout()
    state.subscriptions = [subscription(status)]
    expect((await reconcile('evt_past_due', subscription(status))).status).toBe(200)
    expect((await account()).plan_status).toBe('past_due')
    expect(await writable()).toBe(false)
    state.subscriptions = [subscription()]
    expect((await reconcile('evt_recovered')).status).toBe(200)
    expect(await writable()).toBe(true)
  })

  it('does not regress state on provider failure, and safely retries the failed webhook', async () => {
    await paidCheckout()
    state.failList = true
    expect((await reconcile('evt_retry')).status).toBe(400)
    expect((await account()).plan_status).toBe('active')
    expect((await query("select status from stripe_webhook_logs where event_id='evt_retry'")).rows[0].status).toBe('failed')
    state.failList = false
    expect((await reconcile('evt_retry')).status).toBe(200)
    expect((await query("select status,attempt_count from stripe_webhook_logs where event_id='evt_retry'")).rows[0]).toEqual({ status: 'processed', attempt_count: 2 })
  })

  it('rejects conflicting tenant metadata and missing known-company metadata', async () => {
    const wrong = { ...subscription(), metadata: { company_account_id: companyB } }
    expect((await reconcile('evt_wrong', wrong)).status).toBe(400)
    expect((await reconcile('evt_missing', { ...subscription(), metadata: {} })).status).toBe(400)
    expect((await account()).plan_status).toBe('trialing')
    expect((await query('select plan_status from company_accounts where id=$1', [companyB])).rows[0].plan_status).toBe('trialing')
  })

  it('completes reserved Founder payment after trial/expiry timestamps and preserves lifetime on delayed deletion', async () => {
    const started = await invoke(checkout, request('price_founder'))
    expect(started.status).toBe(200)
    expect((await account()).stripe_price_id).toBeNull()
    expect((await query('select founder_reserved,status from stripe_checkout_attempts')).rows[0]).toEqual({ founder_reserved: true, status: 'pending' })
    await query("update company_accounts set trial_ends_at=now()-interval '1 hour' where id=$1", [companyA])
    await query("update stripe_checkout_attempts set expires_at=now()-interval '1 hour'")
    const session = state.sessions.get(started.body.sessionId)
    Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: 'pi_a' })
    expect((await deliver('evt_founder', 'checkout.session.completed', session)).status).toBe(200)
    expect((await deliver('evt_founder', 'checkout.session.completed', session)).body.duplicate).toBe(true)
    expect((await invoke(manage, confirm(session.id))).body).toMatchObject({ status: 'confirmed', kind: 'founder' })
    expect((await account()).has_ever_paid_recurring).toBe(false)
    expect((await account()).stripe_subscription_id).toBeNull()
    expect(await writable()).toBe(true)
    expect((await deliver('evt_late_delete', 'customer.subscription.deleted', subscription('canceled'))).status).toBe(200)
    expect((await account()).stripe_price_id).toBe('founder_lifetime')
    expect(await writable()).toBe(true)
    expect((await invoke(checkout, request())).status).toBe(400)
    expect((await invoke(manage, { ...request(), query: { billingAction: 'create-portal' } })).status).toBe(400)
  })

  it('releases failed Founder creation without creating paid entitlement', async () => {
    state.failCreate = true
    expect((await invoke(checkout, request('price_founder'))).status).toBe(400)
    expect((await query('select status,founder_reserved from stripe_checkout_attempts')).rows[0]).toEqual({ status: 'failed', founder_reserved: false })
    expect((await account()).stripe_price_id).toBeNull()
    state.failCreate = false
    expect((await invoke(checkout, request('price_founder'))).status).toBe(200)
  })

  it.each([true, null])('rejects Founder with paid-history %s', async history => {
    await query('update company_accounts set has_ever_paid_recurring=$1 where id=$2', [history, companyA])
    expect((await invoke(checkout, request('price_founder'))).status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('records positive paid history before Checkout but does not grant entitlement from an invoice alone', async () => {
    state.subscriptions = [subscription()]
    const invoice = { status: 'paid', amount_paid: 1900, customer: 'cus_a', parent: { subscription_details: { subscription: 'sub_a' } } }
    expect((await deliver('evt_invoice_first', 'invoice.payment_succeeded', invoice)).status).toBe(200)
    expect((await account()).has_ever_paid_recurring).toBe(true)
    expect((await account()).stripe_subscription_id).toBeNull()
    const session = await paidCheckout()
    expect((await invoke(manage, confirm(session.id))).body.status).toBe('confirmed')
  })

  it('binds the portal to the owner customer and configured return URL, including safe provider failure', async () => {
    await paidCheckout()
    const req = { ...request(), query: { billingAction: 'create-portal' }, body: { customerId: 'cus_b', return_url: 'https://attacker.invalid', companyAccountId: companyB } }
    expect((await invoke(manage, req)).status).toBe(200)
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_a', return_url: 'https://app.example.invalid#/billing' })
    state.failPortal = true
    expect((await invoke(manage, req)).status).toBe(400)
    expect((await account()).plan_status).toBe('active')
    await query('update company_accounts set stripe_customer_id=null where id=$1', [companyA])
    stripe.billingPortal.sessions.create.mockClear()
    expect((await invoke(manage, req)).status).toBe(400)
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })

  it('runs the existing rollback-contained Founder eligibility/history/RPC SQL acceptance', async () => {
    await state.db.exec('truncate company_accounts,auth.users cascade')
    await state.db.exec(readFileSync('tests/founder-paid-history-rpc.sql', 'utf8'))
    expect((await query('select * from company_accounts')).rows).toHaveLength(0)
  })

  it('retains a paid Founder reservation but releases only provider-confirmed expired/unpaid abandonment', async () => {
    const first = await invoke(checkout, request('price_founder'))
    expect(first.status).toBe(200)
    await query("update stripe_checkout_attempts set expires_at=now()-interval '1 hour'")
    Object.assign(state.sessions.get(first.body.sessionId), { status: 'complete', payment_status: 'paid' })
    state.user = ownerB
    expect((await invoke(checkout, request('price_founder'))).status).toBe(400)
    expect((await query("select founder_reserved from stripe_checkout_attempts where company_account_id=$1", [companyA])).rows[0].founder_reserved).toBe(true)
    Object.assign(state.sessions.get(first.body.sessionId), { status: 'expired', payment_status: 'unpaid' })
    expect((await invoke(checkout, request('price_founder'))).status).toBe(200)
    expect((await query("select founder_reserved,status from stripe_checkout_attempts where company_account_id=$1", [companyA])).rows[0]).toEqual({ founder_reserved: false, status: 'failed' })
    expect((await query('select stripe_price_id from company_accounts where id=$1', [companyB])).rows[0].stripe_price_id).toBeNull()
  })

  it('rejects unpaid and unreserved Founder completion without lifetime access', async () => {
    const started = await invoke(checkout, request('price_founder'))
    const session = state.sessions.get(started.body.sessionId)
    Object.assign(session, { status: 'complete', payment_intent: 'pi_a' })
    expect((await deliver('evt_unpaid_founder', 'checkout.session.completed', session)).status).toBe(400)
    expect((await account()).stripe_price_id).toBeNull()
    expect((await deliver('evt_unreserved_founder', 'checkout.session.completed', { ...session, id: 'cs_unreserved', payment_status: 'paid' })).status).toBe(400)
    expect((await account()).stripe_price_id).toBeNull()
  })

  it('rejects a foreign/customer-mismatched confirmation and a provider-expired attempt', async () => {
    const started = await invoke(checkout, request())
    const session = state.sessions.get(started.body.sessionId)
    session.customer = 'cus_b'
    expect((await invoke(manage, confirm(session.id))).status).toBe(409)
    session.customer = 'cus_a'; session.status = 'expired'
    expect((await invoke(manage, confirm(session.id))).body.status).toBe('rejected')
    expect((await account()).stripe_subscription_id).toBeNull()
  })

  it('does not reactivate a cancelled subscription from a delayed active payload', async () => {
    await paidCheckout()
    state.subscriptions = []
    expect((await deliver('evt_delete', 'customer.subscription.deleted', subscription('canceled'))).status).toBe(200)
    expect((await reconcile('evt_delayed_active', subscription())).status).toBe(200)
    expect((await account()).plan_status).toBe('expired')
    expect(await writable()).toBe(false)
  })

  it('enforces database event/reconciliation leases and safely reclaims an interrupted event', async () => {
    const token = '3a000000-0000-4000-8000-000000000011'
    const other = '3a000000-0000-4000-8000-000000000012'
    expect((await query("select * from claim_stripe_webhook('evt_lease','unhandled.synthetic','{}',$1,300)", [token])).rows[0].claimed).toBe(true)
    expect((await query("select * from claim_stripe_webhook('evt_lease','unhandled.synthetic','{}',$1,300)", [other])).rows[0].claimed).toBe(false)
    expect((await query("select finish_stripe_webhook('evt_lease',$1,'processed') as value", [other])).rows[0].value).toBe(false)
    expect((await deliver('evt_lease', 'unhandled.synthetic', {})).status).toBe(503)
    await query("update stripe_webhook_logs set claimed_at=now()-interval '10 minutes' where event_id='evt_lease'")
    expect((await deliver('evt_lease', 'unhandled.synthetic', {})).status).toBe(200)
    expect((await query('select claim_stripe_subscription_reconciliation($1,$2,300) as value', [companyA, token])).rows[0].value).toBe(true)
    expect((await reconcile('evt_locked')).status).toBe(400)
    expect((await account()).plan_status).toBe('trialing')
    expect((await query('select release_stripe_subscription_reconciliation($1,$2) as value', [companyA, other])).rows[0].value).toBe(false)
    expect((await query('select release_stripe_subscription_reconciliation($1,$2) as value', [companyA, token])).rows[0].value).toBe(true)
    state.subscriptions = [subscription()]
    expect((await reconcile('evt_locked')).status).toBe(200)
  })

  it('keeps every billing mutator server-only under actual PostgreSQL role privileges', async () => {
    const routines = (await query(`select p.oid::regprocedure::text as signature,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as client,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('begin_stripe_checkout_v2','begin_stripe_checkout',
      'save_stripe_checkout_session','expire_stripe_checkout_attempt','complete_founder_checkout_v2',
      'complete_founder_checkout','complete_recurring_checkout','record_paid_recurring_invoice',
      'claim_stripe_webhook','finish_stripe_webhook','claim_stripe_subscription_reconciliation',
      'release_stripe_subscription_reconciliation','reconcile_stripe_subscription_state','apply_stripe_subscription_event')`)).rows
    expect(routines).toHaveLength(14)
    for (const routine of routines) expect(routine, routine.signature).toMatchObject({ client: false, anon: false, service: true })
    await state.db.exec('set role authenticated')
    try {
      await expect(query("select * from claim_stripe_webhook('forged','unhandled.synthetic','{}',$1,300)", [ownerA])).rejects.toThrow(/permission denied/)
      await expect(query("update company_accounts set stripe_price_id='founder_lifetime' where id=$1", [companyA])).rejects.toThrow(/permission denied/)
      await expect(query("update stripe_checkout_attempts set status='completed'")).rejects.toThrow(/permission denied/)
      await expect(query("insert into stripe_webhook_logs(event_id,event_type,payload) values('forged','checkout.session.completed','{}')")).rejects.toThrow(/permission denied/)
    } finally { await state.db.exec('reset role') }
    expect((await account()).stripe_price_id).toBeNull()
  })
})
