import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readdirSync } from 'node:fs'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

import companies from '../api/platform/companies.js'
import companyBilling from '../api/platform/company-billing.js'
import stats from '../api/platform/stats.js'
import members from '../api/platform/members.js'
import tickets from '../api/platform/tickets.js'
import ticketComments from '../api/platform/ticket-comments.js'
import cms from '../api/platform/cms.js'
import { requirePlatformAdmin } from '../server/platform/platformAdmin.js'

const companyId = '11111111-1111-4111-8111-111111111111'
const request = (token?: string, path = '') => ({
  method: 'GET',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  query: path === 'billing' ? { companyId } : {},
} as unknown as VercelRequest)
function response() {
  const result: { status?: number; body?: unknown } = {}
  const res = {
    status: vi.fn((status: number) => { result.status = status; return res }),
    json: vi.fn((body: unknown) => { result.body = body; return res }),
    end: vi.fn(),
  } as unknown as VercelResponse
  return { res, result }
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'not-a-real-key')
  vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'owner@example.invalid')
  mocks.getUser.mockReset()
  mocks.from.mockReset()
  mocks.createClient.mockReset().mockReturnValue({ auth: { getUser: mocks.getUser }, from: mocks.from })
})

describe('standalone platform API', () => {
  it('packages exactly the seven platform handlers under the standalone API root', () => {
    expect([stats, companies, companyBilling, members, tickets, ticketComments, cms].every(
      handler => typeof handler === 'function'
    )).toBe(true)
    expect(readdirSync(new URL('../api/platform/', import.meta.url)).sort()).toEqual([
      'cms.ts', 'companies.ts', 'company-billing.ts', 'members.ts',
      'stats.ts', 'ticket-comments.ts', 'tickets.ts',
    ].sort())
  })

  it('rejects unauthenticated requests without reading company data', async () => {
    const { res, result } = response()
    await companies(request(), res)
    expect(result.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([
    ['stats', stats], ['company-billing', companyBilling], ['members', members],
    ['tickets', tickets], ['ticket-comments', ticketComments], ['cms', cms],
  ])('rejects an unauthenticated %s request before database access', async (_name, handler) => {
    const { res, result } = response()
    await handler(request(undefined, 'billing'), res)
    expect(result.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an authenticated but non-allow-listed account', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'customer@example.invalid' } }, error: null })
    const { res, result } = response()
    await companies(request('customer-token'), res)
    expect(result.status).toBe(403)
    expect(mocks.getUser).toHaveBeenCalledWith('customer-token')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([
    ['stats', stats], ['companies', companies], ['company-billing', companyBilling],
    ['members', members], ['tickets', tickets], ['ticket-comments', ticketComments], ['cms', cms],
  ])('does not allow a recovery-session token to bypass %s authorization', async (_name, handler) => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'customer@example.invalid' } }, error: null })
    const { res, result } = response()
    await handler(request('recovery-session', 'billing'), res)
    expect(result.status).toBe(403)
    expect(mocks.getUser).toHaveBeenCalledWith('recovery-session')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('fails closed when the allow-list is absent, even for a valid account', async () => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '')
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'owner@example.invalid' } }, error: null })
    const { res, result } = response()
    await companies(request('owner-token'), res)
    expect(result.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('allows the configured admin to read company data and does not return server credentials', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'OWNER@example.invalid' } }, error: null })
    const order = vi.fn().mockResolvedValue({ data: [{ id: companyId, company_name: 'Example', plan_status: 'trialing' }], error: null })
    mocks.from.mockImplementation((table: string) => {
      expect(['company_accounts', 'company_members', 'support_tickets']).toContain(table)
      if (table === 'company_accounts') return { select: vi.fn(() => ({ order })) }
      return { select: vi.fn(() => ({ in: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })) })) }
    })
    const { res, result } = response()
    await companies(request('owner-token'), res)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ companies: [{ id: companyId, company_name: 'Example' }] })
    expect(JSON.stringify(result.body)).not.toContain('not-a-real-key')
  })

  it('scopes company-billing checkout history after authorizing the same-origin route', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'owner@example.invalid' } }, error: null })
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'attempt-1', status: 'completed' }], error: null })
    const eq = vi.fn(() => ({ order: vi.fn(() => ({ limit })) }))
    mocks.from.mockReturnValue({ select: vi.fn(() => ({ eq })) })
    const { res, result } = response()
    await companyBilling(request('owner-token', 'billing'), res)
    expect(result.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('company_account_id', companyId)
    expect(result.body).toEqual({ attempts: [{ id: 'attempt-1', status: 'completed' }] })
  })

  it('does not accept a valid token from another Supabase project', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('Invalid JWT') })
    await expect(requirePlatformAdmin(request('other-project-token'))).rejects.toThrow('Invalid or expired token')
  })
})
