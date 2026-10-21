import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const state = vi.hoisted(() => ({
  status: 'active', end: '2000-01-01', user: 'owner-a',
  pending: new Map<string, (value: unknown) => void>(), deferred: false,
  writes: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  getCurrentUser: async () => ({ id: state.user, email: `${state.user}@test.invalid` }),
  supabase: {
    rpc: (name: string) => {
      if (name === 'ensure_owner_membership') return Promise.resolve({ error: null })
      if (name === 'get_company_billing_access') return { single: async () => ({ data: { is_founder: false }, error: null }) }
      state.writes(name, 'rpc')
      throw new Error('Unexpected client RPC mutation')
    },
    from: (table: string) => {
      let user = state.user
      const query = {
        select: () => query,
        eq: (_key: string, value: string) => { user = value; return query },
        order: async () => ({ data: [], error: null }),
        single: () => state.deferred ? new Promise(resolve => state.pending.set(user, resolve)) : Promise.resolve({ data: account(user), error: null }),
        insert: (...args: unknown[]) => { state.writes(table, 'insert', ...args); throw new Error('Unexpected client write') },
        update: (...args: unknown[]) => { state.writes(table, 'update', ...args); throw new Error('Unexpected client write') },
        delete: (...args: unknown[]) => { state.writes(table, 'delete', ...args); throw new Error('Unexpected client write') },
      }
      return query
    },
  },
}))
import { useTrialStatus } from '@/lib/trial'
import { useQuotes } from '@/lib/quotes'
import { useJobs } from '@/lib/jobs'
import { jobDetailsDraft } from '@/lib/jobEditing'
import { useInvoices } from '@/lib/invoices'
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: {} } }) }))
function account(user: string) {
  return { id: user === 'owner-a' ? 'a' : 'b', owner_user_id: user, company_name: user, trial_started_at: '2000-01-01', trial_ends_at: state.end, plan_status: state.status }
}
beforeEach(() => { state.status = 'active'; state.end = '2000-01-01'; state.user = 'owner-a'; state.pending.clear(); state.deferred = false; state.writes.mockReset() })
afterEach(cleanup)
describe('Block 2 client entitlement and stale identity', () => {
  it.each([
    ['trialing', '2099-01-01', false], ['trialing', '2000-01-01', true],
    ['active', '2000-01-01', false], ['past_due', '2099-01-01', true], ['expired', '2099-01-01', true],
  ])('%s / %s carries the correct read-only state', async (status, end, readOnly) => {
    state.status = status; state.end = end
    const { result } = renderHook(() => useTrialStatus(true, state.user))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.trial).toMatchObject({ companyAccountId: 'a', readOnly, hasFullAccess: !readOnly })
  })
  it('ignores late company A entitlement after switching to B', async () => {
    state.deferred = true
    const hook = renderHook(() => useTrialStatus(true, state.user))
    await waitFor(() => expect(state.pending.has('owner-a')).toBe(true))
    state.user = 'owner-b'; hook.rerender()
    await waitFor(() => expect(state.pending.has('owner-b')).toBe(true))
    expect(hook.result.current.trial).toBeNull()
    await act(async () => state.pending.get('owner-b')?.({ data: account('owner-b'), error: null }))
    await waitFor(() => expect(hook.result.current.trial?.companyAccountId).toBe('b'))
    await act(async () => state.pending.get('owner-a')?.({ data: account('owner-a'), error: null }))
    expect(hook.result.current.trial?.companyAccountId).toBe('b')
  })
  it('clears entitlement on sign-out and ignores pending identity responses', async () => {
    state.deferred = true
    let user: string | null = 'owner-a'
    const hook = renderHook(() => useTrialStatus(Boolean(user), user))
    await waitFor(() => expect(state.pending.has('owner-a')).toBe(true))
    user = null; hook.rerender()
    await act(async () => state.pending.get('owner-a')?.({ data: account('owner-a'), error: null }))
    expect(hook.result.current.trial).toBeNull()
    expect(hook.result.current.loading).toBe(false)
  })
  it('direct quote/job/invoice/payment hook calls cannot bypass read-only via an enabled control', async () => {
    const access: BillingAccess = { companyAccountId: 'a', companyName: 'A', userId: 'owner-a', readOnly: true, hasFullAccess: false, canUsePremiumFeatures: false, isFounder: false, isPastDue: false, statusMessage: '' }
    const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
    const hook = renderHook(() => ({ quotes: useQuotes(), jobs: useJobs(), invoices: useInvoices() }), { wrapper: Wrapper })
    await waitFor(() => expect(hook.result.current.jobs.loading || hook.result.current.invoices.loading || hook.result.current.quotes.loading).toBe(false))
    await act(async () => {
      expect(await hook.result.current.quotes.add({ customerId: 'c-a', items: [] })).toMatchObject({ ok: false })
      expect(await hook.result.current.quotes.update({ id: 'q-a' })).toMatchObject({ ok: false })
      expect(await hook.result.current.quotes.remove('q-a')).toMatchObject({ ok: false })
      expect(await hook.result.current.jobs.createFromQuote('q-a')).toMatchObject({ ok: false })
      expect(await hook.result.current.jobs.createIntake(jobDetailsDraft())).toMatchObject({ ok: false })
      expect(await hook.result.current.jobs.updateDetails('j-a', jobDetailsDraft(), 'revision')).toMatchObject({ ok: false })
      expect(await hook.result.current.jobs.linkInvoiceFromQuote('q-a', 'i-a')).toMatchObject({ ok: false })
      expect(await hook.result.current.invoices.addPayment('i-a', { id: 'p-a', amount: 1, method: 'cash', dateISO: '2026-10-17' })).toMatchObject({ ok: false })
    })
    expect(state.writes).not.toHaveBeenCalled()
  })
})
