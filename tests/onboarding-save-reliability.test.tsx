import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useCompany } from '@/lib/company'

const mocks = vi.hoisted(() => ({ save: vi.fn(), getUser: vi.fn(), invite: vi.fn() }))
vi.mock('@/lib/company', () => ({ useCompany: () => ({ profile: {}, save: mocks.save }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: mocks.getUser } } }))
vi.mock('@/lib/companyMembers', () => ({ inviteCompanyMember: mocks.invite }))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light' }) }))
import Onboarding, { isOnboardingDone } from '@/pages/Onboarding'

type SaveResult = Awaited<ReturnType<ReturnType<typeof useCompany>['save']>>
const success = { ok: true, profile: {} } as SaveResult
function deferredSave() {
  let resolve!: (value: SaveResult) => void
  const promise = new Promise<SaveResult>(done => { resolve = done })
  return { promise, resolve }
}

async function invitationStep() {
  render(<Onboarding />)
  await waitFor(() => expect((screen.getByPlaceholderText('e.g. Smith Framing Studio') as HTMLInputElement).value).toBe('Original Studio'))
  fireEvent.change(screen.getByPlaceholderText('e.g. Smith Framing Studio'), { target: { value: 'Entered Studio' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GBP' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
  fireEvent.change(screen.getByPlaceholderText('team@yourshop.com'), { target: { value: 'staff@example.test' } })
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  window.location.hash = '#/onboarding'
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'onboarding-user', email: 'owner@example.test', user_metadata: { company_name: 'Original Studio' } } }, error: null })
  mocks.save.mockResolvedValue(success)
  mocks.invite.mockResolvedValue({ member: { id: 'staff-member' } })
})
afterEach(cleanup)

describe.each(['Skip for now', 'Finish setup'])('%s persistence gate', button => {
  it('recovers from a rejected save without completing onboarding', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Network unavailable'))
    await invitationStep()
    fireEvent.click(screen.getByRole('button', { name: button }))
    await screen.findByText('Network unavailable')
    expect(isOnboardingDone('onboarding-user')).toBe(false)
    expect(window.location.hash).toBe('#/onboarding')
    expect(mocks.invite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(isOnboardingDone('onboarding-user')).toBe(true)
    expect(mocks.save).toHaveBeenCalledTimes(2)
  })

  it('waits for successful persistence before marking complete and redirecting', async () => {
    const pending = deferredSave()
    mocks.save.mockReturnValueOnce(pending.promise)
    await invitationStep()
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'Entered Studio', currencyCode: 'GBP', currencySymbol: '£' }))
    await act(async () => { await Promise.resolve() })
    expect(isOnboardingDone('onboarding-user')).toBe(false)
    expect(window.location.hash).toBe('#/onboarding')
    expect(mocks.invite).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Skip for now' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { pending.resolve(success) })
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(isOnboardingDone('onboarding-user')).toBe(true)
    if (button === 'Skip for now') expect(mocks.invite).not.toHaveBeenCalled()
    else expect(mocks.invite).toHaveBeenCalledWith({ email: 'staff@example.test', role: 'staff', fullName: undefined })
  })

  it('shows a returned save failure, preserves form state and permits a successful retry', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Company save failed' })
    await invitationStep()
    fireEvent.click(screen.getByRole('button', { name: button }))
    await screen.findByText('Company save failed')
    expect(isOnboardingDone('onboarding-user')).toBe(false)
    expect(window.location.hash).toBe('#/onboarding')
    expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByPlaceholderText('team@yourshop.com') as HTMLInputElement).value).toBe('staff@example.test')
    expect(mocks.invite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(isOnboardingDone('onboarding-user')).toBe(true)
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0])
    expect(screen.queryByText('Company save failed')).toBeNull()
  })
})
