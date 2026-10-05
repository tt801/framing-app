// @vitest-environment jsdom
import React from 'react'
import { renderHook, waitFor, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ account: null as any, now: 0 }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: mocks.account, error: null }) }) }) }),
    rpc: () => ({ single: async () => ({ data: { is_founder: mocks.account?.founder }, error: null }) }),
  },
  getCurrentUser: async () => ({ id: 'user-a', email: 'a@example.test' }),
}))
import { useTrialStatus } from '@/lib/trial'
import TrialBanner from '@/components/TrialBanner'
afterEach(() => { cleanup(); vi.useRealTimers() })
const account = (start: string, end: string, founder = false) => ({ id: 'company-a', owner_user_id: 'user-a', company_name: 'A', trial_started_at: start, trial_ends_at: end, plan_status: founder ? 'active' : 'trialing', founder })
describe('trial and Founder presentation', () => {
  it('never displays 15 for a fresh fourteen-day trial even if the browser clock precedes server creation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-05T16:43:16.000Z'))
    mocks.account = account('2026-10-05T16:43:17.582985Z', '2026-10-19T16:43:17.582985Z')
    const { result } = renderHook(() => useTrialStatus(true, 'user-a'))
    await waitFor(() => expect(result.current.trial).not.toBeNull())
    expect(result.current.trial?.daysRemaining).toBe(14)
  })
  it('remains at one day in the last partial day and zero at expiry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T16:43:00Z'))
    mocks.account = account('2026-10-05T16:43:17Z', '2026-10-19T16:43:17Z')
    const first = renderHook(() => useTrialStatus(true, 'user-a'))
    await waitFor(() => expect(first.result.current.trial).not.toBeNull())
    expect(first.result.current.trial?.daysRemaining).toBe(1)
    first.unmount(); vi.setSystemTime(new Date('2026-10-19T16:43:18Z'))
    const second = renderHook(() => useTrialStatus(true, 'user-a'))
    await waitFor(() => expect(second.result.current.trial).not.toBeNull())
    expect(second.result.current.trial?.daysRemaining).toBe(0)
    expect(second.result.current.trial?.expired).toBe(true)
  })
  it('gives Founder lifetime access after historical trial expiry without an expired banner', async () => {
    mocks.account = account('2020-01-01T00:00:00Z', '2020-01-15T00:00:00Z', true)
    const { result } = renderHook(() => useTrialStatus(true, 'user-a'))
    await waitFor(() => expect(result.current.trial).not.toBeNull())
    expect(result.current.trial).toMatchObject({ expired: false, readOnly: false, hasFullAccess: true, isFounder: true })
    render(<TrialBanner trial={result.current.trial} />)
    expect(screen.getByText(/Lifetime access active/)).toBeTruthy()
    expect(screen.queryByText(/Subscription expired/)).toBeNull()
  })
})
