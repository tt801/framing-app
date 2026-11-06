import React from 'react'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PresetControls from '@/components/PresetControls'
import ToastContainer from '@/components/ToastContainer'
import { useToast } from '@/lib/toast'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const hook = vi.hoisted(() => ({ presets: [] as any[], loading: false, error: null, save: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/presets', () => ({ useCompanyPresets: () => hook }))
const preset = { id: 'preset-a', name: 'Oak frame with double mat', revision: 3, state: { openings: [{ id: 'one' }, { id: 'two' }] }, createdAt: 1 }
const other = { ...preset, id: 'preset-b', name: 'Other design' }
const billing: BillingAccess = { readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '', companyAccountId: 'company-a', companyName: 'Same name', userId: 'user-a' }
const base = { companyName: 'Same name', customerKey: 'customer-a', hasSavedCustomer: true, ensureCustomerId: vi.fn(async () => 'customer-a'), currentState: { original: true }, onApply: vi.fn() }
const view = (props = {}, access = billing) => <BillingAccessProvider value={access}><PresetControls {...base} {...props} /><ToastContainer /></BillingAccessProvider>
const trigger = (name = preset.name) => within(screen.getByText(name).closest('li')!).getByRole('button', { name: 'Delete' })
function open(name = preset.name) { const button = trigger(name); button.focus(); fireEvent.click(button); return screen.getByRole('dialog', { name: 'Delete preset?' }) }
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void
  const promise = new Promise<any>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks(); hook.presets = [{ ...preset }, { ...other }]
  hook.remove.mockResolvedValue({ ok: true })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id) })

it('opens confirmation identifying the selected preset without deleting anything', () => {
  render(view()); const dialog = open()
  expect(within(dialog).getByText(preset.name)).toBeTruthy()
  expect(dialog.textContent).toContain('cannot be undone')
  expect(within(dialog).getByRole('button', { name: 'Delete preset' }).className).toContain('bg-rose-700')
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(hook.remove).not.toHaveBeenCalled()
})

