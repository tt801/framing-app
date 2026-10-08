import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
const mock = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }))
import suppliers from '../api/platform/suppliers.js'
import products from '../api/platform/supplier-products.js'

function req(method = 'GET', body?: unknown) { return { method, body, headers: { authorization: 'Bearer test-token' }, query: {} } as VercelRequest }
function response() {
  const result: { status?: number; body?: unknown } = {}
  const res = { status: vi.fn((n: number) => { result.status = n; return res }), json: vi.fn((b: unknown) => { result.body = b; return res }), end: vi.fn() } as unknown as VercelResponse
  return { res, result }
}
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-test-key')
  vi.stubEnv('PLATFORM_ADMIN_EMAILS', '')
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { email: 'alex@stormair.co.uk' } }, error: null })
  mock.from.mockReset()
  mock.createClient.mockReset().mockReturnValue({ auth: { getUser: mock.getUser }, from: mock.from })
})

describe('main-project supplier entrypoints', () => {
  it.each([['suppliers', suppliers], ['products', products]])('fails closed without an explicit allow-list for %s even for the legacy fallback email', async (_, handler) => {
    const { res, result } = response()
    await handler(req(), res)
    expect(result.status).toBe(403)
    expect(mock.from).not.toHaveBeenCalled()
  })
  it.each([['suppliers', suppliers], ['products', products]])('rejects ordinary customers for %s with a configured admin', async (_, handler) => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'admin@example.invalid')
    mock.getUser.mockResolvedValue({ data: { user: { email: 'customer@example.invalid' } }, error: null })
    const { res, result } = response()
    await handler(req(), res)
    expect(result.status).toBe(403)
    expect(mock.from).not.toHaveBeenCalled()
  })
  it.each([['suppliers', suppliers], ['products', products]])('rejects malformed allow-lists for %s', async (_, handler) => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '*, not-an-email')
    const { res, result } = response()
    await handler(req(), res)
    expect(result.status).toBe(403)
    expect(mock.from).not.toHaveBeenCalled()
  })
})
