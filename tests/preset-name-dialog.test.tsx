import React from 'react'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PresetControls from '@/components/PresetControls'
import ToastContainer from '@/components/ToastContainer'
import { useToast } from '@/lib/toast'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const hook = vi.hoisted(() => ({ presets: [] as any[], loading: false, error: null, save: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/presets', () => ({ useCompanyPresets: () => hook }))
const design = { frame: { id: 'frame-a' }, mats: [{ border: 3 }, { border: 2 }], openings: [{ id: 'one', imageUrl: 'data:original' }, { id: 'two' }], artwork: { widthCm: 40 }, borders: { top: 4 } }
const base = { companyName: 'Company A', customerKey: 'customer-a', hasSavedCustomer: true, ensureCustomerId: vi.fn(async () => 'customer-a'), currentState: design, onApply: vi.fn() }
const view = (props = {}) => <><PresetControls {...base} {...props} /><ToastContainer /></>
async function openSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  return screen.findByRole('dialog', { name: 'Save design preset' })
}
const input = () => screen.getByRole('textbox', { name: 'Preset name' }) as HTMLInputElement
const submit = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save preset' }))
const enterName = (name = 'Saved') => fireEvent.change(input(), { target: { value: name } })
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void
  const promise = new Promise<any>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks(); hook.presets = []
  hook.save.mockResolvedValue({ ok: true, preset: { id: 'saved', name: 'Saved', state: design, createdAt: 1, revision: 1 } })
  base.ensureCustomerId.mockResolvedValue('customer-a')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.spyOn(window, 'prompt').mockReturnValue('Old prompt name')
})
afterEach(() => { cleanup(); for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id); vi.restoreAllMocks() })

it('opens a labelled modal with the name field focused instead of a native prompt', async () => {
  render(view())
  const dialog = await openSave()
  expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
  expect(document.activeElement).toBe(input())
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy()
  const backgroundButtons = screen.getAllByRole('button', { name: 'Save preset' }).filter(button => !button.closest('dialog'))
  expect(backgroundButtons).toHaveLength(1)
  expect(backgroundButtons[0].parentElement!.querySelector('.absolute')).toBeNull()
  expect(base.ensureCustomerId).toHaveBeenCalledTimes(1)
  fireEvent.click(backgroundButtons[0])
  expect(base.ensureCustomerId).toHaveBeenCalledTimes(1)
  expect(hook.save).not.toHaveBeenCalled()
  expect(window.prompt).not.toHaveBeenCalled()
})

it.each([true, false])('locks rapid activations during customer preparation (already saved: %s)', async hasSavedCustomer => {
  const request = deferred()
  const ensureCustomerId = vi.fn(() => request.promise)
  render(view({ hasSavedCustomer, ensureCustomerId }))
  const trigger = screen.getByRole('button', { name: 'Save preset' }) as HTMLButtonElement
  act(() => { fireEvent.click(trigger); fireEvent.click(trigger); fireEvent.click(trigger) })
  expect(ensureCustomerId).toHaveBeenCalledTimes(1)
  expect(trigger.disabled).toBe(true)
  expect(screen.getAllByRole('button', { name: 'Save preset' })).toHaveLength(1)
  expect(hook.save).not.toHaveBeenCalled()
  await act(async () => request.resolve('customer-a'))
  expect(trigger.disabled).toBe(false)
  if (hasSavedCustomer) expect(screen.getByRole('dialog', { name: 'Save design preset' })).toBeTruthy()
  else {
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Customer saved. Save the preset again now that it is assigned to this customer.')).toBeTruthy()
  }
  expect(ensureCustomerId).toHaveBeenCalledTimes(1)
  expect(hook.save).not.toHaveBeenCalled()
})

