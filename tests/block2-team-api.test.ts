import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const state = vi.hoisted(() => ({
  user: 'owner-a' as string | null,
  accounts: [
    { id: 'a', owner_user_id: 'owner-a', company_name: 'A', plan_status: 'active', trial_ends_at: '2000-01-01' },
    { id: 'b', owner_user_id: 'owner-b', company_name: 'B', plan_status: 'active', trial_ends_at: '2000-01-01' },
  ],
  members: [] as Record<string, unknown>[],
  invite: vi.fn(),
  lookupError: false,
}))
// In-memory PostgREST transport only: authorization, tenant selection, payload construction
// and lifecycle behavior are the real handlers. SQL/RLS is exercised separately in PGlite.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: {
    getUser: vi.fn(async () => ({ data: { user: state.user ? { id: state.user, email: `${state.user}@test.invalid` } : null }, error: null })),
    admin: { inviteUserByEmail: state.invite },
  },
  from: (table: string) => {
    const filters: [string, unknown][] = []
    let operation = 'select'
    let payload: Record<string, unknown> = {}
    let countOnly = false
    const execute = () => {
      if (state.lookupError) return { data: null, error: new Error('lookup unavailable'), count: null }
      const source = table === 'company_accounts' ? state.accounts : state.members
      const matches = source.filter(row => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value))
      if (operation === 'update') matches.forEach(row => Object.assign(row, payload))
      if (operation === 'delete') state.members = state.members.filter(row => !matches.includes(row as never))
      if (operation === 'upsert') {
        let row = state.members.find(row => row.company_account_id === payload.company_account_id && row.email === payload.email)
        if (row) Object.assign(row, payload)
        else { row = { id: `member-${state.members.length}`, user_id: null, ...payload }; state.members.push(row) }
        return { data: [row], error: null, count: 1 }
      }
      return { data: countOnly ? null : matches, error: null, count: matches.length }
    }
    const query = {
      select: (_columns?: string, options?: { head?: boolean }) => { countOnly = Boolean(options?.head); return query },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      order: () => query,
      upsert: (value: Record<string, unknown>) => { operation = 'upsert'; payload = value; return query },
      update: (value: Record<string, unknown>) => { operation = 'update'; payload = value; return query },
      delete: () => { operation = 'delete'; return query },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] || null } },
      single: async () => { const result = execute(); return { ...result, data: result.data?.[0] || null } },
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return query
  },
}) }))
import handler from '../api/admin/users'
import { requireCompanyWriteAccess } from '../api/lib/auth'

