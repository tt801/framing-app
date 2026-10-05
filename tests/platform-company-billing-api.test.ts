import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn() }))
vi.mock('../api/lib/platformAdmin.js', () => ({ requirePlatformAdmin: mocks.auth, getSupabaseAdmin: () => ({ from: mocks.from }), platformAdminError: () => ({ status: 403, message: 'Forbidden' }) }))
import handler from '../api/platform/company-billing'

const request = (id: string) => ({ method: 'GET', query: { companyId: id } } as unknown as VercelRequest)
function response() {
  const result = { status: 0, body: null as unknown }
  const res = { status: vi.fn((n: number) => { result.status = n; return res }), json: vi.fn((b: unknown) => { result.body = b; return res }), end: vi.fn() } as unknown as VercelResponse
  return { res, result }
}
beforeEach(() => { mocks.auth.mockReset(); mocks.from.mockReset() })
describe('platform company billing history', () => {
  it('requires platform authorization before reading any company history', async () => {
    mocks.auth.mockRejectedValue(new Error('not admin'))
    const { res, result } = response()
    await handler(request('11111111-1111-4111-8111-111111111111'), res)
    expect(result.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('scopes the returned attempts to the selected company', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const limit = vi.fn(async () => ({ data: [], error: null }))
    const order = vi.fn(() => ({ limit }))
    const eq = vi.fn(() => ({ order }))
    mocks.from.mockReturnValue({ select: vi.fn(() => ({ eq })) })
    const { res, result } = response()
    await handler(request(id), res)
    expect(result.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('company_account_id', id)
    expect(limit).toHaveBeenCalledWith(20)
  })
})
