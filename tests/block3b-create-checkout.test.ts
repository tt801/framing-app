import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  account: { id: 'company-a', owner_user_id: 'user-a', stripe_customer_id: null, stripe_subscription_id: null, plan_status: 'trialing', stripe_price_id: null, trial_started_at: '', trial_ends_at: '' },
  attempt: null as any,
  customerSaveFailures: 0,
  sessionSaveFailures: 0,
  sessions: [] as any[],
  customers: [] as any[],
  stale: [] as any[],
  history: false as boolean | null,
  completedFounders: 0,
  reservedFounders: 0,
}))
const stripeMock = vi.hoisted(() => ({ customers: { create: vi.fn() }, checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } } }))
const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-a', email: 'a@test.local' } }, error: null })) },
  from: vi.fn(() => { const query: any = { values: null, select: () => query, eq: () => query, lte: async () => ({ data: state.stale, error: null }), single: async () => { if (query.values?.stripe_customer_id && state.customerSaveFailures > 0) { state.customerSaveFailures -= 1; return { data: null, error: new Error('customer save failed') } } if (query.values?.stripe_customer_id) state.account.stripe_customer_id = query.values.stripe_customer_id; return { data: { ...state.account }, error: null } } }; query.update = (values: any) => { query.values = values; return query }; return query }),
  rpc: vi.fn(async (name: string, args: any): Promise<any> => {
    if (name === 'begin_stripe_checkout_v2') {
      const deny = (reason: string) => ({ data: [{ allowed: false, reason, attempt_id: null, existing_session_id: null, existing_session_url: null, idempotency_key: null, founder_reserved: false }], error: null })
      const account = state.account
      const founder = args.p_is_founder
      if (founder) {
        const now = Date.now()
        if (account.plan_status !== 'trialing' || state.history !== false || account.stripe_price_id === 'founder_lifetime' || account.stripe_subscription_id !== null ||
          new Date(account.trial_started_at).getTime() > now || new Date(account.trial_ends_at).getTime() <= now || new Date(account.trial_started_at).getTime() + 14 * 86400000 <= now) {
          return deny('Founder requires an unexpired original trial with verified never-paid history')
        }
      } else if (account.stripe_price_id === 'founder_lifetime' || account.stripe_subscription_id !== null) {
        return deny('Active subscription already exists')
      }
      if (state.attempt && state.attempt.expires_at > Date.now()) {
        if (founder && !state.attempt.session_id && state.attempt.key !== args.p_idempotency_key) return deny('Founder Checkout creation is in progress')
        return { data: [{ allowed: true, attempt_id: state.attempt.id, existing_session_id: state.attempt.session_id, existing_session_url: state.attempt.url, idempotency_key: state.attempt.key, founder_reserved: founder }], error: null }
      }
      if (founder && state.completedFounders + state.reservedFounders >= args.p_founder_max) return deny('Founder plan is sold out')
      state.attempt = { id: 'attempt-a', key: args.p_idempotency_key, expires_at: Date.now() + 40 * 60000, session_id: null, url: null }
      if (founder) state.reservedFounders++
      return { data: [{ allowed: true, attempt_id: state.attempt.id, existing_session_id: null, existing_session_url: null, idempotency_key: state.attempt.key, founder_reserved: founder }], error: null }
    }
    if (name === 'save_stripe_checkout_session') { if (state.sessionSaveFailures > 0) { state.sessionSaveFailures -= 1; return { data: null, error: new Error('session ledger save failed') } } state.attempt.session_id = args.p_session_id; state.attempt.url = args.p_session_url; return { data: true, error: null } }
    if (name === 'expire_stripe_checkout_attempt') { state.stale = state.stale.filter(item => item.id !== args.p_attempt_id); if (state.reservedFounders > 0) state.reservedFounders--; state.attempt = null; return { data: true, error: null } }
    throw new Error(`unexpected rpc ${name}`)
  }),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseMock }))
vi.mock('stripe', () => ({ default: class Stripe { customers = stripeMock.customers; checkout = stripeMock.checkout } }))
process.env.SUPABASE_URL = 'http://local'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.STRIPE_SECRET_KEY = 'stripe'; process.env.VITE_STRIPE_PRICE_STARTER = 'price-regular'; process.env.VITE_STRIPE_PRICE_FOUNDER = 'price-founder'; process.env.FOUNDER_MAX_PURCHASES = '1'
const { default: handler } = await import('@/../api/billing/create-checkout')

const req = (priceId = 'price-regular') => ({ method: 'POST', headers: { authorization: 'Bearer token', host: 'local.test' }, body: { priceId, isOneTime: priceId === 'price-founder' } } as any)
const res = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this } } as any }

beforeEach(() => { supabaseMock.rpc.mockClear(); state.account.stripe_customer_id = null; state.account.stripe_subscription_id = null; state.account.plan_status = 'trialing'; state.account.stripe_price_id = null; state.account.trial_started_at = new Date(Date.now() - 86400000).toISOString(); state.account.trial_ends_at = new Date(Date.now() + 13 * 86400000).toISOString(); state.attempt = null; state.history = false; state.completedFounders = 0; state.reservedFounders = 0; state.stale.length = 0; state.customerSaveFailures = 0; state.sessionSaveFailures = 0; state.sessions.length = 0; state.customers.length = 0; stripeMock.customers.create.mockReset(); stripeMock.checkout.sessions.create.mockReset(); stripeMock.checkout.sessions.retrieve.mockReset() })

