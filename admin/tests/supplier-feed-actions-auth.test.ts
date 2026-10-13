import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
const mock = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mock.getUser }, from: mock.from, rpc: mock.rpc }) }))
import handler from '../api/platform/supplier-feed-actions.js'
const runId = '22222222-2222-4222-8222-222222222222'
async function call(authorization?: string) {
  const state: any = {}
  const res: any = { status: (n: number) => { state.status = n; return res }, json: (body: any) => { state.body = body; return res }, end: () => res, setHeader: vi.fn() }
  await handler({ method: 'POST', headers: { authorization, host: 'admin.test', origin: 'https://admin.test', 'content-type': 'application/json' }, query: {}, body: { runId, action: 'approve' } } as VercelRequest, res as VercelResponse)
  return state
}
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://fixture.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-not-a-real-key')
  vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'admin@example.test')
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: '44444444-4444-4444-8444-444444444444', email: 'admin@example.test' } }, error: null })
  mock.from.mockReset().mockImplementation(() => { const q: any = { select: () => q, eq: () => q, limit: () => q, then: (resolve: any) => resolve({ data: [], error: null }) }; return q })
  mock.rpc.mockReset()
})
afterEach(() => vi.unstubAllEnvs())
describe('standalone mutation route strict Platform Admin authorization', () => {
  it('rejects unauthenticated callers without database queries', async () => {
    expect((await call()).status).toBe(403); expect(mock.getUser).not.toHaveBeenCalled(); expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('rejects authenticated non-Platform-Admins', async () => {
    mock.getUser.mockResolvedValue({ data: { user: { email: 'customer@example.test' } }, error: null })
    expect((await call('Bearer fixture-token')).status).toBe(403); expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('accepts allowlisted Platform Admin identity and then reloads the requested run', async () => {
    expect((await call('Bearer fixture-token')).status).toBe(404)
    expect(mock.getUser).toHaveBeenCalledWith('fixture-token'); expect(mock.from).toHaveBeenCalledWith('supplier_feed_runs')
  })
  it.each(['', 'admin@example.test, invalid'])('fails closed with missing or malformed configuration %j', async config => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', config)
    expect((await call('Bearer fixture-token')).status).toBe(403); expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled()
  })
})
