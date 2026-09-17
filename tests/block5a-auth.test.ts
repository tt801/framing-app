import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => { process.env.SUPABASE_URL = 'http://local'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; return { user: { id: 'user-a' }, accounts: [] as any[], members: [] as any[] } })
const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: state.user }, error: null })) },
  from: vi.fn((table: string) => {
    const query: any = { table, filters: {} }
    query.select = () => query
    query.eq = (key: string, value: any) => { query.filters[key] = value; return query }
    query.single = async () => {
      if (table === 'company_accounts') { const item = state.accounts.find(a => a.id === query.filters.id); return { data: item || null, error: item ? null : { code: 'PGRST116' } } }
      return { data: null, error: null }
    }
    query.then = (resolve: any, reject: any) => {
      const rows = table === 'company_accounts' ? state.accounts : state.members
      Promise.resolve({ data: rows.filter(row => Object.entries(query.filters).every(([key, value]) => row[key] === value)), error: null }).then(resolve, reject)
    }
    return query
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseMock }))
import { requireCompanyWriteAccess } from '@/../api/lib/auth'

const req = (companyAccountId?: string) => ({ headers: { authorization: 'Bearer token', ...(companyAccountId ? { 'x-company-account-id': companyAccountId } : {}) }, body: {} } as any)
beforeEach(() => { state.accounts = []; state.members = []; vi.clearAllMocks() })

describe('Block 5A company API authorization', () => {
  it('resolves an owner and active member, but rejects invited/no-account users', async () => {
    state.accounts = [{ id: 'company-a', owner_user_id: 'user-owner', plan_status: 'active', trial_ends_at: null }]
    state.user = { id: 'user-a' }; state.members = [{ company_account_id: 'company-a', user_id: 'user-a', role: 'sales', status: 'active' }]
    await expect(requireCompanyWriteAccess(req('company-a'))).resolves.toMatchObject({ companyAccountId: 'company-a', role: 'sales' })
    state.members = [{ company_account_id: 'company-a', user_id: 'user-a', role: 'sales', status: 'invited' }]
    await expect(requireCompanyWriteAccess(req('company-a'))).rejects.toThrow('No active company access')
    state.accounts = []; state.members = []
    await expect(requireCompanyWriteAccess(req())).rejects.toThrow('No active company access')
  })
  it('checks expiry, preserves founder access, and requires selection across companies', async () => {
    state.accounts = [{ id: 'company-a', owner_user_id: 'user-a', plan_status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' }]
    await expect(requireCompanyWriteAccess(req('company-a'))).rejects.toThrow('Trial expired')
    state.accounts[0] = { ...state.accounts[0], plan_status: 'expired', stripe_price_id: 'founder_lifetime' }
    await expect(requireCompanyWriteAccess(req('company-a'))).resolves.toMatchObject({ companyAccountId: 'company-a' })
    state.accounts.push({ id: 'company-b', owner_user_id: 'someone', plan_status: 'active', trial_ends_at: null }); state.members.push({ company_account_id: 'company-b', user_id: 'user-a', role: 'staff', status: 'active' })
    await expect(requireCompanyWriteAccess(req())).rejects.toThrow('Company selection required')
  })
})
