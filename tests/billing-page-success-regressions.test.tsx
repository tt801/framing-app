// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingSummary } from '@/lib/billing'

const mocks = vi.hoisted(() => ({
  summary: null as BillingSummary | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
  confirm: vi.fn(),
  trial: null as any,
  portal: vi.fn(),
  trialHook: vi.fn(),
}))
vi.mock('@/lib/billing', () => ({
  useBillingSummary: () => ({ summary: mocks.summary, loading: mocks.loading, error: mocks.error, refresh: mocks.refresh }),
  useBillingPortal: () => ({ openPortal: mocks.portal, loading: false }),
  confirmCheckout: (...args: any[]) => mocks.confirm(...args),
}))
vi.mock('@/lib/trial', () => ({ useTrialStatus: (...args: any[]) => { mocks.trialHook(...args); return { trial: mocks.trial, refresh: () => mocks.refresh() } } }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/components/UpgradeModal', () => ({ default: ({ founderEligible }: { founderEligible?: boolean }) => <div data-testid="upgrade-options">Upgrade choices {founderEligible === false ? '' : 'Founder purchase'}</div> }))
import BillingPage from '@/pages/Billing'
import BillingSuccess from '@/pages/BillingSuccess'

function summary(status: BillingSummary['account']['plan_status'], price: string | null = null, remaining = 1): BillingSummary {
  return {
    account: { id: 'company-a', company_name: 'Test Co', plan_status: status, stripe_customer_id: 'cus-a', stripe_subscription_id: status === 'trialing' ? null : 'sub-a', stripe_price_id: price, subscription_renewed_at: null, subscription_cancel_at: null, trial_started_at: '2026-09-20T00:00:00Z', trial_ends_at: '2026-10-04T00:00:00Z' },
    founder: { maxPurchases: 1, purchasedCount: 1 - remaining, remaining, soldOut: remaining === 0, eligible: status === 'trialing' && remaining > 0 }, portalEligible: status !== 'trialing' && price !== 'founder_lifetime',
  }
}

beforeEach(() => {
  mocks.summary = null; mocks.loading = false; mocks.error = null; mocks.trial = null
  mocks.refresh.mockReset(); mocks.portal.mockReset(); mocks.trialHook.mockReset(); mocks.confirm.mockReset()
  mocks.confirm.mockResolvedValue({ status: 'pending' })
  window.location.hash = '#/billing/success?session_id=cs_a'
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('billing page entitlement presentation', () => {
  it('shows Founder lifetime and no purchase options even when a second trial hook has no identity', () => {
    mocks.summary = summary('active', 'founder_lifetime')
    render(<BillingPage />)
    expect(screen.getByText('Founder', { exact: true })).toBeTruthy()
    expect(screen.getByText('Lifetime access')).toBeTruthy()
    expect(mocks.trialHook).not.toHaveBeenCalled()
    expect(screen.queryByTestId('upgrade-options')).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage subscription' }).hasAttribute('disabled')).toBe(true)
  })
  it.each(['trialing', 'active', 'past_due', 'expired'] as const)('renders %s from the authenticated summary', status => {
    mocks.summary = summary(status, status === 'trialing' ? null : 'price-regular')
    render(<BillingPage />)
    expect(screen.getByText(status.replace('_', ' '), { exact: true })).toBeTruthy()
    if (status !== 'trialing') expect(screen.queryByText('Founder', { exact: true })).toBeNull()
  })
  it('does not show purchase actions before billing summary loads or after an error', () => {
    mocks.loading = true
    const view = render(<BillingPage />)
    expect(screen.queryByTestId('upgrade-options')).toBeNull()
    mocks.loading = false; mocks.error = 'Billing unavailable'
    view.rerender(<BillingPage />)
    expect(screen.getByText('Billing unavailable')).toBeTruthy()
    expect(screen.queryByTestId('upgrade-options')).toBeNull()
  })
  it('does not offer Founder when its purchase cap is full', () => {
    mocks.summary = summary('trialing', null, 0)
    render(<BillingPage />)
    expect(screen.queryByTestId('upgrade-options')?.textContent).not.toContain('Founder purchase')
  })
})

describe('checkout confirmation', () => {
  it('does not claim activation when refresh returns unchanged trial state', async () => {
    mocks.refresh.mockResolvedValue({ planStatus: 'trialing', isFounder: false })
    vi.useFakeTimers()
    render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByText('Subscription activated')).toBeNull()
    expect(screen.getByText(/Confirming/)).toBeTruthy()
  })
  it('does not claim activation for null account or failed refresh', async () => {
    mocks.refresh.mockResolvedValue(null)
    vi.useFakeTimers()
    const view = render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByText('Subscription activated')).toBeNull()
    view.unmount()
    mocks.refresh.mockRejectedValue(new Error('network'))
    render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByText('Subscription activated')).toBeNull()
  })
  it('does not confirm an unrelated already-active subscription for this returned session', async () => {
    mocks.refresh.mockResolvedValue({ planStatus: 'active', isFounder: false, companyAccountId: 'company-a' })
    vi.useFakeTimers()
    render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByText('Subscription activated')).toBeNull()
  })
  it('does not confirm a Founder account for a mismatched returned session', async () => {
    mocks.trial = { companyName: 'Test Co', planStatus: 'active', isFounder: true }
    mocks.refresh.mockResolvedValue(mocks.trial)
    window.location.hash = '#/billing/success?session_id=cs-wrong'
    vi.useFakeTimers()
    render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByText('Subscription activated')).toBeNull()
  })
  it('does not call a completed Founder purchase a subscription', async () => {
    mocks.trial = { companyName: 'Test Co', planStatus: 'active', isFounder: true }
    mocks.refresh.mockResolvedValue(mocks.trial)
    vi.useFakeTimers()
    render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByText('Subscription activated')).toBeNull()
  })
  it('does not repeatedly refresh just because the component re-rendered', async () => {
    mocks.confirm.mockResolvedValue({ status: 'pending' })
    vi.useFakeTimers()
    const view = render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    const calls = mocks.confirm.mock.calls.length
    view.rerender(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(mocks.confirm.mock.calls.length).toBe(calls + 1)
    expect(mocks.confirm.mock.calls.length).toBeLessThanOrEqual(4)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('confirms Founder lifetime access only from this authenticated session result', async () => {
    mocks.confirm.mockResolvedValue({ status: 'confirmed', kind: 'founder', companyName: 'Test Co' })
    render(<BillingSuccess />)
    await act(async () => { await Promise.resolve() })
    expect(mocks.confirm).toHaveBeenCalledWith('cs_a')
    expect(screen.getByText('Founder lifetime access activated')).toBeTruthy()
    expect(screen.queryByText('Subscription activated')).toBeNull()
  })
  it('confirms the matching recurring subscription only from this session result', async () => {
    mocks.confirm.mockResolvedValue({ status: 'confirmed', kind: 'recurring', companyName: 'Test Co' })
    render(<BillingSuccess />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Subscription activated')).toBeTruthy()
  })
  it('never confirms without a returned session id', async () => {
    window.location.hash = '#/billing/success'
    render(<BillingSuccess />)
    await act(async () => { await Promise.resolve() })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(screen.queryByText('Subscription activated')).toBeNull()
  })
  it('stops bounded polling in a pending state without claiming success', async () => {
    vi.useFakeTimers()
    render(<BillingSuccess />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(mocks.confirm.mock.calls.length).toBeLessThanOrEqual(4)
    expect(screen.queryByText('Subscription activated')).toBeNull()
    expect(screen.getByText(/Confirming/)).toBeTruthy()
  })
})
