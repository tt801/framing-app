// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpgradeModal from '@/components/UpgradeModal'

const checkout = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trial', () => ({ useStripeCheckout: () => ({ startCheckout: checkout, loading: false, error: null }) }))
afterEach(cleanup)

describe('Founder purchase presentation', () => {
  it('explains unavailable pricing instead of silently offering an inert Checkout', () => {
    checkout.mockReset()
    render(<UpgradeModal embedded />)
    expect(screen.getByText(/Checkout temporarily unavailable for Growth/)).toBeTruthy()
    const button = screen.getByRole('button', { name: /Checkout unavailable/i })
    fireEvent.click(button)
    expect(checkout).not.toHaveBeenCalled()
  })
  it('omits Founder when eligibility was not supplied', () => {
    render(<UpgradeModal embedded />)
    expect(screen.queryByText('Founder', { exact: true })).toBeNull()
  })
  it('shows Founder only when explicitly eligible', () => {
    render(<UpgradeModal embedded founderEligible={true} />)
    expect(screen.getByText('Founder', { exact: true })).toBeTruthy()
  })
})
