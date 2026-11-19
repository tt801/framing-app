import React from 'react'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PresetControls from '@/components/PresetControls'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useToast } from '@/lib/toast'
import { decodeVisualizerPreset } from '@/lib/visualizerScene'

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
const legacyDesign = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:saved-artwork' }, mats: { geometryVersion: 3,
  selectedMat1: 'm1', selectedMat2: 'm2', selectedMat3: 'mat0', mode: 'pro', proOrigin: { x: 6, y: 3 },
  borders: [{ top: 2, bottom: 4, left: 3, right: 5 }, { top: 1, bottom: 2, left: 3, right: 2 }, { top: 2, bottom: 2, left: 2, right: 2 }],
  openings: [{ id: 'one', shape: 'oval', xCm: 6, yCm: 3, widthCm: 10, heightCm: 12, imageUrl: 'data:opening-one' },
    { id: 'two', shape: 'circle', xCm: 24, yCm: 3, widthCm: 8, heightCm: 8, imageUrl: 'data:opening-two' }] } }
const design = { ...legacyDesign, mats: { ...legacyDesign.mats, layoutModel: 'shared-group-v1', locks: [false, false, true] }, visualizerDesign: { version: 1, layoutModel: 'shared-group-v1', mode: 'pro', basic: legacyDesign.art, pro: { origin: legacyDesign.mats.proOrigin, openings: legacyDesign.mats.openings }, mats: legacyDesign.mats.borders.map((borders, i) => ({ materialId: ['m1', 'm2', 'mat0'][i], borders, locked: i === 2 })) } }
const access = (companyAccountId: string): BillingAccess => ({ readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '', companyAccountId, companyName: 'Same name', userId: 'user' })
const row = (name: string) => ({ id: name, name, state: design, created_at: '2026-11-01T00:00:00Z', revision: 1 })
const view = (company = 'company-a', customer = 'customer-a') => <BillingAccessProvider value={access(company)}><PresetControls companyName="Same name" customerKey={customer} hasSavedCustomer ensureCustomerId={async () => customer} currentState={design} onApply={vi.fn()} /></BillingAccessProvider>
async function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
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

it('refuses to save a review-only geometry preview without calling customer or persistence writes', async () => {
  const ensure = vi.fn(async () => 'customer-a')
  render(<BillingAccessProvider value={access('company-a')}><PresetControls companyName="Same name" customerKey="customer-a" hasSavedCustomer
    ensureCustomerId={ensure} currentState={design} onApply={vi.fn()} saveIssue="Saved mat geometry needs review" /></BillingAccessProvider>)
  expect((screen.getByRole('button', { name: 'Save preset' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  expect(ensure).not.toHaveBeenCalled()
  expect(db.rpc).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

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

it('reloads the persisted versioned mat design through the real hook without losing inactive sides or opening images', async () => {
  db.rpc.mockImplementation(async (_name: string, args: { p_state: typeof design; p_name: string }) => {
    const saved = { ...row(args.p_name), state: structuredClone(args.p_state) }
    db.rows.set('company-a:customer-a', [saved])
    return { data: saved, error: null }
  })
  const first = render(view()); await start()
  await screen.findByText('Persisted design')
  first.unmount()
  const apply = vi.fn()
  render(<BillingAccessProvider value={access('company-a')}><PresetControls companyName="Same name" customerKey="customer-a" hasSavedCustomer
    ensureCustomerId={async () => 'customer-a'} currentState={{}} onApply={apply} /></BillingAccessProvider>)
  await screen.findByText('Persisted design')
  fireEvent.click(screen.getByRole('button', { name: 'Load' }))
  expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ state: design }))
  expect(db.rpc).toHaveBeenCalledTimes(1)
  const loaded = decodeVisualizerPreset(apply.mock.calls[0][0].state)
  expect(loaded.issue).toBeNull()
  expect(loaded.state.visualizerDesign).toEqual(design.visualizerDesign)
})

it('deletes only the confirmed ID and revision, updates the list, and focuses the stable panel action', async () => {
  db.rows.set('company-a:customer-a', [row('Delete this'), row('Keep this')])
  db.rpc.mockResolvedValue({ error: null })
  render(view())
  const selected = await screen.findByText('Delete this')
  fireEvent.click(within(selected.closest('li')!).getByRole('button', { name: 'Delete' }))
  expect(db.rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText('Delete this')).toBeNull()
  expect(screen.getByText('Keep this')).toBeTruthy()
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith('delete_company_preset', { p_id: 'Delete this', p_company: 'company-a', p_revision: 1 })
  expect(useToast.getState().toasts[0]?.message).toBe('Preset deleted.')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save preset' }))
})

it.each(['customer', 'company'])('does not apply an old delete result to the new %s list', async change => {
  let resolve!: (value: any) => void
  db.rpc.mockReturnValue(new Promise(done => { resolve = done }))
  db.rows.set('company-a:customer-a', [row('Delete this'), row('Keep this')])
  db.rows.set(change === 'customer' ? 'company-a:customer-b' : 'company-b:customer-a', [row('Delete this'), row('New scope preset')])
  const rendered = render(view())
  const selected = await screen.findByText('Delete this')
  fireEvent.click(within(selected.closest('li')!).getByRole('button', { name: 'Delete' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
  rendered.rerender(change === 'customer' ? view('company-a', 'customer-b') : view('company-b'))
  await screen.findByText('New scope preset')
  await act(async () => resolve({ error: null }))
  expect(screen.getByText('Delete this')).toBeTruthy()
  expect(screen.getByText('New scope preset')).toBeTruthy()
  expect(useToast.getState().toasts).toHaveLength(0)
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith('delete_company_preset', { p_id: 'Delete this', p_company: 'company-a', p_revision: 1 })
})