describe('Block 3B create-checkout handler', () => {
  it('allows an unexpired initial-trial Founder checkout while capacity is available', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' })
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-founder', url: 'https://checkout/founder', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(200)
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].mode).toBe('payment')
    const expiry = stripeMock.checkout.sessions.create.mock.calls[0][0].expires_at
    expect(expiry).toBeGreaterThan(Math.floor(Date.now()/1000) + 30 * 60)
    expect(expiry).toBeLessThanOrEqual(Math.floor(Date.now()/1000) + 40 * 60)
    expect(state.account.stripe_subscription_id).toBeNull()
    expect(state.reservedFounders).toBe(1)
    expect(state.completedFounders).toBe(0)
  })
  it.each([null, true])('denies Founder when paid history is %s', async history => {
    state.history = history
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
  it('denies a full final slot before returning a payable session', async () => {
    state.reservedFounders = 1
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
  it('denies an unauthenticated direct API request', async () => {
    const response = res(); const direct = req('price-founder'); direct.headers.authorization = ''
    await handler(direct, response)
    expect(response.out.status).toBe(400)
    expect(supabaseMock.rpc.mock.calls.some(([name]) => name === 'begin_stripe_checkout_v2')).toBe(false)
  })
  it('rejects another in-flight Founder creation for the same company', async () => {
    state.attempt = { id: 'attempt-a', key: 'other-request', expires_at: Date.now() + 60000, session_id: null, url: null }
    state.reservedFounders = 1
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
  it('releases a Founder reservation when Checkout creation fails before a URL is delivered', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' })
    stripeMock.checkout.sessions.create.mockRejectedValue(new Error('creation failed'))
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(supabaseMock.rpc).toHaveBeenCalledWith('expire_stripe_checkout_attempt', expect.objectContaining({ p_attempt_id: 'attempt-a' }))
  })
  it('releases a Stripe-confirmed expired Founder session then retries capacity', async () => {
    state.stale = [{ id: 'stale-attempt', company_account_id: 'company-b', session_id: 'cs-expired', expires_at: new Date(Date.now()-1000).toISOString() }]
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: 'cs-expired', status: 'expired', payment_status: 'unpaid' })
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' })
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-new', url: 'https://checkout/new', expires_at: Math.floor(Date.now()/1000)+2100 })
    supabaseMock.rpc.mockImplementationOnce(async () => ({ data: [{ allowed: false, reason: 'Founder plan is sold out', attempt_id: null, existing_session_id: null, existing_session_url: null, idempotency_key: null }], error: null }))
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(200)
    expect(supabaseMock.rpc).toHaveBeenCalledWith('expire_stripe_checkout_attempt', { p_attempt_id: 'stale-attempt', p_company_account_id: 'company-b' })
  })
  it('retains capacity for a completed paid session despite an old reservation timestamp', async () => {
    state.stale = [{ id: 'paid-attempt', company_account_id: 'company-b', session_id: 'cs-paid', expires_at: new Date(Date.now()-1000).toISOString() }]
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: 'cs-paid', status: 'complete', payment_status: 'paid' })
    supabaseMock.rpc.mockImplementationOnce(async () => ({ data: [{ allowed: false, reason: 'Founder plan is sold out', attempt_id: null, existing_session_id: null, existing_session_url: null, idempotency_key: null }], error: null }))
      .mockImplementationOnce(async () => ({ data: [{ allowed: false, reason: 'Founder plan is sold out', attempt_id: null, existing_session_id: null, existing_session_url: null, idempotency_key: null }], error: null }))
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(supabaseMock.rpc.mock.calls.some(([name]) => name === 'expire_stripe_checkout_attempt')).toBe(false)
  })
  it('fails closed when the checkout coordinator reports Founder capacity exhausted', async () => {
    supabaseMock.rpc.mockImplementationOnce(async () => ({ data: [{ allowed: false, reason: 'Founder plan is sold out', attempt_id: null, existing_session_id: null, existing_session_url: null, idempotency_key: null }], error: null }))
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
  it.each([
    ['expired initial trial', 'expired', null, false],
    ['active recurring account', 'active', 'price-regular', true],
    ['past-due recurring account', 'past_due', 'price-regular', true],
    ['former recurring account', 'expired', null, false],
    ['existing Founder account', 'active', 'founder_lifetime', false],
  ])('rejects direct Founder checkout for %s before creating Stripe resources', async (_label, status, price, hasSubscription) => {
    state.account.plan_status = status as string
    state.account.stripe_price_id = price as any
    state.account.stripe_subscription_id = hasSubscription ? 'sub-a' as any : null
    if (status === 'expired') state.account.trial_ends_at = new Date(Date.now() - 86400000).toISOString()
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' })
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-a', url: 'https://checkout/a', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
  it('rejects a trial account after its initial 14-day window, even if extended', async () => {
    state.account.trial_started_at = new Date(Date.now() - 15 * 86400000).toISOString()
    state.account.trial_ends_at = new Date(Date.now() + 2 * 86400000).toISOString()
    stripeMock.customers.create.mockResolvedValue({ id: 'cus-a' })
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs-a', url: 'https://checkout/a', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    const response = res(); await handler(req('price-founder'), response)
    expect(response.out.status).toBe(400)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
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
