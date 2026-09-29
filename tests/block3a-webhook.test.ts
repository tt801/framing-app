// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  logs: new Map<string, { status: string; token?: string }>(),
  accounts: new Map<string, any>(),
  subscriptions: new Map<string, any>(),
  authoritative: [] as any[],
  failAccountUpdate: false,
  successfulClaims: 0,
}))

const stripeMock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn(), list: vi.fn() },
  customers: { retrieve: vi.fn() },
}))

const supabaseMock = vi.hoisted(() => {
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'claim_stripe_webhook') {
      const existing = state.logs.get(args.p_event_id)
      if (!existing) { state.successfulClaims += 1; state.logs.set(args.p_event_id, { status: 'pending', token: args.p_claim_token }); return { data: [{ claimed: true, status: 'pending' }], error: null } }
      if (existing.status === 'processed') return { data: [{ claimed: false, status: 'processed' }], error: null }
      if (existing.status === 'failed' || (existing.status === 'pending' && (existing as any).expired)) { state.successfulClaims += 1; existing.status = 'pending'; existing.token = args.p_claim_token; return { data: [{ claimed: true, status: 'pending' }], error: null } }
      return { data: [{ claimed: false, status: 'pending' }], error: null }
    }
    if (name === 'finish_stripe_webhook') {
      const log = state.logs.get(args.p_event_id)
      if (!log || log.token !== args.p_claim_token) return { data: false, error: null }
      log.status = args.p_status; return { data: true, error: null }
    }
    if (name === 'apply_stripe_subscription_event') {
      const account = state.accounts.get(args.p_company_account_id) || {}
      const currentTime = account.eventCreated || ''
      if (currentTime && args.p_event_created < currentTime) return { data: false, error: null }
      if (args.p_deleted && account.subscriptionId && account.subscriptionId !== args.p_subscription_id) return { data: false, error: null }
      state.accounts.set(args.p_company_account_id, { ...account, eventCreated: args.p_event_created, subscriptionId: args.p_deleted ? null : args.p_subscription_id, planStatus: args.p_deleted ? 'expired' : args.p_status })
      return { data: true, error: null }
    }
    if (name === 'claim_stripe_subscription_reconciliation') return { data: true, error: null }
    if (name === 'release_stripe_subscription_reconciliation') return { data: true, error: null }
    if (name === 'reconcile_stripe_subscription_state') {
      if (args.p_company_account_id !== 'company-a') return { data: false, error: null }
      state.accounts.set(args.p_company_account_id, { ...state.accounts.get(args.p_company_account_id), subscriptionId: args.p_subscription_id, planStatus: args.p_status })
      return { data: true, error: null }
    }
    if (name === 'complete_founder_checkout') return state.failAccountUpdate ? { data: null, error: new Error('account update failed') } : { data: true, error: null }
    throw new Error(`unexpected rpc ${name}`)
  })
  const from = vi.fn(() => {
    const query: any = {
      update: (values: any) => { query.values = values; return query },
      eq: (column: string, value: string) => { query.column = column; query.accountId = value; return query },
      select: () => query,
      maybeSingle: async () => ({ data: [...state.accounts.values()].find(account => account[query.column] === query.accountId) || null, error: null }),
      single: async () => {
        if (state.failAccountUpdate) return { data: null, error: new Error('account update failed') }
        state.accounts.set(query.accountId, { ...(state.accounts.get(query.accountId) || {}), ...query.values })
        return { data: { id: query.accountId }, error: null }
      },
    }
    return query
  })
  return { rpc, from }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseMock }))
vi.mock('stripe', () => ({ default: class Stripe { webhooks = stripeMock.webhooks; paymentIntents = stripeMock.paymentIntents; subscriptions = stripeMock.subscriptions; customers = stripeMock.customers } }))

import handler from '@/../api/billing/webhook'

const request = (event: any, valid = true) => {
  if (valid) stripeMock.webhooks.constructEvent.mockReturnValueOnce(event)
  else stripeMock.webhooks.constructEvent.mockImplementationOnce(() => { throw new Error('bad signature') })
  return { method: 'POST', headers: { 'stripe-signature': 'sig' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(event) } } as any
}
const response = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this }, end() { out.ended = true; return this } } as any }
const subscription = (id: string, company = 'company-a') => ({ id, customer: 'cus-a', metadata: { company_account_id: company }, status: 'active', cancel_at: null, items: { data: [{ price: { id: 'price-1' }, current_period_end: 2000 }] } })
const event = (id: string, type = 'customer.subscription.updated', created = 1000, object = subscription('sub-1')) => ({ id, type, created, data: { object } })

