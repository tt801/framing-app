import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
const mock = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }))
import suppliers from '../api/platform/suppliers.js'
import products from '../api/platform/supplier-products.js'
const req = { method: 'GET', headers: { authorization: 'Bearer test-token' }, query: { supplierId: '11111111-1111-4111-8111-111111111111' } } as unknown as VercelRequest
function response() {
 const state: { status?: number } = {}
 const res = { status: vi.fn((n: number) => { state.status = n; return res }), json: vi.fn(), end: vi.fn() } as unknown as VercelResponse
 return { state, res }
}
beforeEach(() => {
 vi.stubEnv('PLATFORM_ADMIN_EMAILS', '')
 mock.getUser.mockReset().mockResolvedValue({ data: { user: { email: 'admin@example.invalid' } }, error: null })
 mock.from.mockReset()
 mock.createClient.mockReset().mockReturnValue({ auth: { getUser: mock.getUser }, from: mock.from })
})
describe('standalone supplier routes enforce strict allow-list configuration', () => {
 it.each([suppliers, products])('fails closed with missing configuration', async handler => {
   const { state, res } = response(); await handler(req, res)
   expect(state.status).toBe(403); expect(mock.from).not.toHaveBeenCalled()
 })
 it.each([suppliers, products])('fails closed with a partly malformed list', async handler => {
   vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'admin@example.invalid, not-an-email')
   const { state, res } = response(); await handler(req, res)
   expect(state.status).toBe(403); expect(mock.from).not.toHaveBeenCalled()
 })
})
