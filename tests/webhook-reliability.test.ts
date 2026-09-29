// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  logs: new Map<string, { status: string; token?: string; busy?: boolean; expired?: boolean }>(),
  accounts: new Map<string, { id: string; stripe_customer_id: string; plan_status?: string; stripe_subscription_id?: string | null }>(),
  customers: new Map<string, { id: string; metadata: { company_account_id?: string } }>(),
  subscriptions: [] as any[],
  reconciliations: 0,
  founderCompletions: 0,
  claimError: false,
  claimMalformed: false,
  claimOverride: null as null | { claimed: boolean; status?: string },
  lookupError: false,
  reconcileError: false,
  reconcileFalse: false,
  finishError: false,
  listErrorAt: '' as string,
  tokenCounter: 0,
}))
vi.mock('node:crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++state.tokenCounter).padStart(12, '0')}` }))
const stripeMock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  subscriptions: { retrieve: vi.fn(), list: vi.fn() },
  customers: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
}))
const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(async (name: string, args: any) => {
    if (name === 'claim_stripe_webhook') {
      if (state.claimError) return { data: null, error: new Error('claim unavailable') }
      if (state.claimMalformed) return { data: null, error: null }
      if (state.claimOverride) return { data: [state.claimOverride], error: null }
      const log = state.logs.get(args.p_event_id)
      if (log?.status === 'processed') return { data: [{ claimed: false, status: 'processed' }], error: null }
      if (log?.busy || (log?.status === 'pending' && !log.expired)) return { data: [{ claimed: false, status: log.status }], error: null }
      state.logs.set(args.p_event_id, { status: 'pending', token: args.p_claim_token })
      return { data: [{ claimed: true, status: 'pending' }], error: null }
    }
    if (name === 'finish_stripe_webhook') {
      if (state.finishError) return { data: null, error: new Error('finish unavailable') }
      const log = state.logs.get(args.p_event_id)
      if (!log || log.token !== args.p_claim_token) return { data: false, error: null }
      log.status = args.p_status
      return { data: true, error: null }
    }
    if (name === 'claim_stripe_subscription_reconciliation') return { data: true, error: null }
    if (name === 'release_stripe_subscription_reconciliation') return { data: true, error: null }
    if (name === 'reconcile_stripe_subscription_state') {
      if (state.reconcileError) return { data: null, error: new Error('reconcile unavailable') }
      if (state.reconcileFalse) return { data: false, error: null }
      const account = state.accounts.get(args.p_company_account_id)
      if (!account) return { data: false, error: null }
      state.reconciliations++
      account.plan_status = args.p_status
      account.stripe_subscription_id = args.p_subscription_id
      return { data: true, error: null }
    }
    if (name === 'complete_founder_checkout') { state.founderCompletions++; return { data: true, error: null } }
    throw new Error(`Unexpected RPC: ${name}`)
  }),
  from: vi.fn((table: string) => {
    if (table !== 'company_accounts') throw new Error(`Unexpected table: ${table}`)
    const q: any = {
      field: '', value: '',
      select: () => q,
      eq: (field: string, value: string) => { q.field = field; q.value = value; return q },
      maybeSingle: async () => {
        if (state.lookupError) return { data: null, error: new Error('account lookup unavailable') }
        const matches = [...state.accounts.values()].filter(a => (a as any)[q.field] === q.value)
        if (matches.length > 1) return { data: null, error: new Error('ambiguous customer mapping') }
        return { data: matches[0] || null, error: null }
      },
    }
    return q
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseMock }))
vi.mock('stripe', () => ({ default: class Stripe {
  webhooks = stripeMock.webhooks
  subscriptions = stripeMock.subscriptions
  customers = stripeMock.customers
  paymentIntents = stripeMock.paymentIntents
} }))
import handler from '@/../api/billing/webhook'

const subscription = (id: string, company = 'company-a', customer = 'cus-a', status = 'active') => ({
  id, customer, status, metadata: company ? { company_account_id: company } : {}, cancel_at: null,
  items: { data: [{ price: { id: 'price-1' }, current_period_end: 2000 }] },
})
const event = (id: string, object: any = subscription('sub-a'), type = 'customer.subscription.updated') => ({ id, type, data: { object } })
const request = (payload: any) => {
  stripeMock.webhooks.constructEvent.mockReturnValueOnce(payload)
  return { method: 'POST', headers: { 'stripe-signature': 'sig' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(payload) } } as any
}
const response = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this }, end() { return this } } as any }
const deliver = async (payload: any) => { const res = response(); await handler(request(payload), res); return res.out }

