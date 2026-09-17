import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  account: { id: 'company-a', owner_user_id: 'user-a', stripe_customer_id: null, stripe_subscription_id: null, plan_status: 'trialing', stripe_price_id: null },
  attempt: null as any,
  customerSaveFailures: 0,
  sessionSaveFailures: 0,
  sessions: [] as any[],
  customers: [] as any[],
}))
const stripeMock = vi.hoisted(() => ({ customers: { create: vi.fn() }, checkout: { sessions: { create: vi.fn() } } }))
const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-a', email: 'a@test.local' } }, error: null })) },
  from: vi.fn(() => { const query: any = { values: null, select: () => query, eq: () => query, single: async () => { if (query.values?.stripe_customer_id && state.customerSaveFailures > 0) { state.customerSaveFailures -= 1; return { data: null, error: new Error('customer save failed') } } if (query.values?.stripe_customer_id) state.account.stripe_customer_id = query.values.stripe_customer_id; return { data: { ...state.account }, error: null } } }; query.update = (values: any) => { query.values = values; return query }; return query }),
  rpc: vi.fn(async (name: string, args: any) => {
    if (name === 'begin_stripe_checkout') {
      if (state.attempt && state.attempt.expires_at > Date.now()) return { data: [{ allowed: true, attempt_id: state.attempt.id, existing_session_id: state.attempt.session_id, existing_session_url: state.attempt.url, idempotency_key: state.attempt.key }], error: null }
      state.attempt = { id: 'attempt-a', key: args.p_idempotency_key, expires_at: Date.now() + 86400000, session_id: null, url: null }
      return { data: [{ allowed: true, attempt_id: state.attempt.id, existing_session_id: null, existing_session_url: null, idempotency_key: state.attempt.key }], error: null }
    }
    if (name === 'save_stripe_checkout_session') { if (state.sessionSaveFailures > 0) { state.sessionSaveFailures -= 1; return { data: null, error: new Error('session ledger save failed') } } state.attempt.session_id = args.p_session_id; state.attempt.url = args.p_session_url; return { data: true, error: null } }
    throw new Error(`unexpected rpc ${name}`)
  }),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseMock }))
vi.mock('stripe', () => ({ default: class Stripe { customers = stripeMock.customers; checkout = stripeMock.checkout } }))
process.env.SUPABASE_URL = 'http://local'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.STRIPE_SECRET_KEY = 'stripe'; process.env.VITE_STRIPE_PRICE_STARTER = 'price-regular'; process.env.VITE_STRIPE_PRICE_FOUNDER = 'price-founder'; process.env.FOUNDER_MAX_PURCHASES = '1'
const { default: handler } = await import('@/../api/billing/create-checkout')

const req = (priceId = 'price-regular') => ({ method: 'POST', headers: { authorization: 'Bearer token', host: 'local.test' }, body: { priceId, isOneTime: priceId === 'price-founder' } } as any)
const res = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this } } as any }

beforeEach(() => { state.account.stripe_customer_id = null; state.account.stripe_subscription_id = null; state.account.plan_status = 'trialing'; state.account.stripe_price_id = null; state.attempt = null; state.customerSaveFailures = 0; state.sessionSaveFailures = 0; state.sessions.length = 0; state.customers.length = 0; stripeMock.customers.create.mockReset(); stripeMock.checkout.sessions.create.mockReset() })

describe('Block 3B create-checkout handler', () => {
  it('concurrent requests converge on one session and customer', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' }); stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-a', url: 'https://checkout/a', expires_at: Math.floor(Date.now()/1000)+3600 })
    const a = res(); const b = res(); await Promise.all([handler(req(), a), handler(req(), b)])
    expect(new Set(stripeMock.customers.create.mock.calls.map(call => call[1].idempotencyKey)).size).toBe(1)
    expect(new Set(stripeMock.checkout.sessions.create.mock.calls.map(call => call[1].idempotencyKey)).size).toBe(1)
    expect(a.out.body.url || b.out.body.url).toBe('https://checkout/a')
  })
  it('retries a Stripe timeout with the same idempotency key and recovers', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' }); stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'cs-recovered', url: 'https://checkout/recovered', expires_at: Math.floor(Date.now()/1000)+3600 })
    const first = res(); await handler(req(), first); expect(first.out.status).toBe(400)
    const second = res(); await handler(req(), second); expect(second.out.status).toBe(200); expect(stripeMock.checkout.sessions.create.mock.calls[0][1].idempotencyKey).toBe(stripeMock.checkout.sessions.create.mock.calls[1][1].idempotencyKey)
  })
  it('uses the same Stripe customer idempotency after customer persistence failure', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-reused' }); stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-after-db-failure', url: 'https://checkout/ok', expires_at: Math.floor(Date.now()/1000)+3600 })
    state.customerSaveFailures = 1
    const first = res(); await handler(req(), first); expect(first.out.status).toBe(400)
    const second = res(); await handler(req(), second); expect(second.out.status).toBe(200); expect(stripeMock.customers.create.mock.calls[0][1].idempotencyKey).toBe(stripeMock.customers.create.mock.calls[1][1].idempotencyKey)
  })
  it('recovers the original Stripe session after session-ledger persistence failure', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-session-ledger' });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-session-ledger', url: 'https://checkout/session-ledger', expires_at: Math.floor(Date.now()/1000)+3600 });
    state.sessionSaveFailures = 1;
    const first = res(); await handler(req(), first); expect(first.out.status).toBe(400);
    const second = res(); await handler(req(), second);
    expect(second.out.status).toBe(200); expect(second.out.body).toMatchObject({ sessionId: 'cs-session-ledger', url: 'https://checkout/session-ledger' });
    expect(stripeMock.checkout.sessions.create.mock.calls).toHaveLength(2);
    expect(stripeMock.checkout.sessions.create.mock.calls[0][1].idempotencyKey).toBe(stripeMock.checkout.sessions.create.mock.calls[1][1].idempotencyKey);
  })
})
