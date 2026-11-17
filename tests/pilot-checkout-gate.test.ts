// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stripe: vi.fn(), supabase: vi.fn() }))
vi.mock('stripe', () => ({ default: class Stripe { constructor() { mocks.stripe(); throw new Error('Stripe must not initialize while checkout is disabled') } } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => { mocks.supabase(...args); throw new Error('Supabase must not initialize while checkout is disabled') } }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('STRIPE_CHECKOUT_ENABLED', undefined) })
afterEach(() => vi.unstubAllEnvs())

function response() {
  const result: { status?: number; body?: unknown } = {}
  return { result, status(code: number) { result.status = code; return this }, json(body: unknown) { result.body = body; return this }, end() { return this } }
}

describe('pilot checkout server gate', () => {
  it('rejects a direct POST by default without initializing external clients', async () => {
    const { default: handler } = await import('../api/billing/create-checkout')
    const res = response()
    await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-token' }, body: { priceId: 'price-synthetic', isOneTime: false } } as any, res as any)
    expect(res.result).toEqual({ status: 403, body: { code: 'CHECKOUT_DISABLED', error: 'Subscription checkout is unavailable during the controlled pilot.' } })
    expect(mocks.stripe).not.toHaveBeenCalled()
    expect(mocks.supabase).not.toHaveBeenCalled()
  })

  it.each(['', 'false', '0', '1', 'TRUE', 'True', ' true ', 'yes'])('fails closed for server value %j', async value => {
    vi.stubEnv('STRIPE_CHECKOUT_ENABLED', value)
    const { default: handler } = await import('../api/billing/create-checkout')
    const res = response()
    await handler({ method: 'POST', headers: {}, body: { priceId: 'price-founder', isOneTime: true, STRIPE_CHECKOUT_ENABLED: 'true' }, query: { STRIPE_CHECKOUT_ENABLED: 'true' } } as any, res as any)
    expect(res.result.status).toBe(403)
    expect(res.result.body).toMatchObject({ code: 'CHECKOUT_DISABLED' })
    expect(mocks.stripe).not.toHaveBeenCalled()
    expect(mocks.supabase).not.toHaveBeenCalled()
  })

  it('returns the disabled response even without provider credentials or a request body', async () => {
    for (const name of ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) vi.stubEnv(name, undefined)
    const { default: handler } = await import('../api/billing/create-checkout')
    const res = response()
    await handler({ method: 'POST', headers: { 'x-stripe-checkout-enabled': 'true' } } as any, res as any)
    expect(res.result.status).toBe(403)
    expect(res.result.body).toEqual({ code: 'CHECKOUT_DISABLED', error: 'Subscription checkout is unavailable during the controlled pilot.' })
    expect(mocks.stripe).not.toHaveBeenCalled()
    expect(mocks.supabase).not.toHaveBeenCalled()
  })

  it('blocks Founder one-time payment checkout too', async () => {
    const { default: handler } = await import('../api/billing/create-checkout')
    const res = response()
    await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-token' }, body: { priceId: 'price-founder', isOneTime: true, STRIPE_CHECKOUT_ENABLED: 'true' } } as any, res as any)
    expect(res.result.status).toBe(403)
    expect(mocks.stripe).not.toHaveBeenCalled()
    expect(mocks.supabase).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('preserves method rejection for %s', async method => {
    const { default: handler } = await import('../api/billing/create-checkout')
    const res = response()
    await handler({ method } as any, res as any)
    expect(res.result.status).toBe(405)
    expect(mocks.stripe).not.toHaveBeenCalled()
    expect(mocks.supabase).not.toHaveBeenCalled()
  })
})
