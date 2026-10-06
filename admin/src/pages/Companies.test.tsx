// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Companies from './Companies'
import type { PlatformCompany } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  getPlatformCompanies: vi.fn(async () => ({ companies: [company] })),
}))

afterEach(cleanup)
const company: PlatformCompany = {
  id: 'company-1', company_name: 'Example', owner_user_id: 'owner-1',
  plan_status: 'active', stripe_price_id: 'price_from_configured_environment',
  plan_name: 'starter', stripe_customer_id: null, stripe_subscription_id: 'sub-example',
  has_ever_paid_recurring: true, trial_started_at: null, trial_ends_at: null,
  subscription_renewed_at: null, subscription_cancel_at: null,
  created_at: '2026-10-01T00:00:00Z', member_count: 1, open_tickets: 0,
}

describe('Companies plan labels', () => {
  it('uses the API plan name rather than build-time hard-coded Stripe price IDs', async () => {
    render(<Companies />)
    expect(await screen.findByText('Example')).toBeTruthy()
    expect(screen.getByText('Starter')).toBeTruthy()
  })
})