beforeEach(() => {
  vi.clearAllMocks()
  state.logs.clear(); state.accounts.clear(); state.customers.clear(); state.subscriptions = [subscription('sub-a')]
  state.accounts.set('company-a', { id: 'company-a', stripe_customer_id: 'cus-a' })
  state.customers.set('cus-a', { id: 'cus-a', metadata: { company_account_id: 'company-a' } })
  state.reconciliations = 0; state.founderCompletions = 0
  state.claimError = false; state.claimMalformed = false; state.claimOverride = null; state.lookupError = false; state.reconcileError = false; state.reconcileFalse = false
  state.finishError = false; state.listErrorAt = ''
  stripeMock.customers.retrieve.mockImplementation(async (id: string) => state.customers.get(id) || { id, metadata: {} })
  stripeMock.subscriptions.retrieve.mockImplementation(async (id: string) => state.subscriptions.find(s => s.id === id))
  stripeMock.subscriptions.list.mockImplementation(async ({ customer, starting_after }: any) => {
    if (state.listErrorAt && state.listErrorAt === (starting_after || 'first')) throw new Error('Stripe page unavailable')
    const matching = state.subscriptions.filter(s => !customer || s.customer === customer)
    const index = starting_after ? matching.findIndex(s => s.id === starting_after) + 1 : 0
    return { data: matching.slice(index, index + 100), has_more: index + 100 < matching.length }
  })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ metadata: { company_account_id: 'company-a' } })
})