async function request(method: string, body: Record<string, unknown> = {}, authenticated = true) {
  const result: { status: number; body: { error?: string; member?: Record<string, unknown>; members?: Record<string, unknown>[] } } = { status: 0, body: {} }
  const response = {
    status(code: number) { result.status = code; return this },
    json(value: typeof result.body) { result.body = value; return this },
    end() { return this },
  }
  await handler({ method, headers: authenticated ? { authorization: 'Bearer local-test', host: 'localhost:5173', 'x-forwarded-proto': 'http' } : {}, body } as VercelRequest, response as unknown as VercelResponse)
  return result
}
const accessRequest = (company = 'a') => ({ headers: { authorization: 'Bearer local-test', 'x-company-account-id': company } })
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://local.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'local-fixture-not-a-credential')
  state.user = 'owner-a'; state.lookupError = false
  state.accounts.forEach(account => { account.plan_status = 'active'; account.trial_ends_at = '2000-01-01' })
  state.members = [
    { id: 'oa', company_account_id: 'a', user_id: 'owner-a', email: 'owner-a@test.invalid', role: 'owner', status: 'active' },
    { id: 'sa', company_account_id: 'a', user_id: 'staff-a', email: 'staff-a@test.invalid', role: 'staff', status: 'active' },
    { id: 'ob', company_account_id: 'b', user_id: 'owner-b', email: 'owner-b@test.invalid', role: 'owner', status: 'active' },
  ]
  state.invite.mockReset(); state.invite.mockResolvedValue({ error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('Block 2 team administration API', () => {
  it('owner invitation derives company and inviter from authenticated context, not request fields', async () => {
    const result = await request('POST', { email: ' New@Test.Invalid ', role: 'staff', company_account_id: 'b', owner_user_id: 'owner-b', invited_by_user_id: 'owner-b' })
    expect(result.status).toBe(200)
    expect(result.body.member).toMatchObject({ company_account_id: 'a', invited_by_user_id: 'owner-a', email: 'new@test.invalid', role: 'staff', status: 'invited' })
    expect(state.invite).toHaveBeenCalledWith('new@test.invalid', { redirectTo: 'http://localhost:5173/auth/callback', data: { company_name: 'A', company_account_id: 'a', invited_role: 'staff' } })
    expect(state.members.filter(row => row.company_account_id === 'b')).toHaveLength(1)
  })
  it.each(['staff-a', 'outsider', null])('denies unauthorized inviter %s before email or membership creation', async user => {
    state.user = user
    const before = structuredClone(state.members)
    const result = await request('POST', { email: 'new@test.invalid', role: 'owner' })
    expect(result.status).toBe(400)
    expect(state.invite).not.toHaveBeenCalled()
    expect(state.members).toEqual(before)
  })
  it('denies missing token and invalid input', async () => {
    expect((await request('POST', { email: 'x', role: 'staff' }, false)).body.error).toBe('Missing bearer token')
    expect((await request('POST', { email: '', role: 'staff' })).body.error).toBe('Email and role are required')
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('re-invitation reuses the membership and provider failure is not reported as email success', async () => {
    const first = await request('POST', { email: 'new@test.invalid', role: 'staff' })
    state.invite.mockResolvedValue({ error: { message: 'Provider unavailable' } })
    const second = await request('POST', { email: 'new@test.invalid', role: 'staff' })
    expect(second.status).toBe(202)
    expect(second.body).toMatchObject({ member: { id: first.body.member?.id, status: 'invited' }, warning: 'Provider unavailable' })
    expect(state.members.filter(row => row.email === 'new@test.invalid')).toHaveLength(1)
  })
  it.each(['PATCH', 'DELETE'])('blocks cross-company %s without changing the target', async method => {
    const before = structuredClone(state.members.find(row => row.id === 'ob'))
    const result = await request(method, { memberId: 'ob', role: 'staff', status: 'inactive', companyAccountId: 'b' })
    expect(result.body.error).toBe('Member not found')
    expect(state.members.find(row => row.id === 'ob')).toEqual(before)
  })
  it('owner can deactivate staff; the same stale identity loses API authority immediately', async () => {
    expect((await request('PATCH', { memberId: 'sa', status: 'inactive', company_account_id: 'b', user_id: 'owner-b' })).status).toBe(200)
    expect(state.members.find(row => row.id === 'sa')).toMatchObject({ status: 'inactive', company_account_id: 'a', user_id: 'staff-a' })
    state.user = 'staff-a'
    await expect(requireCompanyWriteAccess(accessRequest())).rejects.toThrow('No active company access')
    expect((await request('GET')).body.error).toBe('You do not have admin access')
  })
  it('keeps the last active owner and prevents direct staff role escalation', async () => {
    expect((await request('DELETE', { memberId: 'oa' })).body.error).toBe('You must keep at least one active owner')
    state.user = 'staff-a'
    expect((await request('PATCH', { memberId: 'sa', role: 'owner' })).body.error).toBe('You do not have admin access')
    expect(state.members.find(row => row.id === 'sa')?.role).toBe('staff')
  })
  it('preserves the existing manager administration permission', async () => {
    state.members.push({ id: 'ma', company_account_id: 'a', user_id: 'manager-a', role: 'manager', status: 'active' })
    state.user = 'manager-a'
    const result = await request('GET')
    expect(result.status).toBe(200)
    expect(result.body.members?.every(row => row.company_account_id === 'a')).toBe(true)
  })
})

describe('Block 2 server commercial-write boundary', () => {
  it.each([
    ['trialing', '2099-01-01', true], ['trialing', '2000-01-01', false],
    ['active', '2000-01-01', true], ['past_due', '2099-01-01', false], ['expired', '2099-01-01', false],
  ])('%s / %s enforces writes for owner and staff', async (status, end, allowed) => {
    state.accounts[0].plan_status = status; state.accounts[0].trial_ends_at = end
    for (const user of ['owner-a', 'staff-a']) {
      state.user = user
      if (allowed) await expect(requireCompanyWriteAccess(accessRequest())).resolves.toMatchObject({ companyAccountId: 'a', userId: user })
      else await expect(requireCompanyWriteAccess(accessRequest())).rejects.toThrow(/read-only|Trial expired/)
    }
  })
  it('rejects forged tenant selection and invalid authentication', async () => {
    await expect(requireCompanyWriteAccess(accessRequest('b'))).rejects.toThrow('Unauthorized company access')
    state.user = null
    await expect(requireCompanyWriteAccess(accessRequest())).rejects.toThrow('Invalid or expired token')
    await expect(requireCompanyWriteAccess({ headers: {} })).rejects.toThrow('Missing bearer token')
  })
  it('fails closed on authorization lookup failure', async () => {
    state.lookupError = true
    await expect(requireCompanyWriteAccess(accessRequest())).rejects.toThrow('Company authorization lookup failed')
  })
})
