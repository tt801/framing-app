import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn(), getUser: vi.fn(), fetch: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/company', () => ({ useCompany: () => ({ profile: {}, save: mocks.save }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: mocks.getUser } }, getAccessToken: async () => 'synthetic-token',
}))
vi.mock('@/lib/theme', () => ({ useTheme: () => ({ themeMode: 'light' }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: {} } }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: null }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: mocks.toast }) }))
import Onboarding, { isOnboardingDone } from '@/pages/Onboarding'
import Admin from '@/pages/Admin'

const member = { id: 'invited-member', company_account_id: 'company-c', user_id: null, email: 'staff@example.test', role: 'staff', status: 'invited' }
const warning = 'email rate limit exceeded'
const note = 'Membership saved. If the user already has an account, ask them to sign in with the same email to join the workspace.'

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  window.location.hash = '#/onboarding'
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner-c', user_metadata: {} } } })
  mocks.save.mockResolvedValue({ ok: true, profile: {} })
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ member, warning, note }), { status: 202 }))
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function finish() {
  render(<Onboarding />)
  await waitFor(() => expect(mocks.getUser).toHaveBeenCalled())
  fireEvent.change(screen.getByPlaceholderText('e.g. Smith Framing Studio'), { target: { value: 'UAT Finish C' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
  fireEvent.change(screen.getByPlaceholderText('team@yourshop.com'), { target: { value: member.email } })
  fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
}

describe('onboarding invitation warning', () => {
  it('preserves completed setup and shows an invitation request error without claiming membership creation', async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await finish()
    expect(await screen.findByText(/Could not confirm membership creation or invitation email sending.*Failed to fetch/)).toBeTruthy()
    expect(isOnboardingDone('owner-c')).toBe(true)
    expect(window.location.hash).toBe('#/onboarding')
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Dashboard' }))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps normal successful invitations completing and redirecting once', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ member }), { status: 200 }))
    await finish()
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(isOnboardingDone('owner-c')).toBe(true)
    expect(screen.getByText(/Membership created; invitation email sent successfully/)).toBeTruthy()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('keeps HTTP 202 partial success visible until explicit continuation without resending', async () => {
    await finish()
    expect(await screen.findByText(/email rate limit exceeded/)).toBeTruthy()
    expect(screen.getByText(/Company setup saved successfully/)).toBeTruthy()
    expect(screen.getByText(/Membership created.*invitation email could not be sent/i)).toBeTruthy()
    expect(screen.queryByText(/✓ Invited/)).toBeNull()
    expect(isOnboardingDone('owner-c')).toBe(true)
    expect(window.location.hash).toBe('#/onboarding')
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: member.email, role: 'staff' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Dashboard' }))
    expect(window.location.hash).toBe('#/dashboard')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
})

describe('live Admin Workspace access', () => {
  it('retains the normal successful invitation message', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ member }), { status: 200 }))
    render(<Admin />)
    fireEvent.click(screen.getByRole('button', { name: 'Users' }))
    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: member.email } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(`Access invite sent to ${member.email}.`, 'success'))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows the HTTP 202 warning explicitly instead of masking it with the note', async () => {
    render(<Admin />)
    fireEvent.click(screen.getByRole('button', { name: 'Users' }))
    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: member.email } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/Membership created.*invitation email could not be sent.*email rate limit exceeded/), 'warning'))
    expect(mocks.toast).not.toHaveBeenCalledWith(note, 'warning')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