describe('Webhook retry and customer-scoped reconciliation', () => {
  it('acknowledges a successful event and a processed duplicate without a second application', async () => {
    expect((await deliver(event('evt-success'))).status).toBe(200)
    expect(state.logs.get('evt-success')?.status).toBe('processed')
    expect((await deliver(event('evt-success'))).status).toBe(200)
    expect(state.reconciliations).toBe(1)
  })
  it('applies a paid Founder checkout once and skips its processed duplicate', async () => {
    const founder = event('evt-founder-success', { id: 'cs-founder', mode: 'payment', payment_status: 'paid', customer: 'cus-a', payment_intent: 'pi-founder' }, 'checkout.session.completed')
    expect((await deliver(founder)).status).toBe(200)
    expect((await deliver(founder)).status).toBe(200)
    expect(state.founderCompletions).toBe(1)
  })
  it('does not acknowledge an active pending lease, then retries when it expires', async () => {
    state.logs.set('evt-pending', { status: 'pending', busy: true })
    expect((await deliver(event('evt-pending'))).status).toBeGreaterThanOrEqual(500)
    expect(state.reconciliations).toBe(0)
    state.logs.set('evt-pending', { status: 'pending', expired: true })
    expect((await deliver(event('evt-pending'))).status).toBe(200)
    expect(state.reconciliations).toBe(1)
  })
  it('does not acknowledge failed-but-unclaimed or malformed claims', async () => {
    state.logs.set('evt-failed', { status: 'failed', busy: true })
    expect((await deliver(event('evt-failed'))).status).toBeGreaterThanOrEqual(500)
    state.claimMalformed = true
    expect((await deliver(event('evt-malformed'))).status).toBeGreaterThanOrEqual(500)
    state.claimMalformed = false; state.logs.set('evt-failed', { status: 'failed' })
    expect((await deliver(event('evt-failed'))).status).toBe(200)
    expect(state.reconciliations).toBe(1)
  })
  it('rejects malformed positive claims before any side effect', async () => {
    state.claimOverride = { claimed: true }
    expect((await deliver(event('evt-malformed-positive'))).status).toBeGreaterThanOrEqual(500)
    expect(state.reconciliations).toBe(0)
    expect(state.logs.has('evt-malformed-positive')).toBe(false)
  })
  it('retries claim, account reconciliation and finish failures without a false success', async () => {
    state.claimError = true
    expect((await deliver(event('evt-claim-error'))).status).toBeGreaterThanOrEqual(500)
    state.claimError = false; state.reconcileError = true
    expect((await deliver(event('evt-reconcile-error'))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-reconcile-error')?.status).not.toBe('processed')
    state.reconcileError = false; state.reconcileFalse = true
    expect((await deliver(event('evt-reconcile-false'))).status).toBeGreaterThanOrEqual(400)
    state.reconcileFalse = false; state.finishError = true
    expect((await deliver(event('evt-finish-error'))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-finish-error')?.status).not.toBe('processed')
    state.finishError = false
    expect((await deliver(event('evt-reconcile-error'))).status).toBe(200)
    expect(state.logs.get('evt-reconcile-error')?.status).toBe('processed')
  })
  it('fails a known company subscription with missing metadata but ignores unrelated subscriptions', async () => {
    state.subscriptions = [subscription('sub-known', '', 'cus-a')]
    expect((await deliver(event('evt-known', state.subscriptions[0]))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-known')?.status).not.toBe('processed')
    state.subscriptions = [subscription('sub-other', '', 'cus-other')]
    expect((await deliver(event('evt-other', state.subscriptions[0]))).status).toBe(200)
    expect(state.reconciliations).toBe(0)
  })
  it('does not acknowledge an event when account lookup or Stripe customer lookup fails', async () => {
    state.lookupError = true
    expect((await deliver(event('evt-account-lookup'))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-account-lookup')?.status).not.toBe('processed')
    state.lookupError = false
    stripeMock.customers.retrieve.mockRejectedValueOnce(new Error('Stripe customer unavailable'))
    expect((await deliver(event('evt-customer-lookup', subscription('sub-other', '', 'cus-other')))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-customer-lookup')?.status).not.toBe('processed')
  })
  it('fails a company checkout session without its subscription instead of processing it', async () => {
    const checkout = event('evt-checkout', { mode: 'subscription', customer: 'cus-a', subscription: null }, 'checkout.session.completed')
    expect((await deliver(checkout)).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-checkout')?.status).not.toBe('processed')
  })
  it('fails a metadata/account customer mismatch and an orphaned company-marked customer', async () => {
    const mismatched = subscription('sub-mismatch', 'company-a', 'cus-other')
    expect((await deliver(event('evt-mismatch', mismatched))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-mismatch')?.status).not.toBe('processed')
    state.customers.set('cus-orphan', { id: 'cus-orphan', metadata: { company_account_id: 'company-a' } })
    const orphaned = subscription('sub-orphan', '', 'cus-orphan')
    expect((await deliver(event('evt-orphan', orphaned))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-orphan')?.status).not.toBe('processed')
  })
  it('fails closed if two accounts share the same Stripe customer', async () => {
    state.accounts.set('company-b', { id: 'company-b', stripe_customer_id: 'cus-a' })
    expect((await deliver(event('evt-ambiguous-customer'))).status).toBeGreaterThanOrEqual(400)
    expect(state.reconciliations).toBe(0)
  })
  it('ignores an unrelated checkout, but retries a known Founder checkout without identity', async () => {
    expect((await deliver(event('evt-unrelated-checkout', { mode: 'subscription', customer: 'cus-other', subscription: null }, 'checkout.session.completed'))).status).toBe(200)
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: {} })
    const founder = { id: 'cs-founder', mode: 'payment', payment_status: 'paid', customer: 'cus-a', payment_intent: 'pi-founder' }
    expect((await deliver(event('evt-founder-broken', founder, 'checkout.session.completed'))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-founder-broken')?.status).not.toBe('processed')
  })
  it('fails an unsupported checkout mode for a known company, but ignores one for an unrelated customer', async () => {
    const known = { id: 'cs-unknown-mode', mode: 'setup', customer: 'cus-a' }
    expect((await deliver(event('evt-known-mode', known, 'checkout.session.completed'))).status).toBeGreaterThanOrEqual(400)
    expect(state.logs.get('evt-known-mode')?.status).not.toBe('processed')
    expect((await deliver(event('evt-other-mode', { ...known, customer: 'cus-other' }, 'checkout.session.completed'))).status).toBe(200)
  })
  it('finds the company subscription after the first 100 global subscriptions', async () => {
    state.subscriptions = Array.from({ length: 100 }, (_, i) => subscription(`sub-other-${i}`, 'another-company', 'cus-other'))
    state.subscriptions.push(subscription('sub-a'))
    expect((await deliver(event('evt-global-page'))).status).toBe(200)
    expect(state.accounts.get('company-a')?.stripe_subscription_id).toBe('sub-a')
    expect(stripeMock.subscriptions.list).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus-a' }))
  })
  it('walks every page for the verified customer before concluding there is no active subscription', async () => {
    state.subscriptions = Array.from({ length: 100 }, (_, i) => subscription(`sub-canceled-${i}`, 'company-a', 'cus-a', 'canceled'))
    state.subscriptions.push(subscription('sub-new'))
    expect((await deliver(event('evt-customer-page'))).status).toBe(200)
    expect(state.accounts.get('company-a')?.stripe_subscription_id).toBe('sub-new')
    expect(stripeMock.subscriptions.list).toHaveBeenCalledTimes(2)
  })
  it('expires only after a complete customer-scoped search finds no valid subscriptions', async () => {
    state.subscriptions = Array.from({ length: 101 }, (_, i) => subscription(`sub-canceled-${i}`, 'company-a', 'cus-a', 'canceled'))
    expect((await deliver(event('evt-no-active'))).status).toBe(200)
    expect(state.accounts.get('company-a')?.plan_status).toBe('expired')
    expect(stripeMock.subscriptions.list).toHaveBeenCalledTimes(2)
  })
  it('does not expire an account when a later Stripe page fails', async () => {
    state.subscriptions = Array.from({ length: 100 }, (_, i) => subscription(`sub-canceled-${i}`, 'company-a', 'cus-a', 'canceled'))
    state.subscriptions.push(subscription('sub-new'))
    state.listErrorAt = 'sub-canceled-99'
    state.accounts.get('company-a')!.plan_status = 'active'
    expect((await deliver(event('evt-page-error'))).status).toBeGreaterThanOrEqual(400)
    expect(state.accounts.get('company-a')?.plan_status).toBe('active')
    expect(state.logs.get('evt-page-error')?.status).not.toBe('processed')
  })
  it('preserves current Stripe state when an old deletion arrives after a replacement', async () => {
    state.subscriptions = [subscription('sub-new')]
    expect((await deliver(event('evt-new', state.subscriptions[0]))).status).toBe(200)
    const deleted = subscription('sub-old'); deleted.status = 'canceled'
    expect((await deliver(event('evt-old-deleted', deleted, 'customer.subscription.deleted'))).status).toBe(200)
    expect(state.accounts.get('company-a')?.stripe_subscription_id).toBe('sub-new')
  })
})