beforeEach(() => {
  vi.clearAllMocks()
  state.logs.clear(); state.accounts.clear(); state.subscriptions.clear()
  state.accounts.set('company-a', { id: 'company-a', stripe_customer_id: 'cus-a' })
  state.authoritative = [subscription('sub-1')]
  state.failAccountUpdate = false; state.successfulClaims = 0
  stripeMock.subscriptions.list.mockImplementation(async () => ({ data: state.authoritative, has_more: false }))
  stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus-other', metadata: {} })
})

describe('Block 3A webhook reliability', () => {
  it('processes once and processed duplicates are no-ops', async () => {
    const first = response(); await handler(request(event('evt-1')), first); expect(first.out.status).toBe(200); expect(state.logs.get('evt-1')?.status).toBe('processed')
    const second = response(); await handler(request(event('evt-1')), second); expect(second.out.body.duplicate).toBe(true); expect(state.accounts.get('company-a').subscriptionId).toBe('sub-1')
  })
  it('retries a failed first attempt and does not mark failure processed', async () => {
    state.accounts.get('company-a').stripe_customer_id = 'cus-founder'
    state.failAccountUpdate = true; stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: { company_account_id: 'company-a' } }); const founder = { id: 'evt-retry', type: 'checkout.session.completed', created: 1000, data: { object: { mode: 'payment', payment_status: 'paid', customer: 'cus-founder', payment_intent: 'pi-retry' } } }; const failed = response(); await handler(request(founder), failed); expect(failed.out.status).toBe(400); expect(state.logs.get('evt-retry')?.status).toBe('failed')
    state.failAccountUpdate = false; stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: { company_account_id: 'company-a' } }); const retried = response(); await handler(request(founder), retried); expect(retried.out.status).toBe(200); expect(state.logs.get('evt-retry')?.status).toBe('processed')
  })
  it('reclaims an interrupted pending event after its lease expires', async () => {
    state.logs.set('evt-pending', { status: 'pending', token: 'abandoned', expired: true } as any)
    const result = response(); await handler(request(event('evt-pending')), result)
    expect(result.out.status).toBe(200); expect(state.logs.get('evt-pending')?.status).toBe('processed'); expect(state.successfulClaims).toBe(1)
  })
  it('allows only one concurrent claim', async () => {
    const first = response(); const second = response(); await Promise.all([handler(request(event('evt-concurrent')), first), handler(request(event('evt-concurrent')), second)])
    expect(state.successfulClaims).toBe(1); expect(state.logs.get('evt-concurrent')?.status).toBe('processed')
  })
  it('reconciles equal-timestamp deliveries to the authoritative state', async () => {
    state.authoritative = [subscription('sub-authoritative')]
    const first = response(); await handler(request(event('evt-z', 'customer.subscription.updated', 2000, subscription('sub-z'))), first)
    const second = response(); await handler(request(event('evt-a', 'customer.subscription.updated', 2000, subscription('sub-a'))), second)
    expect(state.accounts.get('company-a')).toMatchObject({ subscriptionId: 'sub-authoritative', planStatus: 'active' })
    expect(first.out.status).toBe(200); expect(second.out.status).toBe(200)
  })

  it('fails lookup and retries, and does not process a missing account', async () => {
    stripeMock.subscriptions.list.mockRejectedValueOnce(new Error('lookup failed'))
    const failed = response(); await handler(request(event('evt-lookup')), failed); expect(failed.out.status).toBe(400); expect(state.logs.get('evt-lookup')?.status).toBe('failed')
    stripeMock.subscriptions.list.mockResolvedValueOnce({ data: [subscription('sub-1')], has_more: false })
    const retried = response(); await handler(request(event('evt-lookup')), retried); expect(retried.out.status).toBe(200)
    const missing = response(); await handler(request(event('evt-missing', 'customer.subscription.updated', 1000, subscription('sub-1', 'missing-company'))), missing); expect(missing.out.status).toBe(400); expect(state.logs.get('evt-missing')?.status).toBe('failed')
  })

  it('does not let old-subscription deletion regress authoritative replacement', async () => {
    state.authoritative = [subscription('sub-new')]
    const deletedOld = response(); await handler(request(event('evt-delete-old', 'customer.subscription.deleted', 3000, subscription('sub-old'))), deletedOld)
    expect(state.accounts.get('company-a')).toMatchObject({ subscriptionId: 'sub-new', planStatus: 'active' })
    expect(deletedOld.out.status).toBe(200)
  })
  it('rejects invalid signatures before claiming or mutating', async () => {
    const result = response(); await handler(request(event('evt-invalid'), false), result); expect(result.out.status).toBe(400); expect(state.logs.size).toBe(0); expect(state.accounts.size).toBe(1); expect(state.accounts.get('company-a')).toEqual({ id: 'company-a', stripe_customer_id: 'cus-a' })
  })
})
