// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpgradeModal from '@/components/UpgradeModal'

vi.mock('@/lib/trial', () => ({ useStripeCheckout: () => ({ startCheckout: vi.fn(), loading: false, error: null }) }))
afterEach(cleanup)

describe('Founder purchase presentation', () => {
  it('omits Founder when eligibility was not supplied', () => {
    render(<UpgradeModal embedded />)
    expect(screen.queryByText('Founder', { exact: true })).toBeNull()
  })
  it('shows Founder only when explicitly eligible', () => {
    render(<UpgradeModal embedded founderEligible={true} />)
    expect(screen.getByText('Founder', { exact: true })).toBeTruthy()
  })
})