it.each(['Cancel', 'Escape', 'native cancel'])('closes on %s, restores the original trigger, and never saves', async method => {
  render(view()); const trigger = screen.getByRole('button', { name: 'Save preset' })
  const dialog = await openSave(); enterName()
  if (method === 'Cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  else if (method === 'Escape') fireEvent.keyDown(input(), { key: 'Escape' })
  else fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(hook.save).not.toHaveBeenCalled()
  expect(base.ensureCustomerId).toHaveBeenCalledTimes(1)
  expect(useToast.getState().toasts).toHaveLength(0)
})

it('contains Tab and Shift+Tab at both focus boundaries', async () => {
  render(view()); const dialog = await openSave()
  fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true })
  const save = within(dialog).getByRole('button', { name: 'Save preset' })
  expect(document.activeElement).toBe(save)
  fireEvent.keyDown(save, { key: 'Tab' })
  expect(document.activeElement).toBe(input())
})

it.each(['', '   \t  '])('validates an empty trimmed name: %j', async name => {
  render(view()); await openSave(); enterName(name); submit()
  const error = screen.getByRole('alert')
  expect(error.textContent).toBe('Enter a preset name.')
  expect(input().getAttribute('aria-describedby')).toBe(error.id)
  expect(input().getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(input())
  expect(hook.save).not.toHaveBeenCalled()
})

it('trims the name, preserves the original design payload, and closes only after confirmed persistence', async () => {
  const request = deferred(); hook.save.mockReturnValue(request.promise)
  const rendered = render(view()); const trigger = screen.getByRole('button', { name: 'Save preset' })
  const original = JSON.stringify(design)
  await openSave(); enterName('   My exact setup   ')
  rendered.rerender(view({ currentState: { different: true } }))
  fireEvent.submit(input().closest('form')!)
  expect(hook.save).toHaveBeenCalledExactlyOnceWith({ id: '', name: 'My exact setup', state: design })
  expect(hook.save.mock.calls[0][0].state).toBe(design)
  expect(JSON.stringify(design)).toBe(original)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(useToast.getState().toasts).toHaveLength(0)
  await act(async () => request.resolve({ ok: true, preset: { id: 'saved', name: 'My exact setup' } }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('Preset saved.')).toBeTruthy()
  expect(useToast.getState().toasts.map(toast => toast.type)).toEqual(['success'])
  expect(document.activeElement).toBe(trigger)
})

it.each(['returned', 'rejected', 'unconfirmed'])('retains the name and actionable inline feedback for %s failures, and supports retry', async outcome => {
  if (outcome === 'returned') hook.save.mockResolvedValueOnce({ ok: false, error: 'Save response unavailable' })
  if (outcome === 'rejected') hook.save.mockRejectedValueOnce(new Error('Network interruption'))
  if (outcome === 'unconfirmed') hook.save.mockResolvedValueOnce({ ok: true, preset: {} })
  render(view()); await openSave(); enterName('Keep my name'); submit()
  expect((await screen.findByRole('alert')).textContent).toContain('Check the preset list before retrying')
  expect(input().value).toBe('Keep my name')
  expect(input().disabled).toBe(false)
  expect(document.activeElement).toBe(input())
  expect(useToast.getState().toasts).toHaveLength(0)
  submit()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(hook.save).toHaveBeenCalledTimes(2)
})

it('locks repeated submissions, Tab, Escape, native cancel and Cancel while pending', async () => {
  const request = deferred(); hook.save.mockReturnValue(request.promise)
  render(view()); const dialog = await openSave(); enterName()
  const form = input().closest('form')!
  act(() => { submit(); fireEvent.submit(form); fireEvent.submit(form) })
  expect(hook.save).toHaveBeenCalledTimes(1)
  expect(dialog.getAttribute('aria-busy')).toBe('true')
  expect(input().disabled).toBe(true)
  expect((within(dialog).getByRole('button', { name: 'Save preset' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false)
  expect(document.activeElement).toBe(dialog)
  expect(screen.getByRole('dialog')).toBe(dialog)
  await act(async () => request.resolve({ ok: false, error: 'Unavailable' }))
})

it('keeps customer creation before name entry and requires a second explicit save even after parent selection changes', async () => {
  function CustomerWorkflow() {
    const [saved, setSaved] = React.useState(false)
    return view({ customerKey: saved ? 'new-customer' : 'anonymous', hasSavedCustomer: saved,
      ensureCustomerId: async () => { await Promise.resolve(); setSaved(true); return 'new-customer' } })
  }
  render(<CustomerWorkflow />)
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  expect(await screen.findByText('Customer saved. Save the preset again now that it is assigned to this customer.')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(hook.save).not.toHaveBeenCalled()
  await openSave()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Customer saved. Save the preset again now that it is assigned to this customer.')).toBeTruthy()
  expect(hook.save).not.toHaveBeenCalled()
  expect(base.onApply).not.toHaveBeenCalled()
})

it('handles rejected customer saves before opening the dialog without claiming success', async () => {
  render(view({ ensureCustomerId: vi.fn().mockRejectedValue(new Error('Network')) }))
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  expect(await screen.findByText(/Check Customers before saving/)).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(hook.save).not.toHaveBeenCalled()
})

const billing: BillingAccess = { readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '', companyAccountId: 'company-a', companyName: 'Same name', userId: 'user-a' }
const scopedView = (props = {}, access = billing) => <BillingAccessProvider value={access}>{view(props)}</BillingAccessProvider>
for (const outcome of ['success', 'returned error', 'rejection'] as const) {
  it.each(['customer', 'company name', 'company ID', 'unmount'])(`suppresses stale ${outcome} after %s changes`, async change => {
    const request = deferred(); hook.save.mockReturnValue(request.promise)
    const rendered = render(scopedView()); await openSave(); enterName(); submit()
    if (change === 'customer') rendered.rerender(scopedView({ customerKey: 'customer-b' }))
    if (change === 'company name') rendered.rerender(scopedView({ companyName: 'Company B' }))
    if (change === 'company ID') rendered.rerender(scopedView({}, { ...billing, companyAccountId: 'company-b' }))
    if (change === 'unmount') rendered.unmount()
    if (outcome === 'rejection') await act(async () => request.reject(new Error('Late failure')))
    else await act(async () => request.resolve(outcome === 'success' ? { ok: true, preset: { id: 'old' } } : { ok: false, error: 'Late failure' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useToast.getState().toasts).toHaveLength(0)
  })
}

it.each(['success', 'rejection'])('does not let an old %s close or overwrite a newer dialog after switching away and back', async outcome => {
  const request = deferred(); hook.save.mockReturnValueOnce(request.promise)
  const rendered = render(scopedView()); await openSave(); enterName('Old name'); submit()
  rendered.rerender(scopedView({ customerKey: 'customer-b' }))
  rendered.rerender(scopedView())
  const newer = await openSave(); enterName('New name')
  if (outcome === 'rejection') await act(async () => request.reject(new Error('Old error')))
  else await act(async () => request.resolve({ ok: true, preset: { id: 'old' } }))
  expect(screen.getByRole('dialog')).toBe(newer)
  expect(input().value).toBe('New name')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(useToast.getState().toasts).toHaveLength(0)
})

it.each(['customer', 'company', 'unmount'])('suppresses late customer-preparation results after %s changes', async change => {
  const request = deferred()
  const props = { hasSavedCustomer: false, ensureCustomerId: () => request.promise }
  const rendered = render(scopedView(props))
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  if (change === 'customer') rendered.rerender(scopedView({ ...props, customerKey: 'other' }))
  if (change === 'company') rendered.rerender(scopedView(props, { ...billing, companyAccountId: 'company-b' }))
  if (change === 'unmount') rendered.unmount()
  await act(async () => request.resolve('customer-a'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText(/Customer saved/)).toBeNull()
  expect(hook.save).not.toHaveBeenCalled()
})
