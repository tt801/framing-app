import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  upsert: vi.fn(),
  invite: vi.fn(),
  allowWrite: () => true,
}))
vi.mock('@/lib/billingAccess', () => ({
  useBillingAccess: () => ({ companyAccountId: 'address-test-company' }),
  useBillingWriteGuard: () => mocks.allowWrite,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'address-test-owner', email: 'owner@example.test', user_metadata: { company_name: 'Original Studio' } } } }) },
    from: (table: string) => {
      if (table !== 'company_settings') throw new Error(`Unexpected table: ${table}`)
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: mocks.settings ? { settings: mocks.settings } : null, error: null }),
        upsert: (payload: { company_account_id: string; settings: Record<string, unknown> }, options: unknown) => {
          mocks.upsert(payload, options)
          mocks.settings = JSON.parse(JSON.stringify(payload.settings))
          return query
        },
        single: async () => ({ data: { settings: mocks.settings }, error: null }),
      }
      return query
    },
  },
}))
vi.mock('@/lib/companyMembers', () => ({ inviteCompanyMember: mocks.invite }))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light' }) }))
import { useCompany } from '@/lib/company'
import Onboarding from '@/pages/Onboarding'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings = null
  localStorage.clear()
  window.location.hash = '#/onboarding'
})
afterEach(cleanup)

describe.each(['Skip for now', 'Finish setup'])('%s address synchronization', button => {
  it('replaces the normalized default address and persists the exact submitted city through reload', async () => {
    const initial = renderHook(() => useCompany())
    await waitFor(() => expect(initial.result.current.loading).toBe(false))
    expect(initial.result.current.profile.companyAddress).toBe('South Africa')
    initial.unmount()

    const page = render(<Onboarding />)
    await waitFor(() => expect((screen.getByPlaceholderText('e.g. Smith Framing Studio') as HTMLInputElement).value).toBe('Original Studio'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Smith Framing Studio'), { target: { value: 'UAT Address Studio' } })
    fireEvent.change(screen.getByPlaceholderText('Street address'), { target: { value: ' 12 Test Street ' } })
    fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'UAT Skip City' } })
    fireEvent.change(screen.getByPlaceholderText('Postal code'), { target: { value: ' AB1 2CD ' } })
    fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'United Kingdom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GBP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))

    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith({
      company_account_id: 'address-test-company',
      settings: expect.objectContaining({
        companyAddress: '12 Test Street, UAT Skip City, AB1 2CD, United Kingdom',
        addressLine1: '12 Test Street',
        city: 'UAT Skip City',
        postalCode: 'AB1 2CD',
        country: 'United Kingdom',
        currencyCode: 'GBP',
      }),
    }, { onConflict: 'company_account_id' })
    expect(mocks.invite).not.toHaveBeenCalled()
    page.unmount()

    const reloaded = renderHook(() => useCompany())
    await waitFor(() => expect(reloaded.result.current.loading).toBe(false))
    expect(reloaded.result.current.profile).toMatchObject({
      companyAddress: '12 Test Street, UAT Skip City, AB1 2CD, United Kingdom',
      city: 'UAT Skip City',
      country: 'United Kingdom',
    })
  })
})

it('preserves an intentionally customized printable address during ordinary company saves', async () => {
  mocks.settings = { companyAddress: 'Custom PDF address\nKeep this wording', city: 'Old City', country: 'South Africa' }
  const { result } = renderHook(() => useCompany())
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    const saved = await result.current.save({ city: 'UAT Skip City', country: 'United Kingdom' })
    expect(saved.ok).toBe(true)
  })
  expect(mocks.settings).toMatchObject({
    companyAddress: 'Custom PDF address\nKeep this wording',
    city: 'UAT Skip City',
    country: 'United Kingdom',
  })
  await act(async () => { await result.current.refresh() })
  expect(result.current.profile.companyAddress).toBe('Custom PDF address\nKeep this wording')
})
