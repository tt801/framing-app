import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  account: { id: 'company-a', owner_user_id: 'user-a', company_name: 'Company A', plan_status: 'trialing', stripe_customer_id: 'cus-a', stripe_subscription_id: null as string | null, stripe_price_id: null as string | null, subscription_renewed_at: null, subscription_cancel_at: null, trial_started_at: new Date(Date.now()-86400000).toISOString(), trial_ends_at: new Date(Date.now()+13*86400000).toISOString(), has_ever_paid_recurring: false as boolean | null },
  attempt: null as any,
  completed: 0,
  reserved: 0 as number | null,
}))
const stripeMock = vi.hoisted(() => ({ checkout: { sessions: { retrieve: vi.fn() } }, billingPortal: { sessions: { create: vi.fn() } }, prices: { retrieve: vi.fn() } }))
const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(async (token: string) => token === 'valid' ? { data: { user: { id: 'user-a' } }, error: null } : { data: { user: null }, error: new Error('invalid') }) },
  from: vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    const query: any = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters[field] = value; return query },
      single: async () => table === 'company_accounts' && filters.owner_user_id === 'user-a'
        ? { data: { ...state.account }, error: null } : { data: null, error: new Error('not found') },
      maybeSingle: async () => table === 'stripe_checkout_attempts' && filters.company_account_id === state.account.id && filters.session_id === state.attempt?.session_id
        ? { data: state.attempt, error: null } : { data: null, error: null },
      then: (resolve: any) => resolve({ count: table === 'company_accounts' ? state.completed : state.reserved, error: null }),
    }
    return query
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseMock }))
vi.mock('stripe', () => ({ default: class Stripe { checkout = stripeMock.checkout; billingPortal = stripeMock.billingPortal; prices = stripeMock.prices } }))
process.env.SUPABASE_URL = 'http://local'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.STRIPE_SECRET_KEY = 'stripe'; process.env.VITE_STRIPE_PRICE_FOUNDER = 'price-founder'; process.env.FOUNDER_MAX_PURCHASES = '1'
const { default: handler } = await import('@/../api/billing/manage')
const req = (action: string, sessionId = 'cs_a', token = 'valid') => ({ method: 'GET', headers: { authorization: `Bearer ${token}` }, query: { billingAction: action, session_id: sessionId } } as any)
const res = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this }, end() { return this } } as any }
beforeEach(() => {
  state.account.plan_status = 'trialing'; state.account.stripe_subscription_id = null; state.account.stripe_price_id = null
  state.account.has_ever_paid_recurring = false; state.account.trial_started_at = new Date(Date.now()-86400000).toISOString(); state.account.trial_ends_at = new Date(Date.now()+13*86400000).toISOString()
  state.attempt = { company_account_id: 'company-a', session_id: 'cs_a', customer_id: 'cus-a', price_id: 'price-founder', founder_reserved: true, status: 'pending' }
  state.completed = 0; state.reserved = 0
  stripeMock.checkout.sessions.retrieve.mockReset()
  stripeMock.prices.retrieve.mockReset()
  stripeMock.prices.retrieve.mockResolvedValue({ id: 'price-growth', unit_amount: 3500, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } })
})
describe('customer subscription management', () => {
  it('shows authoritative plan and Stripe price for a recurring owner', async () => {
    state.account.plan_status = 'active'; state.account.stripe_price_id = 'price-growth'; state.account.stripe_subscription_id = 'sub-a'
    process.env.VITE_STRIPE_PRICE_GROWTH = 'price-growth'
    const response = res(); await handler(req('summary'), response)
    expect(response.out.body.plan).toEqual({ name: 'Growth', unitAmount: 3500, currency: 'gbp', interval: 'month', intervalCount: 1 })
  })
  it('uses the stored customer to open a portal and rejects unauthenticated requests', async () => {
    state.account.plan_status = 'active'; state.account.stripe_price_id = 'price-growth'; state.account.stripe_subscription_id = 'sub-a'
    stripeMock.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test/portal' })
    const request = { ...req('create-portal'), method: 'POST', body: { customerId: 'cus-attacker' } }
    const response = res(); await handler(request, response)
    expect(response.out.body.url).toBe('https://billing.stripe.test/portal')
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus-a' }))
    const denied = res(); await handler({ ...request, headers: { authorization: 'Bearer invalid' } }, denied)
    expect(denied.out.status).not.toBe(200)
  })
})

