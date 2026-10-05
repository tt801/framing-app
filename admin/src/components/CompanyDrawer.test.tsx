// @vitest-environment jsdom
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CompanyDrawer from './CompanyDrawer'

vi.mock('@/lib/api', () => ({
  getPlatformMembers: vi.fn(async () => ({ members: [] })),
  listPlatformTickets: vi.fn(async () => ({ tickets: [] })),
  getPlatformBillingHistory: vi.fn(async () => ({ attempts: [{ id: 'attempt-1', price_id: 'founder_lifetime', status: 'completed', founder_reserved: false, created_at: '2026-10-05T12:00:00Z', completed_at: '2026-10-05T12:01:00Z' }] })),
}))
afterEach(cleanup)
const base = { id: 'company-1', company_name: 'Test', owner_user_id: 'owner-1', plan_status: 'active', stripe_price_id: 'founder_lifetime', stripe_customer_id: 'cus_example', stripe_subscription_id: null, has_ever_paid_recurring: false, trial_started_at: '2026-10-01T00:00:00Z', trial_ends_at: '2026-10-15T00:00:00Z', subscription_renewed_at: '2126-10-05T00:00:00Z', created_at: '2026-10-01T00:00:00Z', member_count: 1, open_tickets: 0 }
describe('platform billing details', () => {
  it('shows lifetime access and purchase history without the 2126 renewal sentinel', async () => {
    render(<CompanyDrawer company={base} onClose={() => {}} />)
    expect(screen.getByText('Founder Lifetime')).toBeTruthy()
    expect(screen.getByText('Lifetime access')).toBeTruthy()
    expect(screen.queryByText(/2126/)).toBeNull()
    expect(screen.getByText('cus_example')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Founder purchase/)).toBeTruthy())
  })
})