it.each(['Cancel', 'Escape', 'native cancel'])('closes via %s without deletion and restores the row trigger', method => {
  render(view()); const button = trigger(); const dialog = open()
  if (method === 'Cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  if (method === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
  if (method === 'native cancel') fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(button)
  expect(hook.remove).not.toHaveBeenCalled()
  expect(useToast.getState().toasts).toHaveLength(0)
})

it('traps keyboard focus between Cancel and Delete preset', () => {
  render(view()); open()
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  const remove = screen.getByRole('button', { name: 'Delete preset' })
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(remove)
  fireEvent.keyDown(remove, { key: 'Tab' })
  expect(document.activeElement).toBe(cancel)
})

it('closes only on confirmed success and renders the real success notification', async () => {
  const request = deferred(); hook.remove.mockReturnValue(request.promise)
  render(view()); const dialog = open(); confirm()
  expect(hook.remove).toHaveBeenCalledExactlyOnceWith(preset)
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(useToast.getState().toasts).toHaveLength(0)
  await act(async () => request.resolve({ ok: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('Preset deleted.')).toBeTruthy()
  expect(useToast.getState().toasts.map(toast => toast.type)).toEqual(['success'])
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save preset' }))
})

it('pins a frozen ID, name and revision snapshot rather than a live list entry or array index', async () => {
  const rendered = render(view()); open()
  hook.presets[0].id = 'changed-id'; hook.presets[0].name = 'Changed name'; hook.presets[0].revision = 99
  hook.presets.reverse(); rendered.rerender(view())
  expect(within(screen.getByRole('dialog')).getByText(preset.name)).toBeTruthy()
  confirm()
  await waitFor(() => expect(hook.remove).toHaveBeenCalledExactlyOnceWith(preset))
  expect(Object.isFrozen(hook.remove.mock.calls[0][0])).toBe(true)
})

it('does not retarget an existing confirmation after another row is activated', async () => {
  render(view()); open()
  fireEvent.click(trigger(other.name))
  expect(within(screen.getByRole('dialog')).getByText(preset.name)).toBeTruthy()
  confirm()
  await waitFor(() => expect(hook.remove).toHaveBeenCalledExactlyOnceWith(preset))
})

it.each(['returned', 'rejected', 'unconfirmed'])('keeps the selected preset and cautious inline guidance on %s failures', async outcome => {
  if (outcome === 'returned') hook.remove.mockResolvedValueOnce({ ok: false, error: 'Preset changed or no longer exists' })
  if (outcome === 'rejected') hook.remove.mockRejectedValueOnce(new Error('Network interruption'))
  if (outcome === 'unconfirmed') hook.remove.mockResolvedValueOnce(undefined)
  render(view()); open(); confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('Check the preset list before retrying')
  expect(within(screen.getByRole('dialog')).getByText(preset.name)).toBeTruthy()
  expect(useToast.getState().toasts).toHaveLength(0)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  confirm()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(hook.remove).toHaveBeenNthCalledWith(2, preset)
})

it('blocks repeated confirmation, Cancel, Escape and native dismissal while pending', async () => {
  const request = deferred(); hook.remove.mockReturnValue(request.promise)
  render(view()); const dialog = open()
  act(() => { confirm(); confirm(); confirm() })
  expect(hook.remove).toHaveBeenCalledTimes(1)
  expect(dialog.getAttribute('aria-busy')).toBe('true')
  expect((screen.getByRole('button', { name: 'Delete preset' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.getByRole('dialog')).toBe(dialog)
  await act(async () => request.resolve({ ok: false, error: 'Uncertain response' }))
  expect((screen.getByRole('button', { name: 'Delete preset' }) as HTMLButtonElement).disabled).toBe(false)
})

for (const outcome of ['success', 'failure', 'rejection']) {
  it.each(['customer', 'company ID', 'company name', 'unmount'])(`suppresses stale deletion ${outcome} after %s changes`, async change => {
    const request = deferred(); hook.remove.mockReturnValue(request.promise)
    const rendered = render(view()); open(); confirm()
    if (change === 'customer') rendered.rerender(view({ customerKey: 'customer-b' }))
    if (change === 'company ID') rendered.rerender(view({}, { ...billing, companyAccountId: 'company-b' }))
    if (change === 'company name') rendered.rerender(view({ companyName: 'Other company' }))
    if (change === 'unmount') rendered.unmount()
    if (outcome === 'rejection') await act(async () => request.reject(new Error('Late rejection')))
    else await act(async () => request.resolve(outcome === 'success' ? { ok: true } : { ok: false, error: 'Late error' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useToast.getState().toasts).toHaveLength(0)
    expect(hook.remove).toHaveBeenCalledExactlyOnceWith(preset)
  })
}

it.each(['success', 'rejection'])('does not let old %s close or contaminate a newer confirmation after switching away and back', async outcome => {
  const request = deferred(); hook.remove.mockReturnValueOnce(request.promise)
  const rendered = render(view()); open(); confirm()
  rendered.rerender(view({ customerKey: 'customer-b' })); rendered.rerender(view())
  const newer = open(other.name)
  if (outcome === 'rejection') await act(async () => request.reject(new Error('Old error')))
  else await act(async () => request.resolve({ ok: true }))
  expect(screen.getByRole('dialog')).toBe(newer)
  expect(within(newer).getByText(other.name)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(useToast.getState().toasts).toHaveLength(0)
  confirm()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(hook.remove).toHaveBeenNthCalledWith(2, other)
})

it.each(['customer', 'company', 'unmount'])('does not delete if %s changes before confirmation', change => {
  const rendered = render(view()); open()
  if (change === 'customer') rendered.rerender(view({ customerKey: 'customer-b' }))
  if (change === 'company') rendered.rerender(view({}, { ...billing, companyAccountId: 'company-b' }))
  if (change === 'unmount') rendered.unmount()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(hook.remove).not.toHaveBeenCalled()
})