describe('authenticated billing summary', () => {
  it('counts current reservations against Founder availability', async () => {
    state.reserved = 1
    const response = res(); await handler(req('summary'), response)
    expect(response.out.status).toBe(200)
    expect(response.out.body.founder).toMatchObject({ purchasedCount: 0, remaining: 0, soldOut: true, eligible: false })
  })
  it('fails closed when Founder reservation count cannot be established', async () => {
    state.reserved = null
    const response = res(); await handler(req('summary'), response)
    expect(response.out.status).not.toBe(200)
  })
  it.each([null, true])('does not offer Founder for paid history %s', async history => {
    state.account.has_ever_paid_recurring = history
    const response = res(); await handler(req('summary'), response)
    expect(response.out.body.founder.eligible).toBe(false)
  })
  it('does not offer Founder after the original trial window even if extended', async () => {
    state.account.trial_started_at = new Date(Date.now()-15*86400000).toISOString()
    state.account.trial_ends_at = new Date(Date.now()+86400000).toISOString()
    const response = res(); await handler(req('summary'), response)
    expect(response.out.body.founder.eligible).toBe(false)
  })
})

describe('checkout-specific confirmation', () => {
  const paidSession = (mode: 'payment' | 'subscription', subscription: string | null = null) => ({ id: 'cs_a', status: 'complete', payment_status: 'paid', mode, customer: 'cus-a', subscription })
  it('rejects missing auth and mismatched company session without Stripe retrieval', async () => {
    const denied = res(); await handler(req('confirm-checkout', 'cs_a', 'invalid'), denied)
    expect(denied.out.status).not.toBe(200)
    const mismatch = res(); await handler(req('confirm-checkout', 'cs_other'), mismatch)
    expect(mismatch.out.status).not.toBe(200)
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled()
  })
  it('keeps a paid Founder Checkout pending until THIS attempt is completed', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(paidSession('payment'))
    state.account.plan_status = 'active'; state.account.stripe_price_id = 'founder_lifetime'
    const response = res(); await handler(req('confirm-checkout'), response)
    expect(response.out.body.status).toBe('pending')
  })
  it('confirms a completed Founder purchase and never calls it a subscription', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(paidSession('payment'))
    state.attempt.status = 'completed'; state.account.plan_status = 'active'; state.account.stripe_price_id = 'founder_lifetime'
    const response = res(); await handler(req('confirm-checkout'), response)
    expect(response.out.body).toMatchObject({ status: 'confirmed', kind: 'founder', companyName: 'Company A' })
  })
  it('does not accept an unrelated active recurring subscription', async () => {
    state.attempt.price_id = 'price-regular'
    state.account.plan_status = 'active'; state.account.stripe_price_id = 'price-regular'; state.account.stripe_subscription_id = 'sub-other'
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(paidSession('subscription', 'sub-this-checkout'))
    const response = res(); await handler(req('confirm-checkout'), response)
    expect(response.out.body.status).toBe('pending')
  })
  it('confirms this paid recurring session only after matching subscription entitlement', async () => {
    state.attempt.price_id = 'price-regular'; state.account.plan_status = 'active'; state.account.stripe_price_id = 'price-regular'; state.account.stripe_subscription_id = 'sub-this-checkout'
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(paidSession('subscription', 'sub-this-checkout'))
    const response = res(); await handler(req('confirm-checkout'), response)
    expect(response.out.body).toMatchObject({ status: 'confirmed', kind: 'recurring' })
  })
  it('does not confirm an unpaid session or customer mismatch', async () => {
    state.attempt.status = 'completed'; state.account.plan_status = 'active'; state.account.stripe_price_id = 'founder_lifetime'
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ ...paidSession('payment'), payment_status: 'unpaid' })
    const unpaid = res(); await handler(req('confirm-checkout'), unpaid)
    expect(unpaid.out.body.status).toBe('pending')
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ ...paidSession('payment'), customer: 'cus-other' })
    const mismatch = res(); await handler(req('confirm-checkout'), mismatch)
    expect(mismatch.out.body.status).not.toBe('confirmed')
  })
})
