import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PresetControls from '@/components/PresetControls'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useToast } from '@/lib/toast'

const db = vi.hoisted(() => ({ rpc: vi.fn(), rows: new Map<string, any[]>() }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: any[]) => db.rpc(...args),
  from: () => {
    const filters: Record<string, string> = {}
    const query = {
      select: () => query,
      eq: (field: string, value: string) => { filters[field] = value; return query },
      order: async () => ({ data: db.rows.get(`${filters.company_account_id}:${filters.customer_id}`) || [], error: null }),
    }
    return query
  },
} }))
const design = { mats: [{ border: 3 }], openings: [{ id: 'one' }, { id: 'two' }], artwork: { widthCm: 40 } }
const access = (companyAccountId: string): BillingAccess => ({ readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '', companyAccountId, companyName: 'Same name', userId: 'user' })
const row = (name: string) => ({ id: name, name, state: design, created_at: '2026-11-01T00:00:00Z', revision: 1 })
const view = (company = 'company-a', customer = 'customer-a') => <BillingAccessProvider value={access(company)}><PresetControls companyName="Same name" customerKey={customer} hasSavedCustomer ensureCustomerId={async () => customer} currentState={design} onApply={vi.fn()} /></BillingAccessProvider>
async function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Save preset' })[1])
  const input = await screen.findByRole('textbox', { name: 'Preset name' })
  fireEvent.change(input, { target: { value: '  Persisted design  ' } })
  fireEvent.submit(input.closest('form')!)
}
beforeEach(() => {
  vi.clearAllMocks(); db.rows.clear()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id) })

it.each(['customer', 'company'])('keeps a late persisted preset out of the newly selected %s list using the real hook', async change => {
  let resolve!: (value: any) => void
  db.rpc.mockReturnValue(new Promise(done => { resolve = done }))
  db.rows.set(change === 'customer' ? 'company-a:customer-b' : 'company-b:customer-a', [row('Current scope preset')])
  const rendered = render(view()); await start()
  expect(db.rpc).toHaveBeenCalledTimes(1)
  rendered.rerender(change === 'customer' ? view('company-a', 'customer-b') : view('company-b'))
  await screen.findByText('Current scope preset')
  await act(async () => resolve({ data: row('Old scope preset'), error: null }))
  expect(screen.queryByText('Old scope preset')).toBeNull()
  expect(screen.getByText('Current scope preset')).toBeTruthy()
  expect(useToast.getState().toasts).toHaveLength(0)
})

it('retains the existing hook list update and RPC payload on confirmed success', async () => {
  db.rpc.mockResolvedValue({ data: row('Persisted design'), error: null })
  render(view()); await start()
  await screen.findByText('Persisted design')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith('create_company_preset', {
    p_id: expect.any(String), p_company: 'company-a', p_customer: 'customer-a', p_name: 'Persisted design', p_state: design,
  })
  expect(db.rpc.mock.calls[0][1].p_state).toBe(design)
  expect(useToast.getState().toasts[0]?.message).toBe('Preset saved.')
})
